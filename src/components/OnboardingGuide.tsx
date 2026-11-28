import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  badgeZh: string;
  badgeEn: string;
  icon: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  tapHintZh?: string;
  tapHintEn?: string;
  /** Optional feature chips shown on welcome/summary steps */
  chips?: Array<{ icon: string; zh: string; en: string }>;
  padding?: number;
  radius?: number;
}

const STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    page: 'map',
    badgeZh: '新手指引 · 10 秒上手',
    badgeEn: 'Quick Tour · 10s Guide',
    icon: '🧭',
    titleZh: '欢迎来到周游地图',
    titleEn: 'Welcome to Zhouyou Map',
    descZh: '像翻开一本随身旅行小册子——我来带你一步步认清每个按钮怎么点，教你点亮全国足迹、用 AI 做路书、约旅伴共编，以及记录手账。',
    descEn: 'Your personal travel booklet. Let me walk you through where to tap to light up cities, plan trips with AI, collaborate with companions, and keep a travel journal.',
    chips: [
      { icon: '🗺️', zh: '点亮 370+ 城', en: '370+ China Cities' },
      { icon: '✨', zh: 'AI 智能路书', en: 'AI Roadbooks' },
      { icon: '🤝', zh: '旅伴共编 & AA', en: 'Group & AA Split' },
      { icon: '📷', zh: '本机旅行手账', en: 'Local Journal' },
    ],
  },
  {
    id: 'map-canvas',
    page: 'map',
    selectors: ['.map-canvas', '.map-card'],
    badgeZh: '第 1 站 · 地图足迹',
    badgeEn: 'Step 1 · Footprint Map',
    icon: '📍',
    titleZh: '点一点省份，点亮去过的城市',
    titleEn: 'Tap a Province, Light Up Your Cities',
    descZh: '点击地图上任意省份即可进入市级地图，再点击城市就能点亮为「已去过」；再次点击已点亮的城市，可直接进入旅行手账或取消点亮。',
    descEn: 'Click any province to zoom into its cities, then tap a city to mark it visited. Tap a lit city again to open its Journal or unmark it.',
    tapHintZh: '点击省份 → 点击城市点亮 · 滚轮/双指可缩放',
    tapHintEn: 'Tap province → Tap city to mark · Pinch/scroll to zoom',
    padding: 6,
    radius: 18,
  },
  {
    id: 'map-side',
    page: 'map',
    selectors: ['.map-side', '.map-toolbar'],
    badgeZh: '第 2 站 · 进度与灵感',
    badgeEn: 'Step 2 · Progress & Ideas',
    icon: '📊',
    titleZh: '查看足迹进度 & AI 推荐怎么玩',
    titleEn: 'Track Progress & Get AI Ideas',
    descZh: '右侧面板实时统计你点亮的省份和城市数，可按「已点亮 / 全部 / 待探索」快速跳转。点进任意省份后，还能一键点「✦ AI 推荐怎么玩」！',
    descEn: 'See your visited count and filter provinces by Visited, All, or To Go. Inside any province, tap "AI Trip Ideas" for instant local inspiration.',
    tapHintZh: '点省份标签快速跳转 · 进省后可一键问 AI',
    tapHintEn: 'Tap province chips to jump · Ask AI inside any province',
    padding: 8,
    radius: 18,
  },
  {
    id: 'planner-ai-bar',
    page: 'plan',
    selectors: ['#planner-ai-tools', '.planner-service-toggle', '.planner-tabs'],
    badgeZh: '第 3 站 · AI 引擎与模块',
    badgeEn: 'Step 3 · AI Setup & Tabs',
    icon: '🤖',
    titleZh: '第一步：确认 AI 引擎与规划模块',
    titleEn: 'Step 1: Check AI Engine & Planner Tabs',
    descZh: '进入「行程规划」后，先看上方 AI 状态栏：登录账号可直接用免费 AI 额度，也可点开配置自己的 DeepSeek / Gemini / OpenAI 等模型。顶部还能切换「我的行程 / 预算与账本 / 发现目的地」。',
    descEn: 'Check the AI status bar first: sign in for free AI quota, or configure your own DeepSeek / Gemini / OpenAI key. Use the top tabs to switch between My Trips, Budget & Ledger, and Discover.',
    tapHintZh: '点 AI 状态栏选模型 · 没想好去哪就点「发现目的地」',
    tapHintEn: 'Tap AI bar to choose model · Tap "Discover" for destination ideas',
    padding: 8,
    radius: 16,
  },
  {
    id: 'planner-create',
    page: 'plan',
    selectors: ['.planner-create', '.planner-plan-list', '.planner-tabs'],
    badgeZh: '第 4 站 · AI 一键做攻略',
    badgeEn: 'Step 4 · Generate AI Guide',
    icon: '✨',
    titleZh: '第二步：填好需求，让 AI 一键出路书',
    titleEn: 'Step 2: Fill Your Trip & Generate',
    descZh: '在表单里填上出发地、目的地、出行日期/天数、人数和预算偏好，点击生成即可产出完整每日行程：包含景点顺序、城际与市内交通衔接、餐饮住宿建议和费用预估。',
    descEn: 'Enter your origin, destination, dates, travelers, and budget, then generate a full day-by-day roadbook with sights, transit connections, dining, hotels, and cost estimates.',
    tapHintZh: '填目的地 + 天数 → 点生成按钮，几秒出详细路书',
    tapHintEn: 'Fill destination + days → Tap Generate for a complete itinerary',
    padding: 8,
    radius: 18,
  },
  {
    id: 'planner-refine',
    page: 'plan',
    selectors: ['.planner-optional-imports', '.planner-overview-actions', '.planner-tabs'],
    badgeZh: '第 5 站 · 导入与对话微调',
    badgeEn: 'Step 5 · Import & Chat Refine',
    icon: '💬',
    titleZh: '第三步：导入小红书/票据 & 对话改行程',
    titleEn: 'Step 3: Import Notes, Tickets & Refine',
    descZh: '生成前可展开这里上传小红书攻略截图/链接或已订机酒车票，让 AI 按你的真实预订排程；生成后还能像聊天一样让 AI 微调任意一天，并查看路线地图、开抢票提醒或一键记账！',
    descEn: 'Optionally import Xiaohongshu notes or booked tickets before generating. Afterward, chat with AI to tweak any day, view the route map, set ticket alerts, or sync to your ledger.',
    tapHintZh: '支持小红书参考 + 识票导入 + 对话修改任意安排',
    tapHintEn: 'Supports Xiaohongshu notes + ticket import + chat revisions',
    padding: 8,
    radius: 16,
  },
  {
    id: 'companions',
    page: 'companions',
    selectors: ['.nav-item.nav-companions'],
    badgeZh: '第 6 站 · 同行旅伴',
    badgeEn: 'Step 6 · Travel Companions',
    icon: '🤝',
    titleZh: '加好友、建行程群与一键 AA 算账',
    titleEn: 'Add Friends, Co-edit Trips & Split Costs',
    descZh: '点这里进入「同行旅伴」：输入好友码加旅伴、对比彼此的中国足迹地图、拉行程群边聊边共编同一份攻略，还能按人头自动算清 AA 账单。',
    descEn: 'Open Companions to add friends by code, compare China footprints, create trip group chats, co-edit itineraries in real time, and settle AA expenses.',
    tapHintZh: '点「同行旅伴」开启好友互动与多人共编',
    tapHintEn: 'Tap Companions for friends, group chats & co-editing',
    padding: 6,
    radius: 14,
  },
  {
    id: 'journal',
    page: 'detail',
    selectors: ['.warm-journal-hero', '.nav-item.nav-detail'],
    badgeZh: '第 7 站 · 旅行手账',
    badgeEn: 'Step 7 · Travel Journal',
    icon: '📖',
    titleZh: '把照片、实况与语音收进手账',
    titleEn: 'Collect Photos, Live Photos & Voice Notes',
    descZh: '在「旅行手账」里新建旅程或直接点开已去城市，上传原图照片、实况 Live Photo、视频和现场语音。所有媒体均安全保存在本机，不压缩画质。',
    descEn: 'Create trips or open any visited city to store full-res photos, Live Photos, videos, and voice memos—kept privately and lossless on your device.',
    tapHintZh: '点卡片翻开回忆 · 或点「＋ 新建旅行」记录多城旅程',
    tapHintEn: 'Tap cards to open memories · Or "+ New Trip" for multi-city journeys',
    padding: 8,
    radius: 18,
  },
  {
    id: 'profile',
    page: 'profile',
    selectors: ['.profile-achievements-entry-card', '.warm-profile-banner', '.nav-item.nav-profile'],
    badgeZh: '第 8 站 · 个人中心',
    badgeEn: 'Step 8 · Personal Center',
    icon: '🏅',
    titleZh: '徽章、换肤、备份 & 随时重看指引',
    titleEn: 'Badges, Skins, Backups & Replay Guide',
    descZh: '在「个人中心」可以查看旅途徽章、切换 5 套可爱主题皮肤、下载离线地图与导出 ZIP 备份；以后忘了怎么点，在底部「新手指引与玩法教程」随时可以重看！',
    descEn: 'View badges, switch between 5 skins, download offline maps, and export ZIP backups here. Anytime you need a refresher, replay this guide from the bottom of Personal Center!',
    tapHintZh: '个人中心底部可随时重新打开「新手指引」',
    tapHintEn: 'Replay the Interactive Guide anytime at the bottom of Personal Center',
    padding: 8,
    radius: 18,
  },
  {
    id: 'topbar',
    page: 'map',
    selectors: ['.topbar-right'],
    badgeZh: '最后一站 · 准备出发',
    badgeEn: 'Final Step · Ready to Go',
    icon: '☁️',
    titleZh: '明暗主题 & 电脑手机多端云同步',
    titleEn: 'Light/Dark Mode & Cloud Sync',
    descZh: '右上角可以一键切换浅色/深色主题，登录账号后即可在电脑与手机间实时同步足迹和 AI 攻略。现在就点下方「开始探索」，点亮你的第一座城市吧！',
    descEn: 'Switch light/dark mode or sign in up here to sync footprints and AI plans across desktop and mobile. Tap "Start Exploring" below to light up your first city!',
    tapHintZh: '一切就绪！以后想重看指引，去「个人中心」底部即可',
    tapHintEn: 'All set! Replay this guide anytime from Personal Center',
    padding: 6,
    radius: 18,
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 250 });

  const step = STEPS[stepIndex] ?? STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  // Reset to step 0 whenever opened
  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setTargetRect(null);
    }
  }, [open]);

  // Switch page automatically when the current step specifies a page
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

  // Keyboard navigation (Esc to skip, Arrows to step)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        // Avoid hijacking Enter if user focused Skip or Back button
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
        if (event.key === 'Enter' && activeTag === 'BUTTON') return;
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

  // Locate and measure the target element (with retries for lazy-loaded views)
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
      // If element is far outside viewport vertically, gently scroll it into view once
      if (!scrolledOnce && (raw.top < 60 || raw.bottom > vh - 40) && raw.height < vh * 0.78) {
        scrolledOnce = true;
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        } catch {
          /* ignore */
        }
        retryTimer = window.setTimeout(measure, 240);
        return;
      }

      const pad = step.padding ?? 8;
      // Clamp spotlight height so huge elements still leave room for the tooltip card
      const maxSpotHeight = Math.max(160, vh - 270);
      const clampedTop = Math.max(8, raw.top - pad);
      const clampedLeft = Math.max(8, raw.left - pad);
      const clampedWidth = Math.min(vw - clampedLeft - 8, raw.width + pad * 2);
      const rawHeight = raw.height + pad * 2;
      const clampedHeight = Math.min(vh - clampedTop - 8, rawHeight > vh * 0.76 ? maxSpotHeight : rawHeight);

      setTargetRect({
        top: clampedTop,
        left: clampedLeft,
        width: Math.max(36, clampedWidth),
        height: Math.max(36, clampedHeight),
        radius: step.radius ?? 16,
      });
    };

    measure();
    // Re-measure shortly after transition/lazy render settles
    const settleTimer = window.setTimeout(measure, 220);
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

  // Measure tooltip card dimensions for precise placement
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize({ w: rect.width, h: rect.height });
    }
  }, [open, stepIndex, targetRect, viewport.w]);

  const cardPlacement = useMemo(() => {
    const margin = 14;
    const gap = 16;
    const vw = viewport.w;
    const vh = viewport.h;
    const cardW = Math.min(cardSize.w || 360, vw - margin * 2);
    const cardH = cardSize.h || 240;

    if (!targetRect) {
      return {
        centered: true,
        arrow: 'none' as const,
        style: undefined,
      };
    }

    const spaceBelow = vh - (targetRect.top + targetRect.height) - margin;
    const spaceAbove = targetRect.top - margin;
    const spaceRight = vw - (targetRect.left + targetRect.width) - margin;
    const spaceLeft = targetRect.left - margin;

    let top = 0;
    let left = 0;
    let arrow: 'top' | 'bottom' | 'left' | 'right' | 'none' = 'none';

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    if (spaceBelow >= cardH + gap) {
      top = targetRect.top + targetRect.height + gap;
      left = targetCenterX - cardW / 2;
      arrow = 'top';
    } else if (spaceAbove >= cardH + gap) {
      top = targetRect.top - cardH - gap;
      left = targetCenterX - cardW / 2;
      arrow = 'bottom';
    } else if (vw >= 760 && spaceRight >= cardW + gap) {
      left = targetRect.left + targetRect.width + gap;
      top = targetCenterY - cardH / 2;
      arrow = 'left';
    } else if (vw >= 760 && spaceLeft >= cardW + gap) {
      left = targetRect.left - cardW - gap;
      top = targetCenterY - cardH / 2;
      arrow = 'right';
    } else {
      // Fallback: pin neatly at bottom or top away from target center
      left = (vw - cardW) / 2;
      top = targetCenterY > vh / 2 ? margin + 12 : vh - cardH - margin - 12;
      arrow = 'none';
    }

    left = Math.max(margin, Math.min(vw - cardW - margin, left));
    top = Math.max(margin, Math.min(vh - cardH - margin, top));

    return {
      centered: false,
      arrow,
      style: {
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
      },
    };
  }, [targetRect, viewport, cardSize]);

  if (!open || typeof document === 'undefined') return null;

  const maskId = 'zy-onboarding-spotlight-mask';
  const pointerPos = targetRect
    ? {
        left: Math.min(viewport.w - 36, Math.max(20, targetRect.left + targetRect.width * 0.68)),
        top: Math.min(viewport.h - 36, Math.max(20, targetRect.top + targetRect.height * 0.52)),
      }
    : null;

  return createPortal(
    <div
      className="zy-onboarding-root"
      role="dialog"
      aria-modal="true"
      aria-label={t('新手指引', 'Interactive Onboarding Guide')}
    >
      {/* Dimmed backdrop with smooth rounded spotlight cutout */}
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
          fill="rgba(16, 22, 28, 0.64)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* Glowing spotlight ring + bouncing tap pointer on the highlighted element */}
      {targetRect && (
        <>
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
          />
          {pointerPos && (
            <div
              className="zy-onboarding-tap-beacon"
              style={{ top: `${pointerPos.top}px`, left: `${pointerPos.left}px` }}
              aria-hidden="true"
            >
              <span className="zy-onboarding-ripple" />
              <span className="zy-onboarding-finger">👆</span>
            </div>
          )}
        </>
      )}

      {/* Floating Guide Card */}
      <div
        ref={cardRef}
        className={`zy-onboarding-card${cardPlacement.centered ? ' is-centered' : ''}${
          cardPlacement.arrow !== 'none' ? ` arrow-${cardPlacement.arrow}` : ''
        }`}
        style={cardPlacement.style}
      >
        <div className="zy-onboarding-head">
          <span className="zy-onboarding-badge">
            <span aria-hidden="true">{step.icon}</span>
            {isEn ? step.badgeEn : step.badgeZh}
          </span>
          <button
            type="button"
            className="zy-onboarding-skip"
            onClick={finish}
          >
            {t('跳过', 'Skip')}
          </button>
        </div>

        <h2 className="zy-onboarding-title">{isEn ? step.titleEn : step.titleZh}</h2>
        <p className="zy-onboarding-desc">{isEn ? step.descEn : step.descZh}</p>

        {step.chips && (
          <div className="zy-onboarding-chips">
            {step.chips.map((chip) => (
              <span key={chip.zh} className="zy-onboarding-chip">
                <i aria-hidden="true">{chip.icon}</i>
                {isEn ? chip.en : chip.zh}
              </span>
            ))}
          </div>
        )}

        {(step.tapHintZh || step.tapHintEn) && (
          <div className="zy-onboarding-hint">
            <span className="zy-onboarding-hint-dot" aria-hidden="true">👉</span>
            <span>{isEn ? step.tapHintEn : step.tapHintZh}</span>
          </div>
        )}

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
              {isFirst
                ? t('开始指引 →', 'Start Tour →')
                : isLast
                  ? t('开始探索 ✓', 'Start Exploring ✓')
                  : t('下一步 →', 'Next →')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
