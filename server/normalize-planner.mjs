import { freshPlannerRequest, isPublicWebUrl, isSelfDriveTransport, plannerFillEstimates, plannerLocalTransport, plannerPartyText, updatePlannerDates } from '../src/planner-domain.ts';
import { MAX_XHS_REFERENCES, XHS_REFERENCE_MODE_OPTIONS } from '../src/planner-xhs.ts';

const CATEGORY_NAMES = {
  transport: ['transport', 'transportation', 'traffic', '交通', '交通费'],
  lodging: ['lodging', 'hotel', 'accommodation', '住宿', '住宿费'],
  tickets: ['tickets', 'ticket', 'entrance', '门票', '门票费'],
  food: ['food', 'meal', 'meals', 'dining', '餐饮', '美食', '餐费'],
  other: ['other', 'others', 'misc', '其他'],
};
const UNIT_NAMES = {
  ticket: ['ticket', 'tickets', 'per_ticket', '门票', '票'],
  person: ['person', 'people', 'per_person', 'perperson', '人', '每人', '元/人'],
  room: ['room', 'rooms', 'per_room', 'room_night', '间', '每间', '每晚', '间夜'],
  vehicle: ['vehicle', 'car', 'per_vehicle', 'per_car', '辆', '每辆', '车'],
  group: ['group', 'order', 'total', 'flat', 'trip', '整单', '次', '一共'],
};
const text = (value, fallback = '') =>
  value == null ? fallback : typeof value === 'string' ? value : JSON.stringify(value);
const positiveInteger = (value, fallback) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};
function alias(value, dictionary, fallback) {
  const name = text(value).trim().toLowerCase();
  return Object.entries(dictionary).find(([, names]) => names.includes(name))?.[0] ?? fallback;
}

const KIND_NAMES = {
  sight: ['sight', 'sightseeing', 'attraction', 'scenic', 'activity', 'experience', '景点', '游览', '体验', '活动'],
  food: ['food', 'meal', 'dining', 'restaurant', '餐饮', '美食', '用餐', '吃饭'],
  transport: ['transport', 'transportation', 'traffic', 'transfer', '交通', '换乘', '出行'],
  rest: ['rest', 'free', 'break', 'hotel', '休息', '自由活动', '入住'],
};
const PERIOD_NAMES = {
  morning: ['morning', 'am', '早上', '上午', '清晨', '早晨'],
  noon: ['noon', 'midday', 'lunch', '中午', '午间'],
  afternoon: ['afternoon', 'pm', '下午', '午后'],
  evening: ['evening', 'night', '晚上', '傍晚', '夜间', '夜晚'],
};
const MEAL_NAMES = {
  breakfast: ['breakfast', '早餐', '早饭'],
  lunch: ['lunch', '午餐', '午饭'],
  dinner: ['dinner', 'supper', '晚餐', '晚饭'],
  snack: ['snack', '小吃', '夜宵', '下午茶'],
};
const PERIOD_START = { morning: 9 * 60, noon: 12 * 60, afternoon: 14 * 60, evening: 18 * 60 };

/** 把“8:00”“08:00:00”“8点半”“８：００”等写法读成分钟；读不出返回 null。 */
function minutesOf(value) {
  const raw = text(value).normalize('NFKC').replace(/：/g, ':').trim();
  const match = raw.match(/(\d{1,2})\s*(?::|点|时)\s*(半|\d{1,2})?/) ?? raw.match(/^(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === '半' ? 30 : Number(match[2] ?? 0);
  return hour <= 24 && minute < 60 ? Math.min(hour * 60 + minute, 23 * 60 + 59) : null;
}
const clock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const periodOf = (minutes) =>
  minutes < 11 * 60 ? 'morning' : minutes < 13 * 60 + 30 ? 'noon' : minutes < 17 * 60 + 30 ? 'afternoon' : 'evening';

/** AI 偶尔把距离输出为“约 800 米”或“2.5 km”；统一存为公里。 */
function normalizeDistanceKm(value) {
  const match = text(value).normalize('NFKC').trim().match(/^(?:大约|约为|约|≈|~)?\s*(\d+(?:\.\d+)?)\s*(公里|千米|km|米|m)?$/i);
  if (!match) return null;
  const distanceKm = Number(match[1]) / (/^(?:米|m)$/i.test(match[2] ?? '') ? 1000 : 1);
  return Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null;
}

const TRANSFER_MODE_NAMES = {
  walk: ['walk', 'walking', 'foot', '步行', '走路', '徒步'],
  subway: ['subway', 'metro', 'rail', '地铁', '轻轨', '轨交'],
  bus: ['bus', 'transit', '公交', '公交车', '巴士', '大巴'],
  taxi: ['taxi', 'cab', 'ride', 'ridehail', '打车', '网约车', '出租车', '快车', '滴滴'],
  drive: ['drive', 'driving', 'car', 'self_drive', 'selfdrive', '自驾', '开车', '驾车', '租车'],
  train: ['train', 'hsr', 'railway', '火车', '高铁', '动车', '城际'],
  flight: ['flight', 'plane', 'air', '飞机', '航班'],
  other: ['other', '其他', '交通'],
};

function normalizeTransferMode(value, line = '') {
  const direct = alias(value, TRANSFER_MODE_NAMES, null);
  if (direct) return direct;
  const combined = `${text(value)} ${text(line)}`;
  if (/飞机|航班/.test(combined)) return 'flight';
  if (/高铁|动车|火车|铁路/.test(combined)) return 'train';
  if (/自驾|开车|驾车|租车/.test(combined)) return 'drive';
  if (/地铁|轻轨|轨交|\d+\s*号线/.test(combined)) return 'subway';
  if (/公交|巴士|大巴|专线/.test(combined)) return 'bus';
  if (/打车|网约车|出租车|滴滴|快车/.test(combined)) return 'taxi';
  if (/步行|走路|徒步/.test(combined)) return 'walk';
  return 'other';
}

function normalizeDurationMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
  const raw = text(value).normalize('NFKC').trim();
  const hm = raw.match(/(?:约|预计)?\s*(\d+(?:\.\d+)?)\s*(?:小时|h)\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分|min|m))?/i);
  if (hm) {
    const mins = Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
    return Number.isFinite(mins) && mins > 0 ? mins : null;
  }
  const m = raw.match(/(?:约|预计)?\s*(\d+(?:\.\d+)?)\s*(?:分钟|分|min|m)?/i);
  if (!m) return null;
  const mins = Math.round(Number(m[1]));
  return Number.isFinite(mins) && mins > 0 ? mins : null;
}

function normalizeTransferCostCents(cents, yuan) {
  if (cents !== null && cents !== undefined && cents !== '') {
    if (typeof cents === 'string' && /元|¥|￥|CNY|RMB/i.test(cents)) {
      const value = Number(cents.replace(/元|¥|￥|CNY|RMB|,|约|预计|\/人|每人|每辆/gi, '').trim());
      return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
    }
    const value = Number(cents);
    return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
  }
  if (yuan !== null && yuan !== undefined && yuan !== '') {
    const value = Number(text(yuan).replace(/元|¥|￥|,|约|预计|\/人|每人|每辆/gi, '').trim());
    return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null;
  }
  return null;
}

export function normalizeTransferOptions(rawOptions, selfDrive = false) {
  if (!Array.isArray(rawOptions) || !rawOptions.length) return undefined;
  const cleaned = [];
  for (const item of rawOptions.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const line = text(item.line).trim();
    const mode = normalizeTransferMode(item.mode ?? item.type, line);
    const distanceKm = item.distanceKm != null
      ? normalizeDistanceKm(item.distanceKm)
      : item.distanceMeters != null && Number.isFinite(Number(item.distanceMeters)) && Number(item.distanceMeters) > 0
        ? Number(item.distanceMeters) / 1000
        : null;
    const durationMinutes = normalizeDurationMinutes(item.durationMinutes ?? item.minutes ?? item.duration);
    const costCents = mode === 'walk' || mode === 'drive'
      ? null
      : normalizeTransferCostCents(item.costCents, item.costYuan ?? item.priceYuan);
    const rawUnit = text(item.costUnit ?? item.unit).trim().toLowerCase();
    const costUnit = ['person', 'per_person', '人', '每人', '元/人'].includes(rawUnit)
      ? 'person'
      : ['vehicle', 'car', 'per_vehicle', '辆', '每辆', '车'].includes(rawUnit)
        ? 'vehicle'
        : (mode === 'subway' || mode === 'bus' || mode === 'train' || mode === 'flight' ? 'person' : 'vehicle');
    const fromStation = text(item.fromStation).trim();
    const toStation = text(item.toStation).trim();
    const transferNote = text(item.transferNote ?? item.note).trim();
    const carpoolCostCents = mode === 'taxi'
      ? normalizeTransferCostCents(item.carpoolCostCents, item.carpoolYuan ?? item.carpoolPriceYuan)
      : null;
    const carpoolNote = mode === 'taxi' ? text(item.carpoolNote).trim() : '';
    const option = {
      mode,
      ...(item.recommended === true ? { recommended: true } : {}),
      ...(line && mode !== 'drive' ? { line: line.slice(0, 80) } : {}),
      ...(fromStation && mode !== 'drive' && mode !== 'walk' ? { fromStation: fromStation.slice(0, 40) } : {}),
      ...(toStation && mode !== 'drive' && mode !== 'walk' ? { toStation: toStation.slice(0, 40) } : {}),
      ...(transferNote ? { transferNote: transferNote.slice(0, 100) } : {}),
      ...(durationMinutes !== null ? { durationMinutes } : {}),
      ...(distanceKm !== null ? { distanceKm } : {}),
      ...(costCents !== null ? { costCents, costUnit } : {}),
      ...(carpoolCostCents !== null && carpoolCostCents > 0 ? { carpoolCostCents } : {}),
      ...(carpoolNote ? { carpoolNote: carpoolNote.slice(0, 80) } : {}),
    };
    cleaned.push(option);
  }
  if (!cleaned.length) return undefined;
  const hasCrossCity = cleaned.some((option) => option.mode === 'train' || option.mode === 'flight');
  if (selfDrive && !hasCrossCity) {
    const drives = cleaned.filter((option) => option.mode === 'drive');
    if (drives.length) return [drives[0]];
  }
  return cleaned;
}

/** 修复 AI 活动里常见的小格式问题（时间写法、跨午夜、中文时段/类型、重复编号），
 * 让一处小错不再导致整份行程被判无效。不改动用户可见的标题与描述内容。
 */
function repairActivity(activity, dayIndex, index, usedIds, idMap, selfDrive = false) {
  const originalId = text(activity.id).trim();
  let id = originalId || `act-${dayIndex + 1}-${index + 1}`;
  while (usedIds.has(id)) id = `act-${dayIndex + 1}-${index + 1}-${usedIds.size}`;
  usedIds.add(id);
  if (originalId && !idMap.has(originalId)) idMap.set(originalId, id);
  activity.id = id;

  // 有些模型把“08:00-10:00”整段写在 startTime 或 time 字段里。
  const range = text(activity.startTime || activity.time).split(/\s*(?:-|–|—|~|～|至|到)\s*/);
  let start = minutesOf(range[0]);
  let end = minutesOf(activity.endTime) ?? minutesOf(range[1]);
  const period = alias(activity.period, PERIOD_NAMES, null);
  start ??= PERIOD_START[period ?? 'morning'];
  // 结束不晚于开始（含跨午夜写法）时按 1 小时补齐，最晚 23:59。
  if (end === null || end <= start) end = Math.min(start + 60, 23 * 60 + 59);
  if (end <= start) start = end - 1;
  activity.startTime = clock(start);
  activity.endTime = clock(end);
  activity.period = period ?? periodOf(start);

  activity.meal = alias(activity.meal, MEAL_NAMES, null);
  activity.kind = alias(activity.kind ?? activity.type, KIND_NAMES, activity.meal ? 'food' : 'sight');
  if (activity.kind !== 'transport') {
    delete activity.distanceKm;
    delete activity.transferOptions;
  } else {
    if (activity.distanceKm !== undefined) activity.distanceKm = normalizeDistanceKm(activity.distanceKm);
    if (activity.transferOptions !== undefined) {
      const normalizedOptions = normalizeTransferOptions(activity.transferOptions, selfDrive);
      if (normalizedOptions) activity.transferOptions = normalizedOptions;
      else delete activity.transferOptions;
    }
  }
  for (const key of ['title', 'city', 'location', 'description', 'transportMode'])
    activity[key] = text(activity[key]);
  if (!activity.title.trim()) activity.title = activity.location || '自由活动';
  if (activity.photoQuery !== undefined) activity.photoQuery = text(activity.photoQuery);
  activity.locked = activity.locked === true;
  const photo = activity.photo;
  activity.photo =
    photo && isPublicWebUrl(photo.url) && isPublicWebUrl(photo.sourceUrl) && typeof photo.attribution === 'string' &&
    (photo.assetId === undefined || /^[a-f\d]{64}$/.test(photo.assetId))
      ? photo
      : null;
}

const GROUP_TICKETS = [
  ['studentPriceCents', /学生/], ['seniorPriceCents', /老人|老年|长者|敬老/], ['childPriceCents', /儿童|小孩|未成年|少儿/],
];
/** 门票按人群计价时只能有一个费用项。AI 有时另建“学生票/老人票/儿童票”，
 * 预算会把它再乘以全部人数而重复计费：把价格并入同一活动的主门票并删除该项。
 */
function mergeGroupTickets(costs) {
  const groupOf = (cost) => cost.unit === 'ticket' && /票/.test(cost.label)
    ? GROUP_TICKETS.find(([, pattern]) => pattern.test(cost.label)) : null;
  const main = costs.find((cost) => cost.unit === 'ticket' && !groupOf(cost) && !cost.includedIn);
  if (!main) return costs;
  return costs.filter((cost) => {
    const group = groupOf(cost);
    if (!group || cost.includedIn) return true;
    const [field] = group;
    if (main[field] == null && cost.unitPriceCents != null) main[field] = cost.unitPriceCents;
    if (cost.qualification && !main.qualification.includes(cost.qualification))
      main.qualification = [main.qualification, cost.qualification].filter(Boolean).join('；');
    return false;
  });
}

/** User prose is preserved, including non-numeric party descriptions. Structured
 * amounts are only the AI's interpretation for the budget, never input rules.
 * Old saved requests may contain journey departure/return fields; omit those
 * from new prompts without modifying the original saved plan.
 */
export function preparePlannerInput(input) {
  const { startTime: _departureTime, returnTo: _returnPlace, ...rest } = input ?? {};
  const request = { ...freshPlannerRequest(), ...rest, luggageMode: rest.luggageMode ?? 'suitcase' };
  request.destination = text(request.destination);
  request.transport = plannerLocalTransport(text(request.transport));
  request.notes = text(request.notes);
  request.travelersText = text(request.travelersText);
  if (Array.isArray(request.references) && request.references.length) {
    request.references = request.references.slice(0, MAX_XHS_REFERENCES).map((ref) => ({
      id: text(ref?.id),
      sourceType: ['xhs_link', 'screenshot', 'text'].includes(ref?.sourceType) ? ref.sourceType : 'text',
      title: text(ref?.title).slice(0, 160),
      ...(ref?.author ? { author: text(ref.author).slice(0, 80) } : {}),
      ...(ref?.url && isPublicWebUrl(ref.url) ? { url: ref.url } : {}),
      ...(ref?.publishedAt ? { publishedAt: text(ref.publishedAt).slice(0, 40) } : {}),
      destinations: Array.isArray(ref?.destinations) ? ref.destinations.map((d) => text(d).trim()).filter(Boolean).slice(0, 8) : [],
      suggestedDays: Number.isSafeInteger(ref?.suggestedDays) && ref.suggestedDays > 0 ? ref.suggestedDays : null,
      styleTags: Array.isArray(ref?.styleTags) ? ref.styleTags.map((s) => text(s).trim()).filter(Boolean).slice(0, 8) : [],
      routeOutline: Array.isArray(ref?.routeOutline) ? ref.routeOutline.map((s) => text(s).trim()).filter(Boolean).slice(0, 12) : [],
      tips: Array.isArray(ref?.tips) ? ref.tips.map((s) => text(s).trim()).filter(Boolean).slice(0, 12) : [],
      places: Array.isArray(ref?.places)
        ? ref.places
            .filter((p) => p && typeof p === 'object' && (text(p.name).trim() || text(p.canonicalName).trim()))
            .slice(0, 30)
            .map((p) => ({
              id: text(p.id),
              name: text(p.name).trim().slice(0, 80),
              canonicalName: text(p.canonicalName || p.name).trim().slice(0, 80),
              city: text(p.city).trim().slice(0, 40),
              kind: ['sight', 'food', 'lodging', 'photo_spot', 'other'].includes(p.kind) ? p.kind : 'sight',
              dayHint: Number.isSafeInteger(p.dayHint) && p.dayHint > 0 ? p.dayHint : null,
              note: text(p.note).trim().slice(0, 160),
              selected: p.selected !== false,
            }))
        : [],
    }));
  } else {
    delete request.references;
  }
  if (!XHS_REFERENCE_MODE_OPTIONS.some(({ value }) => value === request.referenceMode)) {
    delete request.referenceMode;
  }
  return request.endDate
    ? updatePlannerDates(request, { endDate: request.endDate })
    : updatePlannerDates(request, { days: request.days });
}

/** Normalize optional model fields before rendering. Missing metadata or a
 * familiar Chinese billing unit must not invalidate an otherwise useful plan.
 * Unreadable prices remain visible as original text and are marked unknown;
 * normalization never invents a free ticket or guesses an ambiguous currency.
 */
export function normalizePlannerOutput(rawContent, input, sources, preserveRequest = false) {
  if (!rawContent || typeof rawContent !== 'object') return rawContent;
  const content = structuredClone(rawContent);
  const original = preparePlannerInput(input);
  const interpreted = content.request && typeof content.request === 'object' ? content.request : {};
  // Structured counts are explicit user choices. Only older/free-text party
  // descriptions need AI interpretation; never change a selected count while
  // repairing the model's expense metadata.
  // 页面数字控件生成的描述（含旧格式“N 人，其中 M 位学生”）不是自由描述，不交给 AI 改人数。
  const structuredParty = [plannerPartyText(original), `${original.people} 人，其中 ${original.students} 位学生`];
  const freeParty = original.travelersText.trim() && !structuredParty.includes(original.travelersText);
  const people = freeParty ? positiveInteger(interpreted.people, original.people) : original.people;
  const students = freeParty ? Number(interpreted.students) : original.students;
  content.request = preserveRequest
    ? structuredClone(input)
    : {
        ...original,
        people,
        students:
          Number.isSafeInteger(students) && students >= 0 && students <= people
            ? students
            : Math.min(original.students, people),
        // 老人、儿童只来自页面数字控件，AI 不改动；超出总人数由校验给出提示。
        seniors: original.seniors ?? 0,
        children: original.children ?? 0,
        rooms: original.rooms ?? positiveInteger(interpreted.rooms, null),
        budgetCents:
          original.budgetCents ??
          (Number.isSafeInteger(interpreted.budgetCents) && interpreted.budgetCents >= 0
            ? interpreted.budgetCents
            : null),
        foodMode: original.foodMode || interpreted.foodMode === true,
        skipBreakfast: original.skipBreakfast || interpreted.skipBreakfast === true,
      };
  content.sources = sources;
  delete content.uncertain; // 只在生成时用于决定是否补查游客经验，不存入计划。
  const sourceIds = new Set(sources.map((source) => source.id));
  const references = (value) =>
    (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
      .map((item) => (typeof item === 'string' ? item : item?.id))
      .filter((id, index, all) => sourceIds.has(id) && all.indexOf(id) === index);
  const usedIds = new Set();
  const previousIds = new Map();
  const normalizedCosts = [];

  function costList(value, prefix) {
    // An explanatory string or keyed object remains visible, rather than
    // throwing because the model did not use the exact array schema.
    const list =
      value == null
        ? []
        : Array.isArray(value)
          ? value
          : typeof value === 'object' && !('label' in value) && !('unitPriceCents' in value)
            ? Object.entries(value).map(([label, item]) =>
                typeof item === 'object' && item !== null
                  ? { label, ...item }
                  : { label, description: item },
              )
            : [value];
    return list.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw : { label: text(raw) };
      const previousId = text(item.id);
      let id = previousId || `${prefix}-${index + 1}`;
      while (usedIds.has(id)) id = `${prefix}-${index + 1}-${usedIds.size}`;
      usedIds.add(id);
      if (previousId && !previousIds.has(previousId)) previousIds.set(previousId, id);
      const category = alias(item.category, CATEGORY_NAMES, 'other');
      const suppliedUnit = alias(item.unit, UNIT_NAMES, null);
      const unit = category === 'tickets' && suppliedUnit === 'person' ? 'ticket' : suppliedUnit;
      const price = (cents, yuan) => {
        if (cents !== null && cents !== undefined && cents !== '') {
          if (typeof cents === 'string' && /元|¥|￥|CNY|RMB/i.test(cents)) {
            const value = Number(cents.replace(/元|¥|￥|CNY|RMB|,/gi, '').trim());
            return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
          }
          const value = Number(cents);
          return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value))
            ? Math.round(value)
            : null;
        }
        if (yuan !== null && yuan !== undefined && yuan !== '') {
          const value = Number(
            text(yuan)
              .replace(/元|¥|￥|,/g, '')
              .trim(),
          );
          return Number.isFinite(value) &&
            value >= 0 &&
            Number.isSafeInteger(Math.round(value * 100))
            ? Math.round(value * 100)
            : null;
        }
        return null;
      };
      const quantity = positiveInteger(item.quantity, 1);
      const occurrences = positiveInteger(item.occurrences, 1);
      const invalidQuantity =
        (item.quantity != null && positiveInteger(item.quantity, null) === null) ||
        (item.occurrences != null && positiveInteger(item.occurrences, null) === null);
      const unitPriceCents = price(item.unitPriceCents, item.unitPriceYuan);
      const studentPriceCents = price(item.studentPriceCents, item.studentPriceYuan);
      const seniorPriceCents = price(item.seniorPriceCents, item.seniorPriceYuan);
      const childPriceCents = price(item.childPriceCents, item.childPriceYuan);
      const refs = references(item.sourceIds);
      const uncertain = unitPriceCents === null || invalidQuantity || !unit;
      const qualification = [text(item.qualification) || text(item.description)].filter(Boolean);
      const unreadablePrice = item.unitPriceCents != null && unitPriceCents === null;
      const unparsedAmount =
        unitPriceCents === null &&
        Object.entries(item).some(
          ([name, value]) =>
            /price|amount|total|费|价|钱/i.test(name) &&
            value != null &&
            !['studentPriceCents', 'seniorPriceCents', 'childPriceCents'].includes(name),
        );
      const preserveRaw =
        !unit || invalidQuantity || unreadablePrice || unparsedAmount || typeof raw !== 'object';
      if (preserveRaw && !item.rawDescription) {
        qualification.push(`原始费用说明：${text(raw)}`);
      }
      const normalized = {
        ...item,
        id,
        label: text(item.label ?? item.name, '费用待确认'),
        category,
        unit:
          unit ?? (category === 'tickets' ? 'ticket' : category === 'lodging' ? 'room' : 'group'),
        unitPriceCents: uncertain ? null : unitPriceCents,
        studentPriceCents,
        seniorPriceCents,
        childPriceCents,
        quantity,
        occurrences,
        status:
          uncertain || item.status === 'unknown'
            ? 'unknown'
            : item.status === 'verified' && refs.length
              ? 'verified'
              : 'estimate',
        qualification: qualification.join('；'),
        sourceIds: refs,
        ...(item.rawDescription !== undefined || preserveRaw
          ? { rawDescription: item.rawDescription ?? text(raw) }
          : {}),
        includedIn:
          typeof item.includedIn === 'string' && !['', 'null', 'none'].includes(item.includedIn)
            ? item.includedIn
            : null,
      };
      normalizedCosts.push(normalized);
      return normalized;
    });
  }

  const activityIds = new Set();
  const activityIdMap = new Map();
  const selfDrive = isSelfDriveTransport(content.request?.transport);
  const days = Array.isArray(content.days) ? content.days : [];
  for (const [dayIndex, day] of days.entries()) {
    if (!day || !Array.isArray(day.activities)) continue;
    day.activities = day.activities.filter((activity) => activity && typeof activity === 'object');
    for (const [index, activity] of day.activities.entries()) {
      // 局部修改（preserveRequest）时不改动其他活动，避免旧计划被判为超出所选模块。
      const costs = costList(activity.costs, `cost-${dayIndex + 1}-${index + 1}`);
      activity.costs = preserveRequest ? costs : mergeGroupTickets(costs);
      activity.sourceIds = references(activity.sourceIds);
      repairActivity(activity, dayIndex, index, activityIds, activityIdMap, selfDrive);
    }
    if (day.lodging) {
      day.lodging.costs = costList(day.lodging.costs, `lodging-${dayIndex + 1}`);
      day.lodging.sourceIds = references(day.lodging.sourceIds);
    }
  }
  // 交通衔接在全部活动编号确定后再解析；指向不存在的活动时去掉衔接，不作废整份行程。
  for (const activity of days.flatMap((day) => (Array.isArray(day?.activities) ? day.activities : []))) {
    for (const key of ['fromActivityId', 'toActivityId']) {
      const ref = activity[key] == null ? null : activityIdMap.get(text(activity[key])) ?? text(activity[key]);
      activity[key] = ref && activityIds.has(ref) ? ref : null;
    }
  }
  // Resolve deduplicated IDs only after all costs exist. Invalid inclusion
  // claims are kept unknown, avoiding accidental double charging of a package.
  for (const cost of normalizedCosts) {
    if (!cost.includedIn) continue;
    cost.includedIn = previousIds.get(cost.includedIn) ?? cost.includedIn;
    const parent = normalizedCosts.find((item) => item.id === cost.includedIn);
    if (!parent || parent === cost || parent.includedIn) {
      cost.includedIn = null;
      cost.status = 'unknown';
      cost.unitPriceCents = null;
      cost.qualification += '；套餐包含关系待确认';
    }
  }
  // 住宿与餐饮一律给预估价；局部修改时不动其他活动（页面显示时也会补全）。
  if (preserveRequest || !Array.isArray(content.days) || !content.request) return content;
  try { return plannerFillEstimates(content); } catch { return content; }
}
