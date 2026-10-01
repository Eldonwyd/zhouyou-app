import type { BudgetCategory, CategoryAmounts, DayPeriod } from './types';
import { BUDGET_CATEGORIES } from './types';

/** Format a calendar day from the user's local timezone, avoiding UTC date shifts. */
export function localDay(date: Date): string {
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function periodFromDate(date: Date): DayPeriod {
  const hour = date.getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export function sumAmounts(amounts: CategoryAmounts): number {
  return BUDGET_CATEGORIES.reduce((sum, category: BudgetCategory) => sum + (Number(amounts[category]) || 0), 0);
}

export function currency(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function describeStorageError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return '设备或浏览器存储空间不足。请先导出备份并清理部分媒体。';
  }
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
