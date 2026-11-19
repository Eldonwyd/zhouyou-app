import { useEffect, useRef, useState } from 'react';
import { plannerApi } from '../planner-api';

interface XhsStatus { loggedIn: boolean; message: string }
type XhsAction = 'check' | 'qrcode';
const CHECK_FAILED: XhsStatus = { loggedIn: false, message: '暂时无法检查小红书登录状态，可以直接获取登录二维码。' };

function requestXhs<T>(endpoint: string, body: object, signal: AbortSignal) {
  // 打开面板、手动检查和扫码轮询都要有超时，同时支持面板关闭或切换操作时取消。
  return plannerApi<T>(endpoint, body, AbortSignal.any([signal, AbortSignal.timeout(75000)]), () => {});
}

/** 凭据由本机服务端保存，页面只读取登录状态和用户主动请求的二维码。 */
export default function PlannerPhotoSettings() {
  const [opened, setOpened] = useState(false);
  const [xhs, setXhs] = useState<XhsStatus | null>(null);
  const [qrcode, setQrcode] = useState<{ image: string; expiresAt: number } | null>(null);
  const [action, setAction] = useState<XhsAction | null>(null);
  const [waited, setWaited] = useState(0);
  const [message, setMessage] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  async function run(nextAction: XhsAction, perform: (signal: AbortSignal) => Promise<void>) {
    // 用户可以直接扫码，也可以返回检查。被切换掉的请求不得覆盖当前操作的结果。
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setAction(nextAction);
    setMessage('');
    try {
      await perform(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (nextAction === 'check') setXhs(CHECK_FAILED);
      else setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : '获取登录二维码超时，请重试。');
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setAction(null);
      }
    }
  }

  function check(fresh: boolean) {
    setWaited(0);
    return run('check', async (signal) => {
      // 直接查询状态，避免另一个设置接口的结果挡住检查和扫码。
      const status = await requestXhs<XhsStatus>('xhs-status', { fresh }, signal);
      signal.throwIfAborted();
      setXhs(status);
      if (status.loggedIn) setQrcode(null);
    });
  }

  function getQrcode() {
    return run('qrcode', async (signal) => {
      const result = await requestXhs<{ loggedIn: boolean; image?: string }>('xhs-qrcode', {}, signal);
      signal.throwIfAborted();
      if (result.loggedIn) {
        setXhs({ loggedIn: true, message: '小红书已登录' });
        setQrcode(null);
        return;
      }
      if (!result.image) throw new Error('小红书未返回登录二维码，请重试。');
      setXhs({ loggedIn: false, message: '' });
      setQrcode({ image: result.image, expiresAt: Date.now() + 240000 });
    });
  }

  useEffect(() => {
    if (!opened) return;
    void check(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [opened]);

  useEffect(() => {
    if (action !== 'check') return;
    const started = Date.now();
    const timer = window.setInterval(() => setWaited(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [action]);

  useEffect(() => {
    if (!qrcode || !opened) return;
    // 手动检查或重新获取二维码不会延长已签发二维码的有效期。
    const timeout = window.setTimeout(() => {
      setQrcode(null);
      setMessage('二维码已过期，请重新获取');
    }, Math.max(0, qrcode.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [qrcode, opened]);

  useEffect(() => {
    if (!qrcode || !opened || action) return;
    const controller = new AbortController();
    let running = false;
    const interval = window.setInterval(() => {
      if (running || activeRequest.current) return;
      running = true;
      void requestXhs<XhsStatus>('xhs-status', { fresh: true }, controller.signal).then((status) => {
        if (controller.signal.aborted || activeRequest.current || !status.loggedIn) return;
        setXhs(status);
        setQrcode(null);
        setMessage('登录成功，之后的攻略和图片可以使用小红书。');
      }).catch(() => {}).finally(() => { running = false; });
    }, 5000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [qrcode, opened, action]);

  const checking = action === 'check';
  return <details className="card planner-photo-settings" onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary>小红书登录{xhs?.loggedIn ? ' · 已登录' : ''}</summary>
    {opened && <div className="planner-photo-settings-content">
      <div>
        <p role="status" className={xhs?.loggedIn && !checking ? 'planner-xhs-ok' : undefined}>{checking ? '正在检查登录状态，通常需要约 10 秒。' : xhs?.message}</p>
        <p className="muted">登录后，需要时可读取小红书攻略、游客评论和图片；登录状态只保存在本机。票价、开放时间和交通仍以官方资料为准。</p>
        <div className="heading-actions">
          <button className="secondary" disabled={checking} onClick={() => void check(true)}>
            {checking ? `检查中…${waited} 秒` : '检查连接'}
          </button>
          {(!xhs?.loggedIn || checking) && <button className="primary" disabled={action === 'qrcode'} onClick={() => void getQrcode()}>
            {action === 'qrcode' ? '正在获取二维码…' : '获取登录二维码'}
          </button>}
        </div>
        {qrcode && <>
          <p className="muted">请使用小红书 App 扫码，并在手机上确认登录。</p>
          <img className="planner-xhs-qrcode" src={qrcode.image} alt="小红书登录二维码，请使用小红书 App 扫描" />
        </>}
      </div>
      {message && <p role="status" className="planner-banner">{message}</p>}
    </div>}
  </details>;
}
