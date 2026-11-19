import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

/** 独立上下文检查五套风格、明暗联动、持久化、跨页地图颜色及手机版布局。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width:1280, height:900 }, colorScheme:'light', serviceWorkers:'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const navigate = (name) => page.locator('.sidebar').getByRole('button', { name, exact:true }).click();
const bodyColor = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
try {
  await page.goto('http://localhost:5173/', { waitUntil:'networkidle' });
  await navigate('个人中心');
  const colors = new Set();
  const styles = [['white','简洁白'], ['warm','草木暖日'], ['peach','杏桃汽水'], ['coast','海边假日'], ['journal','复古手账']];
  for (const [id, label] of styles) {
    await page.getByRole('button', { name:new RegExp(label) }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), id);
    assert.equal(await page.evaluate(() => localStorage.getItem('travel-appearance')), id);
    await page.waitForTimeout(250);
    const lightColor = await bodyColor();
    if (id === 'white') {
      assert.equal(lightColor, 'rgb(255, 255, 255)', '简洁白必须是纯白背景');
      // 单独刷新，确保新选项包含在首帧恢复白名单里。
      await page.reload({ waitUntil:'networkidle' });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), 'white');
      await navigate('个人中心');
    }
    colors.add(lightColor);
    await page.getByRole('group', { name:'明暗模式', exact:true }).getByRole('button', { name:'深色', exact:true }).click();
    await page.waitForTimeout(250);
    assert.notEqual(await bodyColor(), lightColor);
    assert.match(await page.locator('.theme-switch').getAttribute('aria-label'), /深色/);
    await page.getByRole('group', { name:'明暗模式', exact:true }).getByRole('button', { name:'浅色', exact:true }).click();
    await page.waitForTimeout(250);
    await navigate('地图足迹');
    await page.waitForFunction(() => Boolean(window.__travelMapChart));
    const mapColors = await page.evaluate(() => ({ actual:window.__travelMapChart.getOption().series[0].itemStyle.areaColor, expected:getComputedStyle(document.documentElement).getPropertyValue('--map-area').trim() }));
    assert.equal(mapColors.actual, mapColors.expected);
    await navigate('个人中心');
  }
  assert.equal(colors.size, 5);
  await page.reload({ waitUntil:'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), 'journal');
  await navigate('个人中心');
  assert.equal(await page.getByRole('button', { name:/复古手账/ }).getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('.appearance-settings').scrollIntoViewIfNeeded();
  for (const [, label] of styles) {
    await page.getByRole('button', { name:new RegExp(label) }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.screenshot({ path:path.join(os.tmpdir(), 'appearance-settings-mobile.png'), fullPage:true });
  // 跟随系统在任意风格下仍能自动切换，顶栏修改也同步回个人中心。
  await page.getByRole('group', { name:'明暗模式', exact:true }).getByRole('button', { name:'跟随系统', exact:true }).click();
  await page.emulateMedia({ colorScheme:'dark' });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()), '#231f19');
  await page.locator('.theme-switch').click();
  assert.equal(await page.getByRole('group', { name:'明暗模式', exact:true }).getByRole('button', { name:'浅色', exact:true }).getAttribute('aria-pressed'), 'true');
  // 原数据结构不受外观偏好影响，没有产生旅行记录或账本。
  const snapshot = await page.evaluate(async () => (await import('/src/db.ts')).loadSnapshot());
  assert.equal(snapshot.trips.length, 0);
  assert.equal(snapshot.plans.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: 五套风格、纯白背景、即时切换、刷新保留、地图重绘、明暗同步及手机版布局');
} finally { await browser.close(); }
