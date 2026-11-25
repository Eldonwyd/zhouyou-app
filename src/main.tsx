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
