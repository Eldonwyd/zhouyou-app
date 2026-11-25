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
export async function streamReleaseAsset(request, tag, file) {
  if (!SAFE_TAG.test(tag) || !SAFE_FILE.test(file) || tag.includes('..') || file.includes('..')) {
    return new Response('Invalid release asset parameters.', { status: 400, headers: CORS_HEADERS });
  }

  const targetUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
  const reqHeaders = new Headers({
    'User-Agent': 'zhouyou-online-pages',
  });
  const range = request.headers.get('Range');
  if (range) reqHeaders.set('Range', range);

  const upstream = await fetch(targetUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: reqHeaders,
    redirect: 'follow',
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
  resHeaders.set('Cache-Control', 'public, max-age=3600');

  for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const val = upstream.headers.get(key);
    if (val) resHeaders.set(key, val);
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
  return streamReleaseAsset(context.request, tag, file);
}

export async function onRequestHead(context) {
  const url = new URL(context.request.url);
  const tag = (url.searchParams.get('tag') || '').trim();
  const file = (url.searchParams.get('file') || '').trim();
  return streamReleaseAsset(context.request, tag, file);
}
