import {
  FACE_TO_FACE_TTL_MS,
  checkRateLimit,
  createId,
  createNotification,
  errorResponse,
  formatPublicUser,
  generateShortCode,
  getClientIp,
  getDb,
  isGroupMember,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

async function loadGroupDetails(db, groupId) {
  const grp = await db.prepare('SELECT * FROM travel_groups WHERE id = ?').bind(groupId).first();
  if (!grp) return null;
  const membersRes = await db
    .prepare(`
      SELECT m.role, m.joined_at, u.id, u.nickname, u.friend_code, u.avatar_preset, u.motto, u.map_visibility, u.created_at
      FROM travel_group_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.joined_at ASC
    `)
    .bind(groupId)
    .all();
  const plansRes = await db
    .prepare('SELECT id, title, destination, version, updated_by_name, updated_at FROM ai_plans WHERE group_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC')
    .bind(groupId)
    .all();
  const expensesRes = await db
    .prepare('SELECT * FROM group_expenses WHERE group_id = ? AND deleted_at IS NULL ORDER BY date DESC, updated_at DESC LIMIT 300')
    .bind(groupId)
    .all();

  return {
    id: grp.id,
    name: grp.name,
    ownerId: grp.owner_id,
    inviteCode: grp.invite_code,
    createdAt: grp.created_at,
    updatedAt: grp.updated_at,
    members: (membersRes.results || []).map((m) => ({
      role: m.role,
      joinedAt: m.joined_at,
      user: formatPublicUser(m),
    })),
    plans: (plansRes.results || []).map((p) => ({
      id: p.id,
      title: p.title,
      destination: p.destination,
      version: Number(p.version || 1),
      updatedByName: p.updated_by_name || '',
      updatedAt: p.updated_at,
    })),
    expenses: (expensesRes.results || []).map((e) => ({
      id: e.id,
      groupId: e.group_id,
      planId: e.plan_id || null,
      date: e.date,
      category: e.category,
      title: e.title,
      amountCents: Number(e.amount_cents || 0),
      payerUserId: e.payer_user_id,
      participantUserIds: (() => { try { return JSON.parse(e.participant_user_ids_json || '[]'); } catch { return []; } })(),
      createdBy: e.created_by,
      updatedAt: e.updated_at,
    })),
  };
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);
  const auth = await requireAuth(db, request);
  const userId = auth.user.id;

  // GET /api/groups (我的全部行程群列表)
  if (method === 'GET' && segments.length === 0) {
    const res = await db
      .prepare(`
        SELECT g.*, m.role AS my_role,
          (SELECT COUNT(*) FROM travel_group_members gm WHERE gm.group_id = g.id) AS member_count,
          (SELECT COUNT(*) FROM ai_plans p WHERE p.group_id = g.id AND p.deleted_at IS NULL) AS plan_count
        FROM travel_group_members m
        JOIN travel_groups g ON g.id = m.group_id
        WHERE m.user_id = ?
        ORDER BY g.updated_at DESC
      `)
      .bind(userId)
      .all();

    return jsonResponse(request, 200, {
      ok: true,
      groups: (res.results || []).map((g) => ({
        id: g.id,
        name: g.name,
        ownerId: g.owner_id,
        myRole: g.my_role,
        inviteCode: g.invite_code,
        memberCount: Number(g.member_count || 0),
        planCount: Number(g.plan_count || 0),
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      })),
    });
  }

  // POST /api/groups (新建行程群，可选拉好友和绑定行程)
  if (method === 'POST' && segments.length === 0) {
    const body = await readJsonBody(request, 8192);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return errorResponse(request, 400, '请输入行程群名称', 'MISSING_NAME');
    const groupId = createId('grp');
    const inviteCode = generateShortCode(8);
    const now = nowIso();

    await db
      .prepare('INSERT INTO travel_groups (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(groupId, name, userId, inviteCode, now, now)
      .run();
    await db
      .prepare('INSERT INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)')
      .bind(groupId, userId, now)
      .run();

    const memberIds = Array.isArray(body.memberUserIds) ? body.memberUserIds : [];
    for (const mId of memberIds) {
      const targetId = String(mId || '');
      if (!targetId || targetId === userId) continue;
      await db
        .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
        .bind(groupId, targetId, now)
        .run();
      await createNotification(db, {
        userId: targetId,
        type: 'group_invite',
        actorId: userId,
        actorNickname: auth.user.nickname,
        title: `${auth.user.nickname} 拉你加入了行程群「${name}」`,
        body: '打开「同行旅伴」即可查看和共同编辑群内行程',
        targetRef: { groupId },
      });
    }

    if (body.planId) {
      const plan = await db.prepare('SELECT id, owner_id FROM ai_plans WHERE id = ? AND deleted_at IS NULL').bind(String(body.planId)).first();
      if (plan && plan.owner_id === userId) {
        await db.prepare('UPDATE ai_plans SET group_id = ?, updated_at = ? WHERE id = ?').bind(groupId, now, plan.id).run();
      }
    }

    const detail = await loadGroupDetails(db, groupId);
    return jsonResponse(request, 201, { ok: true, group: detail });
  }

  // POST /api/groups/face-to-face (面对面 4 位数字建群/入群，30 分钟有效)
  if (method === 'POST' && segments[0] === 'face-to-face') {
    const rl = await checkRateLimit(db, `f2f:${getClientIp(request)}`, 20, 600);
    if (!rl.allowed) return errorResponse(request, 429, '操作过于频繁，请稍后再试', 'RATE_LIMITED');

    const body = await readJsonBody(request, 4096);
    const pinCode = String(body.pinCode || '').trim();
    if (!/^\d{4}$/.test(pinCode)) {
      return errorResponse(request, 400, '请输入 4 位数字口令', 'INVALID_PIN');
    }
    const now = nowIso();
    // 清理已过期房间
    await db.prepare('DELETE FROM face_to_face_rooms WHERE expires_at <= ?').bind(now).run();

    let room = await db.prepare('SELECT * FROM face_to_face_rooms WHERE pin_code = ?').bind(pinCode).first();
    let created = false;
    if (!room) {
      const groupId = createId('grp');
      const groupName = String(body.groupName || '').trim().slice(0, 40) || `面对面同行群 · ${pinCode}`;
      const expiresAt = new Date(Date.now() + FACE_TO_FACE_TTL_MS).toISOString();
      await db
        .prepare('INSERT INTO travel_groups (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(groupId, groupName, userId, generateShortCode(8), now, now)
        .run();
      await db
        .prepare('INSERT INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)')
        .bind(groupId, userId, now)
        .run();
      await db
        .prepare('INSERT INTO face_to_face_rooms (pin_code, group_id, creator_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(pinCode, groupId, userId, expiresAt, now)
        .run();
      room = { pin_code: pinCode, group_id: groupId, creator_id: userId, expires_at: expiresAt };
      created = true;
    } else {
      await db
        .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
        .bind(room.group_id, userId, now)
        .run();
      await db.prepare('UPDATE travel_groups SET updated_at = ? WHERE id = ?').bind(now, room.group_id).run();
      // 可选顺带和群内现有成员互加好友
      if (body.autoAddFriends !== false) {
        const existingMembers = await db
          .prepare('SELECT user_id FROM travel_group_members WHERE group_id = ? AND user_id != ?')
          .bind(room.group_id, userId)
          .all();
        for (const m of existingMembers.results || []) {
          const already = await db
            .prepare('SELECT id FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
            .bind(userId, m.user_id, m.user_id, userId)
            .first();
          if (!already) {
            await db
              .prepare('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, \'accepted\', ?, ?)')
              .bind(createId('frd'), userId, m.user_id, now, now)
              .run();
          }
        }
      }
    }

    const detail = await loadGroupDetails(db, room.group_id);
    return jsonResponse(request, 200, {
      ok: true,
      created,
      pinCode,
      expiresAt: room.expires_at,
      group: detail,
    });
  }

  // POST /api/groups/join-by-code (群二维码 / 邀请码加入)
  if (method === 'POST' && segments[0] === 'join-by-code') {
    const body = await readJsonBody(request, 4096);
    const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
    if (!inviteCode) return errorResponse(request, 400, '请输入群邀请码', 'MISSING_CODE');
    const grp = await db.prepare('SELECT * FROM travel_groups WHERE invite_code = ?').bind(inviteCode).first();
    if (!grp) return errorResponse(request, 404, '未找到该行程群，请核对邀请码或二维码', 'GROUP_NOT_FOUND');
    const now = nowIso();
    await db
      .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
      .bind(grp.id, userId, now)
      .run();
    const detail = await loadGroupDetails(db, grp.id);
    return jsonResponse(request, 200, { ok: true, group: detail });
  }

  // /api/groups/:groupId/...
  const groupId = segments[0];
  if (!groupId) return errorResponse(request, 404, '未找到群接口', 'NOT_FOUND');

  const membership = await isGroupMember(db, groupId, userId);
  if (!membership) return errorResponse(request, 403, '你不是该行程群的成员', 'FORBIDDEN');

  // GET /api/groups/:groupId
  if (method === 'GET' && segments.length === 1) {
    const detail = await loadGroupDetails(db, groupId);
    if (!detail) return errorResponse(request, 404, '行程群不存在', 'NOT_FOUND');
    return jsonResponse(request, 200, { ok: true, group: detail });
  }

  // PATCH /api/groups/:groupId (仅群主可重命名)
  if (method === 'PATCH' && segments.length === 1) {
    if (membership.role !== 'owner') return errorResponse(request, 403, '仅群主可修改群名称', 'FORBIDDEN');
    const body = await readJsonBody(request, 4096);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return errorResponse(request, 400, '群名称不能为空', 'MISSING_NAME');
    await db.prepare('UPDATE travel_groups SET name = ?, updated_at = ? WHERE id = ?').bind(name, nowIso(), groupId).run();
    return jsonResponse(request, 200, { ok: true, name });
  }

  // DELETE /api/groups/:groupId (仅群主可解散群)
  if (method === 'DELETE' && segments.length === 1) {
    if (membership.role !== 'owner') return errorResponse(request, 403, '仅群主可解散行程群', 'FORBIDDEN');
    await db.prepare('DELETE FROM travel_groups WHERE id = ?').bind(groupId).run();
    return jsonResponse(request, 200, { ok: true });
  }

  // POST /api/groups/:groupId/members (拉好友进群)
  if (method === 'POST' && segments[1] === 'members') {
    const body = await readJsonBody(request, 4096);
    const targetIds = Array.isArray(body.userIds) ? body.userIds : (body.userId ? [body.userId] : []);
    const grp = await db.prepare('SELECT name FROM travel_groups WHERE id = ?').bind(groupId).first();
    const now = nowIso();
    for (const rawId of targetIds) {
      const tId = String(rawId || '');
      if (!tId || tId === userId) continue;
      await db
        .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
        .bind(groupId, tId, now)
        .run();
      await createNotification(db, {
        userId: tId,
        type: 'group_invite',
        actorId: userId,
        actorNickname: auth.user.nickname,
        title: `${auth.user.nickname} 拉你加入了行程群「${grp?.name || '同行群'}」`,
        body: '你们现在可以一起编辑群内攻略和 AA 记账啦',
        targetRef: { groupId },
      });
    }
    const detail = await loadGroupDetails(db, groupId);
    return jsonResponse(request, 200, { ok: true, group: detail });
  }

  // DELETE /api/groups/:groupId/members/:targetUserId (退群或群主踢人)
  if (method === 'DELETE' && segments[1] === 'members' && segments[2]) {
    const targetUserId = segments[2];
    if (targetUserId !== userId && membership.role !== 'owner') {
      return errorResponse(request, 403, '仅群主可移除其他成员', 'FORBIDDEN');
    }
    if (targetUserId === userId && membership.role === 'owner') {
      return errorResponse(request, 400, '群主如需离开请直接解散群', 'OWNER_CANNOT_LEAVE');
    }
    await db.prepare('DELETE FROM travel_group_members WHERE group_id = ? AND user_id = ?').bind(groupId, targetUserId).run();
    return jsonResponse(request, 200, { ok: true });
  }

  // GET /api/groups/:groupId/expenses
  if (method === 'GET' && segments[1] === 'expenses') {
    const detail = await loadGroupDetails(db, groupId);
    return jsonResponse(request, 200, { ok: true, expenses: detail?.expenses || [] });
  }

  // POST /api/groups/:groupId/expenses (新增或更新群 AA 账目)
  if (method === 'POST' && segments[1] === 'expenses') {
    const body = await readJsonBody(request, 8192);
    const title = String(body.title || '').trim().slice(0, 80);
    const date = String(body.date || '').trim().slice(0, 10) || nowIso().slice(0, 10);
    const category = String(body.category || 'other').slice(0, 24);
    const amountCents = Math.round(Number(body.amountCents || 0));
    const payerUserId = String(body.payerUserId || userId);
    const participantUserIds = Array.isArray(body.participantUserIds) && body.participantUserIds.length
      ? body.participantUserIds.map(String)
      : [payerUserId];
    if (!title || !Number.isFinite(amountCents) || amountCents <= 0) {
      return errorResponse(request, 400, '请填写消费名称与大于 0 的金额', 'INVALID_EXPENSE');
    }
    const expenseId = body.id ? String(body.id).slice(0, 128) : createId('exp');
    const now = nowIso();
    await db
      .prepare(`
        INSERT INTO group_expenses (
          id, group_id, plan_id, date, category, title, amount_cents,
          payer_user_id, participant_user_ids_json, created_by, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          date = excluded.date,
          category = excluded.category,
          title = excluded.title,
          amount_cents = excluded.amount_cents,
          payer_user_id = excluded.payer_user_id,
          participant_user_ids_json = excluded.participant_user_ids_json,
          updated_at = excluded.updated_at,
          deleted_at = NULL
      `)
      .bind(
        expenseId,
        groupId,
        body.planId ? String(body.planId) : null,
        date,
        category,
        title,
        amountCents,
        payerUserId,
        JSON.stringify(participantUserIds),
        userId,
        now,
      )
      .run();
    return jsonResponse(request, 200, {
      ok: true,
      expense: {
        id: expenseId,
        groupId,
        planId: body.planId ? String(body.planId) : null,
        date,
        category,
        title,
        amountCents,
        payerUserId,
        participantUserIds,
        createdBy: userId,
        updatedAt: now,
      },
    });
  }

  // DELETE /api/groups/:groupId/expenses/:expenseId
  if (method === 'DELETE' && segments[1] === 'expenses' && segments[2]) {
    const expenseId = segments[2];
    await db
      .prepare('UPDATE group_expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND group_id = ?')
      .bind(nowIso(), nowIso(), expenseId, groupId)
      .run();
    return jsonResponse(request, 200, { ok: true });
  }

  return errorResponse(request, 404, '未找到对应的行程群接口', 'NOT_FOUND');
});
