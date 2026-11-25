import { useEffect, useState, type FormEvent } from 'react';
import {
  SECURITY_QUESTIONS,
  cloudApi,
  getCloudToken,
  setCloudAuthState,
  type CloudSelfUser,
} from '../cloud-api';
import { TravelIcon } from './TravelArt';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'login' | 'register' | 'reset';
  canDismiss?: boolean;
  defaultNickname?: string;
  defaultAvatar?: string;
  onSuccess: (user: CloudSelfUser, isNewRegister: boolean) => void;
  onDismiss: () => void;
}

type AuthScreen = 'login' | 'register' | 'pick-nickname' | 'reset';

export default function AuthModal({
  open,
  initialMode = 'login',
  canDismiss = true,
  defaultNickname = '',
  defaultAvatar = 'bear',
  onSuccess,
  onDismiss,
}: AuthModalProps) {
  const [screen, setScreen] = useState<AuthScreen>(initialMode);
  const [accountType, setAccountType] = useState<'phone' | 'email'>('phone');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');

  // 注册成功后的第二步：设置全站唯一昵称（头像默认保留，后续可在个人中心更换）
  const [registeredUser, setRegisteredUser] = useState<CloudSelfUser | null>(null);
  const [nickname, setNickname] = useState(defaultNickname && defaultNickname !== '旅行者' ? defaultNickname : '');
  const [nickCheck, setNickCheck] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false });

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
      setScreen(initialMode);
      setError('');
      setInfo('');
      setResetStep(1);
      setRegisteredUser(null);
    }
  }, [open, initialMode]);

  // 昵称设置步防抖查重
  useEffect(() => {
    if (!open || screen !== 'pick-nickname') return;
    const trimmed = nickname.trim();
    if (Array.from(trimmed).length < 2) {
      setNickCheck({ checking: false });
      return;
    }
    let active = true;
    setNickCheck({ checking: true });
    const timer = window.setTimeout(() => {
      cloudApi.checkNickname(trimmed, registeredUser?.id)
        .then((res) => {
          if (active) setNickCheck({ checking: false, available: res.available, reason: res.reason });
        })
        .catch(() => {
          if (active) setNickCheck({ checking: false });
        });
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [nickname, screen, open, registeredUser?.id]);

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
      setError('密码长度至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    const finalQuestion = securityQuestion === '__custom__' ? customQuestion.trim() : securityQuestion;
    if (!finalQuestion) {
      setError('请选择或填写 1 个密保问题');
      return;
    }
    if (!securityAnswer.trim()) {
      setError('请填写密保问题答案');
      return;
    }

    setSubmitting(true);
    try {
      const res = await cloudApi.register({
        phone: accountType === 'phone' ? phone.trim() : undefined,
        email: accountType === 'email' ? email.trim() : undefined,
        password,
        nickname: '',
        securityQuestion: finalQuestion,
        securityAnswer: securityAnswer.trim(),
        avatar: defaultAvatar || 'bear',
      });
      setCloudAuthState(res.token, res.user);
      setRegisteredUser(res.user);
      setNickname(defaultNickname && defaultNickname !== '旅行者' ? defaultNickname : '');
      setScreen('pick-nickname');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteNickname(e: FormEvent) {
    e.preventDefault();
    if (!registeredUser) return;
    setError('');
    const trimmed = nickname.trim();
    if (Array.from(trimmed).length < 2) {
      setError('请输入 2–18 个字符的独特昵称');
      return;
    }
    setSubmitting(true);
    try {
      const res = await cloudApi.updateProfile({ nickname: trimmed });
      setCloudAuthState(getCloudToken(), res.user);
      onSuccess(res.user, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '昵称保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLookupQuestion(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!resetIdentifier.trim()) {
      setError('请输入注册时的手机号或邮箱');
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
      setError('请填写密保答案及至少 6 位新密码');
      return;
    }
    setSubmitting(true);
    try {
      await cloudApi.resetPassword(resetIdentifier.trim(), resetAnswer.trim(), resetNewPassword);
      setInfo('密码已重置，请使用新密码登录');
      setIdentifier(resetIdentifier.trim());
      setPassword('');
      setResetStep(1);
      setResetAnswer('');
      setResetNewPassword('');
      setScreen('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setSubmitting(false);
    }
  }

  const handleClose = () => {
    if (screen === 'pick-nickname' && registeredUser) {
      onSuccess(registeredUser, true);
      return;
    }
    onDismiss();
  };

  return (
    <div
      className="dialog-backdrop auth-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (canDismiss && e.target === e.currentTarget) handleClose(); }}
    >
      <div className="dialog auth-dialog auth-modern" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        {/* 顶部品牌区 */}
        <div className="auth-modern-top">
          <div className="auth-brand-row">
            <span className="auth-brand-mark" aria-hidden="true"><TravelIcon name="map" /></span>
            <span className="auth-brand-name">周游地图</span>
          </div>
          {canDismiss && (
            <button type="button" className="auth-icon-close" onClick={handleClose} aria-label="关闭">×</button>
          )}
        </div>

        {/* 主标题与一句话副标题 */}
        <div className="auth-modern-heading">
          <h2 id="auth-dialog-title">
            {screen === 'login' && '登录你的周游账号'}
            {screen === 'register' && '创建周游账号'}
            {screen === 'pick-nickname' && '给自己取个旅人昵称'}
            {screen === 'reset' && '找回密码'}
          </h2>
          <p className="auth-modern-sub">
            {screen === 'login' && '电脑做攻略，手机自动同步；照片与视频保留在本地'}
            {screen === 'register' && '开启跨端云同步，与好友共建同行攻略'}
            {screen === 'pick-nickname' && '注册成功！好友可通过唯一昵称或好友码找到你，之后可随时修改'}
            {screen === 'reset' && '回答注册时设置的密保问题即可重设密码'}
          </p>
        </div>

        {/* 登录 / 注册 极简下划线切换（找回密码与昵称步不显示） */}
        {(screen === 'login' || screen === 'register') && (
          <div className="auth-underline-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={screen === 'login'}
              className={screen === 'login' ? 'active' : ''}
              onClick={() => { setScreen('login'); setError(''); setInfo(''); }}
            >
              密码登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={screen === 'register'}
              className={screen === 'register' ? 'active' : ''}
              onClick={() => { setScreen('register'); setError(''); setInfo(''); }}
            >
              注册账号
            </button>
          </div>
        )}

        {error && <div className="auth-alert auth-alert-error" role="alert">{error}</div>}
        {info && <div className="auth-alert auth-alert-ok" role="status">{info}</div>}

        {/* ===== 1. 登录视图 ===== */}
        {screen === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-field">
              <span>手机号或邮箱</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="请输入手机号或邮箱"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </label>

            <div className="auth-field">
              <div className="auth-label-row">
                <label htmlFor="auth-login-pwd">密码</label>
                <button
                  type="button"
                  className="auth-inline-link"
                  onClick={() => {
                    setResetIdentifier(identifier);
                    setResetStep(1);
                    setError('');
                    setInfo('');
                    setScreen('reset');
                  }}
                >
                  忘记密码？
                </button>
              </div>
              <input
                id="auth-login-pwd"
                type="password"
                autoComplete="current-password"
                placeholder="请输入登录密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
              {submitting ? '正在登录…' : '登录'}
            </button>
          </form>
        )}

        {/* ===== 2. 极简注册视图（无头像、无昵称，中性切换手机/邮箱） ===== */}
        {screen === 'register' && (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="auth-account-switch" role="tablist" aria-label="注册方式">
              <button
                type="button"
                role="tab"
                aria-selected={accountType === 'phone'}
                className={accountType === 'phone' ? 'active' : ''}
                onClick={() => setAccountType('phone')}
              >
                手机号注册
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={accountType === 'email'}
                className={accountType === 'email' ? 'active' : ''}
                onClick={() => setAccountType('email')}
              >
                邮箱注册
              </button>
            </div>

            {accountType === 'phone' ? (
              <label className="auth-field">
                <span>手机号</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="请输入 11 位手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </label>
            ) : (
              <label className="auth-field">
                <span>邮箱</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            )}

            <div className="auth-row-2">
              <label className="auth-field">
                <span>密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 6 位"
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

            <div className="auth-security-group">
              <label className="auth-field">
                <span>密保问题（忘记密码时使用）</span>
                <select value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)}>
                  {SECURITY_QUESTIONS.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                  <option value="__custom__">自定义问题…</option>
                </select>
              </label>
              {securityQuestion === '__custom__' && (
                <input
                  type="text"
                  maxLength={60}
                  placeholder="输入自定义密保问题"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  required
                />
              )}
              <input
                type="text"
                maxLength={60}
                placeholder="输入密保答案"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
              {submitting ? '正在创建账号…' : '注册并继续'}
            </button>
          </form>
        )}

        {/* ===== 3. 注册成功第二步：设置唯一昵称 ===== */}
        {screen === 'pick-nickname' && registeredUser && (
          <form className="auth-form" onSubmit={handleCompleteNickname}>
            <div className="auth-friendcode-strip">
              <span>你的专属好友码</span>
              <strong>{registeredUser.friendCode}</strong>
            </div>

            <label className="auth-field">
              <span>设置全站唯一昵称</span>
              <input
                type="text"
                maxLength={18}
                autoFocus
                placeholder="2–18 个字符，例如：山海小鹿"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
              {nickCheck.checking && <small className="auth-hint">检查中…</small>}
              {!nickCheck.checking && nickCheck.available === true && <small className="auth-hint ok">✓ 昵称可用</small>}
              {!nickCheck.checking && nickCheck.available === false && <small className="auth-hint err">✕ {nickCheck.reason || '该昵称已被占用'}</small>}
            </label>

            <button type="submit" className="primary auth-submit-btn" disabled={submitting || nickCheck.available === false}>
              {submitting ? '保存中…' : '完成设置并进入周游地图'}
            </button>
            <button
              type="button"
              className="auth-skip-link"
              onClick={() => onSuccess(registeredUser, true)}
            >
              先使用默认昵称（{registeredUser.nickname}），稍后再改
            </button>
          </form>
        )}

        {/* ===== 4. 忘记密码视图 ===== */}
        {screen === 'reset' && (
          <>
            {resetStep === 1 ? (
              <form className="auth-form" onSubmit={handleLookupQuestion}>
                <label className="auth-field">
                  <span>手机号或邮箱</span>
                  <input
                    type="text"
                    placeholder="输入注册时的手机号或邮箱"
                    value={resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
                  {submitting ? '查询中…' : '下一步'}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleResetPassword}>
                <div className="auth-question-banner">
                  <small>账号：{resetNickname}</small>
                  <strong>{resetQuestion}</strong>
                </div>
                <label className="auth-field">
                  <span>密保答案</span>
                  <input
                    type="text"
                    placeholder="请输入答案"
                    value={resetAnswer}
                    onChange={(e) => setResetAnswer(e.target.value)}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span>新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="至少 6 位新密码"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="primary auth-submit-btn" disabled={submitting}>
                  {submitting ? '正在重置…' : '确认重置密码'}
                </button>
              </form>
            )}
            <button
              type="button"
              className="auth-skip-link"
              onClick={() => { setScreen('login'); setError(''); }}
            >
              ← 返回密码登录
            </button>
          </>
        )}

        {canDismiss && screen !== 'pick-nickname' && (
          <div className="auth-footer-dismiss">
            <button type="button" className="auth-skip-link" onClick={onDismiss}>
              暂不登录，先本地使用
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
