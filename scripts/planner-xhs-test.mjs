import assert from 'node:assert/strict';
import { createXhsBridge } from '../server/xhs-bridge.mjs';
import { createPlannerServer } from '../server/index.mjs';

/** 连接器只测试本机接口协议，不使用真实账号，也不发送评论/点赞等写入操作。 */
const calls = [];
const signal = new AbortController().signal;
let loggedIn = false;
const id = '0123456789abcdef01234567';
const bridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', token: 'test-bridge-token', fetchImpl: async (address, options) => {
  const url = new URL(address);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(options.headers.Authorization, 'Bearer test-bridge-token');
  calls.push(url.pathname);
  if (url.pathname.endsWith('/login/status')) return Response.json({ success: true, data: { is_logged_in: loggedIn } });
  if (url.pathname.endsWith('/login/qrcode')) return Response.json({ success: true, data: { is_logged_in: false, img: 'data:image/png;base64,aGVsbG8=', timeout: '4m0s' } });
  if (url.pathname.endsWith('/feeds/search')) {
    assert.match(JSON.parse(options.body).keyword, /昆明市 翠湖公园/);
    return Response.json({ success: true, data: { feeds: [{ id, xsecToken: 'public-note-token' }] } });
  }
  if (url.pathname.endsWith('/feeds/detail')) return Response.json({ success: true, data: { data: { note: {
    title: '翠湖观鸥', desc: '昆明翠湖公园', user: { nickname: '作者' },
    imageList: [
      { urlDefault: 'http://xhscdn.com.evil.example/photo.jpg' },
      { urlDefault: 'http://sns-webpic-qc.xhscdn.com:8080/photo.jpg' },
      { urlDefault: 'http://user:pass@sns-webpic-qc.xhscdn.com/photo.jpg' },
      { urlDefault: '', urlPre: 'http://sns-webpic-qc.xhscdn.com/photo.jpg?signature=keep-this' },
    ],
  } } } });
  throw new Error('Unexpected bridge endpoint');
} });
assert.equal((await bridge.status(signal)).loggedIn, false);
await assert.rejects(() => bridge.firstPhoto('昆明市', '翠湖公园', signal, () => {}), /扫码/);
assert.ok((await bridge.qrcode(signal)).image.startsWith('data:image/png'));
loggedIn = true;
const photo = await bridge.firstPhoto('昆明市', '翠湖公园', signal, async (candidate) => candidate);
assert.ok(photo.attribution.includes('小红书参考图 · 作者'));
assert.equal(photo.url, 'https://sns-webpic-qc.xhscdn.com/photo.jpg?signature=keep-this', 'upgrade actual CDN HTTP URLs and preserve signatures; reject unsafe alternatives');
assert.equal(new URL(photo.sourceUrl).searchParams.get('xsec_token'), 'public-note-token');
assert.ok(!calls.some((route) => /comment|like|publish|favorite/.test(route)));
assert.throws(() => createXhsBridge({ baseUrl: 'http://192.168.1.10:18060' }), /本机/);

/** 登录状态接口失败后，二维码请求仍能独立拉起断线的本地工具并取到二维码。 */
let qrAttempts = 0;
let recoveries = 0;
const recoveringBridge = createXhsBridge({
  baseUrl: 'http://127.0.0.1:18060',
  ensureRunning: async () => { recoveries++; return true; },
  fetchImpl: async (address) => {
    if (address.pathname.endsWith('/login/status')) return new Response('', { status: 503 });
    assert.ok(address.pathname.endsWith('/login/qrcode'));
    if (++qrAttempts === 1) throw new TypeError('fetch failed');
    return Response.json({ success: true, data: { is_logged_in: false, img: 'data:image/png;base64,aGVsbG8=' } });
  },
});
assert.equal((await recoveringBridge.status(signal)).connected, false);
assert.ok((await recoveringBridge.qrcode(signal)).image.startsWith('data:image/png'));
assert.equal(qrAttempts, 2);
assert.equal(recoveries, 1);

/** 验证攻略正文和游客评价来自实际详情；月份不是硬性过滤，坏笔记可跳过。 */
const experienceQueries = [];
let detailReads = 0;
const experienceBridge = createXhsBridge({ baseUrl: 'http://127.0.0.1:18060', fetchImpl: async (address, options) => {
  const route = new URL(address).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  if (route.endsWith('/login/status')) return Response.json({ success: true, data: { is_logged_in: true } });
  if (route.endsWith('/feeds/search')) {
    experienceQueries.push(body.keyword);
    const ids = body.keyword.includes('九月') ? ['111111111111111111111111'] : [
      '222222222222222222222222', '333333333333333333333333', '444444444444444444444444',
    ];
    return Response.json({ success: true, data: { feeds: ids.map((id) => ({ id, xsecToken: 'note-access-token' })) } });
  }
  assert.ok(route.endsWith('/feeds/detail'), 'only read-only endpoints are called');
  assert.equal(body.load_all_comments, false);
  detailReads++;
  if (body.feed_id.startsWith('2')) return new Response('', { status: 500 });
  const otherCity = body.feed_id.startsWith('1');
  const hasComments = body.feed_id.startsWith('3');
  return Response.json({ success: true, data: { data: {
    note: { title: otherCity ? '杭州西湖' : '翠湖公园游玩经验', desc: otherCity ? '杭州旅游' : '三月去昆明翠湖公园，建议慢慢散步。', user: { nickname: '旅行作者' }, time: 1741000000000 },
    comments: { list: hasComments ? [{ content: '我去的时候适合散步，个人觉得值得。' }] : [] },
  } } });
} });
const experience = await experienceBridge.travelEvidence({ destination: '昆明市', month: '九月' }, signal);
assert.equal(experience.length, 2);
assert.ok(experienceQueries[0].includes('九月'));
assert.ok(!experienceQueries[1].includes('九月'), 'broadens search after insufficient month-specific results');
assert.ok(experience.every((item) => item.content.includes('三月去昆明')));
assert.ok(experience[0].content.includes('我去的时候适合散步'));
assert.ok(experience[0].content.includes('不代表总体口碑'));
assert.ok(experience[1].content.includes('未读取到游客评论'));
assert.ok(experience.every((item) => item.title.startsWith('小红书攻略与游玩评价')));
const previousReads = detailReads;
await experienceBridge.travelEvidence({ destination: '昆明市', month: '九月' }, signal);
assert.equal(detailReads, previousReads + 1, 'successful details are reused; failed detail can be retried');
const cancelled = AbortSignal.abort();
await assert.rejects(() => experienceBridge.travelEvidence({ destination: '昆明市' }, cancelled));

let written;
const server = await createPlannerServer({ apiKey: 'test', service: {}, xhsBridge: bridge, writePhotoSettings: async (values) => { written = values; } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(`${origin}/api/planner/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('photo-settings', { imageSearchKey: 'test-brave-secret' });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!text.includes('test-brave-secret'), 'settings endpoint never echoes secret');
  assert.equal(JSON.parse(text).imageSearchConfigured, true);
  assert.deepEqual(written, { BRAVE_IMAGE_SEARCH_KEY: 'test-brave-secret' });
  assert.equal((await post('photo-settings', { imageSearchKey: 'bad\nvalue' })).status, 400);
  assert.equal((await (await post('xhs-status', {})).json()).loggedIn, true);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
process.stdout.write('Xiaohongshu bridge: login/QR protocol, read-only search, images, loopback restriction and secret-safe settings: OK\n');
