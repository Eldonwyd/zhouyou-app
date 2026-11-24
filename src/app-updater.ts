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

const PAGES_RELEASES_URL = 'https://eldonwyd.github.io/zhouyou-app/releases.json';
const GITHUB_API_RELEASES_URL = 'https://api.github.com/repos/Eldonwyd/zhouyou-app/releases?per_page=20';
export const DOWNLOAD_PORTAL_URL = 'https://eldonwyd.github.io/zhouyou-app/download.html';
export const GITHUB_RELEASES_URL = 'https://github.com/Eldonwyd/zhouyou-app/releases';

function getCapacitor(): {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { AppUpdater?: NativeAppUpdaterPlugin };
} | undefined {
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
  if (window.zhouyouDesktop?.downloadAndInstallUpdate) return true;
  const cap = getCapacitor();
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android' && cap.Plugins?.AppUpdater?.downloadAndInstall);
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
    `${PAGES_RELEASES_URL}?${bust}`,
    GITHUB_API_RELEASES_URL,
  ];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: combined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data as ReleaseEntry[];
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('暂时无法连接更新服务器，请检查网络后重试');
}

function summarizeNotes(rawBody: string): string {
  const lines = String(rawBody || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('```') && !line.startsWith('|') && !line.startsWith('<!--') && !/^#{1,3}\s*校验|SHA256/i.test(line));
  return lines.slice(0, 6).join('\n').slice(0, 320);
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
    downloadUrl: asset?.browser_download_url || latest.html_url || DOWNLOAD_PORTAL_URL,
    assetName: asset?.name || '',
    assetSize: asset?.size || 0,
  };
}

/** 触发下载并安装更新：电脑桌面版与 Android 原生版直接应用内下载并拉起安装器；其余端打开下载链接。 */
export async function installAppUpdate(
  info: AppUpdateInfo,
  onProgress: (progress: AppUpdateProgress) => void,
): Promise<{ ok: boolean; cancelled?: boolean; fallbackOpened?: boolean; error?: string }> {
  // 1. Electron 电脑桌面版：IPC 后台流式下载安装包并自动启动安装程序
  if (window.zhouyouDesktop?.downloadAndInstallUpdate && info.downloadUrl && info.assetName) {
    const unsubscribe = window.zhouyouDesktop.onUpdateProgress?.((p) => {
      onProgress({
        state: p.state,
        percent: p.percent ?? 0,
        receivedBytes: p.receivedBytes ?? 0,
        totalBytes: p.totalBytes ?? info.assetSize,
        error: p.error,
      });
    });
    try {
      const res = await window.zhouyouDesktop.downloadAndInstallUpdate({
        url: info.downloadUrl,
        fileName: info.assetName,
        version: info.latestVersion,
      });
      return res;
    } finally {
      unsubscribe?.();
    }
  }

  // 2. Android Capacitor 原生版：调用原生 AppUpdater 插件下载 APK 并拉起系统安装器
  const cap = getCapacitor();
  const nativeUpdater = cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android' ? cap.Plugins?.AppUpdater : undefined;
  if (nativeUpdater?.downloadAndInstall && info.downloadUrl) {
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    if (nativeUpdater.addListener) {
      listenerHandle = await nativeUpdater.addListener('updateProgress', (p) => {
        onProgress({
          state: p.state ?? 'downloading',
          percent: p.percent ?? 0,
          receivedBytes: p.receivedBytes ?? 0,
          totalBytes: p.totalBytes ?? info.assetSize,
          error: p.error,
        });
      });
    }
    try {
      const res = await nativeUpdater.downloadAndInstall({ url: info.downloadUrl });
      return { ok: Boolean(res?.ok), cancelled: Boolean(res?.cancelled) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载更新失败';
      return { ok: false, error: message };
    } finally {
      await listenerHandle?.remove().catch(() => undefined);
    }
  }

  // 3. 网页 PWA：尝试刷新 Service Worker 缓存
  if (info.platform === 'web' && 'serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.update()));
    } catch {
      /* 忽略 SW 检查异常 */
    }
  }

  // 4. iOS / 浏览器 / 旧版 APK 兜底：直接打开安装包下载链接或下载页
  const targetUrl = info.downloadUrl || info.releaseUrl || DOWNLOAD_PORTAL_URL;
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
