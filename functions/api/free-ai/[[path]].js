import {
  checkRateLimit,
  errorResponse,
  getDb,
  jsonResponse,
  nowIso,
  parseRouteSegments,
  readJsonBody,
  requireAuth,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';

const SITE_BUCKET_ID = '__SITE__';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-5.3-flash';
const DEFAULT_USER_DAILY_TOKENS = 50000;
const DEFAULT_USER_MONTHLY_TOKENS = 120000;
const DEFAULT_SITE_DAILY_TOKENS = 500000;
const MAX_INPUT_CHARS = 120000;
const MAX_OUTPUT_TOKENS = 12000;

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

function readFreeAiConfig(env) {
  const apiKey = String(env?.FREE_AI_API_KEY || '').trim();
  const baseUrl = String(env?.FREE_AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = String(env?.FREE_AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const userDailyLimit = parsePositiveInt(env?.FREE_AI_USER_DAILY_TOKENS, DEFAULT_USER_DAILY_TOKENS);
  const userMonthlyLimit = parsePositiveInt(env?.FREE_AI_USER_MONTHLY_TOKENS, DEFAULT_USER_MONTHLY_TOKENS);
  const siteDailyLimit = parsePositiveInt(env?.FREE_AI_SITE_DAILY_TOKENS, DEFAULT_SITE_DAILY_TOKENS);
  const vipSet = new Set(
    String(env?.FREE_AI_VIP_ACCOUNTS || '')
      .split(/[,;\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    apiKey,
    enabled: Boolean(apiKey),
    baseUrl,
    model,
    userDailyLimit,
    userMonthlyLimit,
    siteDailyLimit,
    vipSet,
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
    })().catch((err) => {
      tablesReadyPromise = null;
      throw err;
    });
  }
  return tablesReadyPromise;
}

async function readQuotaSnapshot(db, user, config) {
  const { dayKey, monthKey } = getBeijingPeriodKeys();
  const vip = isVipUser(user, config.vipSet);
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
  const dailyRemaining = vip ? config.userDailyLimit : Math.max(0, config.userDailyLimit - dailyUsed);
  const monthlyRemaining = vip ? config.userMonthlyLimit : Math.max(0, config.userMonthlyLimit - monthlyUsed);
  const siteRemaining = Math.max(0, config.siteDailyLimit - siteUsed);

  return {
    enabled: config.enabled,
    label: '周游免费体验 AI',
    model: config.model,
    vip,
    dayKey,
    monthKey,
    daily: {
      used: dailyUsed,
      limit: config.userDailyLimit,
      remaining: dailyRemaining,
      requests: Number(userDailyRow?.requests_count || 0),
    },
    monthly: {
      used: monthlyUsed,
      limit: config.userMonthlyLimit,
      remaining: monthlyRemaining,
      requests: Number(userMonthlyRow?.requests_count || 0),
    },
    site: {
      used: siteUsed,
      limit: config.siteDailyLimit,
      remaining: siteRemaining,
      exhausted: !vip && siteRemaining <= 0,
    },
  };
}

async function recordTokenUsage(db, userId, tokensUsed, dayKey, monthKey) {
  const safeTokens = Math.max(0, Math.round(Number(tokensUsed) || 0));
  const now = nowIso();
  await Promise.all([
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
  ]);
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
  // 智谱 GLM-4.5+/5.x 与 DeepSeek 免费体验默认关闭深度思考，省 30%~50% Token 且更快
  if (lowerUrl.includes('bigmodel.cn') || lowerUrl.includes('deepseek.com') || lowerModel.startsWith('glm-')) {
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

async function callUpstreamWithRetry(config, body) {
  const endpoint = /\/chat\/completions$/i.test(config.baseUrl)
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`;
  const delays = [0, 1200, 2400];
  let lastStatus = 502;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
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
  const config = readFreeAiConfig(env);

  // GET /api/free-ai/quota — 查询当前登录账号的免费体验 Token 额度
  if (method === 'GET' && segments[0] === 'quota' && segments.length === 1) {
    const auth = await requireAuth(db, request);
    const quota = await readQuotaSnapshot(db, auth.user, config);
    return jsonResponse(request, 200, { ok: true, quota });
  }

  // POST /api/free-ai/chat — 平台托管免费体验 AI 代理（严格鉴权 + 单人日/月 Token 额度 + 全站日熔断）
  if (method === 'POST' && segments[0] === 'chat' && segments.length === 1) {
    const auth = await requireAuth(db, request);
    if (!config.enabled) {
      return errorResponse(
        request,
        503,
        '平台免费体验通道尚未启用，请使用「借用外部免费 AI 导入」或在设置中绑定自己的 API / 会员账号',
        'FREE_AI_NOT_CONFIGURED',
      );
    }

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
    if (!beforeQuota.vip) {
      if (beforeQuota.site.remaining <= 0) {
        return errorResponse(
          request,
          429,
          '今日全站免费体验额度已用完，明日 0 点刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API',
          'FREE_AI_SITE_LIMIT',
          { quota: beforeQuota },
        );
      }
      if (beforeQuota.daily.remaining <= 0) {
        return errorResponse(
          request,
          429,
          `今日免费体验额度（${Math.round(beforeQuota.daily.limit / 10000)} 万 tokens）已用完，明日 0 点刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API`,
          'FREE_AI_DAILY_LIMIT',
          { quota: beforeQuota },
        );
      }
      if (beforeQuota.monthly.remaining <= 0) {
        return errorResponse(
          request,
          429,
          `本月免费体验额度（${Math.round(beforeQuota.monthly.limit / 10000)} 万 tokens）已用完，下月 1 日刷新；你也可以点「借用外部免费 AI 导入」零成本生成，或在设置中绑定自己的 API`,
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

    const result = await callUpstreamWithRetry(config, upstreamPayload);
    const promptTokens = result.promptTokens || Math.ceil(totalChars / 2.2);
    const completionTokens = result.completionTokens || Math.ceil(result.content.length / 2.2);
    const totalTokens = result.totalTokens || (promptTokens + completionTokens);

    await recordTokenUsage(db, auth.user.id, totalTokens, beforeQuota.dayKey, beforeQuota.monthKey);
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
