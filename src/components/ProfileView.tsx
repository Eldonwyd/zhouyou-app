import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, Badge, CityMark, DayEntry, LocalProfile } from '../types';
import { exportBackup, importBackup } from '../backup';
import { applyLanguage, useI18n, type AppLanguage } from '../i18n';
import { MAP_APP_OPTIONS, readMapAppProvider, writeMapAppProvider, type MapAppProvider } from '../external-app-links';
import { TravelIcon } from './TravelArt';
import { AVATAR_PRESETS, CuteSticker, TravelAvatar, compressAvatarImage, getTravelerLevel, isCustomAvatarUrl } from './CuteArt';
import AppearanceSettings from './AppearanceSettings';
import OfflineMapSettings from './OfflineMapSettings';
import AppUpdateCard from './AppUpdateCard';
import AiUsageSettingsCard from './AiUsageSettingsCard';
import CloudSyncCard from './CloudSyncCard';
import type { AppUpdateInfo } from '../app-updater';
import { cloudApi, getCloudToken, setCloudAuthState, type CloudSelfUser, type FreeAiQuotaSnapshot, type IntimacyBond } from '../cloud-api';
import {
  getSystemNotificationPermission,
  readNotificationPrefs,
  requestSystemNotificationPermission,
  writeNotificationPrefs,
  type NotificationPrefs,
} from '../notification-prefs';
import type { TourRestrictedFeature } from '../web-tour';

const AchievementsView = lazy(() => import('./AchievementsView'));

interface ProfileViewProps {
  snapshot: AppSnapshot;
  effectiveMarks: CityMark[];
  intimacyBonds?: IntimacyBond[];
  activeProvinceCode: string | null;
  resetSettingsToken?: number;
  initialSubView?: 'home' | 'achievements' | 'settings' | 'account' | 'notifications';
  availableUpdate?: AppUpdateInfo | null;
  updateFocusToken?: number;
  updateCheckToken?: number;
  cloudUser?: CloudSelfUser | null;
  syncingCloud?: boolean;
  onOpenAuth?: (mode: 'login' | 'register') => void;
  onSyncNow?: () => Promise<void>;
  onCloudUserUpdated?: (user: CloudSelfUser | null) => void;
  onUpdateFound?: (info: AppUpdateInfo | null) => void;
  onSaveProfile: (profile: LocalProfile) => Promise<void>;
  onSaveBadge: (badge: Badge) => Promise<void>;
  onOpenEntry: (entry: DayEntry) => void;
  onTestNotification?: () => void;
  onStartOnboarding?: () => void;
  onImported: (snapshot: AppSnapshot) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  webTourMode?: boolean;
  onRequireClient?: (feature: TourRestrictedFeature) => void;
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
  effectiveMarks,
  intimacyBonds = [],
  activeProvinceCode,
  resetSettingsToken,
  initialSubView = 'home',
  availableUpdate,
  updateFocusToken,
  updateCheckToken,
  cloudUser = null,
  syncingCloud = false,
  onOpenAuth,
  onSyncNow,
  onCloudUserUpdated,
  onUpdateFound,
  onSaveProfile,
  onSaveBadge,
  onOpenEntry,
  onTestNotification,
  onStartOnboarding,
  onImported,
  onError,
  onNotice,
  webTourMode,
  onRequireClient,
}: ProfileViewProps) {
  const { lang, isEn, locale, t } = useI18n();

  const savedProfile = snapshot.profile[0];
  const defaultNickname = t('旅行者', 'Traveler');
  const defaultMotto = isEn ? DEFAULT_MOTTO_EN : DEFAULT_MOTTO_ZH;
  const resolvedNickname = (savedProfile?.nickname && savedProfile.nickname !== '旅行者')
    ? savedProfile.nickname
    : (cloudUser?.nickname || defaultNickname);
  const resolvedAvatar = savedProfile?.avatar || cloudUser?.avatar || 'bear';
  const displaySavedNickname = resolvedNickname;
  const displaySavedMotto = savedProfile?.motto && savedProfile.motto !== DEFAULT_MOTTO_ZH
    ? savedProfile.motto
    : (cloudUser?.motto || defaultMotto);

  const [subView, setSubView] = useState<'home' | 'achievements' | 'settings' | 'account' | 'notifications'>(initialSubView);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs());
  const [sysNotifPerm, setSysNotifPerm] = useState(() => getSystemNotificationPermission());
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [nickname, setNickname] = useState(resolvedNickname);
  const [avatar, setAvatar] = useState(resolvedAvatar);
  const [motto, setMotto] = useState(savedProfile?.motto ?? cloudUser?.motto ?? DEFAULT_MOTTO_ZH);
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [backupAction, setBackupAction] = useState<'export' | 'import' | null>(null);
  const [editing, setEditing] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => {
    try { return localStorage.getItem('travel-last-backup') ?? ''; } catch { return ''; }
  });
  const [vipQuota, setVipQuota] = useState<FreeAiQuotaSnapshot | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const avatarUploadRef = useRef<HTMLInputElement>(null);
  const avatarCameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (!cloudUser || !getCloudToken()) {
      setVipQuota(null);
      return undefined;
    }
    cloudApi.getFreeAiQuota()
      .then((res) => {
        if (active && res?.ok && res.quota) setVipQuota(res.quota);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [cloudUser?.id]);

  useEffect(() => {
    setNickname(resolvedNickname);
    setAvatar(resolvedAvatar);
    setMotto(savedProfile?.motto ?? cloudUser?.motto ?? DEFAULT_MOTTO_ZH);
  }, [savedProfile, cloudUser?.nickname, cloudUser?.avatar, cloudUser?.motto, resolvedNickname, resolvedAvatar]);

  useEffect(() => {
    navigator.storage?.estimate()
      .then((estimate) => setStorageEstimate({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }))
      .catch(() => undefined);
  }, [snapshot.media.length]);

  useEffect(() => {
    if (resetSettingsToken) setSubView('home');
  }, [resetSettingsToken]);

  useEffect(() => {
    if (updateFocusToken) {
      setEditing(false);
      setSubView('settings');
      setPendingSectionId('app-update-card');
    }
  }, [updateFocusToken]);

  useEffect(() => {
    if (subView !== 'settings' || !pendingSectionId) return;
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
  }, [subView, pendingSectionId]);

  function openSubView(next: 'home' | 'achievements' | 'settings' | 'account' | 'notifications', sectionId?: string): void {
    setEditing(false);
    setSubView(next);
    if (sectionId) {
      setPendingSectionId(sectionId);
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function updateNotifPrefs(updater: (prev: NotificationPrefs) => NotificationPrefs): void {
    setNotifPrefs((prev) => {
      const next = updater(prev);
      writeNotificationPrefs(next);
      return next;
    });
  }

  async function handleToggleSystemPopup(checked: boolean): Promise<void> {
    if (!checked) {
      updateNotifPrefs((prev) => ({ ...prev, systemPopup: false }));
      return;
    }
    const perm = await requestSystemNotificationPermission();
    setSysNotifPerm(perm);
    if (perm === 'granted') {
      updateNotifPrefs((prev) => ({ ...prev, systemPopup: true }));
      onNotice(t('已开启系统级弹窗通知。', 'System popup notifications enabled.'));
    } else if (perm === 'unsupported') {
      onNotice(t('当前环境暂不支持系统通知，将继续使用应用内顶部弹窗。', 'System notifications unavailable here; in-app top banner will be used.'));
    } else {
      onError(t('系统通知权限被拒绝，请在浏览器或手机系统设置中允许通知。', 'Notification permission denied in browser/system settings.'));
    }
  }

  function openSettings(sectionId?: string): void {
    openSubView('settings', sectionId);
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

  async function handleAvatarFileChange(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setAvatarUploading(true);
    try {
      const dataUrl = await compressAvatarImage(file);
      setAvatar(dataUrl);
      onNotice(t('已选取头像照片，点击「保存名片装扮」生效。', 'Avatar photo selected. Save profile to apply.'));
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : t('头像处理失败', 'Failed to process avatar photo'));
    } finally {
      setAvatarUploading(false);
    }
  }

  async function saveMyProfile(): Promise<void> {
    try {
      const nextNickname = nickname.trim() || cloudUser?.nickname || '旅行者';
      const nextMotto = motto.trim() || DEFAULT_MOTTO_ZH;
      await onSaveProfile({
        id: 'profile',
        nickname: nextNickname,
        avatar,
        motto: nextMotto,
      });
      if (cloudUser && getCloudToken()) {
        try {
          const res = await cloudApi.updateProfile({
            avatar,
            motto: nextMotto,
          });
          setCloudAuthState(getCloudToken(), res.user);
          onCloudUserUpdated?.(res.user);
        } catch {
          /* 云端资料同步失败不影响本机保存 */
        }
      }
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
      const result = await exportBackup();
      const time = new Date().toISOString();
      try { localStorage.setItem('travel-last-backup', time); } catch { /* 当前页面仍可显示导出时间。 */ }
      setLastBackup(time);
      if (result.skippedPlannerPhotos > 0) {
        onNotice(t(
          `完整备份文件已生成（有 ${result.skippedPlannerPhotos} 张行程参考图本地缺失已跳过，不影响足迹、手账与原图恢复）。`,
          `Backup archive downloaded (${result.skippedPlannerPhotos} missing reference photos skipped; core trips, journals and media are intact).`,
        ));
      } else {
        onNotice(t('完整备份文件已生成。', 'Full backup archive downloaded.'));
      }
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

  const [mapApp, setMapApp] = useState<MapAppProvider>(() => readMapAppProvider());

  if (subView === 'achievements') {
    return (
      <div className="profile-subview-shell">
        <div className="content-page profile-subview-topbar">
          <button
            type="button"
            className="secondary settings-back-btn"
            onClick={() => openSubView('home')}
          >
            <span aria-hidden="true">←</span> {t('返回个人中心', 'Back to Profile')}
          </button>
        </div>
        <Suspense fallback={<div className="empty-state">{t('正在打开旅途成就…', 'Opening Achievements…')}</div>}>
          <AchievementsView
            marks={effectiveMarks}
            entries={snapshot.entries}
            trips={snapshot.trips}
            media={snapshot.media}
            badges={snapshot.badges}
            intimacyBonds={intimacyBonds}
            onSaveBadge={onSaveBadge}
            onOpenEntry={onOpenEntry}
            onError={onError}
            onNotice={onNotice}
            webTourMode={webTourMode}
            onRequireClient={onRequireClient}
          />
        </Suspense>
      </div>
    );
  }

  if (subView === 'account' && onOpenAuth && onSyncNow && onCloudUserUpdated) {
    return (
      <div className="content-page warm-profile profile-settings-view">
        <div className="section-heading settings-view-header">
          <div>
            <button
              type="button"
              className="secondary settings-back-btn"
              onClick={() => openSubView('home')}
            >
              <span aria-hidden="true">←</span> {t('返回个人中心', 'Back to Profile')}
            </button>
            <h1>{t('账号与云同步', 'Account & Cloud Sync')}</h1>
            <p>{t('管理云端账号、多端同步、好友码、地图可见度、密码密保与已登录设备。', 'Manage your cloud account, sync, friend code, map privacy, security, and devices.')}</p>
          </div>
        </div>
        <CloudSyncCard
          cloudUser={cloudUser}
          syncing={syncingCloud}
          onOpenAuth={onOpenAuth}
          onSyncNow={onSyncNow}
          onUserUpdated={onCloudUserUpdated}
          onNotice={onNotice}
          onError={onError}
        />
      </div>
    );
  }

  if (subView === 'notifications') {
    const sysPermLabel = sysNotifPerm === 'granted'
      ? t('系统权限已允许', 'Allowed')
      : sysNotifPerm === 'denied'
        ? t('已被系统禁用', 'Blocked')
        : sysNotifPerm === 'unsupported'
          ? t('当前环境不支持', 'Unsupported')
          : t('未授权', 'Not requested');

    return (
      <div className="content-page warm-profile profile-settings-view">
        <div className="section-heading settings-view-header">
          <div>
            <button
              type="button"
              className="secondary settings-back-btn"
              onClick={() => openSubView('home')}
            >
              <span aria-hidden="true">←</span> {t('返回个人中心', 'Back to Profile')}
            </button>
            <h1>{t('消息弹窗通知', 'Message Notifications')}</h1>
            <p>{t('自定义好友申请、亲密关系邀请、攻略分享与行程群动态的弹窗与提示音。', 'Customize popup banners, sounds, and categories for friend requests, shares, and group updates.')}</p>
          </div>
        </div>

        <section className="card notif-settings-card">
          <div className="notif-toggle-row is-master">
            <div>
              <strong>{t('接收新消息弹窗通知', 'Enable Message Popups')}</strong>
              <small>{t('关闭后不再弹出任何顶部横幅或系统通知，仍可在「同行旅伴 → 消息」查看。', 'When off, popups are muted; messages remain in Companions → Messages.')}</small>
            </div>
            <label className="ios-switch">
              <input
                type="checkbox"
                checked={notifPrefs.enabled}
                onChange={(e) => updateNotifPrefs((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="ios-switch-track" />
            </label>
          </div>
        </section>

        {notifPrefs.enabled && (
          <>
            <section className="card notif-settings-card">
              <div className="notif-group-title">{t('提醒方式', 'Alert Style')}</div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('应用内顶部悬浮弹窗', 'In-App Top Banner')}</strong>
                  <small>{t('使用周游地图时，在屏幕顶部滑出微信式消息横幅，点击直达详情。', 'Slide a banner at the top of the screen while using the app.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.inAppBanner}
                    onChange={(e) => updateNotifPrefs((prev) => ({ ...prev, inAppBanner: e.target.checked }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('轻柔提示音', 'Notification Sound')}</strong>
                  <small>{t('收到新消息弹窗时播放清脆柔和的双音提示。', 'Play a gentle chime when a new message arrives.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.sound}
                    onChange={(e) => updateNotifPrefs((prev) => ({ ...prev, sound: e.target.checked }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
              <div className="notif-toggle-row">
                <div>
                  <strong>
                    {t('系统级弹窗通知', 'System Popup Notifications')}
                    <em className="notif-perm-tag">{sysPermLabel}</em>
                  </strong>
                  <small>{t('应用运行期间通过系统通知栏弹出提醒；关闭页面或杀进程后无法后台触发，重要抢票建议同步导出日历提醒。', 'Show OS-level notifications while the app is running. Export to system calendar for closed-app reminders.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.systemPopup}
                    onChange={(e) => void handleToggleSystemPopup(e.target.checked)}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
            </section>

            <section className="card notif-settings-card">
              <div className="notif-group-title">{t('通知内容分类', 'Notification Types')}</div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('好友申请与亲密关系邀请', 'Friend & Intimacy Requests')}</strong>
                  <small>{t('新旅伴加你为好友或发起情侣/家人/挚友绑定时提醒。', 'Notify on friend requests and intimacy bond invites.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.types.friendRequests}
                    onChange={(e) => updateNotifPrefs((prev) => ({
                      ...prev,
                      types: { ...prev.types, friendRequests: e.target.checked },
                    }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('好友攻略分享与同游共编', 'Shared Plans & Collab Invites')}</strong>
                  <small>{t('好友给你发送行程攻略或邀请共同编辑时提醒。', 'Notify when a friend sends an itinerary or invites you to co-edit.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.types.planShares}
                    onChange={(e) => updateNotifPrefs((prev) => ({
                      ...prev,
                      types: { ...prev.types, planShares: e.target.checked },
                    }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('行程群动态与 AA 记账', 'Travel Groups & AA Expenses')}</strong>
                  <small>{t('行程群成员变动、共享攻略更新或新增 AA 账单时提醒。', 'Notify on group changes, plan edits, and shared AA expenses.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.types.groupUpdates}
                    onChange={(e) => updateNotifPrefs((prev) => ({
                      ...prev,
                      types: { ...prev.types, groupUpdates: e.target.checked },
                    }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
              <div className="notif-toggle-row">
                <div>
                  <strong>{t('抢票提醒与行前清单', 'Ticket Alerts & Pre-Trip Reminders')}</strong>
                  <small>{t('在抢票计划开启的提前开售提醒，以及群里/好友发来的行前清单与出行提醒。', 'Alerts for scheduled ticket releases, packing lists, and travel reminders.')}</small>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    checked={notifPrefs.types.ticketReminders}
                    onChange={(e) => updateNotifPrefs((prev) => ({
                      ...prev,
                      types: { ...prev.types, ticketReminders: e.target.checked },
                    }))}
                  />
                  <span className="ios-switch-track" />
                </label>
              </div>
            </section>

            {onTestNotification && (
              <div className="notif-test-bar">
                <button type="button" className="primary" onClick={onTestNotification}>
                  🔔 {t('预览顶部消息弹窗效果', 'Preview Notification Popup')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (subView === 'settings') {
    const quickNavItems = [
      { id: 'settings-ai-usage', label: t('AI 额度与用量', 'AI Quota & Usage') },
      { id: 'settings-language', label: t('语言', 'Language') },
      { id: 'settings-map-app', label: t('导航地图', 'Map App') },
      { id: 'travel-data-backup', label: t('数据导出与导入', 'Backup & Export') },
      { id: 'settings-offline-maps', label: t('离线地图', 'Offline Maps') },
      { id: 'app-update-card', label: t('应用更新', 'Updates') },
    ];

    return (
      <div className="content-page warm-profile profile-settings-view">
        <div className="section-heading settings-view-header">
          <div>
            <button
              type="button"
              className="secondary settings-back-btn"
              onClick={() => openSubView('home')}
            >
              <span aria-hidden="true">←</span> {t('返回个人中心', 'Back to Profile')}
            </button>
            <h1>{t('偏好与设置', 'Preferences & Settings')}</h1>
            <p>{t('切换界面语言、导出导入备份、管理离线地图与检查应用更新。', 'Switch language, export or import backups, manage offline maps, and check updates.')}</p>
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
      </div>
    );
  }

  const isSvip = Boolean(vipQuota?.svip);
  const isVip = Boolean(vipQuota?.vip);
  const vipMult = vipQuota?.vipMultiplier ?? 3;
  const vipUnlimited = Boolean(vipQuota?.vipUnlimited);
  const vipTooltip = isSvip
    ? t('尊享 SVIP · 永久免费无限额度特权', 'SVIP · Lifetime Unlimited Free AI Quota')
    : vipUnlimited
      ? t('尊享 VIP · 免费 AI 无限额特权', 'VIP · Unlimited Free AI Quota')
      : t(`尊享 VIP · 免费 AI ${vipMult} 倍额度特权`, `VIP · ${vipMult}x Free AI Quota`);

  return (
    <div className="content-page warm-profile">
      <div className="section-heading">
        <div>
          <h1>{t('个人中心', 'Personal Center')}</h1>
          <p>{t('装扮旅人名片、查看旅途成就与徽章，并管理页面风格、账号同步与偏好设置。', 'Customize your traveler card, explore achievements, switch themes, and manage account & settings.')}</p>
        </div>
      </div>

      {/* 旅人护照横幅 + 内联装扮面板（统一展示，不再堆叠多余的云同步大卡片） */}
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
              avatarId={editing ? avatar : resolvedAvatar}
              nickname={editing ? nickname : displaySavedNickname}
              className="warm-profile-avatar"
            />
            <span className="avatar-edit-dot" aria-hidden="true">📷</span>
          </button>

          <div className="profile-banner-info">
            <div className="profile-name-row">
              <h2>{editing ? (nickname.trim() || defaultNickname) : displaySavedNickname}</h2>
              {isSvip ? (
                <span className="profile-vip-badge profile-svip-badge" title={vipTooltip}>
                  SVIP
                </span>
              ) : isVip ? (
                <span className="profile-vip-badge" title={vipTooltip}>
                  VIP
                </span>
              ) : null}
              <span className="profile-level-tag">Lv.{levelInfo.level} {levelInfo.title}</span>
              {cloudUser ? (
                <button
                  type="button"
                  className="profile-local-tag profile-code-tag"
                  title={t('点击复制好友码', 'Tap to copy friend code')}
                  onClick={() => navigator.clipboard?.writeText(cloudUser.friendCode).then(() => onNotice(`已复制好友码：${cloudUser.friendCode}`)).catch(() => undefined)}
                >
                  ☁️ {cloudUser.friendCode}
                </button>
              ) : (
                <span className="profile-local-tag">{t('本机单机版', 'Local Only')}</span>
              )}
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
            {editing ? t('收起 ▴', 'Close ▴') : t('编辑名片', 'Edit')}
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
              <span className="avatar-picker-label">{t('更换头像', 'Change Avatar')}</span>
              <div className="avatar-photo-actions">
                <button
                  type="button"
                  className="secondary avatar-photo-btn"
                  disabled={avatarUploading}
                  onClick={() => avatarUploadRef.current?.click()}
                >
                  🖼️ {avatarUploading ? t('处理中…', 'Processing…') : t('上传照片', 'Upload Photo')}
                </button>
                <button
                  type="button"
                  className="secondary avatar-photo-btn"
                  disabled={avatarUploading}
                  onClick={() => avatarCameraRef.current?.click()}
                >
                  📷 {t('拍照', 'Take Photo')}
                </button>
                {isCustomAvatarUrl(avatar) && (
                  <button
                    type="button"
                    className="text-button avatar-photo-clear"
                    onClick={() => setAvatar('bear')}
                  >
                    {t('恢复默认', 'Reset')}
                  </button>
                )}
                <input
                  ref={avatarUploadRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => void handleAvatarFileChange(event.currentTarget)}
                />
                <input
                  ref={avatarCameraRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  hidden
                  onChange={(event) => void handleAvatarFileChange(event.currentTarget)}
                />
              </div>

              <button
                type="button"
                className="avatar-presets-toggle"
                aria-expanded={presetsOpen}
                onClick={() => setPresetsOpen((v) => !v)}
              >
                <span>🎨 {t('或挑选可爱预设头像', 'Or choose a preset avatar')}</span>
                <small>{presetsOpen ? t('收起 ▴', 'Hide ▴') : t(`展开 ${AVATAR_PRESETS.length} 款 ▾`, `${AVATAR_PRESETS.length} presets ▾`)}</small>
              </button>

              {presetsOpen && (
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
              )}
            </div>

            <div className="profile-dressup-actions">
              <button type="button" className="primary" disabled={backupAction !== null || avatarUploading} onClick={() => void saveMyProfile()}>
                {t('保存名片装扮', 'Save Profile')}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setNickname(resolvedNickname);
                  setAvatar(resolvedAvatar);
                  setMotto(savedProfile?.motto ?? cloudUser?.motto ?? DEFAULT_MOTTO_ZH);
                  setEditing(false);
                }}
              >
                {t('取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 旅途成就入口卡片：从底部导航收进个人中心，点击打开完整成就与徽章墙 */}
      <section className="card profile-achievements-entry-card" aria-label={t('旅途成就与徽章', 'Travel Achievements & Badges')}>
        <button type="button" className="profile-achievements-entry-btn" onClick={() => openSubView('achievements')}>
          <span className="profile-ach-icon" aria-hidden="true">
            <TravelIcon name="achievements" />
          </span>
          <span className="profile-ach-body">
            <span className="profile-ach-title-row">
              <strong>{t('旅途成就与徽章', 'Travel Achievements & Badges')}</strong>
              <span className="profile-ach-pill">Lv.{levelInfo.level} · {levelInfo.title}</span>
            </span>
            <small>
              {levelInfo.nextTarget
                ? t(
                  `已点亮 ${visitedCityCount} 座城市 · 再去 ${levelInfo.remainingCities} 城升级「${levelInfo.nextTitle}」 · 已收藏 ${snapshot.badges.length} 枚定制徽章`,
                  `${visitedCityCount} cities · ${levelInfo.remainingCities} more to ${levelInfo.nextTitle} · ${snapshot.badges.length} custom badges`,
                )
                : t(`已满级！已点亮 ${visitedCityCount} 座城市 · 已收藏 ${snapshot.badges.length} 枚定制徽章`, `Max Level! ${visitedCityCount} cities · ${snapshot.badges.length} custom badges`)}
            </small>
            <span className="profile-ach-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(8, levelInfo.progressPct)}%` }} />
            </span>
          </span>
          <span className="settings-entry-chevron" aria-hidden="true">›</span>
        </button>
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
          <p className="muted profile-privacy-note">{t('照片、视频与语音始终安全保存在本机；登录周游账号后可额外同步文字攻略与城市足迹。', 'Photos, videos, and audio stay safely on your device; sign in to sync itineraries and footprints across devices.')}</p>
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

      {/* 账号云同步 & 偏好与设置：简洁收口在个人中心底部 */}
      <section className="card profile-settings-entry-card profile-settings-compact-card" aria-label={t('账号与设置', 'Account & Settings')}>
        {onOpenAuth && onSyncNow && onCloudUserUpdated && (
          <button
            type="button"
            className="settings-entry-row settings-entry-divider"
            onClick={() => (cloudUser ? openSubView('account') : onOpenAuth('login'))}
          >
            <span className="settings-entry-icon is-cloud" aria-hidden="true">☁️</span>
            <span className="settings-entry-copy">
              <strong>{t('账号与云同步', 'Account & Cloud Sync')}</strong>
              <small>
                {cloudUser
                  ? t(`已登录 ${cloudUser.nickname} · 管理隐私、密保与多端设备`, `Signed in as ${cloudUser.nickname} · Privacy, security & devices`)
                  : t('登录或注册开启电脑-手机攻略同步与同行旅伴', 'Sign in to sync plans across devices and unlock Companions')}
              </small>
            </span>
            <span className={`settings-entry-value ${cloudUser ? 'is-safe' : ''}`}>
              {cloudUser ? (syncingCloud ? t('同步中…', 'Syncing…') : t('已开启', 'Active')) : t('去登录', 'Sign In')}
            </span>
            <span className="settings-entry-chevron" aria-hidden="true">›</span>
          </button>
        )}
        <button
          type="button"
          className="settings-entry-row settings-entry-divider"
          onClick={() => openSubView('notifications')}
        >
          <span className="settings-entry-icon is-notif" aria-hidden="true">🔔</span>
          <span className="settings-entry-copy">
            <strong>{t('消息弹窗通知', 'Message Notifications')}</strong>
            <small>{t('顶部悬浮消息横幅、提示音、系统弹窗与消息分类开关', 'Top banner popups, sound, system alerts & categories')}</small>
          </span>
          <span className={`settings-entry-value ${notifPrefs.enabled ? 'is-safe' : ''}`}>
            {notifPrefs.enabled ? t('已开启', 'On') : t('已关闭', 'Off')}
          </span>
          <span className="settings-entry-chevron" aria-hidden="true">›</span>
        </button>
        {onStartOnboarding && (
          <button
            type="button"
            className="settings-entry-row settings-entry-divider"
            onClick={onStartOnboarding}
          >
            <span className="settings-entry-icon is-guide" aria-hidden="true">🧭</span>
            <span className="settings-entry-copy">
              <strong>{t('新手指引与玩法教程', 'Interactive Guide & Walkthrough')}</strong>
              <small>{t('一步步高亮演示地图点亮、AI 规划、同行旅伴与手账怎么点', 'Step-by-step spotlight walkthrough of maps, AI planner, companions & journal')}</small>
            </span>
            <span className="settings-entry-value">{t('立即重看', 'Replay')}</span>
            <span className="settings-entry-chevron" aria-hidden="true">›</span>
          </button>
        )}
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
