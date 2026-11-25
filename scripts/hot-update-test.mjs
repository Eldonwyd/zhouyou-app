import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { buildHotUpdateBundle } from './build-hot-update.mjs';
import {
  applyHotUpdate,
  downloadFullInstaller,
  extractZipSafely,
  isTrustedUpdateUrl,
  parseSha256Sums,
  resolveActiveDist,
} from '../electron/hot-update.mjs';

function makeMockFetch(routes) {
  return async (url) => {
    const entry = routes[url];
    if (!entry) return new Response('Not Found', { status: 404 });
    const body = Buffer.isBuffer(entry) ? entry : Buffer.from(String(entry), 'utf8');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-length': String(body.length) },
    });
  };
}

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'zhouyou-hot-update-test-'));

try {
  // 1. 验证构建热更新包与双端兼容指纹
  const outDir = path.join(tmpRoot, 'release');
  const { manifest, bundlePath } = await buildHotUpdateBundle(path.resolve(''), outDir);
  assert.match(manifest.nativeCompat, /^[0-9a-f]{16}$/, 'nativeCompat should be 16 hex chars');
  assert.match(manifest.mobileCompat, /^[0-9a-f]{16}$/, 'mobileCompat should be 16 hex chars');
  assert.match(manifest.bundleSha256, /^[0-9a-f]{64}$/, 'bundleSha256 should be 64 hex chars');
  assert.ok(manifest.fileCount > 0, 'hot update bundle should contain dist files');

  const zipBuf = await readFile(bundlePath);
  const userDataDir = path.join(tmpRoot, 'userData');
  const defaultDistDir = path.join(tmpRoot, 'default-dist');

  // 2. 验证方案 B：热更新下载、校验、解压、激活
  const hotUrl = `https://zhouyou.online/api/download?tag=desktop-v9.9.9&file=${manifest.bundleFile}`;
  let progressEvents = 0;
  const hotRes = await applyHotUpdate({
    userDataDir,
    urls: [hotUrl],
    version: '9.9.9',
    nativeCompat: manifest.nativeCompat,
    expectedSha256: manifest.bundleSha256,
    onProgress: () => { progressEvents += 1; },
    fetchImpl: makeMockFetch({ [hotUrl]: zipBuf }),
  });
  assert.equal(hotRes.ok, true);
  assert.equal(hotRes.version, '9.9.9');
  assert.ok(progressEvents > 0, 'should emit progress events');

  const active = await resolveActiveDist({
    userDataDir,
    defaultDistDir,
    shellVersion: '1.0.27',
    nativeCompat: manifest.nativeCompat,
  });
  assert.equal(active.effectiveVersion, '9.9.9');
  assert.equal(active.distDir, hotRes.distDir);
  assert.ok((await stat(path.join(active.distDir, 'index.html'))).isFile());

  // 3. 验证底层指纹变化时自动回退到内置 dist
  const fallbackByCompat = await resolveActiveDist({
    userDataDir,
    defaultDistDir,
    shellVersion: '1.0.27',
    nativeCompat: '0000000000000000',
  });
  assert.equal(fallbackByCompat.distDir, defaultDistDir);
  assert.equal(fallbackByCompat.effectiveVersion, '1.0.27');

  // 重新激活后再验证：底座升级到更高版本时自动回退到内置 dist
  await applyHotUpdate({
    userDataDir,
    urls: [hotUrl],
    version: '2.0.0',
    nativeCompat: manifest.nativeCompat,
    expectedSha256: manifest.bundleSha256,
    fetchImpl: makeMockFetch({ [hotUrl]: zipBuf }),
  });
  const fallbackByShell = await resolveActiveDist({
    userDataDir,
    defaultDistDir,
    shellVersion: '2.0.0',
    nativeCompat: manifest.nativeCompat,
  });
  assert.equal(fallbackByShell.distDir, defaultDistDir);
  assert.equal(fallbackByShell.effectiveVersion, '2.0.0');

  // 4. 验证 SHA-256 不匹配时拒绝热更新
  await assert.rejects(
    () =>
      applyHotUpdate({
        userDataDir,
        urls: [hotUrl],
        version: '9.9.9',
        nativeCompat: manifest.nativeCompat,
        expectedSha256: 'a'.repeat(64),
        fetchImpl: makeMockFetch({ [hotUrl]: zipBuf }),
      }),
    /SHA-256 校验未通过/,
  );

  // 5. 验证 Zip Slip 路径穿越防护
  const evilWriter = new ZipWriter(new BlobWriter('application/zip'));
  await evilWriter.add('../escape.txt', new BlobReader(new Blob(['evil'])));
  const evilZip = Buffer.from(await (await evilWriter.close()).arrayBuffer());
  await assert.rejects(
    () => extractZipSafely(evilZip, path.join(tmpRoot, 'evil-extract')),
    /越权路径|非法路径|Unsafe filename/i,
  );

  // 6. 验证方案 A：整包下载 + SHA256SUMS.txt 校验
  const fakeExe = Buffer.from('MZ-fake-installer-binary-content');
  const fakeSha = createHash('sha256').update(fakeExe).digest('hex');
  const exeUrl = 'https://zhouyou.online/api/download?tag=desktop-v1.0.28&file=Zhouyou-Map-1.0.28-win-x64-setup.exe';
  const sumsUrl = 'https://zhouyou.online/api/download?tag=desktop-v1.0.28&file=SHA256SUMS.txt';
  const sumsText = `${fakeSha}  Zhouyou-Map-1.0.28-win-x64-setup.exe\n`;
  assert.equal(parseSha256Sums(sumsText, 'Zhouyou-Map-1.0.28-win-x64-setup.exe'), fakeSha);

  const fullRes = await downloadFullInstaller({
    tempDir: path.join(tmpRoot, 'temp'),
    urls: [exeUrl],
    fileName: 'Zhouyou-Map-1.0.28-win-x64-setup.exe',
    sha256Urls: [sumsUrl],
    fetchImpl: makeMockFetch({ [exeUrl]: fakeExe, [sumsUrl]: sumsText }),
  });
  assert.equal(fullRes.ok, true);
  assert.equal(fullRes.verified, true);
  assert.equal(fullRes.sha256, fakeSha);

  // 7. 验证 URL 白名单
  assert.equal(isTrustedUpdateUrl('https://zhouyou.online/api/download?tag=desktop-v1.0.28&file=a.zip'), true);
  assert.equal(isTrustedUpdateUrl('https://github.com/Eldonwyd/zhouyou-app/releases/download/desktop-v1.0.28/a.exe'), true);
  assert.equal(isTrustedUpdateUrl('https://evil.example.com/a.exe'), false);
  assert.equal(isTrustedUpdateUrl('http://zhouyou.online/a.exe'), false);

  process.stdout.write('hot-update-test passed (7/7 assertions).\n');
} finally {
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}
