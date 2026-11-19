import assert from 'node:assert/strict';
import { createPlannerService } from '../server/planner-service.mjs';
import { plannerXiaohongshuSearchUrl } from '../src/planner-photo.ts';
import { plannerCaptionImage } from '../server/planner-photo-html.mjs';
import { plannerPhotoMonth, plannerPhotoMatches, plannerPhotoCityName, plannerPhotoPlaceName } from '../src/planner-photo.ts';
import { createPlannerPhotoStore, fetchPlannerPhotoBytes } from '../server/planner-photo-store.mjs';
import { createPlannerServer } from '../server/index.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/** 对照片来源优先级及失败回退做模拟验证，不请求真实笔记、不消耗搜索额度。 */
const signal = new AbortController().signal;
// 新闻图集无 alt：必须选图片后自己的说明，不能错取其他城市、二维码或前一张图。
const gallery = '<img src="qrcode.png"><p>昆明市翠湖公园</p>'
  + '<img src="other.jpg"><p>游客在吉林松花湖游览</p>'
  + '<img src="cuihu.jpg"><p>游客在云南省昆明市翠湖公园观光游览。</p><p>摄影者署名</p>';
assert.equal(plannerCaptionImage(gallery, 'https://example.org/article/', '翠湖公园', '昆明市').url, 'https://example.org/article/cuihu.jpg');
assert.equal(plannerCaptionImage('<img src="other.jpg"><p>吉林松花湖</p><p>昆明市翠湖公园</p>', 'https://example.org/', '翠湖公园', '昆明市'), null);
assert.equal(plannerCaptionImage('<img src="other.jpg"><p>其他城市翠湖公园</p>', 'https://example.org/', '翠湖公园', '昆明市'), null);
assert.equal(plannerCaptionImage('<img src="show.jpg"><p>昆明市翠湖公园京剧演出</p><img src="lake.jpg"><p>昆明市翠湖公园观光游览</p>', 'https://example.org/', '翠湖公园', '昆明市').url, 'https://example.org/lake.jpg');
const image = 'https://sns-webpic-qc.xhscdn.com/example/place-cover.webp';
const noteUrl = 'https://www.xiaohongshu.com/explore/123abcdef';
const wikiImage = 'https://upload.wikimedia.org/wikipedia/commons/example.jpg';
const queries = [];
const downloaded = [];
let wikiCalls = 0;
let scenario = 'public';
const imageBytes = await sharp({ create: { width: 400, height: 240, channels: 3, background: '#369976' } }).png().toBuffer();
const directory = await mkdtemp(path.join(tmpdir(), 'planner-photo-test-'));
const fetchImpl = async (url, options = {}) => {
  options.signal?.throwIfAborted();
  const address = String(url);
  if (address === image || address === wikiImage || address.startsWith('https://images.example.org/')) {
    assert.equal(options.headers?.Authorization, undefined);
    assert.equal(options.headers?.['X-Subscription-Token'], undefined);
    downloaded.push(address);
    if (address.endsWith('/broken.jpg')) return new Response('<html>Login</html>', { headers: { 'Content-Type': 'image/jpeg' } });
    return new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } });
  }
  if (address.startsWith('https://api.search.brave.com/')) {
    assert.equal(options.headers['X-Subscription-Token'], 'test-image-key');
    return Response.json({ results: [
      { title: '其他城市 束河古镇', url: 'https://example.org/wrong-city', properties: { url: 'https://images.example.org/wrong.jpg' } },
      { title: '丽江 束河古镇', url: 'https://example.org/a', properties: { url: 'https://images.example.org/broken.jpg' } },
      { title: '丽江 束河古镇', url: 'https://example.org/b', properties: { url: 'https://images.example.org/good.jpg' } },
      { title: '丽江 束河古镇', url: 'https://example.org/c', properties: { url: 'https://images.example.org/unused.jpg' } },
    ] });
  }
  if (address.startsWith('https://commons.wikimedia.org/')) {
    queries.push(new URL(address).searchParams.get('gsrsearch'));
    if (scenario !== 'commons') return Response.json({ query: { pages: {} } });
    return Response.json({ query: { pages: { '1': { title: 'File:昆明 翠湖公園.jpg', index: 1, imageinfo: [{ thumburl: 'https://images.example.org/good.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cuihu.jpg', extmetadata: { ImageDescription: { value: '昆明翠湖公園，照片拍摄于三月' }, Artist: { value: '作者' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } });
  }
  if (address.includes('/tools/search')) {
    const body = JSON.parse(options.body);
    queries.push(body.query);
    if (scenario === 'search-failed' && body.query.includes('site:xiaohongshu.com')) throw new Error('Search unavailable');
    if (!body.query.includes('site:xiaohongshu.com')) return Response.json({ results: [] });
    const results = scenario === 'no-results' ? [] : [{
      title: scenario === 'wrong-city' ? '北京 束河古镇攻略' : '丽江市 束河古镇实景',
      url: scenario === 'fake-domain' ? 'https://xiaohongshu.com.example.org/explore/123abcdef'
        : scenario === 'search-page' ? 'https://www.xiaohongshu.com/search_result?keyword=束河古镇' : noteUrl,
      content: scenario === 'markdown' ? `![丽江 束河古镇](${image})` : '',
    }];
    return Response.json({ results });
  }
  if (address.includes('wikipedia.org/w/api.php')) {
    wikiCalls++;
    return Response.json({ query: { pages: { '1': { pageid: 1, title: '丽江市 束河古镇', thumbnail: { source: wikiImage } } } } });
  }
  assert.equal(address, noteUrl);
  assert.equal(options.headers?.Authorization, undefined, 'provider key never reaches a photo page');
  assert.equal(options.headers?.Cookie, undefined, 'no user login session is collected');
  const html = scenario === 'login' ? '<html><title>请登录小红书</title><meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/default-cover.jpg"></html>'
    : `<html><title>丽江束河古镇</title><meta property="og:image" content="${scenario === 'wrong-image-host' ? 'https://unrelated.example.org/cover.jpg' : image}"></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
};
const photoStore = createPlannerPhotoStore({ directory, fetchImpl });
const service = createPlannerService({ apiKey: 'private-provider-key', fetchImpl, photoStore });

const first = await service.photoFor('束河古镇漫游', '丽江市', signal);
assert.equal(first.sourceUrl, noteUrl);
assert.equal(first.url, image);
assert.match(first.attribution, /小红书/);
assert.match(first.assetId, /^[a-f\d]{64}$/);
assert.ok((await photoStore.read(first.assetId)).length > 0, 'validated photo is really stored');
assert.equal(wikiCalls, 0, 'usable Xiaohongshu image wins before Wikimedia');
const queryCount = queries.length;
await service.photoFor('束河古镇漫游', '丽江市', signal);
assert.equal(queries.length, queryCount, 'cache prevents repeated requests');
const restarted = createPlannerService({ apiKey: 'private-provider-key', fetchImpl: () => { throw new Error('no network after restart'); }, photoStore });
assert.equal((await restarted.photoFor('束河古镇', '丽江市', signal)).assetId, first.assetId, 'disk cache survives restart');

for (scenario of ['login', 'wrong-city', 'fake-domain', 'search-page', 'wrong-image-host', 'no-results', 'search-failed']) {
  const photo = await service.photoFor('束河古镇', '丽江市', signal, true);
  assert.equal(photo.url, wikiImage, scenario);
}
scenario = 'markdown';
assert.equal((await service.photoFor('束河古镇', '丽江市', signal, true)).url, image);
const link = new URL(plannerXiaohongshuSearchUrl('丽江市', '束河古镇漫游'));
assert.equal(link.origin, 'https://www.xiaohongshu.com');
assert.equal(link.searchParams.get('keyword'), '丽江市 束河古镇');
assert.equal(plannerPhotoMonth('2026-09-12'), '九月');
assert.equal(new URL(plannerXiaohongshuSearchUrl('昆明市', '翠湖公园', '2026-09-12')).searchParams.get('keyword'), '昆明市 翠湖公园');
assert.equal(plannerPhotoMatches('昆明翠湖公園', '昆明市', '翠湖公园'), true);
assert.equal(plannerPhotoMatches('其他城市翠湖公园', '昆明市', '翠湖公园'), false);
assert.equal(plannerPhotoCityName('云南省昆明市五华区'), '昆明市');
assert.equal(plannerPhotoMatches('昆明翠湖公園', '云南省昆明市五华区', '翠湖公园'), true);
assert.equal(plannerPhotoPlaceName('漫步翠湖公园及周边'), '翠湖公园');
assert.equal(plannerPhotoPlaceName('翠湖公园观鸥'), '翠湖公园');
assert.equal(plannerPhotoPlaceName('西湖赏荷'), '西湖');
assert.equal(plannerPhotoMatches('翠湖', '昆明市', '翠湖公园', '昆明翠湖公园游记'), true);
assert.equal(plannerPhotoMatches('北京市翠湖公园', '昆明市', '翠湖公园', '昆明翠湖公园'), false);
assert.equal(plannerPhotoMatches('云南省昆明市翠湖公园', '昆明市', '翠湖公园'), true);
assert.equal(plannerPhotoMatches('北京翠湖公园', '云南省昆明市五华区', '翠湖公园'), false);

scenario = 'no-results';
const imageService = createPlannerService({ apiKey: 'private-provider-key', imageSearchKey: 'test-image-key', fetchImpl, photoStore });
const begin = downloaded.length;
const accepted = await imageService.photoFor('束河古镇', '丽江市', signal, true, () => {}, { date: '2026-09-15' });
assert.equal(accepted.url, 'https://images.example.org/good.jpg');
assert.deepEqual(downloaded.slice(begin), ['https://images.example.org/broken.jpg', 'https://images.example.org/good.jpg'], 'wrong place skipped; broken image rejected; stops at first usable image');
assert.ok(queries.every((query) => !query?.includes('九月')), 'travel month must not restrict image searches');
scenario = 'commons';
const outOfSeason = await service.photoFor('翠湖公园', '昆明市', signal, true, () => {}, { date: '2026-09-15' });
assert.equal(outOfSeason.url, 'https://images.example.org/good.jpg', 'different capture month is allowed when place is correct');
await assert.rejects(() => fetchPlannerPhotoBytes('https://127.0.0.1/secret', signal, fetchImpl), /不受支持/);
await assert.rejects(() => fetchPlannerPhotoBytes('https://example.org/image', signal, async () => new Response(null, { status: 302, headers: { Location: 'https://192.168.1.1/private' } })), /不受支持/);
await assert.rejects(() => fetchPlannerPhotoBytes('https://example.org/image', signal, async () => new Response('login', { headers: { 'Content-Type': 'text/html' } })), /不是照片/);
await assert.rejects(() => fetchPlannerPhotoBytes('https://example.org/image', signal, async () => new Response('broken', { headers: { 'Content-Type': 'image/jpeg' } })));

// 本地接口只读取已经下载的文件；不接受 arbitrary URL 代理或伪造文件编号。
const server = await createPlannerServer({ apiKey: 'test', service, photoStore });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/planner/photo-file/${outOfSeason.assetId}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await photoStore.read(outOfSeason.assetId));
  assert.equal((await fetch(`${origin}/api/planner/photo-file/not-a-file`)).status, 400);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
const aborted = new AbortController();
aborted.abort();
await assert.rejects(() => service.photoFor('束河古镇', '丽江市', aborted.signal));
assert.ok(path.resolve(directory).startsWith(`${path.resolve(tmpdir())}${path.sep}`)
  && path.basename(directory).startsWith('planner-photo-test-'), 'cleanup stays in the test-created temporary directory');
await rm(directory, { recursive: true, force: true }); // 仅删除已检查的 mkdtemp 临时缓存目录。
process.stdout.write('Planner photos: Xiaohongshu public priority, page/city matching, login fallback, caching, search links and cancellation: OK\n');
