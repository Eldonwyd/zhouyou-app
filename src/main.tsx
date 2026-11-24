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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.warn('离线应用注册失败', error);
      });
    } else {
      // Development source files are not content-hashed. Remove only this
      // app's registration so a prior build cannot serve stale editor code.
      // Existing region caches and IndexedDB records are left intact.
      const workerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href).href;
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
        registrations.filter((registration) => [registration.active, registration.waiting, registration.installing]
          .some((worker) => worker?.scriptURL === workerUrl)).map((registration) => registration.unregister()),
      )).catch(() => undefined);
    }
  });
}
