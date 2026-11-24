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

export interface AppUpdateInfo {
  platform: AppPlatform;
  platformLabel: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  canInAppInstall: boolean;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string;
  downloadUrl: string;
  assetName: string;
  assetSize: number;
}

export interface AppUpdateProgress {
  state: 'downloading' | 'ready' | 'installing' | 'error' | 'cancelled';
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

interface NativeAppUpdaterPlugin {
  getVersionInfo?: () => Promise<{ versionName?: string; versionCode?: number }>;
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

const NativeAiBridgeForBrowser = registerPlugin<{ openExternalUrl(opts: { url: string }): Promise<{ ok: boolean }> }>('NativeAiBridge');

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
  // 手机端与电脑桌面端均不执行应用内下载安装（避免触发 REQUEST_INSTALL_PACKAGES / 杀毒误报），统一由系统浏览器安全下载更新。
  return false;
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

export async function getCurrentAppVersion(): Promise<string> {
  const cap = getCapacitor();
  if (cap?.isNativePlatform?.() && cap.Plugins?.AppUpdater?.getVersionInfo) {
    try {
      const info = await cap.Plugins.AppUpdater.getVersionInfo();
      if (info?.versionName) return extractVersionFromTag(info.versionName);
    } catch {
      /* 回退到打包时注入的版本号 */
    }
  }
  if (window.zhouyouDesktop?.version) {
    return extractVersionFromTag(window.zhouyouDesktop.version);
  }
  return extractVersionFromTag(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0');
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

  for (const rawLine of withoutCodeBlocks.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('|') || trimmed.startsWith('<!--')) continue;
    if (/^#{1,2}\s*.*周游地图.*v\d+/i.test(trimmed)) continue;
    if (/^#{1,3}\s*(?:📦\s*)?下载列表/i.test(trimmed)) continue;
    if (/^>\s*(?:🌐|📱|💻)?\s*(?:\*\*)?(?:电脑版官网下载页|手机版官网下载页|官网下载中心|需要手机版|需要电脑版)/i.test(trimmed)) continue;
    if (/^#{1,3}\s*校验|SHA256|完整校验值见附件/i.test(trimmed)) continue;

    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const cleaned = cleanMarkdownLine(trimmed);
    if (!cleaned) continue;
    parsed.push({ text: cleaned, isHeading });
  }

  const kept: Array<{ text: string; isHeading: boolean }> = [];
  const maxLines = 6;
  const maxChars = 420;
  let usedChars = 0;

  for (const item of parsed) {
    if (kept.length >= maxLines) break;
    const itemLen = Array.from(item.text).length;
    const sepLen = kept.length > 0 ? 1 : 0;
    if (usedChars + sepLen + itemLen <= maxChars) {
      kept.push(item);
      usedChars += sepLen + itemLen;
    } else if (!item.isHeading && maxChars - usedChars - sepLen >= 24) {
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

/** 检查当前平台是否有可更新的新版本。 */
export async function checkForAppUpdate(signal?: AbortSignal): Promise<AppUpdateInfo> {
  const platform = detectAppPlatform();
  const [currentVersion, releases] = await Promise.all([
    getCurrentAppVersion(),
    fetchReleasesList(signal),
  ]);

  const latest = selectLatestRelease(releases, platform);
  if (!latest) {
    return {
      platform,
      platformLabel: platformDisplayName(platform),
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      canInAppInstall: hasNativeInAppInstaller(),
      releaseName: `v${currentVersion}`,
      releaseNotes: '',
      releaseUrl: DOWNLOAD_PORTAL_URL,
      publishedAt: '',
      downloadUrl: '',
      assetName: '',
      assetSize: 0,
    };
  }

  const latestVersion = extractVersionFromTag(latest.tag_name);
  const asset = pickAssetForPlatform(latest.assets ?? [], platform);
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

  const edgeDownloadUrl = latest.tag_name && asset?.name
    ? `https://zhouyou.online/api/download?tag=${encodeURIComponent(latest.tag_name)}&file=${encodeURIComponent(asset.name)}`
    : '';

  return {
    platform,
    platformLabel: platformDisplayName(platform),
    currentVersion,
    latestVersion,
    hasUpdate,
    canInAppInstall: hasNativeInAppInstaller() && Boolean(asset?.browser_download_url),
    releaseName: latest.name || latest.tag_name,
    releaseNotes: summarizeNotes(latest.body || ''),
    releaseUrl: latest.html_url || DOWNLOAD_PORTAL_URL,
    publishedAt: latest.published_at || '',
    downloadUrl: edgeDownloadUrl || asset?.browser_download_url || latest.html_url || DOWNLOAD_PORTAL_URL,
    assetName: asset?.name || '',
    assetSize: asset?.size || 0,
  };
}

/** 触发更新：网页 PWA 直接刷新 Service Worker 缓存重载；手机端与桌面端统一由系统浏览器安全下载新版安装包。 */
export async function installAppUpdate(
  info: AppUpdateInfo,
  _onProgress: (progress: AppUpdateProgress) => void,
): Promise<{ ok: boolean; cancelled?: boolean; fallbackOpened?: boolean; error?: string }> {
  // 1. 网页 PWA：主动刷新 Service Worker、清理旧页面壳缓存并重载到最新版本
  if (info.platform === 'web') {
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
    return { ok: true };
  }

  // 2. 电脑桌面版与手机端：统一交由系统默认浏览器安全下载新版安装包，避免安全软件误报
  const targetUrl = info.downloadUrl || info.releaseUrl || DOWNLOAD_PORTAL_URL;
  if (window.zhouyouDesktop?.downloadAndInstallUpdate) {
    try {
      const res = await window.zhouyouDesktop.downloadAndInstallUpdate({
        url: targetUrl,
        fileName: info.assetName || 'zhouyou-update',
        version: info.latestVersion,
      });
      if (!res || res.ok !== false) {
        return { ok: true, fallbackOpened: true };
      }
    } catch {
      /* 回退到 window.open */
    }
  }
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeAiBridge')) {
    try {
      await NativeAiBridgeForBrowser.openExternalUrl({ url: targetUrl });
      return { ok: true, fallbackOpened: true };
    } catch {
      /* 回退到 window.open */
    }
  }
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
  return { ok: true, fallbackOpened: true };
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
