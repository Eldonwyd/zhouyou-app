import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** Verify that an old planned mark needs an explicit visit confirmation. */
const baseUrl = process.env.TRAVEL_TEST_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.province-list button').first().waitFor();
  await page.evaluate(async () => {
    const request = indexedDB.open('travel-footprints');
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['marks', 'trips'], 'readwrite');
    transaction.objectStore('marks').put({
      id: '520400', name: '安顺市', provinceCode: '520000',
      visited: false, planned: true, updatedAt: new Date().toISOString(),
    });
    transaction.objectStore('trips').put({
      id: 'future-guizhou', title: '贵州旅行计划', status: 'planned',
      startDate: '2027-05-01', endDate: '2027-05-03',
      cities: [{ code: '520400', name: '安顺市', provinceCode: '520000' }],
      companions: [], createdAt: new Date().toISOString(),
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
  const city = page.locator('.city-list button').filter({ hasText: '安顺市' });
  await city.waitFor();
  // 未去过的城市使用主题的“未标记”底色（随深浅主题变化），而不是省份高亮色。
  const swatch = await city.locator('.city-swatch').evaluate((element) => {
    const probe = document.createElement('i'); probe.style.background = 'var(--map-area)'; document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor; probe.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  assert.equal(swatch.actual, swatch.expected);
  await city.click();
  // First click directly lights up the city without a confirmation dialog or jumping away.
  await page.getByText('安顺市已点亮为已去过').waitFor();
  assert.equal(await page.getByRole('dialog', { name: '安顺市' }).count(), 0);
  // Second click opens the action dialog with journal / unvisit / cancel choices.
  await city.click();
  const dialog = page.getByRole('dialog', { name: '安顺市' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: '安顺市' }).count(), 0);
  // Can unvisit cleanly and re-light with a single click.
  await city.click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '取消点亮', exact: true }).click();
  await page.getByText('安顺市已取消点亮。').waitFor();
  await city.click();
  await page.getByText('安顺市已点亮为已去过').waitFor();
  // Enter journal via second click -> 进入旅行手账.
  await city.click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '进入旅行手账', exact: true }).click();
  await page.getByRole('heading', { name: '安顺市 · 旅行手账' }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const saved = await page.evaluate(async () => {
    const request = indexedDB.open('travel-footprints');
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['marks', 'trips'], 'readonly');
    const read = (store, key) => new Promise((resolve, reject) => {
      const itemRequest = transaction.objectStore(store).get(key);
      itemRequest.onsuccess = () => resolve(itemRequest.result);
      itemRequest.onerror = () => reject(itemRequest.error);
    });
    const result = { mark: await read('marks', '520400'), trip: await read('trips', 'future-guizhou') };
    database.close();
    return result;
  });
  assert.equal(saved.mark.visited, true);
  assert.equal(saved.mark.planned, false);
  assert.equal(saved.trip.status, 'planned');
  process.stdout.write('Old planned city requires confirmation; future trip remains intact: OK\n');
} finally {
  await browser.close();
}
