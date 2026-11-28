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
    selectors: ['.map-canvas', '.map-toolbar'],
    tagZh: '地图足迹 · 点亮城市',
    tagEn: 'Map · Light Up Cities',
    titleZh: '点省份进市级地图，再点城市直接点亮',
    titleEn: 'Tap a province, then tap any city to light it up',
    descZh: '点击任意省份进市级地图，点城市即可点亮「已去过」（再点可进手账或取消）；规划好的行程到期后也会自动点亮对应城市，进省还能看 5A 景区与世界遗产收集进度！',
    descEn: 'Tap any province to view cities and mark them visited. Planned trip cities also auto-light once their trip date arrives, and each province shows your 5A & World Heritage progress.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'map-side',
    page: 'map',
    selectors: ['.map-side', '.map-toolbar'],
    tagZh: '地图足迹 · 筛选与推荐',
    tagEn: 'Map · Filter & AI Ideas',
    titleZh: '点右侧省份快速跳转 & 进省一键问 AI',
    titleEn: 'Filter provinces & get AI ideas inside any province',
    descZh: '这里实时统计已去城市和点亮省份，可按「已点亮 / 全部 / 待探索」筛选；点任意省份标签可直达，进省后还能点「✦ AI 推荐怎么玩」。',
    descEn: 'Track visited cities and filter by Visited / All / To Go. Tap any province chip to jump in and tap "AI Trip Ideas" for quick inspiration.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'planner-ai-bar',
    page: 'plan',
    selectors: ['.planner-service-toggle', '.ai-dock-bar', '.tour-planner-notice', '.planner-tabs'],
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
    id: 'companions-add',
    page: 'companions',
    selectors: ['.chat-search-box', '.chat-plus-wrap', '.companions-feature-grid', '.nav-item.nav-companions'],
    tagZh: '同行旅伴 · 怎么加好友',
    tagEn: 'Companions · Add Friends',
    titleZh: '搜昵称 / 好友码，或点「＋」扫码加好友',
    titleEn: 'Search nickname/code or tap "+" to add friends',
    descZh: '登录后在顶部搜索框输入好友昵称或好友码，或点右上角「＋」用名片二维码/面对面建群添加旅伴；加好友后可点「对比足迹地图」互看点亮城市！',
    descEn: 'Sign in and search by nickname or friend code, or tap "+" for QR code / face-to-face groups. Then tap "Compare Map" to view shared footprints!',
    padding: 6,
    radius: 14,
  },
  {
    id: 'companions-share',
    page: 'companions',
    selectors: ['.chat-plus-wrap', '.companions-hero-card', '.nav-item.nav-companions'],
    tagZh: '同行旅伴 · 怎么发攻略',
    tagEn: 'Companions · Share Plans',
    titleZh: '好友点「发攻略」，或发周游口令一键共编',
    titleEn: 'Tap "Send Plan" or share a trip code to co-edit',
    descZh: '在好友卡片上直接点「发攻略」，或在行程详情顶部的协作栏生成「周游口令 / 链接」发给微信好友；对方粘贴口令即可一键保存或拉群共编与 AA 算账！',
    descEn: 'Tap "Send Plan" on any friend, or generate a share code/link in your itinerary to send via chat—friends can save it or co-edit and split AA costs.',
    padding: 6,
    radius: 14,
  },
  {
    id: 'journal',
    page: 'detail',
    selectors: ['.nav-item.nav-detail'],
    tagZh: '旅行手账',
    tagEn: 'Travel Journal',
    titleZh: '分地区按景点传图回忆 · 行程到点自动入账',
    titleEn: 'Photos by region & spot · Auto-added from trips',
    descZh: '行程里的景点过点后会自动加入对应城市手账，在行程页点「去加照片」或手动「标记已游玩」即可直达该景点手账传原图、实况与语音，同时自动点亮 5A / 世界遗产图鉴！',
    descEn: 'Itinerary sights auto-join your journal once their time passes—tap "Add Photos" or mark visited manually to jump straight to that spot, while auto-lighting your 5A & World Heritage atlas.',
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

  // 进入 AI 规划表单演示步骤时，通知 PlannerWorkspace 展开新建表单，保证高亮框 100% 精准对应
  useEffect(() => {
    if (!open) return;
    const needsCreateForm = step.id === 'planner-inputs' || step.id === 'planner-imports' || step.id === 'planner-submit';
    if (needsCreateForm) {
      const fire = () => window.dispatchEvent(new CustomEvent('zhouyou-onboarding-planner', { detail: { mode: 'create' } }));
      fire();
      const t1 = window.setTimeout(fire, 140);
      return () => window.clearTimeout(t1);
    }
    return undefined;
  }, [open, step.id, currentPage]);

  const finish = useCallback(() => {
    window.dispatchEvent(new CustomEvent('zhouyou-onboarding-planner', { detail: { mode: 'restore' } }));
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
      onClick={goNext}
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

      {/* 紧凑平稳停靠栏：固定居中，轻点屏幕任意处即可跳到下一步 */}
      <div className={`zy-onboarding-dock${dockAtTop ? ' is-top' : ''}`}>
        <div className="zy-onboarding-dock-top">
          <span className="zy-onboarding-badge">
            {isEn ? step.tagEn : step.tagZh} · {stepIndex + 1}/{STEPS.length}
          </span>
          <button
            type="button"
            className="zy-onboarding-skip"
            onClick={(e) => { e.stopPropagation(); finish(); }}
          >
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
                onClick={(e) => { e.stopPropagation(); setStepIndex(idx); }}
              />
            ))}
          </div>

          <div className="zy-onboarding-actions">
            {!isFirst && (
              <button
                type="button"
                className="secondary zy-onboarding-btn-prev"
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
              >
                {t('上一步', 'Back')}
              </button>
            )}
            <button
              type="button"
              className="primary zy-onboarding-btn-next"
              onClick={(e) => { e.stopPropagation(); goNext(); }}
            >
              {isLast ? t('开始体验 ✓', 'Done ✓') : t('下一步 →', 'Next →')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
