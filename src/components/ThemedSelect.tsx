import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ThemedSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface ThemedSelectProps {
  id?: string;
  value: string;
  options: ThemedSelectOption[];
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}

/**
 * 跟随全站 5 套外观风格与明暗模式的自定义选择器：
 * - 手机端弹出圆角底部抽屉（替代安卓 WebView 生硬的原生白色方框）
 * - 电脑端弹出贴合主题色的柔和浮层菜单
 */
export default function ThemedSelect({
  id,
  value,
  options,
  placeholder = '请选择…',
  title,
  disabled = false,
  className = '',
  onChange,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 850 : false));
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected = options.find((opt) => opt.value === value);
  const displayLabel = selected ? selected.label : placeholder;

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

  function toggleOpen() {
    if (disabled) return;
    if (!open && triggerRef.current && !isMobile) {
      const rect = triggerRef.current.getBoundingClientRect();
      const maxH = Math.min(280, options.length * 44 + 16);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const top = spaceBelow >= maxH || spaceBelow >= rect.top ? rect.bottom + 6 : Math.max(12, rect.top - maxH - 6);
      setMenuPos({ top, left: rect.left, width: Math.max(rect.width, 180) });
    }
    setOpen((prev) => !prev);
  }

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`themed-select-trigger${open ? ' is-open' : ''}${!selected ? ' is-placeholder' : ''}${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={toggleOpen}
      >
        <span className="themed-select-label">{displayLabel}</span>
        <span className="themed-select-chevron" aria-hidden="true">▾</span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className={`themed-select-backdrop${isMobile ? ' is-sheet' : ' is-popover'}`}
          onClick={() => setOpen(false)}
        >
          <div
            id={listboxId}
            role="listbox"
            className={`themed-select-panel${isMobile ? ' is-sheet' : ' is-popover'}`}
            style={!isMobile && menuPos ? { top: menuPos.top, left: menuPos.left, width: menuPos.width } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {isMobile && (
              <div className="themed-select-sheet-head">
                <span className="themed-select-grabber" aria-hidden="true" />
                <div className="themed-select-sheet-bar">
                  <strong>{title || placeholder}</strong>
                  <button type="button" className="themed-select-close" onClick={() => setOpen(false)}>完成</button>
                </div>
              </div>
            )}
            <div className="themed-select-options">
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`themed-select-option${active ? ' is-selected' : ''}`}
                    onClick={() => handleSelect(opt.value)}
                  >
                    <span className="themed-select-option-copy">
                      <span className="themed-select-option-title">{opt.label}</span>
                      {opt.sublabel && <small className="themed-select-option-sub">{opt.sublabel}</small>}
                    </span>
                    <span className={`themed-select-check${active ? ' is-selected' : ''}`} aria-hidden="true">
                      {active ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
