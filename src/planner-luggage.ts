import type { PlannerActivity } from './planner-types';

/** 页面和路书都在对应活动里显示一句寄存提示。 */
export function plannerLuggageNoteText(activity: PlannerActivity): string {
  return activity.luggageNote ? `· ${activity.luggageNote.text}` : '';
}
