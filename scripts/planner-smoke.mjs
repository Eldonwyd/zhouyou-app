import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { plannerFixture } from './planner-fixture.mjs';

/** Browser coverage uses deterministic HTTP fixtures; live model verification
 * is a separate opt-in script so routine regressions do not consume API credit.
 */
await mkdir('.openai', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const context = await browser.newContext({
  serviceWorkers: 'block',
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let generationCalls = 0;
let durationCalls = 0;
const submittedRequests = [];
let blockGenerate = false;
const firstXhsUrl = 'https://xhslink.cn/o/TestFirst';
const secondXhsUrl = 'http://xhslink.com/a/TestSecond';
const xhsReads = [];
const reply = async (route, result) =>
  route.fulfill({
    contentType: 'application/x-ndjson',
    body:
      [
        { type: 'progress', stage: '正在验证测试行程' },
        { type: 'result', result },
      ]
        .map(JSON.stringify)
        .join('\n') + '\n',
  });
await page.route('**/api/planner/**', async (route) => {
  const endpoint = route.request().url().split('/').at(-1);
  if (endpoint === 'health') return route.fulfill({ json: { configured: true } });
  const body = route.request().postDataJSON();
  if (['generate', 'duration', 'recommendations'].includes(endpoint))
    submittedRequests.push({ endpoint, request: body.request });
  if (endpoint === 'xhs-parse') {
    const url = body.text;
    const isFirst = url === firstXhsUrl;
    const wasRead = xhsReads.includes(url);
    xhsReads.push(url);
    if (!isFirst && !wasRead) return route.fulfill({ status: 502, json: { error: '测试笔记暂时不可读' } });
    return reply(route, { reference: {
      id: isFirst ? 'xhs-first' : 'xhs-second', sourceType: 'xhs_link', url,
      title: isFirst ? '丽江慢游攻略' : '香格里拉路线推荐',
      destinations: [isFirst ? '丽江' : '香格里拉'], suggestedDays: isFirst ? 2 : 5,
      styleTags: [], routeOutline: ['古城慢走'], tips: [], places: [],
    } });
  }
  if (endpoint === 'duration') {
    durationCalls++;
    return reply(route, {
      options: [{ days: 3, title: '均衡游', reason: '丽江两天，香格里拉一天' }],
    });
  }
  if (endpoint === 'generate') {
    generationCalls++;
    if (blockGenerate)
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body: JSON.stringify({ type: 'error', error: '测试网络超时，原计划已保留' }) + '\n',
      });
    const content = plannerFixture();
    content.request.luggageMode = body.request.luggageMode;
    return reply(route, { content });
  }
  if (endpoint === 'chat') {
    if (body.message.includes('为什么'))
      return reply(route, {
        action: 'answer',
        answer: '预留了候车和接驳时间。',
        baseVersion: body.baseVersion,
      });
    if (body.message.includes('天气怎样'))
      return reply(route, {
        action: 'answer',
        answer: '天气需要临近出行再核查。',
        baseVersion: body.baseVersion,
      });
    if (body.mode !== 'apply-suggestion' && /如果|可不可以|能不能/.test(body.message))
      return reply(route, {
        action: 'answer',
        answer: '可以先休息，游览时间会减少。目前没有修改行程。',
        baseVersion: body.baseVersion,
        suggestion: {
          title: '将第一天早上改为休息',
          instruction: '请把第一天早上的活动改成休息，保留时间，其余不变。',
          scopeId: body.scopeId || null,
          baseContentVersion: body.plan.contentVersion ?? body.plan.version,
        },
      });
    const content = structuredClone(body.plan.content);
    if (body.overrideRequest) {
      content.request = body.overrideRequest;
      const start = new Date(`${content.request.startDate}T12:00:00Z`);
      content.days.forEach((day, index) => {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + index);
        day.date = date.toISOString().slice(0, 10);
      });
    } else {
      const activity =
        content.days.flatMap((day) => day.activities).find((item) => item.id === body.scopeId) ??
        content.days[0].activities[0];
      if (activity.locked)
        return route.fulfill({
          contentType: 'application/x-ndjson',
          body: JSON.stringify({ type: 'error', error: '目标活动已锁定，请先解锁' }) + '\n',
        });
      activity.title = '早上休息';
      activity.kind = 'rest';
      activity.costs = [];
    }
    return reply(route, {
      action: 'revision',
      content,
      summary: '已按明确要求修改',
      baseVersion: body.baseVersion,
    });
  }
  if (endpoint === 'recommendations')
    return reply(route, {
      recommendations: [
        {
          title: '丽江古城',
          destination: '丽江',
          reason: '适合慢游',
          season: '当季',
          suggestedDays: '3日',
          access: '铁路可达',
          photo: null,
          sourceIds: [],
        },
      ],
      sources: [],
    });
  if (endpoint === 'photo') return route.fulfill({ json: { photo: null } });
  return route.abort();
});
const readPlans = () => page.evaluate(async () => (await import('/src/db.ts')).getAll('aiPlans'));
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.getByRole('heading', { name: '我的旅行计划' }).waitFor();
  assert.equal(await page.locator('input[type="time"]').count(), 0);
  await page.locator('.planner-optional-imports > summary').click();
  const luggageChoice = page.getByLabel('行李方式', { exact: true });
  await luggageChoice.waitFor();
  assert.equal(await luggageChoice.inputValue(), 'suitcase');
  await luggageChoice.selectOption('backpack');
  assert.ok((await page.locator('input[placeholder*="例如"]').count()) > 0);
  assert.equal(
    await page.getByLabel('目的地（可选）', { exact: true }).getAttribute('placeholder'),
    '例如：丽江、香格里拉',
  );
  assert.equal(
    await page.getByLabel('目的地（可选）', { exact: true }).getAttribute('required'),
    null,
  );
  await page.getByLabel('目的地（可选）', { exact: true }).fill('丽江、香格里拉');
  await page.getByLabel('旅行人群（总人数）', { exact: true }).fill('3');
  // 学生/老人/儿童默认收起，不填为 0。
  assert.equal(await page.getByLabel('学生人数', { exact: true }).isVisible(), false);
  await page.locator('.planner-party-toggle').click();
  await page.getByLabel('学生人数', { exact: true }).fill('1');
  await page.getByLabel('老人人数', { exact: true }).fill('1');
  assert.equal(await page.getByLabel('儿童人数', { exact: true }).inputValue(), '0');
  await page.locator('.planner-party-toggle').filter({ hasText: '学生 1、老人 1' }).waitFor();
  await page.locator('.planner-preferences summary').click();
  await page.getByLabel('整次旅行预算（元）').fill('5000');
  await page.getByLabel('游玩节奏', { exact: true }).selectOption('慢慢玩');
  const localTransport = page.getByLabel('当地交通', { exact: true });
  assert.doesNotMatch((await localTransport.locator('option').allTextContents()).join(' '), /火车|飞机/);
  await localTransport.selectOption({ label: '当地租车' });
  await page.getByLabel('住宿档次', { exact: true }).selectOption('节省预算');
  await page.getByLabel('房间数', { exact: true }).fill('2');
  await page.getByLabel('忌口／饮食偏好').fill('素食，不吃辣');
  await page.getByLabel('补充要求（可任意填写）').fill('按我自己的想法安排，不考虑去程返程。');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-12-01');
  await page.screenshot({ path: '.openai/planner-flexible-form.png', fullPage: true });
  await page.getByLabel('旅行天数', { exact: true }).fill('3');
  assert.equal(await page.getByLabel('结束日期', { exact: true }).inputValue(), '2026-12-03');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-12-05');
  assert.equal(await page.getByLabel('旅行天数', { exact: true }).inputValue(), '5');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-12-02');
  assert.equal(await page.getByLabel('结束日期', { exact: true }).inputValue(), '2026-12-06');
  await page.getByLabel('结束日期', { exact: true }).fill('');
  assert.equal(await page.getByLabel('旅行天数', { exact: true }).inputValue(), '');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-12-01');
  await page.getByRole('button', { name: '先让 AI 建议玩几天' }).click();
  await page.getByRole('button', { name: /3 天 · 均衡游/ }).click();
  await page.locator('.planner-plan-card[aria-current="true"]').getByText('丽江与香格里拉三日', { exact: true }).waitFor();
  assert.equal(durationCalls, 1);
  assert.equal(generationCalls, 1);
  assert.equal(submittedRequests[0].request.luggageMode, 'backpack');
  assert.equal(submittedRequests[1].request.luggageMode, 'backpack');
  assert.equal(submittedRequests[0].request.references, undefined, 'blank references keep regular planning available');
  assert.equal(await page.getByRole('button', { name: /小红书加景点 \/ 改计划/ }).count(), 1);
  assert.equal(submittedRequests[0].request.travelersText, '3 人，其中学生 1 位、老人 1 位');
  assert.equal(submittedRequests[0].request.students, 1);
  assert.equal(submittedRequests[0].request.seniors, 1);
  assert.equal(submittedRequests[0].request.children, 0);
  assert.equal(submittedRequests[0].request.budgetCents, 500000);
  assert.equal(submittedRequests[0].request.pace, '慢慢玩');
  assert.equal(submittedRequests[0].request.transport, '租车');
  assert.equal(submittedRequests[0].request.lodgingLevel, '节省预算');
  assert.equal(submittedRequests[0].request.rooms, 2);
  assert.equal(submittedRequests[0].request.dietary, '素食，不吃辣');
  assert.equal(submittedRequests[0].request.notes, '按我自己的想法安排，不考虑去程返程。');
  const generatedInput = submittedRequests.find((item) => item.endpoint === 'generate').request;
  assert.equal(generatedInput.days, 3);
  assert.equal(generatedInput.endDate, '2026-12-03');
  assert.ok(!('startTime' in generatedInput) && !('returnTo' in generatedInput));
  assert.equal(await page.locator('.planner-day').count(), 3);
  assert.equal(await page.locator('.planner-lodging').count(), 2);
  const xiaohongshuLink = new URL(await page.getByRole('link', { name: '去小红书搜这个地点', exact: true }).first().getAttribute('href'));
  assert.equal(xiaohongshuLink.origin, 'https://www.xiaohongshu.com');
  assert.equal(xiaohongshuLink.searchParams.get('keyword'), '丽江市 丽江古城');
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,710/);

  const originalContent = (await readPlans())[0].content;
  assert.ok(
    await page
      .locator('.planner-overview')
      .evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(document.querySelector('#planner-conversation')) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
    'overview appears above the AI conversation',
  );
  // 条件摘要只留在数据里供 AI 参考，不显示为页面标签。
  assert.ok(originalContent.constraints.length > 0);
  assert.equal(await page.locator('.planner-chips').count(), 0);
  assert.equal(await page.locator('.planner-overview').getByText(originalContent.constraints[0], { exact: true }).count(), 0);
  // 说明文字已移除；回车发送，Shift+回车换行不发送。
  assert.equal(await page.getByText('先给建议', { exact: false }).count(), 0);
  await page.locator('.planner-ai-launcher').click();
  const chatInput = page.getByLabel('问题或修改要求');
  await chatInput.fill('为什么这样');
  await chatInput.press('Shift+Enter');
  assert.equal(await chatInput.inputValue(), '为什么这样' + String.fromCharCode(10), 'Shift+Enter inserts a line break');
  await chatInput.fill('为什么这样安排交通？');
  await chatInput.press('Enter');
  await page.getByText('预留了候车和接驳时间。', { exact: true }).waitFor();
  assert.deepEqual(
    (await readPlans())[0].content,
    originalContent,
    'ordinary questions never mutate the itinerary',
  );
  await page.getByLabel('问题或修改要求').fill('可不可以把第一天早上换成休息？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '实施计划', exact: true }).waitFor();
  assert.deepEqual((await readPlans())[0].content, originalContent);
  await page.getByLabel('问题或修改要求').fill('这一天的天气怎样？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('天气需要临近出行再核查。', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '实施计划', exact: true }).isEnabled(),
    true,
    'ordinary follow-up keeps the suggestion applicable',
  );
  await page.getByRole('button', { name: '实施计划', exact: true }).click();
  await page.getByRole('button', { name: '早上休息', exact: true }).waitFor();
  await page.getByRole('button', { name: '已实施', exact: true }).waitFor();
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,460/);
  await page.getByRole('button', { name: '历史版本 / 撤销' }).click();
  await page.getByRole('button', { name: '恢复这个版本' }).first().click();
  await page.getByRole('button', { name: '丽江古城', exact: true }).waitFor();
  await page.getByRole('button', { name: '历史版本 / 撤销' }).click();
  const beforeLock = (await readPlans())[0].content;
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: '锁定', exact: true })
    .click();
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: '解锁', exact: true })
    .waitFor();
  const lockedContent = (await readPlans())[0].content;
  await page.getByLabel('问题或修改要求').fill('请把第一天早上改成休息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '已锁定' }).waitFor();
  assert.deepEqual((await readPlans())[0].content, lockedContent);
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: '解锁', exact: true })
    .click();
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: '锁定', exact: true })
    .waitFor();
  assert.deepEqual((await readPlans())[0].content, beforeLock);
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: 'AI 只改本模块' })
    .click();
  await page.getByLabel('问题或修改要求').fill('把这个模块改为早上休息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '早上休息', exact: true }).waitFor();
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,460/);
  assert.deepEqual((await readPlans())[0].content.days[1], originalContent.days[1]);
  await page.getByRole('button', { name: '历史版本 / 撤销' }).click();
  await page.getByRole('button', { name: '恢复这个版本' }).first().click();
  await page.getByRole('button', { name: '丽江古城', exact: true }).waitFor();
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,710/);

  // Manual edits update cents immediately, independently of model calls.
  await page
    .locator('.planner-activity')
    .first()
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '编辑行程模块' });
  await dialog.getByLabel('成人票单价', { exact: true }).fill('120');
  await dialog.getByRole('button', { name: '保存模块' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,750/);

  // A city place awaiting a journey must not be pulled into a planned trip.
  await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    await db.saveItem('places', {
      id: 'untouched-place',
      tripId: null,
      cityCode: '530700',
      name: '原来的地点',
      reviewText: '原内容',
      reviewAudioId: null,
      createdAt: '2026-12-01T00:00:00Z',
    });
  });
  await page.getByRole('button', { name: '加入旅行手账', exact: true }).click();
  await page.getByRole('button', { name: '同步到旅行手账', exact: true }).waitFor();
  const published = await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    return {
      trips: await db.getAll('trips'),
      marks: await db.getAll('marks'),
      places: await db.getAll('places'),
      plans: await db.getAll('plans'),
    };
  });
  assert.equal(published.trips.length, 1);
  assert.equal(published.trips[0].status, 'planned');
  assert.equal(published.marks.length, 0);
  assert.equal(published.places[0].tripId, null);
  const tripId = published.trips[0].id;
  await page.evaluate(async (id) => {
    const db = await import('/src/db.ts');
    const sheet = (await db.getAll('plans')).find((item) => item.tripId === id);
    sheet.actual.food = 321;
    await db.saveItem('plans', sheet);
  }, tripId);
  await page.getByRole('button', { name: '同步到旅行手账', exact: true }).click();
  await page
    .locator('.toast')
    .filter({ hasText: '计划已显式同步，原有实际花费与媒体已保留。' })
    .waitFor();
  assert.equal(
    await page.evaluate(
      async () => (await (await import('/src/db.ts')).getAll('plans'))[0].actual.food,
    ),
    321,
  );
  const conflictChecks = await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    const plan = (await db.getAll('aiPlans'))[0];
    let staleBlocked = false;
    try {
      await db.saveAiPlan({ ...plan, version: plan.version + 1 }, plan.version - 1);
    } catch {
      staleBlocked = true;
    }
    const sheet = (await db.getAll('plans'))[0];
    const originalBudget = structuredClone(sheet.budget);
    sheet.budget.other = 987;
    await db.saveItem('plans', sheet);
    let financeBlocked = false;
    try {
      await db.publishAiPlan(plan);
    } catch {
      financeBlocked = true;
    }
    const preserved = (await db.getAll('plans'))[0].budget.other === 987;
    await db.saveItem('plans', { ...sheet, budget: originalBudget });
    return { staleBlocked, financeBlocked, preserved };
  });
  assert.deepEqual(conflictChecks, { staleBlocked: true, financeBlocked: true, preserved: true });

  await page.reload();
  await page.getByRole('button', { name: '行程规划', exact: false }).click();
  await page.locator('.planner-plan-card[aria-current="true"]').getByText('丽江与香格里拉三日', { exact: true }).waitFor();
  assert.match(await page.locator('.planner-budget-total').innerText(), /1,750/);
  await page.screenshot({ path: '.openai/planner-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole('button', { name: '✦ 问 AI / 修改', exact: true }).click();
  await page.locator('#planner-chat-input').waitFor();
  await page.waitForFunction(() => {
    const bounds = document.getElementById('planner-chat-input').getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom < innerHeight - 85;
  });
  await page.screenshot({ path: '.openai/planner-conversation-mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('tab', { name: '发现目的地' }).click();
  await page.getByLabel('范围', { exact: true }).fill('云南省');
  await page.getByRole('button', { name: 'AI 推荐省内玩法' }).click();
  await page.getByRole('heading', { name: '丽江古城', exact: true }).waitFor();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('heading', { name: '收藏与备用目的地' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'no horizontal mobile overflow',
  );
  await page.screenshot({ path: '.openai/planner-mobile.png', fullPage: true });

  // Failure during a new generation cannot remove an already saved itinerary.
  await page.getByRole('tab', { name: '我的行程' }).click();
  const beforeFailure = await readPlans();
  blockGenerate = true;
  await page.getByRole('button', { name: '＋ 新建 AI 计划' }).click();
  await page.getByLabel('目的地（可选）', { exact: true }).fill('测试目的地');
  await page.getByLabel('旅行天数', { exact: true }).fill('3');
  await page.getByRole('button', { name: '联网生成旅行计划' }).click();
  await page.getByRole('alert').filter({ hasText: '测试网络超时' }).waitFor();
  assert.deepEqual(await readPlans(), beforeFailure);

  // 通过「导入小红书截图 / 链接」弹窗依次导入两篇参考，第二篇首次失败可重试，合并带入新建计划后再发给规划器。
  const optionalImportsDetails = page.locator('.planner-optional-imports');
  if ((await optionalImportsDetails.getAttribute('open')) === null) {
    await optionalImportsDetails.locator('> summary').click();
  }
  await page.getByRole('button', { name: '导入小红书截图 / 链接', exact: true }).click();
  const xhsDialog = page.getByRole('dialog', { name: '从小红书灵感新建计划' });
  await xhsDialog.waitFor();
  await xhsDialog.locator('textarea').fill(firstXhsUrl);
  await xhsDialog.getByRole('button', { name: '✦ AI 解析小红书内容', exact: true }).click();
  await xhsDialog.getByText('丽江慢游攻略', { exact: true }).waitFor();
  await xhsDialog.getByRole('button', { name: '＋ 再追加一篇笔记 / 截图', exact: true }).click();
  await xhsDialog.locator('textarea').fill(secondXhsUrl);
  await xhsDialog.getByRole('button', { name: '✦ AI 解析小红书内容', exact: true }).click();
  await xhsDialog.getByRole('alert').filter({ hasText: '测试笔记暂时不可读' }).waitFor();
  await xhsDialog.getByRole('button', { name: '✦ AI 解析小红书内容', exact: true }).click();
  await xhsDialog.getByText('香格里拉路线推荐', { exact: true }).waitFor();
  await xhsDialog.getByRole('button', { name: /带入新建计划（2 篇参考/ }).click();
  await page.getByText('已添加 2 篇参考', { exact: true }).waitFor();
  await page.getByRole('button', { name: '联网生成旅行计划', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试网络超时' }).waitFor();
  assert.deepEqual(xhsReads, [firstXhsUrl, secondXhsUrl, secondXhsUrl]);
  const withReferences = submittedRequests.at(-1).request;
  assert.equal(withReferences.referenceMode, 'blend');
  assert.equal(withReferences.destination, '测试目的地');
  assert.equal(withReferences.days, 3);
  assert.deepEqual(withReferences.references.map((ref) => ref.id), ['xhs-first', 'xhs-second']);
  await page.getByRole('button', { name: '清除已添加的参考', exact: true }).click();
  await page.getByLabel('目的地（可选）', { exact: true }).fill('');
  await page.getByLabel('旅行天数', { exact: true }).fill('');
  await page.getByRole('button', { name: '让 AI 推荐目的地', exact: true }).click();
  await page.getByRole('heading', { name: '这个时候，去哪玩', exact: true }).waitFor();
  assert.equal(submittedRequests.at(-1).endpoint, 'recommendations');
  assert.equal(submittedRequests.at(-1).request.destination, '');

  // Export and re-import the real v3 archive, including AI history and saved
  // preferences. Provider configuration is deliberately absent from the ZIP.
  await page.getByRole('button', { name: '个人中心', exact: false }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(archivePath)])));
  const members = await reader.getEntries();
  const manifestText = await members
    .find((item) => item.filename === 'manifest.json')
    .getData(new TextWriter());
  await reader.close();
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, 3);
  assert.deepEqual(manifest.data.aiPlans, beforeFailure);
  assert.equal(manifest.data.plannerPreferences[0].favorites.length, 1);
  assert.ok(!manifestText.includes('DEEPSEEK_API_KEY') && !manifestText.includes('sk-'));
  await page.evaluate(async () => {
    const db = await import('/src/db.ts');
    await db.deleteItem('aiPlans', (await db.getAll('aiPlans'))[0].id);
  });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(archivePath);
  await page.locator('.toast').filter({ hasText: '备份已导入' }).waitFor();
  assert.deepEqual(await readPlans(), beforeFailure);
  assert.deepEqual(errors, []);
  process.stdout.write(
    'Planner browser: duration, generate, read-only chat, local edit, undo, budget, publication, persistence, discovery, mobile and failure recovery: OK\n',
  );
} catch (error) {
  process.stderr.write(`UI ERROR: ${await page.locator('.planner-error').allInnerTexts()}\n`);
  process.stderr.write(`TOASTS: ${await page.locator('.toast').allInnerTexts()}\n`);
  await page.screenshot({ path: '.openai/planner-test-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
