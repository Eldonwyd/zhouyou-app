import type { TripPlan } from './types';
import { createLocalId, downloadBlob } from './utils';

function escapeIcs(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

function nextDay(date: string): string {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + 1);
  return `${result.getFullYear()}${String(result.getMonth() + 1).padStart(2, '0')}${String(result.getDate()).padStart(2, '0')}`;
}

/** Export a local calendar event. Its VALARM is interpreted by the user's calendar app. */
export function exportCalendarEvent(
  cityName: string,
  plan: Pick<TripPlan, 'startDate' | 'endDate' | 'reminderDays'> & { id?: string; sequence?: number },
): void {
  if (!plan.startDate || !plan.endDate) throw new Error('请先填写出发与结束日期');
  if (plan.endDate < plan.startDate) throw new Error('结束日期不能早于出发日期');
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid = plan.id ? `plan-${plan.id}@travel-footprints.local` : `${createLocalId()}@travel-footprints.local`;
  const sequence = Math.max(0, Math.floor(plan.sequence ?? 0));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travel Footprints//CN',
    'BEGIN:VEVENT', `UID:${uid}`, `SEQUENCE:${sequence}`, `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${compactDate(plan.startDate)}`,
    `DTEND;VALUE=DATE:${nextDay(plan.endDate)}`,
    `SUMMARY:${escapeIcs(`前往${cityName}`)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(`即将出发前往${cityName}`)}`,
    `TRIGGER:-P${Math.max(1, plan.reminderDays)}D`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ];
  downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }), `${cityName}-旅行计划.ics`);
}
