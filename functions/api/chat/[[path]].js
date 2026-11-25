import {
  areFriends,
  corsHeaders,
  createId,
  createNotification,
  errorResponse,
  getDb,
  isGroupMember,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

const ALLOWED_CHAT_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let chatTablesReadyPromise = null;

async function ensureChatTables(db) {
  if (!chatTablesReadyPromise) {
    chatTablesReadyPromise = (async () => {
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            room_type TEXT NOT NULL,
            room_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_nickname TEXT NOT NULL,
            sender_avatar TEXT NOT NULL DEFAULT '',
            msg_type TEXT NOT NULL DEFAULT 'text',
            text_content TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          )
        `)
        .run();
      await db
        .prepare('CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages (room_type, room_id, created_at)')
        .run();
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS chat_poll_votes (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_nickname TEXT NOT NULL DEFAULT '',
            option_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id, option_id)
          )
        `)
        .run();
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS chat_images (
            id TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL,
            data_base64 TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            uploader_id TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `)
        .run();
    })().catch((err) => {
      chatTablesReadyPromise = null;
      throw err;
    });
  }
  return chatTablesReadyPromise;
}

function makeDmRoomId(userA, userB) {
  return [String(userA), String(userB)].sort().join(':');
}

async function assertCanAccessDm(db, userId, peerId) {
  if (!peerId) throw Object.assign(new Error('缺少好友 ID'), { status: 400, code: 'BAD_PEER' });
  if (peerId === userId) return;
  const ok = await areFriends(db, userId, peerId);
  if (!ok) {
    throw Object.assign(new Error('你们还不是好友，添加好友后即可聊天'), { status: 403, code: 'NOT_FRIENDS' });
  }
}

async function assertCanAccessGroup(db, userId, groupId) {
  if (!groupId) throw Object.assign(new Error('缺少行程群 ID'), { status: 400, code: 'BAD_GROUP' });
  const member = await isGroupMember(db, groupId, userId);
  if (!member) {
    throw Object.assign(new Error('你不在该行程群中'), { status: 403, code: 'NOT_GROUP_MEMBER' });
  }
}

async function attachPollVotes(db, rows) {
  const pollIds = rows.filter((r) => r.msg_type === 'poll').map((r) => r.id);
  const votesByMsg = new Map();
  if (pollIds.length > 0) {
    const placeholders = pollIds.map(() => '?').join(', ');
    const res = await db
      .prepare(`SELECT message_id, user_id, user_nickname, option_id, created_at FROM chat_poll_votes WHERE message_id IN (${placeholders})`)
      .bind(...pollIds)
      .all();
    for (const v of res.results || []) {
      const list = votesByMsg.get(v.message_id) || [];
      list.push({
        userId: v.user_id,
        userNickname: v.user_nickname,
        optionId: v.option_id,
        createdAt: v.created_at,
      });
      votesByMsg.set(v.message_id, list);
    }
  }
  return rows.map((r) => {
    let payload = {};
    try {
      payload = JSON.parse(r.payload_json || '{}');
    } catch {
      payload = {};
    }
    return {
      id: r.id,
      roomType: r.room_type,
      roomId: r.room_id,
      senderId: r.sender_id,
      senderNickname: r.sender_nickname,
      senderAvatar: r.sender_avatar || '',
      msgType: r.msg_type,
      textContent: r.text_content || '',
      payload,
      pollVotes: r.msg_type === 'poll' ? (votesByMsg.get(r.id) || []) : undefined,
      createdAt: r.created_at,
    };
  });
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const db = getDb(context);
  await ensureChatTables(db);
  const segments = parseRouteSegments(context);
  const method = request.method.toUpperCase();

  // GET /api/chat/image/:imageId — 聊天图片独立强缓存端点（避免轮询消息列表重复传输 Base64）
  if (method === 'GET' && segments[0] === 'image' && segments[1] && segments.length === 2) {
    const imageId = String(segments[1]).trim();
    if (!/^[a-z0-9_-]{8,64}$/i.test(imageId)) {
      return errorResponse(request, 400, '无效的图片标识', 'INVALID_IMAGE_ID');
    }
    const row = await db
      .prepare('SELECT mime_type, data_base64 FROM chat_images WHERE id = ?')
      .bind(imageId)
      .first();
    if (!row || !row.data_base64) {
      return errorResponse(request, 404, '图片不存在', 'IMAGE_NOT_FOUND');
    }
    const bytes = decodeBase64ToBytes(row.data_base64);
    const cors = corsHeaders(request);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': ALLOWED_CHAT_IMAGE_MIMES.has(row.mime_type) ? row.mime_type : 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const auth = await requireAuth(db, request, context);
  const user = auth.user;
  const userAvatar = user.avatar_preset || user.avatar || '';

  // GET /api/chat/dm/:peerId or /api/chat/group/:groupId（支持 ?after=<iso> 增量拉取与 ?pollIds=... 同步票数）
  if (method === 'GET' && (segments[0] === 'dm' || segments[0] === 'group') && segments[1]) {
    const roomType = segments[0];
    const targetId = decodeURIComponent(segments[1]);
    if (roomType === 'dm') {
      await assertCanAccessDm(db, user.id, targetId);
    } else {
      await assertCanAccessGroup(db, user.id, targetId);
    }
    const roomId = roomType === 'dm' ? makeDmRoomId(user.id, targetId) : targetId;
    const url = new URL(request.url);
    const after = String(url.searchParams.get('after') || '').trim();
    const rawPollIds = String(url.searchParams.get('pollIds') || '').trim();

    let rows = [];
    if (after) {
      const res = await db
        .prepare(
          `SELECT * FROM chat_messages
           WHERE room_type = ? AND room_id = ? AND created_at > ?
           ORDER BY created_at ASC
           LIMIT 80`,
        )
        .bind(roomType, roomId, after)
        .all();
      rows = res.results || [];
    } else {
      const res = await db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM chat_messages
             WHERE room_type = ? AND room_id = ?
             ORDER BY created_at DESC
             LIMIT 80
           ) ORDER BY created_at ASC`,
        )
        .bind(roomType, roomId)
        .all();
      rows = res.results || [];
    }

    const messages = await attachPollVotes(db, rows);

    let pollUpdates;
    if (after && rawPollIds) {
      const pollIds = rawPollIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^[a-z0-9_-]{4,64}$/i.test(id))
        .slice(0, 20);
      if (pollIds.length > 0) {
        const placeholders = pollIds.map(() => '?').join(', ');
        const voteRes = await db
          .prepare(`SELECT message_id, user_id, user_nickname, option_id, created_at FROM chat_poll_votes WHERE message_id IN (${placeholders})`)
          .bind(...pollIds)
          .all();
        pollUpdates = Object.fromEntries(pollIds.map((id) => [id, []]));
        for (const v of voteRes.results || []) {
          if (!pollUpdates[v.message_id]) pollUpdates[v.message_id] = [];
          pollUpdates[v.message_id].push({
            userId: v.user_id,
            userNickname: v.user_nickname,
            optionId: v.option_id,
            createdAt: v.created_at,
          });
        }
      }
    }

    return jsonResponse(request, 200, {
      ok: true,
      incremental: Boolean(after),
      messages,
      ...(pollUpdates ? { pollUpdates } : {}),
    });
  }

  // POST /api/chat/dm/:peerId or /api/chat/group/:groupId
  if (method === 'POST' && (segments[0] === 'dm' || segments[0] === 'group') && segments[1]) {
    const roomType = segments[0];
    const targetId = decodeURIComponent(segments[1]);
    if (roomType === 'dm') {
      await assertCanAccessDm(db, user.id, targetId);
    } else {
      await assertCanAccessGroup(db, user.id, targetId);
    }
    // 允许压缩后的图片（base64 最大约 360KB）
    const body = await readJsonBody(request, 420 * 1024);
    const msgType = ['text', 'image', 'plan', 'invite', 'poll', 'intimacy', 'packing', 'reminder'].includes(String(body.msgType || ''))
      ? String(body.msgType)
      : 'text';
    const textContent = String(body.textContent || '').trim().slice(0, 2000);
    const rawPayload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    if (msgType === 'text' && !textContent) {
      return errorResponse(request, 400, '消息内容不能为空', 'EMPTY_MESSAGE');
    }
    if (msgType === 'image') {
      const dataUrl = String(rawPayload.dataUrl || '');
      const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
      if (!match || dataUrl.length > 360 * 1024) {
        return errorResponse(request, 400, '图片格式无效或体积过大（请压缩后发送）', 'INVALID_IMAGE');
      }
      const mimeType = match[1].toLowerCase();
      const base64Data = match[2];
      if (!ALLOWED_CHAT_IMAGE_MIMES.has(mimeType)) {
        return errorResponse(request, 400, '暂不支持该图片格式', 'INVALID_IMAGE');
      }
      const imageId = createId('cimg');
      const approxBytes = Math.floor((base64Data.length * 3) / 4);
      await db
        .prepare('INSERT INTO chat_images (id, mime_type, data_base64, byte_size, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(imageId, mimeType, base64Data, approxBytes, user.id, nowIso())
        .run();
      delete rawPayload.dataUrl;
      rawPayload.imageId = imageId;
      rawPayload.imageUrl = `/api/chat/image/${imageId}`;
    }
    if (msgType === 'poll') {
      const question = String(rawPayload.question || '').trim();
      const options = Array.isArray(rawPayload.options)
        ? rawPayload.options
            .map((o, idx) => ({
              id: String(o?.id || `opt_${idx + 1}`),
              label: String(o?.label || o || '').trim().slice(0, 80),
            }))
            .filter((o) => o.label)
            .slice(0, 8)
        : [];
      if (!question || options.length < 2) {
        return errorResponse(request, 400, '投票需要填写标题和至少 2 个选项', 'INVALID_POLL');
      }
      rawPayload.question = question.slice(0, 120);
      rawPayload.options = options;
      rawPayload.multi = Boolean(rawPayload.multi);
    }

    const roomId = roomType === 'dm' ? makeDmRoomId(user.id, targetId) : targetId;
    const id = createId('msg');
    const createdAt = nowIso();
    const payloadJson = JSON.stringify(rawPayload);

    await db
      .prepare(
        `INSERT INTO chat_messages (
          id, room_type, room_id, sender_id, sender_nickname, sender_avatar,
          msg_type, text_content, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        roomType,
        roomId,
        user.id,
        user.nickname || '旅伴',
        userAvatar,
        msgType,
        textContent,
        payloadJson,
        createdAt,
      )
      .run();

    // 私聊发攻略/邀请/行前清单/出行提醒时顺带写入提醒通知，方便对方在消息页与弹窗看到
    if (
      roomType === 'dm'
      && targetId !== user.id
      && (msgType === 'plan' || msgType === 'invite' || msgType === 'packing' || msgType === 'reminder')
    ) {
      const title =
        msgType === 'plan'
          ? `${user.nickname} 在聊天中发来攻略「${String(rawPayload.title || '旅行计划')}」`
          : msgType === 'invite'
            ? `${user.nickname} 邀请你加入行程群「${String(rawPayload.groupName || '行程群')}」`
            : msgType === 'packing'
              ? `${user.nickname} 发来行前准备清单「${String(rawPayload.title || '行前清单')}」`
              : `${user.nickname} 发来出行提醒「${String(rawPayload.title || '出行提醒')}」`;
      const notifType =
        msgType === 'plan'
          ? 'plan_received'
          : msgType === 'invite'
            ? 'group_invite'
            : msgType === 'packing'
              ? 'packing_reminder'
              : 'trip_reminder';
      await createNotification(db, {
        userId: targetId,
        type: notifType,
        actorId: user.id,
        actorNickname: user.nickname,
        title,
        body: textContent || '点击立即查看详情',
        targetRef: {
          ...(rawPayload.shareCode ? { shareCode: String(rawPayload.shareCode) } : {}),
          ...(rawPayload.planId ? { planId: String(rawPayload.planId) } : {}),
          ...(rawPayload.groupId ? { groupId: String(rawPayload.groupId) } : {}),
        },
      }).catch(() => undefined);
    }

    // 普通私聊文字/图片/投票消息也写入（或合并更新）一条未读提醒，确保对方不在聊天页也能及时收到红点与通知
    if (
      roomType === 'dm'
      && targetId !== user.id
      && (msgType === 'text' || msgType === 'image' || msgType === 'poll')
    ) {
      try {
        const previewBody =
          msgType === 'image'
            ? '[图片]'
            : msgType === 'poll'
              ? `发起投票：${String(rawPayload.question || '投票')}`
              : textContent.slice(0, 80);
        const existingNotif = await db
          .prepare(
            `SELECT id FROM notifications
             WHERE user_id = ? AND actor_id = ? AND type = 'chat_message' AND read_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
          )
          .bind(targetId, user.id)
          .first();
        if (existingNotif?.id) {
          await db
            .prepare('UPDATE notifications SET title = ?, body = ?, created_at = ? WHERE id = ?')
            .bind(`${user.nickname || '旅伴'} 发来新消息`, previewBody, createdAt, existingNotif.id)
            .run();
        } else {
          await createNotification(db, {
            userId: targetId,
            type: 'chat_message',
            actorId: user.id,
            actorNickname: user.nickname || '旅伴',
            title: `${user.nickname || '旅伴'} 发来新消息`,
            body: previewBody,
            targetRef: { dmPeerId: user.id },
          });
        }
      } catch { /* ignore notification error */ }
    }

    // 群聊发行前准备清单或出行提醒时，给群内其他成员发送通知提醒
    if (roomType === 'group' && (msgType === 'packing' || msgType === 'reminder')) {
      try {
        const [groupRow, membersRes] = await Promise.all([
          db.prepare('SELECT name FROM travel_groups WHERE id = ? LIMIT 1').bind(targetId).first(),
          db.prepare('SELECT user_id FROM travel_group_members WHERE group_id = ? AND user_id != ?').bind(targetId, user.id).all(),
        ]);
        const groupName = String(groupRow?.name || '行程群');
        const label = msgType === 'packing' ? '行前准备清单' : '出行提醒';
        const notifTitle = `${user.nickname} 在「${groupName}」发来${label}`;
        const notifBody = textContent || String(rawPayload.title || '点击查看详情');
        const members = membersRes.results || [];
        await Promise.all(
          members.map((m) =>
            createNotification(db, {
              userId: String(m.user_id),
              type: msgType === 'packing' ? 'packing_reminder' : 'trip_reminder',
              actorId: user.id,
              actorNickname: user.nickname,
              title: notifTitle,
              body: notifBody,
              targetRef: {
                groupId: targetId,
                ...(rawPayload.planId ? { planId: String(rawPayload.planId) } : {}),
              },
            }).catch(() => undefined),
          ),
        );
      } catch { /* ignore notification fanout error */ }
    }

    return jsonResponse(request, 200, {
      ok: true,
      message: {
        id,
        roomType,
        roomId,
        senderId: user.id,
        senderNickname: user.nickname || '旅伴',
        senderAvatar: userAvatar,
        msgType,
        textContent,
        payload: rawPayload,
        pollVotes: msgType === 'poll' ? [] : undefined,
        createdAt,
      },
    });
  }

  // POST /api/chat/poll/:messageId/vote
  if (method === 'POST' && segments[0] === 'poll' && segments[1] && segments[2] === 'vote') {
    const messageId = decodeURIComponent(segments[1]);
    const body = await readJsonBody(request, 4096);
    const optionId = String(body.optionId || '').trim();
    if (!optionId) return errorResponse(request, 400, '缺少选项 ID', 'BAD_OPTION');

    const msg = await db
      .prepare('SELECT * FROM chat_messages WHERE id = ? AND msg_type = ? LIMIT 1')
      .bind(messageId, 'poll')
      .first();
    if (!msg) return errorResponse(request, 404, '投票不存在', 'POLL_NOT_FOUND');

    if (msg.room_type === 'group') {
      await assertCanAccessGroup(db, user.id, msg.room_id);
    } else if (!String(msg.room_id).split(':').includes(user.id)) {
      return errorResponse(request, 403, '无权参与该投票', 'FORBIDDEN');
    }

    let payload = {};
    try { payload = JSON.parse(msg.payload_json || '{}'); } catch { payload = {}; }
    const isMulti = Boolean(payload.multi);

    const existing = await db
      .prepare('SELECT 1 FROM chat_poll_votes WHERE message_id = ? AND user_id = ? AND option_id = ?')
      .bind(messageId, user.id, optionId)
      .first();

    if (existing) {
      await db
        .prepare('DELETE FROM chat_poll_votes WHERE message_id = ? AND user_id = ? AND option_id = ?')
        .bind(messageId, user.id, optionId)
        .run();
    } else {
      if (!isMulti) {
        await db
          .prepare('DELETE FROM chat_poll_votes WHERE message_id = ? AND user_id = ?')
          .bind(messageId, user.id)
          .run();
      }
      await db
        .prepare(
          'INSERT OR REPLACE INTO chat_poll_votes (message_id, user_id, user_nickname, option_id, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(messageId, user.id, user.nickname || '旅伴', optionId, nowIso())
        .run();
    }

    const res = await db
      .prepare('SELECT user_id, user_nickname, option_id, created_at FROM chat_poll_votes WHERE message_id = ?')
      .bind(messageId)
      .all();
    return jsonResponse(request, 200, {
      ok: true,
      pollVotes: (res.results || []).map((v) => ({
        userId: v.user_id,
        userNickname: v.user_nickname,
        optionId: v.option_id,
        createdAt: v.created_at,
      })),
    });
  }

  return errorResponse(request, 404, '未找到对应的聊天接口', 'NOT_FOUND');
});
