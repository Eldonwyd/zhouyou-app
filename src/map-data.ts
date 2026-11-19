import type { AdministrativeFeature, AdministrativeGeoJSON, CityMark, VisitStatus } from './types';

const BASE_URL = `${import.meta.env.BASE_URL}maps/`;
const provinceMapCache = new Map<string, AdministrativeGeoJSON>();
let nationalMapPromise: Promise<AdministrativeGeoJSON> | null = null;

export const DIRECT_CITY_PROVINCES = new Set(['110000', '120000', '310000', '500000', '710000', '810000', '820000']);

const PROVINCE_COLORS = [
  '#ed6845', '#e3a526', '#5fac3e', '#18a79d', '#248bd2', '#715fcb', '#c159a1',
  '#d95566', '#bb782c', '#2ea977', '#3888bd', '#a15dc1', '#ce6d37', '#639b3f',
];

export function provinceColor(provinceCode: string): string {
  const ordinal = Number(provinceCode.slice(0, 2));
  return PROVINCE_COLORS[ordinal % PROVINCE_COLORS.length];
}

export function provinceCodeForCity(cityCode: string): string {
  return `${cityCode.slice(0, 2)}0000`;
}

export function statusForCity(mark: CityMark | undefined): VisitStatus {
  if (mark?.visited) return 'visited';
  return 'empty';
}

export function statusForProvince(provinceCode: string, marks: CityMark[]): VisitStatus {
  const provinceMarks = marks.filter((mark) => mark.provinceCode === provinceCode);
  if (provinceMarks.some((mark) => mark.visited)) return 'visited';
  return 'empty';
}

/** 未去过的颜色随主题变化：canvas 传入计算后的颜色，DOM 可直接传 CSS 变量。 */
export function fillForStatus(status: VisitStatus, provinceCode: string, emptyColor = '#d7dee2'): string {
  if (status === 'visited') return provinceColor(provinceCode);
  return emptyColor;
}

async function requestGeoJson(filename: string): Promise<AdministrativeGeoJSON> {
  // Include the asset name in failures so a missing province file can be
  // distinguished from a national-map failure without opening developer tools.
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${filename}`);
  } catch {
    throw new Error(`无法请求地图文件 ${filename}，请检查网络或本地服务是否仍在运行`);
  }
  if (!response.ok) throw new Error(`地图文件 ${filename} 请求失败（HTTP ${response.status}）`);
  let data: AdministrativeGeoJSON;
  try {
    data = await response.json() as AdministrativeGeoJSON;
  } catch {
    // Static hosts may return index.html with HTTP 200 for a missing JSON file.
    // Report that case explicitly instead of exposing a JSON parser exception.
    throw new Error(`地图文件 ${filename} 不是有效 JSON，请检查地图资源是否完整`);
  }
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length === 0) {
    throw new Error(`地图文件 ${filename} 缺少行政区边界`);
  }
  const ids = data.features.map((feature) => String(feature.properties?.adcode ?? ''));
  if (ids.some((id) => !/^\d{6}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`地图文件 ${filename} 中的行政区编码无效或重复`);
  }
  return data;
}

export function loadNationalMap(): Promise<AdministrativeGeoJSON> {
  nationalMapPromise ??= requestGeoJson('china.json').catch((error) => {
    nationalMapPromise = null;
    throw error;
  });
  return nationalMapPromise;
}

export async function loadProvinceMap(provinceCode: string): Promise<AdministrativeGeoJSON> {
  const cached = provinceMapCache.get(provinceCode);
  if (cached) return cached;
  const data = await requestGeoJson(`${provinceCode}.json`);
  provinceMapCache.set(provinceCode, data);
  return data;
}

export function provinceMapUrl(provinceCode: string): string {
  return new URL(`${BASE_URL}${provinceCode}.json`, window.location.href).href;
}

export async function cacheProvinceMap(provinceCode: string): Promise<void> {
  const url = provinceMapUrl(provinceCode);
  const response = await fetch(url, { cache: 'reload' });
  if (!response.ok) throw new Error(`缓存下载失败（${response.status}）`);
  const geoJson = await response.clone().json() as AdministrativeGeoJSON;
  if (!geoJson.features?.length) throw new Error('地图数据为空');
  const cache = await caches.open('travel-region-maps-v1');
  await cache.put(url, response);
  provinceMapCache.set(provinceCode, geoJson);
}

export async function listCachedProvinceCodes(): Promise<string[]> {
  const cache = await caches.open('travel-region-maps-v1');
  const keys = await cache.keys();
  return keys.map((request) => request.url.match(/(\d{6})\.json$/)?.[1]).filter((code): code is string => Boolean(code));
}

export async function removeCachedProvinceMap(provinceCode: string): Promise<void> {
  const cache = await caches.open('travel-region-maps-v1');
  await cache.delete(provinceMapUrl(provinceCode));
  provinceMapCache.delete(provinceCode);
}

/** Ray-casting supports the Polygon and MultiPolygon geometries in the bundled map. */
function pointInRing(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude) && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInFeature(longitude: number, latitude: number, feature: AdministrativeFeature): boolean {
  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as number[][][]]
    : feature.geometry.coordinates as number[][][][];
  return polygons.some((rings) => pointInRing(longitude, latitude, rings[0])
    && !rings.slice(1).some((hole) => pointInRing(longitude, latitude, hole)));
}

/** DataV boundaries use GCJ-02; camera EXIF positions are normally WGS84. */
function wgs84ToGcj02(longitude: number, latitude: number): [number, number] {
  if (longitude < 73.66 || longitude > 135.05 || latitude < 3.86 || latitude > 53.55) return [longitude, latitude];
  const x = longitude - 105;
  const y = latitude - 35;
  const transformLatitude = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
    + (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3
    + (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  const transformLongitude = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
    + (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3
    + (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  const radianLatitude = latitude / 180 * Math.PI;
  const sine = Math.sin(radianLatitude);
  const magic = 1 - 0.006693421622965943 * sine * sine;
  const sqrtMagic = Math.sqrt(magic);
  return [
    longitude + transformLongitude * 180 / (6378245 / sqrtMagic * Math.cos(radianLatitude) * Math.PI),
    latitude + transformLatitude * 180 / ((6378245 * (1 - 0.006693421622965943)) / (magic * sqrtMagic) * Math.PI),
  ];
}

export async function cityFromGps(latitude: number, longitude: number): Promise<AdministrativeFeature | null> {
  const [mapLongitude, mapLatitude] = wgs84ToGcj02(longitude, latitude);
  const national = await loadNationalMap();
  const province = national.features.find((feature) => pointInFeature(mapLongitude, mapLatitude, feature));
  if (!province) return null;
  const cities = await loadProvinceMap(String(province.properties.adcode));
  return cities.features.find((feature) => pointInFeature(mapLongitude, mapLatitude, feature)) ?? null;
}
