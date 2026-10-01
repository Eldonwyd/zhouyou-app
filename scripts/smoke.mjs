import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

/** Real-browser coverage for two cities, 150 photos, voice and ZIP recovery. */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.grantPermissions(['microphone']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
  await page.getByRole('button', { name: '返回全国' }).click();
  await page.locator('.province-list button').filter({ hasText: '山西' }).click();
  await page.getByRole('button', { name: '返回全国' }).click();
  await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
  await page.locator('.city-list button').filter({ hasText: '安顺市' }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('heading', { name: '安顺市 · 旅行手账' }).waitFor();

  await page.getByRole('button', { name: '＋ 新建旅行' }).click();
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('旅行名称').fill('贵州的夏天');
  await page.getByLabel('开始日期').fill(today);
  await page.getByLabel('结束日期').fill(today);
  await page.getByLabel('同行者（可选）').fill('阿青');
  await page.getByLabel('黔南布依族苗族自治州').check();
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('heading', { name: '贵州的夏天' }).waitFor();

  const pixel = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    canvas.getContext('2d').fillStyle = '#b77a58';
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const uploadInput = page.locator('input[type="file"][accept^="image/*,video/*"]');
  await page.getByPlaceholder('例如：黄果树瀑布').fill('黄果树瀑布');
  await page.getByRole('button', { name: '创建地点' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.upload-station select')[1]?.selectedOptions[0]?.textContent === '黄果树瀑布');
  await uploadInput.setInputFiles(Array.from({ length: 100 }, (_, index) => ({ name: `huangguoshu-${index}.png`, mimeType: 'image/png', buffer: pixel })));
  await page.getByText('已导入 100 个文件至 黄果树瀑布').waitFor({ timeout: 120000 });

  await page.locator('.upload-station select').first().selectOption({ label: '黔南布依族苗族自治州' });
  await page.getByPlaceholder('例如：黄果树瀑布').fill('荔波小七孔');
  await page.getByRole('button', { name: '创建地点' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.upload-station select')[1]?.selectedOptions[0]?.textContent === '荔波小七孔');
  await uploadInput.setInputFiles(Array.from({ length: 50 }, (_, index) => ({ name: `libo-${index}.png`, mimeType: 'image/png', buffer: pixel })));
  await page.getByText('已导入 50 个文件至 荔波小七孔').waitFor({ timeout: 30000 }).catch(async (error) => {
    process.stderr.write(`UPLOAD STATE: ${await page.locator('.upload-station').innerText()}\n`);
    process.stderr.write(`TOASTS: ${(await page.locator('.toast').allInnerTexts()).join(' | ')}\n`);
    throw error;
  });
  // A missing EXIF date falls back to File.lastModified; an out-of-range file
  // must be confirmed and can be skipped without losing the successful batch.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await uploadInput.evaluate((input, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'outside.png', { type: 'image/png', lastModified: Date.parse('2020-01-01') }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [...pixel]);
  await page.getByText('outside.png：日期不在旅行范围，已跳过').waitFor();

  // Force a quota exception at the write boundary and check the user-facing
  // failure list. The original browser method is restored before retry.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (mode === 'readwrite' && Array.isArray(names) && names.includes('mediaFiles')) {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, names, mode, options);
    };
  });
  await uploadInput.setInputFiles({ name: 'quota.png', mimeType: 'image/png', buffer: pixel });
  await page.getByText(/quota.png：保存失败（设备或浏览器存储空间不足/).waitFor();
  await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).click();
  const memory = page.locator('.memory-book');
  await memory.getByPlaceholder('当时的天气、同行的人、最想记住的瞬间…').fill('瀑布的水雾像夏天的信。');
  await memory.getByRole('button', { name: '保存文字' }).click();
  await memory.getByRole('button', { name: '录制语音评语' }).click();
  await memory.getByRole('button', { name: '停止录音' }).waitFor();
  await page.waitForTimeout(250);
  await memory.getByRole('button', { name: '停止录音' }).click();
  await memory.locator('audio').first().waitFor();
  assert.equal(await memory.locator('.memory-thumb').count(), 24);
  await memory.getByRole('button', { name: '再看一些照片' }).click();
  assert.equal(await memory.locator('.memory-thumb').count(), 48);
  await page.screenshot({ path: path.join(os.tmpdir(), 'travel-memory-book.png'), fullPage: false });
  await memory.locator('.memory-thumb').first().click();
  await page.getByRole('dialog', { name: '照片详情' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('dialog', { name: '照片详情' }).locator('select').selectOption({ label: '荔波小七孔' });
  await page.waitForFunction(() => document.querySelector('.memory-title p')?.textContent?.includes('99 个片段'));
  // Moving a photo closes the lightbox and preserves the original binary.
  await memory.getByRole('button', { name: '关闭地点回忆' }).click();
  await page.screenshot({ path: path.join(os.tmpdir(), 'travel-journal-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: '＋ 新建旅行' }).click();
  await page.getByLabel('旅行名称').fill('同一天的另一段路');
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('button', { name: '旅途成就' }).click();
  assert.match(await page.locator('.metric-card').nth(1).innerText(), /1/);
  await page.getByRole('button', { name: '个人中心' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const download = await downloadPromise;
  const archive = await download.path();
  assert.ok(archive);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(archive);
  await page.getByText('备份已导入，旅行记录和媒体已恢复。').waitFor({ timeout: 120000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '旅行记录' }).click();
  await page.getByRole('heading', { name: '贵州的夏天' }).waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write('Desktop journey, two places, 150 photos, voice, backup: OK\n');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await mobilePage.locator('.province-list button').filter({ hasText: '北京' }).click();
  await mobilePage.getByRole('button', { name: '返回全国' }).click();
  await mobilePage.locator('.province-list button').filter({ hasText: '贵州' }).click();
  await mobilePage.getByRole('button', { name: '返回全国' }).waitFor();
  await mobilePage.screenshot({ path: path.join(os.tmpdir(), 'travel-journal-mobile.png'), fullPage: true });
  process.stdout.write('Mobile map return: OK\n');
  await mobile.close();
} finally {
  await browser.close();
}
