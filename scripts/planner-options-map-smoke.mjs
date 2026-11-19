import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aiPlanFixture } from './planner-fixture.mjs';
import { collectPlannerMapPlaces } from '../src/planner-map.ts';
import { createPlannerService } from '../server/planner-service.mjs';

/** 真实前后端方案逻辑 + 模拟模型/地图数据，不花费外部服务额度。 */
const service = createPlannerService({ apiKey: 'test', fetchImpl: async (url, request) => {
  if (String(url).includes('/tools/search')) return Response.json({ results: [{ title: '参考', url: 'https://www.lijiang.gov.cn/', content: '交通参考' }] });
  if (String(url).includes('wikipedia')) return Response.json({ query: { pages: {} } });
  const prompt = JSON.parse(request.body).messages.at(-1).content;
  let result;
  if (prompt.includes('只回答与提出建议')) result = { answer: '方案 A 比较轻松。尚未修改。', suggestions: [] };
  else {
    const activity = structuredClone(aiPlanFixture().content.days[0].activities[0]);
    activity.kind = 'rest'; activity.title = '早上休息'; activity.costs = []; activity.location = '';
    result = { summary: '上午已改为休息', activities: [activity] };
  }
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
} });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let missingKey = false;
let mapRequests = 0;
const edits = [];
// 禁止浏览器回归批量请求公共瓦片；真实网络可用性单独检查一个瓦片即可。
await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efea"/><path d="M0 128H256M128 0V256" stroke="#c9d8ce"/></svg>' }));
await page.route('**/api/planner/**', async (route) => {
  const endpoint = route.request().url().split('/').at(-1);
  if (endpoint === 'health') return route.fulfill({ json: { configured: true } });
  const body = route.request().postDataJSON();
  let result;
  if (endpoint === 'map') {
    mapRequests++;
    result = { tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', notice: missingKey ? '尚未配置 AMAP_WEB_SERVICE_KEY，无法精确标注地点。' : '模拟定位数据', positions: body.places.map((place, index) => ({ key: place.key, status: missingKey ? 'unresolved' : 'located', ...(missingKey ? { reason: '位置待确认' } : { latitude: 26.87 + index * .01, longitude: 100.24 + index * .01, source: '测试地点检索' }) })) };
  } else if (endpoint === 'chat') {
    edits.push(body);
    result = await service.chat(body, new AbortController().signal, () => {});
  } else return route.fulfill({ json: { photo: null } });
  return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'result', result })}\n` });
});
const plan = aiPlanFixture();
plan.messages = [{ id: 'choices', role: 'assistant', text: '方案 A 休息，方案 B 慢游。s-ec06db8d-a00，ransport，lodging-6', createdAt: new Date().toISOString(), suggestions: [
  { id: 'a', label: 'A', title: '休息', instruction: '请把第一天上午改为休息。', scopeId: 'sight-1', baseContentVersion: 1 },
  { id: 'b', label: 'B', title: '慢游', instruction: '请把第一天上午缩短为轻松游览。', scopeId: 'sight-1', baseContentVersion: 1 },
] }];
const readPlan = () => page.evaluate(async () => (await (await import('/src/db.ts')).getAll('aiPlans'))[0]);
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async (value) => (await import('/src/db.ts')).saveAiPlan(value, null), plan);
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-ai-launcher').click();
  await page.getByRole('button', { name: '实施计划', exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: '实施计划', exact: true }).count(), 2);
  assert.ok(!/s-ec06|ransport|lodging-6/.test(await page.locator('.planner-chat-messages').innerText()));
  assert.equal(mapRequests, 0, 'collapsed map does not query');
  await page.getByRole('button', { name: '查看行程地图', exact: true }).click();
  await page.locator('.leaflet-interactive').first().waitFor();
  assert.equal(await page.locator('.leaflet-interactive').count(), collectPlannerMapPlaces(plan.content).length);
  await page.getByLabel('地图日期', { exact: true }).selectOption('2026-12-02');
  assert.equal(await page.locator('.leaflet-interactive').count(), 3);
  await page.locator('.leaflet-interactive').first().click({ force: true });
  await page.locator('.leaflet-popup-content').waitFor();
  assert.match(await page.locator('.leaflet-popup-content').innerText(), /2026-12-02/);
  const link = new URL(await page.locator('.leaflet-popup-content a').getAttribute('href'));
  assert.equal(link.hostname, 'uri.amap.com');
  assert.equal(link.searchParams.get('city'), '丽江市');
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  await page.locator('.planner-map-expanded').waitFor();
  await page.waitForFunction(() => document.querySelector('.leaflet-interactive').getBoundingClientRect().width < 26);
  await page.screenshot({ path: '.openai/planner-map-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  // 等待真实缩放动画结束后检查手机布局，避免把过渡帧当作最终排版。
  await page.waitForFunction(() => !document.querySelector('.leaflet-zoom-anim'));
  await page.waitForFunction(() => {
    const popup = document.querySelector('.leaflet-popup').getBoundingClientRect();
    const canvas = document.querySelector('.planner-map-canvas').getBoundingClientRect();
    return popup.left >= canvas.left && popup.right <= canvas.right;
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.openai/planner-map-mobile.png', fullPage: false });
  await page.getByRole('button', { name: '退出放大', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('地图日期', { exact: true }).selectOption('');
  await page.getByLabel('问题或修改要求').fill('A 怎么样');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('方案 A 比较轻松。尚未修改。', { exact: true }).waitFor();
  assert.deepEqual((await readPlan()).content, plan.content);
  const before = mapRequests;
  assert.equal(before, 1, 'follow-up does not repeat geocoding');
  await page.getByLabel('问题或修改要求').fill('选 A');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '已实施', exact: true }).waitFor();
  assert.equal(edits.at(-1).mode, 'apply-suggestion');
  assert.equal(edits.at(-1).applySuggestionId, 'a');
  assert.equal((await readPlan()).content.days[0].activities[0].kind, 'rest');
  await page.waitForFunction(() => !document.querySelector('.planner-map-places').textContent.includes('丽江古城'));
  assert.equal(mapRequests, before + 1, 'map recomputes when a place is removed');
  assert.equal(await page.getByRole('button', { name: '已实施', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '实施计划', exact: true }).isDisabled(), true, 'other option becomes stale');
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-ai-launcher').click();
  await page.getByRole('button', { name: '已实施', exact: true }).waitFor();
  missingKey = true;
  await page.getByRole('button', { name: '查看行程地图', exact: true }).click();
  await page.getByText('尚未配置 AMAP_WEB_SERVICE_KEY，无法精确标注地点。', { exact: true }).waitFor();
  assert.equal(await page.locator('.leaflet-interactive').count(), 0);
  assert.ok(await page.getByRole('link', { name: '在高德地图查看', exact: true }).count() > 0);

  // 另一组消息通过 B 的按钮实施，确保按钮绑定方案而不是总取第一条。
  const current = await readPlan();
  await page.evaluate(async ({ initial, version }) => {
    await (await import('/src/db.ts')).saveAiPlan({ ...initial, version: version + 1, contentVersion: 1 }, version);
  }, { initial: plan, version: current.version });
  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-chat-suggestion').filter({ hasText: '方案 B' }).getByRole('button', { name: '实施计划', exact: true }).click();
  await page.getByRole('button', { name: '已实施', exact: true }).waitFor();
  assert.equal(edits.at(-1).applySuggestionId, 'b');
  assert.ok((await readPlan()).messages[0].suggestions[1].appliedAt);

  // 多方案、独立实施状态通过真实 ZIP 导出/恢复原样保留。
  const saved = await readPlan();
  await page.getByRole('button', { name: '个人中心', exact: false }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const archive = await (await downloadPromise).path();
  await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    await db.deleteItem('aiPlans', (await db.getAll('aiPlans'))[0].id);
  });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(archive);
  await page.locator('.toast').filter({ hasText: '备份已导入' }).waitFor();
  assert.deepEqual(await readPlan(), saved);
  assert.deepEqual(errors, []);
  process.stdout.write('Planner options/map browser: filtering, A selection, status persistence, markers, dates, mobile, popup links and missing-key fallback: OK\n');
} finally { await browser.close(); }
