import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** A real browser verifies province browsing and legacy finance migration. */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true, args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.province-choice-grid button').filter({ hasText: '贵州省' }).click();
  await page.locator('.city-choice-grid button').filter({ hasText: '安顺市' }).click();
  await page.getByRole('heading', { name: '安顺市 · 旅行手账' }).waitFor();
  await page.getByRole('button', { name: '＋ 新建旅行' }).click();
  await page.getByLabel('旅行名称').fill('贵州山水计划');
  await page.getByLabel('开始日期').fill('2026-10-01');
  await page.getByLabel('结束日期').fill('2026-10-03');
  await page.getByLabel('旅行状态').selectOption('planned');
  await page.getByLabel('黔南布依族苗族自治州').check();
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('heading', { name: '贵州山水计划' }).waitFor();

  // Seed the old city-wide sheet exactly as an existing browser would store it.
  // The migration button must transfer its full budget without overwriting it.
  await page.evaluate(async () => {
    const request = indexedDB.open('travel-footprints', 2);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('plans', 'readwrite');
    transaction.objectStore('plans').put({
      id: '520400', cityCode: '520400', startDate: '2026-10-01', endDate: '2026-10-03',
      people: 2, budget: { transport: 500, lodging: 0, tickets: 0, food: 0, other: 0 },
      actual: { transport: 0, lodging: 0, tickets: 0, food: 100, other: 0 },
      manualActualTotal: null, reminderDays: 3,
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '计划与花费' }).click();
  await page.locator('.finance-journey-card').filter({ hasText: '旧版城市账单' }).click();
  await page.getByLabel('选择归入的旅行').selectOption({ label: '贵州山水计划 · 2026-10-01' });
  await page.getByRole('button', { name: '归入旅行' }).click();
  await page.getByText('旧版账单已归入“贵州山水计划”。').waitFor();
  assert.equal(await page.locator('.finance-journey-card').count(), 1);
  await page.locator('.amount-section').first().getByLabel('住宿').fill('200');
  await page.getByRole('button', { name: '保存计划' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '计划与花费' }).click();
  assert.match(await page.locator('.planner-summary').innerText(), /700/);
  assert.match(await page.locator('.planner-summary').innerText(), /100/);

  // The same journey is discoverable through either city in its province.
  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.province-choice-grid button').filter({ hasText: '贵州省' }).click();
  await page.locator('.city-choice-grid button').filter({ hasText: '黔南布依族苗族自治州' }).click();
  await page.locator('.journey-card').filter({ hasText: '贵州山水计划' }).waitFor();
  await page.getByRole('button', { name: '查看全部旅行' }).click();
  await page.locator('.journey-card').filter({ hasText: '贵州山水计划' }).waitFor();
  await page.getByRole('button', { name: '旅途成就' }).click();
  assert.match(await page.locator('.metric-card').nth(1).innerText(), /0/);
  assert.deepEqual(pageErrors, []);
  process.stdout.write('Province browsing, planned journey, finance migration and persistence: OK\n');
} finally {
  await browser.close();
}
