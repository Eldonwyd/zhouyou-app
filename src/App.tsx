import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AdministrativeFeature, AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile, PageName, TravelMedia, TripPlan } from './types';
import { deleteMediaRecord, loadSnapshot, moveLegacyPlanToJourney, recordPlannerJournalVisit, saveItem, saveJourneyAndLinkCityRecords, saveMediaBatch, saveAiPlan as saveAiPlanRecord, saveAiPlanPhoto, publishAiPlan } from './db';
import type { AiTravelPlan, PlannerPhoto, PlannerPreferences } from './planner-types';
import { prefetchNationalMap, provinceCodeForCity } from './map-data';
import { describeStorageError } from './utils';
import { applyThemeMode, useThemeMode, type ThemeMode } from './theme';
import { readLanguage, syncDocumentLanguage, useI18n } from './i18n';
import { checkForAppUpdate, isNativeAppPlatform, type AppUpdateInfo } from './app-updater';
import {
  isEmbeddedTour,
  isWebTourMode,
  openDownloadFromTour,
  openFullscreenTour,
  tourRestrictionCopy,
  type TourRestrictedFeature,
} from './web-tour';
import MapView from './components/MapView';

const DEMO_ACTIVE_KEY = 'zhouyou-demo-active';
const DEMO_DISMISSED_KEY = 'zhouyou-demo-banner-dismissed';
const readDemoActive = (): boolean => { try { return localStorage.getItem(DEMO_ACTIVE_KEY) === '1'; } catch { return false; } };
const readDemoDismissed = (): boolean => { try { return localStorage.getItem(DEMO_DISMISSED_KEY) === '1'; } catch { return false; } };
const writeDemoDismissed = (): void => { try { localStorage.setItem(DEMO_DISMISSED_KEY, '1'); } catch { /* ignore */ } };
import { TravelCover, TravelIcon } from './components/TravelArt';
import { CuteSticker, TravelAvatar } from './components/CuteArt';

// The map is the first screen. Media parsing, ZIP backup and secondary pages
// arrive only when the user opens their respective sections.
const DetailView = lazy(() => import('./components/DetailView'));
const PlanView = lazy(() => import('./components/PlannerWorkspace'));
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
  const [demoMode, setDemoMode] = useState(readDemoActive);
  const [demoDismissed, setDemoDismissed] = useState(readDemoDismissed);
  const [demoBusy, setDemoBusy] = useState(false);
  const [tourRestriction, setTourRestriction] = useState<TourRestrictedFeature | null>(null);
  const tourMode = useMemo(() => isWebTourMode(), []);
  const embeddedTour = useMemo(() => isEmbeddedTour(), []);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [updateFocusToken, setUpdateFocusToken] = useState(0);
  const [updateCheckToken, setUpdateCheckToken] = useState(0);

  useEffect(() => {
    syncDocumentLanguage(lang);
  }, [lang]);

  const navItems: Array<{ id: PageName; label: string; icon: string }> = [
    { id: 'map', label: t('地图足迹', 'Footprints'), icon: '◎' },
    { id: 'plan', label: t('行程规划', 'Planner'), icon: '▦' },
    { id: 'detail', label: t('旅行手账', 'Journal'), icon: '▤' },
    { id: 'achievements', label: t('旅途成就', 'Badges'), icon: '✦' },
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

  const enterDemoMode = useCallback(async (confirmIfNonEmpty = false) => {
    const isEn = readLanguage() === 'en';
    if (confirmIfNonEmpty && (snapshot.marks.length > 0 || snapshot.trips.length > 0 || snapshot.aiPlans.length > 0)) {
      const msg = isEn
        ? 'Loading sample data will overwrite current travel records in this browser. Continue with Demo Mode?'
        : '载入示例数据会覆盖当前浏览器的旅行记录，确认继续体验演示模式吗？';
      if (!window.confirm(msg)) return;
    }
    setDemoBusy(true);
    try {
      const { loadDemoWorkspace } = await import('./demo-seed');
      const seeded = await loadDemoWorkspace();
      setPlannerOpened(false);
      setSelectedCityCode(null);
      setSnapshot(seeded);
      setDemoMode(true);
      setDemoDismissed(false);
      showNotice(isEn
        ? '✨ Sample data loaded: 14 lit cities, Dali AI roadbook, photo journal, and daily ledger. Clear anytime.'
        : '✨ 已载入演示数据：14 座点亮城市、大理 AI 路书、照片手账与每日账本，可随时一键清空。');
    } catch (error: unknown) {
      showError(describeStorageError(error));
    } finally {
      setDemoBusy(false);
    }
  }, [showError, showNotice, snapshot.aiPlans.length, snapshot.marks.length, snapshot.trips.length]);

  const exitDemoMode = useCallback(async () => {
    const isEn = readLanguage() === 'en';
    setDemoBusy(true);
    try {
      const { clearDemoWorkspace } = await import('./demo-seed');
      const cleared = await clearDemoWorkspace();
      setPlannerOpened(false);
      setSelectedCityCode(null);
      setSnapshot(cleared);
      setDemoMode(false);
      setDemoDismissed(true);
      showNotice(isEn
        ? 'Sample data cleared. Start recording your own travel footprints!'
        : '已清空演示数据，开始记录你自己的旅行足迹吧！');
    } catch (error: unknown) {
      showError(describeStorageError(error));
    } finally {
      setDemoBusy(false);
    }
  }, [showError, showNotice]);

  useEffect(() => {
    let active = true;
    // 与 IndexedDB 读取并行预拉全国地图，缩短首屏地图呈现耗时。
    prefetchNationalMap();
    loadSnapshot().then(async (data) => {
      if (!active) return;
      const wantsDemo = new URLSearchParams(window.location.search).get('demo') === '1' || tourMode;
      const isEmpty = data.marks.length === 0 && data.trips.length === 0 && data.aiPlans.length === 0;
      if (wantsDemo && isEmpty) {
        try {
          const { loadDemoWorkspace } = await import('./demo-seed');
          const seeded = await loadDemoWorkspace();
          if (!active) return;
          setSnapshot(seeded);
          setDemoMode(true);
          setReady(true);
          if (!tourMode) {
            showNotice(readLanguage() === 'en'
              ? '✨ Entered Demo Mode: explore the footprint map, AI roadbook, photo journal, and ledger!'
              : '✨ 已自动进入演示模式：可自由浏览足迹地图、AI 路书、照片手账与账本！');
          }
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
  }, [showError, showNotice]);

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

  // 原生手机 App 与桌面端启动后静默检查一次更新；无网络时静默跳过。
  useEffect(() => {
    if (!isNativeAppPlatform()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void checkForAppUpdate(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && result.hasUpdate) {
            setAvailableUpdate(result);
            setUpdateBannerDismissed(false);
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => {
      window.clearTimeout(timer);
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
  const saveAiPlan = useCallback(async (plan: AiTravelPlan, expectedVersion: number | null) => {
    await saveAiPlanRecord(plan, expectedVersion); await reload();
  }, [reload]);
  const saveAiPhoto = useCallback(async (planId: string, activityId: string, photo: PlannerPhoto) => {
    if (tourMode) {
      requestClientForTour('photo');
      return;
    }
    await saveAiPlanPhoto(planId, activityId, photo); await reload();
  }, [reload, requestClientForTour, tourMode]);
  const publishPlan = useCallback(async (plan: AiTravelPlan, initialFinance?: TripPlan) => {
    const updated = await publishAiPlan(plan, initialFinance); await reload(); return updated;
  }, [reload]);
  const saveJournalVisit = useCallback(async (...args: Parameters<typeof recordPlannerJournalVisit>) => {
    const result = await recordPlannerJournalVisit(...args);
    await reload();
    return result;
  }, [reload]);
  const openJournalPlace = useCallback((placeId: string) => {
    setSelectedCityCode(null);
    setTargetEntryId(null);
    setTargetPlaceId(placeId);
    setPage('detail');
  }, []);
  const savePlannerPreferences = useCallback(async (preferences: PlannerPreferences) => {
    await saveItem('plannerPreferences', preferences); await reload();
  }, [reload]);
  const recommendProvince = useCallback((name: string) => {
    setPlannerProvince({ name, token: Date.now() }); openPage('plan');
  }, [openPage]);

  const saveMark = useCallback(async (mark: CityMark) => {
    try { await saveItem('marks', mark); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const saveEntry = useCallback(async (entry: DayEntry) => {
    try { await saveItem('entries', entry); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
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
    try { await saveMediaBatch(items, entries); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, requestClientForTour, showError, tourMode]);
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
    try { const linked = await saveJourneyAndLinkCityRecords(trip); await reload(); return linked; }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const savePlace = useCallback(async (place: JourneyPlace) => {
    try { await saveItem('places', place); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const savePlan = useCallback(async (plan: TripPlan) => {
    try { await saveItem('plans', plan); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const movePlan = useCallback(async (legacyId: string, plan: TripPlan) => {
    try { await moveLegacyPlanToJourney(legacyId, plan); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const saveBadge = useCallback(async (badge: Badge) => {
    try { await saveItem('badges', badge); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const saveProfile = useCallback(async (profile: LocalProfile) => {
    try { await saveItem('profile', profile); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);

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
              {item.id === 'profile' && availableUpdate && (
                <i className="nav-update-dot" aria-label={t('有新版本可更新', 'Update available')} />
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
          ) : (
            <span className="local-pill">{t('本机版', 'Local')}</span>
          )}
          <button
            type="button"
            className="topbar-avatar-btn"
            aria-label={avatarNickname}
            title={t('打开个人中心', 'Open Personal Center')}
            onClick={() => openPage('profile')}
          >
            <TravelAvatar avatarId={activeProfile?.avatar} nickname={avatarNickname} className="avatar" />
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
      {ready && !tourMode && page === 'map' && !demoMode && !demoDismissed && snapshot.marks.length === 0 && snapshot.trips.length === 0 && snapshot.aiPlans.length === 0 && (
        <section className="demo-welcome-bar" aria-label={t('演示模式引导', 'Demo mode prompt')}>
          <div className="demo-welcome-copy">
            <strong>{t('✨ 第一次来？一键载入演示数据快速体验', '✨ First time here? Try Demo Mode with sample data')}</strong>
            <span>{t('内含 14 座点亮城市、完整大理 AI 行程路书与路线地图、照片手账及每日账本，随时一键清空。', 'Includes 14 lit cities, a full Dali AI roadbook & route map, photo journal, and daily ledger—clear anytime.')}</span>
          </div>
          <div className="demo-welcome-actions">
            <button type="button" className="primary" disabled={demoBusy} onClick={() => void enterDemoMode(false)}>
              {demoBusy ? t('正在载入示例…', 'Loading sample…') : t('✨ 体验示例数据', '✨ Try Sample Data')}
            </button>
            <button type="button" className="secondary" disabled={demoBusy} onClick={() => { writeDemoDismissed(); setDemoDismissed(true); }}>
              {t('暂不需要', 'Not now')}
            </button>
          </div>
        </section>
      )}
      {ready && availableUpdate && !updateBannerDismissed && page !== 'profile' && (
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
            <button type="button" className="text-button" onClick={() => setUpdateBannerDismissed(true)}>
              {t('稍后', 'Later')}
            </button>
          </div>
        </div>
      )}
      {ready && demoMode && !tourMode && (
        <div className="demo-active-bar" role="status">
          <span>{t('✨ 演示模式体验中 · 包含示例足迹、大理 AI 路书、照片手账与账本', '✨ Demo Mode active · Exploring sample footprints, Dali AI roadbook, journal & ledger')}</span>
          <button type="button" className="secondary" disabled={demoBusy} onClick={() => void exitDemoMode()}>
            {demoBusy ? t('清空中…', 'Clearing…') : t('退出并清空示例', 'Exit & Clear Demo')}
          </button>
        </div>
      )}
      <main>{!ready ? <div className="empty-state">{t('正在读取本机旅行数据…', 'Loading local travel data…')}</div> : <>
        {/* 保持规划组件挂载，让 AI 请求和小红书解析在浏览其他页面时继续。 */}
        {plannerOpened && <div hidden={page !== 'plan'}>
          <Suspense fallback={<div className="empty-state">{t('正在打开页面…', 'Opening page…')}</div>}>
            <PlanView visible={page === 'plan'} onReturnToPlanner={() => openPage('plan')} city={selectedCity} marks={effectiveMarks} trips={snapshot.trips} plans={snapshot.plans} onSave={savePlan} onMoveLegacy={movePlan} onCreateJourney={() => openPage('detail')} onError={showError} onNotice={showNotice} aiPlans={snapshot.aiPlans} preferences={snapshot.plannerPreferences[0]} provinceIntent={plannerProvince} onSaveAi={saveAiPlan} onSaveAiPhoto={saveAiPhoto} onPublishAi={publishPlan} onSavePreferences={savePlannerPreferences} onSaveJournalVisit={saveJournalVisit} onOpenJournalPlace={openJournalPlace} webTourMode={tourMode} onRequireClient={requestClientForTour} />
          </Suspense>
        </div>}
        {/* 保持足迹地图挂载，从其他页面切回地图时秒开无重载。 */}
        <div hidden={page !== 'map'}>
          <MapView visible={page === 'map'} marks={effectiveMarks} activeProvinceCode={activeProvinceCode} setActiveProvinceCode={setActiveProvinceCode} onSelectCity={selectCity} onError={showError} onRecommendProvince={recommendProvince} />
        </div>
        <Suspense fallback={<div className="empty-state">{t('正在打开页面…', 'Opening page…')}</div>}>
          {page === 'detail' && <DetailView city={selectedCity} marks={effectiveMarks} entries={snapshot.entries} media={snapshot.media} trips={snapshot.trips} aiPlans={snapshot.aiPlans} places={snapshot.places} targetEntryId={targetEntryId} targetPlaceId={targetPlaceId} onOpenMap={() => openPage('map')} onSaveEntry={saveEntry} onSaveMedia={saveMedia} onSaveMediaGroup={saveMediaGroup} onUpdateMedia={updateMedia} onDeleteMedia={deleteMedia} onSaveTrip={saveTrip} onSavePlace={savePlace} onSaveCityMark={saveMark} onUpdateMark={updateSelectedMark} onError={showError} onNotice={showNotice} webTourMode={tourMode} onRequireClient={requestClientForTour} />}
          {page === 'achievements' && <AchievementsView marks={effectiveMarks} entries={snapshot.entries} trips={snapshot.trips} media={snapshot.media} badges={snapshot.badges} onSaveBadge={saveBadge} onOpenEntry={openEntry} onError={showError} onNotice={showNotice} webTourMode={tourMode} onRequireClient={requestClientForTour} />}
          {page === 'profile' && <ProfileView snapshot={snapshot} activeProvinceCode={activeProvinceCode} resetSettingsToken={profileResetToken} demoMode={demoMode} demoBusy={demoBusy} availableUpdate={availableUpdate} updateFocusToken={updateFocusToken} updateCheckToken={updateCheckToken} onUpdateFound={setAvailableUpdate} onLoadDemo={() => void enterDemoMode(true)} onClearDemo={() => void exitDemoMode()} onSaveProfile={saveProfile} onImported={(data) => {
            // 恢复备份会替换行程数据，清除上一份数据上打开的规划会话。
            setPlannerOpened(false);
            setDemoMode(false);
            setSnapshot(data);
            setSelectedCityCode(null);
            setPage('map');
          }} onError={showError} onNotice={showNotice} />}
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
    {notice && (
      <div className="toast" role="status">
        {notice}
        <button onClick={() => setNotice(null)} aria-label={t('关闭提示', 'Dismiss notice')}>×</button>
      </div>
    )}
  </div>;
}
