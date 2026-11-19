import { plannerPlaceSearchTarget } from '../src/planner-place-name.ts';
import { createSupplementalPlaceLookup } from './supplemental-places.mjs';

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

/** 高德凭据仅留服务端；顺序查询、有限缓存，不记录含密钥的请求地址。 */
export function createPlannerMapService({ apiKey = '', fetchImpl = fetch, tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', photonUrl = 'https://photon.komoot.io/api/', overpassUrl = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', supplementalLookup } = {}) {
  const cache = new Map();
  const supplemental = supplementalLookup ?? createSupplementalPlaceLookup({ fetchImpl });
  // 公共服务仅低频串行查询；进程内共享队列，避免多个地图请求叠加。
  let queue = Promise.resolve();
  let lastQuery = 0;
  async function openLookup(place, signal) {
    const operation = queue.then(async () => {
      const wait = Math.max(0, 1100 - (Date.now() - lastQuery));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lastQuery = Date.now();
      const normalize = (value) => String(value || '').replace(/[\s·（）()]/g, '').replace(/市$/, '');
      // 行程常把行政区前缀、游玩动作、入口描述写进location，不能要求整段等于POI名称。
      const city = place.city.split(/[→至—]/)[0].trim();
      const target = plannerPlaceSearchTarget(place.name, city);
      const cleanName = target.name;
      const shortName = cleanName.replace(/(?:古城|古镇|国家旅游度假区|风景名胜区|风景区)$/, '');
      const namesToTry = [...new Set([cleanName, shortName, place.name].filter((name) => name.length >= 2))];
      const cityAliases = (value) => normalize(value).replace(/(?:白族|藏族|傣族|彝族|哈尼族)*自治州$|地区$/, '');
      const normalizePlace = (value) => {
        const normalized = normalize(value), cityName = cityAliases(city);
        return normalized.startsWith(cityName) ? normalized.slice(cityName.length).replace(/^市/, '') : normalized;
      };
      const localCandidates = await supplemental.local({ ...place, city }, namesToTry);
      if (localCandidates.length === 1) return { key: place.key, status: 'located', ...localCandidates[0],
        precision: target.area || localCandidates[0].precision === 'area' ? 'area' : 'place', coordinateSystem: 'WGS84' };
      const candidates = [...localCandidates];
      for (const name of candidates.length ? [] : namesToTry) {
        signal.throwIfAborted();
        try {
          const url = new URL(photonUrl);
          url.search = new URLSearchParams({ q: `${city} ${name}`, limit: '10' }).toString();
          const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), headers: { 'User-Agent': 'TravelFootprints/1.0 (itinerary place lookup)' } });
          if (!response.ok) continue;
          const data = await response.json();
          candidates.push(...(data.features ?? []).flatMap((feature) => {
        const props = feature.properties ?? {};
        const [longitude, latitude] = feature.geometry?.coordinates ?? [];
        const names = [props.name, props['name:zh'], props.alt_name, props.old_name].flatMap((value) => String(value || '').split(';'));
        const cities = [props.city, props.county, props.district, props.state];
        if (!names.some((value) => namesToTry.some((expected) => normalizePlace(value) === normalizePlace(expected))) ||
          !cities.some((value) => cityAliases(value) === cityAliases(city)) ||
          !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 85) return [];
        return [{ latitude, longitude, label: [props.name, props.city, props.street, props.housenumber].filter(Boolean).join(' · ') }];
          }));
          if (candidates.length) break;
        } catch (error) { if (signal.aborted) throw error; }
        // 多次名称查询仍保持低频，避免对公共服务产生突发请求。
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      if (!candidates.length) {
        try { candidates.push(...await supplemental.wikidata({ ...place, city }, namesToTry, signal)); }
        catch (error) { if (signal.aborted) throw error; }
      }
      let source = 'OpenStreetMap / Photon';
      if (!candidates.length && overpassUrl) {
        try {
          // 补查OSM原始地点库：按城市行政区域限定范围，避免同名异城误标。
          const quote = (value) => JSON.stringify(value);
          const regex = namesToTry.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
          const data = `[out:json][timeout:15];area["boundary"="administrative"]["name"=${quote(city)}]->.city;nwr(area.city)["name"~${quote(`^(${regex})$`)}];out center tags;`;
          const response = await fetchImpl(overpassUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TravelFootprints/1.0' },
            body: new URLSearchParams({ data }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
          if (response.ok) {
            const payload = await response.json();
            for (const item of payload.elements ?? []) {
              const latitude = item.lat ?? item.center?.lat, longitude = item.lon ?? item.center?.lon;
              if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180)
                candidates.push({ latitude, longitude, label: `${item.tags?.name || cleanName} · ${city}` });
            }
            source = 'OpenStreetMap / Overpass';
          }
        } catch (error) { if (signal.aborted) throw error; }
      }
      const unique = [...new Map(candidates.map((item) => [`${item.longitude},${item.latitude}`, item])).values()];
      if (target.area && unique.length > 1) {
        // 同一街区可能对应多个道路段。用户只需要片区时，使用实际道路点的中心作参考，非店铺坐标。
        const latitudes = unique.map((item) => item.latitude), longitudes = unique.map((item) => item.longitude);
        const height = (Math.max(...latitudes) - Math.min(...latitudes)) * 111000;
        const width = (Math.max(...longitudes) - Math.min(...longitudes)) * 111000 * Math.cos(latitudes[0] * Math.PI / 180);
        if (Math.hypot(height, width) <= 5000) return { key: place.key, status: 'located',
          latitude: latitudes.reduce((total, value) => total + value, 0) / unique.length,
          longitude: longitudes.reduce((total, value) => total + value, 0) / unique.length,
          label: `${cleanName} · ${city}`, source: unique[0].source || source, precision: 'area', coordinateSystem: 'WGS84' };
      }
      if (unique.length === 1) return { key: place.key, status: 'located', source, ...unique[0], precision: target.area || unique[0].precision === 'area' ? 'area' : 'place', coordinateSystem: 'WGS84' };
      return { key: place.key, status: 'unresolved', reason: unique.length ? '存在多个匹配位置，请选择或在地图上标点' : '未找到准确匹配，请在地图上标点', candidates: unique };
    });
    queue = operation.catch(() => {});
    return operation;
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
        if (!apiKey) {
          const value = await openLookup(place, signal);
          cache.set(cacheKey, { value, expires: Date.now() + 86400000 });
          results.push(value);
          continue;
        }
        const url = new URL('https://restapi.amap.com/v3/place/text');
        url.search = new URLSearchParams({ key: apiKey, keywords: place.name, city: /^\d{6}$/.test(place.cityCode) ? place.cityCode : place.city, citylimit: 'true', offset: '10', extensions: 'base' }).toString();
        const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error('地点检索暂时不可用');
        const data = await response.json();
        if (data.status !== '1') throw new Error('高德地点检索未成功，请检查服务权限或额度');
        const normalize = (value) => String(value).replace(/[\s·()（）]/g, '').replace(/(?:风景名胜区|风景区|景区)$/, '');
        const cityName = place.city.replace(/市$/, '');
        const candidates = (data.pois ?? []).filter((poi) => {
          const cityMatches = /^\d{6}$/.test(place.cityCode)
            ? String(poi.adcode).slice(0, 4) === place.cityCode.slice(0, 4)
            : String(poi.cityname).replace(/市$/, '') === cityName;
          return cityMatches && normalize(poi.name) === normalize(place.name) && /^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(poi.location);
        });
        // 同名分店/入口不能静默取第一条。用户仍可从列表去高德核对。
        const locations = [...new Set(candidates.map((poi) => poi.location))];
        let value;
        if (locations.length !== 1) value = unresolved(place.key, locations.length ? '同城存在多个同名地点，位置待确认' : '未找到城市和名称均匹配的地点，位置待确认');
        else {
          const [lon, lat] = locations[0].split(',').map(Number);
          if (lon < -180 || lon > 180 || lat < -85 || lat > 85) throw new Error('位置数据无效');
          const [longitude, latitude] = gcj02ToWgs84(lon, lat);
          value = { key: place.key, status: 'located', longitude, latitude, amapLocation: locations[0], source: '高德地点检索', coordinateSystem: 'WGS84（由 GCJ-02 近似转换）' };
        }
        if (cache.size >= 1000) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { value, expires: Date.now() + 86400000 });
        results.push(value);
      } catch (error) {
        if (signal.aborted) throw error;
        results.push(unresolved(place.key, '地点检索失败，请重试或在高德地图中核对'));
      }
    }
    return { positions: results, tileUrl, notice: apiKey ? '地点来自高德检索；底图使用近似转换后的位置。' : '' };
  };
}
