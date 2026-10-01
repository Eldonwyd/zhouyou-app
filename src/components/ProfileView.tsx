import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, LocalProfile } from '../types';
import { exportBackup, importBackup } from '../backup';

interface ProfileViewProps {
  snapshot: AppSnapshot;
  onSaveProfile: (profile: LocalProfile) => Promise<void>;
  onImported: (snapshot: AppSnapshot) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function readableBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export default function ProfileView({ snapshot, onSaveProfile, onImported, onError, onNotice }: ProfileViewProps) {
  const [nickname, setNickname] = useState(snapshot.profile[0]?.nickname ?? '旅行者');
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNickname(snapshot.profile[0]?.nickname ?? '旅行者'), [snapshot.profile]);
  useEffect(() => {
    navigator.storage?.estimate().then((estimate) => setStorageEstimate({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })).catch(() => undefined);
  }, [snapshot.media.length]);

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

  return <div className="content-page"><div className="section-heading"><div><span className="eyebrow">LOCAL PROFILE</span><h1>个人中心</h1><p>管理这台设备上的旅行资料与备份。</p></div></div>
    <div className="profile-grid"><section className="card"><h2>本地资料</h2><label className="stacked">称呼<input value={nickname} maxLength={24} onChange={(event) => setNickname(event.target.value)} /></label><button className="primary" onClick={() => void onSaveProfile({ id: 'profile', nickname: nickname.trim() || '旅行者' }).then(() => onNotice('本地资料已保存。')).catch((error: unknown) => onError(error instanceof Error ? error.message : '保存失败'))}>保存称呼</button><p className="muted">当前是单机版，没有账号登录或与其他用户关联。</p></section>
      <section className="card"><h2>本地存储</h2>{storageEstimate ? <><div className="summary-number"><span>已使用</span><strong>{readableBytes(storageEstimate.usage)}</strong></div><div className="summary-number"><span>浏览器估算配额</span><strong>{readableBytes(storageEstimate.quota)}</strong></div></> : <p className="muted">此浏览器未提供存储用量估算。</p>}<p className="muted">照片和视频保存在浏览器本地数据库。清除网站数据会删除这些内容，请定期导出备份。</p></section>
      <section className="card backup-card"><h2>备份与恢复</h2><p>备份包含城市标记、多城市旅行、地点、评语、计划、照片、视频、语音及徽章图片；也可导入旧版本 ZIP。</p><div className="heading-actions"><button className="primary" disabled={busy} onClick={() => { setBusy(true); void exportBackup(snapshot).then(() => onNotice('备份文件已生成。')).catch((error: unknown) => onError(error instanceof Error ? error.message : '导出失败')).finally(() => setBusy(false)); }}>导出完整备份</button><button className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>导入备份</button><input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void handleImport(event.target.files?.[0])} /></div><small>大体积视频备份可能需要较长时间和额外磁盘空间。</small></section>
    </div>
  </div>;
}
