import { useEffect, useState, type FormEvent } from 'react';
import {
  SECURITY_QUESTIONS,
  cloudApi,
  setCloudAuthState,
  type CloudSelfUser,
} from '../cloud-api';
import { AVATAR_PRESETS, TravelAvatar } from './CuteArt';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'login' | 'register' | 'reset';
  canDismiss?: boolean;
  defaultNickname?: string;
  defaultAvatar?: string;
  onSuccess: (user: CloudSelfUser, isNewRegister: boolean) => void;
  onDismiss: () => void;
}

export default function AuthModal({
  open,
  initialMode = 'login',
  canDismiss = true,
  defaultNickname = '',
  defaultAvatar = 'bear',
  onSuccess,
  onDismiss,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [accountType, setAccountType] = useState<'phone' | 'email'>('phone');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState(defaultNickname && defaultNickname !== '旅行者' ? defaultNickname : '');
  const [avatar, setAvatar] = useState(defaultAvatar || 'bear');
  const [nickCheck, setNickCheck] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false });
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');

  // 找回密码状态
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetQuestion, setResetQuestion] = useState('');
  const [resetNickname, setResetNickname] = useState('');
  const [resetAnswer, setResetAnswer] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError('');
      setInfo('');
      setResetStep(1);
    }
  }, [open, initialMode]);

  // 注册时防抖检测昵称是否唯一
  useEffect(() => {
    if (!open || mode !== 'register') return;
    const trimmed = nickname.trim();
    if (Array.from(trimmed).length < 2) {
      setNickCheck({ checking: false });
      return;
    }
    let active = true;
    setNickCheck({ checking: true });
    const timer = window.setTimeout(() => {
      cloudApi.checkNickname(trimmed)
        .then((res) => {
          if (active) setNickCheck({ checking: false, available: res.available, reason: res.reason });
        })
        .catch(() => {
          if (active) setNickCheck({ checking: false });
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [nickname, mode, open]);

  if (!open) return null;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!identifier.trim() || !password) {
      setError('请输入手机号或邮箱以及密码');
      return;
    }
    setSubmitting(true);
    try {
      const res = await cloudApi.login(identifier.trim(), password);
      setCloudAuthState(res.token, res.user);
      onSuccess(res.user, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (accountType === 'phone' && !phone.trim()) {
      setError('请输入 11 位手机号');
      return;
    }
    if (accountType === 'email' && !email.trim()) {
      setError('请输入邮箱地址');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (Array.from(nickname.trim()).length < 2) {
      setError('请设置 2-18 位唯一昵称');
      return;
    }
    const finalQuestion = securityQuestion === '__custom__' ? customQuestion.trim() : securityQuestion;
    if (!finalQuestion) {
      setError('请选择或填写 1 个密保问题');
      return;
    }
    if (!securityAnswer.trim()) {
      setError('请填写密保问题答案，用于忘记密码时找回');
      return;
    }

    setSubmitting(true);
    try {
      const res = await cloudApi.register({
        phone: accountType === 'phone' ? phone.trim() : undefined,
        email: accountType === 'email' ? email.trim() : undefined,
        password,
        nickname: nickname.trim(),
        securityQuestion: finalQuestion,
        securityAnswer: securityAnswer.trim(),
        avatar,
      });
      setCloudAuthState(res.token, res.user);
      onSuccess(res.user, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLookupQuestion(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!resetIdentifier.trim()) {
      setError('请输入注册时使用的手机号或邮箱');
      return;
    }
    setSubmitting(true);
    try {
      const res = await cloudApi.getSecurityQuestion(resetIdentifier.trim());
      setResetQuestion(res.question);
      setResetNickname(res.nickname);
      setResetStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询密保问题失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!resetAnswer.trim() || resetNewPassword.length < 6) {
      setError('请输入密保答案及至少 6 位的新密码');
      return;
    }
    setSubmitting(true);
    try {
      await cloudApi.resetPassword(resetIdentifier.trim(), resetAnswer.trim(), resetNewPassword);
      setInfo('密码重置成功，请使用新密码登录');
      setIdentifier(resetIdentifier.trim());
      setPassword('');
      setResetStep(1);
      setResetAnswer('');
      setResetNewPassword('');
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop auth-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (canDismiss && e.target === e.currentTarget) onDismiss(); }}>
      <div className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <div className="auth-dialog-head">
          <div>
            <span className="city-dialog-pill">☁️ 周游云同步 · 三端互通</span>
            <h2 id="auth-dialog-title">
              {mode === 'login' ? '登录周游账号' : mode === 'register' ? '注册周游账号' : '通过密保问题找回密码'}
            </h2>
          </div>
          {canDismiss && (
            <button type="button" className="text-button auth-close-btn" onClick={onDismiss} aria-label="关闭">×</button>
          )}
        </div>

        <p className="auth-sync-note">
          登录后自动同步 <strong>AI 攻略、地图点亮、纯文字手账与花费</strong>，并解锁「同行旅伴」加好友、行程群协作与 AA 记账；照片与视频保留在本地（可用 ZIP 导出迁移）。
        </p>

        <div className="auth-mode-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>
            密码登录
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>
            注册新账号
          </button>
          <button type="button" role="tab" aria-selected={mode === 'reset'} className={mode === 'reset' ? 'active' : ''} onClick={() => { setMode('reset'); setError(''); setResetStep(1); }}>
            忘记密码
          </button>
        </div>

        {error && <div className="auth-alert auth-alert-error" role="alert">{error}</div>}
        {info && <div className="auth-alert auth-alert-ok" role="status">{info}</div>}

        {mode === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-field">
              <span>手机号或邮箱</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="请输入 11 位手机号或邮箱"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              <span>登录密码</span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
              {submitting ? '正在登录并准备同步…' : '立即登录并开启云同步'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-subtabs">
              <button type="button" className={accountType === 'phone' ? 'active' : ''} onClick={() => setAccountType('phone')}>手机号注册</button>
              <button type="button" className={accountType === 'email' ? 'active' : ''} onClick={() => setAccountType('email')}>邮箱注册</button>
            </div>

            {accountType === 'phone' ? (
              <label className="auth-field">
                <span>手机号</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="请输入 11 位中国大陆手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </label>
            ) : (
              <label className="auth-field">
                <span>邮箱地址（无需验证码）</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="例如 name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            )}

            <label className="auth-field">
              <span>设置全站唯一昵称（之后可随时修改，好友可通过昵称搜到你）</span>
              <input
                type="text"
                maxLength={18}
                placeholder="2-18 个字符，如：爱旅行的小鹿"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
              {nickCheck.checking && <small className="auth-hint">正在检查昵称是否可用…</small>}
              {!nickCheck.checking && nickCheck.available === true && <small className="auth-hint ok">✓ 该昵称可以使用</small>}
              {!nickCheck.checking && nickCheck.available === false && <small className="auth-hint err">✕ {nickCheck.reason || '该昵称已被占用'}</small>}
            </label>

            <div className="auth-avatar-picker">
              <span>选择头像</span>
              <div className="auth-avatar-row">
                {AVATAR_PRESETS.slice(0, 6).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`auth-avatar-chip ${avatar === preset.id ? 'active' : ''}`}
                    onClick={() => setAvatar(preset.id)}
                    title={preset.label}
                  >
                    <TravelAvatar avatarId={preset.id} nickname={nickname || '旅'} className="avatar" />
                  </button>
                ))}
              </div>
            </div>

            <div className="auth-row-2">
              <label className="auth-field">
                <span>设置密码（至少 6 位）</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 6 位字符"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <label className="auth-field">
                <span>确认密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </label>
            </div>

            <label className="auth-field">
              <span>密保问题（忘记密码时用于安全找回）</span>
              <select value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)}>
                {SECURITY_QUESTIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
                <option value="__custom__">自定义密保问题…</option>
              </select>
            </label>

            {securityQuestion === '__custom__' && (
              <label className="auth-field">
                <span>输入自定义问题</span>
                <input
                  type="text"
                  maxLength={60}
                  placeholder="例如：我最喜欢的电影是什么？"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  required
                />
              </label>
            )}

            <label className="auth-field">
              <span>密保答案（服务端加密保存，请牢记）</span>
              <input
                type="text"
                maxLength={60}
                placeholder="请输入密保问题的答案"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                required
              />
            </label>

            <button type="submit" className="primary auth-submit-btn" disabled={submitting || nickCheck.available === false}>
              {submitting ? '正在创建账号…' : '注册并自动合并本地数据'}
            </button>
          </form>
        )}

        {mode === 'reset' && resetStep === 1 && (
          <form className="auth-form" onSubmit={handleLookupQuestion}>
            <label className="auth-field">
              <span>输入注册时的手机号或邮箱</span>
              <input
                type="text"
                placeholder="手机号或邮箱"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
              {submitting ? '正在查询密保问题…' : '下一步：获取密保问题'}
            </button>
          </form>
        )}

        {mode === 'reset' && resetStep === 2 && (
          <form className="auth-form" onSubmit={handleResetPassword}>
            <div className="auth-question-banner">
              <small>账号：{resetNickname}</small>
              <strong>密保问题：{resetQuestion}</strong>
            </div>
            <label className="auth-field">
              <span>密保答案</span>
              <input
                type="text"
                placeholder="请输入注册时设置的答案"
                value={resetAnswer}
                onChange={(e) => setResetAnswer(e.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              <span>设置新密码（至少 6 位）</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="输入新密码"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                required
              />
            </label>
            <div className="auth-row-2">
              <button type="button" className="secondary" onClick={() => setResetStep(1)}>上一步</button>
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? '正在验证并重置…' : '确认重置密码'}
              </button>
            </div>
          </form>
        )}

        {canDismiss && (
          <div className="auth-footer-dismiss">
            <button type="button" className="text-button" onClick={onDismiss}>
              暂不登录，先本地使用（不同步云端）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
