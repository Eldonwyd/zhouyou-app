/**
 * 周游地图云端后端共享工具（纯 Web Crypto + D1，兼容 Cloudflare Pages Functions 与 Node 22+ 测试环境）。
 */

export const MAX_USER_CLOUD_BYTES = 3 * 1024 * 1024; // 单账号云端纯文本数据上限 3 MB
export const MAX_USER_PLANS = 100;
export const MAX_REVISIONS_PER_PLAN = 20;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天会话有效期
export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 分享链接 30 天有效
export const FACE_TO_FACE_TTL_MS = 30 * 60 * 1000; // 面对面建群 30 分钟有效

export const SYNCABLE_STORES = new Set([
  'marks',
  'badges',
  'trips',
  'places',
  'entries',
  'plans',
  'plannerPreferences',
]);

export const SECURITY_QUESTIONS = [
  '你的第一所小学名称是？',
  '你最喜欢的旅行城市是？',
  '你童年最好的朋友叫什么？',
  '你第一只宠物的名字是？',
  '你母亲的姓氏是？',
  '你最难忘的一次旅行目的地是？',
];

export const RELATION_TYPES = new Set(['couple', 'family', 'soulmate', 'bestie']);
export const MAP_VISIBILITIES = new Set(['friends', 'intimate', 'private']);

export function nowIso() {
  return new Date().toISOString();
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(String(text || '')).byteLength;
}

export function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createId(prefix = 'zy') {
  return `${prefix}_${randomHex(10)}`;
}

export function generateFriendCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let code = 'ZY-';
  for (let i = 0; i < buf.length; i += 1) {
    code += chars[buf[i] % chars.length];
  }
  return code;
}

export function generateShortCode(length = 8) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i += 1) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

export function normalizePhone(raw) {
  const cleaned = String(raw || '').trim().replace(/[\s\-()]/g, '').replace(/^\+86/, '');
  if (!cleaned) return '';
  if (!/^1[3-9]\d{9}$/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeEmail(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned) || cleaned.length > 120) return null;
  return cleaned;
}

export function normalizeNickname(raw) {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  const len = Array.from(trimmed).length;
  if (len < 2 || len > 18) return null;
  if (/[<>\\/"'`]/.test(trimmed)) return null;
  return {
    display: trimmed,
    norm: trimmed.toLowerCase(),
  };
}

export function normalizeSecurityAnswer(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export async function hashSecret(secret, saltHex = randomHex(16)) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(saltHex),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return {
    salt: saltHex,
    hash: toHex(bits),
  };
}

export async function verifySecret(secret, saltHex, expectedHash) {
  if (!secret || !saltHex || !expectedHash) return false;
  const { hash } = await hashSecret(secret, saltHex);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) {
    diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function resolveAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '*';
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'zhouyou.online'
      || host === 'www.zhouyou.online'
      || host.endsWith('.zhouyou.online')
      || host === 'eldonwyd.github.io'
      || host.endsWith('.pages.dev')
      || host === 'localhost'
      || host === '127.0.0.1'
      || parsed.protocol === 'capacitor:'
      || parsed.protocol === 'app:'
      || parsed.protocol === 'file:'
    ) {
      return origin;
    }
  } catch {
    // ignore
  }
  // 移动端 Capacitor Android 使用 http://localhost，上面已放行；其他未知来源拒绝 CORS
  return '';
}

export function corsHeaders(request) {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

export function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function jsonResponse(request, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function errorResponse(request, status, error, code = 'ERROR', extra = {}) {
  return jsonResponse(request, status, { ok: false, error, code, ...extra });
}

export async function readJsonBody(request, maxBytes = 2 * 1024 * 1024) {
  const text = await request.text();
  if (!text) return {};
  if (utf8ByteLength(text) > maxBytes) {
    throw Object.assign(new Error('请求体过大，请精简后重试'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('请求格式错误（非合法 JSON）'), { status: 400, code: 'INVALID_JSON' });
  }
}

export function getDb(context) {
  const db = context?.env?.DB;
  if (!db) {
    throw Object.assign(
      new Error('云端数据库尚未绑定（请在 Cloudflare Pages 项目中将 D1 数据库绑定为 DB）'),
      { status: 503, code: 'CLOUD_DB_NOT_CONFIGURED' },
    );
  }
  return db;
}

export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'
  );
}

/** 轻量 D1 限流器：在 windowSeconds 内最多允许 maxRequests 次。 */
export async function checkRateLimit(db, key, maxRequests, windowSeconds) {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || Number(row.reset_at) <= nowSec) {
    await db
      .prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at')
      .bind(key, nowSec + windowSeconds)
      .run();
    return { allowed: true, remaining: maxRequests - 1 };
  }
  const nextCount = Number(row.count) + 1;
  if (nextCount > maxRequests) {
    return { allowed: false, retryAfter: Math.max(1, Number(row.reset_at) - nowSec) };
  }
  await db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').bind(nextCount, key).run();
  return { allowed: true, remaining: Math.max(0, maxRequests - nextCount) };
}

export function formatPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    friendCode: row.friend_code,
    avatar: row.avatar_preset || 'bear',
    motto: row.motto || '',
    mapVisibility: row.map_visibility || 'friends',
    createdAt: row.created_at,
  };
}

export function formatSelfUser(row) {
  if (!row) return null;
  return {
    ...formatPublicUser(row),
    phone: row.phone_norm ? `${row.phone_norm.slice(0, 3)}****${row.phone_norm.slice(-4)}` : '',
    hasPhone: Boolean(row.phone_norm),
    email: row.email_norm || '',
    hasEmail: Boolean(row.email_norm),
    securityQuestion: row.security_question || '',
    updatedAt: row.updated_at,
  };
}

export async function createSession(db, userId, deviceName = '', platform = 'web') {
  const token = `zyt_${randomHex(28)}`;
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const sessionId = createId('ses');
  await db
    .prepare('INSERT INTO user_sessions (id, user_id, token_hash, device_name, platform, expires_at, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(sessionId, userId, tokenHash, String(deviceName || '').slice(0, 80), String(platform || 'web').slice(0, 20), expiresAt, now, now)
    .run();
  return { token, sessionId, expiresAt };
}

export async function requireAuth(db, request) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw Object.assign(new Error('请先登录周游账号'), { status: 401, code: 'UNAUTHORIZED' });
  }
  const token = match[1].trim();
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(`
      SELECT s.id AS session_id, s.expires_at, u.*
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .bind(tokenHash)
    .first();
  if (!row) {
    throw Object.assign(new Error('登录状态已失效，请重新登录'), { status: 401, code: 'SESSION_INVALID' });
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare('DELETE FROM user_sessions WHERE id = ?').bind(row.session_id).run();
    throw Object.assign(new Error('登录已过期，请重新登录'), { status: 401, code: 'SESSION_EXPIRED' });
  }
  await db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso(), row.session_id).run();
  return { user: row, sessionId: row.session_id, tokenHash };
}

/** 清理 AI 攻略里不应上传云端的临时大字段（如临时解析截图 noteImages），保留纯文本与图片 URL 元数据。 */
export function sanitizeAiPlanPayload(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const clone = JSON.parse(JSON.stringify(plan));
  if (clone.content?.request?.references && Array.isArray(clone.content.request.references)) {
    clone.content.request.references = clone.content.request.references.map((ref) => {
      if (!ref || typeof ref !== 'object') return ref;
      const { noteImages: _omit, ...rest } = ref;
      return rest;
    });
  }
  return clone;
}

export async function getUserCloudBytes(db, userId) {
  const rec = await db
    .prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM user_records WHERE user_id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first();
  const plans = await db
    .prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM ai_plans WHERE owner_id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first();
  return Number(rec?.total || 0) + Number(plans?.total || 0);
}

export async function createNotification(db, { userId, type, actorId = null, actorNickname = '', title, body = '', targetRef = {} }) {
  if (!userId || userId === actorId) return;
  await db
    .prepare('INSERT INTO notifications (id, user_id, type, actor_id, actor_nickname, title, body, target_ref_json, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
    .bind(createId('ntf'), userId, type, actorId, actorNickname, title, body, JSON.stringify(targetRef || {}), nowIso())
    .run();
}

export async function areFriends(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const row = await db
    .prepare(`
      SELECT id FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
      LIMIT 1
    `)
    .bind(userA, userB, userB, userA)
    .first();
  return Boolean(row);
}

export async function getActiveIntimacy(db, userA, userB) {
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  return db
    .prepare('SELECT * FROM intimacy_bonds WHERE user_a_id = ? AND user_b_id = ? AND status = \'active\' LIMIT 1')
    .bind(a, b)
    .first();
}

export async function isGroupMember(db, groupId, userId) {
  if (!groupId || !userId) return null;
  return db
    .prepare('SELECT role FROM travel_group_members WHERE group_id = ? AND user_id = ? LIMIT 1')
    .bind(groupId, userId)
    .first();
}

export async function canAccessPlan(db, planId, userId) {
  const plan = await db.prepare('SELECT * FROM ai_plans WHERE id = ? AND deleted_at IS NULL').bind(planId).first();
  if (!plan) return null;
  if (plan.owner_id === userId) return { plan, role: 'owner' };
  if (plan.group_id) {
    const member = await isGroupMember(db, plan.group_id, userId);
    if (member) return { plan, role: member.role };
  }
  return null;
}

export function parseRouteSegments(context) {
  const raw = context?.params?.path;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw) return raw.split('/').filter(Boolean);
  return [];
}

export function withApiHandler(handler) {
  return async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
      return handleOptions(context.request);
    }
    try {
      return await handler(context);
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      const code = err?.code || 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : '服务器开小差了，请稍后重试';
      return errorResponse(context.request, status, message, code);
    }
  };
}
