import { plannerPlaceFallbackCandidates, plannerPlaceSearchTarget } from '../src/planner-place-name.ts';
import { createSupplementalPlaceLookup } from './supplemental-places.mjs';
import { lookupCityBounds } from './china-city-bounds.mjs';

/** GCJ-02 转为底图使用的 WGS84。仅用于检索到的真实位置，绝不接收 AI 坐标。
 * 迭代求逆避免直接把两种坐标叠加导致国内地点偏移；结果是近似定位。
 */
export function gcj02ToWgs84(longitude, latitude) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) return [longitude, latitude];
  const forward = (lon, lat) => {
    const x = lon - 105, y = lat - 35, pi = Math.PI;
    let dy = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    let dx = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    dy += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    dx += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
    dy += (20 * Math.sin(y * pi) + 40 * Math.sin(y * pi / 3)) * 2 / 3;
    dx += (20 * Math.sin(x * pi) + 40 * Math.sin(x * pi / 3)) * 2 / 3;
    dy += (160 * Math.sin(y * pi / 12) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
    dx += (150 * Math.sin(x * pi / 12) + 300 * Math.sin(x * pi / 30)) * 2 / 3;
    const rad = lat / 180 * pi, magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2;
    return [lon + dx * 180 / (6378245 / Math.sqrt(magic) * Math.cos(rad) * pi), lat + dy * 180 / (6378245 * (1 - 0.006693421622965943) / (magic * Math.sqrt(magic)) * pi)];
  };
  let lon = longitude, lat = latitude;
  for (let iteration = 0; iteration < 5; iteration++) {
    const shifted = forward(lon, lat);
    lon -= shifted[0] - longitude;
    lat -= shifted[1] - latitude;
  }
  return [lon, lat];
}

const normalizeName = (value) => typeof value === 'string'
  ? value.normalize('NFKC').toLowerCase().replace(/[\s·・•()（）【】[\]「」『』\-—–]/g, '')
  : '';
const normalizeCity = (value) => normalizeName(value)
  .replace(/(?:特别行政区)$/, '')
  .replace(/(?:壮族|维吾尔|回族|藏族|蒙古族|朝鲜族|满族|彝族|白族|傣族|景颇族|傈僳族|哈尼族|苗族|瑶族|侗族|布依族|土家族|羌族|水族|仡佬族|拉祜族|佤族|纳西族|柯尔克孜|哈萨克|蒙古|回|藏)+自治(?:州|区|县)$/, '')
  .replace(/(?:自治州|自治区|地区|盟|林区|省|市)$/, '');

const scenicDescriptor = /(?:国家(?:aaaaa|5a|4a)级旅游景区|国家旅游度假区|国家森林公园|国家地质公园|国家湿地公园|风景名胜区|风景区|旅游度假区|旅游景区|旅游区|景区|民俗风貌区|历史文化街区|历史文化名街|文化休闲景区|文化街区|风光带|步行街|商业街|博物院|博物馆|纪念馆|美术馆|科技馆|展览馆|遗址公园|主题公园|森林公园|湿地公园|生态公园|公园|广场|观景平台|观景台|游客中心|售票处)$/;
const scenicSuffix = /(?:国家(?:aaaaa|5a|4a)级旅游景区|国家旅游度假区|国家森林公园|国家地质公园|国家湿地公园|风景名胜区|风景区|旅游度假区|旅游景区|旅游区|景区|民俗风貌区|历史文化街区|历史文化名街|文化休闲景区|文化街区|风光带|步行街|商业街|博物院|博物馆|纪念馆|美术馆|科技馆|展览馆|遗址公园|主题公园|森林公园|湿地公园|生态公园|公园|广场|观景平台|观景台|游客中心|售票处|古城|古镇|老街|故居|旧址|遗址)$/;
const SPECIFIC_QUALIFIER_RE = /[（(]([^）)]*(?:分店|店|校区|入口|出口|航站楼|院区|[东西南北]门|总店|旗舰店))[）)]$/;
const AUXILIARY_SUBFEATURE_RE = /(?:地下道|停车场|公厕|厕所|卫生间|售票处|售票口|检票口|游客中心|公交站|公交|地铁站|出入口|入口|出口|南门|北门|东门|西门)$/;
const BRANCH_STORE_RE = /[（(][^）)]*(?:分店|店|旗舰店|总店)[）)]$/;
const COMMERCIAL_ENTITY_RE = /(?:宾馆|酒店|旅馆|民宿|客栈|招待所|小区|公寓|家园|花园小区|社区|小学|中学|幼儿园|医院|诊所|药房|派出所|政府|居委会|银行|atm|停车场|公厕|厕所|便利店|超市|饭店|餐厅|酒楼|火锅|烧烤|茶馆|奶茶|咖啡)/;
const SCENIC_CLUSTER_RE = /(?:景区|风景区|旅游区|民俗风貌区|风光带|历史文化街区|文化街区|步行街|公园|古镇)$/;

const GENERIC_WORDS = new Set([
  '公园', '广场', '景区', '风景区', '古城', '古镇', '老街', '步行街', '商业街', '美食街', '夜市',
  '博物馆', '博物院', '纪念馆', '美术馆', '科技馆', '动物园', '植物园', '寺', '庙', '塔', '山', '湖',
  '酒店', '宾馆', '民宿', '餐厅', '饭店', '火锅', '咖啡', '市场', '车站', '火车站', '高铁站', '机场',
  '航站楼', '地铁站', '中心', '大厦', '大楼', '码头', '大桥', '东站', '西站', '南站', '北站',
  '东门', '西门', '南门', '北门', '观景台', '遗址', '故居', '纪念碑',
]);

const isMapCoordinate = (longitude, latitude) => Number.isFinite(longitude) && Math.abs(longitude) <= 180
  && Number.isFinite(latitude) && Math.abs(latitude) <= 85;

function distanceMeters(a, b) {
  const meanLat = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  const dx = (a.longitude - b.longitude) * 111000 * Math.cos(meanLat);
  const dy = (a.latitude - b.latitude) * 111000;
  return Math.hypot(dx, dy);
}

function stripPoiSuffixes(value, cityKey) {
  let current = value;
  for (let i = 0; i < 3; i++) {
    const next = current.replace(scenicSuffix, '');
    if (next === current || next.length < 2) break;
    if (cityKey && normalizeCity(next) === cityKey) break;
    current = next;
  }
  return current;
}

function bigramSimilarity(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (str) => {
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  let overlap = 0;
  for (const g of ga) if (gb.has(g)) overlap++;
  return (2 * overlap) / (ga.size + gb.size);
}

/** 整理检索词，同时保留原始名称供分店、校区和入口等具体地点核对。 */
function placeSearch(place) {
  const city = (place.city.split(/\s*(?:→|—|至(?=[^市]*市))\s*/)[0] || place.city).trim();
  const name = place.name.trim();
  const qualifierMatch = name.match(SPECIFIC_QUALIFIER_RE);
  const hasSpecificFacility = Boolean(qualifierMatch);
  const requiredQualifier = qualifierMatch ? normalizeName(qualifierMatch[1]) : '';
  const baseWithoutQualifier = qualifierMatch ? normalizeName(name.slice(0, qualifierMatch.index)) : '';
  const rawTarget = hasSpecificFacility ? { name, area: false } : plannerPlaceSearchTarget(name, city);
  const cityKey = normalizeCity(city);
  // 地铁换乘常把“天津西站”简写成“西站”，补上城市前缀可命中全国各城的东/西/南/北站。
  const expandedDirectionalStation = /^(?:东站|西站|南站|北站)$/.test(rawTarget.name) && cityKey
    ? `${cityKey}${rawTarget.name}` : '';
  const target = expandedDirectionalStation ? { ...rawTarget, name: expandedDirectionalStation } : rawTarget;
  const names = [...new Set((target.area ? [target.name] : [target.name, name]).filter(Boolean))];
  const shortenedRaw = target.name.replace(scenicSuffix, '');
  // 地铁站在 OSM 中常标为“鼓楼”“春熙路”（不带“站”字），保留去“站”短名供车站类 POI 匹配。
  const stationBaseRaw = /(?:地铁站|轻轨站|站)$/.test(target.name) && !/^(?:东站|西站|南站|北站)$/.test(target.name)
    ? target.name.replace(/(?:地铁站|轻轨站|站)$/, '') : '';
  // “大理古城”不能退化为“大理”，否则容易把景点标成整座城市的中心。
  const shortName = !shortenedRaw || shortenedRaw.length < 2 || normalizeCity(shortenedRaw) === cityKey || GENERIC_WORDS.has(normalizeName(shortenedRaw))
    ? (stationBaseRaw.length >= 2 && normalizeCity(stationBaseRaw) !== cityKey && !GENERIC_WORDS.has(normalizeName(stationBaseRaw)) ? stationBaseRaw : '')
    : shortenedRaw;
  const nameKey = (value) => {
    const normalized = normalizeName(value);
    if (!cityKey || !normalized.startsWith(cityKey)) return normalized;
    const withoutCity = normalized.slice(cityKey.length).replace(/^市/, '');
    // “昆明站”去掉城市后只剩通用的“站”，仍须按完整站名核对。
    return withoutCity.length >= 2 && !GENERIC_WORDS.has(withoutCity) ? withoutCity : normalized;
  };
  const exactNames = [...new Set(names.map(nameKey).filter(Boolean))];
  const coreTargets = [...new Set([
    ...exactNames.map((item) => {
      const stripped = stripPoiSuffixes(item, cityKey);
      if (stripped.length < 2 || normalizeCity(stripped) === cityKey || GENERIC_WORDS.has(stripped)) return '';
      return stripped;
    }),
    stationBaseRaw.length >= 2 && normalizeCity(stationBaseRaw) !== cityKey && !GENERIC_WORDS.has(normalizeName(stationBaseRaw))
      ? nameKey(stationBaseRaw) : '',
  ].filter(Boolean))];
  const targetWantsStation = /(?:站|地铁|轻轨|高铁|火车|机场|航站楼|码头)$/.test(target.name);
  const targetWantsAux = AUXILIARY_SUBFEATURE_RE.test(target.name);
  const targetWantsCommercial = COMMERCIAL_ENTITY_RE.test(name) || /(?:店|馆|堂|坊|斋|楼)$/.test(target.name);
  const isScenicZone = SCENIC_CLUSTER_RE.test(target.name) || /(?:路|道|大道|大街|河|江|湖|海)$/.test(target.name);
  return {
    city, target, names, shortName, cityKey, nameKey, exactNames, coreTargets,
    requiredQualifier, baseWithoutQualifier, targetWantsStation, targetWantsAux, targetWantsCommercial, isScenicZone,
  };
}

function poiQualityScore(meta = {}, search) {
  const cls = String(meta.class || meta.osm_key || '').toLowerCase();
  const type = String(meta.type || meta.osm_value || '').toLowerCase();
  if (['bus_stop', 'platform', 'stop_position', 'stop', 'tram_stop'].includes(type)) return search.targetWantsStation ? 0 : -18;
  if (['parking', 'toilets', 'atm', 'ticket', 'information', 'map', 'bench', 'gate', 'entrance'].includes(type)) return -12;
  if (!search.targetWantsCommercial && (
    (cls === 'tourism' && ['hotel', 'hostel', 'guest_house', 'motel'].includes(type))
    || (cls === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'bank', 'pharmacy', 'hospital', 'clinic', 'school'].includes(type))
    || cls === 'shop'
  )) return -26;
  if (cls === 'railway' && ['station', 'halt', 'subway_entrance'].includes(type)) return search.targetWantsStation ? 16 : -6;
  if (cls === 'aeroway' && ['aerodrome', 'terminal'].includes(type)) return 16;
  if (cls === 'tourism' && ['attraction', 'museum', 'viewpoint', 'theme_park', 'zoo', 'gallery', 'artwork'].includes(type)) return 15;
  if (cls === 'historic') return 14;
  if (cls === 'leisure' && ['park', 'garden', 'nature_reserve', 'square'].includes(type)) return 12;
  if (cls === 'amenity' && ['place_of_worship', 'theatre', 'arts_centre', 'university', 'marketplace'].includes(type)) return 10;
  if (cls === 'natural' || cls === 'waterway') return 10;
  if (cls === 'landuse' && ['retail', 'commercial', 'recreation_ground'].includes(type)) return 8;
  if (cls === 'highway' && ['pedestrian', 'footway', 'primary', 'secondary', 'tertiary', 'residential'].includes(type)) return 6;
  if (cls === 'bridge' || cls === 'man_made' && type === 'bridge') return 12;
  if (cls === 'boundary' && type === 'administrative') return -10;
  return 0;
}

/** 分级名称打分：兼容全称/简称/景区后缀差异，同时守住防串城、防退化为城市中心、防串分店三条底线。 */
function scoreRecordMatch(record, search, cityBounds = null) {
  const rawNames = (record.names ?? []).filter((v) => typeof v === 'string' && v.trim());
  if (!rawNames.length) return 0;
  const normalizedRaw = rawNames.map(normalizeName).filter(Boolean);
  const candKeys = rawNames.map(search.nameKey).filter(Boolean);

  // 1. 若用户明确指定分店/校区/入口/航站楼，则候选必须同时命中主体名和限定词。
  if (search.requiredQualifier) {
    const matched = normalizedRaw.some((cand) => cand.includes(search.requiredQualifier)
      && (!search.baseWithoutQualifier || cand.includes(search.baseWithoutQualifier)));
    return matched ? 100 + poiQualityScore(record.meta, search) : 0;
  }

  let bestNameScore = 0;
  for (let i = 0; i < candKeys.length; i++) {
    const candKey = candKeys[i];
    const candRaw = normalizedRaw[i] || candKey;
    if (!candKey) continue;
    // 禁止候选本身只是城市名（如“大理古城”不能匹配“大理”）。
    if (search.cityKey && normalizeCity(candRaw) === search.cityKey && !search.exactNames.includes(search.cityKey)) continue;

    // Tier 1：完整规范名直接命中
    if (search.exactNames.includes(candKey)) {
      bestNameScore = Math.max(bestNameScore, 100);
      continue;
    }

    const candCore = stripPoiSuffixes(candKey, search.cityKey);
    const candStrippedDesc = candKey.replace(scenicDescriptor, '');

    // Tier 2：去掉常见景区/博物院/街区后缀后完全一致（如“故宫”↔“故宫博物院”、“洪崖洞”↔“洪崖洞民俗风貌区”）
    for (const targetCore of search.coreTargets) {
      if (candCore === targetCore || candStrippedDesc === targetCore) {
        bestNameScore = Math.max(bestNameScore, 88);
      }
    }
    if (bestNameScore >= 88) continue;

    // Tier 3：包含匹配（兼顾全称 vs 简称，防止酒店/餐馆分店抢占景区地标）
    const rawCandidate = rawNames[i] || '';
    const isCommercialHijack = !search.targetWantsCommercial
      && (BRANCH_STORE_RE.test(rawCandidate) || COMMERCIAL_ENTITY_RE.test(candKey));
    const auxSubfeature = !search.targetWantsAux && AUXILIARY_SUBFEATURE_RE.test(candKey);
    const penalty = (isCommercialHijack ? 38 : 0) + (auxSubfeature ? 16 : 0);

    for (const target of [...search.exactNames, ...search.coreTargets]) {
      if (target.length < 2 || GENERIC_WORDS.has(target)) continue;
      if (search.cityKey && normalizeCity(target) === search.cityKey) continue;

      if (candKey.includes(target)) {
        const ratio = target.length / candKey.length;
        // 候选包含目标名（如目标“宽窄巷子”，候选“宽窄巷子历史文化区”或“洪崖洞民俗风貌区”）
        const score = Math.round((ratio >= 0.45 ? 76 : 68) - penalty);
        bestNameScore = Math.max(bestNameScore, score);
      } else if (candCore.length >= 2 && !GENERIC_WORDS.has(candCore)
        && !(search.cityKey && normalizeCity(candCore) === search.cityKey)
        && target.includes(candCore)) {
        // 目标包含候选核心名（如目标“橘子洲头”命中“橘子洲”，目标“夫子庙秦淮风光带”命中“夫子庙”）
        const ratio = candCore.length / target.length;
        if (ratio >= 0.35) {
          const score = Math.round((ratio >= 0.6 ? 74 : 66) - penalty);
          bestNameScore = Math.max(bestNameScore, score);
        }
      } else if (candCore.length >= 3 && target.length >= 3) {
        // 字符二元组高重叠（如“秦始皇兵马俑博物馆”↔“秦始皇帝陵博物院”）
        const sim = bigramSimilarity(candCore, target);
        if (sim >= 0.52) {
          const score = Math.round(62 + sim * 14 - penalty);
          bestNameScore = Math.max(bestNameScore, score);
        }
      }
    }
  }

  if (bestNameScore < 56) return 0;
  let score = bestNameScore + poiQualityScore(record.meta, search);
  // 非精确模糊匹配若距离主城区中心超过 35km，施加距离扣分，防止远郊同名公园/街道（如千岛湖“湖滨公园”）冒充市区景点。
  if (bestNameScore < 88 && cityBounds && Number.isFinite(record.position?.latitude) && Number.isFinite(record.position?.longitude)) {
    const distFromCenter = distanceMeters(
      { latitude: cityBounds.centerLat, longitude: cityBounds.centerLon },
      record.position,
    );
    if (distFromCenter > 60000) score -= 36;
    else if (distFromCenter > 35000) score -= 24;
  }
  return score;
}

/** 筛选、打分并按空间距离聚类合并同一景点的多个 OSM 子节点（大型景区/风光带 1500m，常规地标 600m）。 */
function matchingCandidates(records, search, cityBounds = null) {
  const scored = [];
  for (const record of records) {
    const score = scoreRecordMatch(record, search, cityBounds);
    if (score >= 56) scored.push({ score, meta: record.meta, position: record.position });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);

  const hasLandmarkMeta = scored.some((item) => {
    const cls = String(item.meta?.class || item.meta?.osm_key || '').toLowerCase();
    return ['tourism', 'historic', 'leisure', 'natural', 'amenity', 'highway', 'landuse'].includes(cls);
  });
  const clusterRadius = (search.isScenicZone || hasLandmarkMeta) ? 1500 : 600;

  // 同一个景点在 OSM 里常对应多个相邻节点（主点、门票口、地铁口等），同簇合并并保留得分最高的主地标。
  const clusters = [];
  for (const item of scored) {
    const existing = clusters.find((cluster) => distanceMeters(cluster.best.position, item.position) <= clusterRadius);
    if (existing) {
      existing.items.push(item);
      if (item.score > existing.best.score) existing.best = item;
    } else {
      clusters.push({ best: item, items: [item] });
    }
  }
  clusters.sort((a, b) => b.best.score - a.best.score);

  const topScore = clusters[0].best.score;
  // 若最优簇得分明显领先其他簇（例如精确地标命中 vs 远处的弱关联点），直接收敛到最优簇。
  const finalists = clusters.filter((cluster) => topScore - cluster.best.score < 15);
  return finalists.map((cluster) => cluster.best.position);
}

/** 轻量熔断器：连续网络/超时/5xx/429 失败达到阈值后短时跳过该源，防止后续地点反复死等。 */
function createBreaker(threshold = 2, cooldownMs = 180000) {
  let failures = 0;
  let openUntil = 0;
  return {
    isOpen: () => Date.now() < openUntil,
    recordSuccess() { failures = 0; },
    recordFailure() {
      failures++;
      if (failures >= threshold) openUntil = Date.now() + cooldownMs;
    },
  };
}

/** 高德凭据仅留服务端；零 Key 场景以本地行政边界 + Photon/Nominatim 主力 + 百科/Overpass 补充实现全国快速定位。 */
export function createPlannerMapService({
  apiKey = '',
  fetchImpl = fetch,
  tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  photonUrl = 'https://photon.komoot.io/api/',
  nominatimUrl = 'https://nominatim.openstreetmap.org/search',
  overpassUrl = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  overpassFallbackUrl = 'https://overpass-api.de/api/interpreter',
  supplementalLookup,
} = {}) {
  const cache = new Map();
  const supplemental = supplementalLookup ?? createSupplementalPlaceLookup({ fetchImpl });
  const photonBreaker = createBreaker();
  const nominatimBreaker = createBreaker();
  const overpassBreaker = createBreaker();

  // 公共服务按源独立限速，避免无谓串行长等。
  let queue = Promise.resolve();
  let lastPhotonQuery = 0;
  let lastNominatimQuery = 0;

  function matchesTargetCity(longitude, latitude, textFields, cityKey, cityBounds) {
    if (!isMapCoordinate(longitude, latitude)) return false;
    // 优先使用本地 34 省 370+ 城市地理范围核验：既能彻底防止跨城误标，又能兼容英文城市名、直辖市区县名（如重庆渝中区）和缺失 city 字段的节点。
    if (cityBounds) return cityBounds.contains(longitude, latitude);
    return Boolean(cityKey && textFields.some((value) => normalizeCity(value) === cityKey));
  }

  async function queryPhoton(place, search, cityBounds, signal) {
    if (!photonUrl || photonBreaker.isOpen()) return [];
    const { city, cityKey, names, shortName, target } = search;
    const cleanName = target.name || names[0];
    if (!cleanName) return [];
    const queries = [...new Set([
      `${city} ${cleanName}`,
      cleanName,
      ...(names[0] !== cleanName ? [`${city} ${names[0]}`] : []),
      ...(shortName.length >= 2 && shortName !== cleanName ? [shortName, `${city} ${shortName}`] : []),
    ])];

    for (const query of queries) {
      if (photonBreaker.isOpen()) break;
      const wait = Math.max(0, 350 - (Date.now() - lastPhotonQuery));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lastPhotonQuery = Date.now();
      try {
        const url = new URL(photonUrl);
        const params = new URLSearchParams({ q: query, limit: '15' });
        if (cityBounds) {
          const { minLon, minLat, maxLon, maxLat } = cityBounds.padded;
          params.set('bbox', `${minLon.toFixed(4)},${minLat.toFixed(4)},${maxLon.toFixed(4)},${maxLat.toFixed(4)}`);
          params.set('lat', cityBounds.centerLat.toFixed(4));
          params.set('lon', cityBounds.centerLon.toFixed(4));
        }
        url.search = params.toString();
        const response = await fetchImpl(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
          headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary place lookup)', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
        if (response.status === 429 || response.status >= 500) {
          photonBreaker.recordFailure();
          break;
        }
        if (!response.ok) break;
        photonBreaker.recordSuccess();
        const data = await response.json();
        const records = (data.features ?? []).flatMap((feature) => {
          const props = feature.properties ?? {};
          const [longitude, latitude] = feature.geometry?.coordinates ?? [];
          const cities = [props.city, props.county, props.district, props.state];
          if (!matchesTargetCity(longitude, latitude, cities, cityKey, cityBounds)) return [];
          const candidateNames = [props.name, props['name:zh'], props['name:zh-Hans'], props.alt_name, props.old_name]
            .flatMap((value) => typeof value === 'string' ? value.split(';') : []);
          return [{
            names: candidateNames,
            meta: { osm_key: props.osm_key, osm_value: props.osm_value },
            position: {
              latitude,
              longitude,
              source: 'OpenStreetMap / Photon',
              label: [props.name, props.city || city, props.street, props.housenumber].filter(Boolean).join(' · '),
            },
          }];
        });
        const matched = matchingCandidates(records, search, cityBounds);
        if (matched.length) return matched;
      } catch (error) {
        if (signal.aborted) throw error;
        photonBreaker.recordFailure();
        break;
      }
    }
    return [];
  }

  async function queryNominatim(place, search, cityBounds, signal) {
    if (!nominatimUrl || nominatimBreaker.isOpen()) return [];
    const { city, cityKey, names, shortName, target } = search;
    const cleanName = target.name || names[0];
    if (!cleanName) return [];
    const queries = [...new Set([
      cityBounds ? cleanName : `${city} ${cleanName}`,
      `${city} ${cleanName}`,
      ...(shortName.length >= 2 && shortName !== cleanName ? [cityBounds ? shortName : `${city} ${shortName}`] : []),
    ])];

    for (const query of queries) {
      if (nominatimBreaker.isOpen()) break;
      const wait = Math.max(0, 1050 - (Date.now() - lastNominatimQuery));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lastNominatimQuery = Date.now();
      try {
        const url = new URL(nominatimUrl);
        const params = new URLSearchParams({
          format: 'jsonv2',
          addressdetails: '1',
          namedetails: '1',
          countrycodes: 'cn',
          limit: '10',
          q: query,
        });
        if (cityBounds) {
          const { minLon, minLat, maxLon, maxLat } = cityBounds.padded;
          params.set('viewbox', `${minLon.toFixed(4)},${maxLat.toFixed(4)},${maxLon.toFixed(4)},${minLat.toFixed(4)}`);
          params.set('bounded', '1');
        }
        url.search = params.toString();
        const response = await fetchImpl(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(7500)]),
          headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary place lookup)', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
        if (response.status === 429 || response.status >= 500) {
          nominatimBreaker.recordFailure();
          break;
        }
        if (!response.ok) break;
        const data = await response.json();
        if (!Array.isArray(data)) break;
        nominatimBreaker.recordSuccess();
        const records = data.flatMap((item) => {
          const latitude = Number(item.lat), longitude = Number(item.lon);
          const addr = item.address ?? {};
          const cities = [addr.city, addr.town, addr.county, addr.state_district, addr.municipality, addr.state];
          if (!matchesTargetCity(longitude, latitude, cities, cityKey, cityBounds)) return [];
          const nd = item.namedetails ?? {};
          const candidateNames = [item.name, nd['name:zh'], nd['name:zh-Hans'], nd.name, nd.alt_name, nd.short_name, nd.old_name]
            .flatMap((value) => typeof value === 'string' ? value.split(';') : []);
          return [{
            names: candidateNames,
            meta: { class: item.class, type: item.type },
            position: {
              latitude,
              longitude,
              source: 'OpenStreetMap / Nominatim',
              label: [item.name || nd['name:zh'] || cleanName, addr.city || addr.county || city, addr.road].filter(Boolean).join(' · '),
            },
          }];
        });
        const matched = matchingCandidates(records, search, cityBounds);
        if (matched.length) return matched;
      } catch (error) {
        if (signal.aborted) throw error;
        nominatimBreaker.recordFailure();
        break;
      }
    }
    return [];
  }

  async function queryOverpass(place, search, cityBounds, signal) {
    const endpoints = [...new Set([overpassUrl, overpassFallbackUrl].filter(Boolean))];
    if (!endpoints.length || overpassBreaker.isOpen()) return [];
    const { city, cityKey, names, shortName, target } = search;
    const cleanName = target.name || names[0];
    const namesToTry = [...new Set([...names, shortName].filter((name) => name?.length >= 2))];
    if (!namesToTry.length) return [];
    const quote = (value) => JSON.stringify(value);
    const escapedNames = namesToTry.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const escapedCity = (cityKey || city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 有本地城市地理框时用数值 bbox 索引查询，速度比 area 扫描快一个量级；无边界时修正为兼容“市/自治州/区”的行政区正则。
    const queryBody = cityBounds
      ? `[out:json][timeout:8];nwr(${cityBounds.padded.minLat.toFixed(4)},${cityBounds.padded.minLon.toFixed(4)},${cityBounds.padded.maxLat.toFixed(4)},${cityBounds.padded.maxLon.toFixed(4)})["name"~${quote(`^(${escapedNames})$`)}];out center tags 12;`
      : `[out:json][timeout:10];area["boundary"="administrative"]["name"~${quote(`^${escapedCity}(?:市|区|县|.*自治州)?$`)}]->.city;nwr(area.city)["name"~${quote(`^(${escapedNames})$`)}];out center tags 12;`;

    for (const endpoint of endpoints) {
      if (overpassBreaker.isOpen()) break;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TravelFootprints/1.0' },
          body: new URLSearchParams({ data: queryBody }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        });
        if (response.status === 429 || response.status >= 500) {
          overpassBreaker.recordFailure();
          continue;
        }
        if (!response.ok) continue;
        const text = await response.text();
        if (!text.trim().startsWith('{')) {
          overpassBreaker.recordFailure();
          continue;
        }
        const payload = JSON.parse(text);
        overpassBreaker.recordSuccess();
        const records = (payload.elements ?? []).flatMap((item) => {
          const latitude = item.lat ?? item.center?.lat, longitude = item.lon ?? item.center?.lon;
          if (!isMapCoordinate(longitude, latitude)) return [];
          const tags = item.tags ?? {};
          const candidateNames = [tags.name, tags['name:zh'], tags.alt_name, tags.short_name]
            .flatMap((v) => typeof v === 'string' ? v.split(';') : []);
          const cls = tags.tourism ? 'tourism' : tags.historic ? 'historic' : tags.leisure ? 'leisure' : tags.amenity ? 'amenity' : tags.railway ? 'railway' : '';
          const type = tags.tourism || tags.historic || tags.leisure || tags.amenity || tags.railway || '';
          return [{
            names: candidateNames.length ? candidateNames : [cleanName],
            meta: { class: cls, type },
            position: {
              latitude,
              longitude,
              label: `${tags.name || cleanName} · ${city}`,
              source: 'OpenStreetMap / Overpass',
            },
          }];
        });
        const matched = matchingCandidates(records, search, cityBounds);
        if (matched.length) return matched;
        return [];
      } catch (error) {
        if (signal.aborted) throw error;
        overpassBreaker.recordFailure();
      }
    }
    return [];
  }

  async function searchSingleTarget(scopedPlace, targetSearch, cityBounds, signal, fastOnly = false) {
    const { names, shortName, target } = targetSearch;
    const namesToTry = [...new Set([...names, shortName].filter((name) => name?.length >= 2))];
    if (!namesToTry.length) return [];

    // 1. 本地离线数据包（0ms）
    let candidates = await supplemental.local(scopedPlace, namesToTry);
    if (candidates.length) return candidates;

    // 2. 主力开源检索 A：Photon（带本地城市 bbox 与中心点偏置，模糊分词极快）
    candidates = await queryPhoton(scopedPlace, targetSearch, cityBounds, signal);
    if (candidates.length) return candidates;

    // 3. 主力开源检索 B：OpenStreetMap Nominatim（带 viewbox 强限定 + 多别名 namedetails，结构化召回最全）
    candidates = await queryNominatim(scopedPlace, targetSearch, cityBounds, signal);
    if (candidates.length) return candidates;

    // 4. 开源补充 A：中文维基百科单请求直查（覆盖知名地标、古迹、山川、博物馆、车站）
    if (typeof supplemental.wikipedia === 'function') {
      try {
        const wikiRecords = await supplemental.wikipedia(scopedPlace, namesToTry, signal, cityBounds);
        candidates = matchingCandidates(wikiRecords, targetSearch, cityBounds);
        if (candidates.length) return candidates;
      } catch (error) { if (signal.aborted) throw error; }
    }

    if (fastOnly) return [];

    // 5. 开源补充 B：Wikidata 实体库（已支持本地地理边界快速校验）
    try {
      candidates.push(...await supplemental.wikidata(scopedPlace, namesToTry, signal, cityBounds));
      if (candidates.length) return candidates;
    } catch (error) { if (signal.aborted) throw error; }

    // 6. 开源兜底：Overpass（bbox 索引直查 + 熔断保护）
    if (overpassUrl && !target.area) {
      candidates = await queryOverpass(scopedPlace, targetSearch, cityBounds, signal);
    }
    return candidates;
  }

  async function openLookup(place, search, signal) {
    const operation = queue.then(async () => {
      signal.throwIfAborted();
      const { city, names, target } = search;
      const cleanName = target.name || names[0];
      const scopedPlace = { ...place, city };
      const cityBounds = await lookupCityBounds(city, place.cityCode).catch(() => null);

      let matchedAsArea = target.area;
      const fallbacks = !search.requiredQualifier ? plannerPlaceFallbackCandidates(place.name, city).slice(0, 4) : [];
      // 若原始名称包含长地址/路口/多地标组合，先快速查原名再立即走拆解子地标，避免在长句上浪费 Wikidata/Overpass 等待。
      let candidates = await searchSingleTarget(scopedPlace, search, cityBounds, signal, fallbacks.length > 0);

      // 完整长描述（如路口地址、多地标并列、子建筑名）未直接命中时，按通用中文地名结构拆解后降级检索。
      if (!candidates.length && fallbacks.length > 0) {
        for (const fallback of fallbacks) {
          signal.throwIfAborted();
          const subSearch = placeSearch({ ...scopedPlace, name: fallback.name });
          const subCandidates = await searchSingleTarget(scopedPlace, subSearch, cityBounds, signal, true);
          if (subCandidates.length) {
            candidates = subCandidates;
            matchedAsArea = matchedAsArea || fallback.area;
            break;
          }
        }
      }
      // 若快速拆解也未命中，仍补走主目标的 Wikidata / Overpass 兜底。
      if (!candidates.length && fallbacks.length > 0) {
        const namesToTry = [...new Set([...search.names, search.shortName].filter((name) => name?.length >= 2))];
        if (namesToTry.length) {
          try { candidates.push(...await supplemental.wikidata(scopedPlace, namesToTry, signal, cityBounds)); }
          catch (error) { if (signal.aborted) throw error; }
        }
        if (!candidates.length && overpassUrl && !target.area) {
          candidates = await queryOverpass(scopedPlace, search, cityBounds, signal);
        }
      }

      const unique = [...new Map(candidates.map((item) => [`${item.longitude},${item.latitude}`, item])).values()];
      if (matchedAsArea && unique.length > 1) {
        // 同一街区/道路/河段可能对应多个分段点。需要片区参考时，近距离取几何中心，跨城长河/大型景区优先取主地标参考点。
        const latitudes = unique.map((item) => item.latitude), longitudes = unique.map((item) => item.longitude);
        const height = (Math.max(...latitudes) - Math.min(...latitudes)) * 111000;
        const width = (Math.max(...longitudes) - Math.min(...longitudes)) * 111000 * Math.cos(latitudes[0] * Math.PI / 180);
        if (Math.hypot(height, width) <= 6000) return {
          key: place.key, status: 'located',
          latitude: latitudes.reduce((total, value) => total + value, 0) / unique.length,
          longitude: longitudes.reduce((total, value) => total + value, 0) / unique.length,
          label: `${cleanName} · ${city}`, source: unique[0].source, precision: 'area', coordinateSystem: 'WGS84',
        };
        return {
          key: place.key, status: 'located', ...unique[0],
          precision: 'area', coordinateSystem: 'WGS84',
        };
      }
      if (unique.length === 1) return {
        key: place.key, status: 'located', ...unique[0],
        precision: matchedAsArea || unique[0].precision === 'area' ? 'area' : 'place',
        coordinateSystem: 'WGS84',
      };
      return {
        key: place.key, status: 'unresolved',
        reason: unique.length ? '存在多个匹配位置，请选择或在地图上标点' : '未找到准确匹配，请在地图上标点',
        candidates: unique,
      };
    });
    queue = operation.catch(() => {});
    return operation;
  }

  async function amapLookup(place, search, signal) {
    const cityCode = /^\d{6}$/.test(place.cityCode) ? place.cityCode : '';
    // 直辖市的总行政代码按省级前缀核对，其他城市按地级前缀核对。
    const codePrefix = cityCode.slice(0, /^(11|12|31|50)0000$/.test(cityCode) ? 2 : 4);
    for (const name of search.names) {
      const url = new URL('https://restapi.amap.com/v3/place/text');
      url.search = new URLSearchParams({
        key: apiKey, keywords: name, city: cityCode || search.city,
        citylimit: 'true', offset: '15', extensions: 'base',
      }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) return [];
      const data = await response.json();
      if (data.status !== '1') return [];
      const records = (data.pois ?? []).flatMap((poi) => {
        const adcode = String(poi.adcode ?? '');
        const cityMatches = codePrefix && /^\d{6}$/.test(adcode)
          ? adcode.startsWith(codePrefix)
          : search.cityKey && [poi.cityname, poi.adname, poi.pname].some((city) => normalizeCity(city) === search.cityKey);
        if (!cityMatches || typeof poi.location !== 'string' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(poi.location)) return [];
        const [lon, lat] = poi.location.split(',').map(Number);
        if (!isMapCoordinate(lon, lat)) return [];
        const [longitude, latitude] = gcj02ToWgs84(lon, lat);
        return [{
          names: [poi.name],
          position: {
            longitude, latitude, amapLocation: poi.location, source: '高德地点检索',
            precision: search.target.area ? 'area' : 'place',
            label: [poi.name, poi.adname, typeof poi.address === 'string' ? poi.address : ''].filter(Boolean).join(' · '),
          },
        }];
      });
      const candidates = matchingCandidates(records, search);
      if (candidates.length) return [...new Map(candidates.map((item) => [item.amapLocation, item])).values()];
    }
    return [];
  }

  const unresolved = (key, reason) => ({ key, status: 'unresolved', reason });
  return async function locatePlaces(body, signal, progress = () => {}) {
    if (!Array.isArray(body.places) || body.places.length > 150) throw new Error('地图地点列表无效或过长');
    const results = [];
    for (const place of body.places) {
      signal.throwIfAborted();
      if (!place || !['key', 'name', 'city'].every((key) => typeof place[key] === 'string' && place[key].trim() && place[key].length <= 200)) throw new Error('地图地点信息无效');
      if (/^(?:早餐|午餐|晚餐|用餐|休息|自由活动|市内交通|打车|乘车)$/.test(place.name.trim())) {
        results.push(unresolved(place.key, '尚未指定具体地点，位置待确认'));
        continue;
      }
      const cacheKey = JSON.stringify([place.city, place.name, place.cityCode]);
      const cached = cache.get(cacheKey);
      if (cached && cached.expires > Date.now() && (!body.retry || cached.value.status === 'located')) { results.push({ ...cached.value, key: place.key }); continue; }
      progress(`正在定位：${place.city} ${place.name}`);
      try {
        const search = placeSearch(place);
        let candidates = [];
        if (apiKey) {
          try { candidates = await amapLookup(place, search, signal); }
          catch (error) { if (signal.aborted) throw error; }
        }
        let value;
        if (candidates.length === 1) {
          value = {
            key: place.key, status: 'located', ...candidates[0],
            coordinateSystem: 'WGS84（由 GCJ-02 近似转换）',
          };
        } else if (candidates.length > 1) {
          // 同名分店或入口交给用户确认，避免换源后把仍有歧义的地点直接画上地图。
          value = { ...unresolved(place.key, '同城存在多个匹配位置，请选择或在地图上标点'), candidates };
        } else {
          value = await openLookup(place, search, signal);
        }
        if (cache.size >= 1000) cache.delete(cache.keys().next().value);
        // 未查到的结果短期复用，公共服务暂时故障时可以较快恢复查询。
        cache.set(cacheKey, { value, expires: Date.now() + (value.status === 'located' ? 86400000 : 300000) });
        results.push(value);
      } catch (error) {
        if (signal.aborted) throw error;
        results.push(unresolved(place.key, '地点检索失败，请重试或在高德地图中核对'));
      }
    }
    return {
      positions: results, tileUrl, notice: results.some((item) => item.amapLocation)
        ? '高德地点坐标已近似转换为底图坐标。' : '',
    };
  };
}
