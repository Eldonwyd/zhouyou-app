import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, LocalProfile } from '../types';
import { exportBackup, importBackup } from '../backup';
import { getPlannerApiOrigin, setPlannerApiOrigin } from '../api-base';
import { applyLanguage, useI18n, type AppLanguage } from '../i18n';
import { MAP_APP_OPTIONS, readMapAppProvider, writeMapAppProvider, type MapAppProvider } from '../external-app-links';
import { TravelIcon } from './TravelArt';
import { AVATAR_PRESETS, CuteSticker, TravelAvatar, getTravelerLevel } from './CuteArt';
import AppearanceSettings from './AppearanceSettings';
import OfflineMapSettings from './OfflineMapSettings';
import AppUpdateCard from './AppUpdateCard';
import AiUsageSettingsCard from './AiUsageSettingsCard';
import type { AppUpdateInfo } from '../app-updater';

interface ProfileViewProps {
  snapshot: AppSnapshot;
  activeProvinceCode: string | null;
  resetSettingsToken?: number;
  availableUpdate?: AppUpdateInfo | null;
  updateFocusToken?: number;
  updateCheckToken?: number;
  onUpdateFound?: (info: AppUpdateInfo | null) => void;
  onSaveProfile: (profile: LocalProfile) => Promise<void>;
  onImported: (snapshot: AppSnapshot) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const DEFAULT_MOTTO_ZH = '把喜欢的风和日落，悄悄夹进旅行小册子 ✨';
const DEFAULT_MOTTO_EN = 'Tucking favorite breezes and sunsets into my travel booklet ✨';

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export default function ProfileView({
  snapshot,
  activeProvinceCode,
  resetSettingsToken,
  availableUpdate,
  updateFocusToken,
  updateCheckToken,
  onUpdateFound,
  onSaveProfile,
  onImported,
  onError,
  onNotice,
}: ProfileViewProps) {
  const { lang, isEn, locale, t } = useI18n();

  const savedProfile = snapshot.profile[0];
  const defaultNickname = t('旅行者', 'Traveler');
  const defaultMotto = isEn ? DEFAULT_MOTTO_EN : DEFAULT_MOTTO_ZH;
  const displaySavedNickname = savedProfile?.nickname && savedProfile.nickname !== '旅行者'
    ? savedProfile.nickname
    : (savedProfile?.nickname ? defaultNickname : defaultNickname);
  const displaySavedMotto = savedProfile?.motto && savedProfile.motto !== DEFAULT_MOTTO_ZH
    ? savedProfile.motto
    : defaultMotto;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [nickname, setNickname] = useState(savedProfile?.nickname ?? '旅行者');
  const [avatar, setAvatar] = useState(savedProfile?.avatar ?? 'bear');
  const [motto, setMotto] = useState(savedProfile?.motto ?? DEFAULT_MOTTO_ZH);
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [backupAction, setBackupAction] = useState<'export' | 'import' | null>(null);
  const [editing, setEditing] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem('travel-last-backup') ?? ''; } catch { return ''; }
  });
  const [apiOrigin, setApiOrigin] = useState(() => getPlannerApiOrigin());
  const [testingApi, setTestingApi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNickname(savedProfile?.nickname ?? '旅行者');
    setAvatar(savedProfile?.avatar ?? 'bear');
    setMotto(savedProfile?.motto ?? DEFAULT_MOTTO_ZH);
  }, [savedProfile]);

  useEffect(() => {
    navigator.storage?.estimate()
      .then((estimate) => setStorageEstimate({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }))
      .catch(() => undefined);
  }, [snapshot.media.length]);

  useEffect(() => {
    if (resetSettingsToken) setSettingsOpen(false);
  }, [resetSettingsToken]);

  useEffect(() => {
    if (updateFocusToken) {
      setEditing(false);
      setSettingsOpen(true);
      setPendingSectionId('app-update-card');
    }
  }, [updateFocusToken]);

  useEffect(() => {
    if (!settingsOpen || !pendingSectionId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(pendingSectionId);
      if (target) {
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'start',
        });
        if (pendingSectionId === 'travel-data-backup') target.focus({ preventScroll: true });
      }
      setPendingSectionId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen, pendingSectionId]);

  function openSettings(sectionId?: string): void {
    setEditing(false);
    setSettingsOpen(true);
    if (sectionId) {
      setPendingSectionId(sectionId);
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function scrollToSettingsSection(sectionId: string): void {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }

  function handleLanguageSelect(next: AppLanguage): void {
    if (next === lang) return;
    applyLanguage(next);
    onNotice(next === 'en' ? 'Language switched to English.' : '已切换为简体中文。');
  }

  const visitedCityCount = snapshot.marks.filter((m) => m.visited).length;
  const photoCount = snapshot.media.filter((item) => item.kind === 'photo').length;
  const videoCount = snapshot.media.filter((item) => item.kind === 'video').length;
  const audioCount = snapshot.media.filter((item) => item.kind === 'audio').length;
  const levelInfo = getTravelerLevel(visitedCityCount, snapshot.entries.length, lang);
  const profileStats = [
    { icon: '📍', count: visitedCityCount, unit: t('座城市', 'Cities') },
    { icon: '🧳', count: snapshot.trips.length, unit: t('段旅行', 'Trips') },
    { icon: '📷', count: photoCount, unit: t('张照片', 'Photos') },
  ];

  const backupHealthy = Boolean(lastBackup && (Date.now() - Date.parse(lastBackup)) < 30 * 86_400_000);
  const storagePct = storageEstimate?.quota ? Math.min(100, Math.max(3, (storageEstimate.usage / storageEstimate.quota) * 100)) : 0;

  async function saveMyProfile(): Promise<void> {
    try {
      await onSaveProfile({
        id: 'profile',
        nickname: nickname.trim() || '旅行者',
        avatar,
        motto: motto.trim() || DEFAULT_MOTTO_ZH,
      });
      setEditing(false);
      onNotice(t('旅人名片已更新。', 'Traveler card updated.'));
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : t('保存失败', 'Failed to save'));
    }
  }

  /** 下载后仅记录提示用的时间，浏览器拒绝保存这个时间也不影响 ZIP。 */
  async function handleExport(): Promise<void> {
    setBackupAction('export');
    try {
      await exportBackup();
      const time = new Date().toISOString();
      try { localStorage.setItem('travel-last-backup', time); } catch { /* 当前页面仍可显示导出时间。 */ }
      setLastBackup(time);
      onNotice(t('完整备份文件已生成。', 'Full backup archive downloaded.'));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('导出失败', 'Export failed'));
    } finally {
      setBackupAction(null);
    }
  }

  /** 先清空选择器，取消或失败后也能再次选择同一份 ZIP。 */
  async function handleImport(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || backupAction) return;
    setBackupAction('import');
    try {
      const imported = await importBackup(file, (data) => window.confirm(
        isEn
          ? `Import "${file.name}" with ${data.trips.length} trips, ${data.entries.length} entries, ${data.places.length} places, ${data.aiPlans.length} AI plans, and ${data.media.length} media files?\n\nThis will overwrite all travel data in this browser. Continue?`
          : `将导入「${file.name}」，包含 ${data.trips.length} 段旅行、${data.entries.length} 篇手账、${data.places.length} 处地点、${data.aiPlans.length} 份 AI 计划、${data.media.length} 个媒体文件。\n\n此操作会覆盖当前浏览器的全部旅行数据。确认覆盖吗？`,
      ));
      if (!imported) return;
      onImported(imported);
      onNotice(t('备份已导入，旅行记录和媒体已恢复。', 'Backup imported. Travel records and media restored.'));
    } catch (error) {
      onError(error instanceof Error ? error.message : t('导入失败', 'Import failed'));
    } finally {
      setBackupAction(null);
    }
  }

  async function handleSaveApiOrigin(): Promise<void> {
    try {
      const saved = setPlannerApiOrigin(apiOrigin);
      setApiOrigin(saved);
      if (!saved) {
        onNotice(t('已恢复使用当前地址的本地 AI 服务。', 'Restored default local AI server.'));
        return;
      }
      setTestingApi(true);
      try {
        const res = await fetch(`${saved}/api/planner/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) onNotice(t(`已保存并连上远程 AI 服务：${saved}`, `Saved and connected to remote AI server: ${saved}`));
        else onNotice(t(`已保存地址（返回状态 ${res.status}），请确认服务端已启动。`, `Address saved (HTTP ${res.status}). Make sure the server is running.`));
      } catch {
        onNotice(t('地址已保存，但暂时未能连通，请确认电脑端或服务器已启动且在同一网络下。', 'Address saved, but could not connect yet. Ensure the server is running on the same network.'));
      } finally {
        setTestingApi(false);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t('地址格式无效', 'Invalid URL format'));
    }
  }

  const [mapApp, setMapApp] = useState<MapAppProvider>(() => readMapAppProvider());

  if (settingsOpen) {
    const quickNavItems = [
      { id: 'settings-ai-usage', label: t('AI 额度与用量', 'AI Quota & Usage') },
      { id: 'settings-language', label: t('语言', 'Language') },
      { id: 'settings-map-app', label: t('导航地图', 'Map App') },
      { id: 'travel-data-backup', label: t('数据导出与导入', 'Backup & Export') },
      { id: 'settings-offline-maps', label: t('离线地图', 'Offline Maps') },
      { id: 'app-update-card', label: t('应用更新', 'Updates') },
      { id: 'settings-more', label: t('更多', 'More') },
    ];

    return (
      <div className="content-page warm-profile profile-settings-view">
        <div className="section-heading settings-view-header">
          <div>
            <button
              type="button"
              className="secondary settings-back-btn"
              onClick={() => {
                setSettingsOpen(false);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
            >
              <span aria-hidden="true">←</span> {t('返回个人中心', 'Back to Profile')}
            </button>
            <h1>{t('偏好与设置', 'Preferences & Settings')}</h1>
            <p>{t('切换界面语言、导出导入备份、管理离线地图、检查应用更新与 AI 服务。', 'Switch language, export or import backups, manage offline maps, check updates, and configure AI server.')}</p>
          </div>
        </div>

        <nav className="settings-quick-nav" aria-label={t('设置分组', 'Settings sections')}>
          {quickNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="settings-quick-pill"
              onClick={() => scrollToSettingsSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* 0. AI 订阅额度与 API 用量统计 */}
        <AiUsageSettingsCard />

        {/* 1. 语言设置 */}
        <section id="settings-language" className="card settings-language-card" aria-labelledby="settings-language-title">
          <div className="card-heading">
            <div>
              <h2 id="settings-language-title">{t('语言 / Language', 'Language / 语言')}</h2>
              <p className="muted">{t('选择应用界面语言，切换后立即生效并保存在本机。', 'Choose the app display language. Changes apply immediately and save locally.')}</p>
            </div>
            <span className="appearance-autosave-pill">{t('即时生效 · 自动保存', 'Instant · Auto-saved')}</span>
          </div>
          <div className="language-option-grid" role="radiogroup" aria-label={t('界面语言', 'Display language')}>
            <button
              type="button"
              role="radio"
              aria-checked={lang === 'zh'}
              className={`language-option-card ${lang === 'zh' ? 'selected' : ''}`}
              onClick={() => handleLanguageSelect('zh')}
            >
              <span className="language-option-badge" aria-hidden="true">中</span>
              <span className="language-option-copy">
                <strong>简体中文</strong>
                <small>Chinese (Simplified)</small>
              </span>
              {lang === 'zh' && <span className="appearance-check" aria-hidden="true">✓</span>}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={lang === 'en'}
              className={`language-option-card ${lang === 'en' ? 'selected' : ''}`}
              onClick={() => handleLanguageSelect('en')}
            >
              <span className="language-option-badge" aria-hidden="true">EN</span>
              <span className="language-option-copy">
                <strong>English</strong>
                <small>英文界面</small>
              </span>
              {lang === 'en' && <span className="appearance-check" aria-hidden="true">✓</span>}
            </button>
          </div>
        </section>

        {/* 1.5 导航地图 App 偏好 */}
        <section id="settings-map-app" className="card settings-language-card" aria-labelledby="settings-map-app-title">
          <div className="card-heading">
            <div>
              <h2 id="settings-map-app-title">{t('导航地图 App', 'Navigation Map App')}</h2>
              <p className="muted">{t('点击行程景点导航时直接打开所选地图 App（未安装时自动回落网页版）。', 'Directly launch your preferred map app for itinerary places (falls back to web if not installed).')}</p>
            </div>
            <span className="appearance-autosave-pill">{t('即时生效 · 自动保存', 'Instant · Auto-saved')}</span>
          </div>
          <div className="language-option-grid" role="radiogroup" aria-label={t('导航地图选择', 'Navigation map choice')}>
            {MAP_APP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={mapApp === opt.id}
                className={`language-option-card ${mapApp === opt.id ? 'selected' : ''}`}
                onClick={() => {
                  setMapApp(opt.id);
                  writeMapAppProvider(opt.id);
                  onNotice(t(`导航地图已切换为 ${opt.label}`, `Navigation map switched to ${opt.enLabel}`));
                }}
              >
                <span className="language-option-badge" aria-hidden="true">{opt.badge}</span>
                <span className="language-option-copy">
                  <strong>{lang === 'en' ? opt.enLabel : opt.label}</strong>
                  <small>{lang === 'en' ? opt.enDesc : opt.desc}</small>
                </span>
                {mapApp === opt.id && <span className="appearance-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </section>

        {/* 2. 数据导出与导入 */}
        <section id="travel-data-backup" className="card backup-card settings-backup-card" tabIndex={-1} aria-labelledby="travel-data-backup-title">
          <div className="backup-card-top">
            <div className="warm-backup-art">
              <CuteSticker kind="suitcase" className="backup-suitcase-svg" />
              <div className="backup-fallback-icon">
                <TravelIcon name="backup" />
              </div>
            </div>
            <span className={`backup-health-pill ${backupHealthy ? 'is-safe' : 'is-remind'}`}>
              {backupHealthy ? t('已安心备份 ✓', 'Backed up ✓') : t('建议留份备份', 'Backup suggested')}
            </span>
          </div>

          <h2 id="travel-data-backup-title">{t('数据导出与导入', 'Data Export & Import')}</h2>
          <p>{t('在手机导出 ZIP 并传到电脑，再在电脑的个人中心 → 设置中选取该文件，即可覆盖电脑浏览器中的旅行数据。', 'Export a ZIP archive on one device and import it in Profile → Settings on another browser to transfer all your travel data.')}</p>

          <div className="heading-actions">
            <button
              className="primary"
              type="button"
              disabled={backupAction !== null}
              onClick={() => void handleExport()}
            >
              {backupAction === 'export' ? t('正在打包备份…', 'Packaging backup…') : t('导出完整备份', 'Export Full Backup')}
            </button>
            <button type="button" className="secondary" disabled={backupAction !== null} onClick={() => inputRef.current?.click()}>
              {backupAction === 'import' ? t('正在检查和导入…', 'Verifying & importing…') : t('导入备份', 'Import Backup')}
            </button>
            <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void handleImport(event.currentTarget)} />
          </div>

          <small className="backup-time-note">
            {lastBackup
              ? t(`上次导出：${new Date(lastBackup).toLocaleString(locale)}`, `Last exported: ${new Date(lastBackup).toLocaleString(locale)}`)
              : t('还没有导出记录，抽空给回忆留个双保险吧。', 'No backups yet. Export a ZIP archive to keep your memories safe.')}
          </small>

          <ul className="warm-backup-list" aria-label={t('备份范围', 'Backup contents')}>
            <li><span>{t('足迹与旅行', 'Footprints & Trips')}</span><strong>{t(`${visitedCityCount} 城 · ${snapshot.trips.length} 段`, `${visitedCityCount} cities · ${snapshot.trips.length} trips`)}</strong></li>
            <li><span>{t('手账与地点', 'Journal & Places')}</span><strong>{t(`${snapshot.entries.length} 篇 · ${snapshot.places.length} 处`, `${snapshot.entries.length} entries · ${snapshot.places.length} places`)}</strong></li>
            <li><span>{t('AI 计划与账本', 'AI Plans & Budgets')}</span><strong>{t(`${snapshot.aiPlans.length} 份 · ${snapshot.plans.length} 本`, `${snapshot.aiPlans.length} plans · ${snapshot.plans.length} ledgers`)}</strong></li>
            <li><span>{t('照片、视频与录音', 'Photos, Videos & Audio')}</span><strong>{t(`${snapshot.media.length} 个文件`, `${snapshot.media.length} files`)}</strong></li>
          </ul>

          <details className="warm-backup-details">
            <summary>{t('备份包里包含哪些内容？', 'What is inside the backup archive?')}</summary>
            <p>{t('包含城市足迹、旅行手账、地点回忆、AI 行程及修改历史、账本、原始照片视频和录音、徽章及个人名片。支持导入旧版本 ZIP。', 'Includes city footprints, journal entries, place memories, AI itineraries & history, budgets, original photos/videos/audio, badges, and profile card. Backward compatible with older ZIP archives.')}</p>
            <small>{t('包含较多大体积视频时，打包可能需要十几秒，请耐心等待下载完成。', 'Large video libraries may take 10–20 seconds to package. Please wait until download completes.')}</small>
          </details>
        </section>

        {/* 4. 离线地图 */}
        <OfflineMapSettings initialProvinceCode={activeProvinceCode} onError={onError} onNotice={onNotice} />

        {/* 5. 应用版本与一键更新（手机端 / 电脑端通用） */}
        <AppUpdateCard
          initialUpdate={availableUpdate}
          autoCheckToken={updateCheckToken}
          onUpdateFound={onUpdateFound}
          onNotice={onNotice}
          onError={onError}
        />

        {/* 6. 远程 AI 服务 */}
        <div id="settings-more" className="settings-more-grid">
          <section className="card" aria-labelledby="remote-ai-server-title">
            <h2 id="remote-ai-server-title">{t('远程 / 局域网 AI 服务', 'Remote / LAN AI Server')}</h2>
            <p className="muted">{t('桌面版已内置本地 AI 服务，通常保持留空即可。在手机 App 或网页版使用时，可填写电脑桌面版或自建服务器的地址以启用完整 AI 行程规划。', 'Desktop includes a built-in AI server (leave blank). On mobile or web, enter your desktop or self-hosted server URL to enable full AI trip planning.')}</p>
            <div className="heading-actions" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <input
                type="url"
                value={apiOrigin}
                onChange={(event) => setApiOrigin(event.target.value)}
                placeholder={t('例如 http://192.168.1.100:14173（留空为默认同源）', 'e.g. http://192.168.1.100:14173 (blank = same origin)')}
                style={{ flex: '1 1 240px', minWidth: 0 }}
              />
              <button type="button" className="primary" disabled={testingApi} onClick={() => void handleSaveApiOrigin()}>
                {testingApi ? t('检测连接中…', 'Testing…') : t('保存并检测', 'Save & Test')}
              </button>
              {apiOrigin ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={testingApi}
                  onClick={() => {
                    setPlannerApiOrigin('');
                    setApiOrigin('');
                    onNotice(t('已清空远程地址，恢复默认本地服务。', 'Cleared remote URL and restored local default.'));
                  }}
                >
                  {t('恢复默认', 'Reset Default')}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="content-page warm-profile">
      <div className="section-heading">
        <div>
          <h1>{t('个人中心', 'Personal Center')}</h1>
          <p>{t('装扮你的旅人小护照，随时切换页面风格；语言、备份与离线地图等均收纳在下方设置中。', 'Customize your traveler passport and page style; language, backups, and offline maps live inside Settings below.')}</p>
        </div>
      </div>

      {/* 旅人护照横幅 + 内联装扮面板 */}
      <section className="warm-profile-banner">
        <span className="washi-tape tape-top-left" aria-hidden="true" />
        <CuteSticker kind="plane" className="profile-float-plane" />
        <CuteSticker kind="sparkle" className="profile-float-sparkle" />
        <div className="profile-banner-main">
          <button
            type="button"
            className="warm-profile-avatar-btn"
            onClick={() => setEditing(!editing)}
            title={t('点击更换头像与资料', 'Edit avatar & profile')}
            aria-expanded={editing}
            aria-controls={editing ? 'profile-dressup-drawer' : undefined}
          >
            <TravelAvatar
              avatarId={editing ? avatar : savedProfile?.avatar}
              nickname={editing ? nickname : displaySavedNickname}
              className="warm-profile-avatar"
            />
            <span className="avatar-edit-dot" aria-hidden="true">✎</span>
          </button>

          <div className="profile-banner-info">
            <div className="profile-name-row">
              <h2>{editing ? (nickname.trim() || defaultNickname) : displaySavedNickname}</h2>
              <span className="profile-level-tag">Lv.{levelInfo.level} {levelInfo.title}</span>
              <span className="profile-local-tag">{t('本机单机版', 'Local Only')}</span>
            </div>
            <p className="profile-motto">{editing ? (motto.trim() || defaultMotto) : displaySavedMotto}</p>
            <div className="profile-quick-chips">
              <span>📍 {t(`${visitedCityCount} 座城市`, `${visitedCityCount} Cities`)}</span>
              <span>🧳 {t(`${snapshot.trips.length} 段旅行`, `${snapshot.trips.length} Trips`)}</span>
              <span>📷 {t(`${photoCount} 张照片`, `${photoCount} Photos`)}</span>
            </div>
            {/* 手机统计独立成行，沿用名片上的足迹、旅程与照片计数。 */}
            <div className="profile-mobile-stats">
              {profileStats.map(({ icon, count, unit }) => (
                <span key={unit}>
                  <span aria-hidden="true">{icon}</span>
                  <strong>{count}</strong>
                  <span className="profile-stat-label">{unit}</span>
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="secondary profile-edit-toggle"
            aria-expanded={editing}
            aria-controls={editing ? 'profile-dressup-drawer' : undefined}
            onClick={() => setEditing(!editing)}
          >
            {editing ? t('收起装扮', 'Close Editor') : t('装扮名片 ✦', 'Edit Card ✦')}
          </button>
        </div>

        {editing && (
          <div id="profile-dressup-drawer" className="profile-dressup-drawer">
            <div className="profile-dressup-fields">
              <label className="stacked">
                {t('我的称呼', 'Nickname')}
                <input
                  value={nickname}
                  maxLength={24}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder={t('给自己起个好听的昵称', 'Choose a traveler nickname')}
                />
              </label>
              <label className="stacked">
                {t('旅行小签名', 'Travel Motto')}
                <input
                  value={motto}
                  maxLength={48}
                  onChange={(event) => setMotto(event.target.value)}
                  placeholder={t('例如：收集世界的日落与晚风 ✨', 'e.g. Collecting sunsets around the world ✨')}
                />
              </label>
            </div>

            <div className="avatar-picker-block">
              <span className="avatar-picker-label">{t('挑选一个可爱旅人头像', 'Choose a traveler avatar')}</span>
              <div className="avatar-picker-grid" role="radiogroup" aria-label={t('旅人头像', 'Traveler avatar')}>
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={avatar === preset.id}
                    className={`avatar-choice ${avatar === preset.id ? 'selected' : ''}`}
                    onClick={() => setAvatar(preset.id)}
                  >
                    <TravelAvatar avatarId={preset.id} nickname={nickname || (isEn ? 'T' : '旅')} className="avatar-choice-preview" />
                    <small>{isEn ? preset.labelEn : preset.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="profile-dressup-actions">
              <button type="button" className="primary" disabled={backupAction !== null} onClick={() => void saveMyProfile()}>
                {t('保存名片装扮', 'Save Profile')}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setNickname(savedProfile?.nickname ?? '旅行者');
                  setAvatar(savedProfile?.avatar ?? 'bear');
                  setMotto(savedProfile?.motto ?? DEFAULT_MOTTO_ZH);
                  setEditing(false);
                }}
              >
                {t('取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 页面风格与明暗直接放在个人中心外面，方便随时换肤 */}
      <AppearanceSettings />

      {/* 双栏 Bento：回忆收藏 + 存储空间 */}
      <div className="profile-grid profile-home-grid">
        <section className="card warm-profile-info">
          <div className="card-heading">
            <h2>{t('我的回忆小收藏', 'My Travel Collection')}</h2>
            <span>{t('全量保存在本机', 'Stored locally')}</span>
          </div>
          <div className="profile-bento-stats">
            <div className="bento-stat-tile tile-sage">
              <small>{t('已去城市', 'Cities')}</small>
              <strong>{visitedCityCount}</strong>
            </div>
            <div className="bento-stat-tile tile-peach">
              <small>{t('记录旅程', 'Trips')}</small>
              <strong>{snapshot.trips.length}</strong>
            </div>
            <div className="bento-stat-tile tile-blue">
              <small>{t('打卡地点', 'Places')}</small>
              <strong>{snapshot.places.length}</strong>
            </div>
            <div className="bento-stat-tile tile-honey">
              <small>{t('珍藏照片', 'Photos')}</small>
              <strong>{photoCount}</strong>
            </div>
            <div className="bento-stat-tile tile-lilac">
              <small>{t('视频 & 语音', 'Video & Audio')}</small>
              <strong>{videoCount + audioCount}</strong>
            </div>
            <div className="bento-stat-tile tile-mint">
              <small>{t('专属徽章', 'Badges')}</small>
              <strong>{snapshot.badges.length}</strong>
            </div>
          </div>
          <p className="muted profile-privacy-note">{t('单机隐私模式：不上传云端、无账号绑定，你的照片、语音和手账只属于这台设备。', 'Local-first privacy: no cloud upload or account required. Your photos, voice notes, and journals stay on this device.')}</p>
        </section>

        <section className="card warm-storage">
          <div className="card-heading">
            <h2>{t('本机存储空间', 'Local Storage')}</h2>
            <span>{storageEstimate ? `${storagePct.toFixed(1)}%` : t('估算中', 'Estimating')}</span>
          </div>
          {storageEstimate ? (
            <>
              <div className="storage-pill-row">
                <div>
                  <small>{t('小册子已占用', 'Used by booklet')}</small>
                  <strong>{readableBytes(storageEstimate.usage)}</strong>
                </div>
                <div className="storage-pill-right">
                  <small>{t('浏览器估算上限', 'Browser quota')}</small>
                  <strong>{readableBytes(storageEstimate.quota)}</strong>
                </div>
              </div>
              <div className="warm-storage-track">
                <span style={{ width: `${storagePct}%` }} />
              </div>
            </>
          ) : (
            <p className="muted">{t('此浏览器暂未提供存储用量估算。', 'Storage usage estimate is unavailable in this browser.')}</p>
          )}
          <p className="muted">{t('照片与视频保存在当前浏览器本地，清理浏览器数据前可在「设置 → 数据导出与导入」留份备份。', 'Photos and videos are stored locally in this browser. Export a backup in Settings before clearing browser data.')}</p>
        </section>
      </div>

      {/* 偏好与设置：放在个人中心最下面，点开进入设置页 */}
      <section className="card profile-settings-entry-card profile-settings-compact-card" aria-label={t('偏好与设置', 'Preferences & Settings')}>
        <button type="button" className="settings-entry-row" onClick={() => openSettings()}>
          <span className="settings-entry-icon is-server"><TravelIcon name="settings" /></span>
          <span className="settings-entry-copy">
            <strong>{t('偏好与设置', 'Preferences & Settings')}</strong>
            <small>{t('AI 订阅额度与 API 用量、语言、数据备份、离线地图与更新', 'AI quota & API usage, language, backup, offline maps & updates')}</small>
          </span>
          <span className={`settings-entry-value ${availableUpdate ? 'is-safe' : ''}`}>
            {availableUpdate ? t(`新版本 v${availableUpdate.latestVersion}`, `v${availableUpdate.latestVersion}`) : t('打开设置', 'Open')}
          </span>
          <span className="settings-entry-chevron" aria-hidden="true">›</span>
        </button>
      </section>
    </div>
  );
}
