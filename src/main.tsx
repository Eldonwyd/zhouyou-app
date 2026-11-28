import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { syncThemeColor } from './theme';
import './style.css';
import './refine.css';
import './warm.css';
import './warm-details.css';
import './cute-styles.css';
import './appearance.css';
import './phone.css';
import './planner-ai-neo.css';
import './cloud-social.css';
import './onboarding.css';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('应用渲染异常', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#faf6f0',
            color: '#2b241d',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#fffdf9',
              borderRadius: '18px',
              padding: '24px',
              boxShadow: '0 12px 32px rgba(43,36,29,0.08)',
              border: '1px solid rgba(43,36,29,0.08)',
            }}
          >
            <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>页面遇到了一点小问题</h2>
            <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#6b6054', lineHeight: 1.5 }}>
              已为你保护本地行程与手账数据，点击下方按钮即可恢复页面。
            </p>
            <pre
              style={{
                margin: '0 0 16px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: '#f7ece7',
                color: '#8f3425',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message || '未知渲染错误'}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: '12px',
                border: 'none',
                background: '#d6553b',
                color: '#fff',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              重新加载页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

// 挂载后同步状态栏颜色与图标深浅（兼容 Capacitor 原生端与 PWA 浏览器）。
requestAnimationFrame(() => syncThemeColor());

// 移动端软键盘适配：打字聚焦时隐藏底部导航栏，避免固定底栏被软键盘顶起遮挡输入框与聊天内容，
// 并实时同步可视视口高度（--app-vvh），确保输入框紧贴软键盘上方、消息区完整可见。
function setupMobileKeyboardViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  const vv = window.visualViewport;
  const isTouchDevice = () =>
    window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  const isNarrowViewport = () => window.innerWidth <= 850;

  const NON_TEXT_INPUT_TYPES = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
  ]);
  const isEditableElement = (el: EventTarget | null): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled;
    if (el.tagName === 'INPUT') {
      const input = el as HTMLInputElement;
      if (input.readOnly || input.disabled) return false;
      return !NON_TEXT_INPUT_TYPES.has((input.type || 'text').toLowerCase());
    }
    return false;
  };

  let lastWidth = window.innerWidth;
  let baseHeight = Math.max(window.innerHeight, vv?.height ?? 0);
  let wasShrunkByKeyboard = false;
  let blurTimer: number | null = null;

  const setKeyboardState = (open: boolean, viewportHeight?: number) => {
    if (open && isNarrowViewport()) {
      root.dataset.keyboardOpen = 'true';
      if (viewportHeight && viewportHeight > 120) {
        root.style.setProperty('--app-vvh', `${Math.round(viewportHeight)}px`);
      }
    } else {
      delete root.dataset.keyboardOpen;
      root.style.removeProperty('--app-vvh');
    }
  };

  const syncFromViewport = () => {
    const currentWidth = window.innerWidth;
    const currentHeight = vv ? vv.height : window.innerHeight;

    if (!isNarrowViewport()) {
      wasShrunkByKeyboard = false;
      setKeyboardState(false);
      return;
    }

    // 横竖屏切换时重置基准高度
    if (Math.abs(currentWidth - lastWidth) > 40) {
      lastWidth = currentWidth;
      baseHeight = Math.max(window.innerHeight, currentHeight);
      wasShrunkByKeyboard = false;
    }

    const activeEditable = isEditableElement(document.activeElement);
    const shrinkDelta = baseHeight - currentHeight;

    if (!activeEditable && shrinkDelta < 80) {
      baseHeight = Math.max(baseHeight, window.innerHeight, currentHeight);
      wasShrunkByKeyboard = false;
      setKeyboardState(false);
      return;
    }

    if (shrinkDelta > 100) {
      wasShrunkByKeyboard = true;
      setKeyboardState(true, currentHeight);
      return;
    }

    if (wasShrunkByKeyboard && shrinkDelta < 80) {
      // 用户点击了系统软键盘自带的“收起”按钮，即使输入框仍保留焦点也恢复底部导航栏
      wasShrunkByKeyboard = false;
      setKeyboardState(false);
      return;
    }

    if (activeEditable && isTouchDevice()) {
      setKeyboardState(true, currentHeight);
    } else {
      setKeyboardState(false);
    }
  };

  document.addEventListener('focusin', (e) => {
    if (blurTimer !== null) {
      window.clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (!isNarrowViewport() || !isEditableElement(e.target)) return;
    wasShrunkByKeyboard = false;
    const currentHeight = vv ? vv.height : window.innerHeight;
    if (isTouchDevice() || baseHeight - currentHeight > 100) {
      setKeyboardState(true, currentHeight);
    }
  }, true);

  document.addEventListener('focusout', () => {
    if (blurTimer !== null) window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      blurTimer = null;
      if (!isEditableElement(document.activeElement)) {
        wasShrunkByKeyboard = false;
        setKeyboardState(false);
      }
    }, 120);
  }, true);

  // 若用户曾手动收起软键盘但输入框仍保有焦点，再次轻触该输入框时立即隐藏底栏
  document.addEventListener('pointerdown', (e) => {
    if (!isNarrowViewport() || !isTouchDevice()) return;
    if (e.target === document.activeElement && isEditableElement(e.target) && root.dataset.keyboardOpen !== 'true') {
      const currentHeight = vv ? vv.height : window.innerHeight;
      setKeyboardState(true, currentHeight);
    }
  }, true);

  vv?.addEventListener('resize', syncFromViewport);
  window.addEventListener('resize', syncFromViewport);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => {
      lastWidth = window.innerWidth;
      baseHeight = Math.max(window.innerHeight, vv?.height ?? 0);
      syncFromViewport();
    }, 180);
  });
}

setupMobileKeyboardViewport();

// Service workers need a secure origin. Vite's localhost and HTTPS both qualify.
// 原生端（Capacitor Android/iOS、Electron 桌面端）所有静态资源已打包在本地，
// 绝不能由 Service Worker 缓存 App Shell，否则覆盖升级后仍会停留在旧版页面。
const isNativeClient = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; zhouyouDesktop?: { isDesktop?: boolean } }).Capacitor?.isNativePlatform?.()
  || (window as unknown as { zhouyouDesktop?: { isDesktop?: boolean } }).zhouyouDesktop?.isDesktop,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD && !isNativeClient) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((reg) => {
        void reg.update().catch(() => undefined);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            void reg.update().catch(() => undefined);
          }
        });
      }).catch((error) => {
        console.warn('离线应用注册失败', error);
      });
    } else {
      // 原生客户端或开发模式：注销旧 Service Worker 并清理旧 App Shell 缓存，
      // 保留 travel-region-maps-* 离线地图缓存与 IndexedDB 旅行数据。
      const hadController = Boolean(navigator.serviceWorker.controller);
      const workerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href).href;
      void Promise.all([
        navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
          registrations
            .filter((registration) => isNativeClient || [registration.active, registration.waiting, registration.installing]
              .some((worker) => worker?.scriptURL === workerUrl))
            .map((registration) => registration.unregister()),
        )),
        'caches' in window
          ? caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key.startsWith('travel-shell-')).map((key) => caches.delete(key)),
          ))
          : Promise.resolve(),
      ]).then(() => {
        if (isNativeClient && hadController && !sessionStorage.getItem('zhouyou-sw-cleaned')) {
          sessionStorage.setItem('zhouyou-sw-cleaned', '1');
          window.location.reload();
        }
      }).catch(() => undefined);
    }
  });
}
