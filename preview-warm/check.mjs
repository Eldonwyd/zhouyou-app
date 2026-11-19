import assert from 'node:assert/strict';
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 独立上下文验证预览交互与两种屏宽，不访问或修改正式版数据库。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator('.trip-card').count(), 3);
  await page.screenshot({ path: path.join(tmpdir(), 'warm-journal-desktop.png'), fullPage: true });
  await page.getByLabel('搜索旅行或城市').fill('杭州');
  assert.equal(await page.locator('.trip-card').count(), 1);
  await page.getByLabel('搜索旅行或城市').fill('');
  await page.locator('.trip-info').first().click();
  await page.getByLabel('写一条回忆').fill('测试：下一次还想和你一起来。');
  await page.getByRole('button', { name: '收好这条回忆' }).click();
  assert.match(await page.locator('.detail-notes').innerText(), /下一次还想/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.sidebar [data-page="achievements"]').click();
  assert.equal(await page.locator('.badge-card').count(), 4);
  await page.screenshot({ path: path.join(tmpdir(), 'warm-achievements-desktop.png'), fullPage: true });
  await page.locator('.badge-card').first().click();
  const posterDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '存一张纪念卡' }).click();
  assert.match((await posterDownload).suggestedFilename(), /纪念卡.png/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.sidebar [data-page="profile"]').click();
  await page.getByRole('button', { name: '编辑资料' }).click();
  await page.getByLabel('怎么称呼你').fill('小禾');
  await page.getByRole('button', { name: '保存名片' }).click();
  assert.equal(await page.locator('.profile-banner h2').innerText(), '小禾');
  await page.screenshot({ path: path.join(tmpdir(), 'warm-profile-desktop.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.profile-banner h2').innerText(), '小禾');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const key of ['journal', 'achievements', 'profile']) {
    await page.locator(`.mobile-nav [data-page="${key}"]`).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(tmpdir(), `warm-${key}-mobile.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key !== 'travel-warm-preview-v1').length), 0);
  console.log('PASS: 三页渲染、图片加载、筛选、保存短记、纪念卡下载、资料持久化、手机无横向溢出、数据隔离');
  console.log(`截图：${tmpdir()}\\warm-*.png`);
} finally { await browser.close(); }
