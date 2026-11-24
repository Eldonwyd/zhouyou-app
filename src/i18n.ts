import { useSyncExternalStore } from 'react';

export type AppLanguage = 'zh' | 'en';

const STORAGE_KEY = 'travel-lang';
const EVENT = 'travel-langchange';
const DEFAULT_LANGUAGE: AppLanguage = 'zh';

function normalizeLanguage(value: string | null | undefined): AppLanguage {
  return value === 'en' ? 'en' : DEFAULT_LANGUAGE;
}

export function readLanguage(): AppLanguage {
  if (typeof document !== 'undefined') {
    const current = document.documentElement.dataset.lang;
    if (current === 'zh' || current === 'en') return current;
  }
  try {
    return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function syncDocumentLanguage(lang: AppLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.title = lang === 'en' ? 'Zhouyou Map' : '周游地图';
}

export function applyLanguage(lang: AppLanguage): void {
  const normalized = normalizeLanguage(lang);
  syncDocumentLanguage(normalized);
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* 隐私模式等情况下仅影响持久化，不影响当前会话切换。 */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      const next = normalizeLanguage(event.key === null ? null : event.newValue);
      syncDocumentLanguage(next);
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLanguage(): AppLanguage {
  return useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_LANGUAGE);
}

export function useI18n() {
  const lang = useLanguage();
  const isEn = lang === 'en';
  const locale = isEn ? 'en-US' : 'zh-CN';
  const t = (zh: string, en: string): string => (isEn ? en : zh);
  return { lang, isEn, locale, t };
}

export const PROVINCE_EN_NAMES: Record<string, { full: string; short: string }> = {
  '110000': { full: 'Beijing', short: 'Beijing' },
  '120000': { full: 'Tianjin', short: 'Tianjin' },
  '130000': { full: 'Hebei Province', short: 'Hebei' },
  '140000': { full: 'Shanxi Province', short: 'Shanxi' },
  '150000': { full: 'Inner Mongolia', short: 'Inner Mongolia' },
  '210000': { full: 'Liaoning Province', short: 'Liaoning' },
  '220000': { full: 'Jilin Province', short: 'Jilin' },
  '230000': { full: 'Heilongjiang Province', short: 'Heilongjiang' },
  '310000': { full: 'Shanghai', short: 'Shanghai' },
  '320000': { full: 'Jiangsu Province', short: 'Jiangsu' },
  '330000': { full: 'Zhejiang Province', short: 'Zhejiang' },
  '340000': { full: 'Anhui Province', short: 'Anhui' },
  '350000': { full: 'Fujian Province', short: 'Fujian' },
  '360000': { full: 'Jiangxi Province', short: 'Jiangxi' },
  '370000': { full: 'Shandong Province', short: 'Shandong' },
  '410000': { full: 'Henan Province', short: 'Henan' },
  '420000': { full: 'Hubei Province', short: 'Hubei' },
  '430000': { full: 'Hunan Province', short: 'Hunan' },
  '440000': { full: 'Guangdong Province', short: 'Guangdong' },
  '450000': { full: 'Guangxi', short: 'Guangxi' },
  '460000': { full: 'Hainan Province', short: 'Hainan' },
  '500000': { full: 'Chongqing', short: 'Chongqing' },
  '510000': { full: 'Sichuan Province', short: 'Sichuan' },
  '520000': { full: 'Guizhou Province', short: 'Guizhou' },
  '530000': { full: 'Yunnan Province', short: 'Yunnan' },
  '540000': { full: 'Tibet', short: 'Tibet' },
  '610000': { full: 'Shaanxi Province', short: 'Shaanxi' },
  '620000': { full: 'Gansu Province', short: 'Gansu' },
  '630000': { full: 'Qinghai Province', short: 'Qinghai' },
  '640000': { full: 'Ningxia', short: 'Ningxia' },
  '650000': { full: 'Xinjiang', short: 'Xinjiang' },
  '710000': { full: 'Taiwan', short: 'Taiwan' },
  '810000': { full: 'Hong Kong', short: 'Hong Kong' },
  '820000': { full: 'Macao', short: 'Macao' },
};

const PROVINCE_ZH_TO_CODE: Record<string, string> = {
  '北京市': '110000',
  '天津市': '120000',
  '河北省': '130000',
  '山西省': '140000',
  '内蒙古自治区': '150000',
  '辽宁省': '210000',
  '吉林省': '220000',
  '黑龙江省': '230000',
  '上海市': '310000',
  '江苏省': '320000',
  '浙江省': '330000',
  '安徽省': '340000',
  '福建省': '350000',
  '江西省': '360000',
  '山东省': '370000',
  '河南省': '410000',
  '湖北省': '420000',
  '湖南省': '430000',
  '广东省': '440000',
  '广西壮族自治区': '450000',
  '海南省': '460000',
  '重庆市': '500000',
  '四川省': '510000',
  '贵州省': '520000',
  '云南省': '530000',
  '西藏自治区': '540000',
  '陕西省': '610000',
  '甘肃省': '620000',
  '青海省': '630000',
  '宁夏回族自治区': '640000',
  '新疆维吾尔自治区': '650000',
  '台湾省': '710000',
  '香港特别行政区': '810000',
  '澳门特别行政区': '820000',
};

export function provinceDisplayName(codeOrName: string, zhName: string, lang: AppLanguage, short = false): string {
  if (lang !== 'en') return zhName;
  const code = PROVINCE_EN_NAMES[codeOrName] ? codeOrName : PROVINCE_ZH_TO_CODE[zhName];
  const mapped = code ? PROVINCE_EN_NAMES[code] : undefined;
  if (!mapped) return zhName;
  return short ? mapped.short : mapped.full;
}
