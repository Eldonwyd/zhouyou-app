import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** 真实组件搭配隔离测试数据：不会读取用户正在使用的浏览器数据库。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.warm-sidebar-note').count(), 0, '侧栏装饰便笺已移除');
  await page.screenshot({ path: path.join(os.tmpdir(), 'warm-full-map.png'), fullPage: true });
  const photo = [...await readFile('../preview-warm/assets/scene-0.jpg')];
  await page.evaluate(async (bytes) => {
    const { saveItem, saveMediaBatch } = await import('/src/db.ts');
    const cities = [{ code: '530700', name: '丽江市', provinceCode: '530000' }, { code: '530100', name: '昆明市', provinceCode: '530000' }];
    for (const city of cities) await saveItem('marks', { id: city.code, name: city.name, provinceCode: city.provinceCode, visited: true, planned: false, updatedAt: new Date().toISOString() });
    await saveItem('trips', { id: 'warm-trip', title: '在云南，慢慢过一周', cities, startDate: '2026-11-10', endDate: '2026-11-16', status: 'visited', companions: ['小满'], createdAt: new Date().toISOString() });
    await saveItem('places', { id: 'warm-place', tripId: 'warm-trip', cityCode: cities[0].code, name: '丽江古城', createdAt: new Date().toISOString(), reviewText: '回来以后，还是会想起那碗热腾腾的米线。', reviewAudioId: null });
    const entry = { id: 'warm-entry', tripId: 'warm-trip', placeId: 'warm-place', cityCode: cities[0].code, date: '2026-11-12', period: 'afternoon', note: '太阳晒在木头窗沿上，坐着就不想走了。', place: '丽江古城', order: 1, highlight: true };
    const media = { id: 'warm-photo', tripId: 'warm-trip', placeId: 'warm-place', entryId: entry.id, cityCode: cities[0].code, kind: 'photo', fileName: '风景.jpg', mimeType: 'image/jpeg', capturedAt: '2026-11-12T08:00:00Z', placeName: '丽江古城', latitude: null, longitude: null };
    await saveMediaBatch([{ media, blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }) }], [entry]);
  }, photo);
  await page.reload({ waitUntil: 'networkidle' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, label] of [['map', '地图足迹'], ['plan', '行程规划'], ['detail', '旅行手账'], ['achievements', '旅途成就'], ['profile', '个人中心']]) {
      await page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${width}: 页面不横向溢出`);
      if (width > 850) {
        const geometry = await page.evaluate(() => ({ sidebar: document.querySelector('.sidebar').getBoundingClientRect().right, main: document.querySelector('.main-shell').getBoundingClientRect().left }));
        assert.ok(Math.abs(geometry.sidebar - geometry.main) < 2, '主区紧接侧栏，不重复偏移');
      }
      assert.ok(await page.locator('.sidebar .travel-icon').first().evaluate((node) => node.getBoundingClientRect().width < 30));
      await page.screenshot({ path: path.join(os.tmpdir(), `warm-full-${name}-${width}.png`), fullPage: true });
    }
  }
  await page.locator('.sidebar').getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '编辑资料' }).click();
  await page.getByLabel('称呼').fill('小满');
  await page.getByRole('button', { name: '保存称呼' }).click();
  await page.getByRole('heading', { name: '小满', exact: true }).waitFor();
  await page.locator('.sidebar').getByRole('button', { name: '旅途成就', exact: true }).click();
  await page.locator('.warm-highlight-card').first().click();
  await page.getByRole('dialog', { name: '丽江古城的回忆' }).waitFor();
  await page.getByRole('button', { name: '关闭地点回忆' }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: 全部五页桌面/手机布局、真实照片封面、高光跳转、称呼保存与图标尺寸');
} finally { await browser.close(); }
