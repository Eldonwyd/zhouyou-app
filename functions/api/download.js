import { classifyReleaseAssetPlatform, ensureAdminTables, getBeijingPeriodKeys, trackDailyMetric } from '../../cloud-lib/admin-telemetry.js';
import { getClientIp, nowIso, sha256Hex } from '../../cloud-lib/cloud.js';

const REPO = 'Eldonwyd/zhouyou-app';
const SAFE_TAG = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_FILE = /^[a-zA-Z0-9._-]{1,180}\.(apk|ipa|exe|dmg|AppImage|deb|txt|zip|json)$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
};

/**
 * 流式转发本仓库 GitHub Release 安装包，仅允许下载 Eldonwyd/zhouyou-app 的合法安装包文件。
 */
export async function streamReleaseAsset(request, tag, file, context = null) {
  if (!SAFE_TAG.test(tag) || !SAFE_FILE.test(file) || tag.includes('..') || file.includes('..')) {
    return new Response('Invalid release asset parameters.', { status: 400, headers: CORS_HEADERS });
  }

  const targetUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
  const reqUrl = new URL(request.url);
  const mirror = (reqUrl.searchParams.get('mirror') || '').trim().toLowerCase();

  // 支持按线路参数直接 302 跳转至国内高速镜像或 GitHub 官方源，避免单一回源限速
  if (mirror === 'ghproxy' || mirror === 'ghfast' || mirror === 'direct') {
    const redirectTarget =
      mirror === 'ghproxy'
        ? `https://gh-proxy.org/${targetUrl}`
        : mirror === 'ghfast'
          ? `https://ghfast.top/${targetUrl}`
          : targetUrl;
    return Response.redirect(redirectTarget, 302);
  }

  const reqHeaders = new Headers({
    'User-Agent': 'zhouyou-online-pages',
  });
  const range = request.headers.get('Range');
  if (range) reqHeaders.set('Range', range);

  // 开启 Cloudflare 边缘缓存（cacheEverything + 24h TTL），减少每次下载回源 GitHub 导致的掉速与卡顿
  const upstream = await fetch(targetUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: reqHeaders,
    redirect: 'follow',
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { '200-299': 86400, '404': 60 },
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`Asset not found (HTTP ${upstream.status}).`, { status: upstream.status, headers: CORS_HEADERS });
  }

  const resHeaders = new Headers(CORS_HEADERS);
  const isJson = /\.json$/i.test(file);
  const isTxt = /\.txt$/i.test(file);
  resHeaders.set(
    'Content-Type',
    isJson
      ? 'application/json; charset=utf-8'
      : isTxt
        ? 'text/plain; charset=utf-8'
        : upstream.headers.get('Content-Type') || 'application/octet-stream',
  );
  if (!isJson && !isTxt) {
    resHeaders.set('Content-Disposition', `attachment; filename="${file}"`);
  }
  resHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  resHeaders.set('Accept-Ranges', upstream.headers.get('Accept-Ranges') || 'bytes');

  for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const val = upstream.headers.get(key);
    if (val) resHeaders.set(key, val);
  }

  // 仅统计完整 GET 下载（忽略 HEAD 与断点续传中间分片，防止多线程下载重复计数）
  const isInitialRange = !range || /^bytes=0-/i.test(range.trim());
  if (context && request.method === 'GET' && isInitialRange && !isTxt) {
    const platform = classifyReleaseAssetPlatform(file);
    const country = String(request.cf?.country || 'UNKNOWN').toUpperCase();
    const region = request.cf?.regionCode ? `${country}-${request.cf.regionCode}` : country;
    trackDailyMetric(context, 'download_platform', platform, 1, 0);
    trackDailyMetric(context, 'download_region', region, 1, 0);
    trackDailyMetric(context, 'download_asset', `${tag}|${file}`, 1, 0);
    // 同步标记当日该访客已完成下载，用于精准区分「浏览但未下载的纯游客」与「下载转化率」
    if (platform !== 'hot-update' && context.env?.DB) {
      const markTask = (async () => {
        const db = context.env.DB;
        await ensureAdminTables(db);
        const { dayKey } = getBeijingPeriodKeys();
        const ip = getClientIp(request);
        const ua = (request.headers.get('User-Agent') || '').slice(0, 160);
        const vh = (await sha256Hex(`zy-visit-v1|${dayKey}|${ip}|${ua}`)).slice(0, 24);
        const now = nowIso();
        await db.prepare(`
          INSERT INTO web_visitors_daily (
            day_key, visitor_hash, page_views, first_path, referrer_source,
            is_demo, is_logged_in, did_download, country, first_seen_at, last_seen_at
          ) VALUES (?, ?, 1, '/api/download', 'direct', 0, 0, 1, ?, ?, ?)
          ON CONFLICT(day_key, visitor_hash) DO UPDATE SET
            did_download = 1,
            last_seen_at = excluded.last_seen_at
        `).bind(dayKey, vh, country.slice(0, 16), now, now).run();
      })().catch(() => {});
      if (typeof context.waitUntil === 'function') context.waitUntil(markTask);
    }
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const tag = (url.searchParams.get('tag') || '').trim();
  const file = (url.searchParams.get('file') || '').trim();
  return streamReleaseAsset(context.request, tag, file, context);
}

export async function onRequestHead(context) {
  const url = new URL(context.request.url);
  const tag = (url.searchParams.get('tag') || '').trim();
  const file = (url.searchParams.get('file') || '').trim();
  return streamReleaseAsset(context.request, tag, file, context);
}
