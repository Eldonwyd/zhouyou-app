import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Record every hashed application asset for the service worker install step. */
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = path.join(projectDirectory, 'dist', 'assets');
const assetFiles = await readdir(assetsDirectory);
// The saved-city illustrations should also load when the journal is first opened offline.
const paths = assetFiles.filter((filename) => /\.(js|css)$|^city-postcards-.*\.webp$/.test(filename))
  .sort()
  .map((filename) => `./assets/${filename}`);
await writeFile(path.join(projectDirectory, 'dist', 'precache.json'), JSON.stringify(paths));
process.stdout.write(`Listed ${paths.length} application assets for offline use.\n`);

// Stamp dist/sw.js with the current app version + asset hash so every new release
// forces browsers/PWA to update the Service Worker and evict stale travel-shell-* caches.
try {
  const pkg = JSON.parse(await readFile(path.join(projectDirectory, 'package.json'), 'utf8'));
  const buildHash = createHash('sha256').update(`${pkg.version || '1.0.0'}:${paths.join(',')}`).digest('hex').slice(0, 8);
  const swPath = path.join(projectDirectory, 'dist', 'sw.js');
  const swText = await readFile(swPath, 'utf8');
  const stamped = swText.replace(
    /const SHELL_CACHE = ['"][^'"]+['"];/,
    `const SHELL_CACHE = 'travel-shell-v${pkg.version || '1.0.0'}-${buildHash}';`,
  );
  if (stamped !== swText) {
    await writeFile(swPath, stamped, 'utf8');
    process.stdout.write(`Stamped dist/sw.js cache version: travel-shell-v${pkg.version || '1.0.0'}-${buildHash}\n`);
  }
} catch {
  // Optional if sw.js is absent in a custom build.
}

// Mirror docs/screenshots into dist/screenshots so download.html previews work offline & locally.
const screenshotsSrc = path.join(projectDirectory, 'docs', 'screenshots');
const screenshotsDist = path.join(projectDirectory, 'dist', 'screenshots');
try {
  const shotFiles = await readdir(screenshotsSrc);
  await mkdir(screenshotsDist, { recursive: true });
  let copied = 0;
  for (const name of shotFiles) {
    if (!/\.(png|gif|webp|jpg)$/i.test(name)) continue;
    await copyFile(path.join(screenshotsSrc, name), path.join(screenshotsDist, name));
    copied += 1;
  }
  if (copied > 0) process.stdout.write(`Copied ${copied} preview screenshots to dist/screenshots/.\n`);
} catch {
  // Optional in minimal builds without docs/screenshots.
}
