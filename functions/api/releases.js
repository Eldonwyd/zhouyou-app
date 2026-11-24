const REPO = 'Eldonwyd/zhouyou-app';

/**
 * 代理 GitHub Releases 列表并做边缘缓存，避免国内手机直连 api.github.com 超时或被限流。
 */
export async function onRequestGet(context) {
  const upstreamUrl = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zhouyou-online-pages',
  };
  if (context.env && context.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${context.env.GITHUB_TOKEN}`;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers,
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `GitHub API HTTP ${upstream.status}` }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const list = await upstream.json();
    const slim = (Array.isArray(list) ? list : [])
      .filter((r) => !r.draft)
      .map((r) => ({
        tag_name: r.tag_name,
        name: r.name,
        body: String(r.body || '').slice(0, 1200),
        draft: Boolean(r.draft),
        prerelease: Boolean(r.prerelease),
        html_url: r.html_url,
        published_at: r.published_at,
        assets: (r.assets || []).map((a) => ({
          name: a.name,
          size: a.size,
          browser_download_url: a.browser_download_url,
        })),
      }));

    return new Response(JSON.stringify(slim), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'fetch-failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
