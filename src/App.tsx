import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AdministrativeFeature, AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile, PageName, TravelMedia, TripPlan } from './types';
import { deleteMediaRecord, loadSnapshot, moveLegacyPlanToJourney, recordPlannerJournalVisit, saveItem, saveJourneyAndLinkCityRecords, saveMediaBatch, saveAiPlan as saveAiPlanRecord, saveAiPlanPhoto, publishAiPlan } from './db';
import type { AiTravelPlan, PlannerPhoto, PlannerPreferences } from './planner-types';
import { provinceCodeForCity } from './map-data';
import { describeStorageError } from './utils';
import { applyThemeMode, useThemeMode, type ThemeMode } from './theme';
import MapView from './components/MapView';
import { TravelCover, TravelIcon } from './components/TravelArt';
import { CuteSticker, TravelAvatar } from './components/CuteArt';

// The map is the first screen. Media parsing, ZIP backup and secondary pages
// arrive only when the user opens their respective sections.
const DetailView = lazy(() => import('./components/DetailView'));
const PlanView = lazy(() => import('./components/PlannerWorkspace'));
const AchievementsView = lazy(() => import('./components/AchievementsView'));
const ProfileView = lazy(() => import('./components/ProfileView'));

const EMPTY_SNAPSHOT: AppSnapshot = { marks: [], entries: [], plans: [], media: [], badges: [], profile: [], trips: [], places: [], aiPlans: [], plannerPreferences: [] };
const THEME_LABELS: Record<ThemeMode, { icon: string; label: string }> = {
  system: { icon: '◐', label: '跟随系统' }, light: { icon: '☀', label: '浅色' }, dark: { icon: '☾', label: '深色' },
};
const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark'];
/** 顶栏主题切换：跟随系统 → 浅色 → 深色 循环。 */
function ThemeSwitch() {
  const mode = useThemeMode();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
  return <button type="button" className="theme-switch" title={`当前：${THEME_LABELS[mode].label}，点击切换为${THEME_LABELS[next].label}`}
    aria-label={`主题：${THEME_LABELS[mode].label}`} onClick={() => applyThemeMode(next)}>
    <span className="theme-switch-icon" aria-hidden="true">{THEME_LABELS[mode].icon}</span><span className="theme-switch-label">{THEME_LABELS[mode].label}</span>
  </button>;
}

const NAV_ITEMS: Array<{ id: PageName; label: string; icon: string }> = [
  { id: 'map', label: '地图足迹', icon: '◎' },
  { id: 'plan', label: '行程规划', icon: '▦' },
  { id: 'detail', label: '旅行手账', icon: '▤' },
  { id: 'achievements', label: '旅途成就', icon: '✦' },
  { id: 'profile', label: '个人中心', icon: '◉' },
];

interface PendingCity {
  code: string;
  name: string;
  provinceCode: string;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<PageName>('map');
  const [plannerOpened, setPlannerOpened] = useState(false);
  const [activeProvinceCode, setActiveProvinceCode] = useState<string | null>(null);
  const [selectedCityCode, setSelectedCityCode] = useState<string | null>(null);
  const [actionCity, setActionCity] = useState<PendingCity | null>(null);
  const [targetEntryId, setTargetEntryId] = useState<string | null>(null);
  const [targetPlaceId, setTargetPlaceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plannerProvince, setPlannerProvince] = useState<{ name: string; token: number } | null>(null);

  const showNotice = useCallback((message: string) => setNotice(message), []);
  const showError = useCallback((message: string) => setNotice(`操作未完成：${message}`), []);
  const openPage = useCallback((nextPage: PageName) => {
    if (nextPage === 'plan') setPlannerOpened(true);
    if (nextPage === 'detail') {
      setTargetEntryId(null);
      setTargetPlaceId(null);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    loadSnapshot().then((data) => {
      setSnapshot(data);
      setReady(true);
    }).catch((error: unknown) => {
      showError(describeStorageError(error));
      setReady(true);
    });
  }, [showError]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const reload = useCallback(async () => setSnapshot(await loadSnapshot()), []);
  const saveAiPlan = useCallback(async (plan: AiTravelPlan, expectedVersion: number | null) => {
    await saveAiPlanRecord(plan, expectedVersion); await reload();
  }, [reload]);
  const saveAiPhoto = useCallback(async (planId: string, activityId: string, photo: PlannerPhoto) => {
    await saveAiPlanPhoto(planId, activityId, photo); await reload();
  }, [reload]);
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
    try { await saveMediaBatch([{ media, blob }]); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const saveMediaGroup = useCallback(async (items: Array<{ media: TravelMedia; blob: Blob }>, entries: DayEntry[]) => {
    try { await saveMediaBatch(items, entries); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const updateMedia = useCallback(async (media: TravelMedia) => {
    try { await saveItem('media', media); await reload(); }
    catch (error) { showError(describeStorageError(error)); throw error; }
  }, [reload, showError]);
  const deleteMedia = useCallback(async (id: string) => {
    try { await deleteMediaRecord(id); await reload(); showNotice('媒体已删除。'); }
    catch (error) { showError(describeStorageError(error)); }
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
      showNotice(`${mark.name}已点亮为已去过，再次点击可进入旅行手账或取消点亮。`);
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
      showNotice(`${mark.name}已取消点亮。`);
    } catch { /* saveMark reports the storage error and keeps the dialog open. */ }
  }

  async function updateSelectedMark(visited: boolean): Promise<void> {
    if (!selectedCity) return;
    await saveMark({ ...selectedCity, visited, planned: false, updatedAt: new Date().toISOString() });
    showNotice('城市状态已更新。');
  }

  function openEntry(entry: DayEntry): void {
    setSelectedCityCode(entry.cityCode);
    setTargetEntryId(entry.id);
    setTargetPlaceId(null);
    setPage('detail');
  }

  const activeProfile = snapshot.profile[0];

  return <div className={`app-shell${page === 'map' ? ' is-map-page' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">旅</div><div><strong>旅行足迹</strong><span>自己的旅行小册子</span></div></div>
      <nav aria-label="主导航">{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item nav-${item.id} ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => openPage(item.id)}><span className="nav-icon"><TravelIcon name={item.id} /></span>{item.label}</button>)}</nav>
      <div className="sidebar-postcard cute-deco" aria-hidden="true">
        <div className="sidebar-postcard-frame"><TravelCover label="" /></div>
      </div>
      <div className="sidebar-doodle cute-deco" aria-hidden="true">
        <svg className="sidebar-doodle-trail" viewBox="0 0 180 76" fill="none">
          <path d="M18 58C44 26 78 24 108 42C128 54 148 44 162 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3.5 4.5" opacity="0.45" />
          <path d="M156 17l10-3-4 10-2.5-3.5L156 17Z" fill="var(--warm-green)" opacity="0.85" />
          <circle cx="34" cy="24" r="2.2" fill="#f7b267" opacity="0.7" />
          <circle cx="96" cy="18" r="1.8" fill="#7dc9b8" opacity="0.75" />
          <circle cx="136" cy="58" r="2.2" fill="#f28482" opacity="0.65" />
        </svg>
        <CuteSticker kind="cloud" className="sidebar-doodle-item is-cloud" />
        <CuteSticker kind="sparkle" className="sidebar-doodle-item is-sparkle" />
        <CuteSticker kind="suitcase" className="sidebar-doodle-item is-suitcase" />
        <CuteSticker kind="compass" className="sidebar-doodle-item is-compass" />
        {/* 小邮戳和热气球沿用侧栏插画组件，和下面的路线组成一组贴纸。 */}
        <CuteSticker kind="stamp" className="sidebar-doodle-item is-postmark" />
        <TravelAvatar avatarId="balloon" nickname="" className="sidebar-doodle-item is-balloon" />
      </div>
      <div className="sidebar-footer"><span className="footer-dot" />本机保存 · 离线地图</div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><strong>{NAV_ITEMS.find((item) => item.id === page)?.label}</strong><span>把走过的路，留在地图上</span></div><div className="topbar-right"><ThemeSwitch /><span className="local-pill">本机版</span><button type="button" className="topbar-avatar-btn" aria-label={activeProfile?.nickname || '旅行者'} title="打开个人中心" onClick={() => openPage('profile')}><TravelAvatar avatarId={activeProfile?.avatar} nickname={activeProfile?.nickname || '旅行者'} className="avatar" /></button></div></header>
      <main>{!ready ? <div className="empty-state">正在读取本机旅行数据…</div> : <>
        {/* 保持规划组件挂载，让 AI 请求和小红书解析在浏览其他页面时继续。 */}
        {plannerOpened && <div hidden={page !== 'plan'}>
          <Suspense fallback={<div className="empty-state">正在打开页面…</div>}>
            <PlanView visible={page === 'plan'} onReturnToPlanner={() => openPage('plan')} city={selectedCity} marks={effectiveMarks} trips={snapshot.trips} plans={snapshot.plans} onSave={savePlan} onMoveLegacy={movePlan} onCreateJourney={() => openPage('detail')} onError={showError} onNotice={showNotice} aiPlans={snapshot.aiPlans} preferences={snapshot.plannerPreferences[0]} provinceIntent={plannerProvince} onSaveAi={saveAiPlan} onSaveAiPhoto={saveAiPhoto} onPublishAi={publishPlan} onSavePreferences={savePlannerPreferences} onSaveJournalVisit={saveJournalVisit} onOpenJournalPlace={openJournalPlace} />
          </Suspense>
        </div>}
        <Suspense fallback={<div className="empty-state">正在打开页面…</div>}>
        {page === 'map' && <MapView marks={effectiveMarks} activeProvinceCode={activeProvinceCode} setActiveProvinceCode={setActiveProvinceCode} onSelectCity={selectCity} onError={showError} onRecommendProvince={recommendProvince} />}
        {page === 'detail' && <DetailView city={selectedCity} marks={effectiveMarks} entries={snapshot.entries} media={snapshot.media} trips={snapshot.trips} places={snapshot.places} targetEntryId={targetEntryId} targetPlaceId={targetPlaceId} onSaveEntry={saveEntry} onSaveMedia={saveMedia} onSaveMediaGroup={saveMediaGroup} onUpdateMedia={updateMedia} onDeleteMedia={deleteMedia} onSaveTrip={saveTrip} onSavePlace={savePlace} onSaveCityMark={saveMark} onUpdateMark={updateSelectedMark} onError={showError} onNotice={showNotice} />}
        {page === 'achievements' && <AchievementsView marks={effectiveMarks} entries={snapshot.entries} trips={snapshot.trips} media={snapshot.media} badges={snapshot.badges} onSaveBadge={saveBadge} onOpenEntry={openEntry} onError={showError} onNotice={showNotice} />}
        {page === 'profile' && <ProfileView snapshot={snapshot} onSaveProfile={saveProfile} onImported={(data) => {
          // 恢复备份会替换行程数据，清除上一份数据上打开的规划会话。
          setPlannerOpened(false);
          setSnapshot(data);
          setSelectedCityCode(null);
          setPage('map');
        }} onError={showError} onNotice={showNotice} />}
        </Suspense>
      </>}</main>
    </div>
    {actionCity && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionCity(null); }}><div className="dialog city-action-dialog" role="dialog" aria-modal="true" aria-labelledby="city-dialog-title"><span className="city-dialog-pill">已点亮足迹</span><h2 id="city-dialog-title">{actionCity.name}</h2><p>{actionCityLockedByTrip ? '这座城市已关联到已保存的旅行，可进入旅行手账查看或编辑。' : '这座城市已点亮，可进入旅行手账记录回忆，或取消点亮状态。'}</p><div className="dialog-actions"><button className="primary" onClick={openActionCityJournal}>进入旅行手账</button><button className="secondary" disabled={actionCityLockedByTrip} title={actionCityLockedByTrip ? '该城市已包含在已保存的旅行中，请在旅行手账中调整' : undefined} onClick={() => void unvisitActionCity()}>取消点亮</button><button className="text-button" onClick={() => setActionCity(null)}>取消</button></div></div></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
  </div>;
}
