import type { PlannerContent } from './planner-types';
import { isGeneralMealLocation } from './planner-place-name.ts';

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
  candidates?: Array<{ latitude: number; longitude: number; label: string }>;
}

/** 同名地点的每次到访拥有独立的保存键，允许不同日期校正到不同入口。 */
export function datedPlannerMapPlaces(content: PlannerContent, hotels: Record<string, string> = {}): PlannerMapPlace[] {
  const grouped = new Map<string, PlannerMapPlace>();
  for (const place of plannerMapRouteStops(content, hotels)) {
    const existing = grouped.get(place.key);
    if (existing) existing.visits.push(...place.visits);
    else grouped.set(place.key, { ...place, visits: [...place.visits] });
  }
  return [...grouped.values()];
}

/** 按每日时间排序，保留同一地点多次到访；酒店作为当天最后一站。 */
export function plannerMapRouteStops(content: PlannerContent, hotels: Record<string, string> = {}): PlannerMapPlace[] {
  const places: PlannerMapPlace[] = [];
  for (const day of content.days) {
    let order = 0;
    const activities = day.activities.filter((activity) => !activity.bookingTiming?.deferred)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    for (const [activityIndex, activity] of activities.entries()) {
      let locatedActivity = activity;
      if (activity.kind === 'food' && isGeneralMealLocation(activity.location || activity.title)) {
        const neighbors = [...activities.slice(0, activityIndex).reverse(), ...activities.slice(activityIndex + 1)];
        const anchor = neighbors.find((item) => item.kind === 'sight' && item.city === activity.city && (item.photoQuery || item.location));
        if (anchor) locatedActivity = { ...activity, location: `${anchor.photoQuery || anchor.location}附近` };
      }
      const activityPlaces = collectPlannerMapPlaces({ ...content, days: [{ ...day, activities: [locatedActivity], lodging: null }] });
      for (const place of activityPlaces) places.push({ ...place,
        key: JSON.stringify([day.date, place.city, place.name]),
        visits: [{ date: day.date, title: activity.title, lodging: false, order: ++order }],
      });
    }
    const city = day.lodging?.city;
    const name = hotels[day.date]?.trim() || day.lodging?.area;
    if (city && name) places.push({ key: JSON.stringify([day.date, city, name]), city, name, cityCode: '',
      visits: [{ date: day.date, title: hotels[day.date]?.trim() ? `酒店：${name}` : '住宿建议片区', lodging: true, order: ++order }] });
  }
  return places;
}

/** 地图由当前行程派生，编辑/撤销后自动增删地点；重复到访合并但保留日期。 */
export function collectPlannerMapPlaces(content: PlannerContent): PlannerMapPlace[] {
  const places = new Map<string, PlannerMapPlace>();
  const append = (city: string, name: string, date: string, title: string, lodging: boolean) => {
    if (!name.trim() || !city.trim()) return;
    const key = JSON.stringify([city.trim(), name.trim()]);
    const place = places.get(key) ?? {
      key, name: name.trim(), city: city.trim(),
      cityCode: content.cities.find((item) => item.name.replace(/市$/, '') === city.replace(/市$/, ''))?.code ?? '',
      visits: [],
    };
    place.visits.push({ date, title, lodging });
    places.set(key, place);
  };
  for (const day of content.days) {
    for (const activity of day.activities) {
      // 休息和泛化交通描述不能当成景点；明确车站等可定位交通地点仍列出。
      if (activity.kind !== 'rest' && !activity.bookingTiming?.deferred) {
        // 游玩标题中的“观鸥/拍照”不是地名，优先使用生成时记录的规范景点名。
        const name = activity.kind === 'sight' ? activity.photoQuery || activity.location || activity.title : activity.location || activity.title;
        if (activity.kind === 'transport' && /[→至—]/.test(name)) {
          // 跨城交通有两个真实站点，不能将“昆明站—大理站”当成一个地点搜索。
          const stations = name.match(/[\u4e00-\u9fff]+(?:东|西|南|北)?站/g);
          if (stations && stations.length > 1) {
            for (const station of stations) {
              const city = content.cities.find((item) => station.startsWith(item.name.replace(/市$|白族自治州$|藏族自治州$/g, '')))?.name || activity.city.split(/[→至—]/)[0];
              append(city, station, day.date, activity.title, false);
            }
            continue;
          }
        }
        append(activity.city, name, day.date, activity.title, false);
      }
    }
    if (day.lodging) append(day.lodging.city, day.lodging.area, day.date, '住宿建议片区（尚未选定酒店）', true);
  }
  return [...places.values()];
}

/** 高德搜索链接支持手机和电脑；不把 WGS84 坐标直接传给高德。 */
export function plannerAmapUrl(place: Pick<PlannerMapPlace, 'city' | 'name'>): string {
  const query = new URLSearchParams({ keyword: `${place.city} ${place.name}`, city: place.city, view: 'map', src: 'travel-planner', callnative: '1' });
  return `https://uri.amap.com/search?${query}`;
}
