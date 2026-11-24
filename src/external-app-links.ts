import { Capacitor, registerPlugin } from '@capacitor/core';

export type MapAppProvider = 'amap' | 'baidu' | 'google';

const MAP_APP_STORAGE_KEY = 'zhouyou-map-app-provider-v1';

export const MAP_APP_OPTIONS: Array<{
  id: MapAppProvider;
  label: string;
  enLabel: string;
  badge: string;
  desc: string;
  enDesc: string;
}> = [
  { id: 'amap', label: '高德地图', enLabel: 'Amap', badge: '高德', desc: '默认 · 国内驾车与公交导航', enDesc: 'Default · China transit & drive' },
  { id: 'baidu', label: '百度地图', enLabel: 'Baidu Maps', badge: '百度', desc: '国内景点与路线导航', enDesc: 'China places & routes' },
  { id: 'google', label: '谷歌地图', enLabel: 'Google Maps', badge: 'G', desc: '境外与国际旅行导航', enDesc: 'Global & overseas trips' },
];

interface NativeUrlBridge {
  openExternalUrl(options: { url: string; fallbackUrl?: string }): Promise<{ ok: boolean }>;
}

const NativeUrlBridgePlugin = registerPlugin<NativeUrlBridge>('NativeAiBridge');

export function readMapAppProvider(): MapAppProvider {
  try {
    const raw = localStorage.getItem(MAP_APP_STORAGE_KEY);
    if (raw === 'amap' || raw === 'baidu' || raw === 'google') return raw;
  } catch {
    // ignore
  }
  return 'amap';
}

export function writeMapAppProvider(provider: MapAppProvider): void {
  try {
    localStorage.setItem(MAP_APP_STORAGE_KEY, provider);
    window.dispatchEvent(new CustomEvent('zhouyou:map-app-change', { detail: provider }));
  } catch {
    // ignore
  }
}

export function mapAppLabel(provider: MapAppProvider = readMapAppProvider()): string {
  return MAP_APP_OPTIONS.find((item) => item.id === provider)?.label ?? '高德地图';
}

function isMobileBrowserEnv(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function isIosEnv(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

/** 在手机 APK / PWA 中优先直连原生 App，未安装时自动回落到网页版。 */
export function openExternalApp(appUrl: string, webUrl: string): void {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeAiBridge')) {
    void NativeUrlBridgePlugin.openExternalUrl({ url: appUrl, fallbackUrl: webUrl }).catch(() => {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    });
    return;
  }

  if (isMobileBrowserEnv()) {
    let leftPage = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') leftPage = true;
    };
    document.addEventListener('visibilitychange', onHide, { once: true });
    window.location.href = appUrl;
    window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!leftPage && document.visibilityState === 'visible') {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
    }, 1300);
    return;
  }

  window.open(webUrl, '_blank', 'noopener,noreferrer');
}

/** 构造小红书 App 唤起链接与网页兜底链接。 */
export function xiaohongshuLinks(keyword: string): { appUrl: string; webUrl: string } {
  const clean = keyword.trim();
  const query = new URLSearchParams({ keyword: clean, source: 'web_explore_feed' });
  return {
    appUrl: `xhsdiscover://search/result?keyword=${encodeURIComponent(clean)}`,
    webUrl: `https://www.xiaohongshu.com/search_result?${query}`,
  };
}

/** 直接打开小红书 App 搜索（PWA / APK 优先唤起 App，桌面端打开网页）。 */
export function openXiaohongshuSearch(keyword: string): void {
  const { appUrl, webUrl } = xiaohongshuLinks(keyword);
  openExternalApp(appUrl, webUrl);
}

/** 构造高德 / 百度 / 谷歌地图的 App 唤起链接与网页兜底链接。 */
export function mapPlaceLinks(
  place: { city: string; name: string; latitude?: number; longitude?: number },
  provider: MapAppProvider = readMapAppProvider(),
): { appUrl: string; webUrl: string; label: string } {
  const city = place.city.trim();
  const name = place.name.trim();
  const fullQuery = city && !name.includes(city.replace(/市$/, '')) ? `${city} ${name}` : name || city;
  const hasCoord = Number.isFinite(place.latitude) && Number.isFinite(place.longitude);

  if (provider === 'baidu') {
    const appUrl = hasCoord
      ? `baidumap://map/marker?location=${place.latitude},${place.longitude}&title=${encodeURIComponent(name || fullQuery)}&content=${encodeURIComponent(city)}&coord_type=wgs84&src=andr.zhouyou.app`
      : `baidumap://map/place/search?query=${encodeURIComponent(fullQuery)}&region=${encodeURIComponent(city)}&src=andr.zhouyou.app`;
    const webUrl = `https://api.map.baidu.com/place/search?query=${encodeURIComponent(fullQuery)}&region=${encodeURIComponent(city)}&output=html&src=zhouyou`;
    return { appUrl, webUrl, label: '百度地图' };
  }

  if (provider === 'google') {
    const queryParam = hasCoord ? `${place.latitude},${place.longitude}` : fullQuery;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParam)}`;
    const appUrl = isIosEnv()
      ? `comgooglemaps://?q=${encodeURIComponent(queryParam)}`
      : `geo:${hasCoord ? `${place.latitude},${place.longitude}` : '0,0'}?q=${encodeURIComponent(fullQuery)}`;
    return { appUrl, webUrl, label: '谷歌地图' };
  }

  // 默认：高德地图
  const query = new URLSearchParams({
    keyword: fullQuery,
    city,
    view: 'map',
    src: 'travel-planner',
    callnative: '1',
  });
  const webUrl = `https://uri.amap.com/search?${query}`;
  const appUrl = isIosEnv()
    ? `iosamap://poi?sourceApplication=zhouyou&name=${encodeURIComponent(fullQuery)}&dev=0`
    : `androidamap://poi?sourceApplication=zhouyou&keywords=${encodeURIComponent(fullQuery)}&dev=0`;
  return { appUrl, webUrl, label: '高德地图' };
}

/** 直接打开用户偏好的地图 App（高德/百度/谷歌）。 */
export function openMapAppPlace(
  place: { city: string; name: string; latitude?: number; longitude?: number },
  provider: MapAppProvider = readMapAppProvider(),
): void {
  const { appUrl, webUrl } = mapPlaceLinks(place, provider);
  openExternalApp(appUrl, webUrl);
}
