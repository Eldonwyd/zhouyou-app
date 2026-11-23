import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** 验证省份卡片只保留 AI 入口，个人中心可以下载和删除省级地图缓存。 */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
const page = await context.newPage();
try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.locator('.province-list button').filter({ hasText: '山西' }).click();
  await page.getByRole('heading', { name: '山西省' }).waitFor();
  await page.getByRole('button', { name: 'AI 推荐怎么玩' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /缓存离线|删除离线/ }).count(), 0);

  const offlineMaps = page.getByRole('region', { name: '离线地图' });
  const provinceSelect = offlineMaps.getByLabel('省级地区');
  await page.getByRole('button', { name: '个人中心' }).click();
  await offlineMaps.getByRole('option', { name: '山西省', exact: true }).waitFor({ state: 'attached' });
  assert.equal(await provinceSelect.inputValue(), '140000');
  await offlineMaps.getByRole('button', { name: '缓存离线地图' }).click();
  await offlineMaps.getByRole('button', { name: '删除离线地图' }).waitFor();

  // 刷新会清空内存中的地图，太原市必须从原有的持久缓存读取。
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('heading', { name: '中国旅行地图' }).waitFor();
  await page.locator('.province-list button').filter({ hasText: '山西' }).click();
  await page.locator('.city-list button').filter({ hasText: '太原市' }).waitFor();
  await page.getByRole('button', { name: '个人中心' }).click();
  await offlineMaps.getByRole('option', { name: '山西省（已缓存）' }).waitFor({ state: 'attached' });
  assert.equal(await provinceSelect.inputValue(), '140000');
  await offlineMaps.getByRole('button', { name: '删除离线地图' }).click();
  await offlineMaps.getByRole('button', { name: '缓存离线地图' }).waitFor();
  const cached = await page.evaluate(async () => (await caches.open('travel-region-maps-v1')).keys());
  assert.equal(cached.length, 0);

  await page.getByRole('button', { name: '地图足迹' }).click();
  await page.getByText('当前地区尚未缓存，请联网后前往个人中心的「离线地图」下载。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回全国' }).click();
  await page.locator('.province-list button').filter({ hasText: '河北' }).click();
  await page.getByText('当前地区尚未缓存，请联网后前往个人中心的「离线地图」下载。', { exact: true }).waitFor();
  process.stdout.write('Profile map controls, offline reload, and cache removal: OK\n');
} finally {
  await browser.close();
}
