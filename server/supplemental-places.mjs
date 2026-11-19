import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../data/places/', import.meta.url));
const normalize = (value) => String(value || '').replace(/[\s·（）()]/g, '').replace(/市$/, '');
const normalizeCity = (value) => normalize(value).replace(/(?:白族|藏族|傣族|彝族|哈尼族)*自治州$|地区$/, '');
// 多地点共用低频队列；遇到服务端限流遵循Retry-After，期间不继续请求。
let wikidataQueue = Promise.resolve();
let lastWikidataRequest = 0;
let wikidataPausedUntil = 0;

/** 按来源保留本地数据包元信息。无需用户申请Key，也不依赖在线公共查询额度。 */
export async function readLocalPlacePacks(directory = defaultDirectory) {
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

/** 先查可离线分发的本地数据包，再从Wikidata补查具有真实坐标的条目。
 * 使用轻量实体API核验名称、坐标和行政隶属，避免复杂SPARQL查询长时间等待。
 */
export function createSupplementalPlaceLookup({ fetchImpl = fetch, localRecords, dataDirectory,
  wikidataUrl = 'https://www.wikidata.org/w/api.php' } = {}) {
  let recordPromise;
  const cities = new Map();
  async function local(place, names) {
    recordPromise ??= localRecords ? Promise.resolve(localRecords) : readLocalPlacePacks(dataDirectory);
    return (await recordPromise).filter((record) => normalizeCity(record.city) === normalizeCity(place.city)
      && [record.name, ...(record.aliases ?? [])].some((name) => names.some((expected) => normalize(name) === normalize(expected))))
      .map((record) => ({ latitude: record.latitude, longitude: record.longitude, label: `${record.name} · ${record.city}`,
        source: record.source, sourceUrl: record.sourceUrl, license: record.license, precision: record.precision }));
  }
  async function wikidata(place, names, signal) {
    if (!wikidataUrl) return [];
    async function api(parameters) {
      const request = wikidataQueue.then(async () => {
        if (Date.now() < wikidataPausedUntil) throw new Error('Wikidata暂时限流，已保存位置仍可使用');
        const wait = Math.max(0, 1300 - (Date.now() - lastWikidataRequest));
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        signal.throwIfAborted();
        lastWikidataRequest = Date.now();
        const url = new URL(wikidataUrl);
        url.search = new URLSearchParams({ ...parameters, format: 'json' }).toString();
        const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
          headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary coordinate lookup)' } });
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const seconds = Number(retryAfter);
          const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
            : Math.max(60000, Date.parse(retryAfter || '') - Date.now() || 0);
          wikidataPausedUntil = Date.now() + delay;
        }
        if (!response.ok) throw new Error(`Wikidata查询失败（${response.status}）`);
        return response.json();
      });
      wikidataQueue = request.catch(() => {});
      return request;
    }
    const search = (name) => api({ action: 'wbsearchentities', search: name, language: 'zh', limit: '5' });
    const entities = async (ids) => (await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims|sitelinks', sitefilter: 'zhwiki', languages: 'zh|zh-hans|en' })).entities || {};
    const values = (entity, property) => (entity?.claims?.[property] ?? []).filter((claim) => claim.rank !== 'deprecated')
      .map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean);
    const point = (entity) => values(entity, 'P625').find((value) => value.globe?.endsWith('/Q2')
      && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 85 && Math.abs(value.longitude) <= 180);

    const cityKey = normalizeCity(place.city);
    // 数据源可能使用“天津意式风情区”，行程只写“意式风情区”。
    // 仅去掉本次查询城市的前缀；仍需独立核对行政隶属，不能据此接受异城同名点。
    const normalizePlace = (value) => normalize(value).replace(new RegExp(`^${cityKey}(?:市)?`), '');
    let city = cities.get(cityKey);
    if (!city) {
      const matches = (await search(`${cityKey}市`)).search ?? [];
      const hit = matches.find((item) => normalizeCity(item.match?.text || item.label) === cityKey);
      if (!hit) return [];
      city = (await entities([hit.id]))[hit.id];
      if (!city) return [];
      cities.set(cityKey, city);
    }
    const found = [];
    const searchNames = [...new Set([...names.slice(0, 2), `${cityKey}${names[0]}`])];
    for (const name of searchNames) {
      const hits = (await search(name)).search ?? [];
      found.push(...hits.filter((item) => names.some((expected) => normalizePlace(expected) === normalizePlace(item.match?.text || item.label))));
      if (found.length) break;
    }
    const ids = [...new Set(found.map((item) => item.id))];
    if (!ids.length) return [];
    const details = await entities(ids);
    // POI 常只记录所属街道或区县（如河北区），不能要求 P131 直接等于天津市。
    // 按批次向上查三层，保留实际行政链，循环与重复节点不会反复请求。
    const ancestry = { ...details };
    let frontier = ids;
    for (let depth = 0; depth < 3; depth++) {
      const parentIds = [...new Set(frontier.flatMap((id) => values(ancestry[id], 'P131').map((value) => value.id)))]
        .filter((id) => id && id !== city.id && !ancestry[id]);
      if (!parentIds.length) break;
      Object.assign(ancestry, await entities(parentIds));
      frontier = parentIds;
    }
    const belongsToCity = (entity, visited = new Set()) => values(entity, 'P131').some(({ id }) => {
      if (id === city.id) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return ancestry[id] ? belongsToCity(ancestry[id], visited) : false;
    });
    const center = point(city);
    const cityParents = values(city, 'P131').map((value) => value.id);
    const matches = [];
    for (const id of ids) {
      const entity = details[id];
      let coordinate = point(entity);
      let articleSource;
      // 部分真实景点的实体尚未录入 P625，但关联中文条目已提供坐标。
      // 仅读取实体明确关联的条目，并核对返回的实体编号及城市证据。
      if (!coordinate && entity?.sitelinks?.zhwiki?.title) {
        const title = entity.sitelinks.zhwiki.title;
        const url = new URL('https://zh.wikipedia.org/w/api.php');
        url.search = new URLSearchParams({ action: 'query', titles: title, prop: 'coordinates|pageprops|extracts',
          coprimary: 'primary', exintro: '1', explaintext: '1', exchars: '1200', format: 'json' });
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
            headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary coordinate lookup)' } });
          const pages = response.ok ? Object.values((await response.json()).query?.pages ?? {}) : [];
          const article = pages.find((page) => page.pageprops?.wikibase_item === id);
          const location = article?.coordinates?.find((item) => item.globe === 'earth'
            && Number.isFinite(item.lat) && Number.isFinite(item.lon));
          if (location && `${article.title} ${article.extract}`.includes(cityKey)
            && Math.abs(location.lat) <= 85 && Math.abs(location.lon) <= 180 && center) {
            const distance = Math.hypot((location.lat - center.latitude) * 111000,
              (location.lon - center.longitude) * 111000 * Math.cos(location.lat * Math.PI / 180));
            if (distance <= 30000) {
              coordinate = { latitude: location.lat, longitude: location.lon };
              articleSource = `https://zh.wikipedia.org/?curid=${article.pageid}`;
            }
          }
        } catch (error) { if (signal.aborted) throw error; }
      }
      if (!coordinate) continue;
      const { longitude, latitude } = coordinate;
      const parents = values(entity, 'P131').map((value) => value.id);
      const exactCity = belongsToCity(entity);
      if (!exactCity && !articleSource) {
        // 部分条目只记录到州；需与目标城市有共同上级，且实际坐标在城区附近。
        if (!center || !parents.some((parent) => cityParents.includes(parent))) continue;
        const dx = (longitude - center.longitude) * 111000 * Math.cos(latitude * Math.PI / 180);
        const dy = (latitude - center.latitude) * 111000;
        if (Math.hypot(dx, dy) > 30000) continue;
      }
      matches.push({ latitude, longitude, label: `${entity.labels?.zh?.value || names[0]} · ${place.city}`, source: articleSource ? 'Wikipedia' : 'Wikidata',
        sourceUrl: articleSource || `https://www.wikidata.org/entity/${id}`, license: articleSource ? 'CC-BY-SA-4.0' : 'CC0-1.0',
        ...(!exactCity || coordinate.precision >= .01 ? { precision: 'area' } : {}) });
    }
    return matches;
  }
  return { local, wikidata };
}
