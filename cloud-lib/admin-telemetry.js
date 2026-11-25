/**
 * 周游地图开发者后台统计、动态配置与 GitHub 归档共享库（Cloudflare Pages Functions + D1）。
 * 设计原则：
 * - 所有埋点均通过 context.waitUntil 异步落库并静默容错，绝不阻塞主业务接口；
 * - 严守隐私底线：不记录聊天内容、API Key、明文 IP；
 * - 高频指标按天预聚合（telemetry_daily），避免 D1 产生海量明细行。
 */

import { createId, nowIso } from './cloud.js';

export const DEFAULT_GITHUB_REPO = 'Eldonwyd/zhouyou-app';

export const ALLOWED_SETTING_KEYS = new Set([
  'free_ai_enabled',
  'free_ai_model',
  'free_ai_base_url',
  'free_ai_user_daily_tokens',
  'free_ai_user_monthly_tokens',
  'free_ai_site_daily_tokens',
  'free_ai_vip_accounts',
  'announcement_enabled',
  'announcement_title',
  'announcement_body',
  'digest_webhook_url',
  'token_cost_per_million_cny',
]);

export function getBeijingPeriodKeys(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = bj.getUTCFullYear();
  const month = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bj.getUTCDate()).padStart(2, '0');
  return {
    dayKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
  };
}

export function getBeijingDayKeyOffset(offsetDays = 0, now = new Date()) {
  const shifted = new Date(now.getTime() + offsetDays * 86400 * 1000);
  return getBeijingPeriodKeys(shifted).dayKey;
}

export function buildRecentDayKeys(days = 30, now = new Date()) {
  const safeDays = Math.min(180, Math.max(1, Number(days) || 30));
  const keys = [];
  for (let i = safeDays - 1; i >= 0; i -= 1) {
    keys.push(getBeijingDayKeyOffset(-i, now));
  }
  return keys;
}

export function beijingDayStartIso(dayKey) {
  // 北京时间 YYYY-MM-DD 00:00:00 对应的 UTC ISO 字符串
  const ms = Date.parse(`${dayKey}T00:00:00+08:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

let adminTablesReadyPromise = null;

export async function ensureAdminTables(db) {
  if (!db) return;
  if (!adminTablesReadyPromise) {
    adminTablesReadyPromise = (async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS admin_settings (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )
      `).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS telemetry_daily (
          day_key TEXT NOT NULL,
          metric TEXT NOT NULL,
          dimension TEXT NOT NULL DEFAULT '__all__',
          count INTEGER NOT NULL DEFAULT 0,
          extra_num INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (day_key, metric, dimension)
        )
      `).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS free_ai_request_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          model TEXT NOT NULL DEFAULT '',
          status INTEGER NOT NULL DEFAULT 200,
          latency_ms INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          error_code TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )
      `).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS github_daily_snapshots (
          day_key TEXT PRIMARY KEY,
          stars INTEGER NOT NULL DEFAULT 0,
          forks INTEGER NOT NULL DEFAULT 0,
          open_issues INTEGER NOT NULL DEFAULT 0,
          watchers INTEGER NOT NULL DEFAULT 0,
          release_downloads_total INTEGER NOT NULL DEFAULT 0,
          traffic_views_14d INTEGER NOT NULL DEFAULT 0,
          traffic_uniques_14d INTEGER NOT NULL DEFAULT 0,
          traffic_clones_14d INTEGER NOT NULL DEFAULT 0,
          traffic_clones_uniques_14d INTEGER NOT NULL DEFAULT 0,
          referrers_json TEXT NOT NULL DEFAULT '[]',
          paths_json TEXT NOT NULL DEFAULT '[]',
          releases_json TEXT NOT NULL DEFAULT '[]',
          synced_at TEXT NOT NULL
        )
      `).run();
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          target TEXT NOT NULL DEFAULT '',
          detail_json TEXT NOT NULL DEFAULT '{}',
          ip TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )
      `).run();
    })().catch((err) => {
      adminTablesReadyPromise = null;
      throw err;
    });
  }
  return adminTablesReadyPromise;
}

function runInBackground(context, taskPromise) {
  const safe = Promise.resolve(taskPromise).catch(() => {});
  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(safe);
  }
  return safe;
}

/** 异步按天累加聚合指标（绝不阻塞主请求，异常静默吞掉）。 */
export function trackDailyMetric(context, metric, dimension = '__all__', countDelta = 1, extraDelta = 0) {
  const db = context?.env?.DB;
  if (!db || !metric) return;
  const { dayKey } = getBeijingPeriodKeys();
  const safeDim = String(dimension || '__all__').slice(0, 120);
  const safeCount = Math.round(Number(countDelta) || 0);
  const safeExtra = Math.round(Number(extraDelta) || 0);
  const now = nowIso();
  runInBackground(context, (async () => {
    await ensureAdminTables(db);
    await db.prepare(`
      INSERT INTO telemetry_daily (day_key, metric, dimension, count, extra_num, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_key, metric, dimension) DO UPDATE SET
        count = count + excluded.count,
        extra_num = extra_num + excluded.extra_num,
        updated_at = excluded.updated_at
    `).bind(dayKey, String(metric).slice(0, 64), safeDim, safeCount, safeExtra, now).run();
  })());
}

/** 异步记录免费体验 AI 请求元数据（不含任何对话文本），并自动清理 30 天前旧记录。 */
export function logFreeAiRequest(context, {
  userId,
  model = '',
  status = 200,
  latencyMs = 0,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  errorCode = '',
}) {
  const db = context?.env?.DB;
  if (!db || !userId) return;
  const id = createId('ailog');
  const now = nowIso();
  runInBackground(context, (async () => {
    await ensureAdminTables(db);
    await db.prepare(`
      INSERT INTO free_ai_request_logs
        (id, user_id, model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(userId),
      String(model || '').slice(0, 80),
      Math.round(Number(status) || 200),
      Math.max(0, Math.round(Number(latencyMs) || 0)),
      Math.max(0, Math.round(Number(promptTokens) || 0)),
      Math.max(0, Math.round(Number(completionTokens) || 0)),
      Math.max(0, Math.round(Number(totalTokens) || 0)),
      String(errorCode || '').slice(0, 64),
      now,
    ).run();

    // 约 5% 概率顺手清理 30 天前日志，控制 D1 体积
    if (Math.random() < 0.05) {
      const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      await db.prepare('DELETE FROM free_ai_request_logs WHERE created_at < ?').bind(cutoff).run();
    }
  })());
}

/** 读取动态配置表（异常时返回空对象，不影响主流程回退到环境变量）。 */
export async function readAdminSettingsMap(db) {
  if (!db) return {};
  try {
    await ensureAdminTables(db);
    const { results } = await db.prepare('SELECT key, value_text FROM admin_settings').all();
    const map = {};
    for (const row of results || []) {
      map[row.key] = row.value_text;
    }
    return map;
  } catch {
    return {};
  }
}

export async function setAdminSettings(db, updates) {
  await ensureAdminTables(db);
  const now = nowIso();
  const applied = {};
  for (const [key, rawVal] of Object.entries(updates || {})) {
    if (!ALLOWED_SETTING_KEYS.has(key)) continue;
    const val = rawVal === null || rawVal === undefined ? '' : String(rawVal);
    await db.prepare(`
      INSERT INTO admin_settings (key, value_text, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at
    `).bind(key, val, now).run();
    applied[key] = val;
  }
  return applied;
}

export async function recordAdminAudit(db, action, target = '', detail = {}, ip = '') {
  try {
    await ensureAdminTables(db);
    await db.prepare(`
      INSERT INTO admin_audit_logs (id, action, target, detail_json, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      createId('audit'),
      String(action || '').slice(0, 64),
      String(target || '').slice(0, 120),
      JSON.stringify(detail || {}).slice(0, 4000),
      String(ip || '').slice(0, 64),
      nowIso(),
    ).run();
  } catch {
    // ignore audit error
  }
}

export function classifyReleaseAssetPlatform(filename) {
  const name = String(filename || '').toLowerCase();
  if (/hot[-_]?update|manifest\.json|latest.*\.yml/.test(name)) return 'hot-update';
  if (/\.apk$/.test(name)) return 'android';
  if (/\.ipa$/.test(name)) return 'ios';
  if (/\.exe$|\.msi$/.test(name)) return 'win';
  if (/\.dmg$|\.pkg$/.test(name)) return 'mac';
  if (/\.appimage$|\.deb$|\.rpm$/.test(name)) return 'linux';
  if (/\.zip$|\.tar\.gz$/.test(name)) return 'archive';
  return 'other';
}

async function fetchGitHubJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zhouyou-admin-monitor',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    return { ok: false, status: resp.status, data: null };
  }
  const data = await resp.json().catch(() => null);
  return { ok: true, status: resp.status, data };
}

/** 拉取 GitHub 仓库指标、Releases 下载量与 Traffic（需 Token）并归档至 D1。 */
export async function syncGitHubSnapshot(db, { githubToken = '', repo = DEFAULT_GITHUB_REPO } = {}) {
  await ensureAdminTables(db);
  const { dayKey } = getBeijingPeriodKeys();
  const token = String(githubToken || '').trim();

  const [repoRes, releasesRes, viewsRes, clonesRes, referrersRes, pathsRes] = await Promise.all([
    fetchGitHubJson(`https://api.github.com/repos/${repo}`, token),
    fetchGitHubJson(`https://api.github.com/repos/${repo}/releases?per_page=100`, token),
    token ? fetchGitHubJson(`https://api.github.com/repos/${repo}/traffic/views`, token) : Promise.resolve({ ok: false, status: 0, data: null }),
    token ? fetchGitHubJson(`https://api.github.com/repos/${repo}/traffic/clones`, token) : Promise.resolve({ ok: false, status: 0, data: null }),
    token ? fetchGitHubJson(`https://api.github.com/repos/${repo}/traffic/popular/referrers`, token) : Promise.resolve({ ok: false, status: 0, data: null }),
    token ? fetchGitHubJson(`https://api.github.com/repos/${repo}/traffic/popular/paths`, token) : Promise.resolve({ ok: false, status: 0, data: null }),
  ]);

  if (!repoRes.ok && !releasesRes.ok) {
    throw Object.assign(new Error(`GitHub API 请求失败（repo HTTP ${repoRes.status}）`), {
      status: 502,
      code: 'GITHUB_FETCH_FAILED',
    });
  }

  const repoData = repoRes.data || {};
  const releasesRaw = Array.isArray(releasesRes.data) ? releasesRes.data : [];

  let releaseDownloadsTotal = 0;
  const releasesSlim = [];
  for (const r of releasesRaw) {
    if (r.draft) continue;
    let releaseTotal = 0;
    const assets = [];
    for (const a of r.assets || []) {
      const dl = Number(a.download_count) || 0;
      const platform = classifyReleaseAssetPlatform(a.name);
      if (platform !== 'hot-update' && !/\.txt$|\.json$/i.test(a.name || '')) {
        releaseDownloadsTotal += dl;
        releaseTotal += dl;
      }
      assets.push({
        name: a.name,
        platform,
        downloads: dl,
        size: Number(a.size) || 0,
      });
    }
    releasesSlim.push({
      tag_name: r.tag_name,
      name: r.name || r.tag_name,
      published_at: r.published_at || '',
      total_downloads: releaseTotal,
      assets,
    });
  }

  const viewsData = viewsRes.ok && viewsRes.data ? viewsRes.data : null;
  const clonesData = clonesRes.ok && clonesRes.data ? clonesRes.data : null;
  const referrers = referrersRes.ok && Array.isArray(referrersRes.data) ? referrersRes.data.slice(0, 20) : [];
  const paths = pathsRes.ok && Array.isArray(pathsRes.data) ? pathsRes.data.slice(0, 20) : [];

  const now = nowIso();
  await db.prepare(`
    INSERT INTO github_daily_snapshots (
      day_key, stars, forks, open_issues, watchers, release_downloads_total,
      traffic_views_14d, traffic_uniques_14d, traffic_clones_14d, traffic_clones_uniques_14d,
      referrers_json, paths_json, releases_json, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_key) DO UPDATE SET
      stars = excluded.stars,
      forks = excluded.forks,
      open_issues = excluded.open_issues,
      watchers = excluded.watchers,
      release_downloads_total = excluded.release_downloads_total,
      traffic_views_14d = CASE WHEN excluded.traffic_views_14d > 0 THEN excluded.traffic_views_14d ELSE github_daily_snapshots.traffic_views_14d END,
      traffic_uniques_14d = CASE WHEN excluded.traffic_uniques_14d > 0 THEN excluded.traffic_uniques_14d ELSE github_daily_snapshots.traffic_uniques_14d END,
      traffic_clones_14d = CASE WHEN excluded.traffic_clones_14d > 0 THEN excluded.traffic_clones_14d ELSE github_daily_snapshots.traffic_clones_14d END,
      traffic_clones_uniques_14d = CASE WHEN excluded.traffic_clones_uniques_14d > 0 THEN excluded.traffic_clones_uniques_14d ELSE github_daily_snapshots.traffic_clones_uniques_14d END,
      referrers_json = CASE WHEN excluded.referrers_json != '[]' THEN excluded.referrers_json ELSE github_daily_snapshots.referrers_json END,
      paths_json = CASE WHEN excluded.paths_json != '[]' THEN excluded.paths_json ELSE github_daily_snapshots.paths_json END,
      releases_json = excluded.releases_json,
      synced_at = excluded.synced_at
  `).bind(
    dayKey,
    Number(repoData.stargazers_count) || 0,
    Number(repoData.forks_count) || 0,
    Number(repoData.open_issues_count) || 0,
    Number(repoData.subscribers_count || repoData.watchers_count) || 0,
    releaseDownloadsTotal,
    Number(viewsData?.count) || 0,
    Number(viewsData?.uniques) || 0,
    Number(clonesData?.count) || 0,
    Number(clonesData?.uniques) || 0,
    JSON.stringify(referrers),
    JSON.stringify(paths),
    JSON.stringify(releasesSlim.slice(0, 40)),
    now,
  ).run();

  // 把 GitHub 返回的最近 14 天每日 Views/Clones 写入 telemetry_daily，永久留存每日趋势
  if (Array.isArray(viewsData?.views)) {
    for (const item of viewsData.views) {
      const dk = String(item.timestamp || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      await db.prepare(`
        INSERT INTO telemetry_daily (day_key, metric, dimension, count, extra_num, updated_at)
        VALUES (?, 'github_views', '__all__', ?, ?, ?)
        ON CONFLICT(day_key, metric, dimension) DO UPDATE SET
          count = excluded.count,
          extra_num = excluded.extra_num,
          updated_at = excluded.updated_at
      `).bind(dk, Number(item.count) || 0, Number(item.uniques) || 0, now).run();
    }
  }
  if (Array.isArray(clonesData?.clones)) {
    for (const item of clonesData.clones) {
      const dk = String(item.timestamp || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      await db.prepare(`
        INSERT INTO telemetry_daily (day_key, metric, dimension, count, extra_num, updated_at)
        VALUES (?, 'github_clones', '__all__', ?, ?, ?)
        ON CONFLICT(day_key, metric, dimension) DO UPDATE SET
          count = excluded.count,
          extra_num = excluded.extra_num,
          updated_at = excluded.updated_at
      `).bind(dk, Number(item.count) || 0, Number(item.uniques) || 0, now).run();
    }
  }

  return {
    dayKey,
    stars: Number(repoData.stargazers_count) || 0,
    forks: Number(repoData.forks_count) || 0,
    openIssues: Number(repoData.open_issues_count) || 0,
    releaseDownloadsTotal,
    trafficAvailable: Boolean(viewsData),
    trafficStatus: viewsRes.status,
    trafficViews14d: Number(viewsData?.count) || 0,
    trafficUniques14d: Number(viewsData?.uniques) || 0,
    trafficClones14d: Number(clonesData?.count) || 0,
    syncedAt: now,
  };
}

/** 推送今日简报到飞书 / 钉钉 / 企业微信 / Telegram / 通用 Webhook。 */
export async function sendWebhookDigest(webhookUrl, title, lines) {
  const url = String(webhookUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('请先配置合法的 Webhook URL'), { status: 400, code: 'INVALID_WEBHOOK' });
  }
  const text = `${title}\n${lines.join('\n')}`;
  const lower = url.toLowerCase();
  let payload;
  if (lower.includes('open.feishu.cn') || lower.includes('open.larksuite.com')) {
    payload = { msg_type: 'text', content: { text } };
  } else if (lower.includes('oapi.dingtalk.com')) {
    payload = { msgtype: 'text', text: { content: text } };
  } else if (lower.includes('qyapi.weixin.qq.com')) {
    payload = { msgtype: 'text', text: { content: text } };
  } else if (lower.includes('api.telegram.org')) {
    payload = { text };
  } else {
    payload = { title, text, lines };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await resp.text().catch(() => '');
  return {
    ok: resp.ok,
    status: resp.status,
    body: body.slice(0, 300),
  };
}
