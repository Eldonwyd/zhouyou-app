import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

export interface ThemedDatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  title?: string;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const ITEM_HEIGHT = 44;
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function todayParts(): DateParts {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function parseIsoDate(raw: string | undefined): DateParts | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12) return null;
  const maxD = daysInMonth(year, month);
  if (day < 1 || day > maxD) return null;
  return { year, month, day };
}

function formatIsoDate(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function clampDateParts(parts: DateParts, min?: DateParts | null, max?: DateParts | null): DateParts {
  const clampedDay = Math.min(parts.day, daysInMonth(parts.year, parts.month));
  let result: DateParts = { year: parts.year, month: parts.month, day: clampedDay };
  const iso = formatIsoDate(result);
  if (min && iso < formatIsoDate(min)) result = { ...min };
  if (max && formatIsoDate(result) > formatIsoDate(max)) result = { ...max };
  return result;
}

interface WheelColumnProps {
  items: Array<{ value: number; label: string }>;
  selectedValue: number;
  onSelect: (value: number) => void;
  ariaLabel: string;
}

/** 单列滚轮：基于原生 scroll-snap，兼容移动端触摸惯性、鼠标滚轮与点击吸附。 */
function WheelColumn({ items, selectedValue, onSelect, ariaLabel }: WheelColumnProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const isProgrammaticRef = useRef(false);

  const selectedIndex = useMemo(() => {
    const idx = items.findIndex((item) => item.value === selectedValue);
    return idx >= 0 ? idx : 0;
  }, [items, selectedValue]);

  // 同步外部选中值到滚动位置
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const targetTop = selectedIndex * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - targetTop) > 2) {
      isProgrammaticRef.current = true;
      el.scrollTop = targetTop;
      window.setTimeout(() => { isProgrammaticRef.current = false; }, 80);
    }
  }, [selectedIndex, items.length]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  const commitFromScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || items.length === 0) return;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
    const nextItem = items[idx];
    if (nextItem && nextItem.value !== selectedValue) {
      onSelect(nextItem.value);
    }
  }, [items, onSelect, selectedValue]);

  const handleScroll = useCallback(() => {
    if (isProgrammaticRef.current) return;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(commitFromScroll, 65);
  }, [commitFromScroll]);

  const handleClickItem = (index: number, value: number) => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'smooth' });
    }
    if (value !== selectedValue) {
      onSelect(value);
    }
  };

  return (
    <div
      ref={listRef}
      className="themed-date-wheel-col"
      role="listbox"
      aria-label={ariaLabel}
      onScroll={handleScroll}
    >
      <div className="themed-date-wheel-spacer" aria-hidden="true" />
      {items.map((item, idx) => {
        const active = item.value === selectedValue;
        return (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={active}
            className={`themed-date-wheel-item${active ? ' is-active' : ''}`}
            onClick={() => handleClickItem(idx, item.value)}
          >
            {item.label}
          </button>
        );
      })}
      <div className="themed-date-wheel-spacer" aria-hidden="true" />
    </div>
  );
}

/**
 * 跟随全站 5 套外观风格与深浅模式的自定义滚轮日期选择器：
 * - 彻底替代 Android/WebView 风格不搭的原生灰色日历弹窗
 * - 年 / 月 / 日三列独立滚轮，月份无需再逐月点击
 */
export default function ThemedDatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder,
  title,
  required = false,
  clearable,
  disabled = false,
  className = '',
  ariaLabel,
}: ThemedDatePickerProps) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 850 : false));
  const dialogId = useId();

  const minParts = useMemo(() => parseIsoDate(min), [min]);
  const maxParts = useMemo(() => parseIsoDate(max), [max]);
  const parsedValue = useMemo(() => parseIsoDate(value), [value]);

  const [draft, setDraft] = useState<DateParts>(() => clampDateParts(parsedValue ?? todayParts(), minParts, maxParts));

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 850);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    setDraft(clampDateParts(parsedValue ?? todayParts(), minParts, maxParts));
    setOpen(true);
  };

  const nowYear = new Date().getFullYear();
  const startYear = Math.min(minParts?.year ?? 1970, draft.year, nowYear - 50);
  const endYear = Math.max(maxParts?.year ?? nowYear + 10, draft.year, nowYear + 10);

  const yearItems = useMemo(() => {
    const list: Array<{ value: number; label: string }> = [];
    for (let y = startYear; y <= endYear; y += 1) {
      list.push({ value: y, label: lang === 'en' ? String(y) : `${y}年` });
    }
    return list;
  }, [startYear, endYear, lang]);

  const monthItems = useMemo(() => {
    const minM = minParts && draft.year === minParts.year ? minParts.month : 1;
    const maxM = maxParts && draft.year === maxParts.year ? maxParts.month : 12;
    const list: Array<{ value: number; label: string }> = [];
    for (let m = minM; m <= maxM; m += 1) {
      list.push({ value: m, label: lang === 'en' ? pad2(m) : `${m}月` });
    }
    return list;
  }, [draft.year, minParts, maxParts, lang]);

  const dayItems = useMemo(() => {
    const total = daysInMonth(draft.year, draft.month);
    const minD = minParts && draft.year === minParts.year && draft.month === minParts.month ? minParts.day : 1;
    const maxD = maxParts && draft.year === maxParts.year && draft.month === maxParts.month ? maxParts.day : total;
    const list: Array<{ value: number; label: string }> = [];
    for (let d = minD; d <= maxD; d += 1) {
      list.push({ value: d, label: lang === 'en' ? pad2(d) : `${d}日` });
    }
    return list;
  }, [draft.year, draft.month, minParts, maxParts, lang]);

  const updateYear = useCallback((year: number) => {
    setDraft((prev) => clampDateParts({ ...prev, year }, minParts, maxParts));
  }, [minParts, maxParts]);

  const updateMonth = useCallback((month: number) => {
    setDraft((prev) => clampDateParts({ ...prev, month }, minParts, maxParts));
  }, [minParts, maxParts]);

  const updateDay = useCallback((day: number) => {
    setDraft((prev) => clampDateParts({ ...prev, day }, minParts, maxParts));
  }, [minParts, maxParts]);

  const handleConfirm = () => {
    const nextIso = formatIsoDate(clampDateParts(draft, minParts, maxParts));
    onChange(nextIso);
    setOpen(false);
  };

  const handleToday = () => {
    const today = clampDateParts(todayParts(), minParts, maxParts);
    setDraft(today);
  };

  const canClear = clearable ?? !required;
  const handleClear = () => {
    onChange('');
    setOpen(false);
  };

  const draftDateObj = new Date(draft.year, draft.month - 1, draft.day);
  const weekdayLabel = lang === 'en'
    ? WEEKDAYS_EN[draftDateObj.getDay()]
    : WEEKDAYS_ZH[draftDateObj.getDay()];
  const previewHeadline = lang === 'en'
    ? `${formatIsoDate(draft)} (${weekdayLabel})`
    : `${draft.year}年${draft.month}月${draft.day}日 · ${weekdayLabel}`;

  const displayText = parsedValue
    ? formatIsoDate(parsedValue)
    : (placeholder || t('选择日期', 'Select date'));

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || title || t('选择日期', 'Select date')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        className={`themed-date-trigger${open ? ' is-open' : ''}${!parsedValue ? ' is-placeholder' : ''}${className ? ` ${className}` : ''}`}
        onClick={openPicker}
      >
        <span className="themed-date-trigger-value">{displayText}</span>
        <svg className="themed-date-trigger-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <rect x="2.5" y="4" width="15" height="13.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.5 2.5v3M13.5 2.5v3M2.5 8.2h15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className={`themed-date-backdrop${isMobile ? ' is-sheet' : ' is-modal'}`}
          onClick={() => setOpen(false)}
        >
          <div
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-label={title || t('选择日期', 'Select Date')}
            className={`themed-date-panel${isMobile ? ' is-sheet' : ' is-modal'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {isMobile && <span className="themed-select-grabber" aria-hidden="true" />}
            <div className="themed-date-head">
              <button type="button" className="themed-date-action-cancel" onClick={() => setOpen(false)}>
                {t('取消', 'Cancel')}
              </button>
              <div className="themed-date-title-wrap">
                <strong>{title || t('选择日期', 'Select Date')}</strong>
                <span className="themed-date-preview">{previewHeadline}</span>
              </div>
              <button type="button" className="themed-date-action-confirm" onClick={handleConfirm}>
                {t('确定', 'Done')}
              </button>
            </div>

            <div className="themed-date-wheel-stage">
              <div className="themed-date-wheel-highlight" aria-hidden="true" />
              <div className="themed-date-wheel-columns">
                <WheelColumn
                  items={yearItems}
                  selectedValue={draft.year}
                  onSelect={updateYear}
                  ariaLabel={t('年份', 'Year')}
                />
                <WheelColumn
                  items={monthItems}
                  selectedValue={draft.month}
                  onSelect={updateMonth}
                  ariaLabel={t('月份', 'Month')}
                />
                <WheelColumn
                  items={dayItems}
                  selectedValue={draft.day}
                  onSelect={updateDay}
                  ariaLabel={t('日期', 'Day')}
                />
              </div>
            </div>

            <div className="themed-date-foot">
              <button type="button" className="themed-date-quick-btn" onClick={handleToday}>
                {t('回到今天', 'Today')}
              </button>
              {canClear && (
                <button type="button" className="themed-date-quick-btn is-subtle" onClick={handleClear}>
                  {t('清除日期', 'Clear')}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
