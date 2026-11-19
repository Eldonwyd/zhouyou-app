import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { aiPlanFixture } from './planner-fixture.mjs';
import { shiftPlannerDates } from '../src/planner-domain.ts';

/** 测试浏览器真实保存和 ZIP 往返；图片传输模拟，不依赖外站或消耗账户额度。 */
const bytes = await sharp({ create: { width: 400, height: 240, channels: 3, background: '#278872' } }).webp().toBuffer();
const assetId = createHash('sha256').update(bytes).digest('hex');
const photo = { url: 'https://images.example.org/cuihu.jpg', sourceUrl: 'https://example.org/kunming-cuihu', attribution: '测试来源 · 昆明翠湖', assetId };
const plan = aiPlanFixture();
plan.content = shiftPlannerDates(plan.content, '2026-09-15');
Object.assign(plan.content.days[0].activities[0], { title: '翠湖公园', city: '昆明市', location: '翠湖公园', photoQuery: '翠湖公园' });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
let fileCalls = 0;
let photoCalls = 0;
let offlineFiles = false;
let imageSearchConfigured = false;
let loggedIn = false;
let holdPhotoRequests = false;
const heldPhotoRoutes = [];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('https://images.example.org/**', () => { throw new Error('must use local bytes, never hotlink original'); });
await page.route('**/api/planner/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/photo-settings')) {
    const body = route.request().postDataJSON();
    if (body.imageSearchKey) { assert.equal(body.imageSearchKey, 'test-brave-key'); imageSearchConfigured = true; }
    return route.fulfill({ json: { imageSearchConfigured, xhsConfigured: true } });
  }
  if (url.endsWith('/xhs-status')) {
    if (!loggedIn) {
      // 首次检查失败；将手动重试挂起，验证扫码入口无需等待状态接口返回。
      if (route.request().postDataJSON().fresh) return;
      return route.fulfill({ status: 502, json: { error: '模拟检查接口暂不可达' } });
    }
    return route.fulfill({ json: { connected: true, loggedIn, message: '小红书已登录，可优先站内搜图' } });
  }
  if (url.endsWith('/xhs-qrcode')) {
    loggedIn = true; // 模拟用户在手机确认，测试不接触真实账号。
    return route.fulfill({ json: { loggedIn: false, image: `data:image/webp;base64,${bytes.toString('base64')}` } });
  }
  if (url.includes('/health')) return route.fulfill({ json: { configured: true } });
  if (url.includes('/photo-file/')) {
    fileCalls++;
    return offlineFiles ? route.abort('failed') : route.fulfill({ contentType: 'image/webp', body: bytes });
  }
  if (url.endsWith('/photo')) {
    const body = route.request().postDataJSON();
    assert.ok(plan.content.days.some((day) => day.date === body.date), 'each card sends its own trip date');
    assert.equal(body.stream, true);
    // 行程打开后其他景点卡也会自动补图；这里只统计翠湖这张卡的请求。
    if (body.title !== '翠湖公园') return route.fulfill({ json: { photo: null } });
    assert.equal(body.date, '2026-09-15');
    assert.equal(body.city, '昆明市');
    photoCalls++;
    if (holdPhotoRequests) { heldPhotoRoutes.push(route); return; }
    return route.fulfill({ contentType: 'application/x-ndjson; charset=utf-8', body:
      `${JSON.stringify({ type: 'progress', stage: '已匹配小红书封面，正在下载并保存照片' })}\n`
      + `${JSON.stringify({ type: 'result', result: { photo } })}\n` });
  }
  return route.abort();
});
const readPlan = () => page.evaluate(async () => (await (await import('/src/db.ts')).getAll('aiPlans'))[0]);
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async (value) => (await import('/src/db.ts')).saveAiPlan(value, null), plan);
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  // 小红书登录：检查失败后可手动重试，重试尚未完成时也可以取二维码。
  await page.locator('.planner-photo-settings summary').click();
  await page.getByText('暂时无法检查小红书登录状态，可以直接获取登录二维码。', { exact: true }).waitFor();
  const freshCheck = page.waitForRequest((request) => request.url().endsWith('/xhs-status'));
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  assert.equal((await freshCheck).postDataJSON().fresh, true, 'manual check bypasses cached status');
  await page.getByText('正在检查登录状态，通常需要约 10 秒。', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('图片搜索 API Key').count(), 0);
  await page.getByRole('button', { name: '获取登录二维码', exact: true }).click();
  await page.getByAltText('小红书登录二维码，请使用小红书 App 扫描', { exact: true }).waitFor();
  await page.getByText('小红书已登录，可优先站内搜图', { exact: true }).waitFor();
  await page.locator('.planner-photo-settings summary').filter({ hasText: '已登录' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '获取登录二维码' }).count(), 0, 'no QR button once logged in');
  await page.locator('.planner-photo-settings summary').click();
  const first = page.locator('.planner-activity').first();
  // 没有照片的景点卡会自动排队查找，无需手动点击。
  await first.getByText(/已保存到本地/).waitFor();
  const image = first.locator('.planner-photo > img');
  await image.evaluate((element) => element.decode());
  assert.ok((await image.getAttribute('src')).startsWith('blob:'));
  assert.equal((await readPlan()).content.days[0].activities[0].photo.assetId, assetId);
  assert.equal(await first.getByRole('link', { name: photo.attribution }).getAttribute('href'), photo.sourceUrl);
  const searchUrl = new URL(await first.getByRole('link', { name: '去小红书搜这个地点' }).getAttribute('href'));
  assert.ok(!searchUrl.searchParams.get('keyword').includes('九月'));
  assert.equal(photoCalls, 1, 'auto lookup runs once and the first suitable photo stops the flow');
  assert.ok(fileCalls >= 1);

  // 模拟永远不返回的图片接口：立即显示进度且允许取消，已有照片不能被清空。
  holdPhotoRequests = true;
  await first.getByRole('button', { name: '按小红书优先重新查找', exact: true }).click();
  await first.getByText(/已等待/).waitFor();
  await first.getByRole('button', { name: '取消查找', exact: true }).click();
  await first.getByText('已取消查找，原照片已保留', { exact: true }).waitFor();
  assert.equal(await first.getByRole('button', { name: '按小红书优先重新查找', exact: true }).isEnabled(), true);
  assert.equal((await readPlan()).content.days[0].activities[0].photo.assetId, assetId);
  for (const route of heldPhotoRoutes) await route.abort().catch(() => {});
  holdPhotoRequests = false;
  assert.equal(photoCalls, 2);

  // 模拟照片服务不可达，刷新仍从 IndexedDB 读取，不依赖服务端缓存或源网址。
  offlineFiles = true;
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-activity').first().getByText(/已保存到本地/).waitFor();
  await page.locator('.planner-activity').first().locator('.planner-photo > img').evaluate((element) => element.decode());
  assert.equal(photoCalls, 2);
  const saved = await readPlan();

  // ZIP 保存的是独立二进制文件，恢复前校验内容散列及浏览器解码。
  await page.getByRole('button', { name: '个人中心', exact: false }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const archive = await (await downloadPromise).path();
  await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    const database = await db.openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['aiPlans', 'plannerPhotoFiles'], 'readwrite');
      transaction.objectStore('aiPlans').clear(); transaction.objectStore('plannerPhotoFiles').clear();
      transaction.oncomplete = resolve; transaction.onerror = reject;
    });
  });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(archive);
  await page.locator('.toast').filter({ hasText: '备份已导入' }).waitFor();
  assert.deepEqual(await readPlan(), saved);
  assert.equal(await page.evaluate(async (id) => (await (await import('/src/db.ts')).getPlannerPhotoBlob(id))?.size, assetId), bytes.length);
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-activity').first().getByText(/已保存到本地/).waitFor();
  await page.locator('.planner-activity').first().locator('.planner-photo > img').evaluate((element) => element.decode());
  assert.deepEqual(errors, []);
  process.stdout.write('Planner photo browser: month query, single automatic result, local decoding, refresh without photo server, source link and ZIP binary restore: OK\n');
} finally { await browser.close(); }
