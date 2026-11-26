/**
 * 极轻量、无 Cookie、隐私友好的网页游客访问统计接口（POST /api/visit）。
 * 用途：统计网页版与下载中心的 PV / UV、来源渠道（搜索引擎 / 宣传推文 / 直接访问）、
 * 以及「浏览了网页但未登录、未下载的纯游客」数量与下载转化率。
 * 隐私约束：不存明文 IP，仅用当日加盐 SHA-256 哈希去重，不种 Cookie。
 */

import {
  getClientIp,
  getDb,
  jsonResponse,
  nowIso,
  readJsonBody,
  sha256Hex,
  withApiHandler,
} from '../../cloud-lib/cloud.js';
import {
  ensureAdminTables,
  getBeijingPeriodKeys,
  readAdminSettingsMap,
} from '../../cloud-lib/admin-telemetry.js';

export function classifyReferrerSource(rawReferrer) {
  const ref = String(rawReferrer || '').trim().toLowerCase();
  if (!ref) return 'direct';
  let host = '';
  try {
    host = new URL(ref).hostname.toLowerCase();
  } catch {
    host = ref;
  }
  if (!host || host.includes('zhouyou.online') || host.includes('pages.dev') || host === 'localhost' || host === '127.0.0.1') {
    return 'internal';
  }
  if (host.includes('google.')) return 'search:google';
  if (host.includes('bing.com')) return 'search:bing';
  if (host.includes('baidu.com')) return 'search:baidu';
  if (host.includes('quark.cn') || host.includes('sm.cn')) return 'search:quark';
  if (host.includes('sogou.com') || host.includes('so.com')) return 'search:other';
  if (host.includes('zhihu.com')) return 'promo:zhihu';
  if (host.includes('csdn.net')) return 'promo:csdn';
  if (host.includes('juejin.cn')) return 'promo:juejin';
  if (host.includes('xiaohongshu.com') || host.includes('xhslink.com')) return 'promo:xiaohongshu';
  if (host.includes('bilibili.com') || host.includes('b23.tv')) return 'promo:bilibili';
  if (host.includes('douyin.com')) return 'promo:douyin';
  if (host.includes('coolapk.com')) return 'promo:coolapk';
  if (host.includes('weixin.qq.com') || host.includes('mp.weixin.qq.com')) return 'promo:wechat';
  if (host.includes('github.com') || host.includes('github.io')) return 'promo:github';
  return `ref:${host.slice(0, 48)}`;
}

export async function computeDailyVisitorHash(request, dayKey) {
  const ip = getClientIp(request);
  const ua = (request.headers.get('User-Agent') || '').slice(0, 160);
  const full = await sha256Hex(`zy-visit-v1|${dayKey}|${ip}|${ua}`);
  return full.slice(0, 24);
}

export const onRequest = withApiHandler(async (context) => {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (method !== 'POST') {
    return jsonResponse(request, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const db = getDb(context);
  const body = await readJsonBody(request, 8192);
  const pathStr = String(body.path || '/').trim().slice(0, 120) || '/';
  const rawRef = String(body.referrer || '').trim().slice(0, 300);
  const isDemo = body.isDemo ? 1 : 0;
  const isLoggedIn = body.isLoggedIn ? 1 : 0;
  const didDownload = body.didDownload ? 1 : 0;
  const nickname = String(body.nickname || '').trim().toLowerCase();

  // 若上报者是配置的自用/开发者账号（默认 Eldon），直接忽略不计入游客统计
  if (nickname) {
    const settings = await readAdminSettingsMap(db);
    const exclRaw = settings.excluded_stat_accounts !== undefined ? settings.excluded_stat_accounts : 'Eldon';
    const exclSet = new Set(String(exclRaw).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (exclSet.has(nickname)) {
      return jsonResponse(request, 200, { ok: true, ignored: true });
    }
  }

  const { dayKey } = getBeijingPeriodKeys();
  const visitorHash = await computeDailyVisitorHash(request, dayKey);
  const source = classifyReferrerSource(rawRef);
  const country = String(request.cf?.country || 'UNKNOWN').toUpperCase().slice(0, 16);
  const now = nowIso();

  const task = (async () => {
    await ensureAdminTables(db);
    await db.prepare(`
      INSERT INTO web_visitors_daily (
        day_key, visitor_hash, page_views, first_path, referrer_source,
        is_demo, is_logged_in, did_download, country, first_seen_at, last_seen_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_key, visitor_hash) DO UPDATE SET
        page_views = web_visitors_daily.page_views + 1,
        referrer_source = CASE
          WHEN web_visitors_daily.referrer_source IN ('direct', 'internal') AND excluded.referrer_source NOT IN ('direct', 'internal')
          THEN excluded.referrer_source
          ELSE web_visitors_daily.referrer_source
        END,
        is_demo = MAX(web_visitors_daily.is_demo, excluded.is_demo),
        is_logged_in = MAX(web_visitors_daily.is_logged_in, excluded.is_logged_in),
        did_download = MAX(web_visitors_daily.did_download, excluded.did_download),
        last_seen_at = excluded.last_seen_at
    `).bind(
      dayKey,
      visitorHash,
      pathStr,
      source === 'internal' ? 'direct' : source,
      isDemo,
      isLoggedIn,
      didDownload,
      country,
      now,
      now,
    ).run();

    // 约 2% 概率顺手清理 90 天前匿名访客记录，保持 D1 轻量
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString().slice(0, 10);
      await db.prepare('DELETE FROM web_visitors_daily WHERE day_key < ?').bind(cutoff).run();
    }
  })().catch(() => {});

  if (typeof context.waitUntil === 'function') {
    context.waitUntil(task);
  } else {
    await task;
  }

  return jsonResponse(request, 200, { ok: true });
});
