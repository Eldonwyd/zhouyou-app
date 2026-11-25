const { contextBridge, ipcRenderer } = require('electron');

let runtimeInfo = {
  version: '',
  shellVersion: '',
  nativeCompat: '',
  hotUpdateVersion: '',
};
try {
  const fetched = ipcRenderer.sendSync('zhouyou:get-runtime-info');
  if (fetched && typeof fetched === 'object') {
    runtimeInfo = {
      version: String(fetched.version || ''),
      shellVersion: String(fetched.shellVersion || ''),
      nativeCompat: String(fetched.nativeCompat || ''),
      hotUpdateVersion: String(fetched.hotUpdateVersion || ''),
    };
  }
} catch {
  try {
    runtimeInfo.version = String(ipcRenderer.sendSync('zhouyou:get-app-version') || '');
  } catch {
    runtimeInfo.version = '';
  }
}

contextBridge.exposeInMainWorld('zhouyouDesktop', {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  version: runtimeInfo.version,
  shellVersion: runtimeInfo.shellVersion,
  nativeCompat: runtimeInfo.nativeCompat,
  hotUpdateVersion: runtimeInfo.hotUpdateVersion,
  getRuntimeInfo: () => ipcRenderer.invoke('zhouyou:get-runtime-info-async'),
  applyHotUpdate: (payload) => ipcRenderer.invoke('zhouyou:apply-hot-update', payload),
  downloadAndInstallUpdate: (payload) => ipcRenderer.invoke('zhouyou:download-update', payload),
  cancelUpdateDownload: () => ipcRenderer.invoke('zhouyou:cancel-update'),
  onUpdateProgress: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on('zhouyou:update-progress', handler);
    return () => ipcRenderer.removeListener('zhouyou:update-progress', handler);
  },
  onCheckUpdateRequest: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('zhouyou:open-updater', handler);
    return () => ipcRenderer.removeListener('zhouyou:open-updater', handler);
  },
  onDeepLink: (listener) => {
    const handler = (_event, url) => listener(url);
    ipcRenderer.on('zhouyou:deep-link', handler);
    return () => ipcRenderer.removeListener('zhouyou:deep-link', handler);
  },
});
