import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metaOnly = process.argv.includes('--meta-only');
const mobileOnly = process.argv.includes('--mobile-only');
const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = outDirArg ? path.resolve(webRoot, outDirArg.slice('--out-dir='.length)) : path.join(webRoot, 'release');

function normalizeLineEndings(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

async function listFilesSorted(dir, baseDir = dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesSorted(full, baseDir)));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).split(path.sep).join('/');
      files.push({ full, rel });
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * 计算跨平台一致的底层兼容指纹（nativeCompat）。
 * 只要 Electron 主进程/预加载脚本、内嵌 Node 服务、原生依赖或 data/ 静态资源发生变化，指纹就会自动改变，
 * 客户端从而自动切换到「整包更新（方案 A）」；反之则走「极速无感热更新（方案 B）」。
 */
export async function computeNativeCompat(root = webRoot) {
  const hash = createHash('sha256');
  const pkgRaw = await readFile(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const depFingerprint = JSON.stringify({
    dependencies: pkg.dependencies ?? {},
    electron: pkg.devDependencies?.electron ?? '',
  });
  hash.update(`pkg:${depFingerprint}\n`);

  const coreTextFiles = [
    'electron/main.mjs',
    'electron/preload.cjs',
    'electron/electron-builder.yml',
    'dist-electron/server.mjs',
  ];
  for (const rel of coreTextFiles) {
    const full = path.join(root, rel);
    const content = await readFile(full);
    hash.update(`file:${rel}\n`);
    hash.update(normalizeLineEndings(content));
    hash.update('\n');
  }

  const dataFiles = await listFilesSorted(path.join(root, 'data'));
  for (const { full, rel } of dataFiles) {
    const content = await readFile(full);
    hash.update(`data:${rel}:${content.length}\n`);
    hash.update(content);
    hash.update('\n');
  }

  return {
    version: String(pkg.version || '1.0.0'),
    nativeCompat: hash.digest('hex').slice(0, 16),
  };
}

/**
 * 计算移动端（Android Capacitor）底层兼容指纹（mobileCompat）。
 * 只要 Capacitor 配置、原生插件注入脚本（prepare-mobile.mjs）或 @capacitor/* 依赖发生变化，指纹就会自动改变，
 * 手机端从而自动提示下载新版 APK；反之只改前端代码时自动走应用内几秒无感热更新。
 */
export async function computeMobileCompat(root = webRoot) {
  const hash = createHash('sha256');
  const pkgRaw = await readFile(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const capDeps = {};
  for (const [k, v] of Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).sort(([a], [b]) => a.localeCompare(b))) {
    if (k.startsWith('@capacitor/')) capDeps[k] = v;
  }
  hash.update(`capDeps:${JSON.stringify(capDeps)}\n`);

  const mobileCoreFiles = [
    'capacitor.config.ts',
    'scripts/prepare-mobile.mjs',
  ];
  for (const rel of mobileCoreFiles) {
    const full = path.join(root, rel);
    const content = await readFile(full);
    hash.update(`file:${rel}\n`);
    hash.update(normalizeLineEndings(content));
    hash.update('\n');
  }

  return {
    version: String(pkg.version || '1.0.0'),
    mobileCompat: hash.digest('hex').slice(0, 16),
  };
}

export async function writeRuntimeMeta(root = webRoot) {
  const { version, nativeCompat } = await computeNativeCompat(root);
  const metaDir = path.join(root, 'dist-electron');
  await mkdir(metaDir, { recursive: true });
  const meta = {
    schema: 1,
    shellVersion: version,
    nativeCompat,
  };
  const metaPath = path.join(metaDir, 'runtime-meta.json');
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return { meta, metaPath };
}

export async function buildHotUpdateBundle(root = webRoot, targetOutDir = outDir, { skipDesktopMeta = false } = {}) {
  const { version, mobileCompat } = await computeMobileCompat(root);
  let nativeCompat = '';
  if (!skipDesktopMeta) {
    const { meta } = await writeRuntimeMeta(root);
    nativeCompat = meta.nativeCompat;
  }
  const distDir = path.join(root, 'dist');
  const indexStat = await stat(path.join(distDir, 'index.html')).catch(() => null);
  if (!indexStat?.isFile()) {
    throw new Error('dist/index.html 不存在，请先执行 npm run build。');
  }

  const distFiles = await listFilesSorted(distDir);
  if (distFiles.length === 0) {
    throw new Error('dist/ 目录为空，无法生成热更新包。');
  }

  const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
    level: 6,
    bufferedWrite: true,
  });
  for (const { full, rel } of distFiles) {
    const buf = await readFile(full);
    await zipWriter.add(rel, new BlobReader(new Blob([buf])));
  }
  const zipBlob = await zipWriter.close();
  const zipBuf = Buffer.from(await zipBlob.arrayBuffer());
  const bundleSha256 = createHash('sha256').update(zipBuf).digest('hex');

  const bundleFile = `Zhouyou-Map-${version}-hot-update.zip`;
  await mkdir(targetOutDir, { recursive: true });
  const bundlePath = path.join(targetOutDir, bundleFile);
  await writeFile(bundlePath, zipBuf);

  const manifest = {
    schema: 1,
    version,
    nativeCompat,
    mobileCompat,
    bundleFile,
    bundleSha256,
    bundleSize: zipBuf.length,
    fileCount: distFiles.length,
    builtAt: new Date().toISOString(),
  };
  const manifestPath = path.join(targetOutDir, 'hot-update-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { manifest, bundlePath, manifestPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (metaOnly) {
    const { meta } = await writeRuntimeMeta();
    process.stdout.write(`Wrote dist-electron/runtime-meta.json (v${meta.shellVersion}, nativeCompat=${meta.nativeCompat})\n`);
  } else {
    const { manifest, bundlePath } = await buildHotUpdateBundle(webRoot, outDir, { skipDesktopMeta: mobileOnly });
    const sizeMb = (manifest.bundleSize / (1024 * 1024)).toFixed(2);
    process.stdout.write(
      `Built hot-update bundle: ${path.basename(bundlePath)} (${sizeMb} MB, ${manifest.fileCount} files, nativeCompat=${manifest.nativeCompat || '-'}, mobileCompat=${manifest.mobileCompat})\n`,
    );
  }
}
