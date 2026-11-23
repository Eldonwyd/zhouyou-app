import type { PlannerContent } from './planner-types';

// 更新查询规则时重新定位旧的未匹配条目，已确定的位置继续使用保存值。
export const PLANNER_MAP_LOOKUP_VERSION = 7;

export interface PlannerMapPlace {
  key: string;
  name: string;
  city: string;
  cityCode: string;
  visits: Array<{ date: string; title: string; lodging: boolean; order?: number }>;
}
export interface PlannerMapPosition {
  key: string;
  status: 'located' | 'unresolved';
  reason?: string;
  latitude?: number;
  longitude?: number;
  amapLocation?: string;
  source?: string;
  coordinateSystem?: string;
  lookupVersion?: number;
  precision?: 'place' | 'area';
  sourceUrl?: string;
  license?: string;
  label?: string;
  candidates?: Array<{ latitude: number; longitude: number; label: string; source?: string; sourceUrl?: string; license?: string; amapLocation?: string; precision?: 'area' | 'place' }>;
}

/** 同名景点的每次到访拥有独立的保存键，允许不同日期校正到不同入口。 */
export function datedPlannerMapPlaces(content: PlannerContent, hotels: Record<string, string> = {}): PlannerMapPlace[] {
  const grouped = new Map<string, PlannerMapPlace>();
  for (const place of plannerMapRouteStops(content, hotels)) {
    const existing = grouped.get(place.key);
    if (existing) existing.visits.push(...place.visits);
    else grouped.set(place.key, { ...place, visits: [...place.visits] });
  }
  return [...grouped.values()];
}

/** 行程地图仅按每日时间顺序定位游玩景点；餐饮、交通、休息与酒店不参与地图定位。 */
export function plannerMapRouteStops(content: PlannerContent, _hotels: Record<string, string> = {}): PlannerMapPlace[] {
  const places: PlannerMapPlace[] = [];
  for (const day of content.days) {
    let order = 0;
    const sights = day.activities
      .filter((activity) => activity.kind === 'sight' && !activity.bookingTiming?.deferred)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    for (const activity of sights) {
      const activityPlaces = collectPlannerMapPlaces({ ...content, days: [{ ...day, activities: [activity], lodging: null }] });
      for (const place of activityPlaces) {
        places.push({
          ...place,
          key: JSON.stringify([day.date, place.city, place.name]),
          visits: [{ date: day.date, title: activity.title, lodging: false, order: ++order }],
        });
      }
    }
  }
  return places;
}

/** 地图由当前行程中的游玩景点派生，编辑/撤销后自动增删；餐饮、交通、休息与酒店不入图。 */
export function collectPlannerMapPlaces(content: PlannerContent): PlannerMapPlace[] {
  const places = new Map<string, PlannerMapPlace>();
  const append = (city: string, name: string, date: string, title: string) => {
    if (!name.trim() || !city.trim()) return;
    const key = JSON.stringify([city.trim(), name.trim()]);
    const place = places.get(key) ?? {
      key, name: name.trim(), city: city.trim(),
      cityCode: content.cities.find((item) => item.name.replace(/市$/, '') === city.replace(/市$/, ''))?.code ?? '',
      visits: [],
    };
    place.visits.push({ date, title, lodging: false });
    places.set(key, place);
  };
  for (const day of content.days) {
    for (const activity of day.activities) {
      if (activity.kind !== 'sight' || activity.bookingTiming?.deferred) continue;
      // 游玩标题中的“观鸥/拍照”不是地名，优先使用生成时记录的规范景点名。
      const name = activity.photoQuery || activity.location || activity.title;
      append(activity.city, name, day.date, activity.title);
    }
  }
  return [...places.values()];
}

/** 高德搜索链接支持手机和电脑；不把 WGS84 坐标直接传给高德。 */
export function plannerAmapUrl(place: Pick<PlannerMapPlace, 'city' | 'name'>): string {
  const query = new URLSearchParams({ keyword: `${place.city} ${place.name}`, city: place.city, view: 'map', src: 'travel-planner', callnative: '1' });
  return `https://uri.amap.com/search?${query}`;
}
