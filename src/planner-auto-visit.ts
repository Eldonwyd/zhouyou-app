import type { CityMark } from './types';
import type { AiTravelPlan, PlannerActivity } from './planner-types';
import { plannerJournalActivityKey, plannerJournalCity, plannerJournalPlaceName, plannerJournalVisitFor } from './planner-journal';
import { provinceCodeForCity } from './map-data';

const AUTO_CITIES_KEY = 'zhouyou-auto-visited-cities-v1';
const AUTO_ACTIVITIES_KEY = 'zhouyou-auto-visited-activities-v1';

const twoDigits = (n: number) => String(n).padStart(2, '0');

export function localDateString(now = new Date()): string {
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

export function localTimeString(now = new Date()): string {
  return `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
}

/**
 * 判断某项行程活动是否已经过了结束时间（按设备本地墙上时间判断）。
 * 例如 11.3 09:00-11:00 的洱海活动，在 11.3 11:00 之后即返回 true。
 */
export function isActivityTimePassed(
  dayDate: string | undefined,
  endTime: string | undefined,
  now = new Date(),
): boolean {
  if (!dayDate || !/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) return false;
  const today = localDateString(now);
  if (dayDate < today) return true;
  if (dayDate > today) return false;
  const normalized = (endTime ?? '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(normalized)) return false;
  const [h, m] = normalized.split(':');
  const endClock = `${twoDigits(Number(h))}:${twoDigits(Number(m))}`;
  return localTimeString(now) >= endClock;
}

/**
 * 判断行程中的某座城市是否已到“自动点亮”时间。
 * 例如大理行程为 11.2–11.5，到了 11.5 当天（today >= 11.5）即视为已到访，自动点亮地图。
 */
export function isPlanCityReached(
  plan: AiTravelPlan,
  cityName: string,
  now = new Date(),
): boolean {
  const days = plan.content.days;
  if (!days.length) return false;
  const today = localDateString(now);
  const singleCity = plan.content.cities.length <= 1;
  const matchedDates: string[] = [];
  for (const day of days) {
    if (singleCity || day.activities.some((act) => act.city && (act.city.includes(cityName) || cityName.includes(act.city)))) {
      matchedDates.push(day.date);
    }
  }
  const endDate = matchedDates.sort().at(-1) ?? days.at(-1)?.date;
  if (!endDate) return false;
  return today >= endDate;
}

function readProcessedSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writeProcessedSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set].slice(-2000)));
  } catch {
    /* ignore */
  }
}

export interface AutoCityTarget {
  key: string;
  mark: CityMark;
}

export interface AutoSightTarget {
  key: string;
  planId: string;
  activity: PlannerActivity;
  activityKey: string;
  cityCode: string;
}

/** 扫描所有 AI 行程，找出已到时间但尚未自动点亮的城市、以及已过结束时间但尚未自动加入手账的景点。 */
export function findDueAutoVisits(
  aiPlans: AiTravelPlan[],
  existingMarks: CityMark[],
  now = new Date(),
): {
  dueCities: AutoCityTarget[];
  dueSights: AutoSightTarget[];
} {
  const visitedCityCodes = new Set(existingMarks.filter((m) => m.visited).map((m) => String(m.id)));
  const doneCities = readProcessedSet(AUTO_CITIES_KEY);
  const doneActs = readProcessedSet(AUTO_ACTIVITIES_KEY);

  const dueCities: AutoCityTarget[] = [];
  const seenCityCodes = new Set<string>();
  const dueSights: AutoSightTarget[] = [];

  for (const plan of aiPlans) {
    // 1. 到期城市自动点亮
    for (const city of plan.content.cities) {
      const code = String(city.code || '');
      if (!code || visitedCityCodes.has(code) || seenCityCodes.has(code)) continue;
      const key = `${plan.id}:${code}`;
      if (doneCities.has(key)) continue;
      if (!isPlanCityReached(plan, city.name, now)) continue;
      seenCityCodes.add(code);
      dueCities.push({
        key,
        mark: {
          id: code,
          name: city.name,
          provinceCode: city.provinceCode ? String(city.provinceCode) : provinceCodeForCity(code),
          visited: true,
          planned: false,
          updatedAt: now.toISOString(),
        },
      });
    }

    // 2. 到点景点自动加入手账
    for (const day of plan.content.days) {
      for (const activity of day.activities) {
        if (activity.kind !== 'sight') continue;
        if (!isActivityTimePassed(day.date, activity.endTime, now)) continue;
        if (plannerJournalVisitFor(plan, activity)) continue;
        const activityKey = plannerJournalActivityKey(activity);
        const key = `${plan.id}:${activity.id}:${activityKey}`;
        if (doneActs.has(key)) continue;
        const resolvedCity = plannerJournalCity(plan.content.cities, activity.city);
        const placeName = plannerJournalPlaceName(activity);
        if (!resolvedCity || !placeName) continue;
        dueSights.push({
          key,
          planId: plan.id,
          activity,
          activityKey,
          cityCode: resolvedCity.code,
        });
      }
    }
  }

  return { dueCities, dueSights };
}

export function markAutoVisitsProcessed(cityKeys: string[], activityKeys: string[]): void {
  if (cityKeys.length) {
    const set = readProcessedSet(AUTO_CITIES_KEY);
    cityKeys.forEach((k) => set.add(k));
    writeProcessedSet(AUTO_CITIES_KEY, set);
  }
  if (activityKeys.length) {
    const set = readProcessedSet(AUTO_ACTIVITIES_KEY);
    activityKeys.forEach((k) => set.add(k));
    writeProcessedSet(AUTO_ACTIVITIES_KEY, set);
  }
}
