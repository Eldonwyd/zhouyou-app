import assert from 'node:assert/strict';
import { createXhsBridge } from '../server/xhs-bridge.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import { createPlannerServer } from '../server/index.mjs';

/** 验证慢查询的根因已消除：模拟真实卡片字段，不调用外站或使用真实账号。 */
const signal = new AbortController().signal;
const cover = 'http://sns-webpic-qc.xhscdn.com/cuihu-cover-with-text.webp?signature=keep';
const inner = 'http://sns-webpic-qc.xhscdn.com/cuihu-scenery.webp?signature=keep';
const feed = (number, title, url = cover) => ({
  id: String(number).padStart(24, '0'), xsecToken: 'public-note-access',
  noteCard: { displayTitle: title, user: { nickName: '旅行作者' }, cover: { urlDefault: url } },
});
// 正文第 1 张即封面（常带大字），第 2 张起为实拍图。
const detailOf = (title, images) => Response.json({ success: true, data: { data: { note: {
  title, user: { nickname: '旅行作者' }, imageList: images.map((urlDefault) => ({ urlDefault })) } } } });
let scenario = 'scenery';
let detailCalls = 0;
let loginChecks = 0;
const queries = [];
const stages = [];
const bridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', fetchImpl: async (address, options) => {
  const route = new URL(address).pathname;
  if (route.endsWith('/login/status')) {
    loginChecks++;
    return Response.json({ success: true, data: { is_logged_in: true } });
  }
  if (route.endsWith('/feeds/search')) {
    const { keyword } = JSON.parse(options.body);
    queries.push(keyword);
    let feeds = [feed(1, '北京翠湖公园'), feed(2, '昆明翠湖公园'), feed(3, '昆明翠湖公园慢游')];
    if (scenario === 'details') feeds = Array.from({ length: 8 }, (_, index) => feed(index + 10, '不明确的地点', ''));
    return Response.json({ success: true, data: { feeds } });
  }
  assert.ok(route.endsWith('/feeds/detail'));
  detailCalls++;
  if (scenario === 'details') return detailOf('其他城市', []);
  const { feed_id: id } = JSON.parse(options.body);
  // 第 2 篇只有一张封面；第 3 篇有封面 + 不安全地址 + 实拍图。
  if (id.endsWith('2')) return detailOf('只有封面', [cover]);
  return detailOf('翠湖实拍', [cover, 'http://xhscdn.com.evil.example/a', inner]);
} });
const accepted = [];
const accept = async (candidate) => { accepted.push(candidate); return candidate; };
const selectByAi = async (candidates) => [candidates[2].id, candidates[1].id]; // 模拟 AI 选择，不调用真实模型。
const first = await bridge.firstPhoto('昆明市', '翠湖公园', signal, accept, (stage) => stages.push(stage), selectByAi);
assert.equal(loginChecks, 0, 'search validates the session without a separate login page');
assert.equal(queries.length, 1);
assert.equal(queries[0], '昆明市 翠湖公园', 'only city and place, month never sent to site search');
assert.ok(!accepted.some((item) => item.url.includes('cover-with-text')), 'covers with title text are never used');
assert.equal(accepted.length, 1, 'unsafe inner image is skipped');
assert.equal(first.url, inner.replace('http:', 'https:'));
assert.equal(detailCalls, 1, 'reads only the first AI-chosen note');
assert.match(first.attribution, /旅行作者/);
assert.ok(stages.some((stage) => stage.includes('实拍图')));
scenario = 'details';
detailCalls = 0;
assert.equal(await bridge.firstPhoto('昆明市', '翠湖公园', signal, accept), null);
assert.equal(detailCalls, 2, 'at most two details per lookup, then other sources');

// 通过真实 service → bridge 链路检查 AI 的编号选择确实生效，而非又被关键词规则覆盖。
let modelMode = 'valid';
let modelRequests = 0;
const modelBridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', fetchImpl: async (address, options) => {
  const body = JSON.parse(options.body);
  if (new URL(address).pathname.endsWith('/feeds/detail'))
    return detailOf(body.feed_id.endsWith('6') ? '翠湖的秋天' : '一个普通的公园', [cover, inner]);
  assert.equal(body.keyword, '昆明市 翠湖公园');
  return Response.json({ success: true, data: { feeds: [feed(5, '一个普通的公园'), feed(6, '翠湖的秋天')] } });
} });
const modelService = createPlannerService({ apiKey: 'test-key', xhsBridge: modelBridge,
  photoStore: { get: async () => null, save: async (_query, photo) => photo },
  fetchImpl: async (address, options) => {
    assert.equal(address, 'https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(options.body);
    const task = JSON.parse(payload.messages[0].content);
    assert.equal(task.travelDate, '2027-09-15');
    assert.ok(task.preference.includes('加分项'));
    assert.ok(task.preference.includes('不带文字'));
    assert.match(payload.messages[0].content, /json/i, 'DeepSeek json_object mode rejects prompts without the word json');
    assert.ok(!options.body.includes('public-note-access'), 'access parameters never leave the local bridge');
    assert.ok(!options.body.includes('signature=keep'), 'signed CDN addresses never enter AI candidate descriptions');
    modelRequests++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ ids: [
      modelMode === 'valid' ? task.candidates[1].id : 'invented-candidate',
    ] }) } }] });
  },
});
const modelPhoto = await modelService.photoFor('翠湖公园', '昆明市', signal, true, () => {}, { date: '2027-09-15' });
assert.ok(modelPhoto.attribution.includes('翠湖的秋天'), 'AI choice with abbreviated title and no city is accepted');
assert.equal(modelRequests, 1, 'all candidates use a single model request');
modelMode = 'invalid';
const modelFallback = await modelService.photoFor('翠湖公园', '昆明市', signal, true, () => {}, { date: '2027-09-15' });
assert.ok(modelFallback.attribution.includes('一个普通的公园'), 'invalid AI choice falls back to site order without fabricated URLs');

// 最多 2 个请求同时进行：前两个立即开始；第三个排队，排队中取消应立即返回且不再发起搜索。
const releases = [];
let notifySecond;
const twoStarted = new Promise((resolve) => { notifySecond = resolve; });
let searches = 0;
const queuedBridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', fetchImpl: async (address) => {
  if (new URL(address).pathname.endsWith('/login/status')) return Response.json({ success: true, data: { is_logged_in: true } });
  searches++;
  if (searches === 2) notifySecond();
  return new Promise((resolve) => { releases.push(() => resolve(Response.json({ success: true, data: { feeds: [] } }))); });
} });
const occupying = [queuedBridge.firstPhoto('昆明市', '翠湖公园', signal, accept), queuedBridge.firstPhoto('昆明市', '滇池', signal, accept)];
await twoStarted;
assert.equal(searches, 2, 'two lookups run at the same time');
const cancellation = new AbortController();
const queued = queuedBridge.firstPhoto('昆明市', '西山', cancellation.signal, accept);
cancellation.abort(new Error('cancel queued'));
await assert.rejects(() => queued, /cancel queued/);
const fourth = queuedBridge.firstPhoto('昆明市', '石林', signal, accept);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(searches, 2, 'a third lookup waits while two are running');
releases.shift()();
await occupying[0];
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(searches, 3, 'the cancelled lookup is skipped and the next waiting one starts');
while (releases.length) releases.shift()();
await Promise.all([occupying[1], fourth]);

// 缩短可注入预算，验证总超时和小红书阶段超时；不实际等待一分钟。
const store = { get: async () => null, save: async (_key, photo) => photo };
const neverReturns = { configured: true, firstPhoto: () => new Promise(() => {}) };
const totalDiagnostics = [];
const timedService = createPlannerService({ apiKey: '', photoStore: store, xhsBridge: neverReturns,
  photoTimeoutMs: 30, xhsPhotoTimeoutMs: 1000 });
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout 本身不保活 Node 进程。
try {
  const startedAt = Date.now();
  assert.equal(await timedService.photoFor('翠湖公园', '昆明市', signal, true, (value) => totalDiagnostics.push(value)), null);
  assert.ok(Date.now() - startedAt < 1000, 'total timeout also ends unresponsive operations');
  assert.ok(totalDiagnostics.some((value) => value.includes('上限')));
  let fallbackCalls = 0;
  const fallbackDiagnostics = [];
  const fallbackService = createPlannerService({ apiKey: '', photoStore: store, xhsBridge: neverReturns,
    photoTimeoutMs: 1000, xhsPhotoTimeoutMs: 20, fetchImpl: async () => {
      fallbackCalls++;
      return Response.json({ query: { pages: {} } });
    } });
  assert.equal(await fallbackService.photoFor('翠湖公园', '昆明市', signal, true, (value) => fallbackDiagnostics.push(value)), null);
  assert.ok(fallbackCalls > 0);
  assert.ok(fallbackDiagnostics.some((value) => value.includes('切换')));
  const controller = new AbortController();
  const running = timedService.photoFor('翠湖公园', '昆明市', controller.signal, true);
  controller.abort(new Error('cancel active'));
  await assert.rejects(() => running, /cancel active/);
} finally { clearInterval(keepAlive); }

// 通过真正 HTTP 流验证进度可在结果之前到达，旧 JSON 调用保持兼容，断开可取消服务端。
let finishPhoto;
let disconnect;
const cancelledByClient = new Promise((resolve) => { disconnect = resolve; });
let httpCalls = 0;
const server = await createPlannerServer({ apiKey: '', service: { async photoFor(_title, _city, requestSignal, _refresh, _diagnostic, context) {
  context.onProgress('正在下载封面');
  httpCalls++;
  if (httpCalls === 1) return new Promise((resolve) => { finishPhoto = resolve; });
  if (httpCalls === 2) return first;
  return new Promise((resolve) => requestSignal.addEventListener('abort', () => { disconnect(); resolve(null); }, { once: true }));
} } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (stream, requestSignal) => fetch(`${origin}/api/planner/photo`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '翠湖公园', city: '昆明市', stream }), signal: requestSignal });
  const response = await post(true);
  assert.match(response.headers.get('content-type'), /ndjson/);
  const reader = response.body.getReader();
  const progress = new TextDecoder().decode((await reader.read()).value);
  assert.match(progress, /正在下载封面/);
  finishPhoto(first);
  let rest = '';
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  assert.match(rest, /"type":"result"/);
  assert.equal((await (await post(false)).json()).photo.url, first.url);
  const controller = new AbortController();
  const pending = await post(true, controller.signal);
  await pending.body.getReader().read();
  controller.abort();
  await Promise.race([cancelledByClient, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP disconnect did not abort lookup')), 1000);
    timer.unref();
  })]);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log('Photo speed: text-free inner images (no covers), CDN validation, detail cap, two-way concurrency, queue cancellation, deadlines, progress and HTTP disconnect: OK');
