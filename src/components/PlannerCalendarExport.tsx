import { useState } from 'react';
import type { AiTravelPlan } from '../planner-types';
import { exportCalendarEvent } from '../calendar';
import { addPlannerDays } from '../planner-domain';
import { TravelIcon } from './TravelArt';

/** 可爱手绘小日历吊饰：为行程提醒副券增添手账温度。 */
function CalendarStubCharm() {
  return (
    <svg className="planner-calendar-charm" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="28" height="24" rx="7" fill="#fffdf8" stroke="#4a372d" strokeWidth="1.9" />
      <path d="M4 15a7 7 0 0 1 7-7h14a7 7 0 0 1 7 7v1H4v-1Z" fill="#ff8f7a" stroke="#4a372d" strokeWidth="1.9" />
      <path d="M12 5v5M24 5v5" stroke="#4a372d" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="13.5" cy="22.5" r="1.5" fill="#4a372d" />
      <circle cx="22.5" cy="22.5" r="1.5" fill="#4a372d" />
      <ellipse cx="10.4" cy="25" rx="1.8" ry="1.1" fill="#ff8f7a" opacity="0.65" />
      <ellipse cx="25.6" cy="25" rx="1.8" ry="1.1" fill="#ff8f7a" opacity="0.65" />
      <path d="M15.8 25.4c1 1.3 3.4 1.3 4.4 0" stroke="#4a372d" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M31 4l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9Z" fill="#ffd166" />
    </svg>
  );
}

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

  return (
    <div className="planner-calendar-export">
      <div className="planner-calendar-stub-head" aria-hidden="true">
        <CalendarStubCharm />
        <span className="planner-calendar-stub-title">出发提醒券</span>
        <span className="planner-calendar-stub-star cute-deco">✦</span>
      </div>
      <div className="planner-calendar-controls">
        <label className="planner-calendar-select-wrap">
          <span>提前提醒</span>
          <select value={reminderDays} disabled={disabled || exporting} onChange={(event) => setReminderDays(Number(event.target.value))}>
            <option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option>
          </select>
        </label>
        <button type="button" className="planner-calendar-btn secondary" disabled={disabled || exporting} onClick={() => void exportCalendar()}>
          <TravelIcon name="plan" />
          {exporting ? '导出中…' : '导出到系统日历'}
        </button>
      </div>
      <small className="planner-calendar-hint">
        <time dateTime={reminderDate}>{Number(reminderDate.slice(5, 7))} 月 {Number(reminderDate.slice(8, 10))} 日</time>提醒 · 导入日历后生效
      </small>
    </div>
  );
}
