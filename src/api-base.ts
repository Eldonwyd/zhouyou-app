const STORAGE_KEY = 'zhouyou-api-origin';
export const PLANNER_API_ORIGIN_EVENT = 'zhouyou-api-origin-change';

/** 读取自定义 AI 服务地址（移动端 App / 局域网联机使用；桌面端与本地网页留空即可走同源）。 */
export function getPlannerApiOrigin(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
    return raw.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** 保存自定义 AI 服务地址；传空字符串恢复同源默认。 */
export function setPlannerApiOrigin(origin: string): string {
  const cleaned = origin.trim().replace(/\/+$/, '');
  if (cleaned && !/^https?:\/\/[^\s"'`]+$/i.test(cleaned)) {
    throw new Error('服务地址需以 http:// 或 https:// 开头，例如 http://192.168.1.100:14173');
  }
  try {
    if (cleaned) localStorage.setItem(STORAGE_KEY, cleaned);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略受限存储异常 */
  }
  try {
    window.dispatchEvent(new CustomEvent(PLANNER_API_ORIGIN_EVENT, { detail: cleaned }));
  } catch {
    /* 忽略非浏览器环境 */
  }
  return cleaned;
}

/** 构造 /api/planner/... 完整请求 URL。 */
export function plannerApiUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, '');
  const customOrigin = getPlannerApiOrigin();
  if (customOrigin) return `${customOrigin}/api/planner/${cleanPath}`;
  return new URL(`${import.meta.env.BASE_URL}api/planner/${cleanPath}`, window.location.href).href;
}
