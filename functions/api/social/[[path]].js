import {
  RELATION_TYPES,
  areFriends,
  createId,
  createNotification,
  errorResponse,
  formatPublicUser,
  getActiveIntimacy,
  getDb,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

const RELATION_LABELS = {
  couple: '情侣',
  family: '家人',
  soulmate: '挚友',
  bestie: '闺蜜',
};

let friendNotesTableReady = false;
async function ensureFriendNotesTable(db) {
  if (friendNotesTableReady) return;
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS friend_notes (
        owner_user_id TEXT NOT NULL,
        peer_user_id TEXT NOT NULL,
        remark TEXT NOT NULL DEFAULT '',
        intimate_label TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_user_id, peer_user_id)
      )
    `)
    .run();
  friendNotesTableReady = true;
}

async function upsertFriendNote(db, ownerUserId, peerUserId, patch) {
  await ensureFriendNotesTable(db);
  const existing = await db
    .prepare('SELECT remark, intimate_label FROM friend_notes WHERE owner_user_id = ? AND peer_user_id = ?')
    .bind(ownerUserId, peerUserId)
    .first();
  const remark = patch.remark !== undefined ? patch.remark : (existing?.remark || '');
  const intimateLabel = patch.intimateLabel !== undefined ? patch.intimateLabel : (existing?.intimate_label || '');
  const now = nowIso();
  if (existing) {
    await db
      .prepare('UPDATE friend_notes SET remark = ?, intimate_label = ?, updated_at = ? WHERE owner_user_id = ? AND peer_user_id = ?')
      .bind(remark, intimateLabel, now, ownerUserId, peerUserId)
      .run();
  } else {
    await db
      .prepare('INSERT INTO friend_notes (owner_user_id, peer_user_id, remark, intimate_label, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(ownerUserId, peerUserId, remark, intimateLabel, now)
      .run();
  }
}

async function loadUserMarks(db, targetUserId) {
  const res = await db
    .prepare('SELECT payload_json FROM user_records WHERE user_id = ? AND store_name = \'marks\' AND deleted_at IS NULL')
    .bind(targetUserId)
    .all();
  return (res.results || [])
    .map((r) => {
      try { return JSON.parse(r.payload_json); } catch { return null; }
    })
    .filter((m) => m && m.id);
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);
  const auth = await requireAuth(db, request);
  const userId = auth.user.id;

  // GET /api/social/overview
  if (method === 'GET' && segments[0] === 'overview') {
    const friendsRes = await db
      .prepare(`
        SELECT f.id AS friendship_id, f.status, f.requester_id, f.addressee_id, f.created_at,
               u.id, u.nickname, u.friend_code, u.avatar_preset, u.motto, u.map_visibility, u.created_at AS user_created_at
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status IN ('accepted', 'pending')
        ORDER BY f.updated_at DESC
      `)
      .bind(userId, userId, userId)
      .all();

    const intimacyRes = await db
      .prepare(`
        SELECT b.*, u.id AS peer_id, u.nickname AS peer_nickname, u.friend_code AS peer_friend_code,
               u.avatar_preset AS peer_avatar, u.motto AS peer_motto, u.map_visibility AS peer_map_visibility
        FROM intimacy_bonds b
        JOIN users u ON u.id = CASE WHEN b.user_a_id = ? THEN b.user_b_id ELSE b.user_a_id END
        WHERE (b.user_a_id = ? OR b.user_b_id = ?) AND b.status IN ('active', 'pending')
        ORDER BY b.updated_at DESC
      `)
      .bind(userId, userId, userId)
      .all();

    const unreadRow = await db
      .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .bind(userId)
      .first();

    const sharesRes = await db
      .prepare(`
        SELECT code, plan_id, sender_id, sender_nickname, mode, title, destination, days_count, created_at
        FROM plan_shares
        WHERE recipient_user_id = ? AND expires_at > ?
        ORDER BY created_at DESC LIMIT 30
      `)
      .bind(userId, nowIso())
      .all();

    // 加载当前用户为各旅伴设置的独立备注与亲密称呼
    await ensureFriendNotesTable(db);
    const notesRes = await db
      .prepare('SELECT peer_user_id, remark, intimate_label FROM friend_notes WHERE owner_user_id = ?')
      .bind(userId)
      .all();
    const notesMap = new Map();
    for (const n of notesRes.results || []) {
      notesMap.set(n.peer_user_id, {
        remark: n.remark || '',
        intimateLabel: n.intimate_label || '',
      });
    }

    // 计算当前用户与每位亲密关系好友的共同去过城市数（用于联动旅途成就）
    const myMarks = await loadUserMarks(db, userId);
    const myVisitedSet = new Set(myMarks.filter((m) => m.visited).map((m) => m.id));

    const intimacyBonds = [];
    for (const row of intimacyRes.results || []) {
      let sharedVisitedCount = 0;
      if (row.status === 'active') {
        const peerMarks = await loadUserMarks(db, row.peer_id);
        sharedVisitedCount = peerMarks.filter((m) => m.visited && myVisitedSet.has(m.id)).length;
      }
      const note = notesMap.get(row.peer_id);
      const myCustomLabel = note?.intimateLabel || (row.requester_id === userId ? (row.custom_label || '') : '');
      const peerCustomLabel = row.requester_id !== userId ? (row.custom_label || '') : '';
      intimacyBonds.push({
        id: row.id,
        relationType: row.relation_type,
        status: row.status,
        requesterId: row.requester_id,
        incoming: row.status === 'pending' && row.requester_id !== userId,
        customLabel: myCustomLabel,
        peerCustomLabel,
        anniversaryDate: row.anniversary_date || '',
        sharedVisitedCount,
        createdAt: row.created_at,
        peer: {
          id: row.peer_id,
          nickname: row.peer_nickname,
          remark: note?.remark || '',
          friendCode: row.peer_friend_code,
          avatar: row.peer_avatar || 'bear',
          motto: row.peer_motto || '',
          mapVisibility: row.peer_map_visibility || 'friends',
        },
      });
    }

    const friends = [];
    const pendingFriendRequests = [];
    for (const row of friendsRes.results || []) {
      const userObj = formatPublicUser(row);
      const note = notesMap.get(userObj.id);
      if (note?.remark) userObj.remark = note.remark;
      if (row.status === 'accepted') {
        friends.push({ friendshipId: row.friendship_id, since: row.created_at, user: userObj });
      } else if (row.addressee_id === userId) {
        pendingFriendRequests.push({ friendshipId: row.friendship_id, createdAt: row.created_at, user: userObj });
      }
    }

    return jsonResponse(request, 200, {
      ok: true,
      friends,
      pendingFriendRequests,
      intimacyBonds,
      receivedShares: (sharesRes.results || []).map((s) => ({
        code: s.code,
        planId: s.plan_id,
        senderId: s.sender_id,
        senderNickname: s.sender_nickname,
        mode: s.mode,
        title: s.title,
        destination: s.destination,
        daysCount: Number(s.days_count || 0),
        createdAt: s.created_at,
      })),
      unreadCount: Number(unreadRow?.cnt || 0),
    });
  }

  // GET /api/social/search?q=...
  if (method === 'GET' && segments[0] === 'search') {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return jsonResponse(request, 200, { ok: true, users: [] });

    const upper = q.toUpperCase();
    const lower = q.toLowerCase();
    const res = await db
      .prepare(`
        SELECT id, nickname, friend_code, avatar_preset, motto, map_visibility, created_at
        FROM users
        WHERE id != ?
          AND (friend_code = ? OR nickname_norm = ? OR nickname_norm LIKE ?)
        ORDER BY CASE WHEN friend_code = ? OR nickname_norm = ? THEN 0 ELSE 1 END, nickname ASC
        LIMIT 15
      `)
      .bind(userId, upper, lower, `${lower}%`, upper, lower)
      .all();

    return jsonResponse(request, 200, {
      ok: true,
      users: (res.results || []).map(formatPublicUser),
    });
  }

  // POST /api/social/friends/request
  if (method === 'POST' && segments[0] === 'friends' && segments[1] === 'request') {
    const body = await readJsonBody(request, 4096);
    let target = null;
    if (body.targetUserId) {
      target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(body.targetUserId)).first();
    } else if (body.friendCode) {
      target = await db.prepare('SELECT * FROM users WHERE friend_code = ?').bind(String(body.friendCode).trim().toUpperCase()).first();
    } else if (body.nickname) {
      target = await db.prepare('SELECT * FROM users WHERE nickname_norm = ?').bind(String(body.nickname).trim().toLowerCase()).first();
    }
    if (!target) return errorResponse(request, 404, '未找到该用户，请核对昵称或好友码', 'USER_NOT_FOUND');
    if (target.id === userId) return errorResponse(request, 400, '不能添加自己为好友', 'SELF_FRIEND');

    const existing = await db
      .prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
      .bind(userId, target.id, target.id, userId)
      .first();

    const now = nowIso();
    if (existing) {
      if (existing.status === 'accepted') {
        return jsonResponse(request, 200, { ok: true, status: 'accepted', message: '你们已经是好友了' });
      }
      if (existing.status === 'pending' && existing.addressee_id === userId) {
        // 对方正好也申请了你，直接通过
        await db.prepare('UPDATE friendships SET status = \'accepted\', updated_at = ? WHERE id = ?').bind(now, existing.id).run();
        await createNotification(db, {
          userId: target.id,
          type: 'friend_accepted',
          actorId: userId,
          actorNickname: auth.user.nickname,
          title: `${auth.user.nickname} 通过了你的好友申请`,
          body: '现在可以互发攻略、建行程群和对比足迹地图啦',
          targetRef: { userId },
        });
        return jsonResponse(request, 200, { ok: true, status: 'accepted', message: '已自动成为好友' });
      }
      if (existing.status === 'pending') {
        return jsonResponse(request, 200, { ok: true, status: 'pending', message: '好友申请已发送，请等待对方确认' });
      }
      await db
        .prepare('UPDATE friendships SET requester_id = ?, addressee_id = ?, status = \'pending\', updated_at = ? WHERE id = ?')
        .bind(userId, target.id, now, existing.id)
        .run();
    } else {
      await db
        .prepare('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, \'pending\', ?, ?)')
        .bind(createId('frd'), userId, target.id, now, now)
        .run();
    }

    await createNotification(db, {
      userId: target.id,
      type: 'friend_req',
      actorId: userId,
      actorNickname: auth.user.nickname,
      title: `${auth.user.nickname} 请求添加你为旅伴好友`,
      body: `好友码：${auth.user.friend_code}`,
      targetRef: { userId },
    });
    return jsonResponse(request, 201, { ok: true, status: 'pending', message: '好友申请已发送' });
  }

  // POST /api/social/friends/respond
  if (method === 'POST' && segments[0] === 'friends' && segments[1] === 'respond') {
    const body = await readJsonBody(request, 4096);
    const friendshipId = String(body.friendshipId || '');
    const decision = String(body.decision || ''); // 'accept' | 'reject' | 'remove'
    const row = await db.prepare('SELECT * FROM friendships WHERE id = ?').bind(friendshipId).first();
    if (!row || (row.requester_id !== userId && row.addressee_id !== userId)) {
      return errorResponse(request, 404, '未找到该好友关系', 'NOT_FOUND');
    }
    const peerId = row.requester_id === userId ? row.addressee_id : row.requester_id;
    const now = nowIso();

    if (decision === 'accept') {
      if (row.addressee_id !== userId) return errorResponse(request, 403, '只能处理发给你的好友申请', 'FORBIDDEN');
      await db.prepare('UPDATE friendships SET status = \'accepted\', updated_at = ? WHERE id = ?').bind(now, friendshipId).run();
      await createNotification(db, {
        userId: peerId,
        type: 'friend_accepted',
        actorId: userId,
        actorNickname: auth.user.nickname,
        title: `${auth.user.nickname} 已同意你的好友申请`,
        body: '快去「同行旅伴」互看足迹或一起做攻略吧',
        targetRef: { userId },
      });
      return jsonResponse(request, 200, { ok: true, status: 'accepted' });
    }
    if (decision === 'reject') {
      await db.prepare('UPDATE friendships SET status = \'rejected\', updated_at = ? WHERE id = ?').bind(now, friendshipId).run();
      return jsonResponse(request, 200, { ok: true, status: 'rejected' });
    }
    if (decision === 'remove') {
      await db.prepare('DELETE FROM friendships WHERE id = ?').bind(friendshipId).run();
      const [a, b] = userId < peerId ? [userId, peerId] : [peerId, userId];
      await db.prepare('DELETE FROM intimacy_bonds WHERE user_a_id = ? AND user_b_id = ?').bind(a, b).run();
      return jsonResponse(request, 200, { ok: true, status: 'removed' });
    }
    return errorResponse(request, 400, '无效操作', 'INVALID_DECISION');
  }

  // GET /api/social/friends/:targetUserId/footprints (互看中国地图足迹与共同去过城市对比)
  if (method === 'GET' && segments[0] === 'friends' && segments[1] && segments[2] === 'footprints') {
    const targetUserId = segments[1];
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(targetUserId).first();
    if (!target) return errorResponse(request, 404, '未找到该用户', 'USER_NOT_FOUND');

    const friendOk = targetUserId === userId || (await areFriends(db, userId, targetUserId));
    if (!friendOk) return errorResponse(request, 403, '仅好友可查看足迹地图', 'NOT_FRIENDS');

    const intimacy = targetUserId === userId ? null : await getActiveIntimacy(db, userId, targetUserId);
    const vis = target.map_visibility || 'friends';
    if (targetUserId !== userId) {
      if (vis === 'private') {
        return errorResponse(request, 403, `${target.nickname} 已设置地图足迹仅自己可见`, 'MAP_PRIVATE');
      }
      if (vis === 'intimate' && !intimacy) {
        return errorResponse(request, 403, `${target.nickname} 已设置地图足迹仅亲密关系可见`, 'MAP_INTIMATE_ONLY');
      }
    }

    const peerMarks = await loadUserMarks(db, targetUserId);
    const myMarks = await loadUserMarks(db, userId);

    const myVisited = new Map(myMarks.filter((m) => m.visited).map((m) => [m.id, m]));
    const myPlanned = new Map(myMarks.filter((m) => m.planned && !m.visited).map((m) => [m.id, m]));
    const peerVisited = peerMarks.filter((m) => m.visited);
    const peerPlanned = peerMarks.filter((m) => m.planned && !m.visited);

    const sharedVisited = peerVisited.filter((m) => myVisited.has(m.id));
    const sharedPlanned = peerPlanned.filter((m) => myPlanned.has(m.id));

    return jsonResponse(request, 200, {
      ok: true,
      peer: formatPublicUser(target),
      intimacy: intimacy ? { relationType: intimacy.relation_type, customLabel: intimacy.custom_label, anniversaryDate: intimacy.anniversary_date } : null,
      peerMarks,
      stats: {
        peerVisitedCount: peerVisited.length,
        myVisitedCount: myVisited.size,
        sharedVisitedCount: sharedVisited.length,
        sharedPlannedCount: sharedPlanned.length,
        sharedVisitedCities: sharedVisited.map((m) => ({ id: m.id, name: m.name, provinceCode: m.provinceCode })),
        sharedPlannedCities: sharedPlanned.map((m) => ({ id: m.id, name: m.name, provinceCode: m.provinceCode })),
      },
    });
  }

  // POST /api/social/intimacy/request
  if (method === 'POST' && segments[0] === 'intimacy' && segments[1] === 'request') {
    const body = await readJsonBody(request, 4096);
    const targetUserId = String(body.targetUserId || '');
    const relationType = String(body.relationType || '');
    if (!RELATION_TYPES.has(relationType)) {
      return errorResponse(request, 400, '亲密关系仅支持情侣、家人、挚友、闺蜜', 'INVALID_RELATION');
    }
    if (!(await areFriends(db, userId, targetUserId))) {
      return errorResponse(request, 400, '请先加为好友后再绑定亲密关系', 'NOT_FRIENDS');
    }
    const [a, b] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
    const customLabel = String(body.customLabel || '').trim().slice(0, 30);
    const anniversaryDate = String(body.anniversaryDate || '').trim().slice(0, 10);
    const now = nowIso();

    const existing = await db.prepare('SELECT * FROM intimacy_bonds WHERE user_a_id = ? AND user_b_id = ?').bind(a, b).first();
    const bondId = existing ? existing.id : createId('int');
    if (existing) {
      await db
        .prepare('UPDATE intimacy_bonds SET requester_id = ?, relation_type = ?, status = \'pending\', custom_label = ?, anniversary_date = ?, updated_at = ? WHERE id = ?')
        .bind(userId, relationType, customLabel, anniversaryDate, now, bondId)
        .run();
    } else {
      await db
        .prepare('INSERT INTO intimacy_bonds (id, user_a_id, user_b_id, requester_id, relation_type, status, custom_label, anniversary_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'pending\', ?, ?, ?, ?)')
        .bind(bondId, a, b, userId, relationType, customLabel, anniversaryDate, now, now)
        .run();
    }

    // 同步保存发起方自己给对方设置的亲密称呼（独立存储，互不覆盖）
    await upsertFriendNote(db, userId, targetUserId, { intimateLabel: customLabel });

    await createNotification(db, {
      userId: targetUserId,
      type: 'intimacy_req',
      actorId: userId,
      actorNickname: auth.user.nickname,
      title: `${auth.user.nickname} 邀请你绑定「${RELATION_LABELS[relationType]}」亲密关系`,
      body: customLabel ? `对方称呼你：${customLabel}` : '绑定后可解锁专属亲密卡片与同行旅途成就',
      targetRef: { userId, relationType, bondId },
    });
    return jsonResponse(request, 201, { ok: true, bondId, message: '亲密关系邀请已发送' });
  }

  // POST /api/social/friends/remark
  if (method === 'POST' && segments[0] === 'friends' && segments[1] === 'remark') {
    const body = await readJsonBody(request, 4096);
    const peerUserId = String(body.peerUserId || '').trim();
    if (!peerUserId || peerUserId === userId) {
      return errorResponse(request, 400, '缺少有效好友信息', 'INVALID_PEER');
    }
    if (!(await areFriends(db, userId, peerUserId))) {
      return errorResponse(request, 403, '仅支持为好友设置备注', 'NOT_FRIENDS');
    }
    const remark = String(body.remark || '').trim().slice(0, 24);
    await upsertFriendNote(db, userId, peerUserId, { remark });
    return jsonResponse(request, 200, { ok: true, remark });
  }

  // POST /api/social/intimacy/respond
  if (method === 'POST' && segments[0] === 'intimacy' && segments[1] === 'respond') {
    const body = await readJsonBody(request, 4096);
    const bondId = String(body.bondId || '');
    const decision = String(body.decision || ''); // 'accept' | 'reject' | 'update' | 'remove'
    const bond = await db.prepare('SELECT * FROM intimacy_bonds WHERE id = ?').bind(bondId).first();
    if (!bond || (bond.user_a_id !== userId && bond.user_b_id !== userId)) {
      return errorResponse(request, 404, '未找到该亲密关系记录', 'NOT_FOUND');
    }
    const peerId = bond.user_a_id === userId ? bond.user_b_id : bond.user_a_id;
    const now = nowIso();

    if (decision === 'accept') {
      if (bond.requester_id === userId) return errorResponse(request, 403, '请等待对方确认', 'FORBIDDEN');
      await db.prepare('UPDATE intimacy_bonds SET status = \'active\', updated_at = ? WHERE id = ?').bind(now, bondId).run();
      if (body.customLabel !== undefined) {
        const myLabel = String(body.customLabel || '').trim().slice(0, 30);
        await upsertFriendNote(db, userId, peerId, { intimateLabel: myLabel });
      }
      await createNotification(db, {
        userId: peerId,
        type: 'intimacy_accepted',
        actorId: userId,
        actorNickname: auth.user.nickname,
        title: `${auth.user.nickname} 接受了你的「${RELATION_LABELS[bond.relation_type] || '亲密'}」绑定`,
        body: '专属亲密卡片与双人同行徽章已解锁',
        targetRef: { bondId },
      });
      return jsonResponse(request, 200, { ok: true, status: 'active' });
    }
    if (decision === 'update') {
      if (body.customLabel !== undefined) {
        const myLabel = String(body.customLabel || '').trim().slice(0, 30);
        await upsertFriendNote(db, userId, peerId, { intimateLabel: myLabel });
        if (bond.requester_id === userId) {
          await db.prepare('UPDATE intimacy_bonds SET custom_label = ?, updated_at = ? WHERE id = ?').bind(myLabel, now, bondId).run();
        }
      }
      if (body.anniversaryDate !== undefined) {
        const anniversaryDate = String(body.anniversaryDate || '').trim().slice(0, 10);
        await db.prepare('UPDATE intimacy_bonds SET anniversary_date = ?, updated_at = ? WHERE id = ?').bind(anniversaryDate, now, bondId).run();
      }
      return jsonResponse(request, 200, { ok: true });
    }
    if (decision === 'reject' || decision === 'remove') {
      await db.prepare('DELETE FROM intimacy_bonds WHERE id = ?').bind(bondId).run();
      return jsonResponse(request, 200, { ok: true, status: 'removed' });
    }
    return errorResponse(request, 400, '无效操作', 'INVALID_DECISION');
  }

  // GET /api/social/notifications
  if (method === 'GET' && segments[0] === 'notifications') {
    const res = await db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(userId)
      .all();
    return jsonResponse(request, 200, {
      ok: true,
      notifications: (res.results || []).map((n) => ({
        id: n.id,
        type: n.type,
        actorId: n.actor_id,
        actorNickname: n.actor_nickname,
        title: n.title,
        body: n.body,
        targetRef: (() => { try { return JSON.parse(n.target_ref_json || '{}'); } catch { return {}; } })(),
        readAt: n.read_at,
        createdAt: n.created_at,
      })),
    });
  }

  // POST /api/social/notifications/read
  if (method === 'POST' && segments[0] === 'notifications' && segments[1] === 'read') {
    const body = await readJsonBody(request, 16384);
    const now = nowIso();
    if (Array.isArray(body.notificationIds) && body.notificationIds.length > 0) {
      const ids = body.notificationIds
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(0, 100);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        await db
          .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`)
          .bind(now, userId, ...ids)
          .run();
      }
    } else if (body.notificationId) {
      await db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').bind(now, String(body.notificationId), userId).run();
    } else {
      await db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now, userId).run();
    }
    return jsonResponse(request, 200, { ok: true });
  }

  return errorResponse(request, 404, '未找到对应的社交接口', 'NOT_FOUND');
});
