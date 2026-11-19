import assert from 'node:assert/strict';
import { plannerFixture, aiPlanFixture } from './planner-fixture.mjs';
import { plannerSuggestions, resolvePlannerChoice } from '../src/planner-domain.ts';
import { plannerDisplayText } from '../src/planner-display.ts';
import { collectPlannerMapPlaces, plannerAmapUrl } from '../src/planner-map.ts';
import { createPlannerMapService, gcj02ToWgs84 } from '../server/planner-map-service.mjs';
import { createPlannerService } from '../server/planner-service.mjs';

/** 覆盖真实的授权边界：有上下文才选方案，疑问/否定/假设不执行。 */
const options = [{ id: 'a', label: 'A', title: '休息', instruction: '请把第一天上午改成休息。', scopeId: 'sight-1', baseContentVersion: 1 },
  { id: 'b', label: 'B', title: '慢游', instruction: '请缩短第一天上午游览。', scopeId: 'sight-1', baseContentVersion: 1 }];
const messages = [{ id: 'options', role: 'assistant', text: '两个方案', suggestions: options }, { id: 'followup', role: 'assistant', text: '天气待确认' }];
for (const text of ['A', '选 A', '就按方案 A', '我选A', '采用 A', 'Ａ']) assert.equal(resolvePlannerChoice(text, messages)?.suggestion.id, 'a', text);
assert.equal(resolvePlannerChoice('选B', messages)?.suggestion.id, 'b');
for (const text of ['A 怎么样', '方案 A 怎么样？', '如果选 A 呢', '选 A 可以吗', '不采用 A', '先别改', '先别改，选A', 'A和B', '实施计划']) assert.equal(resolvePlannerChoice(text, messages), null, text);
assert.equal(resolvePlannerChoice('选A', []), null);
assert.equal(plannerSuggestions({ suggestion: options[0] }).length, 1);

// 已知编号显示可读名称，未知历史编号清理，合法来源地址保持原样。
const fixture = plannerFixture();
const link = 'https://example.org/transport/lodging-5?q=s-ec06db8d-a00';
const clean = plannerDisplayText(`s-ec06db8d-a00 与 s-9f37438e-98d，transport ransport lodging-5 lodging-6，sight-1 ${link}`, fixture);
assert.ok(!/s-ec06|s-9f374|lodging-5|lodging-6|ransport/.test(clean.replace(link, '')));
assert.ok(clean.includes(link));
assert.ok(clean.includes('丽江古城'));
assert.equal(plannerDisplayText('丽江 Transport Museum'), '丽江 交通 Museum');

const repeat = structuredClone(fixture.days[0].activities[0]);
fixture.days[1].activities.push(repeat);
const places = collectPlannerMapPlaces(fixture);
assert.equal(places.filter((place) => place.name === '丽江古城').length, 1);
assert.equal(places.find((place) => place.name === '丽江古城').visits.length, 2);
assert.ok(places.some((place) => place.visits.some((visit) => visit.lodging)));
const amap = new URL(plannerAmapUrl(places[0]));
assert.equal(amap.origin, 'https://uri.amap.com');
assert.equal(amap.searchParams.get('city'), '丽江市');
assert.ok(amap.searchParams.get('keyword').includes('丽江古城'));

const signal = new AbortController().signal;
const noKey = await createPlannerMapService({ fetchImpl: async () => Response.json({ features: [] }) })({ places: [places[0]] }, signal);
assert.ok(noKey.positions.every((position) => position.status === 'unresolved' && !('latitude' in position)));
assert.ok(!noKey.notice.includes('AMAP_WEB_SERVICE_KEY'));
let searches = 0;
const mapService = createPlannerMapService({ apiKey: 'private-test-key', fetchImpl: async (url) => {
  searches++;
  assert.equal(new URL(url).searchParams.get('citylimit'), 'true');
  const name = new URL(url).searchParams.get('keywords');
  return Response.json({ status: '1', pois: [
    { name, cityname: '丽江市', adcode: '530702', location: '100.24,26.87' },
    // 同名异城地点不能进入候选。
    { name, cityname: '北京市', adcode: '110101', location: '116.4,39.9' },
  ] });
} });
const located = await mapService({ places: [places[0]] }, signal);
assert.equal(located.positions[0].status, 'located');
assert.equal(located.positions[0].amapLocation, '100.24,26.87');
assert.ok(Math.abs(located.positions[0].longitude - 100.24) < 0.02);
assert.notEqual(located.positions[0].longitude, 100.24);
assert.ok(!JSON.stringify(located).includes('private-test-key'));
await mapService({ places: [places[0]] }, signal);
assert.equal(searches, 1, 'cache avoids repeated provider requests');
const ambiguous = createPlannerMapService({ apiKey: 'test', fetchImpl: async () => Response.json({ status: '1', pois: [
  { name: places[0].name, cityname: '丽江市', adcode: '530702', location: '100.24,26.87' },
  { name: places[0].name, cityname: '丽江市', adcode: '530702', location: '100.25,26.88' },
] }) });
assert.equal((await ambiguous({ places: [places[0]] }, signal)).positions[0].status, 'unresolved');
assert.deepEqual(gcj02ToWgs84(0, 51), [0, 51]);

// 两条方案经过实际服务路径分别选择；请求不能偷偷替换已保存指令或范围。
let actualEdit = '';
const service = createPlannerService({ apiKey: 'test', fetchImpl: async (url, request) => {
  if (String(url).includes('/tools/search')) return Response.json({ results: [{ title: '资料', url: 'https://www.lijiang.gov.cn/', content: '交通参考' }] });
  if (String(url).includes('wikipedia')) return Response.json({ query: { pages: {} } });
  const prompt = JSON.parse(request.body).messages.at(-1).content;
  let result;
  if (prompt.includes('只回答与提出建议')) result = { answer: '方案 A 休息，方案 B 慢游。transport s-ec06db8d-a00', suggestions: options };
  else if (prompt.includes('修改要求')) {
    actualEdit = prompt;
    const activity = plannerFixture().days[0].activities[0];
    activity.kind = 'rest'; activity.title = '早上休息'; activity.costs = [];
    result = { summary: '已修改 lodging-5', activities: [activity] };
  } else throw new Error('Unexpected model call');
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
} });
const plan = aiPlanFixture();
const answer = await service.chat({ plan, baseVersion: 1, message: '请给我两个备选方案', mode: 'auto', scopeId: 'sight-1' }, signal, () => {});
assert.equal(answer.suggestions.length, 2);
assert.ok(!answer.answer.includes('transport') && !answer.answer.includes('s-ec06'));
plan.messages = [{ id: 'options', role: 'assistant', text: answer.answer, suggestions: answer.suggestions }];
for (const [text, index] of [['选 A', 0], ['就按方案 B', 1]]) {
  const revision = await service.chat({ plan, baseVersion: 1, message: text, mode: 'auto', scopeId: 'sight-2' }, signal, () => {});
  assert.equal(revision.action, 'revision');
  assert.equal(revision.scopeId, 'sight-1', 'stored option scope takes precedence');
  assert.equal(revision.appliedSuggestionId, answer.suggestions[index].id);
  assert.ok(actualEdit.includes(answer.suggestions[index].instruction));
}
plan.messages[0].suggestions[0].appliedAt = new Date().toISOString();
await assert.rejects(() => service.chat({ plan, baseVersion: 1, message: '选A', mode: 'auto' }, signal, () => {}), /已经应用/);
plan.messages[0].suggestions[0].appliedAt = undefined;
plan.contentVersion = 2;
await assert.rejects(() => service.chat({ plan, baseVersion: 1, message: '选A', mode: 'auto' }, signal, () => {}), /过期/);
process.stdout.write('Planner multi-option authorization, display filtering, map matching, coordinate handling and fallback: OK\n');
