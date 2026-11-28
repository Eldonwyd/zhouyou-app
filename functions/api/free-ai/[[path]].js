import {
  checkRateLimit,
  errorResponse,
  getClientIp,
  getDb,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';
import {
  logFreeAiRequest,
  readAdminSettingsMap,
  trackDailyMetric,
} from '../../../cloud-lib/admin-telemetry.js';

const SITE_BUCKET_ID = '__SITE__';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-5.3-flash';
const DEFAULT_USER_DAILY_TOKENS = 50000;
const DEFAULT_USER_MONTHLY_TOKENS = 120000;
const DEFAULT_SITE_DAILY_TOKENS = 500000;
const DEFAULT_VIP_MULTIPLIER = 3;
const MAX_INPUT_CHARS = 120000;
const MAX_OUTPUT_TOKENS = 12000;

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseVipMultiplier(raw, fallback = DEFAULT_VIP_MULTIPLIER) {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return fallback;
  // 0 表示 VIP 不限额；>0 表示额度倍数（如 2 = 双倍额度）
  return n === 0 ? 0 : Math.min(100, Math.max(1, n));
}

/** 按北京时间（UTC+8）计算当日与当月 key，保证“明日 0 点刷新”符合国内习惯。 */
function getBeijingPeriodKeys(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = bj.getUTCFullYear();
  const month = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bj.getUTCDate()).padStart(2, '0');
  return {
    dayKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
  };
}

function readFreeAiConfig(env, overrides = {}) {
  const apiKey = String(env?.FREE_AI_API_KEY || '').trim();
  const baseUrl = String(overrides.free_ai_base_url || env?.FREE_AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = String(overrides.free_ai_model || env?.FREE_AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const userDailyLimit = parsePositiveInt(
    overrides.free_ai_user_daily_tokens || env?.FREE_AI_USER_DAILY_TOKENS,
    DEFAULT_USER_DAILY_TOKENS,
  );
  const userMonthlyLimit = parsePositiveInt(
    overrides.free_ai_user_monthly_tokens || env?.FREE_AI_USER_MONTHLY_TOKENS,
    DEFAULT_USER_MONTHLY_TOKENS,
  );
  const siteDailyLimit = parsePositiveInt(
    overrides.free_ai_site_daily_tokens || env?.FREE_AI_SITE_DAILY_TOKENS,
    DEFAULT_SITE_DAILY_TOKENS,
  );
  const enabledOverride = String(overrides.free_ai_enabled || '').trim().toLowerCase();
  const enabledFlag = enabledOverride === '' ? true : enabledOverride !== 'false' && enabledOverride !== '0';
  const rawVip = [env?.FREE_AI_VIP_ACCOUNTS || '', overrides.free_ai_vip_accounts || ''].filter(Boolean).join(',');
  const vipSet = new Set(
    rawVip
      .split(/[,;\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const rawSvip = [env?.FREE_AI_SVIP_ACCOUNTS || '', overrides.free_ai_svip_accounts || ''].filter(Boolean).join(',');
  const svipSet = new Set(
    rawSvip
      .split(/[,;\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const vipMultiplier = parseVipMultiplier(
    overrides.free_ai_vip_multiplier !== undefined && overrides.free_ai_vip_multiplier !== ''
      ? overrides.free_ai_vip_multiplier
      : env?.FREE_AI_VIP_MULTIPLIER,
    DEFAULT_VIP_MULTIPLIER,
  );
  return {
    apiKey,
    enabled: Boolean(apiKey) && enabledFlag,
    baseUrl,
    model,
    userDailyLimit,
    userMonthlyLimit,
    siteDailyLimit,
    vipSet,
    svipSet,
    vipMultiplier,
  };
}

function isVipUser(user, vipSet) {
  if (!user || !vipSet || vipSet.size === 0) return false;
  const candidates = [
    user.id,
    user.email_norm,
    user.phone_norm,
    user.nickname_norm,
    user.friend_code,
  ];
  return candidates.some((val) => val && vipSet.has(String(val).trim().toLowerCase()));
}

let tablesReadyPromise = null;

async function ensureQuotaTables(db) {
  if (!tablesReadyPromise) {
    tablesReadyPromise = (async () => {
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS free_ai_usage_daily (
            user_id TEXT NOT NULL,
            day_key TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            requests_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, day_key)
          )
        `)
        .run();
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS free_ai_usage_monthly (
            user_id TEXT NOT NULL,
            month_key TEXT NOT NULL,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            requests_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, month_key)
          )
        `)
        .run();
      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS free_ai_guest_trials (
            guest_key TEXT NOT NULL PRIMARY KEY,
            session_id TEXT NOT NULL,
            calls_count INTEGER NOT NULL DEFAULT 0,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
          )
        `)
        .run();
    })().catch((err) => {
      tablesReadyPromise = null;
      throw err;
    });
  }
  return tablesReadyPromise;
}

async function readQuotaSnapshot(db, user, config) {
  const { dayKey, monthKey } = getBeijingPeriodKeys();
  const svip = isVipUser(user, config.svipSet);
  const vip = svip || isVipUser(user, config.vipSet);
  const [userDailyRow, userMonthlyRow, siteDailyRow] = await Promise.all([
    db
      .prepare('SELECT tokens_used, requests_count FROM free_ai_usage_daily WHERE user_id = ? AND day_key = ?')
      .bind(user.id, dayKey)
      .first(),
    db
      .prepare('SELECT tokens_used, requests_count FROM free_ai_usage_monthly WHERE user_id = ? AND month_key = ?')
      .bind(user.id, monthKey)
      .first(),
    db
      .prepare('SELECT tokens_used, requests_count FROM free_ai_usage_daily WHERE user_id = ? AND day_key = ?')
      .bind(SITE_BUCKET_ID, dayKey)
      .first(),
  ]);

  const dailyUsed = Number(userDailyRow?.tokens_used || 0);
  const monthlyUsed = Number(userMonthlyRow?.tokens_used || 0);
  const siteUsed = Number(siteDailyRow?.tokens_used || 0);
  const vipUnlimited = svip || (vip && config.vipMultiplier === 0);
  const multiplier = vip && config.vipMultiplier > 0 ? config.vipMultiplier : 1;
  const effectiveDailyLimit = Math.round(config.userDailyLimit * multiplier);
  const effectiveMonthlyLimit = Math.round(config.userMonthlyLimit * multiplier);
  const dailyRemaining = vipUnlimited ? effectiveDailyLimit : Math.max(0, effectiveDailyLimit - dailyUsed);
  const monthlyRemaining = vipUnlimited ? effectiveMonthlyLimit : Math.max(0, effectiveMonthlyLimit - monthlyUsed);
  const siteRemaining = Math.max(0, config.siteDailyLimit - siteUsed);

  return {
    enabled: config.enabled,
    label: '周游免费体验 AI',
    model: config.model,
    svip,
    vip,
    vipMultiplier: svip ? 0 : (vip ? config.vipMultiplier : 1),
    vipUnlimited,
    dayKey,
    monthKey,
    daily: {
      used: dailyUsed,
      limit: effectiveDailyLimit,
      remaining: dailyRemaining,
      requests: Number(userDailyRow?.requests_count || 0),
    },
    monthly: {
      used: monthlyUsed,
      limit: effectiveMonthlyLimit,
      remaining: monthlyRemaining,
      requests: Number(userMonthlyRow?.requests_count || 0),
    },
    site: {
      used: siteUsed,
      limit: config.siteDailyLimit,
      remaining: siteRemaining,
      exhausted: !vip && !svip && siteRemaining <= 0,
    },
  };
}

async function recordTokenUsage(db, userId, tokensUsed, dayKey, monthKey, { countInSiteBucket = true } = {}) {
  const safeTokens = Math.max(0, Math.round(Number(tokensUsed) || 0));
  const now = nowIso();
  const tasks = [
    db
      .prepare(`
        INSERT INTO free_ai_usage_daily (user_id, day_key, tokens_used, requests_count, updated_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(user_id, day_key) DO UPDATE SET
          tokens_used = tokens_used + excluded.tokens_used,
          requests_count = requests_count + 1,
          updated_at = excluded.updated_at
      `)
      .bind(userId, dayKey, safeTokens, now)
      .run(),
    db
      .prepare(`
        INSERT INTO free_ai_usage_monthly (user_id, month_key, tokens_used, requests_count, updated_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(user_id, month_key) DO UPDATE SET
          tokens_used = tokens_used + excluded.tokens_used,
          requests_count = requests_count + 1,
          updated_at = excluded.updated_at
      `)
      .bind(userId, monthKey, safeTokens, now)
      .run(),
  ];
  if (countInSiteBucket) {
    tasks.push(
      db
        .prepare(`
          INSERT INTO free_ai_usage_daily (user_id, day_key, tokens_used, requests_count, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(user_id, day_key) DO UPDATE SET
            tokens_used = tokens_used + excluded.tokens_used,
            requests_count = requests_count + 1,
            updated_at = excluded.updated_at
        `)
        .bind(SITE_BUCKET_ID, dayKey, safeTokens, now)
        .run(),
    );
  }
  await Promise.all(tasks);
}

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw Object.assign(new Error('缺少有效的对话内容'), { status: 400, code: 'INVALID_MESSAGES' });
  }
  const allowedRoles = new Set(['system', 'user', 'assistant']);
  const cleaned = [];
  let totalChars = 0;
  for (const item of rawMessages.slice(-24)) {
    if (!item || typeof item !== 'object') continue;
    const role = allowedRoles.has(item.role) ? item.role : 'user';
    const content = typeof item.content === 'string' ? item.content : '';
    if (!content.trim()) continue;
    totalChars += content.length;
    if (totalChars > MAX_INPUT_CHARS) {
      throw Object.assign(new Error('单次输入内容过长，请精简后重试'), { status: 413, code: 'INPUT_TOO_LONG' });
    }
    cleaned.push({ role, content });
  }
  if (cleaned.length === 0) {
    throw Object.assign(new Error('对话内容不能为空'), { status: 400, code: 'INVALID_MESSAGES' });
  }
  return { messages: cleaned, totalChars };
}

function buildUpstreamPayload(config, messages, { maxTokens, jsonMode }) {
  const safeMaxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(64, Number(maxTokens) || 8000));
  const body = {
    model: config.model,
    messages,
    max_tokens: safeMaxTokens,
    stream: false,
  };
  const lowerUrl = config.baseUrl.toLowerCase();
  const lowerModel = config.model.toLowerCase();
  // 智谱 GLM-5.x（如 glm-5.3-flash）始终思考，不支持 thinking.type='disabled'（会报 400/1210），
  // 改用 reasoning_effort='low' 既能正常返回又保持零/极低思考 token 与最快响应；
  // 智谱 GLM-4.x 与 DeepSeek 默认关闭深度思考，省 30%~50% Token 且更快。
  if (lowerModel.startsWith('glm-5')) {
    body.reasoning_effort = 'low';
  } else if (lowerUrl.includes('bigmodel.cn') || lowerUrl.includes('deepseek.com') || lowerModel.startsWith('glm-')) {
    body.thinking = { type: 'disabled' };
  } else if (lowerUrl.includes('dashscope.aliyuncs.com') || lowerModel.startsWith('qwen')) {
    body.enable_thinking = false;
  }
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs = 75000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callUpstreamWithRetry(config, initialBody) {
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`;
  const delays = [0, 1200, 2400];
  let lastStatus = 502;
  let body = { ...initialBody };
  let retriedWithoutThinking = false;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    let resp;
    try {
      resp = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 75000);
    } catch {
      lastStatus = 504;
      continue;
    }

    lastStatus = resp.status;
    if (resp.status === 429 || resp.status === 503 || resp.status === 502) {
      // 智谱免费通道并发有限，遇到短暂限流自动退避重试
      continue;
    }

    const rawText = await resp.text().catch(() => '');
    if (!resp.ok) {
      // 若上游模型不支持关闭思考（如智谱 1210 错误），自动降级为 reasoning_effort='low' 重试一次
      if (
        resp.status === 400
        && !retriedWithoutThinking
        && (body.thinking || body.enable_thinking !== undefined)
        && /thinking|思考|1210|reasoning_effort/i.test(rawText)
      ) {
        retriedWithoutThinking = true;
        const nextBody = { ...body };
        delete nextBody.thinking;
        delete nextBody.enable_thinking;
        nextBody.reasoning_effort = 'low';
        body = nextBody;
        attempt -= 1;
        continue;
      }
      // 严禁把上游 Key 或敏感内部信息透传给前端
      if (resp.status === 401 || resp.status === 403) {
        throw Object.assign(
          new Error('平台免费体验通道暂时不可用（服务端凭证异常），请联系管理员或使用「借用外部免费 AI 导入」'),
          { status: 503, code: 'FREE_AI_UPSTREAM_AUTH' },
        );
      }
      throw Object.assign(
        new Error(`免费体验 AI 服务暂时繁忙（HTTP ${resp.status}），请稍后重试或使用「借用外部免费 AI 导入」`),
        { status: 502, code: 'FREE_AI_UPSTREAM_ERROR' },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw Object.assign(new Error('免费体验 AI 返回格式异常，请重试（本次不扣额度）'), {
        status: 502,
        code: 'FREE_AI_BAD_RESPONSE',
      });
    }

    const content = String(parsed?.choices?.[0]?.message?.content ?? '').trim();
    if (!content) {
      throw Object.assign(new Error('免费体验 AI 未返回有效内容，请重试（本次不扣额度）'), {
        status: 502,
        code: 'FREE_AI_EMPTY_RESPONSE',
      });
    }

    const promptTokens = Number(parsed?.usage?.prompt_tokens) || 0;
    const completionTokens = Number(parsed?.usage?.completion_tokens) || 0;
    const totalTokens = Number(parsed?.usage?.total_tokens) || (promptTokens + completionTokens);
    return {
      content,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  if (lastStatus === 429) {
    throw Object.assign(
      new Error('当前免费体验排队人数较多，请 5~10 秒后重试；也可使用「借用外部免费 AI 导入」立即生成（本次不扣额度）'),
      { status: 429, code: 'FREE_AI_BUSY' },
    );
  }
  throw Object.assign(
    new Error('免费体验 AI 通道连接超时，请稍后重试（本次不扣额度）'),
    { status: 504, code: 'FREE_AI_TIMEOUT' },
  );
}

export const onRequest = withApiHandler(async (context) => {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);
  await ensureQuotaTables(db);
  const dynamicSettings = await readAdminSettingsMap(db);
  const config = readFreeAiConfig(env, dynamicSettings);

  // GET /api/free-ai/quota — 查询当前登录账号的免费体验 Token 额度
  if (method === 'GET' && segments[0] === 'quota' && segments.length === 1) {
    const auth = await requireAuth(db, request);
    const quota = await readQuotaSnapshot(db, auth.user, config);
    return jsonResponse(request, 200, { ok: true, quota });
  }

  // POST /api/free-ai/chat — 平台托管免费体验 AI 代理（登录用户享日/月额度；未登录游客开放 1 次完整行程规划体验）
  if (method === 'POST' && segments[0] === 'chat' && segments.length === 1) {
    const authHeader = String(request.headers.get('Authorization') || '').trim();
    const isGuestRequest = !authHeader;

    if (!config.enabled) {
      return errorResponse(
        request,
        503,
        '平台免费体验通道尚未启用，请使用「借用外部免费 AI 导入」或在设置中绑定自己的 API / 会员账号',
        'FREE_AI_NOT_CONFIGURED',
      );
    }

    if (isGuestRequest) {
      const { dayKey } = getBeijingPeriodKeys();
      const rawGuestId = String(request.headers.get('X-Guest-Trial-Id') || '').trim().slice(0, 64);
      const clientIp = getClientIp(request) || 'unknown';
      const guestKey = `guest:${clientIp}:${rawGuestId || 'anon'}`;
      const ipKey = `guest_ip:${clientIp}`;

      const burst = await checkRateLimit(db, `free_ai_guest_burst:${clientIp}`, 6, 60);
      if (!burst.allowed) {
        return errorResponse(
          request,
          429,
          `请求过于频繁，请 ${burst.retryAfter} 秒后重试`,
          'FREE_AI_RATE_LIMITED',
        );
      }

      const siteDailyRow = await db
        .prepare('SELECT tokens_used FROM free_ai_usage_daily WHERE user_id = ? AND day_key = ?')
        .bind(SITE_BUCKET_ID, dayKey)
        .first();
      const siteUsed = Number(siteDailyRow?.tokens_used || 0);
      if (siteUsed >= config.siteDailyLimit) {
        return errorResponse(
          request,
          429,
          '今日全站免费体验额度已用完，明日 0 点刷新；登录账号或使用「借用外部免费 AI 导入」可继续规划',
          'FREE_AI_SITE_LIMIT',
        );
      }

      const body = await readJsonBody(request, 512 * 1024);
      const guestSessionId = String(body.guestSessionId || '').trim().slice(0, 64);
      const guestAction = String(body.guestAction || '').trim();
      const exhaustedMsg = '游客免费体验次数（1 次完整行程规划）已用完！登录周游账号即可享受每日 5 万 / 每月 12 万 tokens 免费 AI 额度，还支持多端同步保存攻略。';

      if (guestAction && guestAction !== 'generate') {
        return errorResponse(request, 401, exhaustedMsg, 'GUEST_TRIAL_EXHAUSTED');
      }

      const existing = await db
        .prepare('SELECT session_id, calls_count, tokens_used FROM free_ai_guest_trials WHERE guest_key = ?')
        .bind(guestKey)
        .first();
      const existingByIp = !existing && clientIp !== 'unknown'
        ? await db
            .prepare('SELECT session_id, calls_count, tokens_used FROM free_ai_guest_trials WHERE guest_key = ?')
            .bind(ipKey)
            .first()
        : null;
      const prior = existing || existingByIp;

      if (prior) {
        const sameSession = Boolean(guestSessionId && prior.session_id === guestSessionId);
        const withinSessionCap = Number(prior.calls_count || 0) < 3 && Number(prior.tokens_used || 0) < 30000;
        if (!sameSession || !withinSessionCap) {
          return errorResponse(request, 401, exhaustedMsg, 'GUEST_TRIAL_EXHAUSTED');
        }
      }

      const { messages, totalChars } = sanitizeMessages(body.messages);
      const upstreamPayload = buildUpstreamPayload(config, messages, {
        maxTokens: body.maxTokens,
        jsonMode: Boolean(body.jsonMode),
      });

      const startedAt = Date.now();
      let result;
      try {
        result = await callUpstreamWithRetry(config, upstreamPayload);
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const errStatus = Number(err?.status) || 502;
        const errCode = String(err?.code || 'UPSTREAM_ERROR');
        logFreeAiRequest(context, {
          userId: guestKey,
          model: config.model,
          status: errStatus,
          latencyMs,
          errorCode: errCode,
        });
        trackDailyMetric(context, 'free_ai_status', String(errStatus), 1, latencyMs);
        throw err;
      }

      const latencyMs = Date.now() - startedAt;
      const promptTokens = result.promptTokens || Math.ceil(totalChars / 2.2);
      const completionTokens = result.completionTokens || Math.ceil(result.content.length / 2.2);
      const totalTokens = result.totalTokens || (promptTokens + completionTokens);
      const sessionToSave = guestSessionId || `g-${Date.now()}`;
      const now = nowIso();

      const writes = [
        db
          .prepare(`
            INSERT INTO free_ai_guest_trials (guest_key, session_id, calls_count, tokens_used, updated_at)
            VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(guest_key) DO UPDATE SET
              calls_count = calls_count + 1,
              tokens_used = tokens_used + excluded.tokens_used,
              updated_at = excluded.updated_at
          `)
          .bind(guestKey, sessionToSave, totalTokens, now)
          .run(),
        db
          .prepare(`
            INSERT INTO free_ai_usage_daily (user_id, day_key, tokens_used, requests_count, updated_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(user_id, day_key) DO UPDATE SET
              tokens_used = tokens_used + excluded.tokens_used,
              requests_count = requests_count + 1,
              updated_at = excluded.updated_at
          `)
          .bind(SITE_BUCKET_ID, dayKey, totalTokens, now)
          .run(),
      ];
      if (clientIp !== 'unknown') {
        writes.push(
          db
            .prepare(`
              INSERT INTO free_ai_guest_trials (guest_key, session_id, calls_count, tokens_used, updated_at)
              VALUES (?, ?, 1, ?, ?)
              ON CONFLICT(guest_key) DO UPDATE SET
                calls_count = calls_count + 1,
                tokens_used = tokens_used + excluded.tokens_used,
                updated_at = excluded.updated_at
            `)
            .bind(ipKey, sessionToSave, totalTokens, now)
            .run(),
        );
      }
      await Promise.all(writes);
      logFreeAiRequest(context, {
        userId: guestKey,
        model: config.model,
        status: 200,
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens,
      });
      trackDailyMetric(context, 'free_ai_status', '200', 1, latencyMs);

      return jsonResponse(request, 200, {
        ok: true,
        guestTrial: true,
        content: result.content,
        model: config.model,
        label: '周游免费体验 AI（游客体验）',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
      });
    }

    const auth = await requireAuth(db, request);

    // 轻量突发限流：每分钟最多 12 次，防止并发脚本瞬间击穿额度
    const burst = await checkRateLimit(db, `free_ai_burst:${auth.user.id}`, 12, 60);
    if (!burst.allowed) {
      return errorResponse(
        request,
        429,
        `请求过于频繁，请 ${burst.retryAfter} 秒后重试`,
        'FREE_AI_RATE_LIMITED',
      );
    }

    const beforeQuota = await readQuotaSnapshot(db, auth.user, config);
    if (!beforeQuota.svip && !beforeQuota.vip && beforeQuota.site.remaining <= 0) {
      return errorResponse(
        request,
        429,
        '今日全站免费体验额度已用完，明日 0 点刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API',
        'FREE_AI_SITE_LIMIT',
        { quota: beforeQuota },
      );
    }
    if (!beforeQuota.svip && !beforeQuota.vipUnlimited) {
      const tierLabel = beforeQuota.vip ? `VIP ${beforeQuota.vipMultiplier}倍` : '免费体验';
      if (beforeQuota.daily.remaining <= 0) {
        return errorResponse(
          request,
          429,
          `今日${tierLabel}额度（${Number((beforeQuota.daily.limit / 10000).toFixed(1))} 万 tokens）已用完，明日 0 点刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API`,
          'FREE_AI_DAILY_LIMIT',
          { quota: beforeQuota },
        );
      }
      if (beforeQuota.monthly.remaining <= 0) {
        return errorResponse(
          request,
          429,
          `本月${tierLabel}额度（${Number((beforeQuota.monthly.limit / 10000).toFixed(1))} 万 tokens）已用完，下月 1 日刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API`,
          'FREE_AI_MONTHLY_LIMIT',
          { quota: beforeQuota },
        );
      }
    }

    const body = await readJsonBody(request, 512 * 1024);
    const { messages, totalChars } = sanitizeMessages(body.messages);
    const upstreamPayload = buildUpstreamPayload(config, messages, {
      maxTokens: body.maxTokens,
      jsonMode: Boolean(body.jsonMode),
    });

    const startedAt = Date.now();
    let result;
    try {
      result = await callUpstreamWithRetry(config, upstreamPayload);
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errStatus = Number(err?.status) || 502;
      const errCode = String(err?.code || 'UPSTREAM_ERROR');
      logFreeAiRequest(context, {
        userId: auth.user.id,
        model: config.model,
        status: errStatus,
        latencyMs,
        errorCode: errCode,
      });
      trackDailyMetric(context, 'free_ai_status', String(errStatus), 1, latencyMs);
      throw err;
    }
    const latencyMs = Date.now() - startedAt;
    const promptTokens = result.promptTokens || Math.ceil(totalChars / 2.2);
    const completionTokens = result.completionTokens || Math.ceil(result.content.length / 2.2);
    const totalTokens = result.totalTokens || (promptTokens + completionTokens);

    // SVIP 永久免费不占用全站熔断池，仅记录个人统计便于后台监控
    await recordTokenUsage(db, auth.user.id, totalTokens, beforeQuota.dayKey, beforeQuota.monthKey, {
      countInSiteBucket: !beforeQuota.svip,
    });
    logFreeAiRequest(context, {
      userId: auth.user.id,
      model: config.model,
      status: 200,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens,
    });
    trackDailyMetric(context, 'free_ai_status', '200', 1, latencyMs);
    const afterQuota = await readQuotaSnapshot(db, auth.user, config);

    return jsonResponse(request, 200, {
      ok: true,
      content: result.content,
      model: config.model,
      label: '周游免费体验 AI',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      quota: afterQuota,
    });
  }

  return errorResponse(request, 404, '未找到免费体验 AI 接口', 'NOT_FOUND');
});
