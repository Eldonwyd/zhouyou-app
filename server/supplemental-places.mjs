import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAppPath } from './runtime-paths.mjs';
const normalize = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s·・•（）()【】[\]「」『』]/g, '')
  .replace(/市$/, '');
const normalizeCity = (value) => normalize(value)
  .replace(/(?:特别行政区)$/, '')
  .replace(/(?:壮族|维吾尔|回族|藏族|蒙古族|朝鲜族|满族|彝族|白族|傣族|景颇族|傈僳族|哈尼族|苗族|瑶族|侗族|布依族|土家族|羌族|水族|仡佬族|拉祜族|佤族|纳西族|柯尔克孜|哈萨克|蒙古|回|藏)+自治(?:州|区|县)$/, '')
  .replace(/(?:自治州|自治区|地区|盟|林区|省)$/, '');
const COMMON_SUFFIX_RE = /(?:国家(?:aaaaa|5a|4a)级旅游景区|国家旅游度假区|国家森林公园|国家地质公园|国家湿地公园|风景名胜区|风景区|旅游度假区|旅游景区|旅游区|景区|民俗风貌区|历史文化街区|历史文化名街|文化休闲景区|文化街区|风光带|步行街|商业街|博物院|博物馆|纪念馆|美术馆|科技馆|展览馆|遗址公园|主题公园|森林公园|湿地公园|生态公园|公园|广场|观景平台|观景台|游客中心|古城|古镇|老街|故居|旧址|遗址)$/;

// 多地点共用低频队列与熔断状态；遇到服务端限流或网络不可达时暂停一段时间，避免死等卡顿。
let wikidataQueue = Promise.resolve();
let lastWikidataRequest = 0;
let wikidataPausedUntil = 0;
let wikidataFailures = 0;

let wikipediaQueue = Promise.resolve();
let lastWikipediaRequest = 0;
let wikipediaPausedUntil = 0;
let wikipediaFailures = 0;

function stripSuffix(value) {
  let result = value;
  for (let i = 0; i < 2; i++) {
    const next = result.replace(COMMON_SUFFIX_RE, '');
    if (next === result || next.length < 2) break;
    result = next;
  }
  return result;
}

function localNameMatches(recordName, expectedName, cityKey) {
  const stripCity = (v) => {
    const n = normalize(v);
    if (!cityKey || !n.startsWith(cityKey)) return n;
    const rest = n.slice(cityKey.length);
    return rest.length >= 2 ? rest : n;
  };
  const a = stripCity(recordName);
  const b = stripCity(expectedName);
  if (!a || !b) return false;
  if (a === b) return true;
  const aCore = stripSuffix(a);
  const bCore = stripSuffix(b);
  if (aCore.length >= 2 && bCore.length >= 2 && aCore !== cityKey && bCore !== cityKey && aCore === bCore) return true;
  return false;
}

/** 按来源保留本地数据包元信息。无需用户申请Key，也不依赖在线公共查询额度。 */
export async function readLocalPlacePacks(directory = getAppPath('data', 'places')) {
  const files = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = [];
  for (const filename of files.filter((name) => name.endsWith('.json'))) {
    const pack = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    for (const record of pack.records ?? []) {
      // 不导入缺少来源、许可或坐标系的记录，防止来源未知的坐标混进发布包。
      if (record.name && record.city && record.source && record.license && record.coordinateSystem === 'WGS84'
        && Number.isFinite(record.longitude) && Math.abs(record.longitude) <= 180
        && Number.isFinite(record.latitude) && Math.abs(record.latitude) <= 85) records.push(record);
    }
  }
  return records;
}

/** 先查可离线分发的本地数据包，再从中文维基百科与 Wikidata 补查具有真实坐标的条目。
 * 结合本地城市边界框做地理核验，减少多跳请求并避免跨城误标。
 */
export function createSupplementalPlaceLookup({
  fetchImpl = fetch,
  localRecords,
  dataDirectory,
  wikidataUrl = 'https://www.wikidata.org/w/api.php',
  wikipediaUrl = 'https://zh.wikipedia.org/w/api.php',
} = {}) {
  let recordPromise;
  const cities = new Map();

  async function local(place, names) {
    recordPromise ??= localRecords ? Promise.resolve(localRecords) : readLocalPlacePacks(dataDirectory);
    const cityKey = normalizeCity(place.city);
    return (await recordPromise).filter((record) => normalizeCity(record.city) === cityKey
      && [record.name, ...(record.aliases ?? [])].some((name) => names.some((expected) => localNameMatches(name, expected, cityKey))))
      .map((record) => ({
        latitude: record.latitude,
        longitude: record.longitude,
        label: `${record.name} · ${record.city}`,
        source: record.source,
        sourceUrl: record.sourceUrl,
        license: record.license,
        precision: record.precision,
      }));
  }

  /** 单次请求直查中文维基百科带坐标条目（约 800ms），配合城市地理范围过滤，覆盖全国地标/古迹/车站/景区。 */
  async function wikipedia(place, names, signal, cityBounds = null) {
    if (!wikipediaUrl || !names?.length) return [];
    if (Date.now() < wikipediaPausedUntil) return [];
    const cityKey = normalizeCity(place.city);
    const searchQuery = cityKey && !names[0].includes(cityKey) ? `${cityKey} ${names[0]}` : names[0];
    const operation = wikipediaQueue.then(async () => {
      if (Date.now() < wikipediaPausedUntil) return [];
      const wait = Math.max(0, 450 - (Date.now() - lastWikipediaRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lastWikipediaRequest = Date.now();
      const url = new URL(wikipediaUrl);
      url.search = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: searchQuery,
        gsrlimit: '6',
        prop: 'coordinates|extracts',
        coprimary: 'primary',
        exintro: '1',
        explaintext: '1',
        exchars: '350',
        format: 'json',
      }).toString();
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
          headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary coordinate lookup)' },
        });
        if (response.status === 429 || response.status >= 500) {
          wikipediaFailures++;
          if (wikipediaFailures >= 2) wikipediaPausedUntil = Date.now() + 180000;
          return [];
        }
        if (!response.ok) return [];
        wikipediaFailures = 0;
        const payload = await response.json();
        const pages = Object.values(payload.query?.pages ?? {});
        const results = [];
        for (const page of pages) {
          const coord = page.coordinates?.find((item) => item.globe === 'earth'
            && Number.isFinite(item.lat) && Number.isFinite(item.lon)
            && Math.abs(item.lat) <= 85 && Math.abs(item.lon) <= 180);
          if (!coord) continue;
          const inBounds = cityBounds ? cityBounds.contains(coord.lon, coord.lat)
            : `${page.title || ''} ${page.extract || ''}`.includes(cityKey);
          if (!inBounds) continue;
          results.push({
            names: [page.title].filter(Boolean),
            meta: { class: 'tourism', type: 'attraction' },
            position: {
              latitude: coord.lat,
              longitude: coord.lon,
              label: `${page.title} · ${place.city}`,
              source: 'Wikipedia',
              sourceUrl: `https://zh.wikipedia.org/?curid=${page.pageid}`,
              license: 'CC-BY-SA-4.0',
            },
          });
        }
        return results;
      } catch (error) {
        if (signal.aborted) throw error;
        wikipediaFailures++;
        if (wikipediaFailures >= 2) wikipediaPausedUntil = Date.now() + 180000;
        return [];
      }
    });
    wikipediaQueue = operation.catch(() => {});
    return operation;
  }

  async function wikidata(place, names, signal, cityBounds = null) {
    if (!wikidataUrl) return [];
    if (Date.now() < wikidataPausedUntil) return [];
    async function api(parameters) {
      const request = wikidataQueue.then(async () => {
        if (Date.now() < wikidataPausedUntil) throw new Error('Wikidata暂时限流，已保存位置仍可使用');
        const wait = Math.max(0, 900 - (Date.now() - lastWikidataRequest));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        signal.throwIfAborted();
        lastWikidataRequest = Date.now();
        const url = new URL(wikidataUrl);
        url.search = new URLSearchParams({ ...parameters, format: 'json' }).toString();
        try {
          const response = await fetchImpl(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary coordinate lookup)' },
          });
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const seconds = Number(retryAfter);
            const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
              : Math.max(60000, Date.parse(retryAfter || '') - Date.now() || 0);
            wikidataPausedUntil = Date.now() + delay;
          }
          if (!response.ok) {
            if (response.status >= 500) {
              wikidataFailures++;
              if (wikidataFailures >= 2) wikidataPausedUntil = Date.now() + 180000;
            }
            throw new Error(`Wikidata查询失败（${response.status}）`);
          }
          wikidataFailures = 0;
          return response.json();
        } catch (error) {
          if (signal.aborted) throw error;
          wikidataFailures++;
          if (wikidataFailures >= 2) wikidataPausedUntil = Date.now() + 180000;
          throw error;
        }
      });
      wikidataQueue = request.catch(() => {});
      return request;
    }
    const search = (name) => api({ action: 'wbsearchentities', search: name, language: 'zh', uselang: 'zh', limit: '5' });
    const entities = async (ids) => (await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims|sitelinks', sitefilter: 'zhwiki', languages: 'zh|zh-hans|en' })).entities || {};
    const values = (entity, property) => (entity?.claims?.[property] ?? []).filter((claim) => claim.rank !== 'deprecated')
      .map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean);
    const point = (entity) => values(entity, 'P625').find((value) => value.globe?.endsWith('/Q2')
      && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 85 && Math.abs(value.longitude) <= 180);

    const cityKey = normalizeCity(place.city);
    // 数据源可能使用“天津意式风情区”，行程只写“意式风情区”。
    // 仅去掉本次查询城市的前缀；仍需独立核对行政隶属或地理范围，不能接受异城同名点。
    const normalizePlace = (value) => normalize(value).replace(new RegExp(`^${cityKey}(?:市)?`), '');
    const placeNameLooseMatch = (expected, actual) => {
      const a = normalizePlace(expected), b = normalizePlace(actual);
      if (!a || !b) return false;
      if (a === b) return true;
      const aCore = stripSuffix(a), bCore = stripSuffix(b);
      if (aCore.length >= 2 && bCore.length >= 2 && aCore !== cityKey && bCore !== cityKey) {
        if (aCore === bCore) return true;
        if ((aCore.includes(bCore) || bCore.includes(aCore)) && Math.min(aCore.length, bCore.length) / Math.max(aCore.length, bCore.length) >= 0.5) return true;
      }
      return false;
    };

    const found = [];
    const searchNames = [...new Set([...names.slice(0, 2), `${cityKey}${names[0]}`])];
    for (const name of searchNames) {
      const hits = (await search(name)).search ?? [];
      found.push(...hits.filter((item) => names.some((expected) =>
        placeNameLooseMatch(expected, item.match?.text || item.label)
        || (item.label && placeNameLooseMatch(expected, item.label)))));
      if (found.length) break;
    }
    const ids = [...new Set(found.map((item) => item.id))];
    if (!ids.length) return [];
    const details = await entities(ids);

    // 优先使用本地城市地理范围快速校验；若无本地边界框（或需要百科回退），再走行政链。
    let city = cities.get(cityKey);
    const needsCityEntity = !cityBounds || ids.some((id) => !point(details[id]));
    if (needsCityEntity && !city) {
      const matches = (await search(`${cityKey}市`)).search ?? [];
      const hit = matches.find((item) => normalizeCity(item.match?.text || item.label) === cityKey);
      if (hit) {
        city = (await entities([hit.id]))[hit.id];
        if (city) cities.set(cityKey, city);
      }
    }

    const ancestry = { ...details };
    if (!cityBounds && city) {
      let frontier = ids;
      for (let depth = 0; depth < 3; depth++) {
        const parentIds = [...new Set(frontier.flatMap((id) => values(ancestry[id], 'P131').map((value) => value.id)))]
          .filter((id) => id && id !== city.id && !ancestry[id]);
        if (!parentIds.length) break;
        Object.assign(ancestry, await entities(parentIds));
        frontier = parentIds;
      }
    }
    const belongsToCity = (entity, visited = new Set()) => Boolean(city) && values(entity, 'P131').some(({ id }) => {
      if (id === city.id) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return ancestry[id] ? belongsToCity(ancestry[id], visited) : false;
    });
    const center = city ? point(city) : null;
    const cityParents = city ? values(city, 'P131').map((value) => value.id) : [];
    const matches = [];
    for (const id of ids) {
      const entity = details[id];
      let coordinate = point(entity);
      let articleSource;
      // 部分真实景点的实体尚未录入 P625，但关联中文条目已提供坐标。
      if (!coordinate && entity?.sitelinks?.zhwiki?.title) {
        const title = entity.sitelinks.zhwiki.title;
        const url = new URL(wikipediaUrl);
        url.search = new URLSearchParams({
          action: 'query', titles: title, prop: 'coordinates|pageprops|extracts',
          coprimary: 'primary', exintro: '1', explaintext: '1', exchars: '1200', format: 'json',
        }).toString();
        try {
          const response = await fetchImpl(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary coordinate lookup)' },
          });
          const pages = response.ok ? Object.values((await response.json()).query?.pages ?? {}) : [];
          const article = pages.find((page) => page.pageprops?.wikibase_item === id);
          const location = article?.coordinates?.find((item) => item.globe === 'earth'
            && Number.isFinite(item.lat) && Number.isFinite(item.lon));
          if (location && Math.abs(location.lat) <= 85 && Math.abs(location.lon) <= 180) {
            const withinBounds = cityBounds ? cityBounds.contains(location.lon, location.lat)
              : Boolean(center && `${article.title} ${article.extract}`.includes(cityKey)
                && Math.hypot((location.lat - center.latitude) * 111000,
                  (location.lon - center.longitude) * 111000 * Math.cos(location.lat * Math.PI / 180)) <= 30000);
            if (withinBounds) {
              coordinate = { latitude: location.lat, longitude: location.lon };
              articleSource = `https://zh.wikipedia.org/?curid=${article.pageid}`;
            }
          }
        } catch (error) { if (signal.aborted) throw error; }
      }
      if (!coordinate) continue;
      const { longitude, latitude } = coordinate;
      const parents = values(entity, 'P131').map((value) => value.id);
      const inCityBounds = cityBounds ? cityBounds.contains(longitude, latitude) : false;
      const exactCity = inCityBounds || belongsToCity(entity);
      if (!exactCity && !articleSource) {
        if (!center || !parents.some((parent) => cityParents.includes(parent))) continue;
        const dx = (longitude - center.longitude) * 111000 * Math.cos(latitude * Math.PI / 180);
        const dy = (latitude - center.latitude) * 111000;
        if (Math.hypot(dx, dy) > 30000) continue;
      }
      matches.push({
        latitude,
        longitude,
        label: `${entity.labels?.zh?.value || entity.labels?.['zh-hans']?.value || names[0]} · ${place.city}`,
        source: articleSource ? 'Wikipedia' : 'Wikidata',
        sourceUrl: articleSource || `https://www.wikidata.org/entity/${id}`,
        license: articleSource ? 'CC-BY-SA-4.0' : 'CC0-1.0',
        ...((!inCityBounds && !exactCity) || coordinate.precision >= 0.01 ? { precision: 'area' } : {}),
      });
    }
    return matches;
  }

  return { local, wikipedia, wikidata };
}
