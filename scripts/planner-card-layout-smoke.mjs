import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { aiPlanFixture } from './planner-fixture.mjs';

const appOrigin = process.env.TRAVEL_TEST_ORIGIN || 'http://127.0.0.1:5173';

/** 用竖版照片复现网格最小尺寸撑破照片区的问题；独立浏览器不改用户数据。 */
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
});
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const image = await sharp({ create: { width: 600, height: 1200, channels: 3, background: '#7a9b8a' } }).png().toBuffer();
  await page.route('**/layout-photo.png', (route) => route.fulfill({ contentType: 'image/png', body: image }));
  await page.route('**/api/planner/**', (route) => route.fulfill({ json: { configured: false, photo: null } }));
  await page.goto(appOrigin);
  const plan = aiPlanFixture();
  plan.content.days[0].activities[0].luggageNote = {
    text: '先核对景点寄存位置和收费，游览后取件。', searchQuery: '丽江古城 行李寄存',
  };
  plan.content.summary += ' 第一天慢走丽江古城，第二天逛束河古镇，第三天乘火车到香格里拉，在独克宗古城品尝藏式午餐。';
  // 四张不同地址的竖图覆盖常见照片卡片，不依赖任何外网图片。
  plan.content.days.flatMap((day) => day.activities).slice(0, 4).forEach((activity, index) => {
    activity.photo = { url: new URL(`/${index}/layout-photo.png`, appOrigin).href, sourceUrl: 'https://example.org/', attribution: 'Layout fixture' };
  });
  await page.evaluate(async (plan) => {
    const { saveItem } = await import('/src/db.ts');
    await saveItem('aiPlans', plan);
  }, plan);
  await page.reload();
  await page.locator('.sidebar button').filter({ hasText: '计划' }).click();
  await page.getByRole('tab', { name: '我的行程' }).click();
  const overview = page.getByRole('region', { name: '行程安排', exact: true });
  await overview.waitFor();
  // 标题和完整简介都留在上方卡片，安排区可以直接看时间轴和操作。
  assert.equal(await page.locator('.planner-plan-card').getByText(plan.content.title, { exact: true }).count(), 1);
  assert.equal(await overview.getByText(plan.content.title, { exact: true }).count(), 0);
  await page.locator('.planner-plan-card').getByText(plan.content.summary, { exact: true }).waitFor();
  assert.equal(await overview.getByText(plan.content.summary, { exact: true }).count(), 0);
  assert.equal(await overview.getByLabel('当前行程', { exact: true }).count(), 0);
  const luggageNote = page.locator('.planner-activity .planner-luggage-note');
  assert.match(await luggageNote.innerText(), /^· 先核对/);
  const searchLink = new URL(await luggageNote.getByRole('link', { name: '去小红书查寄存' }).getAttribute('href'));
  assert.equal(searchLink.searchParams.get('keyword'), '丽江古城 行李寄存');
  for (const width of [1772, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const card = page.locator('.planner-plan-card').first();
    await card.waitFor();
    await card.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    const layout = await card.evaluate((card) => {
      const photos = card.querySelector('.planner-card-photos').getBoundingClientRect();
      const days = card.querySelector('.planner-card-days').getBoundingClientRect();
      const side = card.querySelector('.planner-card-side').getBoundingClientRect();
      const summary = card.querySelector('.planner-card-summary');
      return {
        photoBottom: photos.bottom, daysTop: days.top, bottomSpace: side.bottom - days.bottom,
        summaryClipped: summary.scrollHeight > summary.clientHeight + 1,
        images: [...card.querySelectorAll('.planner-card-photos img')].map((image) => {
          const rect = image.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(layout.daysTop >= layout.photoBottom + 10, `${width}: photos and route must have a gap`);
    for (const image of layout.images) assert.ok(image.bottom <= layout.photoBottom + 1, `${width}: image must fit photo row`);
    assert.equal(layout.overflow, false, `${width}: no horizontal overflow`);
    assert.equal(layout.summaryClipped, false, `${width}: show the complete trip summary`);
    assert.ok(layout.bottomSpace <= 20, `${width}: routes must not leave a large empty area below`);
    if (process.env.TRAVEL_LAYOUT_SCREENSHOT && width === 1772) {
      await card.screenshot({ path: process.env.TRAVEL_LAYOUT_SCREENSHOT });
    }
  }
  console.log('Planner card: portrait photos stay within their row; routes remain below on desktop and mobile: OK');
} finally {
  await browser.close();
}
