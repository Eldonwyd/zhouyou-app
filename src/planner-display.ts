import { isSelfDriveTransport, plannerActivitiesByTime, plannerDurationLabel, plannerDurationMinutes } from './planner-domain.ts';
import type {
  AiTravelPlan,
  PlannerActivity,
  PlannerContent,
  PlannerRequest,
  PlannerTransferModeKind,
  PlannerTransferOption,
} from './planner-types';

const routeDistanceNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
const yuanNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });

/** 将前后活动编号还原为站点名；总耗时直接使用交通卡在时间轴上的排程。 */
export function plannerTransferDisplay(activity: PlannerActivity, activitiesById: ReadonlyMap<string, PlannerActivity>) {
  if (activity.kind !== 'transport' || (activity.distanceKm === undefined && !activity.fromActivityId && !activity.toActivityId)) return null;
  const from = activity.fromActivityId ? activitiesById.get(activity.fromActivityId) : undefined;
  const to = activity.toActivityId ? activitiesById.get(activity.toActivityId) : undefined;
  const route = from && to ? `${from.photoQuery || from.title} → ${to.photoQuery || to.title}` : '';
  const fromCity = from?.city.trim().replace(/市$/, '');
  const toCity = to?.city.trim().replace(/市$/, '');
  const km = activity.distanceKm;
  const distance = km === undefined ? '' : km === null ? '距离待确认' : km < 1
    ? `约 ${routeDistanceNumber.format(Math.round(km * 1000))} 米`
    : `约 ${routeDistanceNumber.format(km)} 公里`;
  return {
    route,
    sameCity: Boolean(fromCity && fromCity === toCity),
    details: [activity.transportMode.trim(), distance, `预计 ${plannerDurationLabel(activity.startTime, activity.endTime)}`].filter(Boolean).join(' · '),
  };
}

const MODE_LABELS: Record<PlannerTransferModeKind, string> = {
  walk: '步行',
  subway: '地铁',
  bus: '公交',
  taxi: '打车',
  drive: '开车',
  train: '火车',
  flight: '飞机',
  other: '交通',
};

const INTRA_CITY_MODES = new Set<PlannerTransferModeKind>(['walk', 'subway', 'bus', 'taxi', 'drive']);

/** 首次显示时按市内出行的时间成本排序，已有手动选择时直接沿用其下标。 */
export function plannerTransferSelection(
  options: readonly PlannerTransferOption[],
  people: number,
  selectedIndex?: number,
) {
  const recommendedIndex = plannerRecommendedTransferIndex(options, people);
  const hasSavedChoice = selectedIndex !== undefined && Number.isInteger(selectedIndex) && Boolean(options[selectedIndex]);
  return { recommendedIndex, chosenIndex: hasSavedChoice ? selectedIndex : recommendedIndex };
}

function plannerRecommendedTransferIndex(options: readonly PlannerTransferOption[], people: number): number {
  if (!options.length) return -1;
  const markedIndex = options.findIndex((option) => option.recommended);
  const fallbackIndex = Math.max(0, markedIndex);
  if (options.length === 1 || options.some((option) => !INTRA_CITY_MODES.has(option.mode))) return fallbackIndex;

  const partySize = Number.isFinite(people) ? Math.max(1, Math.floor(people)) : 1;
  const shortestDistance = options.reduce((shortest, { distanceKm }) =>
    distanceKm != null && distanceKm > 0 ? Math.min(shortest, distanceKm) : shortest, Infinity);
  // 以分钟为单位综合比较：每人每元折合 2 分钟，步行超过 500 米后每公里加 5 分钟，已知路线每绕行 1 公里加 1 分钟。
  // 出租车按每车 4 位乘客估算，避免大团按一辆车分摊。有缺失票价时给中等权重，避免视同免费。
  let bestIndex = fallbackIndex;
  let bestScore = Infinity;
  options.forEach((option, index) => {
    const distance = option.distanceKm != null && Number.isFinite(option.distanceKm) && option.distanceKm > 0
      ? option.distanceKm : null;
    const minutes = option.durationMinutes != null && Number.isFinite(option.durationMinutes) && option.durationMinutes > 0
      ? option.durationMinutes : null;
    // 缺少步行里程或耗时时，按约 4.5 公里/小时由另一项补估；其他方式只比较有耗时的选项。
    const walking = option.mode === 'walk';
    const duration = minutes ?? (walking && distance !== null ? distance * 60 / 4.5 : null);
    if (duration === null) return;
    const walkingKm = walking ? (distance ?? duration * 4.5 / 60) : 0;
    const perVehicle = (option.costUnit ?? (option.mode === 'taxi' || option.mode === 'drive' ? 'vehicle' : 'person')) === 'vehicle';
    const unitsPerPerson = perVehicle ? (option.mode === 'taxi' ? Math.ceil(partySize / 4) : 1) / partySize : 1;
    const fareMinutes = walking ? 0 : option.costCents != null && Number.isFinite(option.costCents) && option.costCents >= 0
      ? option.costCents / 100 * unitsPerPerson * 2 : 5;
    const detourKm = distance === null ? 0 : distance - shortestDistance;
    const score = duration + Math.max(0, walkingKm - 0.5) * 5 + detourKm + fareMinutes;
    if (score < bestScore || (score === bestScore && index === fallbackIndex)) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

export function detectTransferModes(text: string): PlannerTransferModeKind[] {
  const raw = String(text ?? '');
  const modes: PlannerTransferModeKind[] = [];
  const push = (mode: PlannerTransferModeKind) => {
    if (!modes.includes(mode)) modes.push(mode);
  };
  if (/飞机|航班|航空|机场大巴/.test(raw) && !/机场大巴/.test(raw)) push('flight');
  if (/高铁|动车|城际|铁路|火车/.test(raw)) push('train');
  if (/自驾|开车|驾车|租车/.test(raw)) push('drive');
  if (/地铁|轻轨|轨交|城轨|有轨电车|\d+\s*号线/.test(raw)) push('subway');
  if (/公交|巴士|大巴|专线|电车|轮渡|摆渡/.test(raw)) push('bus');
  if (/打车|网约车|出租车|滴滴|快车|专车|拼车|包车/.test(raw)) push('taxi');
  if (/步行|走路|徒步|散步/.test(raw)) push('walk');
  return modes.length ? modes : ['other'];
}

export function formatTransferDistance(distanceKm: number | null | undefined, mode?: PlannerTransferModeKind): string {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return '';
  if (distanceKm < 1 || (mode === 'walk' && distanceKm < 2)) {
    return `约 ${routeDistanceNumber.format(Math.round(distanceKm * 1000))} 米`;
  }
  return `约 ${routeDistanceNumber.format(distanceKm)} 公里`;
}

export function formatTransferMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  const label = `${hours ? `${hours} 小时` : ''}${remainder ? `${hours ? ' ' : ''}${remainder} 分钟` : ''}`.trim();
  return `预计 ${label}`;
}

export function formatTransferPrice(costCents: number | null | undefined, unit?: 'person' | 'vehicle'): string {
  if (costCents == null || !Number.isFinite(costCents) || costCents <= 0) return '';
  const yuan = yuanNumber.format(costCents / 100);
  return unit === 'person' ? `约 ¥${yuan}/人` : `预计 ¥${yuan}`;
}

function extractStationsFromText(text: string): { fromStation?: string; toStation?: string; transferNote?: string } {
  const raw = String(text ?? '').trim();
  if (!raw) return {};
  const board = raw.match(/([\u4e00-\u9fffA-Za-z0-9]+站)上车[，,、\s]*(?:(?:在|于)?([\u4e00-\u9fffA-Za-z0-9]+站换乘[^，,。；;]*)[，,、\s]*)?(?:至|到)?([\u4e00-\u9fffA-Za-z0-9]+站)下车/);
  if (board) {
    return {
      fromStation: board[1],
      toStation: board[3],
      ...(board[2] ? { transferNote: board[2] } : {}),
    };
  }
  const arrow = raw.match(/([\u4e00-\u9fffA-Za-z0-9]+站)\s*(?:→|->|—|至|到)\s*([\u4e00-\u9fffA-Za-z0-9]+站)/);
  if (arrow) return { fromStation: arrow[1], toStation: arrow[2] };
  return {};
}

/** 为交通卡生成结构化展示选项：优先使用 transferOptions，旧计划自动从已有字段推断。 */
export function plannerTransferOptions(
  activity: PlannerActivity,
  request?: Pick<PlannerRequest, 'transport'>,
): PlannerTransferOption[] {
  if (activity.kind !== 'transport') return [];
  const selfDrive = isSelfDriveTransport(request?.transport);
  const fallbackMinutes = plannerDurationMinutes(activity.startTime, activity.endTime) || null;
  const primaryCost = activity.costs.find((cost) => !cost.includedIn && cost.unitPriceCents != null && cost.status !== 'unknown');

  if (activity.transferOptions?.length) {
    const cloned = activity.transferOptions.map((option) => ({ ...option }));
    const hasCrossCity = cloned.some((option) => option.mode === 'train' || option.mode === 'flight');
    if (selfDrive && !hasCrossCity) {
      const drives = cloned.filter((option) => option.mode === 'drive');
      if (drives.length) {
        return drives.map((option, index) => ({
          mode: 'drive' as const,
          recommended: index === 0,
          distanceKm: option.distanceKm ?? activity.distanceKm ?? null,
          durationMinutes: option.durationMinutes ?? fallbackMinutes,
          ...(option.transferNote ? { transferNote: option.transferNote } : {}),
        }));
      }
      const primary = cloned.find((option) => option.recommended) ?? cloned[0];
      return [{
        mode: 'drive',
        recommended: true,
        distanceKm: primary.distanceKm ?? activity.distanceKm ?? null,
        durationMinutes: primary.durationMinutes ?? fallbackMinutes,
      }];
    }
    const recommendedIndex = cloned.findIndex((option) => option.recommended);
    const fillIndex = recommendedIndex >= 0 ? recommendedIndex : 0;
    if (cloned[fillIndex]) {
      if (cloned[fillIndex].durationMinutes == null && fallbackMinutes) cloned[fillIndex].durationMinutes = fallbackMinutes;
      if (cloned[fillIndex].distanceKm == null && activity.distanceKm != null) cloned[fillIndex].distanceKm = activity.distanceKm;
      if (cloned[fillIndex].costCents == null && primaryCost && cloned[fillIndex].mode !== 'walk' && cloned[fillIndex].mode !== 'drive') {
        cloned[fillIndex].costCents = primaryCost.unitPriceCents;
        cloned[fillIndex].costUnit ??= primaryCost.unit === 'person' || primaryCost.unit === 'ticket' ? 'person' : 'vehicle';
      }
    }
    return cloned;
  }

  // 兼容旧计划：从 transportMode、distanceKm、排程时长、description 与 costs 推导。
  const detected = detectTransferModes(`${activity.transportMode} ${activity.title}`);
  const mode = selfDrive && !detected.includes('train') && !detected.includes('flight') ? 'drive' : detected[0];
  if (mode === 'drive') {
    return [{
      mode: 'drive',
      recommended: true,
      distanceKm: activity.distanceKm ?? null,
      durationMinutes: fallbackMinutes,
    }];
  }
  const stations = mode === 'subway' || mode === 'bus' ? extractStationsFromText(activity.description) : {};
  const costUnit = primaryCost
    ? (primaryCost.unit === 'person' || primaryCost.unit === 'ticket' ? 'person' : 'vehicle')
    : (mode === 'subway' || mode === 'bus' || mode === 'train' || mode === 'flight' ? 'person' : 'vehicle');
  return [{
    mode,
    recommended: true,
    line: activity.transportMode.trim() || MODE_LABELS[mode],
    ...stations,
    distanceKm: activity.distanceKm ?? null,
    durationMinutes: fallbackMinutes,
    costCents: mode === 'walk' ? null : (primaryCost?.unitPriceCents ?? null),
    costUnit,
  }];
}

export interface FormattedTransferOption {
  mode: PlannerTransferModeKind;
  recommended: boolean;
  title: string;
  stations: string;
  metrics: string[];
  carpool: string;
  note: string;
  summaryText: string;
}

/** 按交通方式格式化成清晰易读的标签与指标，自驾仅展示公里与分钟，较远打车可附顺风车。 */
export function formatTransferOption(option: PlannerTransferOption): FormattedTransferOption {
  const mode = option.mode;
  const dist = formatTransferDistance(option.distanceKm, mode);
  const time = formatTransferMinutes(option.durationMinutes);
  const unit = option.costUnit ?? (mode === 'subway' || mode === 'bus' || mode === 'train' || mode === 'flight' ? 'person' : 'vehicle');
  const price = mode === 'walk' || mode === 'drive' ? '' : formatTransferPrice(option.costCents, unit);
  const stations = option.fromStation && option.toStation
    ? `${option.fromStation} → ${option.toStation}`
    : (option.fromStation || option.toStation || '');
  const carpool = mode === 'taxi' && option.carpoolCostCents != null && option.carpoolCostCents > 0
    ? `顺风车约 ¥${yuanNumber.format(option.carpoolCostCents / 100)}`
    : '';
  const noteParts = [option.transferNote?.trim(), mode === 'taxi' ? option.carpoolNote?.trim() : ''].filter(Boolean);
  const note = noteParts.join(' · ');

  let title = option.line?.trim() || MODE_LABELS[mode];
  let metrics: string[];
  if (mode === 'drive') {
    title = '自驾开车';
    metrics = [dist, time].filter(Boolean);
  } else if (mode === 'walk') {
    title = '步行';
    metrics = [dist, time].filter(Boolean);
  } else if (mode === 'taxi') {
    title = option.line?.trim() && !/^打车$/.test(option.line.trim()) ? option.line.trim() : '打车';
    metrics = [time, dist, price].filter(Boolean);
  } else if (mode === 'subway' || mode === 'bus') {
    metrics = [time, price, !stations ? dist : ''].filter(Boolean);
  } else {
    metrics = [dist, time, price].filter(Boolean);
  }

  const summaryText = [title, stations, ...metrics, carpool, note].filter(Boolean).join(' · ');
  return {
    mode,
    recommended: Boolean(option.recommended),
    title,
    stations,
    metrics,
    carpool,
    note,
    summaryText,
  };
}

/** 判断交通卡是否属于当天市内接驳（使用两张卡片之间的紧凑交通条展示）。 */
export function isIntraCityTransferCard(
  activity: PlannerActivity,
  activitiesById: ReadonlyMap<string, PlannerActivity>,
  dayActivities: readonly PlannerActivity[],
): boolean {
  if (activity.kind !== 'transport') return false;
  const transfer = plannerTransferDisplay(activity, activitiesById);
  if (transfer?.sameCity
    && dayActivities.some((item) => item.id === activity.fromActivityId)
    && dayActivities.some((item) => item.id === activity.toActivityId)) {
    return true;
  }
  if (activity.transferOptions?.length) {
    return activity.transferOptions.every((option) => INTRA_CITY_MODES.has(option.mode));
  }
  return false;
}

export interface GapTransferInfo {
  key: string;
  modes: PlannerTransferModeKind[];
  label: string;
  routeLabel: string;
  isSelfDrive: boolean;
  hasHint: boolean;
}

const NEARBY_MEAL_PATTERN = /(?:原安排地点附近|附近用餐|附近就餐|周边用餐|景区内|步行可达)/;

const placeKeyPart = (value: PlannerActivity) =>
  `${value.city}|${value.photoQuery || value.location || value.title}`.replace(/[\s·，,。()（）]/g, '').slice(0, 60);

/** 两站之间交通缓存键：包含出行模式（自驾/公共交通）与起止点位置，改地点或切换自驾后自动重算。 */
export function plannerLegTransferKey(
  prev: PlannerActivity,
  next: PlannerActivity,
  request?: Pick<PlannerRequest, 'transport'>,
): string {
  const modeScope = isSelfDriveTransport(request?.transport) ? 'drive' : 'public2';
  return `${modeScope}:${prev.id}->${next.id}:${placeKeyPart(prev)}->${placeKeyPart(next)}`;
}

/** 旧计划已有 transport 卡但缺少 transferOptions 时的缓存键。 */
export function plannerTransportActivityKey(
  activity: PlannerActivity,
  request?: Pick<PlannerRequest, 'transport'>,
): string {
  const modeScope = isSelfDriveTransport(request?.transport) ? 'drive' : 'public2';
  return `${modeScope}:act:${activity.id}:${placeKeyPart(activity)}:${activity.transportMode.trim()}`;
}

/** 判断同一天两张相邻非交通卡之间是否需要展示交通连接。 */
export function plannerGapTransfer(
  prev: PlannerActivity | undefined,
  next: PlannerActivity,
  request?: Pick<PlannerRequest, 'transport'>,
): GapTransferInfo | null {
  if (!prev || prev.kind === 'transport' || next.kind === 'transport') return null;
  const rawMode = next.transportMode.trim();
  if (placeKeyPart(prev) === placeKeyPart(next) && !rawMode) return null;
  if (!rawMode) {
    if (prev.kind === 'rest' || next.kind === 'rest') return null;
    if (next.kind === 'food' && NEARBY_MEAL_PATTERN.test(`${next.location} ${next.description}`)) return null;
  }
  const selfDrive = isSelfDriveTransport(request?.transport);
  const modes = selfDrive
    ? (['drive'] as PlannerTransferModeKind[])
    : rawMode
      ? detectTransferModes(rawMode)
      : (['subway'] as PlannerTransferModeKind[]);
  const label = selfDrive
    ? '自驾前往'
    : rawMode || '两站交通';
  const fromName = prev.photoQuery || prev.title;
  const toName = next.photoQuery || next.title;
  return {
    key: plannerLegTransferKey(prev, next, request),
    modes,
    label,
    routeLabel: `${fromName} → ${toName}`,
    isSelfDrive: selfDrive,
    hasHint: Boolean(rawMode) || selfDrive,
  };
}

export interface MissingLegTransferRequest {
  key: string;
  city: string;
  fromName: string;
  fromLocation: string;
  toName: string;
  toLocation: string;
  hint: string;
}

/** 扫描行程中所有缺少结构化交通明细的同日路段（含未生成交通卡的缝隙、以及旧交通卡），供后台自动查询。 */
export function collectMissingLegTransfers(plan: AiTravelPlan): MissingLegTransferRequest[] {
  const saved = plan.legTransfers ?? {};
  const request = plan.content.request;
  const bookings = new Map((plan.bookings ?? []).map((item) => [item.id, item] as const));
  const isBookedTransport = (activity: PlannerActivity) => {
    const booking = activity.bookingId ? bookings.get(activity.bookingId) : undefined;
    return Boolean(booking && (booking.kind === 'train' || booking.kind === 'flight'));
  };
  const activitiesById = new Map(
    plan.content.days.flatMap((day) => day.activities.map((activity) => [activity.id, activity] as const)),
  );
  const missing: MissingLegTransferRequest[] = [];
  const seen = new Set<string>();

  for (const day of plan.content.days) {
    const ordered = plannerActivitiesByTime(day.activities);
    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      const prev = i > 0 ? ordered[i - 1] : undefined;
      if (isBookedTransport(current)) continue;

      if (current.kind === 'transport') {
        if (current.transferOptions?.length) continue;
        if (!isIntraCityTransferCard(current, activitiesById, day.activities)) continue;
        const key = plannerTransportActivityKey(current, request);
        if (saved[key]?.length || seen.has(key)) continue;
        const from = current.fromActivityId ? activitiesById.get(current.fromActivityId) : prev;
        const to = current.toActivityId ? activitiesById.get(current.toActivityId) : ordered[i + 1];
        if (!from || !to) continue;
        seen.add(key);
        missing.push({
          key,
          city: current.city || from.city || to.city,
          fromName: from.photoQuery || from.title,
          fromLocation: from.location || from.title,
          toName: to.photoQuery || to.title,
          toLocation: to.location || to.title,
          hint: [current.transportMode, current.description].filter(Boolean).join('；'),
        });
        continue;
      }

      if (!prev || isBookedTransport(prev)) continue;
      const gap = plannerGapTransfer(prev, current, request);
      if (!gap || saved[gap.key]?.length || seen.has(gap.key)) continue;
      seen.add(gap.key);
      missing.push({
        key: gap.key,
        city: current.city || prev.city,
        fromName: prev.photoQuery || prev.title,
        fromLocation: prev.location || prev.title,
        toName: current.photoQuery || current.title,
        toLocation: current.location || current.title,
        hint: current.transportMode.trim(),
      });
    }
  }
  return missing;
}

/** 只清理展示文本，不修改持久化的关联编号。URL 单独保留，避免损坏来源链接。 */
export function plannerDisplayText(text: string, content?: PlannerContent): string {
  const names = new Map<string, string>();
  if (content) {
    for (const source of content.sources) names.set(source.id, source.title);
    for (const day of content.days) {
      for (const activity of day.activities) {
        names.set(activity.id, `${day.date} ${activity.title}`);
        for (const cost of activity.costs) names.set(cost.id, cost.label);
      }
      for (const cost of day.lodging?.costs ?? []) names.set(cost.id, cost.label);
    }
  }
  const categories: Record<string, string> = {
    transport: '交通', ransport: '交通', lodging: '住宿', tickets: '门票', food: '餐饮', other: '其他',
  };
  // 使用完整 token 替换，不能把正常中文地名中的相似片段删除。
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const known = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const knownPattern = known.length ? new RegExp(`(?<![\\w-])(?:${known.map(escape).join('|')})(?![\\w-])`, 'g') : null;
  return String(text ?? '').split(/(https?:\/\/[^\s<>]+)/g).map((part) => {
    if (/^https?:\/\//.test(part)) return part;
    let clean = knownPattern ? part.replace(knownPattern, (id) => names.get(id) ?? '') : part;
    clean = clean.replace(/\bs-[a-f\d]{6,}(?:-[a-z\d]+)*\b/gi, '参考资料');
    clean = clean.replace(/\b[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\b/gi, '相关项目');
    clean = clean.replace(/\b(?:lodging|transport|activity|sight|cost|food|rest|ticket)-[a-z\d]+(?:-[a-z\d]+)*\b/gi, (id) => id.startsWith('lodging') ? '住宿费用' : '相关项目');
    return clean.replace(/\b(transport|ransport|lodging|tickets|food|other)\b/gi, (value) => categories[value.toLowerCase()]);
  }).join('');
}

export interface PlannerAnswerLink { title: string; url: string; host: string }

/** 纯文字导出只保留阅读内容，去掉网址和引用标记；不影响页面里的资料来源。 */
export function plannerExportText(text: string, content: PlannerContent): string {
  let clean = text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s<>）)\]】]+/g, '')
    .replace(/\uE200[^\uE201]*\uE201/g, '')
    .replace(/\[\d+(?:\s*[,，、-]\s*\d+)*\]/g, '');
  // 来源编号在展示函数中会展开为长标题，导出前先移除这些引用。
  for (const source of content.sources) {
    if (!source.id) continue;
    const escaped = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'), '');
  }
  return plannerDisplayText(clean, content)
    .replace(/\[\s*\]|【\s*】|\(\s*\)|（\s*）/g, '')
    .replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 把回答拆成正文与“相关链接”：末尾“相关链接：标题 url；标题 url”一段和正文里夹带的网址
 * 都提取为单独的可点击链接，正文中不再显示裸网址。只接受 http(s) 地址，按网址去重。
 */
export function splitAnswerLinks(text: string): { body: string; links: PlannerAnswerLink[] } {
  const urlPattern = /https?:\/\/[^\s，。；;、）)\]】"'<>]+/g;
  const links: PlannerAnswerLink[] = [];
  const add = (rawUrl: string, rawTitle: string) => {
    const url = rawUrl.replace(/[.,:：，。]+$/, '');
    let host = '';
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      host = parsed.hostname.replace(/^www\./, '');
    } catch { return; }
    if (links.some((link) => link.url === url)) return;
    const title = rawTitle.replace(/^[\s:：、，,；;。.\-—]+|[\s:：、，,；;。.\-—（(]+$/g, '').trim();
    links.push({ title: title || host, url, host });
  };
  const marker = text.search(/相关链接\s*[:：]/);
  let body = marker >= 0 ? text.slice(0, marker) : text;
  if (marker >= 0) {
    const section = text.slice(marker).replace(/^相关链接\s*[:：]/, '');
    for (const segment of section.split(/[；;\n]/)) {
      const urls = segment.match(urlPattern) ?? [];
      for (const url of urls) add(url, segment.replace(urlPattern, ''));
    }
  }
  // 正文里夹带的网址：取紧挨着的前文（到上一个标点）作为标题，并从正文删除网址。
  body = body.replace(/([^，。；;：:\n（(]{0,24})[（(]?\s*(https?:\/\/[^\s，。；;、）)\]】"'<>]+)\s*[）)]?/g, (_all, before: string, url: string) => {
    add(url, before);
    return before;
  });
  return { body: body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), links };
}
