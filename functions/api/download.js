const REPO = 'Eldonwyd/zhouyou-app';
const SAFE_TAG = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_FILE = /^[a-zA-Z0-9._-]{1,180}\.(apk|ipa|exe|dmg|AppImage|deb|txt)$/i;

/**
 * 流式转发本仓库 GitHub Release 安装包，仅允许下载 Eldonwyd/zhouyou-app 的合法安装包文件。
 */
export async function streamReleaseAsset(request, tag, file) {
  if (!SAFE_TAG.test(tag) || !SAFE_FILE.test(file) || tag.includes('..') || file.includes('..')) {
    return new Response('Invalid release asset parameters.', { status: 400 });
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
    return new Response(`Asset not found (HTTP ${upstream.status}).`, { status: upstream.status });
  }

  const resHeaders = new Headers();
  resHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
  resHeaders.set('Content-Disposition', `attachment; filename="${file}"`);
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
