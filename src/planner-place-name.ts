/** 地图查询使用真实地名，去掉行政区前缀和玩法；范围描述选择其中一个明确地名作参考点。 */
export function plannerPlaceSearchTarget(rawName: string, city = ''): { name: string; area: boolean } {
  let name = rawName.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  if (city && name.startsWith(city)) name = name.slice(city.length).trim();
  // “滇池国家旅游度假区海埂大坝”“五华区翠湖公园”均取后面的实际地名。
  name = name.replace(/^[\u4e00-\u9fff]{2,16}?(?:区|县)(?=[\u4e00-\u9fff]{2})/, '');
  const area = /片区|周边|附近|一带|商圈|[—–－]/.test(name);
  if (area) {
    const parts = name.split(/[—–－、/]/).map((part) => part.trim()).filter(Boolean);
    name = parts.at(-1) || name;
  }
  name = name.replace(/(?:观鸥|拍照|游览|游玩|散步|休整|附近|周边|片区|一带|商圈)+$/, '').trim();
  return { name, area };
}

/** 没有具体店名的用餐按当天相邻地点所在片区标注，不能把它当作一家真实餐馆。 */
export function isGeneralMealLocation(name: string): boolean {
  return /^(?:(?:在|附近|周边|就近|当地)\s*)*(?:吃|用餐|就餐|午餐|晚餐|早餐|火锅|菌子火锅|餐饮|餐馆|餐厅|美食|小吃|休息)/.test(name.trim());
}
