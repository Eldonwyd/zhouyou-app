import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(webRoot, 'dist-electron');
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(webRoot, 'server', 'index.mjs')],
  outfile: path.join(outDir, 'server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  external: ['../scripts/setup-xhs.mjs'],
  banner: {
    js: '// Bundled Zhouyou Map embedded Node server for Electron desktop app.',
  },
});

process.stdout.write('Bundled dist-electron/server.mjs successfully.\n');
