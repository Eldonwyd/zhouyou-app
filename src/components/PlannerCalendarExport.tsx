import { useState } from 'react';
import type { AiTravelPlan } from '../planner-types';
import { exportCalendarEvent } from '../calendar';
import { addPlannerDays } from '../planner-domain';
import { TravelIcon } from './TravelArt';

/** 日历直接使用当前行程日期，无需先建立预算或加入旅行记录。 */
export default function PlannerCalendarExport({ plan, initialReminderDays, disabled, onSave, onError }: {
  plan: AiTravelPlan;
  initialReminderDays: number;
  disabled: boolean;
  onSave: (plan: AiTravelPlan, expectedVersion: number | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [reminderDays, setReminderDays] = useState(plan.reminderDays ?? initialReminderDays);
  const [exporting, setExporting] = useState(false);
  const startDate = plan.content.days[0].date;
  const reminderDate = addPlannerDays(startDate, -Math.max(1, reminderDays));

  async function exportCalendar(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    try {
      // 导出时保存提醒偏好；只更新行程元数据，不改费用及行程内容版本。
      if (plan.reminderDays !== reminderDays) {
        await onSave({ ...plan, reminderDays, version: plan.version + 1,
          contentVersion: plan.contentVersion ?? plan.version, updatedAt: new Date().toISOString() }, plan.version);
      }
      exportCalendarEvent(plan.content.title, {
        startDate,
        endDate: plan.content.days.at(-1)!.date,
        reminderDays,
      });
    } catch (error) { onError(error instanceof Error ? error.message : '日历导出失败'); }
    finally { setExporting(false); }
  }

  return <div className="planner-calendar-export">
    <div className="planner-calendar-controls">
      <label>提前提醒<select value={reminderDays} disabled={disabled || exporting} onChange={(event) => setReminderDays(Number(event.target.value))}>
        <option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option>
      </select></label>
      <button type="button" className="secondary" disabled={disabled || exporting} onClick={() => void exportCalendar()}>
        <TravelIcon name="plan" />
        {exporting ? '导出中…' : '导出到系统日历'}
      </button>
    </div>
    <small><time dateTime={reminderDate}>{Number(reminderDate.slice(5, 7))} 月 {Number(reminderDate.slice(8, 10))} 日</time>提醒 · 导入日历后生效</small>
  </div>;
}
