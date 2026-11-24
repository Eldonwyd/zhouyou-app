import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zhouyou.map',
  appName: '周游地图',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#fff8f1',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#fff8f1',
    allowsLinkPreview: true,
    scrollEnabled: true,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
