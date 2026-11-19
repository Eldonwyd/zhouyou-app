import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { aiPlanFixture } from './planner-fixture.mjs';

/** 设计检查用截图：各页面 × 浅色/深色 × 桌面/手机。图片接口全部模拟，不访问外站。
 * 用法：node scripts/ui-screenshots.mjs <输出目录> [标签]
 */
const out = process.argv[2] ?? 'ui-shots';
const tag = process.argv[3] ?? 'now';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const pages = [['map', '地图足迹'], ['plan', '行程规划'], ['detail', '旅行手账'], ['achievements', '旅途成就'], ['profile', '个人中心']];
try {
  for (const [scheme, viewport] of [['light', { width: 1440, height: 900 }], ['dark', { width: 1440, height: 900 }], ['light', { width: 390, height: 844 }], ['dark', { width: 390, height: 844 }]]) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ serviceWorkers: 'block', viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.route('**/api/planner/**', (route) => route.request().url().endsWith('/photo')
      ? route.fulfill({ json: { photo: null } }) : route.fulfill({ json: { configured: true } }));
    await page.goto('http://127.0.0.1:5173/');
    await page.evaluate(async (plan) => {
      const db = await import('/src/db.ts');
      if (!(await db.getAll('aiPlans')).length) await db.saveAiPlan(plan, null);
    }, aiPlanFixture());
    await page.reload();
    await page.waitForTimeout(1200);
    for (const [id, label] of pages) {
      const nav = page.getByRole('button', { name: label, exact: false }).first();
      if (await nav.isVisible().catch(() => false)) await nav.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/${tag}-${id}-${scheme}-${mobile ? 'phone' : 'desk'}.png`, fullPage: !mobile });
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log('screenshots saved to', out);
