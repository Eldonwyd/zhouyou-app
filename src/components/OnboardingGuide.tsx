import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PageName } from '../types';
import { useI18n } from '../i18n';

export const ONBOARDING_STORAGE_KEY = 'zhouyou-onboarding-completed-v1';

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface OnboardingStep {
  id: string;
  page?: PageName;
  /** CSS selector(s) in priority order; first visible match gets spotlighted. */
  selectors?: string[];
  tagZh: string;
  tagEn: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  padding?: number;
  radius?: number;
}

const STEPS: OnboardingStep[] = [
  {
    id: 'map-click',
    page: 'map',
    selectors: ['.map-toolbar', '.map-canvas'],
    tagZh: '地图足迹',
    tagEn: 'Footprint Map',
    titleZh: '点击省份进入市级，再点城市即可点亮',
    titleEn: 'Tap a province, then tap any city to light it up',
    descZh: '未登录也可先点亮体验，登录账号后可多端同步保存足迹。右侧可按「已点亮 / 待探索」筛选。',
    descEn: 'Try lighting cities right away; sign in to save and sync across devices. Filter provinces on the right.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'planner-ai-bar',
    page: 'plan',
    selectors: ['#planner-ai-tools', '.planner-service-toggle', '.planner-tabs'],
    tagZh: 'AI 规划 · 关键键 1',
    tagEn: 'AI Planner · Key 1',
    titleZh: '点这里看免费 AI 额度或切换模型',
    titleEn: 'Tap here for free AI quota or custom models',
    descZh: '游客可免费完整规划 1 次；登录后享每日 5 万 tokens 免费额度，也可绑定自己的 DeepSeek / Gemini / OpenAI。',
    descEn: 'Guests get 1 full free trip plan; sign in for 50k daily free tokens, or connect your own API key.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'planner-inputs',
    page: 'plan',
    selectors: ['.planner-create .planner-input-grid', '.planner-create', '.planner-tabs'],
    tagZh: 'AI 规划 · 关键键 2',
    tagEn: 'AI Planner · Key 2',
    titleZh: '填好目的地、人数和出发日期',
    titleEn: 'Enter destination, travelers, and dates',
    descZh: '没想好去哪可以把「目的地」留空让 AI 推荐；「天数」留空则先让 AI 建议玩几天。',
    descEn: 'Leave destination blank for AI ideas, or leave days blank for AI duration recommendations.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'planner-imports',
    page: 'plan',
    selectors: ['.planner-optional-imports', '.planner-overview-actions', '.planner-tabs'],
    tagZh: 'AI 规划 · 关键键 3',
    tagEn: 'AI Planner · Key 3',
    titleZh: '点开这里导入小红书攻略或已订机酒车票',
    titleEn: 'Expand to import Xiaohongshu notes or booked tickets',
    descZh: '可上传小红书截图/链接，或提前录入已订高铁、机票与酒店，AI 会按你的真实预订来排每日路线。',
    descEn: 'Import Xiaohongshu links/screenshots or booked flights/trains/hotels so AI schedules around them.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'planner-submit',
    page: 'plan',
    selectors: ['[data-tour="planner-submit-actions"]', '[data-tour="planner-submit-btn"]', '.planner-tabs'],
    tagZh: 'AI 规划 · 核心按钮',
    tagEn: 'AI Planner · Generate',
    titleZh: '点左键一键生成路书 · 右键借用外部免费 AI',
    titleEn: 'Tap Generate for AI roadbook · Or use free external AI',
    descZh: '点「生成旅行计划」几秒产出完整日程与预算；点右侧「借用外部免费 AI」可零成本复制去豆包/DeepSeek 生成再导入。',
    descEn: 'Tap Generate for a full itinerary & budget, or tap the right button to import from external free AIs.',
    padding: 8,
    radius: 14,
  },
  {
    id: 'companions',
    page: 'companions',
    selectors: ['.nav-item.nav-companions'],
    tagZh: '同行旅伴',
    tagEn: 'Companions',
    titleZh: '登录后可加好友、建行程群共编与 AA 算账',
    titleEn: 'Sign in for friends, group co-editing & AA split',
    descZh: '好友功能需登录使用：可互看中国足迹地图、拉群一起修改攻略并自动结算旅途 AA 账单。',
    descEn: 'Sign in to compare maps with friends, co-edit trip plans in group chats, and settle AA expenses.',
    padding: 5,
    radius: 12,
  },
  {
    id: 'journal',
    page: 'detail',
    selectors: ['.nav-item.nav-detail'],
    tagZh: '旅行手账',
    tagEn: 'Travel Journal',
    titleZh: '点这里记录旅程、原图照片、实况与语音',
    titleEn: 'Tap here for trips, full-res photos & voice memos',
    descZh: '未登录也能直接保存到本机，登录后可多端同步文字与足迹记录。',
    descEn: 'Saves locally even without signing in; sign in to sync notes and footprints across devices.',
    padding: 5,
    radius: 12,
  },
  {
    id: 'profile',
    page: 'profile',
    selectors: ['.nav-item.nav-profile'],
    tagZh: '个人中心',
    tagEn: 'Personal Center',
    titleZh: '换皮肤、看徽章、切换账号 & 随时重看指引',
    titleEn: 'Skins, badges, account switch & replay guide',
    descZh: '这里可切换 5 套皮肤、退出/切换账号，以后忘了怎么点随时在底部「新手指引」重看！',
    descEn: 'Switch 5 skins, log out or switch accounts, and replay this guide anytime at the bottom.',
    padding: 5,
    radius: 12,
  },
];

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
}

function isElementVisible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 4 && rect.height > 4;
}

function findStepTarget(step: OnboardingStep): HTMLElement | null {
  if (!step.selectors?.length) return null;
  for (const selector of step.selectors) {
    const matches = document.querySelectorAll(selector);
    for (const el of matches) {
      if (isElementVisible(el)) return el;
    }
  }
  return null;
}

interface OnboardingGuideProps {
  open: boolean;
  currentPage: PageName;
  onNavigatePage: (page: PageName) => void;
  onClose: () => void;
}

export default function OnboardingGuide({
  open,
  currentPage,
  onNavigatePage,
  onClose,
}: OnboardingGuideProps) {
  const { isEn, t } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  const step = STEPS[stepIndex] ?? STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setTargetRect(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !step.page) return;
    if (currentPage !== step.page) {
      onNavigatePage(step.page);
    }
  }, [open, step.page, currentPage, onNavigatePage]);

  const finish = useCallback(() => {
    markOnboardingCompleted();
    onClose();
  }, [onClose]);

  const goNext = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, finish]);

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, finish, goNext, goPrev]);

  useEffect(() => {
    if (!open) return;
    if (!step.selectors?.length) {
      setTargetRect(null);
      return;
    }

    let disposed = false;
    let retryCount = 0;
    let retryTimer: number | null = null;
    let scrolledOnce = false;

    const measure = () => {
      if (disposed) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewport({ w: vw, h: vh });

      const el = findStepTarget(step);
      if (!el) {
        setTargetRect(null);
        if (retryCount < 20) {
          retryCount += 1;
          retryTimer = window.setTimeout(measure, 120);
        }
        return;
      }

      const raw = el.getBoundingClientRect();
      if (!scrolledOnce && (raw.top < 64 || raw.bottom > vh - 165) && raw.height < vh * 0.7) {
        scrolledOnce = true;
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch {
          /* ignore */
        }
        retryTimer = window.setTimeout(measure, 240);
        return;
      }

      const pad = step.padding ?? 6;
      const maxSpotHeight = Math.max(120, vh - 220);
      const clampedTop = Math.max(6, raw.top - pad);
      const clampedLeft = Math.max(6, raw.left - pad);
      const clampedWidth = Math.min(vw - clampedLeft - 6, raw.width + pad * 2);
      const rawHeight = raw.height + pad * 2;
      const clampedHeight = Math.min(vh - clampedTop - 6, rawHeight > vh * 0.7 ? maxSpotHeight : rawHeight);

      setTargetRect({
        top: clampedTop,
        left: clampedLeft,
        width: Math.max(32, clampedWidth),
        height: Math.max(32, clampedHeight),
        radius: step.radius ?? 14,
      });
    };

    measure();
    const settleTimer = window.setTimeout(measure, 240);
    const onViewportChange = () => measure();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, step, currentPage]);

  if (!open || typeof document === 'undefined') return null;

  const maskId = 'zy-onboarding-spotlight-mask';
  // 固定停靠在底部居中，不随步骤满屏乱跳；仅当高亮目标本身在底部 190px 内时才平稳避让到顶部居中
  const dockAtTop = Boolean(targetRect && targetRect.top + targetRect.height > viewport.h - 190 && targetRect.top > 180);

  return createPortal(
    <div
      className="zy-onboarding-root"
      role="dialog"
      aria-modal="true"
      aria-label={t('新手指引', 'Interactive Onboarding Guide')}
    >
      <svg className="zy-onboarding-backdrop" width={viewport.w} height={viewport.h} aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={viewport.w} height={viewport.h} fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx={targetRect.radius}
                ry={targetRect.radius}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={viewport.w}
          height={viewport.h}
          fill="rgba(16, 22, 28, 0.56)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {targetRect && (
        <div
          className="zy-onboarding-spotlight-ring"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
            borderRadius: `${targetRect.radius}px`,
          }}
          aria-hidden="true"
        >
          <span className="zy-onboarding-spot-tag">{t('看这里', 'Here')}</span>
        </div>
      )}

      {/* 紧凑平稳停靠栏：固定居中，不再满屏乱跳 */}
      <div className={`zy-onboarding-dock${dockAtTop ? ' is-top' : ''}`}>
        <div className="zy-onboarding-dock-top">
          <span className="zy-onboarding-badge">
            {isEn ? step.tagEn : step.tagZh} · {stepIndex + 1}/{STEPS.length}
          </span>
          <button type="button" className="zy-onboarding-skip" onClick={finish}>
            {t('跳过', 'Skip')}
          </button>
        </div>

        <h2 className="zy-onboarding-title">{isEn ? step.titleEn : step.titleZh}</h2>
        <p className="zy-onboarding-desc">{isEn ? step.descEn : step.descZh}</p>

        <div className="zy-onboarding-footer">
          <div className="zy-onboarding-dots" role="tablist" aria-label={t('指引进度', 'Tour progress')}>
            {STEPS.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={idx === stepIndex}
                aria-label={t(`第 ${idx + 1} 步`, `Step ${idx + 1}`)}
                className={`zy-onboarding-dot${idx === stepIndex ? ' is-active' : idx < stepIndex ? ' is-done' : ''}`}
                onClick={() => setStepIndex(idx)}
              />
            ))}
          </div>

          <div className="zy-onboarding-actions">
            {!isFirst && (
              <button type="button" className="secondary zy-onboarding-btn-prev" onClick={goPrev}>
                {t('上一步', 'Back')}
              </button>
            )}
            <button type="button" className="primary zy-onboarding-btn-next" onClick={goNext}>
              {isLast ? t('开始体验 ✓', 'Done ✓') : t('下一步 →', 'Next →')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
