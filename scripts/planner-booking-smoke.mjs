import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { plannerFixture } from './planner-fixture.mjs';

// 用固定行程验证新建前录入、待填票提示、改签排程和刷新后的结果，不调用外部服务。
const content = plannerFixture();
content.request.skipBreakfast = false;
const day = content.days[1];
const sight = day.activities[0];
day.activities = [
  { ...sight, city: '丽江市', startTime: '13:30', endTime: '15:30', period: 'noon', costs: [] },
  { ...sight, id: 'estimated-train', kind: 'transport', title: '丽江 → 香格里拉', location: '丽江 → 香格里拉',
    transportMode: '高铁', startTime: '14:00', endTime: '16:00', period: 'afternoon', costs: [], sourceIds: [] },
  { ...sight, id: 'after-booking', city: '香格里拉', kind: 'food', meal: 'breakfast', title: '在独克宗古城吃早点',
    description: '清晨到店吃早餐。', startTime: '08:30', endTime: '09:00', period: 'morning', costs: [] },
];
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1280, height: 960 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/planner/**', async (route) => {
    const endpoint = route.request().url().split('/').at(-1);
    if (endpoint === 'generate') {
      const body = route.request().postDataJSON();
      assert.equal(body.bookings, undefined, 'pre-entered reservations are applied locally');
      return route.fulfill({ json: { content } });
    }
    if (endpoint === 'tickets') return route.fulfill({ json: { items: [], checkedAt: '', networkAvailable: false } });
    if (endpoint === 'health') return route.fulfill({ json: { configured: true } });
    return route.fulfill({ json: { photo: null } });
  });
  await page.goto('http://127.0.0.1:5173/');
  const openPlanner = () => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '行程规划' }).click();
  const dialog = page.getByRole('dialog', { name: '导入车次、酒店与订单' });
  const panel = page.getByLabel('车次、航班与酒店预订', { exact: true });
  await openPlanner();
  await page.getByLabel('目的地（可选）', { exact: true }).fill('丽江、香格里拉');
  await page.getByLabel('开始日期', { exact: true }).fill(content.request.startDate);
  await page.getByLabel('旅行天数', { exact: true }).fill('3');
  await page.getByRole('button', { name: '＋ 提前录入预订' }).click();
  await dialog.getByRole('button', { name: '酒店住宿', exact: true }).click();
  await dialog.getByLabel('具体酒店全名').fill('丽江测试酒店');
  await dialog.getByLabel('入住日期').fill(content.request.startDate);
  await dialog.getByLabel('酒店地址（可选）').fill('古城南门附近');
  await dialog.getByRole('button', { name: '加入新建行程' }).click();
  await page.getByText(`${content.request.startDate} · 丽江测试酒店`, { exact: true }).waitFor();
  await page.getByRole('button', { name: '联网生成旅行计划' }).click();
  await page.getByRole('heading', { name: '今晚住：丽江测试酒店' }).waitFor().catch(async (error) => {
    const headings = await page.locator('h2, .planner-lodging h3').allInnerTexts();
    throw new Error(`${error.message}\n行程错误：${await page.locator('.planner-error').allInnerTexts()}\n页面错误：${errors.join(', ')}\n标题：${headings.join(' | ')}`);
  });
  // 不论有已录入订单还是待补票段，预订面板都由用户点击展开。
  assert.equal(await panel.getAttribute('open'), null);
  await panel.locator('summary').click();
  const pendingLeg = panel.locator('.booking-saved-card').filter({ hasText: '预估 14:00—16:00' });
  await pendingLeg.getByRole('button', { name: '填写车票信息' }).click();
  await dialog.getByLabel('车次（如 G128 / D8712）').fill('D8712');
  await dialog.getByLabel('出发站 / 机场').fill('丽江站');
  await dialog.getByLabel('到达站 / 机场').fill('香格里拉站');
  await dialog.getByLabel('所属城市').fill('香格里拉');
  await dialog.getByLabel('出发 / 开始时间').fill('15:30');
  await dialog.getByLabel('到达 / 结束时间').fill('16:50');
  await dialog.getByRole('button', { name: '确认导入并回填' }).click();
  await dialog.waitFor({ state: 'hidden' }).catch(async (error) => {
    throw new Error(`${error.message}\n录入错误：${await dialog.locator('.planner-error').allInnerTexts()}`);
  });
  const ticket = page.locator('.planner-booking-ticket');
  assert.equal(await ticket.count(), 1, 'one ticket appears in the timeline');
  await ticket.getByText('15:30', { exact: true }).waitFor();
  await ticket.getByText('16:50', { exact: true }).waitFor();
  await ticket.getByText('接驳时间', { exact: true }).click();
  await ticket.getByText(/14:20 预计出发 · 15:00 到站/).waitFor();
  assert.equal(await page.getByRole('button', { name: /前往丽江站|并候车|出站接驳/ }).count(), 0, 'buffers have no activity cards');
  const meal = page.locator('.planner-activity').filter({ has: page.getByRole('button', { name: '在独克宗古城吃晚餐' }) });
  await meal.getByText('17:20—17:50', { exact: true }).waitFor();
  assert.doesNotMatch(await meal.innerText(), /早点|清晨|早餐/);
  // 核对票券在手机窄屏上仍完整显示车站和时间。
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await ticket.boundingBox();
  assert.ok(mobile && mobile.x >= 0 && mobile.x + mobile.width <= 390);
  await page.setViewportSize({ width: 1280, height: 960 });
  await panel.getByRole('button', { name: '编辑 D8712 丽江站 → 香格里拉站' }).click();
  await dialog.getByLabel('车次（如 G128 / D8712）').fill('D8720');
  await dialog.getByLabel('出发 / 开始时间').fill('17:00');
  await dialog.getByLabel('到达 / 结束时间').fill('18:30');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await ticket.getByText('17:00', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '编辑 丽江测试酒店' }).click();
  await dialog.getByLabel('具体酒店全名').fill('丽江改订酒店');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await page.getByRole('heading', { name: '今晚住：丽江改订酒店' }).waitFor();
  await ticket.getByText('17:00', { exact: true }).waitFor();
  await page.reload();
  await openPlanner();
  await ticket.getByText('17:00', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '今晚住：丽江改订酒店' }).waitFor();
  assert.equal(await panel.getAttribute('open'), null);
  await panel.locator('summary').click();
  assert.equal(await panel.getByRole('button', { name: '编辑 D8712 丽江站 → 香格里拉站' }).count(), 0);
  assert.equal(await panel.locator('.booking-saved-card').filter({ hasText: '预估 14:00—16:00' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Planner bookings: compact tickets, hidden buffers, matching meal labels, hotel edit and reload: OK');
} finally {
  await browser.close();
}
