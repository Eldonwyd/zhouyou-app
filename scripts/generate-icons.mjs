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

const svgText = await readFile(sourceSvg, 'utf8');
const svgBuffer = Buffer.from(svgText, 'utf8');
const fullBleedCombined = Buffer.from(
  svgText
    .replace('<g clip-path="url(#iconClip)">', '<g>')
    .replace('<rect x="44" y="44" width="936" height="936" rx="224" fill="url(#bg)"/>', '<rect x="0" y="0" width="1024" height="1024" fill="url(#bg)"/>'),
  'utf8',
);
const mapMarker = '  <!-- Folded Paper Map Card -->';
const fullBleedBackground = Buffer.from(`${fullBleedCombined.toString('utf8').slice(0, fullBleedCombined.toString('utf8').indexOf(mapMarker))}</svg>`, 'utf8');
const foregroundOnly = Buffer.from(
  `${svgText.slice(0, svgText.indexOf('  <!-- Rounded App Icon Background -->'))}${svgText.slice(svgText.indexOf(mapMarker))}`,
  'utf8',
);

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

// 3. PWA & Apple Touch Icons (Apple & Maskable use full-bleed gradient without outer border)
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-192.png'), await renderPng(svgBuffer, 192));
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-512.png'), await renderPng(svgBuffer, 512));
await writeFile(
  path.join(webRoot, 'public', 'icons', 'apple-touch-icon.png'),
  await sharp(fullBleedCombined, { density: 300 }).resize(180, 180).flatten({ background: { r: 242, g: 107, b: 91 } }).png({ compressionLevel: 9 }).toBuffer(),
);

// Maskable icon with full-bleed gradient background and centered foreground artwork inside safe zone
const maskableBg = await sharp(fullBleedBackground, { density: 300 }).resize(512, 512).flatten({ background: { r: 242, g: 107, b: 91 } }).png().toBuffer();
const maskableFg = await renderPng(foregroundOnly, 396);
const maskable512 = await sharp(maskableBg)
  .composite([{ input: maskableFg, left: 58, top: 58 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(path.join(webRoot, 'public', 'icons', 'icon-maskable-512.png'), maskable512);

process.stdout.write('Generated all desktop, mobile, PWA, and docs icons successfully.\n');
