import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

/** 主题切换：跟随系统 → 浅色 → 深色，刷新后保留；深色下背景、地图配色随之变化。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  const toggle = page.locator('.theme-switch');
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const luminance = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const mapArea = () => page.evaluate(() => window.__travelMapChart?.getOption().series[0].itemStyle.areaColor);

  await toggle.waitFor();
  assert.equal(await theme(), 'system');
  assert.ok(luminance(await bodyBg()) > 0.8, 'system light scheme renders light');
  const lightArea = await mapArea();

  await toggle.click();
  assert.equal(await theme(), 'light');
  await toggle.click();
  assert.equal(await theme(), 'dark');
  await page.waitForTimeout(400);
  assert.ok(luminance(await bodyBg()) < 0.15, 'dark theme darkens the page');
  assert.notEqual(await mapArea(), lightArea, 'map redraws with dark colors');
  assert.match(await toggle.getAttribute('aria-label'), /深色/);

  await page.reload();
  await toggle.waitFor();
  assert.equal(await theme(), 'dark', 'choice persists after reload');
  await toggle.click();
  assert.equal(await theme(), 'system');
  assert.equal(await page.evaluate(() => localStorage.getItem('travel-theme')), null);

  // 跟随系统时，系统切到深色也应生效。
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  assert.ok(luminance(await bodyBg()) < 0.15, 'system dark scheme is followed');

  // 手机宽度下按钮只显示图标，仍可见可点。
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('.theme-switch-icon').isVisible());
  assert.deepEqual(errors, []);
  console.log('Theme: system/light/dark cycle, persistence, system following, map redraw and phone icon: OK');
} finally {
  await browser.close();
}
