const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('zhouyouDesktop', {
  isDesktop: true,
  platform: process.platform,
});
