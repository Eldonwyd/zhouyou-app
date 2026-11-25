const REPO = 'Eldonwyd/zhouyou-app';

function extractVersion(tag) {
  const cleaned = String(tag || '').trim().replace(/^(?:desktop|mobile)-v?/i, '').replace(/^v/i, '');
  const match = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : cleaned;
}

function compareSemver(a, b) {
  const parse = (raw) => {
    const clean = extractVersion(raw);
    const [core, pre = ''] = clean.split('-', 2);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0, pre };
  };
  const va = parse(a);
  const vb = parse(b);
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  if (va.pre === vb.pre) return 0;
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  return va.pre.localeCompare(vb.pre);
}

function sliceCodePoints(text, max) {
  const chars = Array.from(String(text || ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * 代理 GitHub Releases 列表并做边缘缓存，避免国内手机直连 api.github.com 超时或被限流。
 */
export async function onRequestGet(context) {
  const upstreamUrl = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
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
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    const list = await upstream.json();
    const slim = (Array.isArray(list) ? list : [])
      .filter((r) => !r.draft)
      .sort((a, b) => {
        const diff = compareSemver(b.tag_name, a.tag_name);
        if (diff !== 0) return diff;
        return Date.parse(b.published_at || '0') - Date.parse(a.published_at || '0');
      })
      .map((r) => ({
        tag_name: r.tag_name,
        name: r.name,
        body: sliceCodePoints(r.body || '', 1200),
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
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'fetch-failed' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
