import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  formatTransferOption,
  plannerDisplayText,
  type GapTransferInfo,
} from '../planner-display';
import type {
  PlannerContent,
  PlannerTransferModeKind,
  PlannerTransferOption,
} from '../planner-types';

/** 可爱活泼的彩色手账风交通图标（内联 SVG，离线与暗色模式均清晰呈现）。 */
export function CuteTransportIcon({ mode, size = 26 }: { mode: PlannerTransferModeKind; size?: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 32 32',
    fill: 'none',
    className: `planner-transport-svg mode-${mode}`,
    'aria-hidden': true as const,
  };

  switch (mode) {
    case 'walk':
      return (
        <svg {...props}>
          {/* 轻快小脚印与活力步行小人 */}
          <circle cx="17.5" cy="6.8" r="3.1" fill="#3B8D58" />
          <path d="M12.5 14.2c1.2-2.2 3.1-3.4 5.1-3.1 1.6.2 2.4 1.5 2.7 3l1.7 1.8a1.4 1.4 0 0 1-1.9 2l-2.3-1.8-.9 3.2 2.7 4.4a1.55 1.55 0 0 1-2.6 1.6l-2.5-3.9-2.2 3.8a1.55 1.55 0 1 1-2.7-1.5l3-5.2.9-3.6-1.3 1.2a1.3 1.3 0 1 1-1.8-1.9l2.1-2Z" fill="#4BA86A" />
          <path d="M5.5 25.5h5.5M21.5 25.5h5" stroke="#8AD09E" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
          <path d="M7 11.5c1.2-.5 2.3-.4 3.2.2" stroke="#8AD09E" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case 'subway':
      return (
        <svg {...props}>
          {/* 圆润萌系地铁车头 */}
          <path d="M11 26.5 8.5 29M21 26.5l2.5 2.5M10 28h12" stroke="#78B4E3" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M13 5.2h6" stroke="#367CB6" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="7" y="6.8" width="18" height="19.2" rx="6.5" fill="#4B97D2" />
          <rect x="9.6" y="9.8" width="12.8" height="7.4" rx="3" fill="#E9F6FF" />
          <path d="M16 9.8v7.4" stroke="#B6DDF8" strokeWidth="1.4" />
          {/* 车窗小反光 */}
          <path d="M11.6 11.8l1.6 1.6" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
          {/* 微笑圆灯 */}
          <circle cx="11.5" cy="21.4" r="1.8" fill="#FFE484" />
          <circle cx="20.5" cy="21.4" r="1.8" fill="#FFE484" />
          <path d="M14.2 21.8c1 .8 2.6.8 3.6 0" stroke="#E9F6FF" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'bus':
      return (
        <svg {...props}>
          {/* 圆鼓鼓的阳光公交车 */}
          <rect x="5" y="7.5" width="22" height="16.5" rx="5.2" fill="#EC8154" />
          <rect x="7.8" y="10.4" width="16.4" height="6.8" rx="2.4" fill="#FFF3EB" />
          <path d="M16 10.4v6.8" stroke="#F6C4AB" strokeWidth="1.4" />
          <rect x="11.5" y="5.5" width="9" height="2.4" rx="1.2" fill="#D4663A" />
          <circle cx="9.6" cy="20.6" r="1.6" fill="#FFE793" />
          <circle cx="22.4" cy="20.6" r="1.6" fill="#FFE793" />
          <rect x="13.2" y="19.8" width="5.6" height="1.6" rx="0.8" fill="#FFD3BD" />
          <rect x="7.8" y="23.5" width="3.6" height="3.2" rx="1.4" fill="#5A453C" />
          <rect x="20.6" y="23.5" width="3.6" height="3.2" rx="1.4" fill="#5A453C" />
        </svg>
      );

    case 'taxi':
      return (
        <svg {...props}>
          {/* 明快小黄出租车 + 顶灯 */}
          <rect x="12.5" y="6.2" width="7" height="3.2" rx="1.4" fill="#F29E2E" />
          <path d="M14.2 7.8h3.6" stroke="#FFF9E6" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M8.5 14.5 10.7 10c.5-1 1.5-1.6 2.6-1.6h5.4c1.1 0 2.1.6 2.6 1.6l2.2 4.5Z" fill="#F8C94D" />
          <path d="M11.6 10.8h8.8l1.2 3.1H10.4l1.2-3.1Z" fill="#FFF8E1" />
          <rect x="4.8" y="13.8" width="22.4" height="9.4" rx="4.2" fill="#F6BE32" />
          {/* 格纹腰带 */}
          <path d="M11.5 18.5h2m2 0h2m2 0h2" stroke="#7A5311" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8.2" cy="18.5" r="1.7" fill="#FFFDF2" />
          <circle cx="23.8" cy="18.5" r="1.7" fill="#FFFDF2" />
          <circle cx="10.2" cy="24" r="2.6" fill="#4A4238" />
          <circle cx="10.2" cy="24" r="1.1" fill="#EAE2D3" />
          <circle cx="21.8" cy="24" r="2.6" fill="#4A4238" />
          <circle cx="21.8" cy="24" r="1.1" fill="#EAE2D3" />
          {/* 轻快小风线 */}
          <path d="M2.5 16.5h1.6M2.2 19.5h1.2" stroke="#E9A825" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'drive':
      return (
        <svg {...props}>
          {/* 活力自驾小车 + 车顶小行李包 + 微风线 */}
          <rect x="11.2" y="6.8" width="9.6" height="2.6" rx="1.3" fill="#E39A58" />
          <path d="M8 14.8 10.4 10.2c.6-1.1 1.7-1.7 2.9-1.7h5.4c1.2 0 2.3.6 2.9 1.7l2.4 4.6Z" fill="#49987B" />
          <path d="M11.4 10.8h9.2l1.3 3.2H10.1l1.3-3.2Z" fill="#EBF9F3" />
          <rect x="4.5" y="14" width="23" height="9.2" rx="4.2" fill="#3D8A6E" />
          <circle cx="8.2" cy="18.4" r="1.7" fill="#FFE793" />
          <circle cx="23.8" cy="18.4" r="1.7" fill="#FFE793" />
          <path d="M13.5 18.6c1.4.8 3.6.8 5 0" stroke="#C8EFE0" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10.2" cy="24" r="2.7" fill="#37433E" />
          <circle cx="10.2" cy="24" r="1.1" fill="#E5EFEA" />
          <circle cx="21.8" cy="24" r="2.7" fill="#37433E" />
          <circle cx="21.8" cy="24" r="1.1" fill="#E5EFEA" />
          <path d="M2.2 15.8h1.8M2.5 19.2h1.2" stroke="#7FC4A9" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'train':
      return (
        <svg {...props}>
          {/* 流畅动车车头 */}
          <path d="M9.5 26.8 7 29.2M22.5 26.8l2.5 2.4M8.8 28.4h14.4" stroke="#8AA4D6" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 12.2C8 7.8 11.4 5 16 5s8 2.8 8 7.2v9.6a4.2 4.2 0 0 1-4.2 4.2h-7.6A4.2 4.2 0 0 1 8 21.8v-9.6Z" fill="#4E73BA" />
          <path d="M10.4 11.8c0-2.1 2.2-3.6 5.6-3.6s5.6 1.5 5.6 3.6v3.6H10.4v-3.6Z" fill="#ECF3FF" />
          <path d="M8 18.4h16" stroke="#99B9F0" strokeWidth="2.2" />
          <circle cx="11.6" cy="22.1" r="1.5" fill="#FFE68C" />
          <circle cx="20.4" cy="22.1" r="1.5" fill="#FFE68C" />
        </svg>
      );

    case 'flight':
      return (
        <svg {...props}>
          {/* 萌系圆润小飞机 */}
          <path d="M5 24.5c2.2-.8 4.4-.8 6.6 0M20.5 9.2c1.4-.7 3-.6 4.2.2" stroke="#A6BBE0" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M25.6 7.4a2.3 2.3 0 0 0-3.2 0l-4.5 4.4-8.9-2.8-2 2 6.8 4.4-3.7 3.6-2.9-.7-1.4 1.4 4.1 2.1 2.1 4.1 1.4-1.4-.7-2.9 3.6-3.7 4.4 6.8 2-2-2.8-8.9 4.4-4.5a2.3 2.3 0 0 0 .4-2.8Z" fill="#5D87CE" />
          <circle cx="20.5" cy="11.5" r="1.3" fill="#EBF3FF" />
        </svg>
      );

    default:
      return (
        <svg {...props}>
          {/* 活泼路线小图钉 */}
          <circle cx="9.5" cy="10" r="3.5" fill="#5D9E6C" />
          <circle cx="9.5" cy="10" r="1.4" fill="#FFFFFF" />
          <circle cx="22.5" cy="22" r="3.5" fill="#E88855" />
          <circle cx="22.5" cy="22" r="1.4" fill="#FFFFFF" />
          <path d="M12.5 11.2c4.5 1.2 4.5 8.4 7 9.6" stroke="#6F9A77" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="2.5 3.2" />
        </svg>
      );
  }
}

/** 渲染单条结构化交通方案（美观清晰：可爱图标徽章 + 线路/方式 + 站点胶囊 + 指标徽标 + 顺风车 + 换乘提示）。 */
export function TransferOptionRow({
  option,
  content,
  showRecommendedBadge = false,
  selected = false,
  interactive = false,
  collapsedOthersCount = 0,
  onClick,
  onToggleExpand,
}: {
  option: PlannerTransferOption;
  content: PlannerContent;
  showRecommendedBadge?: boolean;
  selected?: boolean;
  interactive?: boolean;
  collapsedOthersCount?: number;
  onClick?: (event: MouseEvent) => void;
  onToggleExpand?: (event: MouseEvent) => void;
}) {
  const formatted = formatTransferOption(option);
  const body = (
    <>
      <span className={`planner-transfer-badge mode-${formatted.mode}`}>
        <CuteTransportIcon mode={formatted.mode} size={22} />
      </span>
      <div className="planner-transfer-option-body">
        <div className="planner-transfer-option-main">
          <strong className="planner-transfer-option-title">
            {plannerDisplayText(formatted.title, content)}
          </strong>
          {selected ? (
            <span className="planner-transfer-selected-tag">✓ 已选</span>
          ) : (
            showRecommendedBadge && formatted.recommended && (
              <span className="planner-transfer-rec">推荐</span>
            )
          )}
          {formatted.stations && (
            <span className="planner-transfer-stations">
              {plannerDisplayText(formatted.stations, content)}
            </span>
          )}
          <span className="planner-transfer-metrics">
            {formatted.metrics.map((metric, idx) => {
              const isFare = /¥/.test(metric);
              return (
                <span
                  className={`planner-transfer-metric${isFare ? ' is-fare' : ''}`}
                  key={`${metric}-${idx}`}
                >
                  {plannerDisplayText(metric, content)}
                </span>
              );
            })}
            {formatted.carpool && (
              <span className="planner-transfer-metric is-carpool">
                {plannerDisplayText(formatted.carpool, content)}
              </span>
            )}
          </span>
        </div>
        {formatted.note && (
          <small className="planner-transfer-note">
            {plannerDisplayText(formatted.note, content)}
          </small>
        )}
      </div>
      {interactive && (
        collapsedOthersCount > 0 ? (
          <span
            className="planner-transfer-switch-pill"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleExpand?.(event);
            }}
          >
            其他 {collapsedOthersCount} 种 ▾
          </span>
        ) : (
          <span className={`planner-transfer-check${selected ? ' is-checked' : ''}`} aria-hidden="true">
            {selected ? '✓' : ''}
          </span>
        )
      )}
    </>
  );

  const className = `planner-transfer-option mode-${formatted.mode}${formatted.recommended ? ' is-recommended' : ''}${selected ? ' is-selected' : ''}${interactive ? ' is-clickable' : ''}`;
  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        data-mode={formatted.mode}
        aria-pressed={selected}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick?.(event);
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} data-mode={formatted.mode}>
      {body}
    </div>
  );
}

function SelectableTransferOptions({
  options,
  content,
  selectedIndex,
  onSelectOption,
}: {
  options: PlannerTransferOption[];
  content: PlannerContent;
  selectedIndex?: number;
  onSelectOption?: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canSelect = options.length > 1 && Boolean(onSelectOption);
  const hasValidSelection =
    canSelect &&
    selectedIndex !== undefined &&
    selectedIndex >= 0 &&
    selectedIndex < options.length;
  const folded = hasValidSelection && !expanded;

  if (folded) {
    const chosen = options[selectedIndex];
    return (
      <div className="planner-transfer-options-list is-folded">
        <TransferOptionRow
          option={chosen}
          content={content}
          selected
          interactive
          collapsedOthersCount={options.length - 1}
          onClick={() => setExpanded(true)}
          onToggleExpand={() => setExpanded(true)}
        />
      </div>
    );
  }

  return (
    <div className="planner-transfer-options-list">
      {options.map((option, index) => (
        <TransferOptionRow
          key={`${option.mode}-${option.line ?? ''}-${index}`}
          option={option}
          content={content}
          showRecommendedBadge={options.length > 1}
          selected={hasValidSelection && index === selectedIndex}
          interactive={canSelect}
          onClick={() => {
            onSelectOption?.(index);
            setExpanded(false);
          }}
        />
      ))}
    </div>
  );
}

/** 两张卡片之间的市内交通连接条（对应独立 transport 活动卡，点击方案即可选中并折叠其余，点击右侧箭头展开编辑）。 */
export function TransferBridgeCard({
  options,
  content,
  routeLabel,
  selected,
  selectedOptionIndex,
  onSelectOption,
  children,
}: {
  options: PlannerTransferOption[];
  content: PlannerContent;
  routeLabel?: string;
  selected?: boolean;
  selectedOptionIndex?: number;
  onSelectOption?: (index: number) => void;
  children: ReactNode;
}) {
  return (
    <details
      className={`card planner-activity kind-transport planner-transfer-compact planner-transfer-bridge${selected ? ' selected' : ''}`}
      aria-label={routeLabel ? `交通衔接：${plannerDisplayText(routeLabel, content)}` : '市内交通衔接'}
    >
      <summary className="planner-transfer-summary planner-transfer-bridge-summary">
        <SelectableTransferOptions
          options={options}
          content={content}
          selectedIndex={selectedOptionIndex}
          onSelectOption={onSelectOption}
        />
        <span className="planner-transfer-chevron" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

/** 两张相邻活动卡之间的直接交通展示条（支持点击选中其中一个方案后自动折叠其他方案）。 */
export function DirectTransferBridge({
  options,
  content,
  routeLabel,
  selectedOptionIndex,
  onSelectOption,
}: {
  options: PlannerTransferOption[];
  content: PlannerContent;
  routeLabel: string;
  selectedOptionIndex?: number;
  onSelectOption?: (index: number) => void;
}) {
  return (
    <div className="planner-transfer-bridge planner-transfer-direct" role="note" aria-label={`两站交通：${routeLabel}`}>
      <SelectableTransferOptions
        options={options}
        content={content}
        selectedIndex={selectedOptionIndex}
        onSelectOption={onSelectOption}
      />
    </div>
  );
}

/** 自动查询两站路线时的轻量优雅占位条（无按钮，完成后自动替换为完整路线）。 */
export function GapTransferConnector({
  gap,
  loading,
}: {
  gap: GapTransferInfo;
  loading: boolean;
}) {
  return (
    <div
      className={`planner-transfer-bridge planner-transfer-gap${loading ? ' is-loading' : ''}`}
      role="note"
      aria-label={`两站交通：${gap.routeLabel}`}
    >
      <div className="planner-transfer-gap-inner">
        <span className="planner-transfer-gap-icons">
          {gap.modes.slice(0, 2).map((mode) => (
            <span key={mode} className={`planner-transfer-badge mode-${mode}`}>
              <CuteTransportIcon mode={mode} size={20} />
            </span>
          ))}
        </span>
        <strong className="planner-transfer-gap-label">{gap.label}</strong>
        {loading && <small className="planner-transfer-gap-hint">正在整理两站路线与耗时…</small>}
      </div>
    </div>
  );
}
