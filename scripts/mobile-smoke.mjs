import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Exercise the narrowest supported phone and a typical phone in a real browser.
// The URL can point to either Vite's development server or a preview build.
const baseUrl = process.env.TRAVEL_TEST_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  for (const width of [320, 390, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.province-list button').first().waitFor();

    // Horizontal document scrolling makes controls disappear on phones.
    async function assertFits(label) {
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.ok(dimensions.content <= dimensions.viewport + 1, `${width}px ${label}: ${JSON.stringify(dimensions)}`);
    }

    await assertFits('map');
    await page.screenshot({ path: path.join(os.tmpdir(), `travel-map-${width}.png`), fullPage: true });
    await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
    const back = page.getByRole('button', { name: '返回全国' });
    await back.waitFor();
    const labelsVisible = await page.evaluate(() => window.__travelMapChart?.getOption().series[0].label.show);
    assert.equal(labelsVisible, width > 560, `${width}px map label density`);
    const controls = await page.locator('.map-control-group').boundingBox();
    const backBox = await back.boundingBox();
    assert.ok(backBox && controls && backBox.x + backBox.width <= controls.x,
      `${width}px map controls overlap the back button`);
    await page.screenshot({ path: path.join(os.tmpdir(), `travel-province-${width}.png`), fullPage: true });
    await back.click();

    if (width === 390) {
      // A phone user can mark a city in one tap, then open its memory journal on the second tap.
      await page.locator('.province-list button').filter({ hasText: '贵州' }).click();
      const anshun = page.locator('.city-list button').filter({ hasText: '安顺市' });
      await anshun.click();
      await page.getByText('安顺市已点亮为已去过').waitFor();
      await anshun.click();
      await page.getByRole('button', { name: '进入旅行手账', exact: true }).click();
      await page.getByRole('heading', { name: '安顺市 · 旅行手账' }).waitFor();
      const toast = await page.locator('.toast').boundingBox();
      const navigation = await page.locator('.sidebar').boundingBox();
      assert.ok(toast && navigation && toast.y + toast.height < navigation.y,
        'Mobile notice must stay above the bottom navigation');
      await page.getByPlaceholder('例如：黄果树瀑布').fill('黄果树瀑布');
      await page.getByRole('button', { name: '创建地点' }).click();
      await page.waitForFunction(() => document.querySelector('.upload-station select')?.selectedOptions[0]?.textContent === '黄果树瀑布');
      const pixel = Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        canvas.getContext('2d').fillStyle = '#b77a58';
        canvas.getContext('2d').fillRect(0, 0, 2, 2);
        return canvas.toDataURL('image/png').split(',')[1];
      }), 'base64');
      await page.locator('input[type="file"][accept^="image/*,video/*"]').setInputFiles({
        name: 'phone-memory.png', mimeType: 'image/png', buffer: pixel,
      });
      await page.getByText('已导入 1 个文件至 黄果树瀑布').waitFor().catch(async (error) => {
        process.stderr.write(`UPLOAD STATE: ${await page.locator('.upload-station').innerText()}\n`);
        process.stderr.write(`TOASTS: ${(await page.locator('.toast').allInnerTexts()).join(' | ')}\n`);
        throw error;
      });
      await page.locator('.place-card').filter({ hasText: '黄果树瀑布' }).click();
      await page.locator('.memory-thumb').first().waitFor();
      await page.screenshot({ path: path.join(os.tmpdir(), 'travel-memory-phone.png'), fullPage: false });
      await page.locator('.memory-thumb').first().click();
      const lightbox = page.getByRole('dialog', { name: '照片详情' });
      await lightbox.waitFor();
      await page.screenshot({ path: path.join(os.tmpdir(), 'travel-lightbox-phone.png'), fullPage: false });
      await lightbox.getByRole('button', { name: '关闭照片详情' }).click();
      await page.getByRole('button', { name: '关闭地点回忆' }).click();
      await page.getByRole('button', { name: '＋ 新建旅行' }).click();
      await page.getByLabel('旅行名称').fill('手机局域网旅行');
      await page.getByRole('button', { name: '保存旅行' }).click();
      await page.getByRole('heading', { name: '手机局域网旅行' }).waitFor();
      await page.getByRole('button', { name: /返回城市记录与旅行列表/ }).click();
      await page.getByRole('button', { name: '查看全部旅行' }).click();
      await page.locator('.saved-city-card').filter({ hasText: '安顺市' }).waitFor();
      await page.locator('.journey-card').filter({ hasText: '手机局域网旅行' }).waitFor();
      await assertFits('all journeys and cities');
      await page.screenshot({ path: path.join(os.tmpdir(), 'travel-all-records-phone.png'), fullPage: true });
    }

    for (const section of ['行程规划', '旅行手账', '旅途成就', '个人中心']) {
      await page.locator('.nav-item').filter({ hasText: section }).click();
      await page.locator('.content-page').waitFor();
      await assertFits(section);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), `travel-mobile-${width}.png`), fullPage: true });
    assert.deepEqual(errors, [], `${width}px runtime errors`);
    await context.close();
  }
  process.stdout.write('Phone and tablet layouts: OK\n');
} finally {
  await browser.close();
}
