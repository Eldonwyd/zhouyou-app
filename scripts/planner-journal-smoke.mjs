import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aiPlanFixture } from './planner-fixture.mjs';

/** 用独立浏览器验证计划确认到访、手账地点及照片存储。 */
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await page.route('**/api/planner/**', (route) => route.fulfill({ status: 503, json: { error: '测试使用本地行程' } }));
  const plan = aiPlanFixture();
  plan.content.cities[0] = { code: '530100', name: '昆明市', provinceCode: '530000' };
  const [first, second] = plan.content.days.map((day) => day.activities[0]);
  Object.assign(first, { title: '翠湖公园观鸥', city: '云南省昆明市五华区', location: '五华区翠湖公园' });
  Object.assign(second, { title: '再游翠湖公园', city: '昆明', location: '翠湖公园' });
  const otherCitySight = plan.content.days[2].activities.find((activity) => activity.kind === 'sight');
  assert.ok(otherCitySight);

  await page.goto(process.env.TRAVEL_TEST_ORIGIN || 'http://127.0.0.1:5173');
  await page.evaluate(async (fixture) => (await import('/src/db.ts')).saveAiPlan(fixture, null), plan);
  await page.reload({ waitUntil: 'networkidle' });
  const plannerNav = page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '行程规划', exact: true });
  await plannerNav.click();
  const snapshot = () => page.evaluate(async () => (await import('/src/db.ts')).loadSnapshot());
  const sightCard = (title) => page.locator('.planner-activity').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const firstCard = sightCard(first.title);
  assert.equal((await snapshot()).places.length, 0);
  await firstCard.getByRole('button', { name: '标记已游玩' }).click();
  await firstCard.getByRole('button', { name: '打开地点手账' }).waitFor();
  let data = await snapshot();
  assert.equal(data.trips.length, 1);
  assert.equal(data.places.length, 1);
  assert.equal(data.places[0].name, '翠湖公园');
  assert.equal(data.places[0].cityCode, '530100');
  assert.equal(data.places[0].tripId, data.trips[0].id);
  assert.equal(data.aiPlans[0].contentVersion, plan.contentVersion ?? plan.version);
  const placeId = data.places[0].id;

  await firstCard.getByRole('button', { name: '打开地点手账' }).click();
  const memory = page.getByRole('dialog', { name: '翠湖公园的回忆' });
  await memory.getByRole('button', { name: '上传照片 / 视频到这里' }).waitFor();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  page.on('dialog', (dialog) => void dialog.accept());
  await memory.locator('input[type=file]').setInputFiles({ name: '翠湖留影.png', mimeType: 'image/png', buffer: png });
  await memory.getByText('昆明市 · 1 个片段', { exact: true }).waitFor();
  data = await snapshot();
  assert.equal(data.media[0].placeId, placeId);
  assert.equal(data.media[0].tripId, data.trips[0].id);
  assert.equal(data.media[0].cityCode, '530100');
  await memory.getByRole('button', { name: '关闭地点回忆' }).click();
  await page.getByRole('heading', { name: '昆明市 · 地点记忆', exact: true }).waitFor();
  await page.getByLabel('已有地点（可选）').selectOption(placeId);
  await page.getByRole('button', { name: '上传照片 / 视频到「翠湖公园」', exact: true }).waitFor();

  // 已存在的同名地点继续使用同一相册，用户编辑过的手账标题和实际花费一并保留。
  await page.evaluate(async () => {
    const { loadSnapshot, saveItem } = await import('/src/db.ts');
    const { trips, plans } = await loadSnapshot();
    await saveItem('trips', { ...trips[0], title: '我的昆明手账' });
    await saveItem('plans', { ...plans[0], actual: { ...plans[0].actual, food: 32 } });
  });
  await plannerNav.click();
  const secondCard = sightCard(second.title);
  await secondCard.getByRole('button', { name: '标记已游玩' }).click();
  await secondCard.getByRole('button', { name: '打开地点手账' }).waitFor();
  data = await snapshot();
  assert.equal(data.places.length, 1);
  assert.equal(data.aiPlans[0].journalVisits[second.id].placeId, placeId);
  assert.equal(data.trips[0].title, '我的昆明手账');
  assert.equal(data.plans[0].actual.food, 32);
  const duplicateIds = await page.evaluate(async ({ planId, activity }) => {
    const { recordPlannerJournalVisit } = await import('/src/db.ts');
    const { plannerJournalActivityKey } = await import('/src/planner-journal.ts');
    const save = () => recordPlannerJournalVisit(planId, activity.id, plannerJournalActivityKey(activity));
    return (await Promise.all([save(), save()])).map(({ place }) => place.id);
  }, { planId: plan.id, activity: second });
  assert.deepEqual(duplicateIds, [placeId, placeId]);

  // 区县名称无法直接匹配主城市时，请用户确认所属城市。
  const otherCard = sightCard(otherCitySight.title);
  await otherCard.getByRole('button', { name: '标记已游玩' }).click();
  await otherCard.getByLabel('景点所属城市').selectOption('533400');
  await otherCard.getByRole('button', { name: '确认并加入手账' }).click();
  await otherCard.getByRole('button', { name: '打开地点手账' }).waitFor();
  assert.equal((await snapshot()).places.find((place) => place.id !== placeId).cityCode, '533400');

  // 手动同步新的计划城市，已记录的地点和照片仍可从旅行原来的城市下访问。
  await page.evaluate(async () => {
    const { loadSnapshot, saveItem, saveAiPlan, publishAiPlan } = await import('/src/db.ts');
    const { trips, aiPlans } = await loadSnapshot();
    const savedPlan = aiPlans[0];
    await saveItem('trips', { ...trips[0], title: savedPlan.linkedSnapshot.title });
    const nextPlan = { ...savedPlan, version: savedPlan.version + 1,
      content: { ...savedPlan.content, cities: savedPlan.content.cities.filter((city) => city.code !== '533400') } };
    await saveAiPlan(nextPlan, savedPlan.version);
    await publishAiPlan(nextPlan);
  });
  data = await snapshot();
  assert.ok(data.trips[0].cities.some((city) => city.code === '533400'));
  assert.equal(data.places.length, 2);
  assert.equal(data.media[0].placeId, placeId);
  await page.reload({ waitUntil: 'networkidle' });
  await plannerNav.click();
  await firstCard.getByRole('button', { name: '打开地点手账' }).waitFor();
  console.log('Planner journal: completed sights create the correct place, photos upload there, and repeated visits reuse it after reload.');
} finally {
  await browser.close();
}
