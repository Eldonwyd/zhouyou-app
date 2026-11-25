import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdministrativeFeature, AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile, PageName, TravelMedia, TripPlan } from './types';
import { deleteMediaRecord, loadSnapshot, moveLegacyPlanToJourney, recordPlannerJournalVisit, saveItem, saveJourneyAndLinkCityRecords, saveMediaBatch, saveAiPlan as saveAiPlanRecord, saveAiPlanPhoto, publishAiPlan, upsertAiPlanFromCloud } from './db';
import type { AiTravelPlan, PlannerPhoto, PlannerPreferences } from './planner-types';
import { prefetchNationalMap, provinceCodeForCity } from './map-data';
import { describeStorageError } from './utils';
import { applyThemeMode, useThemeMode, type ThemeMode } from './theme';
import { readLanguage, syncDocumentLanguage, useI18n } from './i18n';
import { checkForAppUpdate, isNativeAppPlatform, type AppUpdateInfo } from './app-updater';
import {
  CLOUD_AUTH_EVENT,
  cloudApi,
  getCachedCloudUser,
  getCloudToken,
  type CloudNotification,
  type CloudSelfUser,
  type IntimacyBond,
} from './cloud-api';
import {
  NOTIFICATION_PREFS_EVENT,
  fireSystemNotification,
  playNotificationChime,
  readFiredTicketReminderKeys,
  readNotificationPrefs,
  readSeenNotificationIds,
  shouldNotifyForType,
  writeFiredTicketReminderKeys,
  writeSeenNotificationIds,
  type NotificationPrefs,
} from './notification-prefs';
import {
  countAllUpcomingUrgentTickets,
  mergeTicketPlanItems,
  resolveTicketReminderSchedule,
} from './planner-ticket-display';
import {
  checkCloudSyncNeeded,
  extractZhouyouActionFromUrl,
  extractZhouyouShareCode,
  getPendingCloudChangeCount,
  hasPendingCloudChanges,
  markCloudRecordDeleted,
  markCloudRecordDirty,
  markCloudStoreDirty,
  resetCloudSyncCursor,
  syncSinglePlannerPhotoToCloud,
  syncWithCloud,
} from './cloud-sync';
import {
  isEmbeddedTour,
  isWebTourMode,
  openDownloadFromTour,
  openFullscreenTour,
  tourRestrictionCopy,
  type TourRestrictedFeature,
} from './web-tour';
import MapView from './components/MapView';
import AuthModal from './components/AuthModal';
import ShareReceiveModal from './components/ShareReceiveModal';

const DEMO_ACTIVE_KEY = 'zhouyou-demo-active';
const AUTH_DISMISSED_KEY = 'zhouyou-auth-dismissed';
import { TravelCover, TravelIcon } from './components/TravelArt';
import { CuteSticker, TravelAvatar } from './components/CuteArt';

// The map is the first screen. Media parsing, ZIP backup and secondary pages
// arrive only when the user opens their respective sections.
const DetailView = lazy(() => import('./components/DetailView'));
const PlanView = lazy(() => import('./components/PlannerWorkspace'));
const CompanionsView = lazy(() => import('./components/CompanionsView'));
const AchievementsView = lazy(() => import('./components/AchievementsView'));
const ProfileView = lazy(() => import('./components/ProfileView'));

const EMPTY_SNAPSHOT: AppSnapshot = { marks: [], entries: [], plans: [], media: [], badges: [], profile: [], trips: [], places: [], aiPlans: [], plannerPreferences: [] };
const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark'];

/** 顶栏主题切换：跟随系统 → 浅色 → 深色 循环。 */
function ThemeSwitch() {
  const mode = useThemeMode();
  const { t } = useI18n();
  const themeLabels: Record<ThemeMode, { icon: string; label: string }> = {
    system: { icon: '◐', label: t('跟随系统', 'System') },
    light: { icon: '☀', label: t('浅色', 'Light') },
    dark: { icon: '☾', label: t('深色', 'Dark') },
  };
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
  return (
    <button
      type="button"
      className="theme-switch"
      title={t(
        `当前：${themeLabels[mode].label}，点击切换为${themeLabels[next].label}`,
        `Current: ${themeLabels[mode].label}. Click to switch to ${themeLabels[next].label}`,
      )}
      aria-label={t(`主题：${themeLabels[mode].label}`, `Theme: ${themeLabels[mode].label}`)}
      onClick={() => applyThemeMode(next)}
    >
      <span className="theme-switch-icon" aria-hidden="true">{themeLabels[mode].icon}</span>
      <span className="theme-switch-label">{themeLabels[mode].label}</span>
    </button>
  );
}

interface PendingCity {
  code: string;
  name: string;
  provinceCode: string;
}

export default function App() {
  const { lang, t } = useI18n();
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<PageName>('map');
  const [profileResetToken, setProfileResetToken] = useState(0);
  const [plannerOpened, setPlannerOpened] = useState(false);
  const [activeProvinceCode, setActiveProvinceCode] = useState<string | null>(null);
  const [selectedCityCode, setSelectedCityCode] = useState<string | null>(null);
  const [actionCity, setActionCity] = useState<PendingCity | null>(null);
  const [targetEntryId, setTargetEntryId] = useState<string | null>(null);
  const [targetPlaceId, setTargetPlaceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plannerProvince, setPlannerProvince] = useState<{ name: string; token: number } | null>(null);
  const [tourRestriction, setTourRestriction] = useState<TourRestrictedFeature | null>(null);
  const tourMode = useMemo(() => isWebTourMode(), []);
  const embeddedTour = useMemo(() => isEmbeddedTour(), []);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [ignoredUpdateVersion, setIgnoredUpdateVersion] = useState<string>(() => {
    try { return localStorage.getItem('zhouyou-ignored-update-version') || ''; } catch { return ''; }
  });
  const [updateFocusToken, setUpdateFocusToken] = useState(0);
  const [updateCheckToken, setUpdateCheckToken] = useState(0);

  const ignoreAvailableUpdate = useCallback(() => {
    if (!availableUpdate?.latestVersion) return;
    const ver = availableUpdate.latestVersion;
    setIgnoredUpdateVersion(ver);
    try { localStorage.setItem('zhouyou-ignored-update-version', ver); } catch { /* ignore */ }
  }, [availableUpdate]);

  // 云端账号、同步、同行旅伴小红点与分享口令状态
  const [cloudUser, setCloudUser] = useState<CloudSelfUser | null>(() => (getCloudToken() ? getCachedCloudUser() : null));
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [syncPendingCount, setSyncPendingCount] = useState<number>(() => getPendingCloudChangeCount());
  const [lastSyncError, setLastSyncError] = useState<string>('');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [unreadCount, setUnreadCount] = useState(0);
  const [intimacyBonds, setIntimacyBonds] = useState<IntimacyBond[]>([]);
  const [pendingShareCode, setPendingShareCode] = useState<string | null>(null);
  const [targetPlanId, setTargetPlanId] = useState<string | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs());
  const [activePopup, setActivePopup] = useState<Pick<CloudNotification, 'id' | 'title' | 'body' | 'type' | 'targetRef'> | null>(null);
  const popupTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const seenClipboardCodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    syncDocumentLanguage(lang);
  }, [lang]);

  const navItems: Array<{ id: PageName; label: string; icon: string }> = [
    { id: 'map', label: t('地图足迹', 'Footprints'), icon: '◎' },
    { id: 'plan', label: t('行程规划', 'Planner'), icon: '▦' },
    { id: 'companions', label: t('同行旅伴', 'Companions'), icon: '◈' },
    { id: 'detail', label: t('旅行手账', 'Journal'), icon: '▤' },
    { id: 'profile', label: t('个人中心', 'Profile'), icon: '◉' },
  ];

  const showNotice = useCallback((message: string) => setNotice(message), []);
  const showError = useCallback((message: string) => {
    const prefix = readLanguage() === 'en' ? 'Action failed: ' : '操作未完成：';
    setNotice(`${prefix}${message}`);
  }, []);
  const openPage = useCallback((nextPage: PageName) => {
    if (nextPage === 'plan') setPlannerOpened(true);
    if (nextPage === 'detail') {
      setTargetEntryId(null);
      setTargetPlaceId(null);
    }
    if (nextPage === 'profile') {
      setProfileResetToken((token) => token + 1);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    let active = true;
    // 与 IndexedDB 读取并行预拉全国地图，缩短首屏地图呈现耗时。
    prefetchNationalMap();
    try { localStorage.removeItem(DEMO_ACTIVE_KEY); } catch { /* ignore */ }
    loadSnapshot().then(async (data) => {
      if (!active) return;
      const isEmpty = data.marks.length === 0 && data.trips.length === 0 && data.aiPlans.length === 0;
      if (tourMode && isEmpty) {
        try {
          const { loadDemoWorkspace } = await import('./demo-seed');
          const seeded = await loadDemoWorkspace();
          if (!active) return;
          setSnapshot(seeded);
          setReady(true);
          return;
        } catch { /* 回退到空白态 */ }
      }
      setSnapshot(data);
      setReady(true);
    }).catch((error: unknown) => {
      if (!active) return;
      showError(describeStorageError(error));
      setReady(true);
    });
    return () => { active = false; };
  }, [showError]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const openUpdateSection = useCallback((triggerCheck = false) => {
    setPage('profile');
    setUpdateFocusToken((token) => token + 1);
    if (triggerCheck) setUpdateCheckToken((token) => token + 1);
  }, []);

  // 原生手机 App 与桌面端启动后静默检查更新，并在切回前台/联网恢复/每 10 分钟自动复查；无网络时静默跳过。
  useEffect(() => {
    if (!isNativeAppPlatform()) return;
    let disposed = false;
    let inFlight = false;
    let lastCheckedAt = 0;
    const controller = new AbortController();

    const runCheck = (force = false) => {
      if (disposed || inFlight) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const now = Date.now();
      if (!force && now - lastCheckedAt < 3 * 60 * 1000) return;
      lastCheckedAt = now;
      inFlight = true;
      void checkForAppUpdate(controller.signal)
        .then((result) => {
          if (disposed || controller.signal.aborted) return;
          if (result.hasUpdate) {
            setAvailableUpdate(result);
          } else {
            setAvailableUpdate(null);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    const timer = window.setTimeout(() => runCheck(true), 2000);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') runCheck(false);
    }, 10 * 60 * 1000);
    const onWake = () => {
      if (document.visibilityState === 'visible') runCheck(false);
    };
    const onOnline = () => runCheck(true);

    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onOnline);
      controller.abort();
    };
  }, []);

  // 响应 Electron 顶部菜单「帮助 → 检查更新」。
  useEffect(() => {
    const unsubscribe = window.zhouyouDesktop?.onCheckUpdateRequest?.(() => {
      openUpdateSection(true);
    });
    return () => unsubscribe?.();
  }, [openUpdateSection]);

  const requestClientForTour = useCallback((feature: TourRestrictedFeature) => {
    setTourRestriction(feature);
  }, []);

  const reload = useCallback(async () => setSnapshot(await loadSnapshot()), []);

  const runCloudSync = useCallback(async (silent = false, forceFull = false) => {
    if (!getCloudToken()) return;
    setSyncingCloud(true);
    try {
      const res = await syncWithCloud(forceFull);
      setSnapshot(res.snapshot);
      setLastSyncError('');
      setSyncPendingCount(getPendingCloudChangeCount());
      if (!silent) {
        const parts: string[] = [];
        if (res.pulledPlans || res.pulledRecords) parts.push(`拉取 ${res.pulledPlans} 份攻略 / ${res.pulledRecords} 条记录`);
        if (res.pushedPlans || res.pushedRecords) parts.push(`上传 ${res.pushedPlans} 份攻略 / ${res.pushedRecords} 条记录`);
        if (res.syncedPhotos) parts.push(`同步 ${res.syncedPhotos} 张行程照片`);
        showNotice(parts.length ? `☁️ 云同步完成（${parts.join('，')}）` : '☁️ 云端已是最新状态');
      }
      if (res.conflicts.length > 0) {
        showNotice(`提示：${res.conflicts[0].reason}，已自动拉取最新版本`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '云同步失败';
      setLastSyncError(msg);
      setSyncPendingCount(getPendingCloudChangeCount());
      if (!silent) showError(msg);
    } finally {
      setSyncingCloud(false);
    }
  }, [showError, showNotice]);

  const scheduleCloudSync = useCallback(() => {
    setSyncPendingCount(getPendingCloudChangeCount());
    if (!getCloudToken()) return;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void runCloudSync(true, false);
    }, 450);
  }, [runCloudSync]);

  // 多端准实时同步：6 秒轻量版本号探测 + 本机待传脏队列自动补传 + 切后台/关页前冲刷 + 切回前台/断网恢复立即同步
  useEffect(() => {
    if (!cloudUser) return;
    let disposed = false;
    let lastProbeAt = 0;
    let probing = false;

    const probeAndSync = async (forceCheck = false) => {
      if (disposed || probing || !getCloudToken()) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const now = Date.now();
      const hasDirty = hasPendingCloudChanges();
      if (!forceCheck && !hasDirty && now - lastProbeAt < 3000) return;
      lastProbeAt = now;
      probing = true;
      try {
        const needed = hasDirty || await checkCloudSyncNeeded();
        if (!disposed && needed) {
          await runCloudSync(true, false);
        }
      } catch {
        // 离线或弱网时静默跳过，等待下次唤醒自动重传
      } finally {
        probing = false;
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void probeAndSync(false);
      }
    }, 6000);

    const flushPendingBeforeHide = () => {
      if (!getCloudToken()) return;
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        void runCloudSync(true, false);
      } else if (hasPendingCloudChanges()) {
        void runCloudSync(true, false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void probeAndSync(true);
      } else {
        flushPendingBeforeHide();
      }
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void probeAndSync(false);
      }
    };
    const onOnline = () => {
      void probeAndSync(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', flushPendingBeforeHide);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', flushPendingBeforeHide);
    };
  }, [cloudUser, runCloudSync]);

  useEffect(() => {
    const onPrefsChange = () => setNotifPrefs(readNotificationPrefs());
    window.addEventListener(NOTIFICATION_PREFS_EVENT, onPrefsChange);
    return () => window.removeEventListener(NOTIFICATION_PREFS_EVENT, onPrefsChange);
  }, []);

  const handleNotificationAction = useCallback((item: Pick<CloudNotification, 'targetRef'>) => {
    setActivePopup(null);
    const shareCode = typeof item.targetRef?.shareCode === 'string' ? item.targetRef.shareCode : '';
    const planId = typeof item.targetRef?.planId === 'string' ? item.targetRef.planId : '';
    if (shareCode) {
      setPendingShareCode(shareCode);
      return;
    }
    if (planId) {
      setTargetPlanId(planId);
      openPage('plan');
      return;
    }
    openPage('companions');
  }, [openPage]);

  const triggerNotificationPopup = useCallback((
    item: Pick<CloudNotification, 'id' | 'title' | 'body' | 'type' | 'targetRef'>,
    forcePreview = false,
  ) => {
    const prefs = readNotificationPrefs();
    if (!forcePreview && !shouldNotifyForType(prefs, item.type)) return;
    if (forcePreview || prefs.inAppBanner) {
      setActivePopup(item);
      if (popupTimerRef.current) window.clearTimeout(popupTimerRef.current);
      popupTimerRef.current = window.setTimeout(() => {
        setActivePopup(null);
        popupTimerRef.current = null;
      }, 5500);
    }
    if (prefs.sound) {
      playNotificationChime();
    }
    if (prefs.systemPopup && (forcePreview || document.visibilityState === 'hidden' || item.type === 'ticket_reminder')) {
      fireSystemNotification(
        item.title,
        item.body,
        () => handleNotificationAction(item),
        item.type === 'ticket_reminder' ? `zhouyou-ticket-${item.id}` : 'zhouyou-social-notif',
      );
    }
  }, [handleNotificationAction]);

  const refreshSocialBadges = useCallback(async () => {
    if (!getCloudToken()) return;
    try {
      const [ov, ntfRes] = await Promise.all([
        cloudApi.getSocialOverview(),
        cloudApi.getNotifications(),
      ]);
      setUnreadCount(ov.unreadCount);
      setIntimacyBonds(ov.intimacyBonds);
      const seen = readSeenNotificationIds();
      const freshUnread = (ntfRes.notifications || []).filter((n) => !n.readAt && !seen.has(n.id));
      if (freshUnread.length > 0) {
        freshUnread.forEach((n) => seen.add(n.id));
        writeSeenNotificationIds(seen);
        const latest = freshUnread[0];
        triggerNotificationPopup(latest, false);
      }
    } catch { /* ignore offline */ }
  }, [triggerNotificationPopup]);

  // 登录后每 12 秒静默轮询一次新消息，实现应用内与系统弹窗准实时提醒
  useEffect(() => {
    if (!cloudUser || !notifPrefs.enabled) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' || notifPrefs.systemPopup) {
        void refreshSocialBadges();
      }
    }, 12000);
    return () => window.clearInterval(interval);
  }, [cloudUser, notifPrefs.enabled, notifPrefs.systemPopup, refreshSocialBadges]);

  const [urgentTicketCount, setUrgentTicketCount] = useState(0);

  // 本地抢票倒计时提醒调度：无论是否登录，只要在抢票计划开启了通知，到点即触发应用内/系统弹窗与提示音
  useEffect(() => {
    const refreshUrgency = () => {
      setUrgentTicketCount(countAllUpcomingUrgentTickets(snapshot.aiPlans));
    };
    refreshUrgency();
    const urgencyTimer = window.setInterval(refreshUrgency, 60000);
    return () => window.clearInterval(urgencyTimer);
  }, [snapshot.aiPlans]);

  // 本地抢票倒计时提醒调度（触发通知弹窗）
  useEffect(() => {
    if (!notifPrefs.enabled || !notifPrefs.types.ticketReminders) return;
    const checkTicketReminders = () => {
      const now = Date.now();
      const fired = readFiredTicketReminderKeys();
      let changed = false;
      for (const plan of snapshot.aiPlans) {
        const reminders = plan.ticketReminders;
        if (!reminders) continue;
        const items = mergeTicketPlanItems(plan);
        for (const item of items) {
          const setting = reminders[item.activityId];
          if (!setting?.enabled) continue;
          const schedule = resolveTicketReminderSchedule(item, setting);
          if (schedule.triggerMs == null || schedule.saleMs == null) continue;
          if (now >= schedule.triggerMs && now <= schedule.saleMs + 30 * 60_000) {
            const key = `${plan.id}:${item.activityId}:${schedule.triggerMs}`;
            if (fired.has(key)) continue;
            fired.add(key);
            changed = true;
            const remainMin = Math.max(0, Math.round((schedule.saleMs - now) / 60_000));
            const title = remainMin > 0
              ? `⏰ 抢票提醒：${item.title} 还有 ${remainMin} 分钟开售`
              : `⏰ 抢票时间到：${item.title}`;
            const body = `开售时间：${schedule.dateStr} ${schedule.timeStr}${item.platform ? ` · ${item.platform}` : ''}（行程：${plan.content.title}）`;
            triggerNotificationPopup({
              id: `ticket-${key}`,
              type: 'ticket_reminder',
              title,
              body,
              targetRef: { planId: plan.id },
            }, false);
          }
        }
      }
      if (changed) writeFiredTicketReminderKeys(fired);
    };
    checkTicketReminders();
    const interval = window.setInterval(checkTicketReminders, 20000);
    const onWake = () => {
      if (document.visibilityState === 'visible') checkTicketReminders();
    };
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [snapshot.aiPlans, notifPrefs.enabled, notifPrefs.types.ticketReminders, triggerNotificationPopup]);

  const openAuthModal = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  // 监听跨组件登录态变化
  useEffect(() => {
    const onAuthEvent = () => {
      const token = getCloudToken();
      setCloudUser(token ? getCachedCloudUser() : null);
      if (!token) {
        resetCloudSyncCursor();
        setUnreadCount(0);
        setIntimacyBonds([]);
      }
    };
    window.addEventListener(CLOUD_AUTH_EVENT, onAuthEvent);
    return () => window.removeEventListener(CLOUD_AUTH_EVENT, onAuthEvent);
  }, []);

  // 首次启动：若已登录自动静默云同步；若未登录且非漫游模式，展示一次欢迎注册/登录弹窗（可跳过本地用）
  useEffect(() => {
    if (!ready) return;
    if (getCloudToken()) {
      void runCloudSync(true);
      void refreshSocialBadges();
    } else if (!tourMode) {
      try {
        if (!sessionStorage.getItem(AUTH_DISMISSED_KEY)) {
          setAuthModalMode('register');
          setAuthModalOpen(true);
        }
      } catch { /* ignore */ }
    }
  }, [ready, tourMode, runCloudSync, refreshSocialBadges]);

  // 处理网页 URL 参数与自定义协议深链（?share=CODE / ?addFriend=ZY-XXXX / ?joinGroup=CODE）
  const handleIncomingUrl = useCallback((urlStr: string) => {
    const parsed = extractZhouyouActionFromUrl(urlStr);
    if (parsed.shareCode) {
      setPendingShareCode(parsed.shareCode);
      return;
    }
    if (parsed.friendCode) {
      if (!getCloudToken()) {
        showNotice(`请先登录后自动添加好友 ${parsed.friendCode}`);
        openAuthModal('login');
        return;
      }
      void cloudApi.requestFriend({ friendCode: parsed.friendCode })
        .then((res) => { showNotice(res.message); setPage('companions'); })
        .catch((err) => showError(err instanceof Error ? err.message : '添加好友失败'));
      return;
    }
    if (parsed.groupCode) {
      if (!getCloudToken()) {
        showNotice(`请先登录后自动加入行程群 ${parsed.groupCode}`);
        openAuthModal('login');
        return;
      }
      void cloudApi.joinGroupByCode(parsed.groupCode)
        .then((res) => { showNotice(`已加入行程群「${res.group.name}」`); setPage('companions'); void runCloudSync(true); })
        .catch((err) => showError(err instanceof Error ? err.message : '加入行程群失败'));
    }
  }, [openAuthModal, runCloudSync, showError, showNotice]);

  useEffect(() => {
    if (!ready) return;
    handleIncomingUrl(window.location.href);
    const params = new URLSearchParams(window.location.search);
    if (params.has('share') || params.has('addFriend') || params.has('joinGroup')) {
      params.delete('share');
      params.delete('addFriend');
      params.delete('joinGroup');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, [ready, handleIncomingUrl]);

  // 监听桌面端 Electron zhouyou:// 深链与切回前台时自动检测周游口令 & 刷新云同步
  useEffect(() => {
    const desktopApi = window.zhouyouDesktop as unknown as { onDeepLink?: (cb: (url: string) => void) => () => void } | undefined;
    const unsubDeepLink = desktopApi?.onDeepLink?.((url) => handleIncomingUrl(url));

    const checkClipboardToken = async () => {
      try {
        if (!navigator.clipboard?.readText) return;
        if (navigator.permissions?.query) {
          const perm = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
          if (perm.state !== 'granted') return;
        }
        const text = await navigator.clipboard.readText();
        const code = extractZhouyouShareCode(text);
        if (code && !seenClipboardCodesRef.current.has(code)) {
          seenClipboardCodesRef.current.add(code);
          setPendingShareCode(code);
        }
      } catch { /* ignore */ }
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void checkClipboardToken();
      if (getCloudToken()) {
        void runCloudSync(true);
        void refreshSocialBadges();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubDeepLink?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [handleIncomingUrl, refreshSocialBadges, runCloudSync]);

  const saveAiPlan = useCallback(async (plan: AiTravelPlan, expectedVersion: number | null) => {
    await saveAiPlanRecord(plan, expectedVersion);
    markCloudRecordDirty('aiPlans', plan.id);
    await reload();
    scheduleCloudSync();
  }, [reload, scheduleCloudSync]);
  const saveAiPhoto = useCallback(async (planId: string, activityId: string, photo: PlannerPhoto) => {
    if (tourMode) {
      requestClientForTour('photo');
      return;
    }
    await saveAiPlanPhoto(planId, activityId, photo);
    markCloudRecordDirty('aiPlans', planId);
    await reload();
    if (photo.assetId) {
      void syncSinglePlannerPhotoToCloud(photo.assetId);
    }
    scheduleCloudSync();
  }, [reload, requestClientForTour, scheduleCloudSync, tourMode]);
  const publishPlan = useCallback(async (plan: AiTravelPlan, initialFinance?: TripPlan) => {
    const updated = await publishAiPlan(plan, initialFinance);
    markCloudRecordDirty('aiPlans', updated.id);
    markCloudStoreDirty('trips');
    markCloudStoreDirty('marks');
    markCloudStoreDirty('plans');
    await reload();
    scheduleCloudSync();
    return updated;
  }, [reload, scheduleCloudSync]);
  const saveJournalVisit = useCallback(async (...args: Parameters<typeof recordPlannerJournalVisit>) => {
    const result = await recordPlannerJournalVisit(...args);
    markCloudStoreDirty('trips');
    markCloudStoreDirty('marks');
    markCloudStoreDirty('places');
    markCloudStoreDirty('entries');
    await reload();
    scheduleCloudSync();
    return result;
  }, [reload, scheduleCloudSync]);
  const openJournalPlace = useCallback((placeId: string) => {
    setSelectedCityCode(null);
    setTargetEntryId(null);
    setTargetPlaceId(placeId);
    setPage('detail');
  }, []);
  const savePlannerPreferences = useCallback(async (preferences: PlannerPreferences) => {
    await saveItem('plannerPreferences', preferences);
    markCloudRecordDirty('plannerPreferences', preferences.id);
    await reload();
    scheduleCloudSync();
  }, [reload, scheduleCloudSync]);
  const recommendProvince = useCallback((name: string) => {
    setPlannerProvince({ name, token: Date.now() }); openPage('plan');
  }, [openPage]);

  const saveMark = useCallback(async (mark: CityMark) => {
    try {
      await saveItem('marks', mark);
      markCloudRecordDirty('marks', mark.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const saveEntry = useCallback(async (entry: DayEntry) => {
    try {
      await saveItem('entries', entry);
      markCloudRecordDirty('entries', entry.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const saveMedia = useCallback(async (media: TravelMedia, blob: Blob) => {
    if (tourMode) {
      requestClientForTour(media.kind === 'audio' ? 'voice' : 'photo');
      return;
    }
    try { await saveMediaBatch([{ media, blob }]); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, requestClientForTour, showError, tourMode]);
  const saveMediaGroup = useCallback(async (items: Array<{ media: TravelMedia; blob: Blob }>, entries: DayEntry[]) => {
    if (tourMode) {
      requestClientForTour('photo');
      return;
    }
    try {
      await saveMediaBatch(items, entries);
      if (entries.length > 0) {
        entries.forEach((entry) => markCloudRecordDirty('entries', entry.id));
      }
      await reload();
      if (entries.length > 0) scheduleCloudSync();
    }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, requestClientForTour, scheduleCloudSync, showError, tourMode]);
  const updateMedia = useCallback(async (media: TravelMedia) => {
    try { await saveItem('media', media); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const deleteMedia = useCallback(async (id: string) => {
    try {
      await deleteMediaRecord(id);
      await reload();
      showNotice(readLanguage() === 'en' ? 'Media deleted.' : '媒体已删除。');
    } catch (error) { showError(describeStorageError(error)); }
  }, [reload, showError, showNotice]);
  const saveTrip = useCallback(async (trip: Journey) => {
    try {
      const linked = await saveJourneyAndLinkCityRecords(trip);
      markCloudStoreDirty('trips');
      markCloudStoreDirty('marks');
      markCloudStoreDirty('places');
      markCloudStoreDirty('entries');
      await reload();
      scheduleCloudSync();
      return linked;
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const savePlace = useCallback(async (place: JourneyPlace) => {
    try {
      await saveItem('places', place);
      markCloudRecordDirty('places', place.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const savePlan = useCallback(async (plan: TripPlan) => {
    try {
      await saveItem('plans', plan);
      markCloudRecordDirty('plans', plan.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const movePlan = useCallback(async (legacyId: string, plan: TripPlan) => {
    try {
      await moveLegacyPlanToJourney(legacyId, plan);
      markCloudStoreDirty('plans');
      markCloudRecordDeleted('plans', legacyId);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const saveBadge = useCallback(async (badge: Badge) => {
    try {
      await saveItem('badges', badge);
      markCloudRecordDirty('badges', badge.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);
  const saveProfile = useCallback(async (profile: LocalProfile) => {
    try {
      await saveItem('profile', profile);
      markCloudRecordDirty('profile', profile.id);
      await reload();
      scheduleCloudSync();
    } catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, scheduleCloudSync, showError]);

  // Only confirmed visits light the map. Keep legacy planned data and future
  // journey budgets intact, but never count them as a completed city visit.
  const effectiveMarks = useMemo(() => {
    const byCode = new Map(snapshot.marks.map((mark) => [mark.id, mark]));
    for (const trip of snapshot.trips) for (const city of trip.cities) {
      const old = byCode.get(city.code);
      byCode.set(city.code, {
        id: city.code, name: city.name, provinceCode: city.provinceCode,
        visited: Boolean(old?.visited || trip.status !== 'planned'),
        planned: false,
        updatedAt: old?.updatedAt ?? trip.createdAt,
      });
    }
    return [...byCode.values()].map((mark) => ({ ...mark, planned: false }));
  }, [snapshot.marks, snapshot.trips]);
  const selectedCity = effectiveMarks.find((mark) => mark.id === selectedCityCode) ?? null;

  const selectCity = useCallback((feature: AdministrativeFeature, province: AdministrativeFeature) => {
    const code = String(feature.properties.adcode);
    const name = feature.properties.name;
    const provinceCode = String(province.properties.adcode) || provinceCodeForCity(code);
    const existing = effectiveMarks.find((mark) => mark.id === code);
    if (existing?.visited) {
      setActionCity({ code, name, provinceCode });
      return;
    }
    const mark: CityMark = {
      id: code, name, provinceCode,
      visited: true, planned: false, updatedAt: new Date().toISOString(),
    };
    void saveMark(mark).then(() => {
      setSelectedCityCode(mark.id);
      showNotice(readLanguage() === 'en'
        ? `${mark.name} marked as visited. Tap again to open Journal or unmark.`
        : `${mark.name}已点亮为已去过，再次点击可进入旅行手账或取消点亮。`);
    }).catch(() => { /* saveMark reports the storage error. */ });
  }, [effectiveMarks, saveMark, showNotice]);

  const actionCityLockedByTrip = useMemo(() => (
    actionCity ? snapshot.trips.some((trip) => trip.status !== 'planned' && trip.cities.some((item) => item.code === actionCity.code)) : false
  ), [actionCity, snapshot.trips]);

  function openActionCityJournal(): void {
    if (!actionCity) return;
    setSelectedCityCode(actionCity.code);
    setTargetEntryId(null);
    setTargetPlaceId(null);
    setActionCity(null);
    setPage('detail');
  }

  async function unvisitActionCity(): Promise<void> {
    if (!actionCity || actionCityLockedByTrip) return;
    const mark: CityMark = {
      id: actionCity.code, name: actionCity.name,
      provinceCode: actionCity.provinceCode || provinceCodeForCity(actionCity.code),
      visited: false, planned: false, updatedAt: new Date().toISOString(),
    };
    try {
      await saveMark(mark);
      if (selectedCityCode === mark.id) setSelectedCityCode(null);
      setActionCity(null);
      showNotice(t(`${mark.name}已取消点亮。`, `${mark.name} unmarked.`));
    } catch { /* saveMark reports the storage error and keeps the dialog open. */ }
  }

  async function updateSelectedMark(visited: boolean): Promise<void> {
    if (!selectedCity) return;
    await saveMark({ ...selectedCity, visited, planned: false, updatedAt: new Date().toISOString() });
    showNotice(t('城市状态已更新。', 'City status updated.'));
  }

  function openEntry(entry: DayEntry): void {
    setSelectedCityCode(entry.cityCode);
    setTargetEntryId(entry.id);
    setTargetPlaceId(null);
    setPage('detail');
  }

  const activeProfile = snapshot.profile[0];
  const currentPageLabel = navItems.find((item) => item.id === page)?.label ?? '';
  const avatarNickname = activeProfile?.nickname && activeProfile.nickname !== '旅行者'
    ? activeProfile.nickname
    : t('旅行者', 'Traveler');

  const isNativeClient = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as {
      zhouyouDesktop?: { isDesktop?: boolean };
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    return Boolean(win.zhouyouDesktop?.isDesktop || win.Capacitor?.isNativePlatform?.());
  }, []);

  return <div className={`app-shell${page === 'map' ? ' is-map-page' : ''}`}>
    <aside className="sidebar">
      <div className="brand">
        {/* 复用导航中的折叠地图图标，沿用品牌贴纸随主题切换的配色。 */}
        <div className="brand-symbol"><TravelIcon name="map" /></div>
        <div><strong>{t('周游地图', 'Zhouyou Map')}</strong><span>{t('自己的旅行小册子', 'Your travel booklet')}</span></div>
      </div>
      <nav aria-label={t('主导航', 'Main navigation')}>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item nav-${item.id} ${page === item.id ? 'active' : ''}`}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => openPage(item.id)}
          >
            <span className="nav-icon">
              <TravelIcon name={item.id} />
              {item.id === 'plan' && urgentTicketCount > 0 && (
                <i className="nav-update-dot" aria-label={t(`有 ${urgentTicketCount} 项即将开抢`, `${urgentTicketCount} tickets opening soon`)} />
              )}
              {item.id === 'profile' && availableUpdate && (
                <i className="nav-update-dot" aria-label={t('有新版本可更新', 'Update available')} />
              )}
              {item.id === 'companions' && unreadCount > 0 && (
                <i className="nav-update-dot" aria-label={t(`有 ${unreadCount} 条未读旅伴消息`, `${unreadCount} unread notifications`)} />
              )}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
      {/* 明信片和路线贴纸共用一块装饰区域，侧栏变高时一起移动。 */}
      <div className="sidebar-art cute-deco" aria-hidden="true">
        <div className="sidebar-postcard-frame"><TravelCover label="" /></div>
        <div className="sidebar-doodle">
          <svg className="sidebar-doodle-trail" viewBox="0 0 180 70" fill="none">
            <path d="M12 53C36 26 67 23 98 39C125 53 148 43 164 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3.5 4.5" opacity="0.45" />
            <path d="m159 19 10-4-4 10-2-4z" fill="var(--warm-green)" opacity="0.85" />
            <circle cx="32" cy="22" r="2.2" fill="#f7b267" opacity="0.7" />
            <circle cx="95" cy="22" r="1.8" fill="#7dc9b8" opacity="0.75" />
          </svg>
          <CuteSticker kind="cloud" className="sidebar-doodle-item is-cloud" />
          <CuteSticker kind="sparkle" className="sidebar-doodle-item is-sparkle" />
          <CuteSticker kind="suitcase" className="sidebar-doodle-item is-suitcase" />
          <CuteSticker kind="compass" className="sidebar-doodle-item is-compass" />
          <CuteSticker kind="stamp" className="sidebar-doodle-item is-postmark" />
          <TravelAvatar avatarId="balloon" nickname="" className="sidebar-doodle-item is-balloon" />
        </div>
      </div>
      <div className="sidebar-footer"><span className="footer-dot" />{t('本机保存 · 离线地图', 'Saved locally · Offline maps')}</div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="topbar-mobile-brand"
            onClick={() => openPage('map')}
            aria-label={t('周游地图，返回地图足迹', 'Zhouyou Map, back to Footprint Map')}
          >
            <span className="brand-symbol topbar-brand-symbol" aria-hidden="true"><TravelIcon name="map" /></span>
            <span className="topbar-brand-text"><b>{t('周游地图', 'Zhouyou Map')}</b><small>{currentPageLabel}</small></span>
          </button>
          <strong className="topbar-page-title">{currentPageLabel}</strong>
          <span>{t('把走过的路，留在地图上', 'Keep every road you have walked on the map')}</span>
        </div>
        <div className="topbar-right">
          {!isNativeClient && !tourMode && (
            <a
              className="topbar-ext-btn is-app"
              href="https://zhouyou.online/download.html"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('获取 App', 'Get App')}
              title={t('前往官网下载电脑端 / 手机端 App', 'Download Desktop & Mobile App')}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
              <span className="topbar-ext-label">{t('获取 App', 'Get App')}</span>
            </a>
          )}
          <a
            className="topbar-ext-btn is-github"
            href="https://github.com/Eldonwyd/zhouyou-app"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title={t('访问 GitHub 开源仓库', 'Visit GitHub Repository')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
            </svg>
            <span className="topbar-ext-label">GitHub</span>
          </a>
          <ThemeSwitch />
          {tourMode ? (
            <button
              type="button"
              className="local-pill tour-pill-btn"
              onClick={() => openDownloadFromTour('download')}
              title={t('在线漫游体验版 · 点击下载完整客户端', 'Online Web Tour · Download Full Client')}
            >
              {t('在线体验 · 下载客户端', 'Web Tour · Download')}
            </button>
          ) : cloudUser ? (
            <button
              type="button"
              className="local-pill cloud-pill-btn"
              disabled={syncingCloud}
              onClick={() => void runCloudSync(false, true)}
              title={lastSyncError
                ? `上次同步失败：${lastSyncError}（点击重试）`
                : syncPendingCount > 0
                  ? `有 ${syncPendingCount} 项本地变更待上传云端（点击立即同步）`
                  : t('点击立即同步云端攻略与足迹', 'Click to sync cloud plans & footprints')}
            >
              {syncingCloud
                ? t('☁️ 同步中…', '☁️ Syncing…')
                : lastSyncError
                  ? `⚠️ 重试同步`
                  : syncPendingCount > 0
                    ? `☁️ 待同步(${syncPendingCount})`
                    : `☁️ ${cloudUser.nickname}`}
            </button>
          ) : (
            <button
              type="button"
              className="local-pill cloud-pill-btn"
              onClick={() => openAuthModal('login')}
              title={t('登录或注册开启电脑-手机云同步', 'Sign in to enable cloud sync')}
            >
              {t('登录 / 云同步', 'Sign In')}
            </button>
          )}
          <button
            type="button"
            className="topbar-avatar-btn"
            aria-label={avatarNickname}
            title={t('打开个人中心', 'Open Personal Center')}
            onClick={() => openPage('profile')}
          >
            <TravelAvatar avatarId={activeProfile?.avatar || cloudUser?.avatar} nickname={avatarNickname} className="avatar" />
          </button>
        </div>
      </header>
      {ready && tourMode && !embeddedTour && (
        <div className="tour-mode-bar" role="status">
          <span className="tour-mode-bar-copy">
            <strong>{t('🧭 网页漫游体验中', '🧭 Online Web Tour')}</strong>
            <span>{t('可自由点亮全国地图、切换 5 套皮肤与浏览示例手账/路书 · AI 规划与照片存储请下载客户端', 'Light up China cities, switch themes & browse sample journal/roadbook · AI & photo storage are client-only')}</span>
          </span>
          <div className="tour-mode-bar-actions">
            {embeddedTour && (
              <button type="button" className="secondary" onClick={openFullscreenTour}>
                {t('↗ 全屏体验', '↗ Fullscreen')}
              </button>
            )}
            <button type="button" className="primary" onClick={() => openDownloadFromTour('download')}>
              {t('📥 下载完整客户端', '📥 Download Client')}
            </button>
          </div>
        </div>
      )}
      {ready && availableUpdate?.hasUpdate && availableUpdate.latestVersion !== ignoredUpdateVersion && (
        <div className="app-update-top-bar" role="status">
          <span>
            {t(
              `✨ 发现新版本 v${availableUpdate.latestVersion}（当前 v${availableUpdate.currentVersion}）`,
              `✨ New version v${availableUpdate.latestVersion} available (current v${availableUpdate.currentVersion})`,
            )}
          </span>
          <div className="app-update-top-actions">
            <button type="button" className="primary" onClick={() => openUpdateSection(false)}>
              {t('立即更新', 'Update Now')}
            </button>
            <button type="button" className="text-button" onClick={ignoreAvailableUpdate}>
              {t('忽略', 'Ignore')}
            </button>
          </div>
        </div>
      )}
      <main>{!ready ? <div className="empty-state">{t('正在读取本机旅行数据…', 'Loading local travel data…')}</div> : <>
        {/* 保持规划组件挂载，让 AI 请求和小红书解析在浏览其他页面时继续。 */}
        {plannerOpened && <div hidden={page !== 'plan'}>
          <Suspense fallback={<div className="empty-state">{t('正在打开页面…', 'Opening page…')}</div>}>
            <PlanView visible={page === 'plan'} onReturnToPlanner={() => openPage('plan')} city={selectedCity} marks={effectiveMarks} trips={snapshot.trips} plans={snapshot.plans} onSave={savePlan} onMoveLegacy={movePlan} onCreateJourney={() => openPage('detail')} onError={showError} onNotice={showNotice} aiPlans={snapshot.aiPlans} preferences={snapshot.plannerPreferences[0]} provinceIntent={plannerProvince} onSaveAi={saveAiPlan} onSaveAiPhoto={saveAiPhoto} onPublishAi={publishPlan} onSavePreferences={savePlannerPreferences} onSaveJournalVisit={saveJournalVisit} onOpenJournalPlace={openJournalPlace} webTourMode={tourMode} onRequireClient={requestClientForTour} cloudUser={cloudUser} targetPlanId={targetPlanId} onOpenAuth={() => openAuthModal('login')} onSyncNow={() => runCloudSync(true)} />
          </Suspense>
        </div>}
        {/* 保持足迹地图挂载，从其他页面切回地图时秒开无重载。 */}
        <div className="map-page-host" hidden={page !== 'map'}>
          <MapView visible={page === 'map'} marks={effectiveMarks} activeProvinceCode={activeProvinceCode} setActiveProvinceCode={setActiveProvinceCode} onSelectCity={selectCity} onError={showError} onRecommendProvince={recommendProvince} />
        </div>
        <Suspense fallback={<div className="empty-state">{t('正在打开页面…', 'Opening page…')}</div>}>
          {page === 'companions' && (
            <CompanionsView
              cloudUser={cloudUser}
              myMarks={effectiveMarks}
              aiPlans={snapshot.aiPlans}
              onOpenAuth={(m) => openAuthModal(m)}
              onOpenPlan={(planId) => {
                setTargetPlanId(planId);
                openPage('plan');
              }}
              onOpenShareCode={(code) => setPendingShareCode(code)}
              onSaveShareToMyPlans={async (code) => {
                try {
                  const res = await cloudApi.acceptShare(code);
                  await saveAiPlanRecord(res.plan, null);
                  await reload();
                  showNotice(
                    res.mode === 'collab'
                      ? `已加入协作并保存「${res.plan.content.title}」到「行程规划 · 我的行程」`
                      : `已保存「${res.plan.content.title}」到「行程规划 · 我的行程」`,
                  );
                } catch (err) {
                  showError(err instanceof Error ? err.message : '保存到我的行程失败');
                  throw err;
                }
              }}
              onUnreadChange={setUnreadCount}
              onIntimacyLoaded={setIntimacyBonds}
              onSyncNow={() => runCloudSync(true)}
              onNotice={showNotice}
              onError={showError}
            />
          )}
          {page === 'detail' && <DetailView city={selectedCity} marks={effectiveMarks} entries={snapshot.entries} media={snapshot.media} trips={snapshot.trips} aiPlans={snapshot.aiPlans} places={snapshot.places} targetEntryId={targetEntryId} targetPlaceId={targetPlaceId} onOpenMap={() => openPage('map')} onSaveEntry={saveEntry} onSaveMedia={saveMedia} onSaveMediaGroup={saveMediaGroup} onUpdateMedia={updateMedia} onDeleteMedia={deleteMedia} onSaveTrip={saveTrip} onSavePlace={savePlace} onSaveCityMark={saveMark} onUpdateMark={updateSelectedMark} onError={showError} onNotice={showNotice} webTourMode={tourMode} onRequireClient={requestClientForTour} />}
          {page === 'achievements' && <AchievementsView marks={effectiveMarks} entries={snapshot.entries} trips={snapshot.trips} media={snapshot.media} badges={snapshot.badges} intimacyBonds={intimacyBonds} onSaveBadge={saveBadge} onOpenEntry={openEntry} onError={showError} onNotice={showNotice} webTourMode={tourMode} onRequireClient={requestClientForTour} />}
          {page === 'profile' && (
            <ProfileView
              snapshot={snapshot}
              effectiveMarks={effectiveMarks}
              intimacyBonds={intimacyBonds}
              activeProvinceCode={activeProvinceCode}
              resetSettingsToken={profileResetToken}
              availableUpdate={availableUpdate}
              updateFocusToken={updateFocusToken}
              updateCheckToken={updateCheckToken}
              cloudUser={cloudUser}
              syncingCloud={syncingCloud}
              onOpenAuth={(m) => openAuthModal(m)}
              onSyncNow={() => runCloudSync(false, true)}
              onCloudUserUpdated={(u) => setCloudUser(u)}
              onUpdateFound={setAvailableUpdate}
              onSaveProfile={saveProfile}
              onSaveBadge={saveBadge}
              onOpenEntry={openEntry}
              onTestNotification={() => triggerNotificationPopup({
                id: `test-${Date.now()}`,
                title: t('小鹿同学邀请你同游共编攻略', 'Travel Buddy invited you to collaborate'),
                body: t('云南大理+丽江 5 天慢游 · 点击立即查看', 'Yunnan 5-day slow trip · Tap to view'),
                type: 'share',
                targetRef: {},
              }, true)}
              webTourMode={tourMode}
              onRequireClient={requestClientForTour}
              onImported={(data) => {
                // 恢复备份会替换行程数据，清除上一份数据上打开的规划会话。
                setPlannerOpened(false);
                setSnapshot(data);
                setSelectedCityCode(null);
                setPage('map');
              }}
              onError={showError}
              onNotice={showNotice}
            />
          )}
        </Suspense>
      </>}</main>
    </div>
    {actionCity && (
      <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionCity(null); }}>
        <div className="dialog city-action-dialog" role="dialog" aria-modal="true" aria-labelledby="city-dialog-title">
          <span className="city-dialog-pill">{t('已点亮足迹', 'Visited City')}</span>
          <h2 id="city-dialog-title">{actionCity.name}</h2>
          <p>
            {actionCityLockedByTrip
              ? t('这座城市已关联到已保存的旅行，可进入旅行手账查看或编辑。', 'This city is linked to a saved trip. Open Travel Journal to view or edit it.')
              : t('这座城市已点亮，可进入旅行手账记录回忆，或取消点亮状态。', 'This city is marked as visited. Open Travel Journal to add memories, or unmark it.')}
          </p>
          <div className="dialog-actions">
            <button className="primary" onClick={openActionCityJournal}>{t('进入旅行手账', 'Open Journal')}</button>
            <button
              className="secondary"
              disabled={actionCityLockedByTrip}
              title={actionCityLockedByTrip ? t('该城市已包含在已保存的旅行中，请在旅行手账中调整', 'Included in a saved trip. Adjust it in Travel Journal.') : undefined}
              onClick={() => void unvisitActionCity()}
            >
              {t('取消点亮', 'Unmark')}
            </button>
            <button className="text-button" onClick={() => setActionCity(null)}>{t('取消', 'Cancel')}</button>
          </div>
        </div>
      </div>
    )}
    {tourRestriction && (() => {
      const copy = tourRestrictionCopy(tourRestriction);
      return (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTourRestriction(null); }}>
          <div className="dialog tour-upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-upgrade-title">
            <span className="city-dialog-pill">
              {tourRestriction === 'ai'
                ? t('✨ 客户端专属 · AI 引擎', '✨ Client Only · AI Engine')
                : t('✨ 客户端专属 · 本地相册归档', '✨ Client Only · Local Media Vault')}
            </span>
            <h2 id="tour-upgrade-title">{copy.title}</h2>
            <p>{copy.body}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setTourRestriction(null);
                  openDownloadFromTour(tourRestriction === 'ai' ? 'desktop' : 'download');
                }}
              >
                {tourRestriction === 'ai'
                  ? t('💻 获取桌面版 / 客户端解锁 AI', '💻 Download Client to Unlock AI')
                  : t('📥 获取客户端 / PWA 保存原图', '📥 Download Client / PWA')}
              </button>
              <button type="button" className="secondary" onClick={() => setTourRestriction(null)}>
                {t('继续在线漫游体验', 'Continue Web Tour')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    <AuthModal
      open={authModalOpen}
      initialMode={authModalMode}
      defaultNickname={activeProfile?.nickname || ''}
      defaultAvatar={activeProfile?.avatar || 'bear'}
      onSuccess={(user, isNew) => {
        setCloudUser(user);
        setAuthModalOpen(false);
        try { sessionStorage.setItem(AUTH_DISMISSED_KEY, '1'); } catch { /* ignore */ }
        showNotice(isNew ? `欢迎加入周游地图，${user.nickname}！正在合并同步本机数据…` : `欢迎回来，${user.nickname}！正在同步云端数据…`);
        void runCloudSync(false);
        void refreshSocialBadges();
      }}
      onDismiss={() => {
        setAuthModalOpen(false);
        try { sessionStorage.setItem(AUTH_DISMISSED_KEY, '1'); } catch { /* ignore */ }
      }}
    />
    <ShareReceiveModal
      shareCode={pendingShareCode}
      loggedIn={Boolean(cloudUser)}
      onRequireLogin={() => openAuthModal('login')}
      onAccepted={async (plan, mode) => {
        await upsertAiPlanFromCloud(plan);
        markCloudRecordDirty('aiPlans', plan.id);
        await reload();
        setTargetPlanId(plan.id);
        openPage('plan');
        showNotice(mode === 'collab' ? '已加入行程群并保存到「行程规划 · 我的行程」' : '攻略已保存到「行程规划 · 我的行程」');
        void runCloudSync(true);
      }}
      onClose={() => setPendingShareCode(null)}
    />
    {activePopup && (
      <div className="inapp-notif-banner" role="alert" aria-live="polite">
        <button
          type="button"
          className="inapp-notif-main"
          onClick={() => handleNotificationAction(activePopup)}
        >
          <span className="inapp-notif-icon" aria-hidden="true">🔔</span>
          <span className="inapp-notif-copy">
            <strong>{activePopup.title}</strong>
            {activePopup.body && <small>{activePopup.body}</small>}
          </span>
          <span className="inapp-notif-cta">{t('查看', 'View')}</span>
        </button>
        <button
          type="button"
          className="inapp-notif-close"
          aria-label={t('关闭通知', 'Dismiss notification')}
          onClick={() => setActivePopup(null)}
        >
          ×
        </button>
      </div>
    )}
    {notice && (
      <div className="toast" role="status">
        {notice}
        <button onClick={() => setNotice(null)} aria-label={t('关闭提示', 'Dismiss notice')}>×</button>
      </div>
    )}
  </div>;
}
