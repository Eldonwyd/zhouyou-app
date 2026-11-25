import {
  areFriends,
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
  const auth = await requireAuth(db, request);
  const user = auth.user;
  const userAvatar = user.avatar_preset || user.avatar || '';
  const segments = parseRouteSegments(context);
  const method = request.method.toUpperCase();

  // GET /api/chat/dm/:peerId or /api/chat/group/:groupId
  if (method === 'GET' && (segments[0] === 'dm' || segments[0] === 'group') && segments[1]) {
    const roomType = segments[0];
    const targetId = decodeURIComponent(segments[1]);
    if (roomType === 'dm') {
      await assertCanAccessDm(db, user.id, targetId);
    } else {
      await assertCanAccessGroup(db, user.id, targetId);
    }
    const roomId = roomType === 'dm' ? makeDmRoomId(user.id, targetId) : targetId;
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
    const messages = await attachPollVotes(db, res.results || []);
    return jsonResponse(request, 200, { ok: true, messages });
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
    const msgType = ['text', 'image', 'plan', 'invite', 'poll'].includes(String(body.msgType || ''))
      ? String(body.msgType)
      : 'text';
    const textContent = String(body.textContent || '').trim().slice(0, 2000);
    const rawPayload = body.payload && typeof body.payload === 'object' ? body.payload : {};

    if (msgType === 'text' && !textContent) {
      return errorResponse(request, 400, '消息内容不能为空', 'EMPTY_MESSAGE');
    }
    if (msgType === 'image') {
      const dataUrl = String(rawPayload.dataUrl || '');
      if (!dataUrl.startsWith('data:image/') || dataUrl.length > 360 * 1024) {
        return errorResponse(request, 400, '图片格式无效或体积过大（请压缩后发送）', 'INVALID_IMAGE');
      }
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

    // 私聊发攻略/邀请时顺带写入提醒通知，方便对方在消息页看到
    if (roomType === 'dm' && targetId !== user.id && (msgType === 'plan' || msgType === 'invite')) {
      const title =
        msgType === 'plan'
          ? `${user.nickname} 在聊天中发来攻略「${String(rawPayload.title || '旅行计划')}」`
          : `${user.nickname} 邀请你加入行程群「${String(rawPayload.groupName || '行程群')}」`;
      await createNotification(db, {
        userId: targetId,
        type: msgType === 'plan' ? 'plan_received' : 'group_invite',
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
