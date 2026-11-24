import { streamReleaseAsset } from '../api/download.js';

const REPO = 'Eldonwyd/zhouyou-app';

const TARGETS = {
  android: { kind: 'mobile', test: (n) => /\.apk$/i.test(n) },
  apk: { kind: 'mobile', test: (n) => /\.apk$/i.test(n) },
  ios: { kind: 'mobile', test: (n) => /\.ipa$/i.test(n) },
  ipa: { kind: 'mobile', test: (n) => /\.ipa$/i.test(n) },
  win: { kind: 'desktop', test: (n) => /win.*setup\.exe$/i.test(n) },
  'win-setup': { kind: 'desktop', test: (n) => /win.*setup\.exe$/i.test(n) },
  'win-portable': { kind: 'desktop', test: (n) => /win.*portable\.exe$/i.test(n) },
  mac: { kind: 'desktop', test: (n) => /mac.*arm64\.dmg$/i.test(n) },
  'mac-arm64': { kind: 'desktop', test: (n) => /mac.*arm64\.dmg$/i.test(n) },
  'mac-x64': { kind: 'desktop', test: (n) => /mac.*x64\.dmg$/i.test(n) },
  linux: { kind: 'desktop', test: (n) => /\.AppImage$/i.test(n) },
  'linux-appimage': { kind: 'desktop', test: (n) => /\.AppImage$/i.test(n) },
  'linux-deb': { kind: 'desktop', test: (n) => /\.deb$/i.test(n) },
};

async function fetchReleases(context) {
  const origin = new URL(context.request.url).origin;
  try {
    const staticRes = await context.env.ASSETS.fetch(new Request(`${origin}/releases.json`));
    if (staticRes.ok) {
      const data = await staticRes.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zhouyou-online-pages',
  };
  if (context.env && context.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${context.env.GITHUB_TOKEN}`;
  }
  const apiRes = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers,
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!apiRes.ok) return [];
  const list = await apiRes.json();
  return Array.isArray(list) ? list.filter((r) => !r.draft) : [];
}

async function handleInstall(context) {
  const rawTarget = String((context.params && context.params.target) || '').toLowerCase().trim();
  const rule = TARGETS[rawTarget];
  if (!rule) {
    return Response.redirect(new URL('/download.html', context.request.url).toString(), 302);
  }

  const releases = await fetchReleases(context);
  const release =
    rule.kind === 'mobile'
      ? releases.find((r) => /^mobile-v/i.test(r.tag_name || '')) ||
        releases.find((r) => (r.assets || []).some((a) => /\.(apk|ipa)$/i.test(a.name)))
      : releases.find((r) => /^desktop-v/i.test(r.tag_name || '')) ||
        releases.find((r) => (r.assets || []).some((a) => /\.(exe|dmg|AppImage|deb)$/i.test(a.name)));

  const asset = release && Array.isArray(release.assets) ? release.assets.find((a) => rule.test(a.name)) : null;
  if (!release || !asset) {
    return Response.redirect(
      new URL(rule.kind === 'mobile' ? '/download.html#mobile' : '/download.html#desktop', context.request.url).toString(),
      302,
    );
  }

  return streamReleaseAsset(context.request, release.tag_name, asset.name);
}

export async function onRequestGet(context) {
  return handleInstall(context);
}

export async function onRequestHead(context) {
  return handleInstall(context);
}
