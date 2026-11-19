import type { AiTravelPlan, PlannerActivity } from './planner-types';
import type { JourneyCity } from './types';
import { plannerPhotoCityName, plannerPhotoPlaceName } from './planner-photo';
import { plannerPlaceSearchTarget } from './planner-place-name';

/** 和景点配图使用同一地名，避免把「游览」等活动描述写进手账地名。 */
export function plannerJournalPlaceName(activity: PlannerActivity): string {
  const rawName = [activity.photoQuery, activity.location, activity.title].find((value) => value?.trim())?.trim() ?? '';
  return plannerPlaceSearchTarget(plannerPhotoPlaceName(rawName) || rawName, activity.city.trim()).name || rawName;
}

export const journalPlaceNameKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** 只在计划的城市列表内匹配；遇到无法识别的区县或别名，由用户确认城市。 */
export function plannerJournalCity(cities: readonly JourneyCity[], city: string): JourneyCity | undefined {
  const key = (name: string) => plannerPhotoCityName(name).replace(/市$/, '').trim();
  const target = key(city);
  return target ? cities.find((item) => key(item.name) === target) : undefined;
}

export function plannerJournalActivityKey(activity: PlannerActivity): string {
  return JSON.stringify([activity.kind, activity.city.trim(), journalPlaceNameKey(plannerJournalPlaceName(activity))]);
}

export function plannerJournalVisitFor(plan: AiTravelPlan, activity: PlannerActivity) {
  const visit = plan.journalVisits?.[activity.id];
  return visit && visit.activityKey === plannerJournalActivityKey(activity) ? visit : undefined;
}
