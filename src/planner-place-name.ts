const SUBWAY_LINE_PREFIX_RE = /^(?:(?:地铁|轻轨|轨交|轨道交通|有轨电车|公交)?\s*[0-9A-Za-z一二三四五六七八九十]+号线|(?:地铁|轻轨|轨交)?号线)\s*/;
const LEADING_VERB_RE = /^(?:沿着|沿|从|前往|去往|去|到|漫步|步行至|步行到|步行|逛逛|逛|夜游|游览|参观|打卡|探访)\s*/;
const TRAILING_ACTION_RE = /(?:观鸥|拍照|游览|游玩|散步|漫步|步行|逛吃|逛街|夜游|打卡|参观|休整|骑行|乘船|游船|看夜景|夜景|看日落|日落|观景|附近|周边|片区|一带|商圈)+$/;
const DISTRICT_PREFIX_RE = /^[\u4e00-\u9fff]{2,16}?(?:区|县)\s*(?=[\u4e00-\u9fff]{2})/;
const ADDRESS_INTERSECTION_RE = /(?:交口|交叉口|十字路口|路口|旁|对面|附近)/;
const STREET_NUMBER_RE = /^[\u4e00-\u9fff]{2,12}?(?:路|道|街|大道|大街|巷|胡同|弄|段|山坡|坡)(?:[0-9一二三四五六七八九十]+号(?:院|楼|附[0-9]+号?)?)?\s*(?=[\u4e00-\u9fff]{2})/;
const ROAD_NAME_RE = /[\u4e00-\u9fff]{2,10}(?:大道|大街|南路|北路|东路|西路|中路|路|道|街|巷|胡同)/g;
const LANDMARK_ANCHOR_RE = /[\u4e00-\u9fff]{2,6}(?:国际机场|机场|火车站|高铁站|动车站|地铁站|东站|西站|南站|北站|站前广场|站|国家森林公园|主题公园|湿地公园|公园|广场|博物院|博物馆|纪念馆|美术馆|科技馆|大剧院|音乐厅|体育场|大桥|桥|古镇|古城|老街|步行街|美食街|小吃街|风情区|风光带|景区|风景区|寺|庙|宫|塔|山|湖|河|江|海|岛|湾|园|阁|楼|坊|门|祠|陵|殿|亭|坛|巷|街)/g;
const SHORT_LANDMARK_RE = /[\u4e00-\u9fff]{2,4}(?:公园|广场|博物院|博物馆|纪念馆|大桥|桥|古镇|古城|老街|寺|庙|宫|塔|楼|阁|亭|殿|祠|陵|山|湖|河|江|站)/g;
const SUB_FACILITY_SUFFIX_RE = /(?:老站房|新站房|站房|候车楼|候车厅|主楼|副楼|旧址|故居|大雄宝殿|大成殿|珍宝馆|钟表馆|音乐喷泉|观景平台|观景台|博爱坊|东花园|西花园|北广场|南广场|东广场|西广场|站前广场|东门|西门|南门|北门|正门|入口|出口|停车场|游客中心|[0-9]+楼|[0-9]+层|[一二三四五六七八九十]+楼)$/;
const GENERIC_PLACE_WORDS = new Set([
  '公园', '广场', '景区', '古城', '古镇', '老街', '步行街', '美食街', '小吃街', '站', '车站', '火车站', '高铁站',
  '地铁站', '机场', '桥', '大桥', '塔', '寺', '庙', '宫', '山', '湖', '河', '江', '海', '岛', '湾', '楼', '阁', '门', '巷', '街', '路', '道',
  '老站房', '站房', '观景台', '主楼', '风味小吃街', '小吃街', '美食街',
]);

function normalizeStationWord(value: string): string {
  // “天津站站”“西站站”多来自地铁换乘写法，查询时归一为单个“站”。
  return value.replace(/站站$/, '站').trim();
}

function cleanSingleSegment(raw: string, city = ''): string {
  let name = raw.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  const shortCity = city.replace(/(?:特别行政区|自治州|自治区|地区|市)$/, '');
  name = name.replace(SUBWAY_LINE_PREFIX_RE, '');
  name = name.replace(LEADING_VERB_RE, '');
  if (city && name.startsWith(city) && name.length > city.length + 1) {
    name = name.slice(city.length).trim();
  } else if (shortCity.length >= 2 && name.startsWith(`${shortCity}市`) && name.length > shortCity.length + 2) {
    name = name.slice(shortCity.length + 1).trim();
  }
  // 去掉明确的行政区前缀，保留“三里屯太古里北区”等地名本身。
  name = name.replace(DISTRICT_PREFIX_RE, '');
  name = name.replace(SUBWAY_LINE_PREFIX_RE, '');
  name = name.replace(LEADING_VERB_RE, '');
  name = name.replace(TRAILING_ACTION_RE, '').trim();
  return normalizeStationWord(name);
}

/** 地图查询使用真实地名，去掉行政区前缀、地铁线号和玩法动词；范围描述选择明确地名作参考点。 */
export function plannerPlaceSearchTarget(rawName: string, city = ''): { name: string; area: boolean } {
  const rawTrimmed = rawName.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  const isStrollOrLinear = /^(?:沿着|沿)\s*/.test(rawTrimmed) || /(?:步行|漫步|散步|夜游|游船|乘船)$/.test(rawTrimmed);
  let name = rawTrimmed;
  name = name.replace(SUBWAY_LINE_PREFIX_RE, '');
  name = name.replace(LEADING_VERB_RE, '');
  if (city && name.startsWith(city)) name = name.slice(city.length).trim();
  // 去掉明确的行政区前缀，保留“三里屯太古里北区”等地名本身。
  name = name.replace(DISTRICT_PREFIX_RE, '');
  name = name.replace(SUBWAY_LINE_PREFIX_RE, '');
  name = name.replace(LEADING_VERB_RE, '');
  const area = isStrollOrLinear || /(?:片区|周边|附近|一带|商圈)$|[—–－]/.test(name);
  if (area) {
    const parts = name.split(/[—–－、/]/).map((part) => part.trim()).filter(Boolean);
    name = parts.at(-1) || name;
  }
  name = name.replace(TRAILING_ACTION_RE, '').trim();
  name = normalizeStationWord(name);
  return { name, area };
}

/** 当完整长地名（如“红桥区芥园道与复兴路交口西北角回民风味小吃街”“天津西站老站房”“世纪钟、解放桥”）未直接命中时，
 * 按通用中文地理构词规则拆出子地标、父级地标和路名交口供降级定位（绝不依赖特定城市词表）。
 */
export function plannerPlaceFallbackCandidates(rawName: string, city = ''): Array<{ name: string; area: boolean }> {
  const shortCity = city.replace(/(?:特别行政区|自治州|自治区|地区|市)$/, '');
  const cleanedFull = cleanSingleSegment(rawName, city);
  const results: Array<{ name: string; area: boolean }> = [];
  const seen = new Set<string>();
  const push = (candidate: string, area: boolean) => {
    const text = normalizeStationWord(candidate.replace(LEADING_VERB_RE, '').replace(TRAILING_ACTION_RE, '').trim());
    if (text.length < 2) return;
    if (GENERIC_PLACE_WORDS.has(text)) return;
    if (shortCity && (text === shortCity || text === `${shortCity}市`)) return;
    if (text === cleanedFull && !area) return;
    const key = `${text}|${area ? 'a' : 'p'}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ name: text, area });
  };

  // 1. 多地点并列拆分（如“天津站前广场世纪钟、解放桥”→“解放桥”“世纪钟”“天津站前广场”）
  if (/[、/＋+&]|(?:以及|及)/.test(cleanedFull)) {
    const parts = cleanedFull.split(/[、/＋+&]|(?:以及|及)/).map((part) => cleanSingleSegment(part, city)).filter(Boolean);
    for (const part of parts) push(part, true);
  }

  // 2. 路口/地址前缀拆解：先取交口/门牌后的真实地点名，再取路名作为片区参考
  if (ADDRESS_INTERSECTION_RE.test(cleanedFull)) {
    const match = cleanedFull.match(ADDRESS_INTERSECTION_RE);
    if (match && match.index !== undefined) {
      const before = cleanedFull.slice(0, match.index).trim();
      const after = cleanedFull.slice(match.index + match[0].length).trim();
      if (after.length >= 2) {
        push(after, false);
        // 如“西北角回民风味小吃街”→去掉泛称“回民风味小吃街”保留“西北角”
        const afterHead = after.replace(/(?:回民|特色|风味|传统|网红|老字号)*(?:小吃街|美食街|步行街|商业街|夜市|片区|市场)$/, '').trim();
        if (afterHead.length >= 2) push(afterHead, true);
      }
      const roads = before.match(ROAD_NAME_RE) ?? [];
      for (const road of roads) push(road, true);
    }
  }

  // 3. 门牌/路名打头接具体景点（如“武侯祠大街231号锦里古街”“中山东一路外滩观景平台”）
  const afterStreet = cleanedFull.replace(STREET_NUMBER_RE, '').trim();
  if (afterStreet && afterStreet !== cleanedFull) {
    push(afterStreet, false);
    const streetPrefix = cleanedFull.slice(0, cleanedFull.length - afterStreet.length).replace(/[0-9一二三四五六七八九十]+号.*$/, '').trim();
    if (streetPrefix.length >= 2) push(streetPrefix, true);
  }

  // 4. 去掉子建筑/子设施后缀取父级主地标（如“天津西站老站房”→“天津西站”、“故宫珍宝馆”→“故宫”、“黄鹤楼公园主楼”→“黄鹤楼公园”）
  const withoutSubFacility = cleanedFull.replace(SUB_FACILITY_SUFFIX_RE, '').trim();
  if (withoutSubFacility && withoutSubFacility !== cleanedFull) {
    push(withoutSubFacility, true);
  }

  // 5. 提取长句中嵌入的标准中文地标锚点（如“天津站前广场世纪钟”→“天津站”“世纪钟”，“蛇山西山坡黄鹤楼公园主楼”→“黄鹤楼公园”“黄鹤楼”）
  const anchors = [
    ...(cleanedFull.match(LANDMARK_ANCHOR_RE) ?? []),
    ...(cleanedFull.match(SHORT_LANDMARK_RE) ?? []),
  ];
  for (const anchor of anchors) {
    if (anchor !== cleanedFull) {
      push(anchor, true);
      const strippedAnchor = anchor.replace(SUB_FACILITY_SUFFIX_RE, '').trim();
      if (strippedAnchor && strippedAnchor !== anchor) push(strippedAnchor, true);
      const withoutPark = anchor.replace(/(?:公园|景区|风景区)$/, '').trim();
      if (withoutPark.length >= 2 && withoutPark !== anchor) push(withoutPark, true);
    }
  }

  // 6. 短方位火车站补全城市名（如“西站”→“天津西站”，避免单搜“西站”歧义）
  if (/^(?:东站|西站|南站|北站)$/.test(cleanedFull) && shortCity) {
    push(`${shortCity}${cleanedFull}`, false);
  }

  return results;
}

/** 没有具体店名的用餐按当天相邻地点所在片区标注，不能把它当作一家真实餐馆。 */
export function isGeneralMealLocation(name: string): boolean {
  // “火锅”是泛称，“火锅英雄”“美食林餐厅”等有具体名称，应直接查询。
  return /^(?:(?:在|附近|周边|就近|当地)\s*)*(?:吃.+|(?:用餐|就餐|午餐|晚餐|早餐|火锅|菌子火锅|餐饮|餐馆|餐厅|美食|小吃|休息)(?:$|[\s：:（(]))/.test(name.trim());
}
