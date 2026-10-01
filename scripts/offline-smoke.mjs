import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** Confirm that the production build starts offline and honors manual region caching. */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.locator('.province-list button').filter({ hasText: '山西' }).click();
  await page.getByRole('heading', { name: '山西省' }).waitFor();
  await page.getByRole('button', { name: '缓存该省市级地图' }).click();
  await page.getByRole('button', { name: '删除该省离线地图' }).waitFor();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('heading', { name: '中国旅行地图' }).waitFor();
  await page.locator('.province-list button').filter({ hasText: '山西' }).click();
  await page.locator('.city-list button').filter({ hasText: '太原市' }).waitFor();
  await page.getByRole('button', { name: '个人中心' }).click();
  await page.getByRole('heading', { name: '个人中心' }).waitFor();
  await page.getByRole('button', { name: '地图足迹' }).click();
  await page.getByRole('button', { name: '返回全国' }).click();
  await page.locator('.province-list button').filter({ hasText: '河北' }).click();
  await page.getByText('当前地区尚未缓存，请联网后选择缓存', { exact: true }).waitFor();
  const cached = await page.evaluate(async () => (await caches.open('travel-region-maps-v1')).keys());
  assert.equal(cached.length, 1);
  process.stdout.write('Offline shell, cached Shanxi, uncached Hebei fallback: OK\n');
} finally {
  await browser.close();
}
