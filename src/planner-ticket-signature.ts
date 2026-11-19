import type { PlannerContent } from './planner-types';

/** 只跟踪预约相关条件，自动配图和攻略保存不应触发重新联网查询。 */
export function ticketPlanSignature(content: PlannerContent): string {
  return JSON.stringify({
    request: content.request,
    days: content.days.map((day) => ({ date: day.date, activities: day.activities.map((activity) => ({
      id: activity.id, kind: activity.kind, title: activity.title, city: activity.city,
      location: activity.location, startTime: activity.startTime, endTime: activity.endTime,
      transportMode: activity.transportMode, description: activity.description, costs: activity.costs,
    })) })),
  });
}
