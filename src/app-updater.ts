import { Capacitor, registerPlugin } from '@capacitor/core';

export type AppPlatform = 'desktop-win' | 'desktop-mac' | 'desktop-linux' | 'android' | 'ios' | 'web';

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface ReleaseEntry {
  tag_name: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url: string;
  published_at?: string;
  assets?: ReleaseAsset[];
}

export type AppUpdateMode = 'hot' | 'full-in-app' | 'full-browser' | 'web';

export interface HotUpdatePayload {
  url: string;
  fallbackUrls: string[];
  fileName: string;
  sha256: string;
  size: number;
  compat: string;
}

export interface AppUpdateInfo {
  platform: AppPlatform;
  platformLabel: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  canInAppInstall: boolean;
  updateMode: AppUpdateMode;
  requiresFullUpgrade: boolean;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string;
  downloadUrl: string;
  fallbackDownloadUrls: string[];
  sha256Url?: string;
  sha256FallbackUrls?: string[];
  assetName: string;
  assetSize: number;
  hotUpdate?: HotUpdatePayload | null;
}

export interface AppUpdateProgress {
  state: 'downloading' | 'ready' | 'installing' | 'error' | 'cancelled';
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

interface NativeAppUpdaterPlugin {
  getVersionInfo?: () => Promise<{
    versionName?: string;
    versionCode?: number;
    shellVersion?: string;
    mobileCompat?: string;
    hotUpdateVersion?: string;
  }>;
  applyHotUpdate?: (opts: {
    url: string;
    fallbackUrls?: string[];
    version: string;
    mobileCompat: string;
    sha256: string;
  }) => Promise<{ ok?: boolean; mode?: 'hot'; version?: string; cancelled?: boolean; error?: string }>;
  downloadAndInstall?: (opts: { url: string }) => Promise<{ ok?: boolean; cancelled?: boolean }>;
  openDownloadedApk?: () => Promise<{ ok?: boolean }>;
  cancelDownload?: () => Promise<void>;
  addListener?: (
    eventName: 'updateProgress',
    listener: (data: Partial<AppUpdateProgress>) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
}

const EDGE_RELEASES_URL = 'https://zhouyou.online/api/releases';
const PAGES_RELEASES_URL = 'https://eldonwyd.github.io/zhouyou-app/releases.json';
const GITHUB_API_RELEASES_URL = 'https://api.github.com/repos/Eldonwyd/zhouyou-app/releases?per_page=100';
export const DOWNLOAD_PORTAL_URL = 'https://zhouyou.online/download.html';
export const GITHUB_RELEASES_URL = 'https://github.com/Eldonwyd/zhouyou-app/releases';

const NativeAiBridgeForBrowser = registerPlugin<{
  openExternalUrl(opts: { url: string }): Promise<{ ok: boolean }>;
  httpRequest(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{ status: number; body: string }>;
}>('NativeAiBridge');

const NativeAppUpdater = registerPlugin<NativeAppUpdaterPlugin>('AppUpdater');

function getCapacitor(): {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { AppUpdater?: NativeAppUpdaterPlugin };
} | undefined {
  if (Capacitor.isNativePlatform()) {
    return {
      isNativePlatform: () => true,
      getPlatform: () => Capacitor.getPlatform(),
      Plugins: {
        AppUpdater: Capacitor.isPluginAvailable('AppUpdater') ? NativeAppUpdater : undefined,
      },
    };
  }
  return (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { AppUpdater?: NativeAppUpdaterPlugin } } }).Capacitor;
}

export function detectAppPlatform(): AppPlatform {
  if (window.zhouyouDesktop?.isDesktop) {
    if (window.zhouyouDesktop.platform === 'win32') return 'desktop-win';
    if (window.zhouyouDesktop.platform === 'darwin') return 'desktop-mac';
    return 'desktop-linux';
  }
  const cap = getCapacitor();
  const capPlatform = cap?.getPlatform?.();
  if (capPlatform === 'android') return 'android';
  if (capPlatform === 'ios') return 'ios';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}

export function platformDisplayName(platform: AppPlatform): string {
  switch (platform) {
    case 'desktop-win': return 'Windows 电脑版';
    case 'desktop-mac': return 'macOS 电脑版';
    case 'desktop-linux': return 'Linux 电脑版';
    case 'android': return 'Android 手机版';
    case 'ios': return 'iOS 手机版';
    default: return '网页 / PWA 版';
  }
}

export function isNativeAppPlatform(): boolean {
  return Boolean(window.zhouyouDesktop?.isDesktop || getCapacitor()?.isNativePlatform?.());
}

export function hasNativeInAppInstaller(): boolean {
  if (window.zhouyouDesktop?.isDesktop) return true;
  const cap = getCapacitor();
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android' && cap.Plugins?.AppUpdater);
}

/** 从 tag（如 desktop-v1.0.2 / mobile-v1.1.0 / v1.0.0）提取标准版本号。 */
export function extractVersionFromTag(tag: string): string {
  const cleaned = String(tag || '').trim().replace(/^(?:desktop|mobile)-v?/i, '').replace(/^v/i, '');
  const match = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : cleaned;
}

/** 比较两个语义化版本号：a > b 返回 1，a < b 返回 -1，相等返回 0。 */
export function compareSemver(a: string, b: string): number {
  const parse = (raw: string) => {
    const clean = extractVersionFromTag(raw);
    const [core, pre = ''] = clean.split('-', 2);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0, pre };
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

interface LocalRuntimeInfo {
  version: string;
  shellVersion: string;
  nativeCompat: string;
  mobileCompat: string;
  hotUpdateVersion: string;
}

async function getLocalRuntimeInfo(): Promise<LocalRuntimeInfo> {
  const fallbackVer = extractVersionFromTag(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0');
  const cap = getCapacitor();
  if (cap?.isNativePlatform?.() && cap.Plugins?.AppUpdater?.getVersionInfo) {
    try {
      const info = await cap.Plugins.AppUpdater.getVersionInfo();
      const version = info?.versionName ? extractVersionFromTag(info.versionName) : fallbackVer;
      return {
        version,
        shellVersion: info?.shellVersion ? extractVersionFromTag(info.shellVersion) : version,
        nativeCompat: '',
        mobileCompat: String(info?.mobileCompat || '').trim(),
        hotUpdateVersion: String(info?.hotUpdateVersion || '').trim(),
      };
    } catch {
      /* 回退到打包时注入的版本号 */
    }
  }
  if (window.zhouyouDesktop?.isDesktop) {
    try {
      const info = window.zhouyouDesktop.getRuntimeInfo
        ? await window.zhouyouDesktop.getRuntimeInfo()
        : null;
      const version = extractVersionFromTag(info?.version || window.zhouyouDesktop.version || fallbackVer);
      return {
        version,
        shellVersion: extractVersionFromTag(info?.shellVersion || window.zhouyouDesktop.shellVersion || version),
        nativeCompat: String(info?.nativeCompat || window.zhouyouDesktop.nativeCompat || '').trim(),
        mobileCompat: '',
        hotUpdateVersion: String(info?.hotUpdateVersion || window.zhouyouDesktop.hotUpdateVersion || '').trim(),
      };
    } catch {
      const version = extractVersionFromTag(window.zhouyouDesktop.version || fallbackVer);
      return {
        version,
        shellVersion: extractVersionFromTag(window.zhouyouDesktop.shellVersion || version),
        nativeCompat: String(window.zhouyouDesktop.nativeCompat || '').trim(),
        mobileCompat: '',
        hotUpdateVersion: String(window.zhouyouDesktop.hotUpdateVersion || '').trim(),
      };
    }
  }
  return {
    version: fallbackVer,
    shellVersion: fallbackVer,
    nativeCompat: '',
    mobileCompat: '',
    hotUpdateVersion: '',
  };
}

export async function getCurrentAppVersion(): Promise<string> {
  const runtime = await getLocalRuntimeInfo();
  return runtime.version;
}

function pickAssetForPlatform(assets: ReleaseAsset[], platform: AppPlatform): ReleaseAsset | null {
  if (!assets.length) return null;
  const byRegex = (pattern: RegExp) => assets.find((item) => pattern.test(item.name)) ?? null;
  if (platform === 'desktop-win') {
    return byRegex(/win.*setup.*\.exe$/i) ?? byRegex(/\.exe$/i);
  }
  if (platform === 'desktop-mac') {
    const arch = window.zhouyouDesktop?.arch || '';
    if (arch === 'arm64') return byRegex(/arm64\.dmg$/i) ?? byRegex(/\.dmg$/i);
    if (arch === 'x64') return byRegex(/x64\.dmg$/i) ?? byRegex(/\.dmg$/i);
    return byRegex(/\.dmg$/i);
  }
  if (platform === 'desktop-linux') {
    return byRegex(/\.AppImage$/i) ?? byRegex(/\.deb$/i);
  }
  if (platform === 'android') {
    return byRegex(/\.apk$/i);
  }
  if (platform === 'ios') {
    return byRegex(/\.ipa$/i);
  }
  return null;
}

function selectLatestRelease(releases: ReleaseEntry[], platform: AppPlatform): ReleaseEntry | null {
  const valid = releases.filter((r) => r && !r.draft && !r.prerelease);
  const pool = valid.length ? valid : releases.filter((r) => r && !r.draft);
  if (!pool.length) return null;

  const isDesktop = platform.startsWith('desktop-');
  const isMobile = platform === 'android' || platform === 'ios';

  const channelMatches = pool.filter((r) => {
    const tag = String(r.tag_name || '').toLowerCase();
    if (isDesktop) return tag.startsWith('desktop-v');
    if (isMobile) return tag.startsWith('mobile-v');
    return true;
  });

  const withAsset = (list: ReleaseEntry[]) =>
    list.filter((r) => !isDesktop && !isMobile ? true : Boolean(pickAssetForPlatform(r.assets ?? [], platform)));

  const candidates = withAsset(channelMatches).length
    ? withAsset(channelMatches)
    : withAsset(pool).length
      ? withAsset(pool)
      : channelMatches.length
        ? channelMatches
        : pool;

  return [...candidates].sort((a, b) => {
    const semverDiff = compareSemver(b.tag_name, a.tag_name);
    if (semverDiff !== 0) return semverDiff;
    return Date.parse(b.published_at || '0') - Date.parse(a.published_at || '0');
  })[0] ?? null;
}

async function fetchReleasesList(signal?: AbortSignal): Promise<ReleaseEntry[]> {
  const bust = `t=${Date.now()}`;
  const urls = [
    `${EDGE_RELEASES_URL}?${bust}`,
    `${PAGES_RELEASES_URL}?${bust}`,
    GITHUB_API_RELEASES_URL,
  ];
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: combined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error('empty');
      return data as ReleaseEntry[];
    }),
  );
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');

  const merged = new Map<string, ReleaseEntry>();
  for (const item of results) {
    if (item.status !== 'fulfilled') continue;
    for (const rel of item.value) {
      if (rel?.tag_name && !merged.has(rel.tag_name)) {
        merged.set(rel.tag_name, rel);
      }
    }
  }
  if (merged.size > 0) return [...merged.values()];
  const firstErr = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
  throw firstErr instanceof Error ? firstErr : new Error('暂时无法连接更新服务器，请检查网络后重试');
}

function sliceCodePoints(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-*]\s+/, '• ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\uFFFD/g, '')
    .trim();
}

export function summarizeNotes(rawBody: string): string {
  const withoutCodeBlocks = String(rawBody || '').replace(/```[\s\S]*?```/g, '');
  const parsed: Array<{ text: string; isHeading: boolean }> = [];
  let skippingSection = false;

  for (const rawLine of withoutCodeBlocks.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('|') || trimmed.startsWith('<!--')) continue;

    const isHeading = /^#{1,6}\s+/.test(trimmed);
    if (isHeading) {
      // 跳过安装提示、下载列表、校验值等样板区块
      if (/安装提示|下载列表|校验|SHA256/i.test(trimmed)) {
        skippingSection = true;
        continue;
      }
      skippingSection = false;
      // 跳过版本号总标题与“更新内容”小标题本身，只保留简洁要点
      if (/^#{1,2}\s*.*周游地图.*v\d+/i.test(trimmed)) continue;
      if (/^#{1,4}\s*(?:✨\s*)?(?:更新内容|本次更新|更新日志|What'?s Changed|Changelog)/i.test(trimmed)) continue;
    }

    if (skippingSection) continue;
    if (/^>\s*(?:🌐|📱|💻)?\s*(?:\*\*)?(?:电脑版官网下载页|手机版官网下载页|官网下载中心|需要手机版|需要电脑版)/i.test(trimmed)) continue;
    if (/^(?:电脑桌面版独立安装包已自动构建完成|手机移动版独立安装包已自动构建完成|全平台客户端已自动构建完成)/.test(trimmed)) continue;
    if (/完整校验值见附件|SHA256SUMS\.txt/i.test(trimmed)) continue;

    const cleaned = cleanMarkdownLine(trimmed);
    if (!cleaned) continue;
    parsed.push({ text: cleaned, isHeading });
  }

  const kept: Array<{ text: string; isHeading: boolean }> = [];
  const maxLines = 4;
  const maxChars = 240;
  let usedChars = 0;

  for (const item of parsed) {
    if (kept.length >= maxLines) break;
    const itemLen = Array.from(item.text).length;
    const sepLen = kept.length > 0 ? 1 : 0;
    if (usedChars + sepLen + itemLen <= maxChars) {
      kept.push(item);
      usedChars += sepLen + itemLen;
    } else if (!item.isHeading && maxChars - usedChars - sepLen >= 20) {
      kept.push({ text: sliceCodePoints(item.text, maxChars - usedChars - sepLen), isHeading: false });
      break;
    } else {
      break;
    }
  }

  while (kept.length > 0 && kept[kept.length - 1].isHeading) {
    kept.pop();
  }

  return kept.map((item) => item.text).join('\n');
}

interface RemoteHotManifest {
  version?: string;
  nativeCompat?: string;
  mobileCompat?: string;
  bundleFile?: string;
  bundleSha256?: string;
  bundleSize?: number;
}

function buildEdgeDownloadUrl(tag: string, fileName: string): string {
  if (!tag || !fileName) return '';
  return `https://zhouyou.online/api/download?tag=${encodeURIComponent(tag)}&file=${encodeURIComponent(fileName)}`;
}

function buildMirrorDownloadUrls(directUrl: string): string[] {
  if (!directUrl || !/^https:\/\/github\.com\//i.test(directUrl)) return [];
  return [
    `https://gh-proxy.org/${directUrl}`,
    `https://ghfast.top/${directUrl}`,
  ];
}

async function fetchHotUpdateManifest(
  latest: ReleaseEntry,
  signal?: AbortSignal,
): Promise<{ manifest: RemoteHotManifest; zipAsset: ReleaseAsset } | null> {
  const assets = latest.assets ?? [];
  const manifestAsset = assets.find((a) => a.name === 'hot-update-manifest.json');
  if (!manifestAsset) return null;

  const urls = [
    buildEdgeDownloadUrl(latest.tag_name, manifestAsset.name),
    manifestAsset.browser_download_url,
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: combined,
      });
      if (!res.ok) continue;
      const manifest = (await res.json()) as RemoteHotManifest;
      const zipAsset = assets.find(
        (a) => (manifest.bundleFile && a.name === manifest.bundleFile) || /-hot-update\.zip$/i.test(a.name),
      );
      if (zipAsset && manifest.bundleSha256) {
        return { manifest, zipAsset };
      }
    } catch {
      /* 尝试下一个清单地址或原生兜底 */
    }
  }

  // Android 原生兜底：绕过 WebView 潜在的 CORS/代理限制直接通过原生 HTTP 读取热更新清单
  if (!signal?.aborted && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeAiBridge')) {
    for (const url of urls) {
      try {
        const res = await NativeAiBridgeForBrowser.httpRequest({
          url,
          method: 'GET',
          headers: { Accept: 'application/json' },
          timeoutMs: 10000,
        });
        if (res.status < 200 || res.status >= 300 || !res.body) continue;
        const manifest = JSON.parse(res.body) as RemoteHotManifest;
        const zipAsset = assets.find(
          (a) => (manifest.bundleFile && a.name === manifest.bundleFile) || /-hot-update\.zip$/i.test(a.name),
        );
        if (zipAsset && manifest.bundleSha256) {
          return { manifest, zipAsset };
        }
      } catch {
        /* 继续尝试下一个地址 */
      }
    }
  }
  return null;
}

/** 检查当前平台是否有可更新的新版本，并自动判定走「极速热更新（方案 B）」还是「底层整包更新（方案 A）」。 */
export async function checkForAppUpdate(signal?: AbortSignal): Promise<AppUpdateInfo> {
  const platform = detectAppPlatform();
  const [runtime, releases] = await Promise.all([
    getLocalRuntimeInfo(),
    fetchReleasesList(signal),
  ]);
  const currentVersion = runtime.version;

  const latest = selectLatestRelease(releases, platform);
  if (!latest) {
    return {
      platform,
      platformLabel: platformDisplayName(platform),
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      canInAppInstall: false,
      updateMode: platform === 'web' ? 'web' : 'full-browser',
      requiresFullUpgrade: false,
      releaseName: `v${currentVersion}`,
      releaseNotes: '',
      releaseUrl: DOWNLOAD_PORTAL_URL,
      publishedAt: '',
      downloadUrl: '',
      fallbackDownloadUrls: [],
      assetName: '',
      assetSize: 0,
      hotUpdate: null,
    };
  }

  const latestVersion = extractVersionFromTag(latest.tag_name);
  const assets = latest.assets ?? [];
  const asset = pickAssetForPlatform(assets, platform);
  const shaSumsAsset = assets.find((a) => a.name === 'SHA256SUMS.txt');
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

  const edgeDownloadUrl = asset?.name ? buildEdgeDownloadUrl(latest.tag_name, asset.name) : '';
  const directDownloadUrl = asset?.browser_download_url || '';
  const mirrorDownloadUrls = buildMirrorDownloadUrls(directDownloadUrl);
  const primaryDownloadUrl = edgeDownloadUrl || mirrorDownloadUrls[0] || directDownloadUrl || latest.html_url || DOWNLOAD_PORTAL_URL;
  const fallbackDownloadUrls = [...mirrorDownloadUrls, directDownloadUrl].filter((u) => Boolean(u) && u !== primaryDownloadUrl);

  const sha256Url = shaSumsAsset?.name ? buildEdgeDownloadUrl(latest.tag_name, shaSumsAsset.name) : '';
  const sha256FallbackUrls = shaSumsAsset?.browser_download_url ? [shaSumsAsset.browser_download_url] : [];

  const isDesktop = platform.startsWith('desktop-');
  const isAndroidNative = platform === 'android' && Boolean(getCapacitor()?.isNativePlatform?.());

  let hotUpdate: HotUpdatePayload | null = null;
  let updateMode: AppUpdateMode = platform === 'web'
    ? 'web'
    : isDesktop && asset
      ? 'full-in-app'
      : 'full-browser';
  let requiresFullUpgrade = false;

  if (hasUpdate && (isDesktop || isAndroidNative)) {
    const localCompat = isDesktop ? runtime.nativeCompat : runtime.mobileCompat;
    const remoteHot = localCompat ? await fetchHotUpdateManifest(latest, signal) : null;
    if (remoteHot) {
      const remoteCompat = isDesktop
        ? String(remoteHot.manifest.nativeCompat || '').trim()
        : String(remoteHot.manifest.mobileCompat || '').trim();
      if (localCompat && remoteCompat && localCompat === remoteCompat) {
        const hotEdgeUrl = buildEdgeDownloadUrl(latest.tag_name, remoteHot.zipAsset.name);
        const hotDirectUrl = remoteHot.zipAsset.browser_download_url || '';
        const hotMirrorUrls = buildMirrorDownloadUrls(hotDirectUrl);
        const hotPrimaryUrl = hotEdgeUrl || hotMirrorUrls[0] || hotDirectUrl;
        if (hotPrimaryUrl) {
          hotUpdate = {
            url: hotPrimaryUrl,
            fallbackUrls: [...hotMirrorUrls, hotDirectUrl].filter((u) => Boolean(u) && u !== hotPrimaryUrl),
            fileName: remoteHot.zipAsset.name,
            sha256: String(remoteHot.manifest.bundleSha256 || '').trim().toLowerCase(),
            size: Number(remoteHot.manifest.bundleSize || remoteHot.zipAsset.size || 0),
            compat: remoteCompat,
          };
          updateMode = 'hot';
        }
      } else {
        // 远端和本机的底层兼容指纹不一致，说明包含底层大改动，必须装一次整包
        requiresFullUpgrade = true;
      }
    } else if (localCompat) {
      requiresFullUpgrade = true;
    }
  }

  const canInAppInstall = updateMode === 'hot' || updateMode === 'full-in-app' || updateMode === 'web';

  return {
    platform,
    platformLabel: platformDisplayName(platform),
    currentVersion,
    latestVersion,
    hasUpdate,
    canInAppInstall,
    updateMode,
    requiresFullUpgrade,
    releaseName: latest.name || latest.tag_name,
    releaseNotes: summarizeNotes(latest.body || ''),
    releaseUrl: latest.html_url || DOWNLOAD_PORTAL_URL,
    publishedAt: latest.published_at || '',
    downloadUrl: primaryDownloadUrl,
    fallbackDownloadUrls,
    sha256Url: sha256Url || undefined,
    sha256FallbackUrls,
    assetName: asset?.name || '',
    assetSize: asset?.size || 0,
    hotUpdate,
  };
}

/**
 * 触发更新：
 * - 方案 B（hot）：电脑桌面端与 Android 手机端直接应用内下载几 MB 前端包 → SHA-256 校验 → 无感重载；
 * - 方案 A（full-in-app）：电脑桌面端遇到底层大改动时，应用内直接流式下载安装包 + SHA-256 校验并拉起安装（不经过 Edge 浏览器）；
 * - 浏览器兜底（full-browser）：Android 底层大改动下载新版 APK、iOS 下载 IPA；
 * - 网页 PWA（web）：刷新 Service Worker 缓存并重载。
 */
export async function installAppUpdate(
  info: AppUpdateInfo,
  onProgress: (progress: AppUpdateProgress) => void,
): Promise<{ ok: boolean; mode?: AppUpdateMode; cancelled?: boolean; fallbackOpened?: boolean; error?: string }> {
  // 1. 网页 PWA
  if (info.platform === 'web' || info.updateMode === 'web') {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.update()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith('travel-shell-')).map((k) => caches.delete(k)));
      }
    } catch {
      /* 忽略 SW 清理异常 */
    }
    window.location.reload();
    return { ok: true, mode: 'web' };
  }

  // 2. 方案 B：应用内极速热更新（桌面端 + Android 手机端）
  if (info.updateMode === 'hot' && info.hotUpdate) {
    if (window.zhouyouDesktop?.applyHotUpdate) {
      const dispose = window.zhouyouDesktop.onUpdateProgress?.((p) => {
        onProgress({
          state: p.state,
          percent: p.percent ?? 0,
          receivedBytes: p.receivedBytes ?? 0,
          totalBytes: p.totalBytes ?? info.hotUpdate?.size ?? 0,
          error: p.error,
        });
      });
      try {
        const res = await window.zhouyouDesktop.applyHotUpdate({
          url: info.hotUpdate.url,
          fallbackUrls: info.hotUpdate.fallbackUrls,
          version: info.latestVersion,
          nativeCompat: info.hotUpdate.compat,
          sha256: info.hotUpdate.sha256,
        });
        if (res?.cancelled) return { ok: false, cancelled: true };
        if (res?.ok) return { ok: true, mode: 'hot' };
        return { ok: false, error: res?.error || '热更新失败' };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        dispose?.();
      }
    }

    const cap = getCapacitor();
    if (cap?.isNativePlatform?.() && cap.Plugins?.AppUpdater?.applyHotUpdate) {
      let handle: { remove: () => Promise<void> } | null = null;
      if (cap.Plugins.AppUpdater.addListener) {
        handle = await cap.Plugins.AppUpdater.addListener('updateProgress', (p) => {
          onProgress({
            state: (p.state as AppUpdateProgress['state']) || 'downloading',
            percent: p.percent ?? 0,
            receivedBytes: p.receivedBytes ?? 0,
            totalBytes: p.totalBytes ?? info.hotUpdate?.size ?? 0,
            error: p.error,
          });
        });
      }
      try {
        const res = await cap.Plugins.AppUpdater.applyHotUpdate({
          url: info.hotUpdate.url,
          fallbackUrls: info.hotUpdate.fallbackUrls,
          version: info.latestVersion,
          mobileCompat: info.hotUpdate.compat,
          sha256: info.hotUpdate.sha256,
        });
        if (res?.cancelled) return { ok: false, cancelled: true };
        if (res?.ok) return { ok: true, mode: 'hot' };
        return { ok: false, error: res?.error || '热更新失败' };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        await handle?.remove().catch(() => {});
      }
    }
  }

  // 3. 方案 A：桌面端底层大改动，应用内直接流式下载安装包 + SHA-256 校验并启动安装（不经过浏览器）
  const targetUrl = info.downloadUrl || info.releaseUrl || DOWNLOAD_PORTAL_URL;
  if (info.updateMode === 'full-in-app' && window.zhouyouDesktop?.downloadAndInstallUpdate) {
    const dispose = window.zhouyouDesktop.onUpdateProgress?.((p) => {
      onProgress({
        state: p.state,
        percent: p.percent ?? 0,
        receivedBytes: p.receivedBytes ?? 0,
        totalBytes: p.totalBytes ?? info.assetSize ?? 0,
        error: p.error,
      });
    });
    try {
      const res = await window.zhouyouDesktop.downloadAndInstallUpdate({
        url: targetUrl,
        fallbackUrls: info.fallbackDownloadUrls,
        fileName: info.assetName || 'Zhouyou-Map-update.exe',
        version: info.latestVersion,
        sha256Url: info.sha256Url,
        sha256FallbackUrls: info.sha256FallbackUrls,
      });
      if (res?.cancelled) return { ok: false, cancelled: true };
      if (res?.ok) return { ok: true, mode: 'full-in-app', fallbackOpened: Boolean(res.fallbackOpened) };
      return { ok: false, error: res?.error || '下载安装包失败' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      dispose?.();
    }
  }

  // 4. 浏览器下载兜底（Android 底层大改动安装新版 APK / iOS IPA / 旧版桌面端）
  if (window.zhouyouDesktop?.downloadAndInstallUpdate) {
    try {
      const res = await window.zhouyouDesktop.downloadAndInstallUpdate({
        url: targetUrl,
        fileName: info.assetName || 'zhouyou-update',
        version: info.latestVersion,
        openInBrowser: true,
      });
      if (!res || res.ok !== false) {
        return { ok: true, mode: 'full-browser', fallbackOpened: true };
      }
    } catch {
      /* 回退到 window.open */
    }
  }
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeAiBridge')) {
    try {
      await NativeAiBridgeForBrowser.openExternalUrl({ url: targetUrl });
      return { ok: true, mode: 'full-browser', fallbackOpened: true };
    } catch {
      /* 回退到 window.open */
    }
  }
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
  return { ok: true, mode: 'full-browser', fallbackOpened: true };
}

export async function cancelAppUpdateDownload(): Promise<void> {
  if (window.zhouyouDesktop?.cancelUpdateDownload) {
    await window.zhouyouDesktop.cancelUpdateDownload();
    return;
  }
  const cap = getCapacitor();
  if (cap?.isNativePlatform?.() && cap.Plugins?.AppUpdater?.cancelDownload) {
    await cap.Plugins.AppUpdater.cancelDownload();
  }
}

export async function reopenDownloadedAndroidApk(): Promise<boolean> {
  const cap = getCapacitor();
  if (cap?.isNativePlatform?.() && cap.Plugins?.AppUpdater?.openDownloadedApk) {
    try {
      const res = await cap.Plugins.AppUpdater.openDownloadedApk();
      return Boolean(res?.ok);
    } catch {
      return false;
    }
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
