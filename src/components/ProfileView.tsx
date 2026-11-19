import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, LocalProfile } from '../types';
import { exportBackup, importBackup } from '../backup';
import { TravelIcon } from './TravelArt';
import { AVATAR_PRESETS, CuteSticker, TravelAvatar, getTravelerLevel } from './CuteArt';
import AppearanceSettings from './AppearanceSettings';

interface ProfileViewProps {
  snapshot: AppSnapshot;
  onSaveProfile: (profile: LocalProfile) => Promise<void>;
  onImported: (snapshot: AppSnapshot) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const DEFAULT_MOTTO = '把喜欢的风和日落，悄悄夹进旅行小册子 ✨';

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export default function ProfileView({ snapshot, onSaveProfile, onImported, onError, onNotice }: ProfileViewProps) {
  const savedProfile = snapshot.profile[0];
  const [nickname, setNickname] = useState(savedProfile?.nickname ?? '旅行者');
  const [avatar, setAvatar] = useState(savedProfile?.avatar ?? 'bear');
  const [motto, setMotto] = useState(savedProfile?.motto ?? DEFAULT_MOTTO);
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem('travel-last-backup') ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNickname(savedProfile?.nickname ?? '旅行者');
    setAvatar(savedProfile?.avatar ?? 'bear');
    setMotto(savedProfile?.motto ?? DEFAULT_MOTTO);
  }, [savedProfile]);

  useEffect(() => {
    navigator.storage?.estimate()
      .then((estimate) => setStorageEstimate({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }))
      .catch(() => undefined);
  }, [snapshot.media.length]);

  const visitedCityCount = snapshot.marks.filter((m) => m.visited).length;
  const photoCount = snapshot.media.filter((item) => item.kind === 'photo').length;
  const videoCount = snapshot.media.filter((item) => item.kind === 'video').length;
  const audioCount = snapshot.media.filter((item) => item.kind === 'audio').length;
  const levelInfo = getTravelerLevel(visitedCityCount, snapshot.entries.length);

  const backupHealthy = Boolean(lastBackup && (Date.now() - Date.parse(lastBackup)) < 30 * 86_400_000);
  const storagePct = storageEstimate?.quota ? Math.min(100, Math.max(3, (storageEstimate.usage / storageEstimate.quota) * 100)) : 0;

  async function saveMyProfile(): Promise<void> {
    try {
      await onSaveProfile({
        id: 'profile',
        nickname: nickname.trim() || '旅行者',
        avatar,
        motto: motto.trim() || DEFAULT_MOTTO,
      });
      setEditing(false);
      onNotice('旅人名片已更新。');
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function handleImport(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!window.confirm('导入会替换此浏览器内现有的全部旅行数据。建议先导出当前备份。是否继续？')) return;
    setBusy(true);
    try {
      const imported = await importBackup(file);
      onImported(imported);
      onNotice('备份已导入，旅行记录和媒体已恢复。');
    } catch (error) { onError(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  return (
    <div className="content-page warm-profile">
      <div className="section-heading">
        <div>
          <h1>个人中心</h1>
          <p>装扮你的旅人小护照，换一套喜欢的主题风格，收好所有回忆。</p>
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
            title="点击更换头像与资料"
          >
            <TravelAvatar
              avatarId={editing ? avatar : savedProfile?.avatar}
              nickname={editing ? nickname : (savedProfile?.nickname ?? '旅行者')}
              className="warm-profile-avatar"
            />
            <span className="avatar-edit-dot" aria-hidden="true">✎</span>
          </button>

          <div className="profile-banner-info">
            <div className="profile-name-row">
              <h2>{editing ? (nickname.trim() || '旅行者') : (savedProfile?.nickname ?? '旅行者')}</h2>
              <span className="profile-level-tag">Lv.{levelInfo.level} {levelInfo.title}</span>
              <span className="profile-local-tag">本机单机版</span>
            </div>
            <p className="profile-motto">{editing ? (motto.trim() || DEFAULT_MOTTO) : (savedProfile?.motto ?? DEFAULT_MOTTO)}</p>
            <div className="profile-quick-chips">
              <span>📍 {visitedCityCount} 座城市</span>
              <span>🧳 {snapshot.trips.length} 段旅行</span>
              <span>📷 {photoCount} 张照片</span>
            </div>
          </div>

          <button type="button" className="secondary profile-edit-toggle" onClick={() => setEditing(!editing)}>
            {editing ? '收起装扮' : '装扮名片 ✦'}
          </button>
        </div>

        {editing && (
          <div className="profile-dressup-drawer">
            <div className="profile-dressup-fields">
              <label className="stacked">
                我的称呼
                <input value={nickname} maxLength={24} onChange={(event) => setNickname(event.target.value)} placeholder="给自己起个好听的昵称" />
              </label>
              <label className="stacked">
                旅行小签名
                <input value={motto} maxLength={48} onChange={(event) => setMotto(event.target.value)} placeholder="例如：收集世界的日落与晚风 ✨" />
              </label>
            </div>

            <div className="avatar-picker-block">
              <span className="avatar-picker-label">挑选一个可爱旅人头像</span>
              <div className="avatar-picker-grid" role="radiogroup" aria-label="旅人头像">
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={avatar === preset.id}
                    className={`avatar-choice ${avatar === preset.id ? 'selected' : ''}`}
                    onClick={() => setAvatar(preset.id)}
                  >
                    <TravelAvatar avatarId={preset.id} nickname={nickname || '旅'} className="avatar-choice-preview" />
                    <small>{preset.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="profile-dressup-actions">
              <button type="button" className="primary" onClick={() => void saveMyProfile()}>保存名片装扮</button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setNickname(savedProfile?.nickname ?? '旅行者');
                  setAvatar(savedProfile?.avatar ?? 'bear');
                  setMotto(savedProfile?.motto ?? DEFAULT_MOTTO);
                  setEditing(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 外观风格工坊置顶展示，成为个人中心核心亮点 */}
      <AppearanceSettings />

      {/* 均衡双栏 Bento：左侧回忆收藏 + 存储行李箱，右侧备份小金库 */}
      <div className="profile-grid">
        <section className="card warm-profile-info">
          <div className="card-heading">
            <h2>我的回忆小收藏</h2>
            <span>全量保存在本机</span>
          </div>
          <div className="profile-bento-stats">
            <div className="bento-stat-tile tile-sage">
              <small>已去城市</small>
              <strong>{visitedCityCount}</strong>
            </div>
            <div className="bento-stat-tile tile-peach">
              <small>记录旅程</small>
              <strong>{snapshot.trips.length}</strong>
            </div>
            <div className="bento-stat-tile tile-blue">
              <small>打卡地点</small>
              <strong>{snapshot.places.length}</strong>
            </div>
            <div className="bento-stat-tile tile-honey">
              <small>珍藏照片</small>
              <strong>{photoCount}</strong>
            </div>
            <div className="bento-stat-tile tile-lilac">
              <small>视频 & 语音</small>
              <strong>{videoCount + audioCount}</strong>
            </div>
            <div className="bento-stat-tile tile-mint">
              <small>专属徽章</small>
              <strong>{snapshot.badges.length}</strong>
            </div>
          </div>
          <p className="muted profile-privacy-note">单机隐私模式：不上传云端、无账号绑定，你的照片、语音和手账只属于这台设备。</p>
        </section>

        <section className="card warm-storage">
          <div className="card-heading">
            <h2>本机存储空间</h2>
            <span>{storageEstimate ? `${storagePct.toFixed(1)}%` : '估算中'}</span>
          </div>
          {storageEstimate ? (
            <>
              <div className="storage-pill-row">
                <div>
                  <small>小册子已占用</small>
                  <strong>{readableBytes(storageEstimate.usage)}</strong>
                </div>
                <div className="storage-pill-right">
                  <small>浏览器估算上限</small>
                  <strong>{readableBytes(storageEstimate.quota)}</strong>
                </div>
              </div>
              <div className="warm-storage-track">
                <span style={{ width: `${storagePct}%` }} />
              </div>
            </>
          ) : (
            <p className="muted">此浏览器暂未提供存储用量估算。</p>
          )}
          <p className="muted">照片与视频保存在当前浏览器本地，清理浏览器缓存前请记得先导出右侧备份。</p>
        </section>

        <section className="card backup-card">
          <div className="backup-card-top">
            <div className="warm-backup-art">
              <CuteSticker kind="suitcase" className="backup-suitcase-svg" />
              <div className="backup-fallback-icon">
                <TravelIcon name="backup" />
              </div>
            </div>
            <span className={`backup-health-pill ${backupHealthy ? 'is-safe' : 'is-remind'}`}>
              {backupHealthy ? '已安心备份 ✓' : '建议留份备份'}
            </span>
          </div>

          <h2>回忆备份小金库</h2>
          <p>换电脑或清理浏览器前，打包一份完整 ZIP，把城市、照片、语音与行程全部带走。</p>

          <div className="heading-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void exportBackup(snapshot)
                  .then(() => {
                    const time = new Date().toISOString();
                    localStorage.setItem('travel-last-backup', time);
                    setLastBackup(time);
                    onNotice('完整备份文件已生成。');
                  })
                  .catch((error: unknown) => onError(error instanceof Error ? error.message : '导出失败'))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? '正在打包备份…' : '导出完整备份'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>导入备份</button>
            <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void handleImport(event.target.files?.[0])} />
          </div>

          <small className="backup-time-note">
            {lastBackup ? `上次导出：${new Date(lastBackup).toLocaleString('zh-CN')}` : '还没有导出记录，抽空给回忆留个双保险吧。'}
          </small>

          <ul className="warm-backup-list" aria-label="备份范围">
            <li><span>足迹与行程</span><strong>{visitedCityCount} 城 · {snapshot.trips.length} 段</strong></li>
            <li><span>地点与照片</span><strong>{snapshot.places.length} 处 · {photoCount} 张</strong></li>
            <li><span>账本与徽章</span><strong>{snapshot.plans.length} 份 · {snapshot.badges.length} 枚</strong></li>
          </ul>

          <details className="warm-backup-details">
            <summary>备份包里包含哪些内容？</summary>
            <p>城市点亮状态、多城市旅行、地点文字与语音回忆、AI 行程计划与账本、照片视频、专属徽章及个人名片装扮；兼容旧版本 ZIP 导入。</p>
            <small>包含较多大体积视频时，打包可能需要十几秒，请耐心等待下载完成。</small>
          </details>
        </section>
      </div>
    </div>
  );
}
