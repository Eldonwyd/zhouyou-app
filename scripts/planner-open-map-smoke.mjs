import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aiPlanFixture } from './planner-fixture.mjs';
import { mkdir } from 'node:fs/promises';

/** 浏览器回归使用隔离数据与模拟地图响应，不访问公共地图或消耗AI额度。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  const mapQueries = [];
  async function waitForSaved(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const saved = await page.evaluate(async () => (await (await import('/src/db.ts')).getAll('aiPlans'))[0]);
      if (predicate(saved)) return;
      await page.waitForTimeout(100);
    }
    throw new Error('等待地图或酒店持久化超时');
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef1e7"/></svg>' }));
  await page.route('**/api/planner/**', (route) => {
    const endpoint = route.request().url().split('/').at(-1);
    if (endpoint === 'health') return route.fulfill({ json: { configured: true } });
    const body = route.request().postDataJSON();
    if (endpoint === 'map') mapQueries.push(...body.places.map((place) => place.key));
    const result = endpoint === 'map' ? {
      notice: '', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      positions: body.places.map((place) => ({ key: place.key, status: 'located', latitude: 26.87 + mapQueries.length * .01, longitude: 100.24 + mapQueries.length * .01, source: '测试开放数据' })),
    } : endpoint === 'tickets' ? { items: [], checkedAt: new Date().toISOString(), networkAvailable: true } : { photo: null };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result }) + '\n' });
  });
  await page.goto('http://127.0.0.1:5173/');
  const fixture = aiPlanFixture();
  // 此回归测试只改一个独立地点，用餐使用固定店名，避免“附近用餐”按需求联动位置。
  for (const day of fixture.content.days) for (const activity of day.activities) {
    if (activity.kind === 'food') activity.location = '测试固定餐厅';
  }
  await page.evaluate(async (plan) => (await import('/src/db.ts')).saveAiPlan(plan, null), fixture);
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await waitForSaved((plan) => Object.keys(plan.mapPositions || {}).length > 0);
  await waitForSaved((plan) => Boolean(plan.ticketPlan));
  assert.ok(mapQueries.length > 0, '地图未展开就已开始定位并保存');
  // 两晚选择不同酒店；保存后跳转链接及地图数据均应对应当天。
  await page.getByLabel('2026-12-01具体酒店名称').fill('第一晚测试酒店');
  await page.locator('.planner-hotel-form').first().getByRole('button', { name: '保存酒店' }).click();
  await page.getByRole('link', { name: '在高德地图查看酒店' }).first().waitFor();
  await page.getByLabel('2026-12-02具体酒店名称').fill('第二晚测试酒店');
  await page.locator('.planner-hotel-form').nth(1).getByRole('button', { name: '保存酒店' }).click();
  await waitForSaved((plan) => plan.hotels?.['2026-12-02'] === '第二晚测试酒店');
  await page.waitForFunction(() => !document.querySelector('.planner-map [role="status"]'));
  const beforeOpen = mapQueries.length;
  await page.getByRole('button', { name: '查看行程地图', exact: true }).click();
  await page.locator('.planner-number-marker').first().waitFor();
  assert.equal(mapQueries.length, beforeOpen, '展开地图不重新查坐标');
  await page.getByLabel('地图日期', { exact: true }).selectOption('2026-12-01');
  await page.waitForFunction(() => document.querySelectorAll('.planner-number-marker').length === 3);
  assert.ok((await page.locator('.planner-stop-label').allTextContents()).some((text) => text.includes('第一晚测试酒店')));
  assert.ok(!(await page.locator('.planner-stop-label').allTextContents()).some((text) => text.includes('第二晚测试酒店')), JSON.stringify(await page.locator('.planner-stop-label').allTextContents()));
  assert.deepEqual(await page.locator('.planner-number-marker').allTextContents(), ['1', '2', '3']);
  assert.ok(await page.locator('.planner-route-arrow').count() > 0);
  assert.equal(await page.locator('.planner-map-places').count(), 0);
  await mkdir('.openai', { recursive: true });
  await page.locator('.planner-map').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.openai/planner-route-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.planner-map').screenshot({ path: '.openai/planner-route-mobile.png' });
  await page.locator('.planner-number-marker').first().click({ force: true });
  await page.locator('.leaflet-popup-content').getByRole('button', { name: '调整位置' }).click();
  await page.locator('.planner-map-canvas').click({ position: { x: 100, y: 120 } });
  await waitForSaved((plan) => Object.values(plan.mapPositions || {}).some((position) => position.source === '手动确认'));
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  assert.equal(await page.getByLabel('2026-12-01具体酒店名称').inputValue(), '第一晚测试酒店');
  assert.equal(await page.getByLabel('2026-12-02具体酒店名称').inputValue(), '第二晚测试酒店');
  const saved = await page.evaluate(async () => (await (await import('/src/db.ts')).getAll('aiPlans'))[0]);
  assert.ok(Object.entries(saved.mapPositions).some(([key, value]) => key.includes('2026-12-01') && value.source === '手动确认'));
  // 一次只改一个地点；其余日期的位置从持久化数据读取。
  const beforeEdit = mapQueries.length;
  await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    const plan = (await db.getAll('aiPlans'))[0];
    plan.content.days[1].activities[0].location = '新测试景点';
    plan.content.days[1].activities[0].photoQuery = '新测试景点';
    const oldVersion = plan.version;
    plan.version++;
    await db.saveAiPlan(plan, oldVersion);
  });
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await waitForSaved((plan) => Object.keys(plan.mapPositions || {}).some((key) => key.includes('新测试景点')));
  assert.equal(mapQueries.length - beforeEdit, 1, '只查询修改的一个地点');
  assert.deepEqual(errors, []);
  console.log('浏览器验证：关闭地图自动定位、展开不重复查询、单地点增量更新、酒店与校正持久化通过');
} finally { await browser.close(); }
