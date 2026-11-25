import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

export function normalizeVersion(raw) {
  const cleaned = String(raw || '').trim().replace(/^(?:desktop|mobile)-v?/i, '').replace(/^v/i, '');
  const match = cleaned.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : cleaned;
}

export function compareSemver(a, b) {
  const parse = (raw) => {
    const clean = normalizeVersion(raw);
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

export function isTrustedUpdateUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'github.com') return u.pathname.toLowerCase().startsWith('/eldonwyd/zhouyou-app/');
    if (host === 'zhouyou.online' || host === 'www.zhouyou.online') return true;
    return (
      host === 'objects.githubusercontent.com' ||
      host === 'release-assets.githubusercontent.com' ||
      host === 'github-releases.githubusercontent.com'
    );
  } catch {
    return false;
  }
}

export async function readRuntimeMeta(projectRoot, fallbackVersion = '1.0.0') {
  try {
    const raw = await readFile(path.join(projectRoot, 'dist-electron', 'runtime-meta.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      shellVersion: normalizeVersion(parsed?.shellVersion || fallbackVersion),
      nativeCompat: String(parsed?.nativeCompat || '').trim(),
    };
  } catch {
    return {
      shellVersion: normalizeVersion(fallbackVersion),
      nativeCompat: '',
    };
  }
}

export function getHotUpdatesRoot(userDataDir) {
  return path.join(userDataDir, 'hot-updates');
}

export function getActiveManifestPath(userDataDir) {
  return path.join(getHotUpdatesRoot(userDataDir), 'active.json');
}

/**
 * 启动时解析实际生效的前端 dist 目录：
 * - 若存在合法热更新（版本严格高于底座 + nativeCompat 一致 + index.html 存在），使用热更新目录；
 * - 否则自动回退到安装包自带的 dist 目录（并清理失效记录，保证底座升级后不会误加载旧热更新）。
 */
export async function resolveActiveDist({ userDataDir, defaultDistDir, shellVersion, nativeCompat }) {
  const normalizedShell = normalizeVersion(shellVersion);
  const fallback = {
    distDir: defaultDistDir,
    effectiveVersion: normalizedShell,
    shellVersion: normalizedShell,
    hotUpdateVersion: '',
    nativeCompat: String(nativeCompat || ''),
  };

  if (!nativeCompat) return fallback;

  const activePath = getActiveManifestPath(userDataDir);
  let active;
  try {
    active = JSON.parse(await readFile(activePath, 'utf8'));
  } catch {
    return fallback;
  }

  const activeVersion = normalizeVersion(active?.version || '');
  const activeCompat = String(active?.nativeCompat || '');
  const relDir = String(active?.dirName || '');
  if (!activeVersion || !relDir || relDir.includes('..') || path.isAbsolute(relDir)) {
    await rm(activePath, { force: true }).catch(() => {});
    return fallback;
  }

  if (activeCompat !== nativeCompat || compareSemver(activeVersion, normalizedShell) <= 0) {
    await rm(activePath, { force: true }).catch(() => {});
    return fallback;
  }

  const hotDistDir = path.join(getHotUpdatesRoot(userDataDir), relDir);
  const indexStat = await stat(path.join(hotDistDir, 'index.html')).catch(() => null);
  if (!indexStat?.isFile()) {
    await rm(activePath, { force: true }).catch(() => {});
    return fallback;
  }

  return {
    distDir: hotDistDir,
    effectiveVersion: activeVersion,
    shellVersion: normalizedShell,
    hotUpdateVersion: activeVersion,
    nativeCompat,
  };
}

export async function extractZipSafely(zipBuffer, destDir) {
  const resolvedDest = path.resolve(destDir);
  await mkdir(resolvedDest, { recursive: true });
  const reader = new ZipReader(new BlobReader(new Blob([zipBuffer])));
  let fileCount = 0;
  try {
    const entries = await reader.getEntries();
    for (const entry of entries) {
      const rawName = String(entry.filename || '').replace(/\\/g, '/');
      if (!rawName || rawName.startsWith('/') || /^[a-zA-Z]:/.test(rawName)) {
        throw new Error(`热更新包包含非法路径：${rawName}`);
      }
      const targetPath = path.resolve(resolvedDest, rawName);
      if (targetPath !== resolvedDest && !targetPath.startsWith(`${resolvedDest}${path.sep}`)) {
        throw new Error(`热更新包检测到越权路径：${rawName}`);
      }
      if (entry.directory || rawName.endsWith('/')) {
        await mkdir(targetPath, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      const data = await entry.getData(new Uint8ArrayWriter());
      await writeFile(targetPath, data);
      fileCount += 1;
    }
  } finally {
    await reader.close();
  }
  const indexStat = await stat(path.join(resolvedDest, 'index.html')).catch(() => null);
  if (!indexStat?.isFile()) {
    throw new Error('热更新包缺少 index.html，已中止应用以保护当前版本。');
  }
  return { fileCount };
}

export function parseSha256Sums(text, fileName) {
  const target = path.basename(String(fileName || '')).toLowerCase();
  if (!target) return '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const listedName = path.basename(match[2].trim()).toLowerCase();
    if (listedName === target) {
      return match[1].toLowerCase();
    }
  }
  return '';
}

function sanitizeFileName(raw, fallback = 'zhouyou-update.bin') {
  const base = path.basename(String(raw || '').trim()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return base || fallback;
}

async function downloadSingleUrlToFile({ url, destPath, signal, onProgress, fetchImpl = fetch }) {
  const res = await fetchImpl(url, {
    redirect: 'follow',
    signal,
    headers: { 'User-Agent': 'ZhouyouMapDesktopUpdater/1.0' },
  });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }

  const totalBytes = Number.parseInt(res.headers.get('content-length') || '0', 10) || 0;
  let receivedBytes = 0;
  let lastEmitAt = 0;
  const hash = createHash('sha256');
  await mkdir(path.dirname(destPath), { recursive: true });
  const fileStream = createWriteStream(destPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      receivedBytes += chunk.length;
      if (!fileStream.write(chunk)) {
        await new Promise((resolve, reject) => {
          fileStream.once('drain', resolve);
          fileStream.once('error', reject);
        });
      }
      const now = Date.now();
      if (onProgress && (now - lastEmitAt >= 120 || (totalBytes > 0 && receivedBytes >= totalBytes))) {
        lastEmitAt = now;
        const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
        onProgress({ state: 'downloading', percent, receivedBytes, totalBytes });
      }
    }
    await new Promise((resolve, reject) => {
      fileStream.end((err) => (err ? reject(err) : resolve()));
    });
    return {
      sha256: hash.digest('hex').toLowerCase(),
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
    };
  } catch (error) {
    fileStream.destroy();
    await rm(destPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function downloadWithFallback({ urls, destPath, signal, onProgress, fetchImpl = fetch }) {
  const validUrls = [...new Set((urls || []).filter((u) => typeof u === 'string' && u.trim()))];
  if (!validUrls.length) throw new Error('没有可用的更新包下载地址');

  let lastError = null;
  for (const url of validUrls) {
    if (signal?.aborted) throw new DOMException('已取消下载', 'AbortError');
    try {
      return await downloadSingleUrlToFile({ url, destPath, signal, onProgress, fetchImpl });
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('下载更新包失败，请检查网络后重试');
}

async function cleanupOldHotDirs(hotRoot, keepDirName) {
  try {
    const entries = await readdir(hotRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== keepDirName && entry.name !== '.tmp') {
        await rm(path.join(hotRoot, entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    /* 忽略清理异常 */
  }
}

/**
 * 方案 B：应用内极速热更新（下载 dist zip → 校验 SHA-256 → 安全解压 → 切换 active.json）。
 */
export async function applyHotUpdate({
  userDataDir,
  urls,
  version,
  nativeCompat,
  expectedSha256,
  signal,
  onProgress,
  fetchImpl = fetch,
}) {
  const cleanVersion = normalizeVersion(version);
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!cleanVersion) throw new Error('热更新版本号无效');
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('热更新校验指纹无效，已取消应用');

  const hotRoot = getHotUpdatesRoot(userDataDir);
  const tmpDir = path.join(hotRoot, '.tmp');
  const zipPath = path.join(tmpDir, `hot-${cleanVersion}-${Date.now()}.zip`);
  const dirName = `v${cleanVersion}-${Date.now()}`;
  const targetDir = path.join(hotRoot, dirName);

  try {
    const dl = await downloadWithFallback({ urls, destPath: zipPath, signal, onProgress, fetchImpl });
    if (dl.sha256 !== expected) {
      throw new Error('热更新包 SHA-256 校验未通过，文件可能损坏，已自动中止。');
    }

    onProgress?.({ state: 'installing', percent: 100, receivedBytes: dl.receivedBytes, totalBytes: dl.totalBytes });
    const zipBuffer = await readFile(zipPath);
    await extractZipSafely(zipBuffer, targetDir);

    const activePayload = {
      schema: 1,
      version: cleanVersion,
      nativeCompat: String(nativeCompat || ''),
      dirName,
      bundleSha256: expected,
      appliedAt: new Date().toISOString(),
    };
    await writeFile(getActiveManifestPath(userDataDir), `${JSON.stringify(activePayload, null, 2)}\n`, 'utf8');
    await cleanupOldHotDirs(hotRoot, dirName);

    return {
      ok: true,
      mode: 'hot',
      version: cleanVersion,
      distDir: targetDir,
    };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await rm(zipPath, { force: true }).catch(() => {});
  }
}

async function fetchExpectedSha256FromSums({ sha256Urls, fileName, signal, fetchImpl = fetch }) {
  for (const url of sha256Urls || []) {
    if (!url) continue;
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        signal,
        headers: { 'User-Agent': 'ZhouyouMapDesktopUpdater/1.0' },
      });
      if (!res.ok) continue;
      const text = await res.text();
      const matched = parseSha256Sums(text, fileName);
      if (matched) return matched;
    } catch {
      /* 尝试下一个校验地址 */
    }
  }
  return '';
}

/**
 * 方案 A：应用内下载完整安装包（不经过 Edge 浏览器，下载后校验 SHA256SUMS.txt）。
 */
export async function downloadFullInstaller({
  tempDir,
  urls,
  fileName,
  sha256Urls = [],
  signal,
  onProgress,
  fetchImpl = fetch,
}) {
  const safeName = sanitizeFileName(fileName, 'Zhouyou-Map-update.exe');
  const destDir = path.join(tempDir, 'zhouyou-map-updates');
  const destPath = path.join(destDir, safeName);

  const [dl, expectedSha256] = await Promise.all([
    downloadWithFallback({ urls, destPath, signal, onProgress, fetchImpl }),
    fetchExpectedSha256FromSums({ sha256Urls, fileName: safeName, signal, fetchImpl }),
  ]);

  if (expectedSha256 && dl.sha256 !== expectedSha256) {
    await rm(destPath, { force: true }).catch(() => {});
    throw new Error('安装包 SHA-256 校验未通过，文件可能下载不完整，请重试。');
  }

  return {
    ok: true,
    mode: 'full',
    filePath: destPath,
    sha256: dl.sha256,
    verified: Boolean(expectedSha256),
    receivedBytes: dl.receivedBytes,
    totalBytes: dl.totalBytes,
  };
}
