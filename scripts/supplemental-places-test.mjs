import assert from 'node:assert/strict';
import { createSupplementalPlaceLookup } from '../server/supplemental-places.mjs';
import { createPlannerMapService } from '../server/planner-map-service.mjs';
import { plannerPlaceSearchTarget } from '../src/planner-place-name.ts';
import { plannerMapRouteStops } from '../src/planner-map.ts';
import { plannerFixture } from './planner-fixture.mjs';

// 行政区+地名并非不同地点；片区描述按用户指定的后一个地名取参考位置。
assert.deepEqual(plannerPlaceSearchTarget('滇池国家旅游度假区海埂大坝', '昆明市'), { name: '海埂大坝', area: false });
assert.deepEqual(plannerPlaceSearchTarget('五华区翠湖公园', '昆明市'), { name: '翠湖公园', area: false });
assert.deepEqual(plannerPlaceSearchTarget('翠湖—南屏街片区', '昆明市'), { name: '南屏街', area: true });
const content = plannerFixture();
content.days[0].activities[1].location = '附近吃火锅';
assert.equal(plannerMapRouteStops(content).find((place) => place.visits[0].title === content.days[0].activities[1].title), undefined, '吃饭地点不需要在地图上定位');
content.days[0].activities[1].location = '美食林餐厅';
assert.ok(!plannerMapRouteStops(content).some((place) => place.name === '美食林餐厅'), '具体餐厅同样不参与行程地图定位');

let requests = 0;
const lookup = createSupplementalPlaceLookup({ localRecords: [
  { name: '南屏街', city: '昆明市', longitude: 102.71, latitude: 25.035, source: 'Overture Places', license: 'CDLA-Permissive-2.0' },
], fetchImpl: async (url) => {
  requests++;
  const parameters = new URL(url).searchParams;
  if (parameters.get('action') === 'wbsearchentities') return Response.json({ search: parameters.get('search') === '大理市'
    ? [{ id: 'Q1', match: { text: '大理市' } }]
    : [{ id: 'Q2', match: { text: '大理站' } }, { id: 'Q3', match: { text: '大理站' } }] });
  const claim = (value) => ({ mainsnak: { datavalue: { value } } });
  return Response.json({ entities: {
    Q1: { id: 'Q1', claims: { P131: [claim({ id: 'Q10' })] } },
    Q2: { id: 'Q2', claims: { P625: [claim({ latitude: 25.592, longitude: 100.248, globe: 'http://www.wikidata.org/entity/Q2' })], P131: [claim({ id: 'Q1' })] } },
    Q3: { id: 'Q3', claims: { P625: [claim({ latitude: 39.9, longitude: 116.4, globe: 'http://www.wikidata.org/entity/Q2' })], P131: [claim({ id: 'Q20' })] } },
  } });
} });
const signal = new AbortController().signal;
const localMap = createPlannerMapService({ supplementalLookup: lookup, fetchImpl: async () => { throw new Error('本地包命中，不应联网'); } });
const result = await localMap({ places: [{ key: 'area', city: '昆明市', name: '翠湖—南屏街片区' }] }, signal);
assert.equal(result.positions[0].status, 'located');
assert.equal(result.positions[0].precision, 'area');
assert.equal(result.positions[0].source, 'Overture Places');
assert.equal(requests, 0);
const station = await lookup.wikidata({ city: '大理市' }, ['大理站'], signal);
assert.equal(station.length, 1, '过滤其他城市，并接受市/所属自治州同名城市');
assert.equal(station[0].source, 'Wikidata');
assert.equal(station[0].license, 'CC0-1.0');
const offlineMap = createPlannerMapService({ fetchImpl: async () => { throw new Error('已下载数据不应联网'); } });
const offline = await offlineMap({ places: [
  { key: 'station', city: '大理白族自治州', name: '大理站' },
  { key: 'dukezong', city: '香格里拉市', name: '独克宗古城' },
] }, signal);
assert.ok(offline.positions.every((position) => position.status === 'located'));
assert.equal(offline.positions[1].precision, 'area');
console.log('补充地点：名称清理、片区取点、附近用餐、本地包免联网及Wikidata城市核对通过');

// 天津回归：地点经街道→区→市隶属核对；意式风情区只有关联条目有坐标。
const claim = (value) => ({ mainsnak: { datavalue: { value } } });
const coordinate = (latitude, longitude) => claim({ latitude, longitude, globe: 'http://www.wikidata.org/entity/Q2' });
const tianjin = createSupplementalPlaceLookup({ localRecords: [], fetchImpl: async (address) => {
  const url = new URL(address), search = url.searchParams.get('search');
  if (url.hostname === 'zh.wikipedia.org') return Response.json({ query: { pages: { 99: {
    pageid: 99, title: '天津意式风情区', extract: '位于天津市河北区', pageprops: { wikibase_item: 'QItalian' },
    coordinates: [{ lat: 39.13, lon: 117.19, globe: 'earth' }],
  } } } });
  if (search) return Response.json({ search: search === '天津市' ? [{ id: 'QCity', match: { text: search } }]
    : search === '五大道' ? [{ id: 'QAvenues', match: { text: search } }]
    : search === '天津意式风情区' ? [{ id: 'QItalian', match: { text: search } }] : [] });
  const entities = {
    QCity: { id: 'QCity', claims: { P625: [coordinate(39.14, 117.2)] } },
    QAvenues: { claims: { P625: [coordinate(39.1095, 117.1967)], P131: [claim({ id: 'QStreet' })] } },
    QStreet: { claims: { P131: [claim({ id: 'QDistrict' })] } },
    QDistrict: { claims: { P131: [claim({ id: 'QCity' })] } },
    QItalian: { sitelinks: { zhwiki: { title: '天津意式风情区' } } },
  };
  return Response.json({ entities: Object.fromEntries(url.searchParams.get('ids').split('|').map((id) => [id, entities[id]])) });
} });
assert.equal((await tianjin.wikidata({ city: '天津市' }, ['五大道'], signal))[0].latitude, 39.1095);
const italian = await tianjin.wikidata({ city: '天津市' }, ['意式风情区'], signal);
assert.equal(italian.length, 1);
assert.equal(italian[0].source, 'Wikipedia');
assert.equal(italian[0].sourceUrl, 'https://zh.wikipedia.org/?curid=99');
assert.equal(italian[0].precision, 'area');
console.log('天津：城市前缀、街道/区县行政链和关联条目坐标回退通过');
