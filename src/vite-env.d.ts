/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ZhouyouDesktopUpdateProgress {
  state: 'downloading' | 'ready' | 'installing' | 'error' | 'cancelled';
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  filePath?: string;
  error?: string;
}

interface ZhouyouDesktopRuntimeInfo {
  version: string;
  shellVersion: string;
  nativeCompat: string;
  hotUpdateVersion: string;
}

interface ZhouyouDesktopBridge {
  isDesktop: boolean;
  platform: string;
  arch?: string;
  version?: string;
  shellVersion?: string;
  nativeCompat?: string;
  hotUpdateVersion?: string;
  getRuntimeInfo?: () => Promise<ZhouyouDesktopRuntimeInfo>;
  applyHotUpdate?: (payload: {
    url: string;
    fallbackUrls?: string[];
    version: string;
    nativeCompat: string;
    sha256: string;
  }) => Promise<{ ok: boolean; mode?: 'hot'; version?: string; error?: string; cancelled?: boolean }>;
  downloadAndInstallUpdate?: (payload: {
    url: string;
    fallbackUrls?: string[];
    fileName: string;
    version: string;
    sha256Url?: string;
    sha256FallbackUrls?: string[];
    openInBrowser?: boolean;
  }) => Promise<{ ok: boolean; mode?: 'full'; filePath?: string; verified?: boolean; fallbackOpened?: boolean; error?: string; cancelled?: boolean }>;
  cancelUpdateDownload?: () => Promise<void>;
  onUpdateProgress?: (listener: (progress: ZhouyouDesktopUpdateProgress) => void) => () => void;
  onCheckUpdateRequest?: (listener: () => void) => () => void;
}

interface Window {
  zhouyouDesktop?: ZhouyouDesktopBridge;
}
