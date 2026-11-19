import { xiaohongshuSearchUrl } from './planner-xhs.ts';

/** 活动标题常含“漫游”等描述，检索时只保留明确地点名，避免关键词被玩法干扰。 */
export function plannerPhotoPlaceName(title: string): string {
  return title.split(/[（(：:，,、/｜|]/)[0]
    .replace(/^(?:前往|走进|游览|参观|漫步|打卡|游玩|探访|游逛)\s*/, '')
    .replace(/(?:漫游|慢走|漫步|自由慢逛|游览|参观|打卡).*$/, '')
    .replace(/(?:及|与|和)?周边.*$/, '')
    .replace(/(.{2,}?)(?:观鸥|喂鸥|赏荷|赏花|观鸟|看日落|看日出|拍照|晨游|夜游|闲逛)(?:体验|活动|散步|游玩)?$/, '$1')
    .trim();
}

/** 城市可能包含省份或区县，检索时提取其中明确的城市名。
 * 保留城市约束；不能只因名称相似，就把别的城市里的同名公园拿来配图。
 */
export function plannerPhotoCityName(city: string): string {
  const withoutProvince = city.trim().replace(/^.*?(?:省|自治区)/, '');
  return withoutProvince.match(/^(.+?市)/)?.[1] ?? withoutProvince;
}

export function plannerPhotoMonth(date = ''): string {
  const month = /^\d{4}-(\d{2})-\d{2}$/.exec(date)?.[1];
  const names = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  return month ? names[Number(month) - 1] ?? '' : '';
}

export function plannerXiaohongshuSearchUrl(city: string, title: string, _date = ''): string {
  const keyword = [city.trim(), plannerPhotoPlaceName(title)].filter(Boolean).join(' ');
  return xiaohongshuSearchUrl(keyword);
}

/** 地点审核依靠图片说明/标题与来源证据，不把出行月份当作照片拍摄日期。 */
export function plannerPhotoMatches(evidence: string, city: string, place: string, pageContext = ''): boolean {
  const normalize = (value: string) => value.replace(/[園臺門雲麗]/g, (letter) => ({ 園: '园', 臺: '台', 門: '门', 雲: '云', 麗: '丽' })[letter]!)
    .replace(/[\s·（）()]/g, '').toLowerCase();
  const text = normalize(evidence);
  const cityName = normalize(plannerPhotoCityName(city)).replace(/市$/, '');
  const placeName = normalize(plannerPhotoPlaceName(place));
  const shortName = placeName.endsWith('公园') && placeName.length >= 4 ? placeName.slice(0, -2) : '';
  const placeMatches = text.includes(placeName) || Boolean(shortName && text.includes(shortName));
  const explicitCities = [...evidence.matchAll(/(?:^|[\s，。·：:（(])([\u4e00-\u9fff]{2,6})市/g)].map((match) => normalize(match[1]));
  if (explicitCities.length && !explicitCities.some((value) => value === cityName || value.endsWith(`省${cityName}`))) return false;
  // 图片说明只写景点名也可以，城市可由已匹配的来源页补充，不要求每段都写全。
  return Boolean(cityName && placeName && placeMatches && (text.includes(cityName) || normalize(pageContext).includes(cityName)));
}
