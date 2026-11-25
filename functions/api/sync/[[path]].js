import {
  MAX_REVISIONS_PER_PLAN,
  MAX_USER_CLOUD_BYTES,
  MAX_USER_PLANS,
  SYNCABLE_STORES,
  canAccessPlan,
  corsHeaders,
  createId,
  createNotification,
  errorResponse,
  generateShortCode,
  getDb,
  getUserCloudBytes,
  isGroupMember,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  sanitizeAiPlanPayload,
  utf8ByteLength,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

const ASSET_ID_RE = /^[a-f0-9]{64}$/;
const ALLOWED_PHOTO_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const MAX_PLANNER_PHOTO_BYTES = 240 * 1024; // 单张压缩后行程参考图上限 240KB

let plannerPhotosReadyPromise = null;

async function ensurePlannerPhotosTable(db) {
  if (!plannerPhotosReadyPromise) {
    plannerPhotosReadyPromise = db
      .prepare(`
        CREATE TABLE IF NOT EXISTS planner_photos (
          asset_id TEXT PRIMARY KEY,
          mime_type TEXT NOT NULL,
          data_base64 TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          uploaded_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `)
      .run()
      .catch((err) => {
        plannerPhotosReadyPromise = null;
        throw err;
      });
  }
  return plannerPhotosReadyPromise;
}

function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function summarizePlanChange(prevPlan, nextPlan) {
  if (!prevPlan) return '创建了这份攻略';
  const parts = [];
  if (prevPlan.title !== nextPlan.title) parts.push('修改了标题');
  const prevDays = prevPlan.content?.days || [];
  const nextDays = nextPlan.content?.days || [];
  if (prevDays.length !== nextDays.length) {
    parts.push(`调整了行程天数（${nextDays.length}天）`);
  } else {
    for (let i = 0; i < nextDays.length; i += 1) {
      if (JSON.stringify(prevDays[i]) !== JSON.stringify(nextDays[i])) {
        parts.push(`修改了 Day ${i + 1} 行程`);
        break;
      }
    }
  }
  if (JSON.stringify(prevPlan.content?.packingList) !== JSON.stringify(nextPlan.content?.packingList)) {
    parts.push('更新了行李清单');
  }
  if (JSON.stringify(prevPlan.content?.bookings) !== JSON.stringify(nextPlan.content?.bookings)) {
    parts.push('更新了预约/订单');
  }
  if (!parts.length) return '更新了攻略内容';
  return parts.slice(0, 2).join('、');
}

async function pruneOldRevisions(db, planId) {
  await db
    .prepare(`
      DELETE FROM ai_plan_revisions
      WHERE plan_id = ?
        AND id NOT IN (
          SELECT id FROM ai_plan_revisions WHERE plan_id = ? ORDER BY version DESC LIMIT ?
        )
    `)
    .bind(planId, planId, MAX_REVISIONS_PER_PLAN)
    .run();
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);

  // GET /api/sync/photo/:assetId — 按 64 位内容哈希读取已同步的行程参考图（公开只读 + 强缓存，便于 <img> 与跨端缓存）
  if (method === 'GET' && segments[0] === 'photo' && segments[1] && segments.length === 2) {
    const assetId = String(segments[1]).toLowerCase();
    if (!ASSET_ID_RE.test(assetId)) {
      return errorResponse(request, 400, '无效的图片标识', 'INVALID_ASSET_ID');
    }
    await ensurePlannerPhotosTable(db);
    const row = await db
      .prepare('SELECT mime_type, data_base64 FROM planner_photos WHERE asset_id = ?')
      .bind(assetId)
      .first();
    if (!row || !row.data_base64) {
      return errorResponse(request, 404, '云端暂无该行程照片', 'PHOTO_NOT_FOUND');
    }
    const bytes = decodeBase64ToBytes(row.data_base64);
    const cors = corsHeaders(request);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': ALLOWED_PHOTO_MIMES.has(row.mime_type) ? row.mime_type : 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const auth = await requireAuth(db, request);
  const userId = auth.user.id;

  // GET /api/sync/version — 极轻版本号探测（前端高频轮询仅查最新时间戳，无变化时不拉全量数据）
  if (method === 'GET' && segments[0] === 'version' && segments.length === 1) {
    const [recRow, planRow] = await Promise.all([
      db.prepare('SELECT MAX(updated_at) AS ts FROM user_records WHERE user_id = ?').bind(userId).first(),
      db
        .prepare(`
          SELECT MAX(updated_at) AS ts
          FROM ai_plans
          WHERE owner_id = ?
             OR group_id IN (SELECT group_id FROM travel_group_members WHERE user_id = ?)
        `)
        .bind(userId, userId)
        .first(),
    ]);
    const rTs = typeof recRow?.ts === 'string' ? recRow.ts : '';
    const pTs = typeof planRow?.ts === 'string' ? planRow.ts : '';
    const latestUpdatedAt = rTs >= pTs ? rTs : pTs;
    return jsonResponse(request, 200, {
      ok: true,
      latestUpdatedAt,
      serverTime: nowIso(),
    });
  }

  // POST /api/sync/photos/exists — 批量查询哪些行程参考图已存在云端（内容哈希去重，避免重复上传）
  if (method === 'POST' && segments[0] === 'photos' && segments[1] === 'exists') {
    await ensurePlannerPhotosTable(db);
    const body = await readJsonBody(request, 32768);
    const rawIds = Array.isArray(body.assetIds) ? body.assetIds : [];
    const validIds = [...new Set(rawIds.map((id) => String(id || '').toLowerCase()).filter((id) => ASSET_ID_RE.test(id)))].slice(0, 60);
    if (validIds.length === 0) {
      return jsonResponse(request, 200, { ok: true, existing: [] });
    }
    const placeholders = validIds.map(() => '?').join(', ');
    const rows = await db
      .prepare(`SELECT asset_id FROM planner_photos WHERE asset_id IN (${placeholders})`)
      .bind(...validIds)
      .all();
    return jsonResponse(request, 200, {
      ok: true,
      existing: (rows.results || []).map((r) => r.asset_id),
    });
  }

  // POST /api/sync/photos — 上传单张压缩后的行程参考图到云端（按内容哈希去重）
  if (method === 'POST' && segments[0] === 'photos' && segments.length === 1) {
    await ensurePlannerPhotosTable(db);
    const body = await readJsonBody(request, 420 * 1024);
    const assetId = String(body.assetId || '').toLowerCase();
    const mimeType = String(body.mimeType || 'image/jpeg').toLowerCase();
    const dataBase64 = String(body.dataBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!ASSET_ID_RE.test(assetId)) {
      return errorResponse(request, 400, '无效的图片标识', 'INVALID_ASSET_ID');
    }
    if (!ALLOWED_PHOTO_MIMES.has(mimeType)) {
      return errorResponse(request, 400, '不支持的图片格式', 'INVALID_MIME_TYPE');
    }
    if (!dataBase64 || !/^[A-Za-z0-9+/=]+$/.test(dataBase64)) {
      return errorResponse(request, 400, '图片数据格式无效', 'INVALID_PHOTO_DATA');
    }
    const approxBytes = Math.floor((dataBase64.length * 3) / 4);
    if (approxBytes <= 0 || approxBytes > MAX_PLANNER_PHOTO_BYTES) {
      return errorResponse(request, 413, '单张行程参考图压缩后超过 240KB 上限', 'PHOTO_TOO_LARGE');
    }
    await db
      .prepare(`
        INSERT OR IGNORE INTO planner_photos (asset_id, mime_type, data_base64, byte_size, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(assetId, mimeType, dataBase64, approxBytes, userId, nowIso())
      .run();
    return jsonResponse(request, 200, { ok: true, assetId });
  }

  // POST /api/sync/pull
  if (method === 'POST' && segments[0] === 'pull') {
    const body = await readJsonBody(request, 16384);
    const since = typeof body.since === 'string' && body.since ? body.since : '';

    const recStmt = since
      ? db.prepare('SELECT store_name, record_id, payload_json, updated_at, deleted_at FROM user_records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC').bind(userId, since)
      : db.prepare('SELECT store_name, record_id, payload_json, updated_at, deleted_at FROM user_records WHERE user_id = ? ORDER BY updated_at ASC').bind(userId);
    const recRes = await recStmt.all();

    // 拉取自己拥有 + 所在行程群共享的所有 AI 攻略
    const planStmt = since
      ? db.prepare(`
          SELECT p.*, g.name AS group_name
          FROM ai_plans p
          LEFT JOIN travel_groups g ON g.id = p.group_id
          WHERE (
            p.owner_id = ?
            OR p.group_id IN (SELECT group_id FROM travel_group_members WHERE user_id = ?)
          ) AND p.updated_at > ?
          ORDER BY p.updated_at ASC
        `).bind(userId, userId, since)
      : db.prepare(`
          SELECT p.*, g.name AS group_name
          FROM ai_plans p
          LEFT JOIN travel_groups g ON g.id = p.group_id
          WHERE (
            p.owner_id = ?
            OR p.group_id IN (SELECT group_id FROM travel_group_members WHERE user_id = ?)
          )
          ORDER BY p.updated_at ASC
        `).bind(userId, userId);
    const planRes = await planStmt.all();

    const records = (recRes.results || []).map((row) => ({
      store: row.store_name,
      id: row.record_id,
      payload: row.deleted_at ? null : JSON.parse(row.payload_json),
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null,
    }));

    const aiPlans = (planRes.results || []).map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      groupId: row.group_id || null,
      groupName: row.group_name || '',
      version: Number(row.version || 1),
      updatedBy: row.updated_by,
      updatedByName: row.updated_by_name || '',
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null,
      payload: row.deleted_at ? null : JSON.parse(row.payload_json),
    }));

    const usedBytes = await getUserCloudBytes(db, userId);
    return jsonResponse(request, 200, {
      ok: true,
      serverTime: nowIso(),
      records,
      aiPlans,
      quota: { usedBytes, maxBytes: MAX_USER_CLOUD_BYTES },
    });
  }

  // POST /api/sync/push
  if (method === 'POST' && segments[0] === 'push') {
    const body = await readJsonBody(request, 2 * 1024 * 1024);
    const records = Array.isArray(body.records) ? body.records : [];
    const aiPlans = Array.isArray(body.aiPlans) ? body.aiPlans : [];
    const now = nowIso();

    let currentBytes = await getUserCloudBytes(db, userId);
    const conflicts = [];
    const acceptedPlanVersions = {};

    // 1. 个人纯文本记录同步
    for (const item of records) {
      if (!item || !SYNCABLE_STORES.has(item.store) || !item.id) continue;
      const recordId = String(item.id).slice(0, 128);
      if (item.deleted) {
        await db
          .prepare(`
            INSERT INTO user_records (user_id, store_name, record_id, payload_json, byte_size, updated_at, deleted_at)
            VALUES (?, ?, ?, '{}', 0, ?, ?)
            ON CONFLICT(user_id, store_name, record_id) DO UPDATE SET
              payload_json = '{}', byte_size = 0, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
          `)
          .bind(userId, item.store, recordId, now, now)
          .run();
        continue;
      }

      const payloadJson = JSON.stringify(item.payload ?? {});
      const byteSize = utf8ByteLength(payloadJson);
      if (byteSize > 256 * 1024) {
        return errorResponse(request, 413, `单条记录 ${recordId} 超过 256KB 限制`, 'RECORD_TOO_LARGE');
      }
      if (currentBytes + byteSize > MAX_USER_CLOUD_BYTES) {
        return errorResponse(request, 413, '云端纯文本存储空间已达 3MB 上限，请清理旧数据后再同步', 'QUOTA_EXCEEDED');
      }

      const existing = await db
        .prepare('SELECT byte_size, updated_at FROM user_records WHERE user_id = ? AND store_name = ? AND record_id = ?')
        .bind(userId, item.store, recordId)
        .first();
      const clientUpdated = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : now;
      if (existing && existing.updated_at && existing.updated_at > clientUpdated && !item.force) {
        continue;
      }

      await db
        .prepare(`
          INSERT INTO user_records (user_id, store_name, record_id, payload_json, byte_size, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(user_id, store_name, record_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            byte_size = excluded.byte_size,
            updated_at = excluded.updated_at,
            deleted_at = NULL
        `)
        .bind(userId, item.store, recordId, payloadJson, byteSize, now)
        .run();
      currentBytes += byteSize - Number(existing?.byte_size || 0);
    }

    // 2. AI 攻略同步（含多人协作乐观锁 + 自动记录编辑动态快照）
    for (const planItem of aiPlans) {
      if (!planItem || !planItem.id) continue;
      const planId = String(planItem.id).slice(0, 128);
      const existing = await db.prepare('SELECT * FROM ai_plans WHERE id = ?').bind(planId).first();

      if (planItem.deleted) {
        // 仅攻略所有者 / 群主可删除整份攻略
        if (!existing) continue;
        let canDelete = existing.owner_id === userId;
        if (!canDelete && existing.group_id) {
          const member = await isGroupMember(db, existing.group_id, userId);
          canDelete = member?.role === 'owner';
        }
        if (!canDelete) {
          conflicts.push({ planId, reason: '只有攻略创建者或群主才能删除整份攻略' });
          continue;
        }
        await db
          .prepare('UPDATE ai_plans SET deleted_at = ?, byte_size = 0, updated_by = ?, updated_by_name = ?, updated_at = ? WHERE id = ?')
          .bind(now, userId, auth.user.nickname, now, planId)
          .run();
        continue;
      }

      const sanitized = sanitizeAiPlanPayload(planItem.payload);
      const payloadJson = JSON.stringify(sanitized);
      const byteSize = utf8ByteLength(payloadJson);
      if (byteSize > 512 * 1024) {
        return errorResponse(request, 413, '单份攻略纯文本超过 512KB 限制', 'PLAN_TOO_LARGE');
      }

      if (!existing) {
        const countRow = await db.prepare('SELECT COUNT(*) AS cnt FROM ai_plans WHERE owner_id = ? AND deleted_at IS NULL').bind(userId).first();
        if (Number(countRow?.cnt || 0) >= MAX_USER_PLANS) {
          return errorResponse(request, 413, `云端最多保存 ${MAX_USER_PLANS} 份攻略`, 'PLAN_LIMIT_EXCEEDED');
        }
        if (currentBytes + byteSize > MAX_USER_CLOUD_BYTES) {
          return errorResponse(request, 413, '云端存储已达 3MB 上限', 'QUOTA_EXCEEDED');
        }
        const groupId = planItem.groupId || null;
        if (groupId) {
          const member = await isGroupMember(db, groupId, userId);
          if (!member) return errorResponse(request, 403, '你不在目标行程群中', 'FORBIDDEN');
        }
        await db
          .prepare(`
            INSERT INTO ai_plans (id, owner_id, group_id, title, destination, payload_json, byte_size, version, updated_by, updated_by_name, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
          `)
          .bind(
            planId,
            userId,
            groupId,
            String(sanitized?.content?.title || sanitized?.title || '').slice(0, 120),
            String(sanitized?.content?.request?.destination || '').slice(0, 80),
            payloadJson,
            byteSize,
            userId,
            auth.user.nickname,
            now,
          )
          .run();
        await db
          .prepare('INSERT INTO ai_plan_revisions (id, plan_id, version, editor_id, editor_nickname, summary, snapshot_json, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)')
          .bind(createId('rev'), planId, userId, auth.user.nickname, '上传了这份攻略', payloadJson, now)
          .run();
        acceptedPlanVersions[planId] = 1;
        currentBytes += byteSize;
        continue;
      }

      // 已有攻略：检查权限（所有者或所属群成员）
      let allowed = existing.owner_id === userId;
      if (!allowed && existing.group_id) {
        const member = await isGroupMember(db, existing.group_id, userId);
        allowed = Boolean(member);
      }
      if (!allowed) {
        conflicts.push({ planId, reason: '无权修改该攻略' });
        continue;
      }

      // 乐观锁：若携带 baseVersion 且落后于云端版本，返回冲突供前端拉取最新
      const baseVersion = typeof planItem.baseVersion === 'number' ? planItem.baseVersion : null;
      if (baseVersion !== null && baseVersion < Number(existing.version) && !planItem.force) {
        conflicts.push({
          planId,
          reason: `${existing.updated_by_name || '同伴'} 刚刚更新了这份攻略`,
          serverVersion: Number(existing.version),
          serverUpdatedAt: existing.updated_at,
          serverPayload: existing.deleted_at ? null : JSON.parse(existing.payload_json),
        });
        continue;
      }

      // 内容无实质变化则跳过写入
      if (!existing.deleted_at && existing.payload_json === payloadJson) {
        acceptedPlanVersions[planId] = Number(existing.version);
        continue;
      }

      const prevPlan = existing.deleted_at ? null : JSON.parse(existing.payload_json);
      const nextVersion = Number(existing.version || 0) + 1;
      const summary = String(planItem.summary || '').trim().slice(0, 120) || summarizePlanChange(prevPlan, sanitized);

      await db
        .prepare(`
          UPDATE ai_plans
          SET title = ?, destination = ?, payload_json = ?, byte_size = ?, version = ?,
              updated_by = ?, updated_by_name = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?
        `)
        .bind(
          String(sanitized?.title || '').slice(0, 120),
          String(sanitized?.content?.request?.destination || '').slice(0, 80),
          payloadJson,
          byteSize,
          nextVersion,
          userId,
          auth.user.nickname,
          now,
          planId,
        )
        .run();

      await db
        .prepare('INSERT INTO ai_plan_revisions (id, plan_id, version, editor_id, editor_nickname, summary, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(createId('rev'), planId, nextVersion, userId, auth.user.nickname, summary, payloadJson, now)
        .run();
      await pruneOldRevisions(db, planId);

      // 如果是行程群共享攻略，通知其他群成员
      if (existing.group_id) {
        const membersRes = await db
          .prepare('SELECT user_id FROM travel_group_members WHERE group_id = ? AND user_id != ?')
          .bind(existing.group_id, userId)
          .all();
        for (const m of membersRes.results || []) {
          await createNotification(db, {
            userId: m.user_id,
            type: 'plan_edited',
            actorId: userId,
            actorNickname: auth.user.nickname,
            title: `${auth.user.nickname} 更新了同行攻略`,
            body: `《${sanitized?.title || '未命名攻略'}》：${summary}`,
            targetRef: { planId, groupId: existing.group_id },
          });
        }
      }

      acceptedPlanVersions[planId] = nextVersion;
      currentBytes += byteSize - Number(existing.byte_size || 0);
    }

    return jsonResponse(request, 200, {
      ok: true,
      serverTime: now,
      acceptedPlanVersions,
      conflicts,
      quota: { usedBytes: await getUserCloudBytes(db, userId), maxBytes: MAX_USER_CLOUD_BYTES },
    });
  }

  // /api/sync/plans/:planId/...
  if (segments[0] === 'plans' && segments[1]) {
    const planId = segments[1];
    const sub = segments[2] || '';
    const access = await canAccessPlan(db, planId, userId);
    if (!access) {
      return errorResponse(request, 404, '未找到该攻略或无访问权限', 'PLAN_NOT_FOUND');
    }

    // GET /api/sync/plans/:id/revisions
    if (method === 'GET' && sub === 'revisions') {
      const res = await db
        .prepare('SELECT id, version, editor_id, editor_nickname, summary, created_at FROM ai_plan_revisions WHERE plan_id = ? ORDER BY version DESC LIMIT 20')
        .bind(planId)
        .all();
      return jsonResponse(request, 200, {
        ok: true,
        currentVersion: Number(access.plan.version || 1),
        revisions: (res.results || []).map((r) => ({
          id: r.id,
          version: Number(r.version),
          editorId: r.editor_id,
          editorNickname: r.editor_nickname,
          summary: r.summary,
          createdAt: r.created_at,
        })),
      });
    }

    // POST /api/sync/plans/:id/revert
    if (method === 'POST' && sub === 'revert') {
      const body = await readJsonBody(request, 4096);
      const revisionId = String(body.revisionId || '');
      const rev = await db
        .prepare('SELECT * FROM ai_plan_revisions WHERE id = ? AND plan_id = ?')
        .bind(revisionId, planId)
        .first();
      if (!rev) return errorResponse(request, 404, '未找到目标历史版本', 'REVISION_NOT_FOUND');

      const restored = JSON.parse(rev.snapshot_json);
      const nextVersion = Number(access.plan.version || 1) + 1;
      const now = nowIso();
      const summary = `回退到 v${rev.version}（${rev.editor_nickname} 的版本）`;
      await db
        .prepare(`
          UPDATE ai_plans
          SET title = ?, destination = ?, payload_json = ?, byte_size = ?, version = ?,
              updated_by = ?, updated_by_name = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(
          String(restored?.title || '').slice(0, 120),
          String(restored?.content?.request?.destination || '').slice(0, 80),
          rev.snapshot_json,
          utf8ByteLength(rev.snapshot_json),
          nextVersion,
          userId,
          auth.user.nickname,
          now,
          planId,
        )
        .run();
      await db
        .prepare('INSERT INTO ai_plan_revisions (id, plan_id, version, editor_id, editor_nickname, summary, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(createId('rev'), planId, nextVersion, userId, auth.user.nickname, summary, rev.snapshot_json, now)
        .run();
      await pruneOldRevisions(db, planId);

      return jsonResponse(request, 200, {
        ok: true,
        version: nextVersion,
        payload: restored,
        summary,
      });
    }

    // POST /api/sync/plans/:id/bind-group (绑定已有群或自动新建行程群)
    if (method === 'POST' && sub === 'bind-group') {
      const body = await readJsonBody(request, 8192);
      if (access.plan.owner_id !== userId && access.role !== 'owner') {
        return errorResponse(request, 403, '仅攻略创建者可更改绑定的行程群', 'FORBIDDEN');
      }
      let targetGroupId = body.groupId ? String(body.groupId) : null;
      let targetGroupName = '';

      if (body.createNew) {
        targetGroupId = createId('grp');
        targetGroupName = String(body.groupName || access.plan.title || '同游小队').trim().slice(0, 40);
        const now = nowIso();
        await db
          .prepare('INSERT INTO travel_groups (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(targetGroupId, targetGroupName, userId, generateShortCode(8), now, now)
          .run();
        await db
          .prepare('INSERT INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)')
          .bind(targetGroupId, userId, now)
          .run();
        const inviteIds = Array.isArray(body.memberUserIds) ? body.memberUserIds : [];
        for (const mId of inviteIds) {
          if (!mId || mId === userId) continue;
          await db
            .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
            .bind(targetGroupId, String(mId), now)
            .run();
          await createNotification(db, {
            userId: String(mId),
            type: 'group_invite',
            actorId: userId,
            actorNickname: auth.user.nickname,
            title: `${auth.user.nickname} 邀请你加入行程群「${targetGroupName}」`,
            body: `你们现在可以一起编辑《${access.plan.title || '旅行攻略'}》了`,
            targetRef: { groupId: targetGroupId, planId },
          });
        }
      } else if (targetGroupId) {
        const member = await isGroupMember(db, targetGroupId, userId);
        if (!member) return errorResponse(request, 403, '你不是该行程群的成员', 'FORBIDDEN');
        const grp = await db.prepare('SELECT name FROM travel_groups WHERE id = ?').bind(targetGroupId).first();
        targetGroupName = grp?.name || '';
        const membersRes = await db
          .prepare('SELECT user_id FROM travel_group_members WHERE group_id = ? AND user_id != ?')
          .bind(targetGroupId, userId)
          .all();
        for (const m of membersRes.results || []) {
          await createNotification(db, {
            userId: m.user_id,
            type: 'plan_received',
            actorId: userId,
            actorNickname: auth.user.nickname,
            title: `${auth.user.nickname} 在群「${targetGroupName}」关联了新行程`,
            body: `《${access.plan.title || '旅行攻略'}》已加入群内，全员可共同编辑`,
            targetRef: { groupId: targetGroupId, planId },
          });
        }
      }

      await db
        .prepare('UPDATE ai_plans SET group_id = ?, updated_at = ? WHERE id = ?')
        .bind(targetGroupId, nowIso(), planId)
        .run();
      return jsonResponse(request, 200, { ok: true, groupId: targetGroupId, groupName: targetGroupName });
    }

    // GET /api/sync/plans/:id/collab (获取群内景点/餐厅小投票与留言批注)
    if (method === 'GET' && sub === 'collab') {
      const votesRes = await db
        .prepare(`
          SELECT v.item_key, v.user_id, v.vote, v.updated_at, u.nickname
          FROM plan_votes v
          JOIN users u ON u.id = v.user_id
          WHERE v.plan_id = ?
        `)
        .bind(planId)
        .all();
      const commentsRes = await db
        .prepare('SELECT id, item_key, user_id, author_nickname, content, created_at FROM plan_comments WHERE plan_id = ? ORDER BY created_at ASC LIMIT 200')
        .bind(planId)
        .all();
      return jsonResponse(request, 200, {
        ok: true,
        votes: (votesRes.results || []).map((v) => ({
          itemKey: v.item_key,
          userId: v.user_id,
          nickname: v.nickname,
          vote: v.vote,
          updatedAt: v.updated_at,
        })),
        comments: (commentsRes.results || []).map((c) => ({
          id: c.id,
          itemKey: c.item_key,
          userId: c.user_id,
          authorNickname: c.author_nickname,
          content: c.content,
          createdAt: c.created_at,
        })),
      });
    }

    // POST /api/sync/plans/:id/vote
    if (method === 'POST' && sub === 'vote') {
      const body = await readJsonBody(request, 4096);
      const itemKey = String(body.itemKey || '').trim().slice(0, 120);
      const vote = String(body.vote || '').trim();
      if (!itemKey) return errorResponse(request, 400, '缺少景点/条目 ID', 'MISSING_ITEM');
      if (!vote) {
        await db.prepare('DELETE FROM plan_votes WHERE plan_id = ? AND item_key = ? AND user_id = ?').bind(planId, itemKey, userId).run();
        return jsonResponse(request, 200, { ok: true, vote: null });
      }
      if (!['want', 'backup', 'skip'].includes(vote)) {
        return errorResponse(request, 400, '无效的投票选项', 'INVALID_VOTE');
      }
      await db
        .prepare(`
          INSERT INTO plan_votes (plan_id, item_key, user_id, vote, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(plan_id, item_key, user_id) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at
        `)
        .bind(planId, itemKey, userId, vote, nowIso())
        .run();
      return jsonResponse(request, 200, { ok: true, vote });
    }

    // POST /api/sync/plans/:id/comment
    if (method === 'POST' && sub === 'comment') {
      const body = await readJsonBody(request, 4096);
      const itemKey = String(body.itemKey || '').trim().slice(0, 120);
      const content = String(body.content || '').trim().slice(0, 280);
      if (!itemKey || !content) return errorResponse(request, 400, '请输入批注内容', 'EMPTY_COMMENT');
      const commentId = createId('cmt');
      const now = nowIso();
      await db
        .prepare('INSERT INTO plan_comments (id, plan_id, item_key, user_id, author_nickname, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(commentId, planId, itemKey, userId, auth.user.nickname, content, now)
        .run();
      return jsonResponse(request, 201, {
        ok: true,
        comment: {
          id: commentId,
          itemKey,
          userId,
          authorNickname: auth.user.nickname,
          content,
          createdAt: now,
        },
      });
    }

    // DELETE /api/sync/plans/:id/comment/:commentId
    if (method === 'DELETE' && sub === 'comment' && segments[3]) {
      const commentId = segments[3];
      const existing = await db.prepare('SELECT user_id FROM plan_comments WHERE id = ? AND plan_id = ?').bind(commentId, planId).first();
      if (!existing) return errorResponse(request, 404, '未找到该批注', 'NOT_FOUND');
      if (existing.user_id !== userId && access.role !== 'owner') {
        return errorResponse(request, 403, '仅本人或群主可删除批注', 'FORBIDDEN');
      }
      await db.prepare('DELETE FROM plan_comments WHERE id = ?').bind(commentId).run();
      return jsonResponse(request, 200, { ok: true });
    }
  }

  return errorResponse(request, 404, '未找到对应的同步接口', 'NOT_FOUND');
});
