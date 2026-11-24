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

interface ZhouyouDesktopBridge {
  isDesktop: boolean;
  platform: string;
  arch?: string;
  version?: string;
  downloadAndInstallUpdate?: (payload: { url: string; fileName: string; version: string }) => Promise<{ ok: boolean; filePath?: string; error?: string; cancelled?: boolean }>;
  cancelUpdateDownload?: () => Promise<void>;
  onUpdateProgress?: (listener: (progress: ZhouyouDesktopUpdateProgress) => void) => () => void;
  onCheckUpdateRequest?: (listener: () => void) => () => void;
}

interface Window {
  zhouyouDesktop?: ZhouyouDesktopBridge;
}
