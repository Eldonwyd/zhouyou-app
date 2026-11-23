import assert from 'node:assert/strict';
import { createPlannerMapService } from '../server/planner-map-service.mjs';
import { datedPlannerMapPlaces, plannerAmapUrl, plannerMapRouteStops } from '../src/planner-map.ts';
import { plannerFixture } from './planner-fixture.mjs';

// 行程地图只定位游玩景点（餐饮、交通与酒店不入图）；同一景点在不同日期使用不同保存键。
const content = plannerFixture();
content.days[1].activities.push({ ...content.days[0].activities[0], id: 'repeat' });
const places = datedPlannerMapPlaces(content, { '2026-12-01': '测试酒店' });
const route = plannerMapRouteStops(content, { '2026-12-01': '测试酒店' }).filter((place) => place.visits[0].date === '2026-12-01');
assert.deepEqual(route.map((place) => place.visits[0].order), [1]);
assert.equal(route[0].name, '丽江古城');
const repeats = places.filter((place) => place.name === '丽江古城');
assert.equal(repeats.length, 2);
assert.notEqual(repeats[0].key, repeats[1].key);
assert.ok(!places.some((place) => place.name === '测试酒店' || place.visits.some((visit) => visit.lodging)), '酒店与住宿片区不参与地图定位');
assert.ok(!places.some((place) => place.visits.some((visit) => visit.title.includes('午餐') || visit.title.includes('餐饮'))), '吃饭地点不参与地图定位');
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

// 城市加地点没有命中时，以单独地名重查，并继续剔除其他城市的同名结果。
const photonQueries = [];
const retryByName = createPlannerMapService({ apiKey: 'test-key', fetchImpl: async (url) => {
  if (url.hostname === 'restapi.amap.com') return Response.json({ status: '0' });
  assert.equal(url.hostname, 'photon.komoot.io');
  const query = url.searchParams.get('q');
  photonQueries.push(query);
  const features = query === '五大道' ? [
    { properties: { name: '五大道', city: '北京市' }, geometry: { coordinates: [116.4, 39.9] } },
    { properties: { name: '五大道', city: '和平区', state: '天津市' }, geometry: { coordinates: [117.19, 39.11] } },
  ] : [];
  return Response.json({ features });
} });
const tianjin = await retryByName({ places: [{ key: 'tianjin', city: '天津市', name: '五大道' }] }, signal);
assert.deepEqual(photonQueries, ['天津市 五大道', '五大道']);
assert.equal(tianjin.positions[0].source, 'OpenStreetMap / Photon');
assert.equal(tianjin.positions[0].longitude, 117.19);
assert.equal(tianjin.notice, '');

// 高德直辖市总代码应接受同市不同区的结果，保留地址和坐标供用户确认。
const amap = createPlannerMapService({ apiKey: 'test-key', fetchImpl: async (url) => {
  assert.equal(url.hostname, 'restapi.amap.com');
  const name = url.searchParams.get('keywords');
  const pois = name === '测试酒店' ? [
    { name, adcode: '110105', adname: '朝阳区', address: '测试路1号', location: '116.45,39.91' },
    { name, adcode: '110108', adname: '海淀区', address: '测试路2号', location: '116.31,39.98' },
    { name, adcode: '120101', adname: '和平区', location: '117.20,39.12' },
  ] : [];
  return Response.json({ status: '1', pois });
} });
const hotelsInBeijing = await amap({ places: [{ key: 'hotel', city: '北京市', cityCode: '110000', name: '测试酒店' }] }, signal);
assert.equal(hotelsInBeijing.positions[0].status, 'unresolved');
assert.deepEqual(hotelsInBeijing.positions[0].candidates.map((candidate) => candidate.label), [
  '测试酒店 · 朝阳区 · 测试路1号', '测试酒店 · 海淀区 · 测试路2号',
]);
assert.notEqual(hotelsInBeijing.positions[0].candidates[0].longitude, 116.45, '候选坐标也转换为底图坐标');

// 查具体分店时，店名主体相同的其他店-或城市本身-不能作为精确位置。
const emptySupplemental = { local: async () => [], wikidata: async () => [] };
const exactPlace = createPlannerMapService({ supplementalLookup: emptySupplemental, overpassUrl: '', fetchImpl: async () =>
  Response.json({ features: ['大理', '测试咖啡', '测试咖啡（北门店）'].map((name) => ({
    properties: { name, city: '大理市' }, geometry: { coordinates: [100.24, 25.59] },
  })) }) });
const exactResults = await exactPlace({ places: [
  { key: 'old-town', city: '大理市', name: '大理古城' },
  { key: 'branch', city: '大理市', name: '测试咖啡（南门店）' },
] }, signal);
assert.ok(exactResults.positions.every((position) => position.status === 'unresolved'));

// 全称/简称兼容、本地地理边界校验（如重庆渝中区）、防酒店分店抢占地标、同景点多节点聚类与熔断。
let brokenPhotonCalls = 0;
const smartOpen = createPlannerMapService({
  supplementalLookup: emptySupplemental,
  overpassUrl: '',
  fetchImpl: async (url) => {
    const u = new URL(url);
    if (u.hostname === 'photon.komoot.io') {
      brokenPhotonCalls++;
      throw new Error('simulated timeout');
    }
    if (u.hostname === 'nominatim.openstreetmap.org') {
      const q = u.searchParams.get('q') || '';
      if (q.includes('洪崖洞')) {
        return Response.json([
          { name: '洪崖洞', lat: '29.5651', lon: '106.5753', class: 'tourism', type: 'attraction', address: { county: '渝中区' } },
          { name: '洪崖洞', lat: '29.5644', lon: '106.5716', class: 'highway', type: 'bus_stop', address: { county: '渝中区' } },
        ]);
      }
      if (q.includes('解放碑')) {
        return Response.json([
          { name: '你好酒店(重庆解放碑步行街店)', lat: '29.5574', lon: '106.5758', class: 'tourism', type: 'hotel', address: { county: '渝中区' } },
          { name: '解放碑', lat: '29.5601', lon: '106.5734', class: 'historic', type: 'monument', address: { county: '渝中区' } },
        ]);
      }
      if (q.includes('故宫')) {
        return Response.json([
          { name: '北京故宫博物院', lat: '39.9173', lon: '116.3908', class: 'tourism', type: 'museum', address: { city: 'Beijing' } },
        ]);
      }
    }
    return Response.json([]);
  },
});
const smartResults = await smartOpen({ places: [
  { key: 'cq-hyd', city: '重庆市', name: '洪崖洞民俗风貌区' },
  { key: 'cq-jfb', city: '重庆', name: '解放碑步行街' },
  { key: 'bj-gg', city: '北京市', name: '故宫' },
] }, signal);
assert.equal(smartResults.positions[0].status, 'located', '洪崖洞民俗风貌区应命中渝中区洪崖洞并聚类合并公交站');
assert.equal(smartResults.positions[0].latitude, 29.5651);
assert.equal(smartResults.positions[1].status, 'located', '解放碑步行街应选中历史地标而非酒店分店');
assert.match(smartResults.positions[1].label, /^解放碑/);
assert.equal(smartResults.positions[2].status, 'located', '故宫应匹配北京故宫博物院并兼容英文城市名');
assert.equal(brokenPhotonCalls, 2, 'Photon 连续失败 2 次后熔断，第 3 个地点直接跳过避免死等');

console.log('开放地图：无Key定位、异城过滤、候选选择、按日保存键、酒店、宽松匹配、聚类与熔断通过');
