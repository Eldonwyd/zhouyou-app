import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Record every hashed application asset for the service worker install step. */
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = path.join(projectDirectory, 'dist', 'assets');
const assetFiles = await readdir(assetsDirectory);
// The saved-city illustrations should also load when the journal is first opened offline.
const paths = assetFiles.filter((filename) => /\.(js|css)$|^city-postcards-.*\.webp$/.test(filename))
  .map((filename) => `./assets/${filename}`);
await writeFile(path.join(projectDirectory, 'dist', 'precache.json'), JSON.stringify(paths));
process.stdout.write(`Listed ${paths.length} application assets for offline use.\n`);

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
