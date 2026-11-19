import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createPhotoInspector } from '../server/photo-inspector.mjs';

/** 用程序生成的图验证本地检查：无字风景可用，大字标题判为带字，宫格/留白拼接判为拼图。
 * 使用本机 .models 下的真实模型（首次运行会从 ModelScope 下载）。人像判定由真实样本标定，见 PLAN.md。
 */
const W = 675, H = 900;
// “风景”：天空渐变 + 起伏山脊 + 轻微噪点，接近真实照片的统计特征。
const scenery = async () => {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ridge = H * 0.55 + Math.sin(x / 60) * 40 + Math.sin(x / 17) * 9;
    const noise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 * 10;
    const i = (y * W + x) * 3;
    if (y < ridge) { raw[i] = 120 + y / 8 + noise; raw[i + 1] = 170 + y / 10 + noise; raw[i + 2] = 230 + noise / 2; }
    else { raw[i] = 50 + noise; raw[i + 1] = 95 + (y - ridge) / 6 + noise; raw[i + 2] = 60 + noise; }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).webp().toBuffer();
};
const base = await scenery();
const withTitle = await sharp(base).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">
  <text x="40" y="200" font-size="96" font-weight="900" fill="#ffffff" stroke="#000" stroke-width="4" font-family="Microsoft YaHei, sans-serif">大理旅游攻略</text>
  <text x="60" y="330" font-size="64" font-weight="700" fill="#ffeb3b" font-family="Microsoft YaHei, sans-serif">环洱海保姆级路线</text></svg>`) }]).webp().toBuffer();
const tile = (color) => sharp({ create: { width: Math.floor(W / 2), height: H / 2, channels: 3, background: color } })
  .composite([{ input: Buffer.from(`<svg width="${Math.floor(W / 2)}" height="${H / 2}"><circle cx="120" cy="160" r="90" fill="#fff8"/></svg>`) }]).png().toBuffer();
const grid = await sharp({ create: { width: Math.floor(W / 2) * 2, height: H, channels: 3, background: '#000' } }).composite([
  { input: await tile('#2a6f97'), left: 0, top: 0 }, { input: await tile('#d97b29'), left: Math.floor(W / 2), top: 0 },
  { input: await tile('#4f8a3c'), left: 0, top: H / 2 }, { input: await tile('#8e3b63'), left: Math.floor(W / 2), top: H / 2 },
]).webp().toBuffer();
const gutter = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite([
  { input: await sharp(base).resize(W, 440).toBuffer(), left: 0, top: 0 },
  { input: await sharp(base).flop().resize(W, 440).toBuffer(), left: 0, top: 460 },
]).webp().toBuffer();

const inspector = createPhotoInspector();
const started = Date.now();
await inspector.warm();
assert.equal(await inspector.check(base), null, 'plain scenery is usable');
assert.equal(await inspector.check(withTitle), '图上有文字');
assert.equal(await inspector.check(grid), '疑似拼图');
assert.equal(await inspector.check(gutter), '疑似拼图');
const timed = Date.now();
await inspector.check(base);
const each = Date.now() - timed;
assert.ok(each < 4000, `one check should take seconds, not ${each}ms`);
console.log(`Photo inspector: scenery accepted, title text, grid and gutter collages rejected; ${each}ms per photo (load ${timed - started}ms): OK`);
