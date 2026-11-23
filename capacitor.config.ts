import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zhouyou.map',
  appName: '周游地图',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#fff8f1',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#fff8f1',
    allowsLinkPreview: true,
    scrollEnabled: true,
  },
};

export default config;
