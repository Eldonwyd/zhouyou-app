import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { AdministrativeFeature, AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile, PageName, TravelMedia, TripPlan } from './types';
import { deleteMediaRecord, loadSnapshot, moveLegacyPlanToJourney, saveItem, saveMediaBatch } from './db';
import { provinceCodeForCity } from './map-data';
import { describeStorageError } from './utils';
import MapView from './components/MapView';

// The map is the first screen. Media parsing, ZIP backup and secondary pages
// arrive only when the user opens their respective sections.
const DetailView = lazy(() => import('./components/DetailView'));
const PlanView = lazy(() => import('./components/PlanView'));
const AchievementsView = lazy(() => import('./components/AchievementsView'));
const ProfileView = lazy(() => import('./components/ProfileView'));

const EMPTY_SNAPSHOT: AppSnapshot = { marks: [], entries: [], plans: [], media: [], badges: [], profile: [], trips: [], places: [] };
const NAV_ITEMS: Array<{ id: PageName; label: string; icon: string }> = [
  { id: 'map', label: '地图足迹', icon: '◎' },
  { id: 'detail', label: '旅行记录', icon: '▤' },
  { id: 'plan', label: '计划与花费', icon: '▦' },
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
  const [activeProvinceCode, setActiveProvinceCode] = useState<string | null>(null);
  const [selectedCityCode, setSelectedCityCode] = useState<string | null>(null);
  const [pendingCity, setPendingCity] = useState<PendingCity | null>(null);
  const [targetEntryId, setTargetEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = useCallback((message: string) => setNotice(message), []);
  const showError = useCallback((message: string) => setNotice(`操作未完成：${message}`), []);

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

  const reload = useCallback(async () => setSnapshot(await loadSnapshot()), []);

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
    try { await saveItem('trips', trip); await reload(); }
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

  // Planned journeys keep the lighter map color until they become visited.
  // Existing journeys without status are treated as visited for compatibility.
  const effectiveMarks = useMemo(() => {
    const byCode = new Map(snapshot.marks.map((mark) => [mark.id, mark]));
    for (const trip of snapshot.trips) for (const city of trip.cities) {
      const old = byCode.get(city.code);
      byCode.set(city.code, {
        id: city.code, name: city.name, provinceCode: city.provinceCode,
        visited: Boolean(old?.visited || trip.status !== 'planned'),
        planned: Boolean(old?.planned || trip.status === 'planned'),
        updatedAt: old?.updatedAt ?? trip.createdAt,
      });
    }
    return [...byCode.values()];
  }, [snapshot.marks, snapshot.trips]);
  const selectedCity = effectiveMarks.find((mark) => mark.id === selectedCityCode) ?? null;

  const selectCity = useCallback((feature: AdministrativeFeature, province: AdministrativeFeature) => {
    const code = String(feature.properties.adcode);
    const existing = effectiveMarks.find((mark) => mark.id === code);
    if (existing?.visited || existing?.planned) {
      setSelectedCityCode(code);
      setTargetEntryId(null);
      setPage('detail');
      return;
    }
    setPendingCity({ code, name: feature.properties.name, provinceCode: String(province.properties.adcode) });
  }, [effectiveMarks]);

  async function markPending(kind: 'visited' | 'planned'): Promise<void> {
    if (!pendingCity) return;
    const mark: CityMark = {
      id: pendingCity.code, name: pendingCity.name,
      provinceCode: pendingCity.provinceCode || provinceCodeForCity(pendingCity.code),
      visited: kind === 'visited', planned: kind === 'planned', updatedAt: new Date().toISOString(),
    };
    try {
      await saveMark(mark);
      setSelectedCityCode(mark.id);
      setPendingCity(null);
      setPage(kind === 'visited' ? 'detail' : 'plan');
      showNotice(`${mark.name}已标记为${kind === 'visited' ? '已去过' : '将要去'}。`);
    } catch { /* saveMark reports the storage error and keeps the choice visible. */ }
  }

  async function updateSelectedMark(visited: boolean, planned: boolean): Promise<void> {
    if (!selectedCity) return;
    await saveMark({ ...selectedCity, visited, planned, updatedAt: new Date().toISOString() });
    showNotice('城市状态已更新。');
  }

  function openEntry(entry: DayEntry): void {
    setSelectedCityCode(entry.cityCode);
    setTargetEntryId(entry.id);
    setPage('detail');
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-symbol">◎</div><div><strong>旅行足迹</strong><span>TRAVEL FOOTPRINTS</span></div></div><nav aria-label="主导航">{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav><div className="sidebar-footer"><span className="footer-dot" />本机保存 · 离线地图</div></aside>
    <div className="main-shell"><header className="topbar"><div><strong>{NAV_ITEMS.find((item) => item.id === page)?.label}</strong><span>把走过的路，留在地图上</span></div><div className="topbar-right"><span className="local-pill">本机版</span><span className="avatar" aria-label={snapshot.profile[0]?.nickname || '旅行者'}>{(snapshot.profile[0]?.nickname || '旅')[0]}</span></div></header>
      <main>{!ready ? <div className="empty-state">正在读取本机旅行数据…</div> : <Suspense fallback={<div className="empty-state">正在打开页面…</div>}>
        {page === 'map' && <MapView marks={effectiveMarks} activeProvinceCode={activeProvinceCode} setActiveProvinceCode={setActiveProvinceCode} onSelectCity={selectCity} onError={showError} />}
        {page === 'detail' && <DetailView city={selectedCity} entries={snapshot.entries} media={snapshot.media} trips={snapshot.trips} places={snapshot.places} targetEntryId={targetEntryId} onSaveEntry={saveEntry} onSaveMedia={saveMedia} onSaveMediaGroup={saveMediaGroup} onUpdateMedia={updateMedia} onDeleteMedia={deleteMedia} onSaveTrip={saveTrip} onSavePlace={savePlace} onUpdateMark={updateSelectedMark} onError={showError} onNotice={showNotice} />}
        {page === 'plan' && <PlanView city={selectedCity} marks={effectiveMarks} trips={snapshot.trips} plans={snapshot.plans} onSave={savePlan} onMoveLegacy={movePlan} onCreateJourney={() => setPage('detail')} onError={showError} onNotice={showNotice} />}
        {page === 'achievements' && <AchievementsView marks={effectiveMarks} entries={snapshot.entries} trips={snapshot.trips} badges={snapshot.badges} onSaveBadge={saveBadge} onOpenEntry={openEntry} onError={showError} onNotice={showNotice} />}
        {page === 'profile' && <ProfileView snapshot={snapshot} onSaveProfile={saveProfile} onImported={(data) => { setSnapshot(data); setSelectedCityCode(null); setPage('map'); }} onError={showError} onNotice={showNotice} />}
      </Suspense>}</main>
    </div>
    {pendingCity && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingCity(null); }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="city-dialog-title"><span className="eyebrow">ADD TO MAP</span><h2 id="city-dialog-title">{pendingCity.name}</h2><p>选择这座城市在旅行地图上的状态。</p><div className="dialog-actions"><button className="primary" onClick={() => void markPending('visited')}>标记为已去过</button><button className="secondary" onClick={() => void markPending('planned')}>标记为将要去</button><button className="text-button" onClick={() => setPendingCity(null)}>取消</button></div></div></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
  </div>;
}
