import assert from 'node:assert/strict';
import { createXhsBridge } from '../server/xhs-bridge.mjs';
import { createPlannerService } from '../server/planner-service.mjs';

/** 封面优先：检查通过的封面直接使用（不读详情）；封面都被拒才读详情取正文图。
 * 搜索与详情占用小红书名额，封面下载与检查不占。模拟接口，不访问外站。
 */
const signal = new AbortController().signal;
const cover = (n) => `http://sns-webpic-qc.xhscdn.com/cover-${n}.webp?sign=1`;
const inner = (n) => `http://sns-webpic-qc.xhscdn.com/inner-${n}.webp?sign=1`;
const feed = (n, title) => ({ id: String(n).padStart(24, '0'), xsecToken: 'access',
  noteCard: { displayTitle: title, user: { nickName: '作者' }, cover: { urlDefault: cover(n) } } });
let detailCalls = 0;
let searchCalls = 0;
let holdSearch = null;
const bridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', maxParallel: 1, fetchImpl: async (address, options) => {
  const route = new URL(address).pathname;
  if (route.endsWith('/feeds/search')) {
    searchCalls++;
    if (holdSearch) await holdSearch;
    return Response.json({ success: true, data: { feeds: [feed(1, '攻略合集'), feed(2, '翠湖实拍'), feed(3, '翠湖随手拍')] } });
  }
  detailCalls++;
  const id = JSON.parse(options.body).feed_id;
  return Response.json({ success: true, data: { data: { note: { title: '正文', user: { nickname: '作者' },
    imageList: [cover(Number(id)), inner(`${Number(id)}a`), inner(`${Number(id)}b`)].map((urlDefault) => ({ urlDefault })) } } } });
} });

// 1. 第一张封面被检查拒绝（带字），第二张通过：直接用封面，不读详情。
let tried = [];
const accept = (allowed) => async (candidate) => { tried.push(candidate.url); return allowed(candidate.url) ? candidate : null; };
const stages = [];
const byCover = await bridge.firstPhoto('昆明市', '翠湖公园', signal, accept((url) => url.includes('cover-2')), (s) => stages.push(s), undefined, { useCovers: true });
assert.match(byCover.url, /cover-2/);
assert.equal(detailCalls, 0, 'a clean cover needs no detail read');
assert.deepEqual(tried.map((url) => url.match(/cover-\d/)[0]), ['cover-1', 'cover-2']);
assert.ok(stages.some((s) => s.includes('检查小红书封面')));

// 2. 封面全部被拒：读详情，跳过正文第 1 张（封面），使用通过检查的正文图。
tried = []; detailCalls = 0;
const byInner = await bridge.firstPhoto('昆明市', '翠湖公园', signal, accept((url) => url.includes('inner-1b')), () => {}, undefined, { useCovers: true });
assert.match(byInner.url, /inner-1b/);
assert.equal(detailCalls, 1);
assert.ok(!tried.some((url) => url.includes('cover-1') && tried.indexOf(url) > 2), 'note cover is never retried from the detail list');

// 3. 未启用检查（模型不可用）：不碰封面，只用正文图。
tried = []; detailCalls = 0;
const noCovers = await bridge.firstPhoto('昆明市', '翠湖公园', signal, accept(() => true));
assert.match(noCovers.url, /inner-1a/);
assert.ok(!tried.some((url) => url.includes('cover')));

// 4. 封面检查期间不占小红书名额：名额为 1 时，另一次查找的搜索可以同时开始。
let releaseCheck;
const checking = new Promise((resolve) => { releaseCheck = resolve; });
let checkStarted;
const started = new Promise((resolve) => { checkStarted = resolve; });
searchCalls = 0;
const slow = bridge.firstPhoto('昆明市', '翠湖公园', signal, async (candidate) => { checkStarted(); await checking; return candidate; }, () => {}, undefined, { useCovers: true });
await started;
const other = bridge.firstPhoto('昆明市', '滇池', signal, async (candidate) => candidate, () => {}, undefined, { useCovers: true });
await other;
assert.equal(searchCalls, 2, 'second search ran while the first cover was being checked');
releaseCheck();
await slow;

// 5. 服务层：检查器给出的拒绝原因写入诊断，并换下一张；检查器不可用时退回只用正文图。
const diagnostics = [];
const saved = [];
const store = { get: async () => null, save: async (_key, photo, _signal, inspect) => {
  const reason = inspect ? await inspect(Buffer.from(photo.url)) : null;
  if (reason) throw Object.assign(new Error(reason), { code: 'PHOTO_REJECTED' });
  saved.push(photo.url); return photo;
} };
const inspector = { warm: async () => true, check: async (bytes) => (String(bytes).includes('cover-1') ? '图上有文字' : null) };
const service = createPlannerService({ apiKey: '', photoStore: store, xhsBridge: bridge, photoInspector: inspector });
const photo = await service.photoFor('翠湖公园', '昆明市', signal, true, (value) => diagnostics.push(value));
assert.match(photo.url, /cover-2/);
assert.ok(diagnostics.includes('图上有文字，换下一张'));
const broken = createPlannerService({ apiKey: '', photoStore: store, xhsBridge: bridge,
  photoInspector: { warm: async () => { throw new Error('模型下载失败'); }, check: async () => null } });
saved.length = 0;
assert.match((await broken.photoFor('翠湖公园', '昆明市', signal, true)).url, /inner-/);
assert.ok(!saved.some((url) => url.includes('cover')), 'without the inspector covers are skipped; note images are used');
console.log('Photo covers: checked cover first, detail fallback, no-inspector fallback, slot release and service diagnostics: OK');
