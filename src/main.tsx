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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch((error) => {
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
