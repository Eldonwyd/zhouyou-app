import assert from 'node:assert/strict';
import { allowsPlannerEdit, createPlannerService } from '../server/planner-service.mjs';
import { createPlannerServer } from '../server/index.mjs';
import { aiPlanFixture, plannerFixture } from './planner-fixture.mjs';

let action = 'answer';
assert.equal(allowsPlannerEdit('如果把上午改成休息会怎样'), false);
assert.equal(allowsPlannerEdit('不要修改行程，解释一下交通'), false);
assert.equal(allowsPlannerEdit('可以把上午改成休息吗？'), false);
assert.equal(allowsPlannerEdit('请把上午改成休息'), true);
assert.equal(allowsPlannerEdit('不要早起，请把第一天改为休息'), true);
assert.equal(allowsPlannerEdit('请修改第二天，如果下雨就安排室内'), true);
assert.equal(allowsPlannerEdit('如果第二天改成室内'), false);
for (const text of [
  '如果把第二天换成休息怎么样',
  '可不可以把古城换成雪山',
  '能不能换成别的景点',
  '可以换成公园吗',
  '不要修改，先给我建议',
]) {
  assert.equal(allowsPlannerEdit(text), false, text);
}
let failSearch = false;
let invalidOutput = false;
let escapeScope = false;
let malformedCosts = false;
let omitSuggestion = false;
let syntaxNoise = false;
let reportUncertain = false;
const calls = [];
const fetchImpl = async (url, options = {}) => {
  options.signal?.throwIfAborted();
  const address = String(url);
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ address, body, auth: options.headers?.Authorization });
  if (address.includes('/tools/search'))
    return Response.json({
      results: failSearch
        ? []
        : [
            {
              title: 'Official reference',
              url: 'https://www.lijiang.gov.cn/',
              content: '季节、景点、铁路参考；具体价格待核实',
            },
          ],
    });
  if (address.includes('wikipedia'))
    return Response.json({ query: { pages: { '-1': { missing: true } } } });
  if (address.endsWith('/chat/completions')) {
    const user = body.messages.at(-1).content;
    let result;
    if (user.includes('只判断最新')) result = { action };
    else if (user.includes('只回答与提出建议'))
      result = {
        answer: '先休息可以减少疲劳，但游览时间会减少。目前没有修改行程。\n相关链接：景点参考 https://www.lijiang.gov.cn/ ；编造页面 https://fake.example.com/made-up.html',
        suggestion: omitSuggestion
          ? null
          : {
              title: '第一天早上改为休息',
              instruction: '请把第一天早上的活动改为休息，保留时间，其余不变。',
            },
      };
    else if (user.includes('整理一条待确认修改建议'))
      result = {
        suggestion: { title: '改成休息', instruction: '请把第一天早上改为休息，其余不变。' },
      };
    else if (user.includes('建议2至3种天数'))
      result = {
        options: [
          { days: 3, title: '均衡', reason: '两城衔接' },
          { days: 4, title: '慢游', reason: '多留一天' },
        ],
      };
    else if (user.includes('推荐最多6个')) {
      const sourceId = user.match(/"id":"(s-[^"]+)"/)[1];
      result = {
        recommendations: [
          {
            title: '丽江古城',
            destination: '丽江',
            reason: '冬季慢游',
            season: '冬季',
            suggestedDays: '3天',
            access: '铁路出发',
            photo: null,
            sourceIds: [sourceId],
          },
        ],
      };
    } else {
      const content = plannerFixture();
      if (user.includes('修改要求') || user.includes('严格按照上一条')) {
        content.days[0].activities[0].kind = 'rest';
        content.days[0].activities[0].title = '早上休息';
        content.days[0].activities[0].costs = [];
        if (escapeScope) content.days[1].activities[0].title = '越界';
        result = body.messages.some(
          (message) => message.role === 'user' && message.content.includes('只返回活动补丁'),
        )
          ? {
              summary: '仅将第一天早上改为休息',
              activities: [
                content.days[0].activities[0],
                ...(escapeScope ? [content.days[1].activities[0]] : []),
              ],
            }
          : { summary: '仅将第一天早上改为休息', content };
      } else {
        const sourceId = user.match(/"id":"(s-[^"]+)"/)[1];
        content.days[0].activities[0].sourceIds = [sourceId];
        // Fixtures may reference the same original source on several activities.
        for (const day of content.days)
          for (const activity of day.activities)
            if (activity.sourceIds.includes('official')) activity.sourceIds = [sourceId];
        result = content;
        // 模拟 AI 报告不确定问题；收到补充的游客经验后返回修正版并清空 uncertain。
        if (reportUncertain) {
          const followUp = user.includes('针对这些不确定问题');
          result.uncertain = followUp ? [] : ['玉龙雪山冬季索道是否开放'];
          if (followUp) result.summary = '按游客经验修正后的行程';
        }
        if (malformedCosts) {
          // Reproduce the screenshot: a useful itinerary whose fee omits
          // metadata that the old strict validator treated as mandatory.
          result.days[0].activities[0].costs = [
            {
              category: '门票',
              label: '景点票',
              unit: '每人',
              unitPriceCents: '10000',
              studentPriceCents: '5000',
            },
          ];
        }
      }
    }
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: invalidOutput
              ? 'not json'
              : syntaxNoise
                ? `\`\`\`json\n${JSON.stringify(result).slice(0, -1)},}\n\`\`\``
                : JSON.stringify(result),
          },
        },
      ],
    });
  }
  throw new Error('Unexpected test network address');
};
const service = createPlannerService({ apiKey: 'test-key', fetchImpl });
const signal = new AbortController().signal;
const progress = [];
const request = plannerFixture().request;
const generated = await service.generate({ request }, signal, (stage) => progress.push(stage));
assert.equal(generated.content.days.length, 3);
assert.equal(generated.budget.totalCents, 171000);
malformedCosts = true;
const repaired = await service.generate({ request }, signal, () => {});
assert.equal(repaired.budget.categories.tickets, 25000);
assert.equal(repaired.content.days[0].activities[0].costs[0].status, 'estimate');
malformedCosts = false;
assert.ok(progress.length >= 2); // 研究资料、安排行程；配图已移到页面上逐张加载
assert.ok(
  calls
    .filter((call) => call.address.includes('api.deepseek.com'))
    .every((call) => call.auth === 'Bearer test-key'),
);
assert.ok(
  calls.filter((call) => call.address.includes('wikipedia')).every((call) => !call.auth),
  'key never sent to image sources',
);
const duration = await service.duration({ request }, signal, () => {});
assert.equal(duration.options[0].days, 3);
const modelCalls = () => calls.filter((item) => item.address.endsWith('/chat/completions')).length;
const beforeRepair = modelCalls();
syntaxNoise = true;
assert.equal((await service.duration({ request }, signal, () => {})).options[0].days, 3);
syntaxNoise = false;
assert.equal(
  modelCalls(),
  beforeRepair + 1,
  'JSON repair stays local without a second model request',
);
const recommended = await service.recommendations({ request }, signal, () => {});
assert.equal(recommended.recommendations.length, 1);
const plan = aiPlanFixture();
const answer = await service.chat(
  { plan, baseVersion: 1, message: '如果改成休息会怎样？', mode: 'auto' },
  signal,
  () => {},
);
assert.equal(answer.action, 'answer');
assert.equal(answer.content, undefined);
assert.equal(answer.suggestion.baseContentVersion, 1);
// 回答里的链接只保留真实来源；AI 编造的网址被删除。
assert.ok(answer.answer.includes('https://www.lijiang.gov.cn'), 'real source links are kept');
assert.ok(!answer.answer.includes('fake.example.com'), 'invented links are removed');
omitSuggestion = true;
const recovered = await service.chat(
  { plan, baseVersion: 1, scopeId: 'sight-1', message: '可不可以换成休息', mode: 'auto' },
  signal,
  () => {},
);
assert.ok(recovered.suggestion?.instruction);
assert.equal(recovered.content, undefined);
assert.ok(
  !calls.at(-1).body.messages.at(-1).content.includes('先休息可以减少疲劳'),
  'proposal recovery uses original user input rather than resending the raw AI reply',
);
omitSuggestion = false;
const proposalPlan = {
  ...plan,
  version: 2,
  contentVersion: 1,
  messages: [
    {
      id: 'proposal-message',
      role: 'assistant',
      text: answer.answer,
      createdAt: new Date().toISOString(),
      suggestion: { ...answer.suggestion, scopeId: 'sight-1' },
    },
  ],
};
const applied = await service.chat(
  {
    plan: proposalPlan,
    baseVersion: 2,
    message: '应用建议',
    mode: 'apply-suggestion',
    applySuggestionMessageId: 'proposal-message',
  },
  signal,
  () => {},
);
assert.equal(applied.action, 'revision');
assert.equal(applied.content.days[0].activities[0].kind, 'rest');
await assert.rejects(
  () =>
    service.chat(
      {
        plan: { ...proposalPlan, contentVersion: 3 },
        baseVersion: 2,
        message: '应用建议',
        mode: 'apply-suggestion',
        applySuggestionMessageId: 'proposal-message',
      },
      signal,
      () => {},
    ),
  /过期/,
);
const lockedPlan = structuredClone(proposalPlan);
lockedPlan.content.days[0].activities[0].locked = true;
await assert.rejects(
  () =>
    service.chat(
      {
        plan: lockedPlan,
        baseVersion: 2,
        message: '应用建议',
        mode: 'apply-suggestion',
        applySuggestionMessageId: 'proposal-message',
      },
      signal,
      () => {},
    ),
  /锁定/,
);
await assert.rejects(
  () =>
    service.chat(
      { plan: lockedPlan, baseVersion: 2, message: '请修改', mode: 'edit', scopeId: 'sight-1' },
      signal,
      () => {},
    ),
  /锁定/,
);
const lockedAnswer = await service.chat(
  {
    plan: lockedPlan,
    baseVersion: 2,
    message: '如果换成休息怎么样',
    mode: 'auto',
    scopeId: 'sight-1',
  },
  signal,
  () => {},
);
assert.equal(lockedAnswer.action, 'answer');
assert.equal(lockedAnswer.suggestion, undefined);
action = 'edit';
await assert.rejects(
  () =>
    service.chat(
      { plan: lockedPlan, baseVersion: 2, message: '请调整全程', mode: 'edit' },
      signal,
      () => {},
    ),
  /锁定/,
);
const edited = await service.chat(
  { plan, baseVersion: 1, message: '把第一天早上改成休息', mode: 'auto', scopeId: 'sight-1' },
  signal,
  () => {},
);
assert.equal(edited.action, 'revision');
assert.equal(edited.content.days[0].activities[0].title, '早上休息');
escapeScope = true;
await assert.rejects(
  () =>
    service.chat(
      { plan, baseVersion: 1, message: '修改', mode: 'edit', scopeId: 'sight-1' },
      signal,
      () => {},
    ),
  /超出/,
);
escapeScope = false;
await assert.rejects(
  () => service.chat({ plan, baseVersion: 0, message: '修改', mode: 'edit' }, signal, () => {}),
  /版本/,
);
invalidOutput = true;
await assert.rejects(() => service.duration({ request }, signal, () => {}), /格式/);
invalidOutput = false;
const noResults = createPlannerService({ apiKey: 'test-key', fetchImpl });
failSearch = true;
await assert.rejects(() => noResults.generate({ request }, signal, () => {}), /联网检索/);
failSearch = false;

/** 排除寄存需求后，游客经验仍只在明确要求或有不确定问题时补查。 */
const backpackRequest = { ...request, luggageMode: 'backpack' };
let experienceUnavailable = false;
let experienceNotes = true;
const experienceQueries = [];
const experienceProgress = [];
const experienceService = createPlannerService({ apiKey: 'test-key', fetchImpl, xhsBridge: {
  configured: true,
  async travelEvidence(query) {
    experienceQueries.push(query);
    assert.equal(query.destination, request.destination);
    if (experienceUnavailable) throw new Error('登录已失效');
    if (!experienceNotes) return [];
    return [{ title: '小红书 · 慢游经验', url: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567',
      content: '笔记正文：适合慢游。当前页面游客评论摘录：建议留出休息时间。', date: '2026-03-01T00:00:00.000Z' }];
  },
} });
// 1. 默认：不查小红书，资料只有官方/公开来源。
const plainDuration = await experienceService.duration({ request: backpackRequest }, signal, () => {});
assert.equal(experienceQueries.length, 0, 'Xiaohongshu is not searched by default');
assert.ok(plainDuration.sources.every((source) => !source.title.includes('小红书')));
const beforeBackpack = calls.length;
const plainGenerate = await experienceService.generate({ request: backpackRequest }, signal, () => {});
assert.equal(experienceQueries.length, 0);
assert.equal(plainGenerate.content.request.luggageMode, 'backpack');
assert.ok(plainGenerate.content.days.every((day) => day.activities.every((activity) => !activity.luggageNote)));
assert.ok(calls.slice(beforeBackpack).some(({ body }) => body.messages?.at(-1).content.includes('尽量走单向路线')));
assert.ok(!plainGenerate.content.warnings.some((item) => item.startsWith('待核实')));
assert.equal(plainGenerate.content.uncertain, undefined, 'uncertain is never stored in the plan');
// 2. 用户要求：补充要求提到小红书/攻略时查，官方资料排在前面，经验进入提示词。
const askedRequest = { ...backpackRequest, notes: '想看小红书上的避坑攻略' };
const asked = await experienceService.generate({ request: askedRequest }, signal, (stage) => experienceProgress.push(stage));
assert.equal(experienceQueries.length, 1);
assert.equal(experienceQueries[0].topic, null);
assert.ok(asked.content.sources.some((source) => source.title.includes('小红书')));
assert.ok(!asked.content.sources[0].title.includes('小红书'), 'official sources come first');
const askedPrompt = calls.filter((call) => call.address.endsWith('/chat/completions')).at(-1).body.messages;
assert.ok(askedPrompt.at(-1).content.includes('建议留出休息时间'));
assert.ok(askedPrompt[0].content.includes('不编造评分'));
assert.ok(experienceProgress.some((stage) => stage.includes('小红书')));
// 3. 不确定/矛盾：按具体问题定向查，再修正一次；查不到时写入“待核实”提醒。
experienceQueries.length = 0;
reportUncertain = true;
const clarified = await experienceService.generate({ request: backpackRequest }, signal, () => {});
assert.equal(experienceQueries.length, 1);
assert.equal(experienceQueries[0].topic, '玉龙雪山冬季索道是否开放');
assert.equal(clarified.content.summary, '按游客经验修正后的行程');
assert.ok(!clarified.content.warnings.some((item) => item.startsWith('待核实')));
experienceNotes = false;
const unresolved = await experienceService.generate({ request: backpackRequest }, signal, () => {});
assert.ok(unresolved.content.warnings.includes('待核实：玉龙雪山冬季索道是否开放'));
reportUncertain = false;
experienceNotes = true;
// 4. 用户要求但站内不可用：仍能完成，不含小红书来源。
experienceUnavailable = true;
const fallback = await experienceService.generate({ request: askedRequest }, signal, () => {});
assert.ok(fallback.content.sources.every((source) => !source.title.includes('小红书')));

// 旧请求默认行李箱。用末日实际景点定向查寄存，来源支持的点位和费用才可显示。
const { luggageMode: _unusedMode, ...oldRequest } = request;
const luggageQueries = [];
let lodgingEvidence = '香格里拉独克宗古城游客中心目前不提供行李寄存，停车费20元。';
let xhsStorageEvidence = '香格里拉独克宗古城北门游客服务中心提供行李寄存，每件12元。';
const luggageService = createPlannerService({ apiKey: 'test-key', fetchImpl: (url, options) => {
  const query = options?.body && JSON.parse(options.body).query;
  if (!query?.includes('行李寄存')) return fetchImpl(url, options);
  luggageQueries.push(query);
  return Response.json({ results: [{ title: '香格里拉独克宗古城服务', url: 'https://www.diqing.gov.cn/service/luggage', content: lodgingEvidence }] });
}, xhsBridge: {
  configured: true,
  async travelEvidence(query) {
    luggageQueries.push(query.topic);
    return xhsStorageEvidence ? [{ title: '香格里拉独克宗古城寄存经验', url: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567', content: xhsStorageEvidence }] : [];
  },
} });
const baggagePlan = await luggageService.generate({ request: oldRequest }, signal, () => {});
assert.equal(baggagePlan.content.request.luggageMode, 'suitcase');
assert.match(baggagePlan.content.days[1].activities.find((item) => item.kind === 'sight').luggageNote.text, /原酒店/);
const lastSight = (result) => result.content.days.at(-1).activities.find((item) => item.kind === 'sight');
assert.match(lastSight(baggagePlan).luggageNote.text, /游客经验.*北门游客服务中心.*每件12元/);
assert.doesNotMatch(lastSight(baggagePlan).luggageNote.text, /20元|原酒店/);
assert.ok(luggageQueries.some((query) => query.includes('行李寄存 寄存点 收费')));
assert.ok(baggagePlan.content.sources.some((source) => source.id === lastSight(baggagePlan).luggageNote.sourceId && source.url.includes('xiaohongshu.com')));
assert.equal(baggagePlan.content.days.flatMap((day) => day.activities).length, plannerFixture().days.flatMap((day) => day.activities).length);

xhsStorageEvidence = '';
lodgingEvidence = '香格里拉独克宗古城东门游客中心提供行李寄存服务，10元/件。';
luggageQueries.length = 0;
const verifiedStorage = await luggageService.generate({ request }, signal, () => {});
assert.match(lastSight(verifiedStorage).luggageNote.text, /公开资料.*东门游客中心.*10元\/件/);
assert.equal(luggageQueries.includes('行李寄存 寄存点 收费'), false);

lodgingEvidence = '香格里拉独克宗古城游客中心可以寄存行李吗？门票50元。';
const unknownStorage = await luggageService.generate({ request }, signal, () => {});
assert.match(lastSight(unknownStorage).luggageNote.searchQuery, /独克宗古城 行李寄存$/);
assert.doesNotMatch(lastSight(unknownStorage).luggageNote.text, /没有|50元/);

const aborted = new AbortController();
aborted.abort();
await assert.rejects(() => service.generate({ request }, aborted.signal, () => {}));

// Exercise the HTTP boundary: origin protection, progress framing and no-store.
const server = await createPlannerServer({ apiKey: 'test-key', service });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${origin}/api/planner/health`);
  const healthBody = await health.json();
  assert.equal(healthBody.configured, true);
  assert.equal(healthBody.searchAvailable, true);
  assert.ok(healthBody.saved.some((item) => item.id === 'deepseek'));
  // 不限制访问来源：经代理、Tailscale 或其他域名转发的请求都不应被 403 拦截。
  const proxied = await fetch(`${origin}/api/planner/health`, {
    headers: { Origin: 'https://unrelated.example' },
  });
  assert.equal(proxied.status, 200);
  const response = await fetch(`${origin}/api/planner/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request }),
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.ok(events.some((event) => event.type === 'progress'));
  assert.equal(events.at(-1).type, 'result');
  const invalid = await fetch(`${origin}/api/planner/duration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid',
  });
  assert.equal(invalid.status, 400);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
process.stdout.write(
  'Planner search, model contract, read-only questions, scope, failure handling and HTTP boundary: OK\n',
);
