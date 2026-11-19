import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aiPlanFixture } from './planner-fixture.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 独立浏览器验证未发布行程可选、查看不写库、保存关联及多行程账本隔离。 */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage({ serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/planner/**', async (route) => {
  const endpoint = route.request().url().split('/').at(-1);
  if (endpoint === 'tickets') return route.fulfill({ status: 503, json: { error: '测试不查询预约资料' } });
  return route.fulfill({ json: endpoint === 'health' ? { configured: false } : { photo: null } });
});
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  const first = aiPlanFixture();
  const second = structuredClone(first);
  second.id = 'second-plan';
  second.content.title = '第二次云南行程';
  await page.evaluate(async (plans) => {
    const { saveItem } = await import('/src/db.ts');
    for (const plan of plans) await saveItem('aiPlans', plan);
  }, [first, second]);
  await page.reload({ waitUntil: 'networkidle' });
  // 通过导航文字进入，避免依赖导航内部实现。
  await page.locator('.sidebar button').filter({ hasText: '计划' }).click();
  await page.getByLabel('当前行程', { exact: true }).selectOption(second.id);

  // 用设备时区的时间验证分钟边界、跨日和地点节点跳转，保留真实日历导出回归测试。
  const timeline = page.getByRole('region', { name: '旅程时间轴' });
  const toolbar = page.getByRole('group', { name: '行程操作' });
  await timeline.waitFor();
  assert.equal(await toolbar.getByRole('button').first().innerText(), '预算与账本');
  assert.ok((await timeline.boundingBox()).y < (await toolbar.boundingBox()).y);
  await page.clock.install({ time: new Date('2026-11-30T23:59:50+08:00') });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await timeline.getByRole('heading', { name: '明天出发' }).waitFor();
  await page.clock.fastForward(10_000);
  await timeline.getByText('下一站 · 09:00 丽江古城', { exact: true }).waitFor();
  assert.equal(await timeline.locator('[aria-current="date"]').getAttribute('href'), '#planner-day-2026-12-01');

  await page.clock.setSystemTime(new Date('2026-12-02T10:00:00+08:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await timeline.getByRole('heading', { name: '第 2 天 · 早上' }).waitFor();
  await timeline.getByText('当前安排 · 09:00–11:00 束河古镇', { exact: true }).waitFor();
  await timeline.locator('[aria-current="date"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'planner-day-2026-12-02');
  await page.clock.fastForward(3_600_000);
  await timeline.getByText('下一站 · 12:00 午餐', { exact: true }).waitFor();
  await page.clock.setSystemTime(new Date('2026-12-04T00:00:00+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await timeline.getByRole('heading', { name: '旅程已结束' }).waitFor();
  assert.equal(await timeline.locator('[aria-current="date"]').count(), 0);
  await page.clock.setSystemTime(new Date());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  const textDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出文字行程', exact: true }).click();
  const itineraryStream = await (await textDownload).createReadStream();
  let itineraryText = '';
  for await (const chunk of itineraryStream) itineraryText += chunk.toString('utf8');
  assert.ok(itineraryText.includes(second.content.title));
  assert.ok(itineraryText.includes('住宿搜索'));
  assert.ok(itineraryText.includes('预算'));
  assert.ok(!itineraryText.includes('https://'));
  for (const source of second.content.sources) assert.ok(!itineraryText.includes(source.title));
  // 日历位于当前行程操作区，未建立账本也可导出，并保留提醒偏好。
  await page.locator('.planner-calendar-export').getByLabel('提前提醒').selectOption('3');
  assert.equal(await page.locator('.planner-calendar-export time').getAttribute('datetime'), '2026-11-28');
  const calendarDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出到系统日历', exact: true }).click();
  const calendar = await calendarDownload;
  const stream = await calendar.createReadStream();
  let calendarText = '';
  for await (const chunk of stream) calendarText += chunk.toString('utf8');
  assert.match(calendarText, /DTSTART;VALUE=DATE:20261201/);
  assert.match(calendarText, /DTEND;VALUE=DATE:20261204/);
  assert.match(calendarText, /TRIGGER:-P3D/);
  assert.match(calendarText, /第二次云南行程/);
  await page.locator('.planner-overview').getByRole('button', { name: '预算与账本', exact: true }).click();
  assert.equal(await page.getByLabel('账本对应行程').inputValue(), `ai:${second.id}`);
  const snapshot = () => page.evaluate(async () => (await import('/src/db.ts')).loadSnapshot());
  assert.equal((await snapshot()).trips.length, 0);
  assert.equal((await snapshot()).aiPlans.find((plan) => plan.id === second.id).reminderDays, 3);
  assert.equal(await page.getByRole('button', { name: '导出到系统日历', exact: true }).count(), 0);
  // 预测金额按人群票价、三人餐费与两间房计价，未知项目预填 0。
  await page.getByRole('button', { name: '每日账单', exact: true }).click();
  const initialFields = page.locator('.daily-ledger .amount-section');
  assert.equal(await initialFields.getByLabel('午餐', { exact: true }).inputValue(), '120');
  assert.equal(await initialFields.getByLabel('门票', { exact: true }).inputValue(), '250');
  assert.equal(await initialFields.getByLabel('住宿', { exact: true }).inputValue(), '400');
  assert.equal(await initialFields.getByLabel('其他', { exact: true }).inputValue(), '0');
  assert.equal(await initialFields.getByLabel('早餐', { exact: true }).inputValue(), '0');
  assert.match(await page.getByTestId('trip-total').innerText(), /1,710\.00/);
  /** 清空预测后不应被重填，后续继续验证纯手工账单的独立保存。 */
  async function clearForecast() {
    await page.getByRole('button', { name: '每日账单', exact: true }).click();
    for (const date of ['2026-12-01', '2026-12-02', '2026-12-03']) {
      await page.getByLabel('账单日期', { exact: true }).selectOption(date);
      for (const label of ['早餐', '午餐', '晚餐', '交通', '门票', '其他', '住宿']) {
        await page.locator('.daily-ledger .amount-section').getByLabel(label, { exact: true }).fill('');
      }
    }
    await page.getByRole('button', { name: '完整账单', exact: true }).click();
  }
  await clearForecast();
  const actualFood = page.locator('.amount-section').filter({ hasText: '整程补充花费' }).getByLabel('午餐');
  await actualFood.fill('123');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.waitForFunction(async () => {
    const data = await (await import('/src/db.ts')).loadSnapshot();
    return data.plans.some((plan) => plan.actual.food === 123);
  });
  let saved = await snapshot();
  const linkedSecond = saved.aiPlans.find((plan) => plan.id === second.id);
  assert.ok(linkedSecond.linkedTripId);
  assert.equal(saved.plans.find((plan) => plan.tripId === linkedSecond.linkedTripId).actual.food, 123);
  await page.getByLabel('账本对应行程').selectOption(`ai:${first.id}`);
  await clearForecast();
  assert.equal(await actualFood.inputValue(), '');
  await actualFood.fill('456');
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.waitForFunction(async () => (await import('/src/db.ts')).loadSnapshot().then((data) => data.trips.length === 2));
  await page.getByLabel('账本对应行程').selectOption(`journey:${linkedSecond.linkedTripId}`);
  assert.equal(await actualFood.inputValue(), '123');
  await page.reload({ waitUntil: 'networkidle' });
  saved = await snapshot();
  assert.equal(saved.trips.length, 2);
  assert.deepEqual(saved.plans.map((plan) => plan.actual.food).sort(), [123, 456]);
  // 日账按七分类编辑，三餐拆开计算；空项保持空白，旧整程金额只计一次。
  await page.locator('.sidebar button').filter({ hasText: '计划' }).click();
  await page.getByRole('tab', { name: '预算与账本', exact: true }).click();
  await page.getByLabel('账本对应行程').selectOption(`journey:${linkedSecond.linkedTripId}`);
  await page.getByRole('button', { name: '每日账单', exact: true }).click();
  await page.getByLabel('账单日期', { exact: true }).selectOption('2026-12-01');
  const dailyFields = page.locator('.daily-ledger .amount-section');
  const amounts = { 早餐: '0.1', 午餐: '0.2', 晚餐: '20', 交通: '10', 门票: '30', 其他: '5', 住宿: '100' };
  for (const [label, amount] of Object.entries(amounts)) await dailyFields.getByLabel(label, { exact: true }).fill(amount);
  assert.match(await page.getByTestId('daily-total').innerText(), /165\.30/);
  assert.match(await page.getByTestId('trip-total').innerText(), /288\.30/);
  await page.getByLabel('账单日期', { exact: true }).selectOption('2026-12-02');
  assert.equal(await dailyFields.getByLabel('早餐', { exact: true }).inputValue(), '');
  await dailyFields.getByLabel('午餐', { exact: true }).fill('50');
  assert.match(await page.getByTestId('trip-total').innerText(), /338\.30/);
  await dailyFields.getByLabel('午餐', { exact: true }).fill('');
  assert.match(await page.getByTestId('daily-total').innerText(), /0\.00/);
  assert.match(await page.getByTestId('trip-total').innerText(), /288\.30/);
  await page.getByRole('button', { name: '完整账单', exact: true }).click();
  assert.equal(await page.locator('.ledger-table tbody tr').count(), 3);
  assert.match(await page.locator('.ledger-table tbody tr').first().innerText(), /165\.30/);
  // 实测布局：符号所在列与输入框不相交，手机页面仅表格内部可横向滚动。
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator('.money-input').evaluateAll((fields) => fields.every((field) => {
      const symbol = field.querySelector('span').getBoundingClientRect();
      const input = field.querySelector('input').getBoundingClientRect();
      return symbol.right <= input.left && input.right <= field.getBoundingClientRect().right + 1;
    })));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: path.join(tmpdir(), `travel-ledger-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '保存计划', exact: true }).click();
  await page.waitForFunction(async (tripId) => {
    const data = await (await import('/src/db.ts')).loadSnapshot();
    return data.plans.find((plan) => plan.tripId === tripId)?.dailyExpenses?.['2026-12-01']?.lodging === 100;
  }, linkedSecond.linkedTripId);
  await page.reload({ waitUntil: 'networkidle' });
  saved = await snapshot();
  const dailySheet = saved.plans.find((plan) => plan.tripId === linkedSecond.linkedTripId);
  assert.equal(dailySheet.aiExpenseSeeded, true);
  assert.equal(dailySheet.dailyExpenses['2026-12-01'].breakfast, 0.1);
  assert.equal(dailySheet.dailyExpenses['2026-12-02'], undefined);
  assert.equal(dailySheet.actual.food, 143.3);
  assert.equal(Math.round(Object.values(dailySheet.actual).reduce((sum, amount) => sum + amount, 0) * 100), 28830);
  // 未分三餐的老餐饮保留原值，新增日账只能加上新增金额，不能重复合计。
  const migrated = await page.evaluate(async (sheet) => {
    const { updateExpenses } = await import('/src/finance.ts');
    const legacy = { ...sheet, dailyExpenses: undefined, overallExpenses: undefined, unallocatedFood: undefined,
      actual: { food: 88, transport: 10, lodging: 0, tickets: 0, other: 0 } };
    return updateExpenses(legacy, { dailyExpenses: { '2026-12-01': { breakfast: 2 } } });
  }, dailySheet);
  assert.equal(migrated.actual.food, 90);
  assert.equal(migrated.actual.transport, 10);
  assert.equal(migrated.unallocatedFood, 88);
  const seedProtection = await page.evaluate(async ({ sheet, content }) => {
    const { seedAiExpenses } = await import('/src/finance.ts');
    // 全部改为零的账本也必须保持用户选择，不能仅凭总数为零判断是否未填写。
    const zeroed = { ...sheet, actual: { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 },
      dailyExpenses: {}, overallExpenses: {}, unallocatedFood: 0, aiExpenseSeeded: true };
    const old = { ...zeroed, aiExpenseSeeded: undefined, actual: { ...zeroed.actual, food: 88 } };
    return { zeroed: seedAiExpenses(zeroed, content), old: seedAiExpenses(old, content) };
  }, { sheet: dailySheet, content: first.content });
  assert.deepEqual(seedProtection.zeroed.dailyExpenses, {});
  assert.equal(seedProtection.old.actual.food, 88);
  assert.deepEqual(errors, []);
  console.log('PASS: AI按日期分类预填、人数票价房间计价、未知填零、编辑清空不覆盖、账本保存及汇总');
} catch (error) {
  console.log(await page.evaluate(async () => { const data = await (await import('/src/db.ts')).loadSnapshot(); return { ai: data.aiPlans.map((plan) => ({ id: plan.id, linked: plan.linkedTripId })), plans: data.plans }; }));
  console.log((await page.locator('body').innerText()).slice(-4500));
  throw error;
} finally { await browser.close(); }
