import {
  MAX_USER_CLOUD_BYTES,
  MAP_VISIBILITIES,
  SECURITY_QUESTIONS,
  checkRateLimit,
  createId,
  createSession,
  errorResponse,
  formatSelfUser,
  generateFriendCode,
  getClientIp,
  getDb,
  getUserCloudBytes,
  hashSecret,
  jsonResponse,
  normalizeEmail,
  normalizeNickname,
  normalizePhone,
  normalizeSecurityAnswer,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  verifySecret,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

async function allocateFriendCode(db) {
  for (let i = 0; i < 12; i += 1) {
    const code = generateFriendCode();
    const exists = await db.prepare('SELECT id FROM users WHERE friend_code = ?').bind(code).first();
    if (!exists) return code;
  }
  return `ZY-${createId('').slice(-6).toUpperCase()}`;
}

async function findUserByIdentifier(db, rawIdentifier) {
  const value = String(rawIdentifier || '').trim();
  if (!value) return null;
  if (value.includes('@')) {
    const email = normalizeEmail(value);
    if (!email) return null;
    return db.prepare('SELECT * FROM users WHERE email_norm = ?').bind(email).first();
  }
  const phone = normalizePhone(value);
  if (!phone) return null;
  return db.prepare('SELECT * FROM users WHERE phone_norm = ?').bind(phone).first();
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const action = segments[0] || '';
  const db = getDb(context);
  const ip = getClientIp(request);

  // GET /api/auth/questions
  if (method === 'GET' && action === 'questions') {
    return jsonResponse(request, 200, { ok: true, questions: SECURITY_QUESTIONS });
  }

  // POST /api/auth/check-nickname
  if (method === 'POST' && action === 'check-nickname') {
    const body = await readJsonBody(request, 8192);
    const parsed = normalizeNickname(body.nickname);
    if (!parsed) {
      return jsonResponse(request, 200, { ok: true, available: false, reason: '昵称需为 2-18 个字符，不含特殊符号' });
    }
    const existing = await db.prepare('SELECT id FROM users WHERE nickname_norm = ?').bind(parsed.norm).first();
    const excludeUserId = String(body.excludeUserId || '');
    const available = !existing || (excludeUserId && existing.id === excludeUserId);
    return jsonResponse(request, 200, {
      ok: true,
      available,
      reason: available ? '' : '这个昵称已经被占用，换一个试试',
    });
  }

  // POST /api/auth/register
  if (method === 'POST' && action === 'register') {
    const rl = await checkRateLimit(db, `reg:${ip}`, 12, 3600);
    if (!rl.allowed) {
      return errorResponse(request, 429, `操作过于频繁，请 ${rl.retryAfter} 秒后再试`, 'RATE_LIMITED');
    }
    const body = await readJsonBody(request, 16384);
    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    if (body.phone && phone === null) {
      return errorResponse(request, 400, '请输入正确的 11 位中国大陆手机号', 'INVALID_PHONE');
    }
    if (body.email && email === null) {
      return errorResponse(request, 400, '请输入正确的邮箱地址', 'INVALID_EMAIL');
    }
    if (!phone && !email) {
      return errorResponse(request, 400, '请填写手机号或邮箱作为登录账号', 'MISSING_ACCOUNT');
    }

    const password = String(body.password || '');
    if (password.length < 6 || password.length > 72) {
      return errorResponse(request, 400, '密码长度需在 6 到 72 位之间', 'INVALID_PASSWORD');
    }

    const nicknameParsed = normalizeNickname(body.nickname);
    if (!nicknameParsed) {
      return errorResponse(request, 400, '请设置 2-18 位有效昵称（不含特殊引号或斜杠）', 'INVALID_NICKNAME');
    }

    const securityQuestion = String(body.securityQuestion || '').trim();
    const securityAnswerNorm = normalizeSecurityAnswer(body.securityAnswer);
    if (!securityQuestion || securityQuestion.length > 80) {
      return errorResponse(request, 400, '请选择或填写 1 个密保问题（用于忘记密码找回）', 'MISSING_SECURITY_QUESTION');
    }
    if (securityAnswerNorm.length < 1 || securityAnswerNorm.length > 80) {
      return errorResponse(request, 400, '请填写密保问题答案', 'MISSING_SECURITY_ANSWER');
    }

    if (phone) {
      const dupPhone = await db.prepare('SELECT id FROM users WHERE phone_norm = ?').bind(phone).first();
      if (dupPhone) return errorResponse(request, 409, '该手机号已注册，请直接登录', 'PHONE_EXISTS');
    }
    if (email) {
      const dupEmail = await db.prepare('SELECT id FROM users WHERE email_norm = ?').bind(email).first();
      if (dupEmail) return errorResponse(request, 409, '该邮箱已注册，请直接登录', 'EMAIL_EXISTS');
    }
    const dupNick = await db.prepare('SELECT id FROM users WHERE nickname_norm = ?').bind(nicknameParsed.norm).first();
    if (dupNick) {
      return errorResponse(request, 409, '该昵称已被占用，请换一个独特昵称', 'NICKNAME_EXISTS');
    }

    const userId = createId('usr');
    const friendCode = await allocateFriendCode(db);
    const pwd = await hashSecret(password);
    const sec = await hashSecret(securityAnswerNorm);
    const now = nowIso();
    const avatarPreset = String(body.avatar || 'bear').slice(0, 32);

    await db
      .prepare(`
        INSERT INTO users (
          id, phone_norm, email_norm, password_hash, password_salt,
          security_question, security_answer_hash, security_answer_salt,
          nickname, nickname_norm, friend_code, avatar_preset, motto, map_visibility,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'friends', ?, ?)
      `)
      .bind(
        userId,
        phone || null,
        email || null,
        pwd.hash,
        pwd.salt,
        securityQuestion,
        sec.hash,
        sec.salt,
        nicknameParsed.display,
        nicknameParsed.norm,
        friendCode,
        avatarPreset,
        now,
        now,
      )
      .run();

    const userRow = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    const session = await createSession(db, userId, body.deviceName || '', body.platform || 'web');
    return jsonResponse(request, 201, {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: formatSelfUser(userRow),
    });
  }

  // POST /api/auth/login
  if (method === 'POST' && action === 'login') {
    const rl = await checkRateLimit(db, `login:${ip}`, 30, 900);
    if (!rl.allowed) {
      return errorResponse(request, 429, `登录尝试过多，请 ${rl.retryAfter} 秒后再试`, 'RATE_LIMITED');
    }
    const body = await readJsonBody(request, 8192);
    const identifier = String(body.identifier || body.phone || body.email || '').trim();
    const password = String(body.password || '');
    if (!identifier || !password) {
      return errorResponse(request, 400, '请输入手机号或邮箱及密码', 'MISSING_CREDENTIALS');
    }
    const userRow = await findUserByIdentifier(db, identifier);
    if (!userRow) {
      return errorResponse(request, 401, '账号或密码不正确', 'INVALID_CREDENTIALS');
    }
    const valid = await verifySecret(password, userRow.password_salt, userRow.password_hash);
    if (!valid) {
      return errorResponse(request, 401, '账号或密码不正确', 'INVALID_CREDENTIALS');
    }
    const session = await createSession(db, userRow.id, body.deviceName || '', body.platform || 'web');
    return jsonResponse(request, 200, {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: formatSelfUser(userRow),
    });
  }

  // POST /api/auth/security-question (忘记密码第一步：查询密保问题)
  if (method === 'POST' && action === 'security-question') {
    const rl = await checkRateLimit(db, `sq:${ip}`, 20, 900);
    if (!rl.allowed) {
      return errorResponse(request, 429, `请求过于频繁，请 ${rl.retryAfter} 秒后再试`, 'RATE_LIMITED');
    }
    const body = await readJsonBody(request, 4096);
    const identifier = String(body.identifier || '').trim();
    const userRow = await findUserByIdentifier(db, identifier);
    if (!userRow) {
      return errorResponse(request, 404, '未找到该手机号或邮箱对应的账号', 'ACCOUNT_NOT_FOUND');
    }
    if (userRow.security_locked_until && Date.parse(userRow.security_locked_until) > Date.now()) {
      const mins = Math.ceil((Date.parse(userRow.security_locked_until) - Date.now()) / 60000);
      return errorResponse(request, 423, `密保验证错误次数过多，请约 ${mins} 分钟后再试`, 'SECURITY_LOCKED');
    }
    return jsonResponse(request, 200, {
      ok: true,
      question: userRow.security_question,
      nickname: userRow.nickname,
    });
  }

  // POST /api/auth/reset-password (忘记密码第二步：回答密保问题重设密码)
  if (method === 'POST' && action === 'reset-password') {
    const rl = await checkRateLimit(db, `rst:${ip}`, 15, 900);
    if (!rl.allowed) {
      return errorResponse(request, 429, `尝试过于频繁，请 ${rl.retryAfter} 秒后再试`, 'RATE_LIMITED');
    }
    const body = await readJsonBody(request, 8192);
    const identifier = String(body.identifier || '').trim();
    const answerNorm = normalizeSecurityAnswer(body.securityAnswer);
    const newPassword = String(body.newPassword || '');
    if (!identifier || !answerNorm) {
      return errorResponse(request, 400, '请输入账号和密保答案', 'MISSING_FIELDS');
    }
    if (newPassword.length < 6 || newPassword.length > 72) {
      return errorResponse(request, 400, '新密码长度需在 6 到 72 位之间', 'INVALID_PASSWORD');
    }
    const userRow = await findUserByIdentifier(db, identifier);
    if (!userRow) {
      return errorResponse(request, 404, '未找到对应账号', 'ACCOUNT_NOT_FOUND');
    }
    if (userRow.security_locked_until && Date.parse(userRow.security_locked_until) > Date.now()) {
      const mins = Math.ceil((Date.parse(userRow.security_locked_until) - Date.now()) / 60000);
      return errorResponse(request, 423, `密保验证已暂时锁定，请约 ${mins} 分钟后再试`, 'SECURITY_LOCKED');
    }

    const okAnswer = await verifySecret(answerNorm, userRow.security_answer_salt, userRow.security_answer_hash);
    if (!okAnswer) {
      const nextFails = Number(userRow.security_fail_count || 0) + 1;
      const lockedUntil = nextFails >= 5 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
      await db
        .prepare('UPDATE users SET security_fail_count = ?, security_locked_until = ? WHERE id = ?')
        .bind(nextFails, lockedUntil, userRow.id)
        .run();
      if (lockedUntil) {
        return errorResponse(request, 423, '密保答案连续错误 5 次，已锁定 30 分钟', 'SECURITY_LOCKED');
      }
      return errorResponse(request, 400, `密保答案不正确（还可尝试 ${5 - nextFails} 次）`, 'WRONG_SECURITY_ANSWER');
    }

    const pwd = await hashSecret(newPassword);
    await db
      .prepare('UPDATE users SET password_hash = ?, password_salt = ?, security_fail_count = 0, security_locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(pwd.hash, pwd.salt, nowIso(), userRow.id)
      .run();
    // 密码重置后吊销旧会话，保障安全
    await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userRow.id).run();
    return jsonResponse(request, 200, { ok: true, message: '密码已重置，请使用新密码登录' });
  }

  // 以下接口均需已登录
  const auth = await requireAuth(db, request);

  // GET /api/auth/me
  if (method === 'GET' && action === 'me') {
    const usedBytes = await getUserCloudBytes(db, auth.user.id);
    const sessionsRes = await db
      .prepare('SELECT id, device_name, platform, last_seen_at, created_at FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 12')
      .bind(auth.user.id)
      .all();
    return jsonResponse(request, 200, {
      ok: true,
      user: formatSelfUser(auth.user),
      currentSessionId: auth.sessionId,
      sessions: (sessionsRes.results || []).map((s) => ({
        id: s.id,
        deviceName: s.device_name || '未知设备',
        platform: s.platform || 'web',
        lastSeenAt: s.last_seen_at,
        createdAt: s.created_at,
        current: s.id === auth.sessionId,
      })),
      quota: {
        usedBytes,
        maxBytes: MAX_USER_CLOUD_BYTES,
      },
    });
  }

  // POST /api/auth/logout
  if (method === 'POST' && action === 'logout') {
    await db.prepare('DELETE FROM user_sessions WHERE id = ?').bind(auth.sessionId).run();
    return jsonResponse(request, 200, { ok: true });
  }

  // DELETE /api/auth/sessions/:id
  if (method === 'DELETE' && action === 'sessions' && segments[1]) {
    await db.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?').bind(segments[1], auth.user.id).run();
    return jsonResponse(request, 200, { ok: true });
  }

  // PATCH /api/auth/profile
  if (method === 'PATCH' && action === 'profile') {
    const body = await readJsonBody(request, 8192);
    const updates = [];
    const params = [];

    if (body.nickname !== undefined) {
      const parsed = normalizeNickname(body.nickname);
      if (!parsed) return errorResponse(request, 400, '昵称需为 2-18 个字符，不含特殊符号', 'INVALID_NICKNAME');
      const dup = await db.prepare('SELECT id FROM users WHERE nickname_norm = ? AND id != ?').bind(parsed.norm, auth.user.id).first();
      if (dup) return errorResponse(request, 409, '该昵称已被占用，换一个试试', 'NICKNAME_EXISTS');
      updates.push('nickname = ?', 'nickname_norm = ?');
      params.push(parsed.display, parsed.norm);
    }
    if (body.avatar !== undefined) {
      updates.push('avatar_preset = ?');
      params.push(String(body.avatar || 'bear').slice(0, 32));
    }
    if (body.motto !== undefined) {
      updates.push('motto = ?');
      params.push(String(body.motto || '').trim().slice(0, 120));
    }
    if (body.mapVisibility !== undefined) {
      const vis = String(body.mapVisibility);
      if (!MAP_VISIBILITIES.has(vis)) {
        return errorResponse(request, 400, '无效的地图隐私设置', 'INVALID_VISIBILITY');
      }
      updates.push('map_visibility = ?');
      params.push(vis);
    }
    if (body.phone !== undefined) {
      const phone = normalizePhone(body.phone);
      if (body.phone && phone === null) return errorResponse(request, 400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
      if (phone) {
        const dup = await db.prepare('SELECT id FROM users WHERE phone_norm = ? AND id != ?').bind(phone, auth.user.id).first();
        if (dup) return errorResponse(request, 409, '该手机号已绑定其他账号', 'PHONE_EXISTS');
        updates.push('phone_norm = ?');
        params.push(phone);
      }
    }
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (body.email && email === null) return errorResponse(request, 400, '请输入正确的邮箱地址', 'INVALID_EMAIL');
      if (email) {
        const dup = await db.prepare('SELECT id FROM users WHERE email_norm = ? AND id != ?').bind(email, auth.user.id).first();
        if (dup) return errorResponse(request, 409, '该邮箱已绑定其他账号', 'EMAIL_EXISTS');
        updates.push('email_norm = ?');
        params.push(email);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(nowIso(), auth.user.id);
      await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }
    const refreshed = await db.prepare('SELECT * FROM users WHERE id = ?').bind(auth.user.id).first();
    return jsonResponse(request, 200, { ok: true, user: formatSelfUser(refreshed) });
  }

  // POST /api/auth/change-password (支持修改密码与更换密保问题)
  if (method === 'POST' && action === 'change-password') {
    const body = await readJsonBody(request, 8192);
    const currentPassword = String(body.currentPassword || '');
    const valid = await verifySecret(currentPassword, auth.user.password_salt, auth.user.password_hash);
    if (!valid) {
      return errorResponse(request, 400, '当前密码不正确', 'INVALID_PASSWORD');
    }
    const updates = [];
    const params = [];

    if (body.newPassword) {
      const nextPwd = String(body.newPassword);
      if (nextPwd.length < 6 || nextPwd.length > 72) {
        return errorResponse(request, 400, '新密码长度需在 6 到 72 位之间', 'INVALID_PASSWORD');
      }
      const hashed = await hashSecret(nextPwd);
      updates.push('password_hash = ?', 'password_salt = ?');
      params.push(hashed.hash, hashed.salt);
    }
    if (body.securityQuestion && body.securityAnswer) {
      const q = String(body.securityQuestion).trim().slice(0, 80);
      const ans = normalizeSecurityAnswer(body.securityAnswer);
      if (!q || !ans) return errorResponse(request, 400, '请完整填写新的密保问题与答案', 'INVALID_SECURITY');
      const sec = await hashSecret(ans);
      updates.push('security_question = ?', 'security_answer_hash = ?', 'security_answer_salt = ?', 'security_fail_count = 0', 'security_locked_until = NULL');
      params.push(q, sec.hash, sec.salt);
    }
    if (!updates.length) {
      return errorResponse(request, 400, '请填写要修改的新密码或新密保问题', 'NOTHING_TO_UPDATE');
    }
    updates.push('updated_at = ?');
    params.push(nowIso(), auth.user.id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    return jsonResponse(request, 200, { ok: true });
  }

  return errorResponse(request, 404, '未找到对应的认证接口', 'NOT_FOUND');
});
