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
  type AppUpdateInfo,
  type AppUpdateProgress,
} from '../app-updater';

interface AppUpdateCardProps {
  initialUpdate?: AppUpdateInfo | null;
  autoCheckToken?: number;
  onUpdateFound?: (info: AppUpdateInfo | null) => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
}

export default function AppUpdateCard({
  initialUpdate = null,
  autoCheckToken = 0,
  onUpdateFound,
  onNotice,
  onError,
}: AppUpdateCardProps) {
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
        setStatusNote(`当前已是最新版本（v${result.currentVersion}）。`);
        if (!silentUpToDate) onNotice?.(`当前已是最新版本 v${result.currentVersion}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '检查更新失败，请稍后重试';
      setErrorText(msg);
      if (!silentUpToDate) onError?.(msg);
    } finally {
      setChecking(false);
    }
  }, [onError, onNotice, onUpdateFound]);

  useEffect(() => {
    if (autoCheckToken > 0) {
      void handleCheck(false);
    }
  }, [autoCheckToken, handleCheck]);

  async function handleInstall() {
    if (!info) return;
    setErrorText('');
    setStatusNote('');
    if (info.canInAppInstall) {
      setProgress({ state: 'downloading', percent: 0, receivedBytes: 0, totalBytes: info.assetSize });
    }
    const result = await installAppUpdate(info, (next) => {
      setProgress(next);
    });
    if (result.cancelled) {
      setProgress(null);
      setStatusNote('已取消下载更新。');
      return;
    }
    if (!result.ok) {
      const msg = result.error || '下载更新失败，可改用浏览器直接下载安装包';
      setProgress(null);
      setErrorText(msg);
      onError?.(msg);
      return;
    }
    if (result.fallbackOpened) {
      setProgress(null);
      const hint = info.platform === 'ios'
        ? '已打开最新版 IPA 下载页，请通过 AltStore / Sideloadly 安装。'
        : '已开始通过系统浏览器下载最新版安装包。';
      setStatusNote(hint);
      onNotice?.(hint);
      return;
    }
    setProgress({ state: 'installing', percent: 100, receivedBytes: info.assetSize, totalBytes: info.assetSize });
    const doneHint = info.platform.startsWith('desktop-')
      ? '新版安装程序已启动，请按提示完成覆盖安装（数据与手账会自动保留）。'
      : '新版 APK 已下载完成，请在系统安装界面确认升级（数据与手账会自动保留）。';
    setStatusNote(doneHint);
    onNotice?.(doneHint);
  }

  async function handleCancel() {
    await cancelAppUpdateDownload();
    setProgress(null);
    setStatusNote('已取消下载。');
  }

  async function handleReopenApk() {
    const ok = await reopenDownloadedAndroidApk();
    if (!ok) {
      onError?.('安装包已清理，请重新点击「立即更新」下载。');
    }
  }

  const downloading = progress?.state === 'downloading';
  const installing = progress?.state === 'installing';
  const hasUpdate = Boolean(info?.hasUpdate);
  const publishedDate = info?.publishedAt ? info.publishedAt.slice(0, 10) : '';

  return (
    <section id="app-update-card" className="card app-update-card" tabIndex={-1} aria-labelledby="app-update-card-title">
      <div className="card-heading app-update-head">
        <div>
          <h2 id="app-update-card-title">检查应用更新</h2>
          <p className="muted">手机端与电脑端均可一键检查并更新到最新版本，升级保留全部本地旅行数据。</p>
        </div>
        <span className="app-update-ver-pill">
          {platformDisplayName(platform)} · v{currentVersion}
        </span>
      </div>

      {hasUpdate && info && (
        <div className="app-update-banner-box" role="status">
          <div className="app-update-banner-top">
            <strong>发现新版本 v{info.latestVersion}</strong>
            <span className="app-update-meta">
              {[publishedDate, formatBytes(info.assetSize)].filter(Boolean).join(' · ')}
            </span>
          </div>
          {info.releaseNotes && (
            <p className="app-update-notes">{info.releaseNotes}</p>
          )}
        </div>
      )}

      {downloading && progress && (
        <div className="app-update-progress" role="status" aria-live="polite">
          <div className="app-update-progress-head">
            <span>正在下载最新版安装包…</span>
            <strong>
              {progress.percent > 0 ? `${progress.percent}%` : '连接中…'}
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
              ? '重新下载更新'
              : info?.canInAppInstall
                ? `立即更新到 v${info.latestVersion}`
                : `下载新版本 v${info?.latestVersion}`}
          </button>
        ) : null}

        {downloading ? (
          <button type="button" className="secondary" onClick={() => void handleCancel()}>
            取消下载
          </button>
        ) : (
          <button
            type="button"
            className={hasUpdate ? 'secondary' : 'primary'}
            disabled={checking}
            onClick={() => void handleCheck(false)}
          >
            {checking ? '检查中…' : hasUpdate ? '重新检查' : '检查更新'}
          </button>
        )}

        {installing && info?.platform === 'android' && info.canInAppInstall && (
          <button type="button" className="secondary" onClick={() => void handleReopenApk()}>
            重新打开安装器
          </button>
        )}

        {(hasUpdate || errorText) && (
          <a
            className="text-button"
            href={info?.downloadUrl || info?.releaseUrl || DOWNLOAD_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            浏览器下载
          </a>
        )}
      </div>
    </section>
  );
}
