import assert from 'node:assert/strict';
import { createPlannerMapService } from '../server/planner-map-service.mjs';
import { datedPlannerMapPlaces, plannerAmapUrl, plannerMapRouteStops } from '../src/planner-map.ts';
import { plannerFixture } from './planner-fixture.mjs';

// 同一地点在不同日期使用不同保存键；酒店只覆盖对应晚的住宿标记。
const content = plannerFixture();
content.days[1].activities.push({ ...content.days[0].activities[0], id: 'repeat' });
const places = datedPlannerMapPlaces(content, { '2026-12-01': '测试酒店' });
const route = plannerMapRouteStops(content, { '2026-12-01': '测试酒店' }).filter((place) => place.visits[0].date === '2026-12-01');
assert.deepEqual(route.map((place) => place.visits[0].order), [1, 2, 3]);
assert.equal(route.at(-1).name, '测试酒店');
const repeats = places.filter((place) => place.name === '丽江古城');
assert.equal(repeats.length, 2);
assert.notEqual(repeats[0].key, repeats[1].key);
assert.ok(places.some((place) => place.name === '测试酒店' && place.visits[0].date === '2026-12-01'));
assert.ok(places.some((place) => place.visits[0].lodging && place.visits[0].date === '2026-12-02' && place.name !== '测试酒店'));
assert.ok(new URL(plannerAmapUrl({ city: '丽江市', name: '测试酒店' })).searchParams.get('keyword').includes('测试酒店'));

let calls = 0;
const service = createPlannerMapService({ fetchImpl: async () => {
  calls++;
  return Response.json({ features: [
    { properties: { name: '丽江古城', city: '丽江市' }, geometry: { coordinates: [100.24, 26.87] } },
    { properties: { name: '丽江古城', city: '北京市' }, geometry: { coordinates: [116.4, 39.9] } },
  ] });
} });
const signal = new AbortController().signal;
const result = await service({ places: repeats }, signal);
assert.equal(result.positions.length, 2);
assert.ok(result.positions.every((position) => position.status === 'located' && position.longitude === 100.24));
assert.equal(calls, 1, '不同日期同一地点复用缓存但返回独立日期键');
assert.ok(!result.notice.includes('KEY'));
const ambiguous = createPlannerMapService({ fetchImpl: async () => Response.json({ features: [100.24, 100.25].map((lon) => ({
  properties: { name: '丽江古城', city: '丽江市' }, geometry: { coordinates: [lon, 26.87] },
})) }) });
const uncertain = await ambiguous({ places: [repeats[0]] }, signal);
assert.equal(uncertain.positions[0].status, 'unresolved');
assert.equal(uncertain.positions[0].candidates.length, 2);
const prefixed = await service({ places: [{ key: 'prefix', city: '丽江市', name: '古城区丽江古城' }] }, signal);
assert.equal(prefixed.positions[0].status, 'located', '行政区前缀不阻止匹配');
const fallback = createPlannerMapService({ fetchImpl: async (url) => String(url).includes('photon')
  ? Response.json({ features: [] })
  : Response.json({ elements: [{ tags: { name: '测试公园' }, center: { lat: 25.05, lon: 102.7 } }] }) });
const fallbackResult = await fallback({ places: [{ key: 'fallback', city: '昆明市', name: '测试公园' }] }, signal);
assert.equal(fallbackResult.positions[0].status, 'located');
assert.match(fallbackResult.positions[0].source, /Overpass/);
console.log('开放地图：无Key定位、异城过滤、候选选择、按日保存键、酒店和缓存通过');
