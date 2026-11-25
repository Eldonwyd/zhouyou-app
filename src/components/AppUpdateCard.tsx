import { useCallback, useEffect, useState } from 'react';
import {
  DOWNLOAD_PORTAL_URL,
  cancelAppUpdateDownload,
  checkForAppUpdate,
  detectAppPlatform,
  formatBytes,
  getCurrentAppVersion,
  installAppUpdate,
  platformDisplayName,
  reopenDownloadedAndroidApk,
  type AppPlatform,
  type AppUpdateInfo,
  type AppUpdateProgress,
} from '../app-updater';
import { useI18n } from '../i18n';

interface AppUpdateCardProps {
  initialUpdate?: AppUpdateInfo | null;
  autoCheckToken?: number;
  onUpdateFound?: (info: AppUpdateInfo | null) => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
}

function platformLabel(platform: AppPlatform, isEn: boolean): string {
  if (!isEn) return platformDisplayName(platform);
  switch (platform) {
    case 'android': return 'Android App';
    case 'ios': return 'iOS App';
    case 'desktop-win': return 'Windows Desktop';
    case 'desktop-mac': return 'macOS Desktop';
    case 'desktop-linux': return 'Linux Desktop';
    default: return 'Web / PWA';
  }
}

export default function AppUpdateCard({
  initialUpdate = null,
  autoCheckToken = 0,
  onUpdateFound,
  onNotice,
  onError,
}: AppUpdateCardProps) {
  const { isEn, t } = useI18n();
  const platform = detectAppPlatform();
  const [currentVersion, setCurrentVersion] = useState(
    initialUpdate?.currentVersion || (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'),
  );
  const [info, setInfo] = useState<AppUpdateInfo | null>(initialUpdate);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    void getCurrentAppVersion().then(setCurrentVersion);
  }, []);

  useEffect(() => {
    if (initialUpdate) {
      setInfo(initialUpdate);
      setCurrentVersion(initialUpdate.currentVersion);
    }
  }, [initialUpdate]);

  const handleCheck = useCallback(async (silentUpToDate = false) => {
    setChecking(true);
    setErrorText('');
    setStatusNote('');
    try {
      const result = await checkForAppUpdate();
      setInfo(result);
      setCurrentVersion(result.currentVersion);
      onUpdateFound?.(result.hasUpdate ? result : null);
      if (result.hasUpdate) {
        setStatusNote('');
      } else {
        setStatusNote(t(`当前已是最新版本（v${result.currentVersion}）。`, `You are up to date (v${result.currentVersion}).`));
        if (!silentUpToDate) onNotice?.(t(`当前已是最新版本 v${result.currentVersion}`, `Up to date: v${result.currentVersion}`));
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isNetErr = /fetch failed|failed to fetch|load failed|network|timeout|abort/i.test(raw);
      const msg = isNetErr || !raw
        ? t('暂时无法连接更新服务器，请检查网络或点击下方「浏览器下载」获取最新版。', 'Unable to reach the update server. Check your network or use "Download in Browser" below.')
        : raw;
      setErrorText(msg);
      if (!silentUpToDate) onError?.(msg);
    } finally {
      setChecking(false);
    }
  }, [onError, onNotice, onUpdateFound, t]);

  useEffect(() => {
    if (autoCheckToken > 0) {
      void handleCheck(false);
    }
  }, [autoCheckToken, handleCheck]);

  async function handleInstall() {
    if (!info) return;
    setErrorText('');
    setStatusNote('');
    const displaySize = info.updateMode === 'hot' ? (info.hotUpdate?.size || 0) : info.assetSize;
    if (info.canInAppInstall && info.updateMode !== 'web') {
      setProgress({ state: 'downloading', percent: 0, receivedBytes: 0, totalBytes: displaySize });
    }
    const result = await installAppUpdate(info, (next) => {
      setProgress(next);
    });
    if (result.cancelled) {
      setProgress(null);
      setStatusNote(t('已取消下载更新。', 'Update download cancelled.'));
      return;
    }
    if (!result.ok) {
      const raw = result.error || '';
      const isNetErr = /fetch failed|failed to fetch|load failed|network|timeout|abort/i.test(raw);
      const msg = isNetErr || !raw
        ? t('下载更新失败，请点击下方「浏览器下载」直接获取最新版安装包。', 'Update download failed. Click "Download in Browser" below to get the latest installer.')
        : raw;
      setProgress(null);
      setErrorText(msg);
      onError?.(msg);
      return;
    }
    if (result.mode === 'hot') {
      setProgress({ state: 'installing', percent: 100, receivedBytes: displaySize, totalBytes: displaySize });
      const hotHint = t(
        `已完成极速热更新至 v${info.latestVersion}，正在刷新界面（本地数据与手账已保留）…`,
        `Hot-updated to v${info.latestVersion}. Reloading interface…`,
      );
      setStatusNote(hotHint);
      onNotice?.(hotHint);
      return;
    }
    if (result.fallbackOpened) {
      setProgress(null);
      const hint = info.platform === 'ios'
        ? t('已打开最新版 IPA 下载页，请通过 AltStore / Sideloadly 安装。', 'Opened latest IPA download page. Install via AltStore / Sideloadly.')
        : t('已开始通过系统浏览器下载最新版安装包。', 'Started downloading the latest installer in your browser.');
      setStatusNote(hint);
      onNotice?.(hint);
      return;
    }
    setProgress({ state: 'installing', percent: 100, receivedBytes: displaySize, totalBytes: displaySize });
    const doneHint = info.platform.startsWith('desktop-')
      ? t('新版安装程序已校验并启动，请按提示完成覆盖安装（数据与手账会自动保留）。', 'Verified installer launched. Follow prompts to update (your local data is preserved).')
      : t('新版 APK 已下载完成，请在系统安装界面确认升级（数据与手账会自动保留）。', 'APK downloaded. Confirm the update in the system installer (your local data is preserved).');
    setStatusNote(doneHint);
    onNotice?.(doneHint);
  }

  async function handleCancel() {
    await cancelAppUpdateDownload();
    setProgress(null);
    setStatusNote(t('已取消下载。', 'Download cancelled.'));
  }

  async function handleReopenApk() {
    const ok = await reopenDownloadedAndroidApk();
    if (!ok) {
      onError?.(t('安装包已清理，请重新点击「立即更新」下载。', 'Installer file was cleared. Tap "Update Now" to download again.'));
    }
  }

  const downloading = progress?.state === 'downloading';
  const installing = progress?.state === 'installing';
  const hasUpdate = Boolean(info?.hasUpdate);
  const publishedDate = info?.publishedAt ? info.publishedAt.slice(0, 10) : '';
  const isHotMode = info?.updateMode === 'hot';
  const isDesktopFullInApp = info?.updateMode === 'full-in-app';
  const effectiveSize = isHotMode ? (info?.hotUpdate?.size || 0) : (info?.assetSize || 0);
  const modeLabel = isHotMode
    ? t('极速热更新 · 免重装', 'Instant Hot Update')
    : isDesktopFullInApp
      ? t('包含底层升级 · 应用内整包更新', 'Core Upgrade · In-App Installer')
      : info?.requiresFullUpgrade
        ? t('包含底层升级 · 需下载完整安装包', 'Core Upgrade · Full Package Required')
        : '';

  return (
    <section id="app-update-card" className="card app-update-card" tabIndex={-1} aria-labelledby="app-update-card-title">
      <div className="card-heading app-update-head">
        <div>
          <h2 id="app-update-card-title">{t('检查应用更新', 'Check for Updates')}</h2>
          <p className="muted">{t('日常更新支持应用内几秒无感热更新，遇底层大改动时自动切换完整安装包升级，保留全部本地旅行数据。', 'Routine updates apply in seconds via in-app hot update; core upgrades switch to full installer while preserving all local travel data.')}</p>
        </div>
        <span className="app-update-ver-pill">
          {platformLabel(platform, isEn)} · v{currentVersion}
        </span>
      </div>

      {hasUpdate && info && (
        <div className="app-update-banner-box" role="status">
          <div className="app-update-banner-top">
            <strong>{t(`发现新版本 v${info.latestVersion}`, `New version available: v${info.latestVersion}`)}</strong>
            <span className="app-update-meta">
              {[modeLabel, publishedDate, formatBytes(effectiveSize)].filter(Boolean).join(' · ')}
            </span>
          </div>
          {info.releaseNotes && (
            <div className="app-update-notes">
              {info.releaseNotes.split('\n').map((line, idx) => (
                <p
                  key={idx}
                  className={line.startsWith('• ') ? 'app-update-note-bullet' : 'app-update-note-line'}
                >
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {downloading && progress && (
        <div className="app-update-progress" role="status" aria-live="polite">
          <div className="app-update-progress-head">
            <span>
              {isHotMode
                ? t('正在下载极速热更新包…', 'Downloading hot update bundle…')
                : t('正在应用内下载最新版安装包…', 'Downloading latest installer…')}
            </span>
            <strong>
              {progress.percent > 0 ? `${progress.percent}%` : t('连接中…', 'Connecting…')}
              {progress.totalBytes > 0
                ? ` · ${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
                : progress.receivedBytes > 0
                  ? ` · ${formatBytes(progress.receivedBytes)}`
                  : ''}
            </strong>
          </div>
          <div className="app-update-progress-track">
            <span style={{ width: `${Math.max(4, progress.percent)}%` }} />
          </div>
        </div>
      )}

      {statusNote && !downloading && (
        <p role="status" className="app-update-status-note">{statusNote}</p>
      )}
      {errorText && (
        <p role="alert" className="planner-error app-update-error">{errorText}</p>
      )}

      <div className="heading-actions app-update-actions">
        {hasUpdate && !downloading ? (
          <button type="button" className="primary" disabled={checking} onClick={() => void handleInstall()}>
            {installing
              ? t('重新下载更新', 'Download Again')
              : isHotMode
                ? t(`极速热更新到 v${info.latestVersion}`, `Hot Update to v${info.latestVersion}`)
                : info?.canInAppInstall
                  ? t(`应用内更新到 v${info.latestVersion}`, `Update to v${info.latestVersion}`)
                  : t(`下载新版本 v${info?.latestVersion ?? ''}`, `Download v${info?.latestVersion ?? ''}`)}
          </button>
        ) : null}

        {downloading ? (
          <button type="button" className="secondary" onClick={() => void handleCancel()}>
            {t('取消下载', 'Cancel Download')}
          </button>
        ) : (
          <button
            type="button"
            className={hasUpdate ? 'secondary' : 'primary'}
            disabled={checking}
            onClick={() => void handleCheck(false)}
          >
            {checking ? t('检查中…', 'Checking…') : hasUpdate ? t('重新检查', 'Check Again') : t('检查更新', 'Check for Updates')}
          </button>
        )}

        {installing && info?.platform === 'android' && info.canInAppInstall && (
          <button type="button" className="secondary" onClick={() => void handleReopenApk()}>
            {t('重新打开安装器', 'Reopen Installer')}
          </button>
        )}

        {(hasUpdate || errorText) && (
          <a
            className="text-button"
            href={info?.downloadUrl || info?.releaseUrl || DOWNLOAD_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('浏览器下载', 'Download in Browser')}
          </a>
        )}
      </div>
    </section>
  );
}
