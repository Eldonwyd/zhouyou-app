import type { BudgetCategory, CategoryAmounts, DayPeriod } from './types.ts';
import { BUDGET_CATEGORIES } from './types.ts';

/**
 * Create stable local record IDs on both HTTPS and a phone's LAN HTTP preview.
 * randomUUID is secure-context-only, while getRandomValues also works on the
 * local HTTP address. The UUID version and variant bits follow RFC 4122.
 */
export function createLocalId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

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

export function isQuotaStorageError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
  }
  return false;
}

export function describeStorageError(error: unknown): string {
  if (isQuotaStorageError(error)) {
    return '设备或浏览器存储空间不足。请先导出备份并清理部分媒体。';
  }
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
