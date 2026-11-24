import { readLanguage } from './i18n';

export type TourRestrictedFeature = 'ai' | 'photo' | 'voice';

function isNativeClient(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    zhouyouDesktop?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return Boolean(win.zhouyouDesktop || win.Capacitor?.isNativePlatform?.());
}

/**
 * 官网在线漫游体验模式（?tour=1 或 ?preview=1）：
 * 允许自由点亮/取消点亮全国地图、切换皮肤主题、浏览示例路书/手账/账本与成就；
 * 禁用在线 AI 规划调用与照片/视频/语音媒体保存，引导用户下载客户端或安装 PWA。
 */
export function isWebTourMode(): boolean {
  if (typeof window === 'undefined' || isNativeClient()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('tour') === '1' || params.get('preview') === '1';
  } catch {
    return false;
  }
}

export function isEmbeddedTour(): boolean {
  if (!isWebTourMode()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === '1' || window.self !== window.top;
  } catch {
    return true;
  }
}

export function tourRestrictionCopy(feature: TourRestrictedFeature): { title: string; body: string } {
  const isEn = readLanguage() === 'en';
  if (feature === 'ai') {
    return isEn
      ? {
          title: 'AI Planning Is Client-Only',
          body: 'You are in Online Web Tour mode. You can freely light up China cities, switch themes, and explore the sample Dali roadbook & route map. To generate custom AI itineraries, run offline ticket OCR, or connect your own AI keys, please download the Desktop or Mobile client.',
        }
      : {
          title: 'AI 行程规划为客户端专属能力',
          body: '当前处于官网「在线漫游体验模式」，你可以自由点亮全国 370+ 城市、切换 5 套皮肤、浏览示例大理路书与交互路线地图。如需使用多模型 AI 生成/对话改行程、小红书攻略解析与本地离线 OCR 识票，请下载桌面端或安装客户端体验。',
        };
  }
  if (feature === 'voice') {
    return isEn
      ? {
          title: 'Voice Note Storage Is Disabled in Web Tour',
          body: 'Online Web Tour mode does not store audio recordings. Download the client or install the PWA to archive original photos, videos, and voice notes locally on your device.',
        }
      : {
          title: '在线体验模式暂不支持录制与保存语音',
          body: '当前处于官网「在线漫游体验模式」，暂不开放语音录制与媒体归档。下载独立客户端或安装完整版 PWA 后，即可将原图照片、视频与现场语音永久保存在本机。',
        };
  }
  return isEn
    ? {
        title: 'Photo & Media Saving Is Disabled in Web Tour',
        body: 'Online Web Tour mode lets you light up cities, write text notes, and browse sample postcards, but photo/video storage is disabled here. Download the client or install the full PWA to save original photos locally with zero cloud upload.',
      }
    : {
        title: '在线体验模式暂不支持保存照片与媒体',
        body: '当前处于官网「在线漫游体验模式」，支持点亮地图、撰写文字便签与浏览示例明信片，暂不开放本地照片/视频存储。下载独立客户端或添加到手机桌面（PWA）后，即可无损保存原图与旅途相册。',
      };
}

export function openDownloadFromTour(section: 'download' | 'desktop' | 'mobile' = 'download'): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.self !== window.top && window.parent) {
      window.parent.postMessage({ type: 'zhouyou-tour-download', section }, '*');
      return;
    }
  } catch {
    // Cross-origin fallback
  }
  window.location.href = `./download.html#${section}`;
}

export function openFullscreenTour(): void {
  if (typeof window === 'undefined') return;
  const target = './?demo=1&tour=1';
  try {
    if (window.self !== window.top) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
  } catch {
    // ignore
  }
  window.location.href = target;
}
