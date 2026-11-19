import { readdir, writeFile } from 'node:fs/promises';
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
