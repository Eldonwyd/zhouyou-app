import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourcesDir = path.join(webRoot, 'electron', 'resources');
const sourceSvg = path.join(resourcesDir, 'icon.svg');

/**
 * 将多尺寸 PNG 帧打包为标准 Windows ICO（PNG-in-ICO，Vista+ / Windows 10/11 原生支持）。
 */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (icon)
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  let offset = 6 + frames.length * 16;
  for (const { size, buffer } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buffer.length;
  }
  return Buffer.concat([header, ...dirEntries, ...frames.map((f) => f.buffer)]);
}

async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 300 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const svgBuffer = await readFile(sourceSvg);

await mkdir(resourcesDir, { recursive: true });
await mkdir(path.join(webRoot, 'public', 'icons'), { recursive: true });
await mkdir(path.join(webRoot, 'docs', 'assets'), { recursive: true });

// 1. Electron / Capacitor 1024x1024 master PNG
const png1024 = await renderPng(svgBuffer, 1024);
await writeFile(path.join(resourcesDir, 'icon.png'), png1024);
await writeFile(path.join(webRoot, 'docs', 'assets', 'icon.png'), await renderPng(svgBuffer, 256));
await writeFile(path.join(webRoot, 'docs', 'assets', 'icon.svg'), svgBuffer);

// 2. Windows multi-size .ico (electron/resources/icon.ico & public/favicon.ico)
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFrames = await Promise.all(icoSizes.map(async (size) => ({ size, buffer: await renderPng(svgBuffer, size) })));
const icoBuffer = buildIco(icoFrames);
await writeFile(path.join(resourcesDir, 'icon.ico'), icoBuffer);
await writeFile(path.join(webRoot, 'public', 'favicon.ico'), buildIco(icoFrames.filter((f) => [16, 32, 48].includes(f.size))));
await writeFile(path.join(webRoot, 'public', 'favicon.svg'), svgBuffer);

// 3. PWA & Apple Touch Icons
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-192.png'), await renderPng(svgBuffer, 192));
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-512.png'), await renderPng(svgBuffer, 512));
await writeFile(path.join(webRoot, 'public', 'icons', 'apple-touch-icon.png'), await renderPng(svgBuffer, 180));

// Maskable icon with generous warm padding for Android adaptive icons
const maskableInner = await renderPng(svgBuffer, 384);
const maskable512 = await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 242, g: 107, b: 91, alpha: 1 } },
})
  .composite([{ input: maskableInner, left: 64, top: 64 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-maskable-512.png'), maskable512);

process.stdout.write('Generated all desktop, mobile, PWA, and docs icons successfully.\n');
