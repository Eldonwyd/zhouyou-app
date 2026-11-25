import { useSyncExternalStore } from 'react';

/** 主题：跟随系统 / 浅色 / 深色。选择只存在本机浏览器，读写失败时退回跟随系统。 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppearanceStyle = 'candy' | 'white' | 'journal' | 'coast' | 'warm';
export type FontScaleMode = 'compact' | 'standard' | 'large';
export interface AppearanceStyleMeta {
  id: AppearanceStyle;
  name: string;
  nameEn: string;
  badge: string;
  badgeEn: string;
  description: string;
  descriptionEn: string;
  colors: [string, string, string, string];
}
export const APPEARANCE_STYLES: AppearanceStyleMeta[] = [
  { id: 'candy', name: '糖果贴纸', nameEn: 'Candy Sticker', badge: '可爱活泼', badgeEn: 'Playful', description: '波点底纹 · 立体描边 · 贴纸胶带 · Q弹动效', descriptionEn: 'Polka dots · Bold outlines · Washi tape · Bouncy feel', colors: ['#fff8f2', '#eb6b56', '#ffe8cf', '#ffd97d'] },
  { id: 'white', name: '简洁纯白', nameEn: 'Minimal White', badge: '干净极简', badgeEn: 'Clean', description: '纯白干净底 · 清新彩色点缀 · 隐藏贴纸 · 利落方角', descriptionEn: 'Crisp white · Subtle accents · Sticker-free · Sharp corners', colors: ['#ffffff', '#467a58', '#ebf5ed', '#ffefe8'] },
  { id: 'journal', name: '复古手账', nameEn: 'Vintage Journal', badge: '纸本拼贴', badgeEn: 'Paper Craft', description: '方格纸纹 · 和纸胶带 · 宋体标题 · 胶片邮戳', descriptionEn: 'Grid paper · Washi tape · Serif headings · Postmarks', colors: ['#f5efe4', '#866041', '#eadcc4', '#d8b47c'] },
  { id: 'coast', name: '海盐晴空', nameEn: 'Sea Salt Sky', badge: '清爽通透', badgeEn: 'Breezy', description: '浅蓝白底 · 纯白浮卡 · 清澈海蓝 · 胶囊圆角', descriptionEn: 'Airy sky tint · Floating cards · Ocean blue · Pill radius', colors: ['#f3f9fd', '#3c89b8', '#e1f1fa', '#9fd0ec'] },
  { id: 'warm', name: '草木暖日', nameEn: 'Warm Meadow', badge: '温柔自然', badgeEn: 'Gentle', description: '奶油纸底 · 草木新绿 · 柔和圆角 · 舒缓耐看', descriptionEn: 'Cream paper · Sage green · Soft corners · Calm palette', colors: ['#f7f6f0', '#526c48', '#e9efdf', '#f9e7dc'] },
];
const STORAGE_KEY = 'travel-theme';
const STYLE_KEY = 'travel-appearance';
const FONT_SCALE_KEY = 'travel-font-scale';
const EVENT = 'travel-themechange';
const DEFAULT_STYLE: AppearanceStyle = 'candy';
const DEFAULT_FONT_SCALE: FontScaleMode = 'standard';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function normalizeFontScale(value: string | null | undefined): FontScaleMode {
  return value === 'compact' || value === 'large' || value === 'standard' ? value : DEFAULT_FONT_SCALE;
}

export function readFontScale(): FontScaleMode {
  const current = document.documentElement.dataset.fontScale;
  if (current) return normalizeFontScale(current);
  try {
    return normalizeFontScale(localStorage.getItem(FONT_SCALE_KEY));
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function applyFontScale(scale: FontScaleMode): void {
  const normalized = normalizeFontScale(scale);
  document.documentElement.dataset.fontScale = normalized;
  try { localStorage.setItem(FONT_SCALE_KEY, normalized); } catch { /* 存储不可用时仍允许本次会话生效 */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useFontScale(): FontScaleMode {
  return useSyncExternalStore(subscribe, readFontScale, () => DEFAULT_FONT_SCALE);
}

function normalizeAppearanceStyle(value: string | null | undefined): AppearanceStyle {
  if (value === 'peach') return 'candy';
  return APPEARANCE_STYLES.some((style) => style.id === value) ? value as AppearanceStyle : DEFAULT_STYLE;
}

/** 风格与明暗独立保存；任何无效旧值都回退当前默认风格。 */
export function readAppearanceStyle(): AppearanceStyle {
  const current = document.documentElement.dataset.appearance;
  if (current) return normalizeAppearanceStyle(current);
  try {
    return normalizeAppearanceStyle(localStorage.getItem(STYLE_KEY));
  } catch {
    return DEFAULT_STYLE;
  }
}

export function applyAppearanceStyle(style: AppearanceStyle): void {
  const normalized = normalizeAppearanceStyle(style);
  document.documentElement.dataset.appearance = normalized;
  try { localStorage.setItem(STYLE_KEY, normalized); } catch { /* 存储不可用时仍允许本次会话换肤。 */ }
  syncThemeColor();
  window.dispatchEvent(new Event(EVENT));
}

export function useAppearanceStyle(): AppearanceStyle {
  return useSyncExternalStore(subscribe, readAppearanceStyle, () => DEFAULT_STYLE);
}

/** 顶栏与个人中心使用同一订阅，任一入口修改后立即同步。 */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => {
    const mode = document.documentElement.dataset.theme;
    return mode === 'dark' || mode === 'light' ? mode : 'system';
  }, () => 'system');
}

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function isDarkTheme(): boolean {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : media().matches;
}

export function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* 隐私模式等情况下只影响记忆，不影响当前显示 */ }
  syncThemeColor();
  window.dispatchEvent(new Event(EVENT));
}

/** 浏览器地址栏/原生状态栏颜色与图标深浅跟随当前主题。 */
export function syncThemeColor() {
  const dark = isDarkTheme();
  const color = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || (dark ? '#171e19' : '#f7f6f0'));
  const cap = (window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: { SystemBars?: { setStyle?: (opts: { style: 'LIGHT' | 'DARK' }) => Promise<void> } };
    };
  }).Capacitor;
  if (cap?.isNativePlatform?.() && cap.Plugins?.SystemBars?.setStyle) {
    // Capacitor SystemBars 约定：LIGHT = 浅色背景配深色状态栏图标，DARK = 深色背景配浅色状态栏图标。
    void cap.Plugins.SystemBars.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => undefined);
  }
}

/** canvas 绘制（地图）无法使用 CSS 变量，读取当前计算值。 */
export function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function subscribe(callback: () => void) {
  const query = media();
  const onSystem = () => { syncThemeColor(); callback(); };
  window.addEventListener(EVENT, callback);
  // 多标签页换肤也同步到当前页面，不触碰旅行数据。
  const onStorage = (event: StorageEvent) => {
    if (event.key === STYLE_KEY || event.key === null) {
      const value = event.key === null ? null : event.newValue;
      document.documentElement.dataset.appearance = normalizeAppearanceStyle(value);
    }
    if (event.key === STORAGE_KEY || event.key === null) {
      const value = event.key === null ? null : event.newValue;
      if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
      else delete document.documentElement.dataset.theme;
    }
    if (event.key === FONT_SCALE_KEY || event.key === null) {
      const value = event.key === null ? null : event.newValue;
      document.documentElement.dataset.fontScale = normalizeFontScale(value);
    }
    if (event.key === STYLE_KEY || event.key === STORAGE_KEY || event.key === FONT_SCALE_KEY || event.key === null) { syncThemeColor(); callback(); }
  };
  window.addEventListener('storage', onStorage);
  query.addEventListener('change', onSystem);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage); query.removeEventListener('change', onSystem); };
}

/** 当前是否深色；主题或系统设置变化时触发重新渲染。 */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDarkTheme, () => false);
}
