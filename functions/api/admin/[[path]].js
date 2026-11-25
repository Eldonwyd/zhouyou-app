/**
 * 周游地图开发者后台管理接口（Cloudflare Pages Function: /api/admin/*）。
 * 安全约束：
 * - 强制要求 Cloudflare 环境变量配置 ADMIN_API_KEY（未配置时直接 503 拒绝一切请求）；
 * - 采用恒定时间密钥比对 + 连续错误 5 次按 IP 锁定 15 分钟；
 * - 所有配置变更、用户管理操作均写入 admin_audit_logs 审计日志。
 */

import {
  checkRateLimit,
  errorResponse,
  getClientIp,
  getDb,
  jsonResponse,
  parseRouteSegments,
  readJsonBody,
  withApiHandler,
} from '../../../cloud-lib/cloud.js';
import {
  DEFAULT_GITHUB_REPO,
  beijingDayStartIso,
  buildRecentDayKeys,
  ensureAdminTables,
  getBeijingDayKeyOffset,
  getBeijingPeriodKeys,
  readAdminSettingsMap,
  recordAdminAudit,
  sendWebhookDigest,
  setAdminSettings,
  syncGitHubSnapshot,
} from '../../../cloud-lib/admin-telemetry.js';

const SITE_BUCKET_ID = '__SITE__';

function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (!sa || !sb || sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

function extractAdminKey(request) {
  const direct = request.headers.get('X-Admin-Key') || request.headers.get('x-admin-key');
  if (direct) return direct.trim();
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

async function requireAdminKey(context, db) {
  const expected = String(context?.env?.ADMIN_API_KEY || '').trim();
  if (!expected) {
    throw Object.assign(
      new Error('服务端尚未配置 ADMIN_API_KEY（请在 Cloudflare Pages 环境变量中添加加密密钥）'),
      { status: 503, code: 'ADMIN_KEY_NOT_CONFIGURED' },
    );
  }
  const ip = getClientIp(context.request);
  const provided = extractAdminKey(context.request);
  if (!safeEqual(provided, expected)) {
    const rl = await checkRateLimit(db, `admin_auth_fail:${ip}`, 5, 900);
    if (!rl.allowed) {
      throw Object.assign(
        new Error(`密钥错误次数过多，已暂时锁定（${rl.retryAfter} 秒后重试）`),
        { status: 429, code: 'ADMIN_LOCKED' },
      );
    }
    throw Object.assign(new Error('管理员密钥无效，拒绝访问'), { status: 401, code: 'ADMIN_UNAUTHORIZED' });
  }
  return { ip };
}

async function safeCount(db, sql, ...binds) {
  try {
    const row = await db.prepare(sql).bind(...binds).first();
    return Number(row?.c ?? row?.total ?? 0) || 0;
  } catch {
    return 0;
  }
}

async function safeAll(db, sql, ...binds) {
  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function safeFirst(db, sql, ...binds) {
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

function parseJsonSafe(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildEffectiveConfig(env, settingsMap) {
  const vipCombined = [env?.FREE_AI_VIP_ACCOUNTS || '', settingsMap.free_ai_vip_accounts || '']
    .filter(Boolean)
    .join(',');
  const vipList = Array.from(new Set(
    vipCombined
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  ));
  const enabledStr = String(settingsMap.free_ai_enabled || '').trim().toLowerCase();
  const freeAiEnabled = Boolean(env?.FREE_AI_API_KEY) && (enabledStr === '' || (enabledStr !== 'false' && enabledStr !== '0'));
  const rawMult = settingsMap.free_ai_vip_multiplier !== undefined && settingsMap.free_ai_vip_multiplier !== ''
    ? settingsMap.free_ai_vip_multiplier
    : env?.FREE_AI_VIP_MULTIPLIER;
  const parsedMult = rawMult !== undefined && String(rawMult).trim() !== '' ? Number(rawMult) : 3;
  const vipMultiplier = Number.isFinite(parsedMult) && parsedMult >= 0 ? parsedMult : 3;
  return {
    freeAiHasKey: Boolean(env?.FREE_AI_API_KEY),
    freeAiEnabled,
    freeAiModel: settingsMap.free_ai_model || env?.FREE_AI_MODEL || 'glm-5.3-flash',
    freeAiBaseUrl: settingsMap.free_ai_base_url || env?.FREE_AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    userDailyLimit: Number(settingsMap.free_ai_user_daily_tokens || env?.FREE_AI_USER_DAILY_TOKENS || 50000),
    userMonthlyLimit: Number(settingsMap.free_ai_user_monthly_tokens || env?.FREE_AI_USER_MONTHLY_TOKENS || 120000),
    siteDailyLimit: Number(settingsMap.free_ai_site_daily_tokens || env?.FREE_AI_SITE_DAILY_TOKENS || 500000),
    vipMultiplier,
    vipAccounts: vipList,
    vipAccountsDynamic: settingsMap.free_ai_vip_accounts || '',
    announcementEnabled: settingsMap.announcement_enabled === 'true' || settingsMap.announcement_enabled === '1',
    announcementTitle: settingsMap.announcement_title || '',
    announcementBody: settingsMap.announcement_body || '',
    digestWebhookUrl: settingsMap.digest_webhook_url || '',
    tokenCostPerMillionCny: Number(settingsMap.token_cost_per_million_cny || 1),
  };
}

async function computeOverview(db, env) {
  const { dayKey, monthKey } = getBeijingPeriodKeys();
  const yesterdayKey = getBeijingDayKeyOffset(-1);
  const todayStart = beijingDayStartIso(dayKey);
  const yesterdayStart = beijingDayStartIso(yesterdayKey);
  const d7Start = beijingDayStartIso(getBeijingDayKeyOffset(-6));
  const d30Start = beijingDayStartIso(getBeijingDayKeyOffset(-29));
  const online15mCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const settingsMap = await readAdminSettingsMap(db);
  const effectiveConfig = buildEffectiveConfig(env, settingsMap);

  const [
    totalUsers,
    newUsersToday,
    newUsersYesterday,
    newUsers7d,
    newUsers30d,
    dau,
    wau,
    mau,
    online15m,
    platformRows,
    siteAiToday,
    siteAiMonth,
    aiUsersToday,
    aiLogsToday,
    todayLogins,
    todayDownloads,
    downloads30d,
    todayAiProxy,
    todayShareViews,
    totalGroups,
    totalPlans,
    totalShares,
    syncStats,
    latestGh,
    retentionCohort,
  ] = await Promise.all([
    safeCount(db, 'SELECT COUNT(*) AS c FROM users'),
    safeCount(db, 'SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', todayStart),
    safeCount(db, 'SELECT COUNT(*) AS c FROM users WHERE created_at >= ? AND created_at < ?', yesterdayStart, todayStart),
    safeCount(db, 'SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', d7Start),
    safeCount(db, 'SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', d30Start),
    safeCount(db, 'SELECT COUNT(DISTINCT user_id) AS c FROM user_sessions WHERE last_seen_at >= ?', todayStart),
    safeCount(db, 'SELECT COUNT(DISTINCT user_id) AS c FROM user_sessions WHERE last_seen_at >= ?', d7Start),
    safeCount(db, 'SELECT COUNT(DISTINCT user_id) AS c FROM user_sessions WHERE last_seen_at >= ?', d30Start),
    safeCount(db, 'SELECT COUNT(DISTINCT user_id) AS c FROM user_sessions WHERE last_seen_at >= ?', online15mCutoff),
    safeAll(
      db,
      `SELECT platform, COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS users
       FROM user_sessions WHERE last_seen_at >= ? GROUP BY platform`,
      d30Start,
    ),
    safeFirst(
      db,
      'SELECT tokens_used, requests_count FROM free_ai_usage_daily WHERE user_id = ? AND day_key = ?',
      SITE_BUCKET_ID,
      dayKey,
    ),
    safeFirst(
      db,
      'SELECT SUM(tokens_used) AS tokens_used, SUM(requests_count) AS requests_count FROM free_ai_usage_monthly WHERE month_key = ?',
      monthKey,
    ),
    safeCount(
      db,
      'SELECT COUNT(*) AS c FROM free_ai_usage_daily WHERE day_key = ? AND user_id != ?',
      dayKey,
      SITE_BUCKET_ID,
    ),
    safeAll(
      db,
      'SELECT status, latency_ms FROM free_ai_request_logs WHERE created_at >= ?',
      todayStart,
    ),
    safeCount(
      db,
      "SELECT SUM(count) AS c FROM telemetry_daily WHERE day_key = ? AND metric = 'auth_login'",
      dayKey,
    ),
    safeCount(
      db,
      "SELECT SUM(count) AS c FROM telemetry_daily WHERE day_key = ? AND metric = 'download_platform' AND dimension != 'hot-update'",
      dayKey,
    ),
    safeCount(
      db,
      "SELECT SUM(count) AS c FROM telemetry_daily WHERE day_key >= ? AND metric = 'download_platform' AND dimension != 'hot-update'",
      getBeijingDayKeyOffset(-29),
    ),
    safeCount(
      db,
      "SELECT SUM(count) AS c FROM telemetry_daily WHERE day_key = ? AND metric = 'ai_proxy_host'",
      dayKey,
    ),
    safeCount(
      db,
      "SELECT SUM(count) AS c FROM telemetry_daily WHERE day_key = ? AND metric = 'share_view'",
      dayKey,
    ),
    safeCount(db, 'SELECT COUNT(*) AS c FROM travel_groups'),
    safeCount(db, 'SELECT COUNT(*) AS c FROM ai_plans'),
    safeCount(db, 'SELECT COUNT(*) AS c FROM plan_shares'),
    safeFirst(db, 'SELECT COUNT(*) AS records, SUM(byte_size) AS total_bytes FROM user_records WHERE deleted_at IS NULL'),
    safeFirst(db, 'SELECT * FROM github_daily_snapshots ORDER BY day_key DESC LIMIT 1'),
    // 简化 7 日留存：近 14~7 天注册用户中，在最近 7 天仍有活跃的比例
    safeFirst(
      db,
      `SELECT
         COUNT(*) AS cohort_size,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM user_sessions s WHERE s.user_id = u.id AND s.last_seen_at >= ?
         ) THEN 1 ELSE 0 END) AS retained
       FROM users u
       WHERE u.created_at >= ? AND u.created_at < ?`,
      d7Start,
      beijingDayStartIso(getBeijingDayKeyOffset(-14)),
      d7Start,
    ),
  ]);

  const latencies = aiLogsToday.map((r) => Number(r.latency_ms) || 0).filter((n) => n > 0).sort((a, b) => a - b);
  const okCount = aiLogsToday.filter((r) => Number(r.status) === 200).length;
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95LatencyMs = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;

  const siteTokensToday = Number(siteAiToday?.tokens_used || 0);
  const siteTokensMonth = Number(siteAiMonth?.tokens_used || 0);
  const costRate = effectiveConfig.tokenCostPerMillionCny;
  const estimatedCostTodayCny = Number(((siteTokensToday / 1_000_000) * costRate).toFixed(4));
  const estimatedCostMonthCny = Number(((siteTokensMonth / 1_000_000) * costRate).toFixed(4));

  const cohortSize = Number(retentionCohort?.cohort_size || 0);
  const retained = Number(retentionCohort?.retained || 0);
  const retention7dRate = cohortSize > 0 ? Number(((retained / cohortSize) * 100).toFixed(1)) : null;

  return {
    dayKey,
    monthKey,
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers,
      newToday: newUsersToday,
      newYesterday: newUsersYesterday,
      new7d: newUsers7d,
      new30d: newUsers30d,
      dau,
      wau,
      mau,
      online15m,
      loginsToday: todayLogins,
      retention7dRate,
      retentionCohortSize: cohortSize,
      platforms30d: platformRows.map((r) => ({
        platform: r.platform || 'web',
        sessions: Number(r.sessions) || 0,
        users: Number(r.users) || 0,
      })),
    },
    ai: {
      enabled: effectiveConfig.freeAiEnabled,
      model: effectiveConfig.freeAiModel,
      todayTokens: siteTokensToday,
      todayLimit: effectiveConfig.siteDailyLimit,
      todayUsagePct: effectiveConfig.siteDailyLimit > 0
        ? Number(((siteTokensToday / effectiveConfig.siteDailyLimit) * 100).toFixed(1))
        : 0,
      todayRequests: Number(siteAiToday?.requests_count || 0),
      todayActiveUsers: aiUsersToday,
      monthTokens: siteTokensMonth,
      monthRequests: Number(siteAiMonth?.requests_count || 0),
      estimatedCostTodayCny,
      estimatedCostMonthCny,
      successRateToday: aiLogsToday.length ? Number(((okCount / aiLogsToday.length) * 100).toFixed(1)) : 100,
      avgLatencyMs,
      p95LatencyMs,
      proxyCallsToday: todayAiProxy,
    },
    downloads: {
      siteToday: todayDownloads,
      site30d: downloads30d,
      githubReleasesTotal: Number(latestGh?.release_downloads_total || 0),
    },
    github: latestGh
      ? {
          dayKey: latestGh.day_key,
          stars: Number(latestGh.stars) || 0,
          forks: Number(latestGh.forks) || 0,
          openIssues: Number(latestGh.open_issues) || 0,
          releaseDownloadsTotal: Number(latestGh.release_downloads_total) || 0,
          trafficViews14d: Number(latestGh.traffic_views_14d) || 0,
          trafficUniques14d: Number(latestGh.traffic_uniques_14d) || 0,
          trafficClones14d: Number(latestGh.traffic_clones_14d) || 0,
          trafficClonesUniques14d: Number(latestGh.traffic_clones_uniques_14d) || 0,
          syncedAt: latestGh.synced_at,
        }
      : null,
    social: {
      totalGroups,
      totalPlans,
      totalShares,
      shareViewsToday: todayShareViews,
      syncedRecords: Number(syncStats?.records || 0),
      syncedBytes: Number(syncStats?.total_bytes || 0),
    },
  };
}

export const onRequest = withApiHandler(async (context) => {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const segments = parseRouteSegments(context);
  const db = getDb(context);
  await ensureAdminTables(db);
  const { ip } = await requireAdminKey(context, db);

  const action = segments[0] || 'overview';
  const url = new URL(request.url);

  // GET /api/admin/overview
  if (method === 'GET' && action === 'overview') {
    const overview = await computeOverview(db, env);
    return jsonResponse(request, 200, { ok: true, overview });
  }

  // GET /api/admin/trends?days=30
  if (method === 'GET' && action === 'trends') {
    const days = Math.min(180, Math.max(7, Number(url.searchParams.get('days')) || 30));
    const dayKeys = buildRecentDayKeys(days);
    const startKey = dayKeys[0];
    const startIso = beijingDayStartIso(startKey);

    const [
      regRows,
      aiRows,
      telemetryRows,
      ghRows,
    ] = await Promise.all([
      safeAll(
        db,
        `SELECT substr(datetime(created_at, '+8 hours'), 1, 10) AS dk, COUNT(*) AS c
         FROM users WHERE created_at >= ? GROUP BY dk`,
        startIso,
      ),
      safeAll(
        db,
        `SELECT day_key AS dk, tokens_used, requests_count
         FROM free_ai_usage_daily WHERE user_id = ? AND day_key >= ?`,
        SITE_BUCKET_ID,
        startKey,
      ),
      safeAll(
        db,
        `SELECT day_key AS dk, metric, dimension, count, extra_num
         FROM telemetry_daily WHERE day_key >= ?`,
        startKey,
      ),
      safeAll(
        db,
        `SELECT day_key AS dk, stars, release_downloads_total, traffic_views_14d, traffic_uniques_14d
         FROM github_daily_snapshots WHERE day_key >= ? ORDER BY day_key ASC`,
        startKey,
      ),
    ]);

    const regMap = new Map(regRows.map((r) => [r.dk, Number(r.c) || 0]));
    const aiMap = new Map(aiRows.map((r) => [r.dk, { tokens: Number(r.tokens_used) || 0, requests: Number(r.requests_count) || 0 }]));
    const ghMap = new Map(ghRows.map((r) => [r.dk, r]));

    const loginMap = new Map();
    const downloadMap = new Map();
    const proxyMap = new Map();
    const ghViewsMap = new Map();
    const ghUniquesMap = new Map();
    for (const r of telemetryRows) {
      const c = Number(r.count) || 0;
      if (r.metric === 'auth_login') {
        loginMap.set(r.dk, (loginMap.get(r.dk) || 0) + c);
      } else if (r.metric === 'download_platform' && r.dimension !== 'hot-update') {
        downloadMap.set(r.dk, (downloadMap.get(r.dk) || 0) + c);
      } else if (r.metric === 'ai_proxy_host') {
        proxyMap.set(r.dk, (proxyMap.get(r.dk) || 0) + c);
      } else if (r.metric === 'github_views') {
        ghViewsMap.set(r.dk, c);
        ghUniquesMap.set(r.dk, Number(r.extra_num) || 0);
      }
    }

    const series = dayKeys.map((dk) => ({
      dayKey: dk,
      registrations: regMap.get(dk) || 0,
      logins: loginMap.get(dk) || 0,
      freeAiTokens: aiMap.get(dk)?.tokens || 0,
      freeAiRequests: aiMap.get(dk)?.requests || 0,
      siteDownloads: downloadMap.get(dk) || 0,
      aiProxyCalls: proxyMap.get(dk) || 0,
      githubViews: ghViewsMap.get(dk) || 0,
      githubUniques: ghUniquesMap.get(dk) || 0,
      githubStars: ghMap.has(dk) ? Number(ghMap.get(dk).stars) || 0 : null,
      githubReleaseDownloads: ghMap.has(dk) ? Number(ghMap.get(dk).release_downloads_total) || 0 : null,
    }));

    return jsonResponse(request, 200, { ok: true, days, series });
  }

  // GET /api/admin/ai?days=7
  if (method === 'GET' && action === 'ai') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
    const { dayKey, monthKey } = getBeijingPeriodKeys();
    const startKey = getBeijingDayKeyOffset(-(days - 1));
    const startIso = beijingDayStartIso(startKey);

    const [
      topToday,
      topMonth,
      recentLogs,
      statusStats,
      proxyHosts,
      proxyStatuses,
    ] = await Promise.all([
      safeAll(
        db,
        `SELECT f.user_id, f.tokens_used, f.requests_count, f.updated_at,
                u.nickname, u.friend_code, u.email_norm, u.phone_norm
         FROM free_ai_usage_daily f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.day_key = ? AND f.user_id != ?
         ORDER BY f.tokens_used DESC LIMIT 20`,
        dayKey,
        SITE_BUCKET_ID,
      ),
      safeAll(
        db,
        `SELECT f.user_id, f.tokens_used, f.requests_count, f.updated_at,
                u.nickname, u.friend_code, u.email_norm, u.phone_norm
         FROM free_ai_usage_monthly f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.month_key = ? AND f.user_id != ?
         ORDER BY f.tokens_used DESC LIMIT 20`,
        monthKey,
        SITE_BUCKET_ID,
      ),
      safeAll(
        db,
        `SELECT l.id, l.user_id, u.nickname, l.model, l.status, l.latency_ms,
                l.prompt_tokens, l.completion_tokens, l.total_tokens, l.error_code, l.created_at
         FROM free_ai_request_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.created_at DESC LIMIT 60`,
      ),
      safeAll(
        db,
        `SELECT status, COUNT(*) AS c, AVG(latency_ms) AS avg_ms
         FROM free_ai_request_logs WHERE created_at >= ? GROUP BY status ORDER BY c DESC`,
        startIso,
      ),
      safeAll(
        db,
        `SELECT dimension AS host, SUM(count) AS calls, SUM(extra_num) AS total_ms
         FROM telemetry_daily
         WHERE metric = 'ai_proxy_host' AND day_key >= ?
         GROUP BY dimension ORDER BY calls DESC LIMIT 20`,
        startKey,
      ),
      safeAll(
        db,
        `SELECT dimension AS bucket, SUM(count) AS calls
         FROM telemetry_daily
         WHERE metric = 'ai_proxy_status' AND day_key >= ?
         GROUP BY dimension ORDER BY calls DESC`,
        startKey,
      ),
    ]);

    return jsonResponse(request, 200, {
      ok: true,
      dayKey,
      monthKey,
      days,
      topToday,
      topMonth,
      recentLogs,
      statusStats: statusStats.map((r) => ({
        status: Number(r.status) || 0,
        count: Number(r.c) || 0,
        avgMs: Math.round(Number(r.avg_ms) || 0),
      })),
      proxyHosts: proxyHosts.map((r) => ({
        host: r.host,
        calls: Number(r.calls) || 0,
        avgMs: Number(r.calls) > 0 ? Math.round((Number(r.total_ms) || 0) / Number(r.calls)) : 0,
      })),
      proxyStatuses: proxyStatuses.map((r) => ({
        bucket: r.bucket,
        calls: Number(r.calls) || 0,
      })),
    });
  }

  // GET /api/admin/downloads?days=30
  if (method === 'GET' && action === 'downloads') {
    const days = Math.min(180, Math.max(7, Number(url.searchParams.get('days')) || 30));
    const startKey = getBeijingDayKeyOffset(-(days - 1));

    const [byPlatform, byRegion, byAsset, latestGh] = await Promise.all([
      safeAll(
        db,
        `SELECT dimension AS platform, SUM(count) AS c
         FROM telemetry_daily WHERE metric = 'download_platform' AND day_key >= ?
         GROUP BY dimension ORDER BY c DESC`,
        startKey,
      ),
      safeAll(
        db,
        `SELECT dimension AS region, SUM(count) AS c
         FROM telemetry_daily WHERE metric = 'download_region' AND day_key >= ?
         GROUP BY dimension ORDER BY c DESC LIMIT 25`,
        startKey,
      ),
      safeAll(
        db,
        `SELECT dimension AS asset, SUM(count) AS c
         FROM telemetry_daily WHERE metric = 'download_asset' AND day_key >= ?
         GROUP BY dimension ORDER BY c DESC LIMIT 30`,
        startKey,
      ),
      safeFirst(db, 'SELECT day_key, release_downloads_total, releases_json, synced_at FROM github_daily_snapshots ORDER BY day_key DESC LIMIT 1'),
    ]);

    const githubReleases = latestGh ? parseJsonSafe(latestGh.releases_json, []) : [];
    const githubByPlatform = {};
    for (const r of githubReleases) {
      for (const a of r.assets || []) {
        if (a.platform === 'hot-update' || /\.txt$|\.json$/i.test(a.name || '')) continue;
        githubByPlatform[a.platform] = (githubByPlatform[a.platform] || 0) + (Number(a.downloads) || 0);
      }
    }

    return jsonResponse(request, 200, {
      ok: true,
      days,
      siteByPlatform: byPlatform.map((r) => ({ platform: r.platform, count: Number(r.c) || 0 })),
      siteByRegion: byRegion.map((r) => ({ region: r.region, count: Number(r.c) || 0 })),
      siteTopAssets: byAsset.map((r) => {
        const [tag, file] = String(r.asset || '').split('|');
        return { tag: tag || '', file: file || r.asset, count: Number(r.c) || 0 };
      }),
      githubSyncedAt: latestGh?.synced_at || null,
      githubTotalDownloads: Number(latestGh?.release_downloads_total || 0),
      githubByPlatform,
      githubReleases,
    });
  }

  // GET /api/admin/github
  if (method === 'GET' && action === 'github' && segments.length === 1) {
    const [latest, history] = await Promise.all([
      safeFirst(db, 'SELECT * FROM github_daily_snapshots ORDER BY day_key DESC LIMIT 1'),
      safeAll(
        db,
        `SELECT day_key, stars, forks, open_issues, release_downloads_total,
                traffic_views_14d, traffic_uniques_14d, traffic_clones_14d, traffic_clones_uniques_14d, synced_at
         FROM github_daily_snapshots ORDER BY day_key DESC LIMIT 60`,
      ),
    ]);
    return jsonResponse(request, 200, {
      ok: true,
      repo: DEFAULT_GITHUB_REPO,
      latest: latest
        ? {
            dayKey: latest.day_key,
            stars: Number(latest.stars) || 0,
            forks: Number(latest.forks) || 0,
            openIssues: Number(latest.open_issues) || 0,
            watchers: Number(latest.watchers) || 0,
            releaseDownloadsTotal: Number(latest.release_downloads_total) || 0,
            trafficViews14d: Number(latest.traffic_views_14d) || 0,
            trafficUniques14d: Number(latest.traffic_uniques_14d) || 0,
            trafficClones14d: Number(latest.traffic_clones_14d) || 0,
            trafficClonesUniques14d: Number(latest.traffic_clones_uniques_14d) || 0,
            referrers: parseJsonSafe(latest.referrers_json, []),
            paths: parseJsonSafe(latest.paths_json, []),
            releases: parseJsonSafe(latest.releases_json, []),
            syncedAt: latest.synced_at,
          }
        : null,
      history: history.reverse(),
    });
  }

  // POST /api/admin/github/sync
  if (method === 'POST' && action === 'github' && segments[1] === 'sync') {
    const body = await readJsonBody(request, 16384);
    const token = String(body.githubToken || env?.GITHUB_TOKEN || '').trim();
    const result = await syncGitHubSnapshot(db, { githubToken: token, repo: DEFAULT_GITHUB_REPO });
    await recordAdminAudit(db, 'github_sync', DEFAULT_GITHUB_REPO, { trafficAvailable: result.trafficAvailable, stars: result.stars }, ip);
    return jsonResponse(request, 200, { ok: true, snapshot: result });
  }

  // GET /api/admin/users?q=&page=1&limit=30
  if (method === 'GET' && action === 'users' && segments.length === 1) {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(5, Number(url.searchParams.get('limit')) || 30));
    const offset = (page - 1) * limit;
    const { dayKey, monthKey } = getBeijingPeriodKeys();
    const settingsMap = await readAdminSettingsMap(db);
    const cfg = buildEffectiveConfig(env, settingsMap);
    const vipSet = new Set(cfg.vipAccounts.map((s) => s.toLowerCase()));

    const like = `%${q}%`;
    const whereClause = q
      ? 'WHERE (u.nickname_norm LIKE ? OR u.email_norm LIKE ? OR u.phone_norm LIKE ? OR LOWER(u.friend_code) LIKE ? OR u.id = ?)'
      : '';
    const binds = q ? [like, like, like, like, q] : [];

    const total = await safeCount(db, `SELECT COUNT(*) AS c FROM users u ${whereClause}`, ...binds);
    const rows = await safeAll(
      db,
      `SELECT
         u.id, u.nickname, u.nickname_norm, u.friend_code, u.email_norm, u.phone_norm,
         u.security_fail_count, u.security_locked_until, u.created_at,
         (SELECT MAX(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at,
         (SELECT GROUP_CONCAT(DISTINCT s.platform) FROM user_sessions s WHERE s.user_id = u.id) AS platforms,
         (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id) AS session_count,
         (SELECT COALESCE(SUM(r.byte_size), 0) FROM user_records r WHERE r.user_id = u.id AND r.deleted_at IS NULL) AS cloud_bytes,
         (SELECT tokens_used FROM free_ai_usage_daily d WHERE d.user_id = u.id AND d.day_key = ?) AS ai_today_tokens,
         (SELECT tokens_used FROM free_ai_usage_monthly m WHERE m.user_id = u.id AND m.month_key = ?) AS ai_month_tokens
       FROM users u
       ${whereClause}
       ORDER BY COALESCE(last_seen_at, u.created_at) DESC
       LIMIT ? OFFSET ?`,
      dayKey,
      monthKey,
      ...binds,
      limit,
      offset,
    );

    const items = rows.map((u) => {
      const candidates = [u.id, u.email_norm, u.phone_norm, u.nickname_norm, u.friend_code]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      const isVip = candidates.some((c) => vipSet.has(c));
      const isLocked = Boolean(u.security_locked_until && Date.parse(u.security_locked_until) > Date.now());
      return {
        id: u.id,
        nickname: u.nickname,
        friendCode: u.friend_code,
        email: u.email_norm || '',
        phone: u.phone_norm || '',
        createdAt: u.created_at,
        lastSeenAt: u.last_seen_at || u.created_at,
        platforms: u.platforms ? String(u.platforms).split(',') : [],
        sessionCount: Number(u.session_count) || 0,
        cloudBytes: Number(u.cloud_bytes) || 0,
        aiTodayTokens: Number(u.ai_today_tokens) || 0,
        aiMonthTokens: Number(u.ai_month_tokens) || 0,
        isVip,
        isLocked,
        securityFailCount: Number(u.security_fail_count) || 0,
      };
    });

    return jsonResponse(request, 200, { ok: true, page, limit, total, vipMultiplier: cfg.vipMultiplier, items });
  }

  // POST /api/admin/users/:id/action
  if (method === 'POST' && action === 'users' && segments.length === 3 && segments[2] === 'action') {
    const userId = segments[1];
    const body = await readJsonBody(request, 8192);
    const op = String(body.action || '').trim();
    const user = await safeFirst(db, 'SELECT id, nickname, friend_code, email_norm, phone_norm, nickname_norm FROM users WHERE id = ?', userId);
    if (!user) {
      return errorResponse(request, 404, '未找到对应用户', 'USER_NOT_FOUND');
    }

    if (op === 'unlock_security') {
      await db
        .prepare('UPDATE users SET security_fail_count = 0, security_locked_until = NULL WHERE id = ?')
        .bind(userId)
        .run();
      await recordAdminAudit(db, 'unlock_security', user.nickname, { userId }, ip);
      return jsonResponse(request, 200, { ok: true, message: `已解除 ${user.nickname} 的密保锁定` });
    }

    if (op === 'kick_sessions') {
      await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();
      await recordAdminAudit(db, 'kick_sessions', user.nickname, { userId }, ip);
      return jsonResponse(request, 200, { ok: true, message: `已强制下线 ${user.nickname} 的全部设备` });
    }

    if (op === 'toggle_vip') {
      const settingsMap = await readAdminSettingsMap(db);
      const currentList = String(settingsMap.free_ai_vip_accounts || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const key = user.friend_code || user.id;
      const lowerSet = new Set(currentList.map((s) => s.toLowerCase()));
      const userCandidates = new Set(
        [user.id, user.friend_code, user.email_norm, user.phone_norm, user.nickname_norm]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase()),
      );
      let nextList;
      let added;
      if ([...userCandidates].some((c) => lowerSet.has(c))) {
        nextList = currentList.filter((item) => !userCandidates.has(item.toLowerCase()));
        added = false;
      } else {
        nextList = [...currentList, key];
        added = true;
      }
      await setAdminSettings(db, { free_ai_vip_accounts: nextList.join(',') });
      await recordAdminAudit(db, added ? 'add_vip' : 'remove_vip', user.nickname, { userId, key }, ip);
      return jsonResponse(request, 200, {
        ok: true,
        isVip: added,
        message: added ? `已将 ${user.nickname} 加入免费 AI VIP 白名单` : `已将 ${user.nickname} 移出动态 VIP 白名单`,
      });
    }

    return errorResponse(request, 400, '不支持的操作类型', 'UNSUPPORTED_ACTION');
  }

  // GET /api/admin/settings
  if (method === 'GET' && action === 'settings') {
    const settingsMap = await readAdminSettingsMap(db);
    const effective = buildEffectiveConfig(env, settingsMap);
    return jsonResponse(request, 200, { ok: true, effective, overrides: settingsMap });
  }

  // PUT /api/admin/settings
  if (method === 'PUT' && action === 'settings') {
    const body = await readJsonBody(request, 32768);
    const applied = await setAdminSettings(db, body.settings || body);
    await recordAdminAudit(db, 'update_settings', 'admin_settings', { keys: Object.keys(applied) }, ip);
    const settingsMap = await readAdminSettingsMap(db);
    return jsonResponse(request, 200, {
      ok: true,
      applied,
      effective: buildEffectiveConfig(env, settingsMap),
    });
  }

  // GET /api/admin/audit
  if (method === 'GET' && action === 'audit') {
    const logs = await safeAll(db, 'SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 100');
    return jsonResponse(request, 200, {
      ok: true,
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        detail: parseJsonSafe(l.detail_json, {}),
        ip: l.ip,
        createdAt: l.created_at,
      })),
    });
  }

  // POST /api/admin/digest/send
  if (method === 'POST' && action === 'digest' && segments[1] === 'send') {
    const body = await readJsonBody(request, 16384);
    const overview = await computeOverview(db, env);
    const settingsMap = await readAdminSettingsMap(db);
    const webhookUrl = String(body.webhookUrl || settingsMap.digest_webhook_url || '').trim();
    const title = `【周游地图日报】${overview.dayKey}`;
    const lines = [
      `👥 用户：今日新增 ${overview.users.newToday} 人（总 ${overview.users.total}）| DAU ${overview.users.dau} | 30日MAU ${overview.users.mau}`,
      `📥 下载：今日站内加速 ${overview.downloads.siteToday} 次 | GitHub Releases 累计 ${overview.downloads.githubReleasesTotal} 次`,
      `🤖 免费AI：今日 ${(overview.ai.todayTokens / 10000).toFixed(2)} 万 tokens（${overview.ai.todayUsagePct}% 水位，${overview.ai.todayRequests} 次请求，成功率 ${overview.ai.successRateToday}%）`,
      `🔁 自带Key转发：今日 ${overview.ai.proxyCallsToday} 次`,
      overview.github
        ? `⭐ GitHub：${overview.github.stars} Stars | 14日浏览 ${overview.github.trafficViews14d}（独立 ${overview.github.trafficUniques14d}）`
        : '⭐ GitHub：尚未同步快照',
    ];

    if (body.dryRun) {
      return jsonResponse(request, 200, { ok: true, dryRun: true, title, text: `${title}\n${lines.join('\n')}` });
    }
    const result = await sendWebhookDigest(webhookUrl, title, lines);
    await recordAdminAudit(db, 'send_digest', 'webhook', { ok: result.ok, status: result.status }, ip);
    return jsonResponse(request, result.ok ? 200 : 502, { ok: result.ok, result, title, lines });
  }

  return errorResponse(request, 404, '未找到管理员接口', 'ADMIN_NOT_FOUND');
});
