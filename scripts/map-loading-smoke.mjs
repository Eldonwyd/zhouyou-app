import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** Exercise actual loading failures, retry and navigation with delayed requests.
 * Block service workers only in this test so intercepted HTTP responses reach
 * the loader deterministically rather than coming from a persistent map cache.
 */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const baseUrl = process.env.TRAVEL_TEST_URL || 'http://127.0.0.1:5173/';
const chooseProvince = (name) => page.locator('.province-list button').filter({ hasText: name }).click();
const waitForCity = (name) => page.locator('.city-list button').filter({ hasText: name }).waitFor();

try {
  // A failed national request must stop loading and support a handled retry.
  await page.route('**/maps/china.json', async (route) => {
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  }, { times: 1 });
  await page.goto(baseUrl);
  await page.locator('.map-overlay.error').waitFor();
  assert.match(await page.locator('.map-overlay.error').innerText(), /china\.json.*503/);
  await page.getByRole('button', { name: '重新加载地图' }).click();
  await page.locator('.province-list button').first().waitFor();

  // Reproduce the screenshot with a province HTTP failure. Retry must stay in
  // Guizhou and display its nine regions without returning to the country map.
  await page.route('**/maps/520000.json', async (route) => {
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  }, { times: 1 });
  await chooseProvince('贵州');
  await page.locator('.map-overlay.error').waitFor();
  assert.match(await page.locator('.map-overlay.error').innerText(), /520000\.json.*503/);
  await page.getByRole('button', { name: '重新加载地图' }).click();
  await waitForCity('贵阳市');
  assert.equal(await page.locator('.city-list button').count(), 9);
  await page.getByRole('button', { name: '返回全国' }).click();

  // Hold a different province request while navigating away. Its late failure
  // must not clear the successfully loaded Guizhou map or replace its notice.
  let releaseOldRequest;
  let markRequestStarted;
  const oldRequestGate = new Promise((resolve) => { releaseOldRequest = resolve; });
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
  await page.route('**/maps/140000.json', async (route) => {
    markRequestStarted();
    await oldRequestGate;
    await route.fulfill({ status: 503, body: 'late failure' });
  }, { times: 1 });
  await chooseProvince('山西');
  await requestStarted;
  await page.getByRole('button', { name: '返回全国' }).click();
  await chooseProvince('贵州');
  await waitForCity('贵阳市');
  const oldResponse = page.waitForResponse((response) => response.url().endsWith('/maps/140000.json'));
  releaseOldRequest();
  await (await oldResponse).finished();
  // Cross a browser task boundary after fetch settles, allowing the rejected
  // loading promise and React state updates to run before checking the result.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.city-list button').count(), 9);
  assert.match(await page.locator('.map-bottom').innerText(), /点击城市查看或标记旅行/);
  assert.deepEqual(pageErrors, []);
  process.stdout.write('National/province retry, Guizhou 9 regions, stale-request isolation: OK\n');
} finally {
  await browser.close();
}
