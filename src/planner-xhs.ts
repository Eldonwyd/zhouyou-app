import type {
  PlannerMessageAttachment,
  WishlistPlace,
  XhsExtractedPlace,
  XhsPlaceKind,
  XhsReference,
  XhsReferenceMode,
} from './planner-types.ts';

export const MAX_XHS_REFERENCES = 6;
export const DEFAULT_XHS_REFERENCE_MODE: XhsReferenceMode = 'blend';

export const XHS_PLACE_KIND_LABELS: Record<XhsPlaceKind, string> = {
  sight: '景点',
  food: '美食',
  lodging: '住宿片区',
  photo_spot: '打卡机位',
  other: '其他',
};

export const XHS_REFERENCE_MODE_OPTIONS: Array<{
  value: XhsReferenceMode;
  label: string;
  description: string;
}> = [
  {
    value: DEFAULT_XHS_REFERENCE_MODE,
    label: '综合参考（推荐）',
    description: '综合多篇的景点、路线和贴士，按实际日期、顺路程度与同行需求灵活取舍',
  },
  {
    value: 'reorder',
    label: '顺路重排',
    description: '保留勾选的必去景点与美食，按地图顺路度、天数和同行人群重新编排',
  },
  {
    value: 'follow',
    label: '尽量复刻原帖',
    description: '尽量沿用原帖的先后顺序与路线骨架，结合出行日期补全交通、票价和提醒',
  },
  {
    value: 'inspire',
    label: '仅作风格灵感',
    description: '吸收原帖玩法调性与避坑建议，允许 AI 结合季节天气增删或替换地点',
  },
];

const PLACE_KEY = (city: string, name: string) =>
  `${city.replace(/(?:市|自治州|地区)$/, '').trim().toLowerCase()}::${name.replace(/\s+/g, '').toLowerCase()}`;

/** 只生成小红书自己的搜索链接，关键词由 URLSearchParams 统一编码。 */
export function xiaohongshuSearchUrl(keyword: string): string {
  const query = new URLSearchParams({ keyword, source: 'web_explore_feed' });
  return `https://www.xiaohongshu.com/search_result?${query}`;
}

/** 按粘贴顺序提取并去重，兼容整段分享文案及被转义的 `https\://`。 */
export function extractXhsUrlsFromText(text: string): string[] {
  const matches = String(text ?? '').matchAll(/(https?)\\?:\/\/((?:(?:[a-z0-9-]+\.)?(?:xhslink\.com|xiaohongshu\.com)|xhslink\.cn)\/[^\s"'<>\\)\]，。！？、；）】]+)/gi);
  return [...new Set(Array.from(matches, ([, protocol, destination]) =>
    `${protocol.toLowerCase()}://${destination.replace(/[.,;:!?]+$/, '')}`,
  ))];
}

/** 单篇导入沿用第一条链接；新建计划可以逐篇读取。 */
export function extractXhsUrlFromText(text: string): string | null {
  return extractXhsUrlsFromText(text)[0] ?? null;
}

/** 去除预览专用字段，确保写入本地计划与备份时数据精简且无图片残留。 */
export function compactXhsReference(ref: XhsReference): XhsReference {
  return {
    id: ref.id,
    sourceType: ref.sourceType,
    title: ref.title,
    ...(ref.author ? { author: ref.author } : {}),
    ...(ref.url ? { url: ref.url } : {}),
    ...(ref.publishedAt ? { publishedAt: ref.publishedAt } : {}),
    destinations: [...ref.destinations],
    suggestedDays: ref.suggestedDays,
    styleTags: [...ref.styleTags],
    routeOutline: [...ref.routeOutline],
    tips: [...ref.tips],
    places: ref.places.map((place) => ({ ...place })),
  };
}

/** 将新解析的小红书参考包合并进列表：跨多篇笔记时自动为重复地点取消重复默认勾选，不丢原帖来源。 */
export function mergeXhsReferences(existing: XhsReference[], incoming: XhsReference): XhsReference[] {
  const seen = new Set<string>();
  for (const ref of existing) {
    for (const place of ref.places) {
      if (place.selected) seen.add(PLACE_KEY(place.city, place.canonicalName || place.name));
    }
  }
  const dedupedIncoming: XhsReference = {
    ...incoming,
    places: incoming.places.map((place) => {
      const key = PLACE_KEY(place.city, place.canonicalName || place.name);
      if (seen.has(key)) return { ...place, selected: false };
      if (place.selected) seen.add(key);
      return { ...place };
    }),
  };
  return [...existing, dedupedIncoming];
}

/** 将已勾选点位转换为行程内「待选灵感池」并自动去重。 */
export function referencesToWishlist(
  refs: XhsReference[],
  existing: WishlistPlace[] = [],
  nowIso = new Date().toISOString(),
): { next: WishlistPlace[]; addedCount: number } {
  const seen = new Set(existing.map((item) => PLACE_KEY(item.city, item.canonicalName || item.name)));
  const added: WishlistPlace[] = [];
  for (const ref of refs) {
    for (const place of ref.places) {
      if (!place.selected) continue;
      const canonical = (place.canonicalName || place.name).trim();
      if (!canonical) continue;
      const key = PLACE_KEY(place.city, canonical);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({
        id: `wish-${place.id}`,
        name: place.name.trim() || canonical,
        canonicalName: canonical,
        city: place.city.trim(),
        kind: place.kind,
        note: place.note.trim(),
        ...(ref.title ? { sourceTitle: ref.title } : {}),
        ...(ref.url ? { sourceUrl: ref.url } : {}),
        addedAt: nowIso,
      });
    }
  }
  return { next: [...existing, ...added], addedCount: added.length };
}

/** 生成用于“把勾选景点加入现有行程”的明确指令或提问。 */
export function buildXhsInsertPrompt(
  places: Array<Pick<XhsExtractedPlace | WishlistPlace, 'name' | 'canonicalName' | 'city' | 'kind' | 'note'>>,
  options: {
    targetDate: string | 'auto';
    mode: 'insert' | 'replace';
    replaceActivityTitle?: string;
    askFirst?: boolean;
  },
): string {
  const listText = places
    .map((p) => {
      const kind = XHS_PLACE_KIND_LABELS[p.kind] || '地点';
      const label = [p.city, p.name].filter(Boolean).join('·');
      return `「${label}」（${kind}${p.note ? `，笔记要点：${p.note}` : ''}）`;
    })
    .join('、');
  const dayText = options.targetDate === 'auto' ? '最顺路、最合适的一天' : `${options.targetDate}`;
  if (options.askFirst) {
    if (options.mode === 'replace' && options.replaceActivityTitle) {
      return `我想参考小红书把${listText}用来替换 ${dayText} 的「${options.replaceActivityTitle}」，这样改怎么样？对顺路度、时间和费用有什么影响？先给我具体方案不要直接修改。`;
    }
    return `我想把小红书种草的${listText}加入行程（倾向放在${dayText}），帮我评估顺路度、时间负荷和是否与锁定项冲突，给出可实施的方案（比如顺路插入或替换某个未锁定活动），先不要直接修改。`;
  }
  if (options.mode === 'replace' && options.replaceActivityTitle) {
    return `请把 ${dayText} 的「${options.replaceActivityTitle}」替换为小红书推荐的${listText}，同步更新相邻交通衔接、时间安排和费用明细，保留所有已锁定卡片。`;
  }
  return `请将小红书推荐的${listText}顺路加入到 ${dayText} 的行程中，合理调整当天未锁定活动的时间与交通衔接、补全预算与预约提醒，不改动已锁定卡片。`;
}

/** 生成轻量对话附件摘要（不含截图，保证消息存储与备份精简）。 */
export function summarizeXhsForMessage(refs: XhsReference[]): PlannerMessageAttachment[] {
  return refs.map((ref) => ({
    title: ref.title || '小红书参考笔记',
    ...(ref.url ? { url: ref.url } : {}),
    sourceType: ref.sourceType,
    placeNames: ref.places
      .filter((p) => p.selected)
      .map((p) => p.name || p.canonicalName)
      .filter(Boolean)
      .slice(0, 12),
  }));
}

/** 统计参考包列表中所有被勾选的地点。 */
export function selectedPlacesFromRefs(refs: XhsReference[]): XhsExtractedPlace[] {
  return refs.flatMap((ref) => ref.places.filter((place) => place.selected));
}
