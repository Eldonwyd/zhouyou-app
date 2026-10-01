import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

/** Cover the city-first workflow without relying on an existing journey. */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, acceptDownloads: true });
await context.grantPermissions(['microphone']);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dZkAAAAASUVORK5CYII=', 'base64');

/** Preserve the desired file date even when the test machine's clock changes. */
async function uploadDatedPhoto(name, date, placeName) {
  await page.waitForFunction((expected) => document.querySelectorAll('.upload-station select')[0]?.selectedOptions[0]?.textContent === expected, placeName);
  await page.locator('.upload-station input[type="file"]').evaluate((input, item) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(item.bytes)], item.name, {
      type: 'image/png', lastModified: Date.parse(item.date),
    }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, date, bytes: [...pixel] });
  await page.getByText(`已导入 1 个文件至 ${placeName}。`).waitFor();
}

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
  await page.locator('.city-list button').filter({ hasText: '安顺市' }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('heading', { name: '安顺市的城市记录' }).waitFor();

  await page.getByPlaceholder('例如：黄果树瀑布').fill('黄果树瀑布');
  await page.getByRole('button', { name: '创建地点' }).click();
  await uploadDatedPhoto('falls.png', '2026-10-01T12:00:00', '黄果树瀑布');
  await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).click();
  await page.locator('.memory-book textarea').fill('瀑布的水雾');
  await page.getByRole('button', { name: '保存文字' }).click();
  await page.getByText('地点评语已保存。').waitFor();
  await page.getByRole('button', { name: '录制语音评语' }).click();
  await page.getByRole('button', { name: '停止录音' }).waitFor();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '停止录音' }).click();
  await page.locator('.memory-book audio').waitFor();
  await page.getByRole('button', { name: '关闭地点回忆' }).click();
  // The same place also contains a photo from another visit. Only the dated
  // match may move; the older original must remain in city records.
  await uploadDatedPhoto('falls-old.png', '2020-01-01T12:00:00', '黄果树瀑布');
  await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).getByText('2 张旅行片段').waitFor();

  await page.getByPlaceholder('例如：黄果树瀑布').fill('旧城散步');
  await page.getByRole('button', { name: '创建地点' }).click();
  await uploadDatedPhoto('old.png', '2020-01-01T12:00:00', '旧城散步');
  await page.getByLabel('地点记录日期').fill('2026-10-01');
  await page.getByPlaceholder('例如：黄果树瀑布').fill('老街手账');
  await page.getByRole('button', { name: '创建地点' }).click();
  await page.locator('.place-card').filter({ hasText: '老街手账' }).click();
  await page.locator('.memory-book textarea').fill('没有照片，也记得那条街');
  await page.getByRole('button', { name: '保存文字' }).click();
  await page.getByText('地点评语已保存。').waitFor();
  await page.getByRole('button', { name: '关闭地点回忆' }).click();
  await page.locator('.place-card').filter({ hasText: '老街手账' }).getByText('没有照片，也记得那条街').waitFor();
  assert.equal(await page.locator('.place-card').count(), 3);

  // A backup made before any journey must restore null journey links and files.
  await page.locator('.sidebar').getByRole('button', { name: '个人中心' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const archive = await (await downloadPromise).path();
  assert.ok(archive);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(archive);
  await page.getByText('备份已导入，旅行记录和媒体已恢复。').waitFor();

  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.province-choice-grid button').filter({ hasText: '贵州省' }).click();
  await page.locator('.city-choice-grid button').filter({ hasText: '安顺市' }).click();
  await page.getByRole('heading', { name: '安顺市的城市记录' }).waitFor();
  assert.equal(await page.locator('.place-card').count(), 3);
  await page.getByRole('button', { name: '＋ 新建旅行' }).click();
  await page.getByLabel('旅行名称').fill('贵州瀑布之旅');
  await page.getByLabel('开始日期').fill('2026-10-01');
  await page.getByLabel('结束日期').fill('2026-10-01');
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByText(/已自动归入 2 个地点、2 份媒体/).waitFor();
  await page.getByRole('heading', { name: '贵州瀑布之旅' }).waitFor();
  assert.equal(await page.locator('.place-card').count(), 2);
  await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).click();
  assert.equal(await page.locator('.memory-book textarea').inputValue(), '瀑布的水雾');
  await page.locator('.memory-book audio').waitFor();
  await page.getByRole('button', { name: '关闭地点回忆' }).click();
  await page.getByRole('button', { name: /返回城市记录与旅行列表/ }).click();
  assert.equal(await page.locator('.place-card').count(), 2);
  assert.match(await page.locator('.place-card-grid').innerText(), /旧城散步/);
  assert.match(await page.locator('.place-card-grid').innerText(), /黄果树瀑布/);
  await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).click();
  await page.locator('.memory-book audio').waitFor();
  await page.getByRole('button', { name: '关闭地点回忆' }).click();

  // Refresh proves both the claimed and unmatched photos remain in IndexedDB.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.province-choice-grid button').filter({ hasText: '贵州省' }).click();
  await page.locator('.city-choice-grid button').filter({ hasText: '安顺市' }).click();
  assert.equal(await page.locator('.place-card').count(), 2);
  assert.match(await page.locator('.place-card-grid').innerText(), /旧城散步/);
  await page.locator('.journey-card').filter({ hasText: '贵州瀑布之旅' }).click();
  assert.equal(await page.locator('.place-card').count(), 2);
  assert.match(await page.locator('.place-card-grid').innerText(), /黄果树瀑布/);
  assert.match(await page.locator('.place-card-grid').innerText(), /老街手账/);
  await page.locator('.sidebar').getByRole('button', { name: '旅途成就' }).click();
  assert.match(await page.locator('.metric-card').nth(1).innerText(), /2/);

  // A city opened from the province catalogue can start a record without a
  // prior map mark. Saving its first place lights the city on the map.
  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.province-choice-grid button').filter({ hasText: '贵州省' }).click();
  await page.locator('.city-choice-grid button').filter({ hasText: '贵阳市' }).click();
  await page.getByPlaceholder('例如：黄果树瀑布').fill('城市日记');
  await page.getByRole('button', { name: '创建地点' }).click();
  await page.locator('.place-card').filter({ hasText: '城市日记' }).waitFor();
  await page.getByText('已创建地点：城市日记').waitFor();
  const cityMark = await page.evaluate(async () => {
    const request = indexedDB.open('travel-footprints', 2);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const markRequest = database.transaction('marks', 'readonly').objectStore('marks').get('520100');
    return new Promise((resolve) => { markRequest.onsuccess = () => resolve(markRequest.result); });
  });
  assert.equal(cityMark?.visited, true);
  // The all-records view must include both dated journeys and cities that
  // still keep their photos directly under the city rather than a journey.
  await page.getByRole('button', { name: '查看全部旅行' }).click();
  await page.locator('.saved-city-card').filter({ hasText: '安顺市' }).waitFor();
  await page.locator('.saved-city-card').filter({ hasText: '贵阳市' }).waitFor();
  await page.locator('.journey-card').filter({ hasText: '贵州瀑布之旅' }).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), 'travel-all-records-desktop.png'), fullPage: true });
  await page.locator('.saved-city-card').filter({ hasText: '贵阳市' }).click();
  await page.getByRole('heading', { name: '贵阳市的城市记录' }).waitFor();
  await page.locator('.place-card').filter({ hasText: '城市日记' }).waitFor();
  await page.getByRole('button', { name: '查看全部旅行' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.sidebar').getByRole('button', { name: '旅行记录' }).click();
  await page.locator('.saved-city-card').first().waitFor();
  assert.equal(await page.locator('.saved-city-card').count(), 2);
  await page.locator('.journey-card').filter({ hasText: '贵州瀑布之旅' }).click();
  await page.getByRole('heading', { name: '贵州瀑布之旅' }).waitFor();
  assert.deepEqual(pageErrors, []);
  process.stdout.write('City-first photos, dated journey linking and backup recovery: OK\n');
} finally {
  await browser.close();
}
