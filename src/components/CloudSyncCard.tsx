import { useEffect, useState } from 'react';
import {
  SECURITY_QUESTIONS,
  clearCloudAuthState,
  cloudApi,
  getCloudToken,
  setCloudAuthState,
  type CloudQuota,
  type CloudSelfUser,
  type CloudSessionInfo,
  type MapVisibility,
} from '../cloud-api';
import { getLastSyncError, getLastSyncTime, getPendingCloudChangeCount } from '../cloud-sync';
import { TravelAvatar } from './CuteArt';

interface CloudSyncCardProps {
  cloudUser: CloudSelfUser | null;
  syncing: boolean;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onSyncNow: () => Promise<void>;
  onUserUpdated: (user: CloudSelfUser | null) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const VISIBILITY_OPTIONS: Array<{ value: MapVisibility; label: string; hint: string }> = [
  { value: 'friends', label: '所有好友可见', hint: '你的好友都可以查看并对比你的中国点亮地图' },
  { value: 'intimate', label: '仅亲密关系可见', hint: '仅已绑定的情侣/家人/挚友/闺蜜可查看你的地图' },
  { value: 'private', label: '仅自己可见', hint: '完全隐藏，不对任何好友展示你的点亮地图' },
];

function formatKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export default function CloudSyncCard({
  cloudUser,
  syncing,
  onOpenAuth,
  onSyncNow,
  onUserUpdated,
  onNotice,
  onError,
}: CloudSyncCardProps) {
  const [quota, setQuota] = useState<CloudQuota | null>(null);
  const [sessions, setSessions] = useState<CloudSessionInfo[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [nickname, setNickname] = useState(cloudUser?.nickname || '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(cloudUser?.email || '');
  const [mapVisibility, setMapVisibility] = useState<MapVisibility>(cloudUser?.mapVisibility || 'friends');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newQuestion, setNewQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [newAnswer, setNewAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const lastSync = getLastSyncTime();
  const pendingCount = getPendingCloudChangeCount();
  const lastSyncError = getLastSyncError();

  useEffect(() => {
    if (!cloudUser) return;
    setNickname(cloudUser.nickname);
    setEmail(cloudUser.email || '');
    setMapVisibility(cloudUser.mapVisibility || 'friends');
  }, [cloudUser]);

  useEffect(() => {
    if (!cloudUser || !getCloudToken()) return;
    let active = true;
    cloudApi.me()
      .then((res) => {
        if (!active) return;
        setQuota(res.quota);
        setSessions(res.sessions);
        setCloudAuthState(getCloudToken(), res.user);
        onUserUpdated(res.user);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [cloudUser?.id]);

  if (!cloudUser) {
    return (
      <section className="cloud-account-card guest">
        <div className="cloud-account-head">
          <div>
            <span className="city-dialog-pill">☁️ 电脑做攻略 · 手机直接用</span>
            <h3>登录或注册周游账号</h3>
            <p>开启三端自动云同步（AI 攻略、地图点亮、纯文字手账与花费），并解锁「同行旅伴」加好友、行程群协作与 AA 记账。照片视频继续留在本地走 ZIP 备份。</p>
          </div>
          <div className="cloud-account-actions">
            <button type="button" className="primary" onClick={() => onOpenAuth('login')}>密码登录</button>
            <button type="button" className="secondary" onClick={() => onOpenAuth('register')}>注册新账号</button>
          </div>
        </div>
      </section>
    );
  }

  const usedPct = quota ? Math.min(100, Math.round((quota.usedBytes / Math.max(1, quota.maxBytes)) * 100)) : 0;

  async function saveAccountSettings() {
    setSaving(true);
    try {
      const patch: Parameters<typeof cloudApi.updateProfile>[0] = {
        nickname: nickname.trim(),
        mapVisibility,
      };
      if (phone.trim()) patch.phone = phone.trim();
      if (email.trim() && email.trim() !== cloudUser?.email) patch.email = email.trim();
      const res = await cloudApi.updateProfile(patch);
      setCloudAuthState(getCloudToken(), res.user);
      onUserUpdated(res.user);
      setPhone('');
      onNotice('云端账号设置已保存');
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveSecurityChange() {
    if (!currentPassword) {
      onError('请先输入当前登录密码');
      return;
    }
    setSaving(true);
    try {
      await cloudApi.changePassword({
        currentPassword,
        newPassword: newPassword || undefined,
        securityQuestion: newAnswer.trim() ? newQuestion : undefined,
        securityAnswer: newAnswer.trim() || undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setNewAnswer('');
      onNotice('密码 / 密保问题已更新');
    } catch (err) {
      onError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await cloudApi.logout();
    } catch { /* ignore */ }
    clearCloudAuthState();
    onUserUpdated(null);
    onNotice('已退出云端账号，本机数据仍安全保留');
  }

  async function handleRevokeSession(sessionId: string) {
    try {
      await cloudApi.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      onNotice('已下线该设备');
    } catch (err) {
      onError(err instanceof Error ? err.message : '下线设备失败');
    }
  }

  return (
    <section className="cloud-account-card logged-in">
      <div className="cloud-account-head">
        <div className="cloud-account-identity">
          <TravelAvatar avatarId={cloudUser.avatar} nickname={cloudUser.nickname} className="avatar large" />
          <div>
            <div className="cloud-name-row">
              <strong>{cloudUser.nickname}</strong>
              <span className="cloud-friend-code" title="点击复制好友码" onClick={() => {
                navigator.clipboard?.writeText(cloudUser.friendCode).then(() => onNotice(`已复制好友码：${cloudUser.friendCode}`)).catch(() => undefined);
              }}>
                好友码：{cloudUser.friendCode}
              </span>
            </div>
            <small className="cloud-sync-meta">
              {cloudUser.hasPhone ? `手机：${cloudUser.phone}` : ''}{cloudUser.hasPhone && cloudUser.hasEmail ? ' · ' : ''}{cloudUser.hasEmail ? `邮箱：${cloudUser.email}` : ''}
              {lastSync ? ` · 上次同步：${new Date(lastSync).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · 尚未同步'}
              {pendingCount > 0 ? ` · ⚠️ ${pendingCount} 项待上传` : ''}
            </small>
            {lastSyncError && (
              <small className="cloud-sync-meta" style={{ color: '#c44536', display: 'block', marginTop: 4 }}>
                ⚠️ 上次同步异常：{lastSyncError}
              </small>
            )}
          </div>
        </div>
        <div className="cloud-account-actions">
          <button type="button" className="primary" disabled={syncing} onClick={() => void onSyncNow()}>
            {syncing ? '同步中…' : '☁️ 立即同步'}
          </button>
          <button type="button" className="secondary" onClick={() => setManageOpen((v) => !v)}>
            {manageOpen ? '收起账号管理' : '账号与隐私'}
          </button>
        </div>
      </div>

      <div className="cloud-quota-row">
        <span>云端纯文本空间（攻略 + 足迹 + 文字手账，不含照片视频）：{quota ? `${formatKb(quota.usedBytes)} / ${formatKb(quota.maxBytes)}` : '计算中…'}</span>
        <div className="cloud-quota-bar"><div style={{ width: `${usedPct}%` }} /></div>
      </div>

      {manageOpen && (
        <div className="cloud-manage-panel">
          <div className="cloud-manage-section">
            <h4>昵称、账号绑定与地图点亮隐私</h4>
            <div className="auth-row-2">
              <label className="auth-field">
                <span>唯一昵称（好友搜索用）</span>
                <input value={nickname} maxLength={18} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <label className="auth-field">
                <span>地图点亮可见度</span>
                <select value={mapVisibility} onChange={(e) => setMapVisibility(e.target.value as MapVisibility)}>
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <small className="auth-hint">{VISIBILITY_OPTIONS.find((o) => o.value === mapVisibility)?.hint}</small>
            <div className="auth-row-2">
              <label className="auth-field">
                <span>{cloudUser.hasPhone ? `更换手机号（当前 ${cloudUser.phone}）` : '补绑手机号'}</span>
                <input type="tel" placeholder="留空表示不修改" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="auth-field">
                <span>{cloudUser.hasEmail ? '更换邮箱' : '补绑邮箱'}</span>
                <input type="email" placeholder="留空表示不修改" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
            <button type="button" className="primary" disabled={saving} onClick={() => void saveAccountSettings()}>保存账号与隐私设置</button>
          </div>

          <div className="cloud-manage-section">
            <h4>修改密码 / 更换密保问题</h4>
            <small className="auth-hint">当前密保问题：{cloudUser.securityQuestion || '未设置'}</small>
            <div className="auth-row-2">
              <label className="auth-field">
                <span>当前密码（必填）</span>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
              <label className="auth-field">
                <span>新密码（不改请留空）</span>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
            </div>
            <div className="auth-row-2">
              <label className="auth-field">
                <span>更换密保问题（可选）</span>
                <select value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)}>
                  {SECURITY_QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </label>
              <label className="auth-field">
                <span>新密保答案（填写即更新）</span>
                <input type="text" placeholder="留空表示保持原密保" value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)} />
              </label>
            </div>
            <button type="button" className="secondary" disabled={saving} onClick={() => void saveSecurityChange()}>更新安全设置</button>
          </div>

          {sessions.length > 0 && (
            <div className="cloud-manage-section">
              <h4>已登录设备（{sessions.length}）</h4>
              <div className="cloud-sessions-list">
                {sessions.map((s) => (
                  <div key={s.id} className="cloud-session-row">
                    <span>
                      <strong>{s.deviceName}</strong> {s.current && <em className="session-current-tag">当前设备</em>}
                      <small> · 最近活跃 {new Date(s.lastSeenAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                    </span>
                    {!s.current && (
                      <button type="button" className="text-button" onClick={() => void handleRevokeSession(s.id)}>下线</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cloud-manage-footer">
            <button type="button" className="text-button danger-text" onClick={() => void handleLogout()}>退出当前云端账号</button>
          </div>
        </div>
      )}
    </section>
  );
}
