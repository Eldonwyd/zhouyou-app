import {
  SHARE_TTL_MS,
  canAccessPlan,
  createId,
  createNotification,
  errorResponse,
  generateShortCode,
  getDb,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  sanitizeAiPlanPayload,
  utf8ByteLength,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

function buildPlanSummary(plan) {
  const days = Array.isArray(plan?.content?.days) ? plan.content.days : [];
  const highlights = days.slice(0, 6).map((d, idx) => ({
    day: idx + 1,
    date: d.date || '',
    theme: d.theme || d.city || `第 ${idx + 1} 天`,
    stops: (d.activities || []).slice(0, 4).map((a) => a.title || a.placeName || '').filter(Boolean),
  }));
  return {
    destination: plan?.content?.request?.destination || '',
    startDate: plan?.content?.request?.startDate || '',
    endDate: plan?.content?.request?.endDate || '',
    people: plan?.content?.request?.people || 1,
    daysCount: days.length,
    highlights,
  };
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);

  // GET /api/share/:code (公开预览接口，无需登录)
  if (method === 'GET' && segments.length === 1 && segments[0] !== 'create') {
    const code = String(segments[0] || '').trim().toUpperCase();
    const share = await db.prepare('SELECT * FROM plan_shares WHERE code = ?').bind(code).first();
    if (!share) return errorResponse(request, 404, '分享链接或周游口令不存在', 'SHARE_NOT_FOUND');
    if (Date.parse(share.expires_at) <= Date.now()) {
      return errorResponse(request, 410, '该分享链接已过期', 'SHARE_EXPIRED');
    }
    return jsonResponse(request, 200, {
      ok: true,
      share: {
        code: share.code,
        planId: share.plan_id,
        senderNickname: share.sender_nickname,
        mode: share.mode,
        title: share.title,
        destination: share.destination,
        daysCount: Number(share.days_count || 0),
        summary: (() => { try { return JSON.parse(share.summary_json || '{}'); } catch { return {}; } })(),
        expiresAt: share.expires_at,
        createdAt: share.created_at,
      },
    });
  }

  // 以下接口需登录
  const auth = await requireAuth(db, request);
  const userId = auth.user.id;

  // POST /api/share/create (生成分享链接 / 周游口令 / 直接推送给好友)
  if (method === 'POST' && segments[0] === 'create') {
    const body = await readJsonBody(request, 600 * 1024);
    const mode = body.mode === 'collab' ? 'collab' : 'copy';
    const recipientUserId = body.recipientUserId ? String(body.recipientUserId) : null;
    const planId = String(body.planId || '').trim();
    if (!planId) return errorResponse(request, 400, '缺少要分享的攻略 ID', 'MISSING_PLAN');

    let planPayload = null;
    let groupId = null;

    const access = await canAccessPlan(db, planId, userId);
    if (access) {
      planPayload = JSON.parse(access.plan.payload_json);
      groupId = access.plan.group_id || null;
    } else if (body.planPayload) {
      // 若攻略刚在本地新建尚未同步到云端，允许随分享一起落库
      planPayload = sanitizeAiPlanPayload(body.planPayload);
      const payloadJson = JSON.stringify(planPayload);
      const now = nowIso();
      await db
        .prepare(`
          INSERT OR REPLACE INTO ai_plans (id, owner_id, group_id, title, destination, payload_json, byte_size, version, updated_by, updated_by_name, updated_at, deleted_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
        `)
        .bind(
          planId,
          userId,
          String(planPayload?.title || '').slice(0, 120),
          String(planPayload?.content?.request?.destination || '').slice(0, 80),
          payloadJson,
          utf8ByteLength(payloadJson),
          userId,
          auth.user.nickname,
          now,
        )
        .run();
    } else {
      return errorResponse(request, 404, '未找到该攻略，请先同步后再分享', 'PLAN_NOT_FOUND');
    }

    const now = nowIso();
    // 邀请同游模式：若该攻略尚未绑定行程群，则自动创建一个行程群并绑定
    if (mode === 'collab' && !groupId) {
      groupId = createId('grp');
      const groupName = String(planPayload?.title || '同行小队').slice(0, 40);
      await db
        .prepare('INSERT INTO travel_groups (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(groupId, groupName, userId, generateShortCode(8), now, now)
        .run();
      await db
        .prepare('INSERT INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)')
        .bind(groupId, userId, now)
        .run();
      await db.prepare('UPDATE ai_plans SET group_id = ?, updated_at = ? WHERE id = ?').bind(groupId, now, planId).run();
    }

    const code = generateShortCode(6);
    const summary = buildPlanSummary(planPayload);
    const title = String(planPayload?.content?.title || planPayload?.title || summary.destination || '周游旅行攻略').slice(0, 120);
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();

    await db
      .prepare(`
        INSERT INTO plan_shares (
          code, plan_id, sender_id, sender_nickname, recipient_user_id, mode, group_id,
          title, destination, days_count, summary_json, snapshot_json, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        code,
        planId,
        userId,
        auth.user.nickname,
        recipientUserId,
        mode,
        groupId,
        title,
        summary.destination,
        summary.daysCount,
        JSON.stringify(summary),
        JSON.stringify(planPayload),
        expiresAt,
        now,
      )
      .run();

    if (recipientUserId) {
      await createNotification(db, {
        userId: recipientUserId,
        type: 'plan_received',
        actorId: userId,
        actorNickname: auth.user.nickname,
        title: mode === 'collab'
          ? `${auth.user.nickname} 邀请你同游《${title}》`
          : `${auth.user.nickname} 发给你一份攻略《${title}》`,
        body: mode === 'collab'
          ? '点击加入行程群，与同伴一起编辑行程、投票与 AA 记账'
          : '点击即可保存到「我的攻略」随时查看与修改',
        targetRef: { shareCode: code, planId, mode, groupId },
      });
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/share/${code}`;
    const zhouyouToken = `【周游地图】${auth.user.nickname}${mode === 'collab' ? '邀请你一起同行' : '分享了攻略'}《${title}》${summary.daysCount ? `（${summary.daysCount}天）` : ''}，复制本段文字打开周游地图即可接收 #ZY:${code}#\n直达链接：${shareUrl}`;

    return jsonResponse(request, 201, {
      ok: true,
      code,
      mode,
      groupId,
      shareUrl,
      zhouyouToken,
      expiresAt,
    });
  }

  // POST /api/share/:code/accept (接收副本或加入同游行程群)
  if (method === 'POST' && segments[0] && segments[1] === 'accept') {
    const code = String(segments[0]).trim().toUpperCase();
    const share = await db.prepare('SELECT * FROM plan_shares WHERE code = ?').bind(code).first();
    if (!share) return errorResponse(request, 404, '分享链接或周游口令不存在', 'SHARE_NOT_FOUND');
    if (Date.parse(share.expires_at) <= Date.now()) {
      return errorResponse(request, 410, '该分享已过期', 'SHARE_EXPIRED');
    }

    const now = nowIso();
    if (share.mode === 'collab' && share.group_id) {
      await db
        .prepare('INSERT OR IGNORE INTO travel_group_members (group_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)')
        .bind(share.group_id, userId, now)
        .run();
      const livePlan = await db.prepare('SELECT * FROM ai_plans WHERE id = ? AND deleted_at IS NULL').bind(share.plan_id).first();
      const payload = livePlan ? JSON.parse(livePlan.payload_json) : JSON.parse(share.snapshot_json);
      return jsonResponse(request, 200, {
        ok: true,
        mode: 'collab',
        groupId: share.group_id,
        planId: share.plan_id,
        plan: payload,
        message: '已加入行程群，你现在可以和大家一起编辑这份行程了',
      });
    }

    // 副本模式：复制为接收者自己的独立攻略
    const snapshot = JSON.parse(share.snapshot_json);
    const newPlanId = createId('plan');
    const copied = {
      ...snapshot,
      id: newPlanId,
      title: snapshot.title || share.title,
      createdAt: now,
      updatedAt: now,
    };
    const copiedJson = JSON.stringify(copied);
    await db
      .prepare(`
        INSERT INTO ai_plans (id, owner_id, group_id, title, destination, payload_json, byte_size, version, updated_by, updated_by_name, updated_at, deleted_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
      `)
      .bind(
        newPlanId,
        userId,
        String(copied.title || '').slice(0, 120),
        String(copied?.content?.request?.destination || '').slice(0, 80),
        copiedJson,
        utf8ByteLength(copiedJson),
        userId,
        auth.user.nickname,
        now,
      )
      .run();

    return jsonResponse(request, 200, {
      ok: true,
      mode: 'copy',
      planId: newPlanId,
      plan: copied,
      message: '已保存到你的攻略列表',
    });
  }

  return errorResponse(request, 404, '未找到对应的分享接口', 'NOT_FOUND');
});
