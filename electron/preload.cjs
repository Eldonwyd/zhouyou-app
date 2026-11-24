const { contextBridge, ipcRenderer } = require('electron');

let appVersion = '';
try {
  appVersion = ipcRenderer.sendSync('zhouyou:get-app-version') || '';
} catch {
  appVersion = '';
}

contextBridge.exposeInMainWorld('zhouyouDesktop', {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  version: appVersion,
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
});
