import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createLocalOcr } from '../server/local-ocr.mjs';

const svg = Buffer.from(`<svg width="820" height="440" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="40" y="70" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="30" fill="#111111">铁路12306 电子客票</text>
  <text x="40" y="135" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="34" fill="#111111">08:40   G1234   10:42</text>
  <text x="40" y="190" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="28" fill="#222222">昆明南站         大理站</text>
  <text x="40" y="245" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="24" fill="#333333">乘车日期 2026-12-02  04车 08F 二等座</text>
  <text x="40" y="295" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="26" fill="#c9302c">票价 145.00元  检票口 6A</text>
  <text x="40" y="365" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="24" fill="#111111">全季酒店(昆明翠湖公园店) 入住12月01日 离店12月03日 共500元</text>
</svg>`);

const png = await sharp(svg).png().toBuffer();
const ocr = createLocalOcr();
const t0 = Date.now();
const result = await ocr.recognize(png, (msg) => console.log('[ocr]', msg));
console.log(`OCR 耗时: ${Date.now() - t0}ms`);
console.log('识别结果:\n' + result.text);
assert.match(result.text, /G1234/);
assert.match(result.text, /08:40/);
assert.match(result.text, /145\.00/);
assert.match(result.text, /全季酒店/);
console.log('local-ocr-test: PASSED');
