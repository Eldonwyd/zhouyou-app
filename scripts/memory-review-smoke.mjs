import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** 独立浏览器数据验证旧记录兼容、连续保存、录音播放与刷新持久化。 */
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext();
await context.grantPermissions(['microphone']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const { saveItem } = await import('/src/db.ts');
    await saveItem('marks', { id: '110100', name: '北京市', provinceCode: '110000', visited: true, planned: false, updatedAt: new Date().toISOString() });
    await saveItem('places', { id: 'review-test', tripId: null, cityCode: '110100', name: '故宫', reviewText: '原有回忆', reviewAudioId: null, createdAt: new Date().toISOString() });
  });
  async function openPlace() {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.sidebar').getByRole('button', { name: '旅行手账' }).click();
    await page.locator('.saved-city-card').filter({ hasText: '北京市' }).click();
    await page.locator('.place-card').filter({ hasText: '故宫' }).click();
  }
  await openPlace();
  assert.equal(await page.locator('.saved-review').count(), 1);
  assert.equal(await page.locator('.memory-book textarea').inputValue(), '');
  for (const text of ['第一条新回忆', '第二条新回忆']) {
    await page.locator('.memory-book textarea').fill(text);
    await page.getByRole('button', { name: '保存文字', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.memory-book textarea')?.value === '');
  }
  assert.equal(await page.locator('.saved-review').count(), 3);
  await page.locator('.saved-review').nth(1).getByRole('button', { name: '编辑' }).click();
  await page.locator('.memory-book textarea').fill('修改后的第一条');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.memory-book textarea')?.value === '');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('.saved-review').nth(2).getByRole('button', { name: '删除' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.saved-review').length === 2);
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: '录制语音评语' }).click();
    await page.getByRole('button', { name: '停止录音' }).waitFor();
    // 录音期间保存文字，检验语音落盘不会覆盖新文字。
    if (index === 0) {
      await page.locator('.memory-book textarea').fill('录音期间的回忆');
      await page.getByRole('button', { name: '保存文字', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.memory-book textarea')?.value === '');
    }
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '停止录音' }).click();
    await page.getByRole('button', { name: '录制语音评语' }).waitFor();
    await page.waitForFunction((count) => document.querySelectorAll('.memory-book audio').length === count, index + 1);
  }
  async function verifyPlayback() {
    for (const audio of await page.locator('.memory-book audio').all()) {
      await audio.evaluate(async (element) => { await element.play(); });
      // 音频设备开始输出有延迟，等待真实播放进度，避免固定短暂停顿误判。
      await page.waitForFunction((source) => [...document.querySelectorAll('audio')].some((element) => element.src === source && element.currentTime > 0), await audio.getAttribute('src'));
      assert.equal(await audio.evaluate((element) => element.error), null);
      assert.ok(await audio.evaluate((element) => element.currentTime > 0));
      await audio.evaluate((element) => element.pause());
    }
  }
  await verifyPlayback();
  await openPlace();
  assert.equal(await page.locator('.saved-review').count(), 3);
  assert.match(await page.locator('.saved-reviews').innerText(), /原有回忆/);
  assert.match(await page.locator('.saved-reviews').innerText(), /修改后的第一条/);
  assert.doesNotMatch(await page.locator('.saved-reviews').innerText(), /第二条新回忆/);
  await page.waitForFunction(() => document.querySelectorAll('.memory-book audio').length === 2);
  await verifyPlayback();
  assert.deepEqual(errors, []);
  console.log('PASS: 旧文字保留、追加、编辑、录音期间保存、多段录音播放及刷新持久化');
} finally {
  await context.close();
  await browser.close();
}
