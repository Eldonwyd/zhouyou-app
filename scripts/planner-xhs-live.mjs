import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readServerKey } from '../server/index.mjs';
import { createXhsBridge } from '../server/xhs-bridge.mjs';

/** 手动真实联调：需要部署者先扫码；只搜索和读取，不发布或操作账号内容。
 * 中文保存在 UTF-8 文件中，避免 Windows PowerShell 管道用 ASCII 改坏关键词。
 * 完整资料只写入忽略目录；终端只输出状态与公开标题，不输出账号凭据。
 */
const city = process.argv[2] || '昆明市';
const place = process.argv[3] || '翠湖公园';
const bridge = createXhsBridge({
  baseUrl: await readServerKey('XHS_BRIDGE_URL'),
  token: await readServerKey('XHS_BRIDGE_TOKEN'),
});
const status = await bridge.status(AbortSignal.timeout(45000));
console.log({ stage: 'login', ...status });
if (!status.loggedIn) process.exitCode = 2;
else {
  const snapshot = new URL('../.openai/xhs-cuihu-live.json', import.meta.url);
  // 修复照片后可只重测照片，避免重复读取已确认的攻略和评论。
  const notes = process.argv.includes('--photo-only')
    ? JSON.parse(await readFile(snapshot, 'utf8')).notes
    : await bridge.travelEvidence({ destination: `${city} ${place}`, month: '九月' }, AbortSignal.timeout(120000));
  console.log({ stage: 'guides', count: notes.length, notes: notes.map((note) => ({
    title: note.title, hasVisibleComments: note.content.includes('当前页面游客评论摘录'), publishedAt: note.date,
  })) });
  await mkdir(new URL('../.openai/', import.meta.url), { recursive: true });
  await writeFile(snapshot, JSON.stringify({ notes }, null, 2));
  // 图片经用户实际打开的网页 API 获取，验证代理、后端检索与本地文件完整链路。
  const diagnostics = [];
  const response = await fetch('http://127.0.0.1:5173/api/planner/photo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: place, city, date: '2027-09-15' }), signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '网页图片接口请求失败');
  const { photo } = result;
  if (result.message) diagnostics.push(result.message);
  if (photo?.assetId) {
    const file = await fetch(`http://127.0.0.1:5173/api/planner/photo-file/${photo.assetId}`);
    if (!file.ok || file.headers.get('content-type') !== 'image/webp') throw new Error('网页无法读取本地照片');
    console.log({ stage: 'photo-file', status: file.status, bytes: (await file.arrayBuffer()).byteLength });
  }
  console.log({ stage: 'photo', found: Boolean(photo), source: photo ? new URL(photo.sourceUrl).hostname : null,
    savedLocally: Boolean(photo?.assetId), attribution: photo?.attribution, diagnostics });
  await writeFile(snapshot, JSON.stringify({ notes, photo, diagnostics }, null, 2));
}
