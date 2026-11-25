import type {
  AiTravelPlan,
  PlannerActivity,
  PlannerContent,
  PlannerCost,
  PlannerBudget,
  PlannerRequest,
  PlannerMessage,
  PlannerSuggestion,
} from './planner-types.ts';

export const PLANNER_PERIODS = {
  morning: '早上',
  noon: '中午',
  afternoon: '下午',
  evening: '晚上',
} as const;

export const PLANNER_LOCAL_TRANSPORT_OPTIONS = [
  { value: '由 AI 建议', label: '由 AI 建议' },
  { value: '公共交通', label: '公共交通（地铁／公交）' },
  { value: '打车／网约车', label: '打车／网约车' },
  { value: '自驾', label: '自驾' },
  { value: '租车', label: '当地租车' },
  { value: '步行为主', label: '步行为主' },
] as const;

/** 旧选项把到达方式和当地出行绑在一起；读取时只沿用其中的当地偏好。 */
export function plannerLocalTransport(value?: string): string {
  const preference = typeof value === 'string' ? value.trim() : '';
  const legacy = preference.normalize('NFKC').replace(/\s+/g, '');
  if (legacy === '火车+租车') return '租车';
  if (legacy === '火车+当地公共交通' || legacy === '飞机+公共交通') return '公共交通';
  return PLANNER_LOCAL_TRANSPORT_OPTIONS.find((option) => option.value === preference)?.value
    ?? PLANNER_LOCAL_TRANSPORT_OPTIONS[0].value;
}

/** 是否属于自驾/当地租车出行：自驾模式只需展示开车公里数与预计时间。 */
export function isSelfDriveTransport(value?: string): boolean {
  const local = plannerLocalTransport(value);
  if (local === '自驾' || local === '租车') return true;
  return typeof value === 'string' && /自驾|租车|开车/.test(value);
}

export const PLANNER_TRANSFER_MODES = ['walk', 'subway', 'bus', 'taxi', 'drive', 'train', 'flight', 'other'] as const;

export function plannerDurationMinutes(start: string, end: string): number {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return Math.max(0, minutes(end) - minutes(start));
}

export function plannerDurationLabel(start: string, end: string): string {
  const duration = plannerDurationMinutes(start, end);
  const hours = Math.floor(duration / 60);
  const remainder = duration % 60;
  return `${hours ? `${hours} 小时` : ''}${remainder ? ` ${remainder} 分钟` : ''}`.trim();
}

/** 接驳、候车和跨日续程仍占用时间，只在票券内展示。旧预订使用同样的编号规则。 */
function isBookingBuffer(activity: PlannerActivity): boolean {
  return Boolean(activity.bookingId && ['access', 'check', 'onward', 'ride'].some((phase) =>
    activity.id.startsWith(`booking-${activity.bookingId}-${phase}-`)));
}

/** 时间轴和导出共用可见卡片；冲突检查还会读取预订的内部占用时间。 */
export function plannerActivitiesByTime(activities: readonly PlannerActivity[], includeBookingBuffers = false): PlannerActivity[] {
  return activities.filter((activity) => !activity.bookingTiming?.deferred && (includeBookingBuffers || !isBookingBuffer(activity)))
    .sort((first, second) => first.startTime.localeCompare(second.startTime));
}
const CATEGORIES = ['transport', 'lodging', 'tickets', 'food', 'other'] as const;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Use UTC only for calendar arithmetic; no machine timezone changes the date. */
export function addPlannerDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !DAY_PATTERN.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error('日期无效');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function plannerDayCount(start: string, end: string): number {
  addPlannerDays(start, 0);
  addPlannerDays(end, 0);
  return (
    Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
  );
}

export function freshPlannerRequest(destination = '', base = ''): PlannerRequest {
  return {
    destination,
    base,
    people: 1,
    students: 0,
    seniors: 0,
    children: 0,
    travelersText: '',
    startDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    days: null,
    endDate: '',
    budgetCents: null,
    pace: '均衡',
    transport: PLANNER_LOCAL_TRANSPORT_OPTIONS[0].value,
    luggageMode: 'suitcase',
    foodMode: false,
    skipBreakfast: false,
    dietary: '',
    lodgingLevel: '舒适经济',
    rooms: null,
    notes: '',
  };
}

/** 同行人群拆分：学生、老人、儿童之外都按成人计。旧数据缺少的项按 0。 */
export function plannerParty(request: Pick<PlannerRequest, 'people' | 'students' | 'seniors' | 'children'>) {
  const students = request.students ?? 0, seniors = request.seniors ?? 0, children = request.children ?? 0;
  return { students, seniors, children, adults: request.people - students - seniors - children };
}

/** 提示词和展示用的同行描述，例如“4 人，其中学生 1 位、老人 2 位”。 */
export function plannerPartyText(request: Pick<PlannerRequest, 'people' | 'students' | 'seniors' | 'children'>): string {
  const { students, seniors, children } = plannerParty(request);
  const parts = [[students, '学生'], [seniors, '老人'], [children, '儿童']]
    .filter(([count]) => count).map(([count, label]) => `${label} ${count} 位`);
  return `${request.people} 人${parts.length ? `，其中${parts.join('、')}` : ''}`;
}

export function validatePlannerRequest(request: PlannerRequest, requireDuration = false): void {
  if (!request || typeof request.destination !== 'string') throw new Error('请填写出行想法');
  if (request.luggageMode !== undefined && !['backpack', 'suitcase'].includes(request.luggageMode))
    throw new Error('请选择背包出行或行李箱出行');
  for (const name of ['base', 'pace', 'transport', 'dietary', 'lodgingLevel', 'notes'] as const) {
    if (typeof request[name] !== 'string') throw new Error('出行条件格式无效');
  }
  if (!Number.isSafeInteger(request.people) || request.people < 1)
    throw new Error('人数未能识别，请补充同行情况');
  for (const [name, label] of [['students', '学生'], ['seniors', '老人'], ['children', '儿童']] as const) {
    const count = name === 'students' ? request.students : request[name] ?? 0;
    if (!Number.isInteger(count) || count < 0) throw new Error(`${label}人数应为 0 或正整数`);
  }
  if (plannerParty(request).adults < 0) throw new Error('学生、老人和儿童人数之和不能超过总人数');
  addPlannerDays(request.startDate, 0);
  if (request.days !== null && (!Number.isSafeInteger(request.days) || request.days < 1))
    throw new Error('旅行天数应为正整数');
  if (request.endDate && plannerDayCount(request.startDate, request.endDate) < 1)
    throw new Error('结束日期不能早于开始日期');
  if (request.rooms !== null && (!Number.isSafeInteger(request.rooms) || request.rooms < 1))
    throw new Error('请填写正确的房间数量');
  if (
    request.budgetCents !== null &&
    (!Number.isSafeInteger(request.budgetCents) || request.budgetCents < 0)
  )
    throw new Error('预算金额无效');
  if (typeof request.foodMode !== 'boolean' || typeof request.skipBreakfast !== 'boolean')
    throw new Error('餐饮偏好无效');
  if (requireDuration && !request.days && !request.endDate)
    throw new Error('请先选择建议天数或填写结束日期');
}

/** Calendar inputs stay linked: the start day is day one. A date shift keeps
 * the selected duration; clearing the end or duration returns to suggestions.
 */
export function updatePlannerDates(
  request: PlannerRequest,
  change: Partial<Pick<PlannerRequest, 'startDate' | 'endDate' | 'days'>>,
): PlannerRequest {
  const next = { ...request, ...change };
  try {
    if ('endDate' in change) {
      next.days =
        next.endDate && next.startDate ? plannerDayCount(next.startDate, next.endDate) : null;
    } else if ('days' in change || ('startDate' in change && next.days !== null)) {
      next.endDate =
        next.startDate && next.days !== null && Number.isSafeInteger(next.days) && next.days > 0
          ? addPlannerDays(next.startDate, next.days - 1)
          : '';
    } else if (next.startDate && next.endDate)
      next.days = plannerDayCount(next.startDate, next.endDate);
  } catch {
    /* Incomplete input remains visible until the user finishes typing. */
  }
  return next;
}

function validText(value: unknown): value is string {
  return typeof value === 'string';
}
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validText);
}
/** Object field order is not semantic; arrays retain their user-visible order. */
/** 后加的可选字段：缺失与默认值含义相同（旧计划没有老人/儿童人数和票价）。
 * 比较时一律视为缺失，避免旧数据被补上默认值后误判为“改动了其他模块”。
 */
const OPTIONAL_DEFAULTS: Record<string, unknown> = { seniors: 0, children: 0, seniorPriceCents: null, childPriceCents: null };

export function plannerValueEqual(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key, item]) => !(key in OPTIONAL_DEFAULTS && item === OPTIONAL_DEFAULTS[key]))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Only a single, concrete instruction can become an apply button. An answer
 * asking the user to choose among unresolved alternatives remains read-only.
 */
export function isExecutablePlannerSuggestion(value: unknown): boolean {
  const suggestion = value as { title?: unknown; instruction?: unknown } | null;
  return Boolean(
    suggestion &&
      typeof suggestion.title === 'string' &&
      suggestion.title.trim() &&
      typeof suggestion.instruction === 'string' &&
      suggestion.instruction.trim() &&
      !/二选一|请确认|请先选择|确认采用|选择哪个|再按所选|方案\s*[AＡ一1][\s\S]*方案\s*[BＢ二2]|[？?]/.test(
        suggestion.instruction,
      ),
  );
}

/** 对旧 ZIP 和已有对话只做读取兼容，不要求数据库迁移或改写历史编号。 */
export function plannerSuggestions(message: PlannerMessage): PlannerSuggestion[] {
  return (message.suggestions?.length ? message.suggestions : message.suggestion ? [message.suggestion] : [])
    .map((suggestion, index) => ({ ...suggestion, id: suggestion.id ?? `option-${index}`, label: suggestion.label ?? String.fromCharCode(65 + index) }));
}

/** 只有完整的选择表达才授权；“A 怎么样”、否定及假设不会落到实施路径。 */
export function resolvePlannerChoice(text: string, messages: PlannerMessage[]):
  { messageId: string; suggestion: PlannerSuggestion } | null {
  const choice = text.trim().replace(/[。！!\s]+$/g, '').toUpperCase().replace(/[Ａ-Ｚ]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 65248));
  const explicit = choice.match(/^(?:(?:我|我们)?(?:就|那就)?(?:选|选择|采用|实施|执行|按|就按|用)?\s*(?:方案\s*)?([A-Z])(?:\s*方案)?(?:吧|好了|执行|实施|执行吧|实施吧|来|来做)?|(?:实施计划|就这样改|按这个方案|采用这个方案))$/);
  if (!explicit) return null;
  // 普通追问没有新方案时，继续关联最近一次提出的方案组。
  const source = [...messages].reverse().find((message) => message.role === 'assistant' && plannerSuggestions(message).length);
  if (!source) return null;
  const options = plannerSuggestions(source);
  const matches = explicit[1] ? options.filter((item) => item.label?.toUpperCase() === explicit[1]) : options;
  return matches.length === 1 ? { messageId: source.id, suggestion: matches[0] } : null;
}
export function isPublicWebUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

function validateCosts(costs: PlannerCost[]): void {
  if (!Array.isArray(costs)) throw new Error('费用明细格式无效');
  for (const cost of costs) {
    if (
      !cost ||
      !validText(cost.id) ||
      !cost.id ||
      !validText(cost.label) ||
      !CATEGORIES.includes(cost.category) ||
      !['ticket', 'person', 'room', 'vehicle', 'group'].includes(cost.unit) ||
      !['verified', 'booked', 'estimate', 'unknown'].includes(cost.status) ||
      !validText(cost.qualification) ||
      !stringList(cost.sourceIds) ||
      !(cost.includedIn === null || validText(cost.includedIn))
    )
      throw new Error('费用项目格式无效');
    for (const price of [cost.unitPriceCents, cost.studentPriceCents, cost.seniorPriceCents ?? null, cost.childPriceCents ?? null]) {
      if (price !== null && (!Number.isSafeInteger(price) || price < 0))
        throw new Error('费用必须使用非负整数分');
    }
    if (
      !Number.isSafeInteger(cost.quantity) ||
      cost.quantity < 1 ||
      !Number.isSafeInteger(cost.occurrences) ||
      cost.occurrences < 1
    )
      throw new Error('费用数量无效');
  }
}

/** Validate AI/backup data before it can replace a usable plan. JSON mode alone
 * does not enforce the domain's dates, relationships or money representation.
 */
export function validatePlannerContent(value: unknown): asserts value is PlannerContent {
  const content = value as PlannerContent;
  if (
    !content ||
    !validText(content.title) ||
    !content.title.trim() ||
    !validText(content.summary) ||
    !Array.isArray(content.days) ||
    !content.days.length ||
    !stringList(content.constraints) ||
    !stringList(content.warnings) ||
    !Array.isArray(content.cities) ||
    !content.cities.length ||
    !Array.isArray(content.sources) ||
    !Array.isArray(content.alternatives)
  )
    throw new Error('AI 行程结构不完整，请重试');
  validatePlannerRequest(content.request, true);
  const expectedDays = content.request.endDate
    ? plannerDayCount(content.request.startDate, content.request.endDate)
    : content.request.days;
  if (content.days.length !== expectedDays) throw new Error('行程天数与出行条件不一致');
  const ids = new Set<string>();
  const costIds = new Set<string>();
  const allCosts: PlannerCost[] = [];
  for (const city of content.cities) {
    if (!/^\d{6}$/.test(city?.code) || !/^\d{6}$/.test(city.provinceCode) || !validText(city.name))
      throw new Error('目的地城市编码无效');
  }
  for (const source of content.sources) {
    if (
      !source ||
      !validText(source.id) ||
      !source.id ||
      !validText(source.title) ||
      !isPublicWebUrl(source.url) ||
      !Number.isFinite(Date.parse(source.checkedAt))
    )
      throw new Error('参考来源无效');
  }
  const sourceIds = new Set(content.sources.map((source) => source.id));
  if (sourceIds.size !== content.sources.length) throw new Error('来源编号重复');
  const checkSources = (refs: string[]) => {
    if (!stringList(refs) || refs.some((id) => !sourceIds.has(id)))
      throw new Error('引用了不存在的资料来源');
  };
  for (const [index, day] of content.days.entries()) {
    if (
      day.date !== addPlannerDays(content.request.startDate, index) ||
      !validText(day.title) ||
      !validText(day.weather) ||
      !Array.isArray(day.activities) ||
      !day.activities.length
    )
      throw new Error('每日安排日期或内容无效');
    for (const activity of day.activities) {
      if (
        !activity ||
        !validText(activity.id) ||
        !activity.id ||
        ids.has(activity.id) ||
        !['sight', 'food', 'transport', 'rest'].includes(activity.kind) ||
        !(activity.period in PLANNER_PERIODS) ||
        !TIME_PATTERN.test(activity.startTime) ||
        !TIME_PATTERN.test(activity.endTime) ||
        activity.endTime <= activity.startTime ||
        typeof activity.locked !== 'boolean' ||
        ![null, 'breakfast', 'lunch', 'dinner', 'snack'].includes(activity.meal) ||
        !['title', 'city', 'location', 'description', 'transportMode'].every((key) =>
          validText(activity[key as keyof PlannerActivity]),
        ) ||
        !(activity.photoQuery === undefined || validText(activity.photoQuery)) ||
        !(activity.fromActivityId === null || validText(activity.fromActivityId)) ||
        !(activity.toActivityId === null || validText(activity.toActivityId))
      )
        throw new Error('活动时间、编号或内容无效');
      if (activity.distanceKm !== undefined && (
        activity.kind !== 'transport' || (activity.distanceKm !== null && (!Number.isFinite(activity.distanceKm) || activity.distanceKm <= 0))
      )) throw new Error('交通距离无效');
      if (activity.transferOptions !== undefined) {
        if (activity.kind !== 'transport' || !Array.isArray(activity.transferOptions) || activity.transferOptions.length > 6)
          throw new Error('交通方案明细无效');
        for (const option of activity.transferOptions) {
          if (
            !option ||
            !PLANNER_TRANSFER_MODES.includes(option.mode) ||
            (option.recommended !== undefined && typeof option.recommended !== 'boolean') ||
            (option.line !== undefined && !validText(option.line)) ||
            (option.fromStation !== undefined && !validText(option.fromStation)) ||
            (option.toStation !== undefined && !validText(option.toStation)) ||
            (option.transferNote !== undefined && !validText(option.transferNote)) ||
            (option.durationMinutes !== undefined && option.durationMinutes !== null && (!Number.isFinite(option.durationMinutes) || option.durationMinutes <= 0)) ||
            (option.distanceKm !== undefined && option.distanceKm !== null && (!Number.isFinite(option.distanceKm) || option.distanceKm <= 0)) ||
            (option.costCents !== undefined && option.costCents !== null && (!Number.isSafeInteger(option.costCents) || option.costCents < 0)) ||
            (option.costUnit !== undefined && !['person', 'vehicle'].includes(option.costUnit)) ||
            (option.carpoolCostCents !== undefined && option.carpoolCostCents !== null && (!Number.isSafeInteger(option.carpoolCostCents) || option.carpoolCostCents < 0)) ||
            (option.carpoolNote !== undefined && !validText(option.carpoolNote))
          )
            throw new Error('交通方案明细无效');
        }
      }
      const luggageNote = activity.luggageNote;
      if (luggageNote !== undefined && (!luggageNote || typeof luggageNote.text !== 'string'
        || !luggageNote.text.trim() || luggageNote.text.length > 160
        || (luggageNote.sourceId !== undefined && !sourceIds.has(luggageNote.sourceId))
        || (luggageNote.searchQuery !== undefined && (typeof luggageNote.searchQuery !== 'string'
          || !luggageNote.searchQuery.trim() || luggageNote.searchQuery.length > 120))))
        throw new Error('行李寄存说明无效');
      if (
        activity.photo !== null &&
        (!activity.photo ||
          !isPublicWebUrl(activity.photo.url) ||
          !isPublicWebUrl(activity.photo.sourceUrl) ||
          !validText(activity.photo.attribution) ||
          (activity.photo.assetId !== undefined && !/^[a-f\d]{64}$/.test(activity.photo.assetId)))
      )
        throw new Error('图片来源无效');
      if (content.request.skipBreakfast && activity.meal === 'breakfast')
        throw new Error('行程包含了已排除的早餐');
      ids.add(activity.id);
      checkSources(activity.sourceIds);
      validateCosts(activity.costs);
      allCosts.push(...activity.costs);
    }
    if (index === content.days.length - 1 && day.lodging !== null)
      throw new Error('结束日不应自动安排住宿');
    if (index < content.days.length - 1 && !day.lodging)
      throw new Error('过夜行程缺少住宿片区建议');
    if (day.lodging) {
      if (
        !['city', 'area', 'searchKeyword', 'reason'].every((key) =>
          validText(day.lodging![key as keyof typeof day.lodging]),
        )
      )
        throw new Error('住宿区域信息无效');
      validateCosts(day.lodging.costs);
      checkSources(day.lodging.sourceIds);
      allCosts.push(...day.lodging.costs);
    }
  }
  for (const cost of allCosts) {
    if (costIds.has(cost.id)) throw new Error('费用编号重复，会导致重复计费');
    costIds.add(cost.id);
    checkSources(cost.sourceIds);
  }
  for (const cost of allCosts) {
    if (
      cost.includedIn &&
      (!costIds.has(cost.includedIn) ||
        cost.includedIn === cost.id ||
        allCosts.find((item) => item.id === cost.includedIn)?.includedIn)
    )
      throw new Error('套餐费用关联无效');
    if (cost.status === 'verified' && !cost.sourceIds.length) throw new Error('已查证价格缺少来源');
  }
  for (const activity of content.days.flatMap((day) => day.activities)) {
    if (
      (activity.fromActivityId && !ids.has(activity.fromActivityId)) ||
      (activity.toActivityId && !ids.has(activity.toActivityId))
    )
      throw new Error('交通衔接引用无效');
  }
  for (const item of content.alternatives) {
    if (
      !item ||
      !validText(item.title) ||
      !validText(item.city) ||
      !validText(item.reason) ||
      typeof item.rainyDay !== 'boolean'
    )
      throw new Error('备用景点格式无效');
  }
}

/** Calculate every line from cents and billing units; AI totals are ignored. */
export function calculatePlannerBudget(content: PlannerContent): PlannerBudget {
  const request = content.request;
  const budget: PlannerBudget = {
    totalCents: 0,
    categories: { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 },
    unknownItems: [],
    notes: [],
    items: [],
  };
  const seen = new Set<string>();
  const costs = content.days.flatMap((day) => [
    ...day.activities
      .filter((activity) => !activity.bookingTiming?.deferred && !(request.skipBreakfast && activity.meal === 'breakfast'))
      .flatMap((activity) => activity.costs),
    ...(day.lodging?.costs ?? []),
  ]);
  const activeCostIds = new Set(costs.map((cost) => cost.id));
  for (const cost of costs) {
    if (seen.has(cost.id)) continue;
    seen.add(cost.id);
    if (cost.includedIn) {
      if (activeCostIds.has(cost.includedIn)) {
        budget.notes.push(`${cost.label}已含在套餐内，不重复计费`);
        continue;
      }
      budget.notes.push(`${cost.label}原属套餐主项已暂缓，已按单项/待确认处理`);
    }
    let total: number | null = null;
    let explanation = '';
    if (cost.unitPriceCents !== null && cost.status !== 'unknown') {
      if (cost.unit === 'ticket') {
        // 各人群用各自票价；没有优惠价的按成人价预算，并提示待确认。
        const party = plannerParty(request);
        const groups = [
          { count: party.adults, price: cost.unitPriceCents, label: '成人' },
          { count: party.students, price: cost.studentPriceCents, label: '学生' },
          { count: party.seniors, price: cost.seniorPriceCents ?? null, label: '老人' },
          { count: party.children, price: cost.childPriceCents ?? null, label: '儿童' },
        ].filter((group) => group.count);
        total = groups.reduce((sum, group) => sum + group.count * (group.price ?? cost.unitPriceCents!), 0) * cost.occurrences;
        explanation = `${groups.map((group) => `${group.count} 位${group.label}`).join('＋')} × ${cost.occurrences} 次`;
        for (const group of groups)
          if (group.label !== '成人' && group.price === null) budget.notes.push(`${cost.label}${group.label}优惠待确认，暂按成人价预算`);
      } else {
        const quantity =
          cost.unit === 'person'
            ? request.people
            : cost.unit === 'room'
              ? (request.rooms ?? Math.ceil(request.people / 2))
              : cost.quantity;
        total = cost.unitPriceCents * quantity * cost.occurrences;
        explanation = `${quantity} ${cost.unit === 'room' ? '间' : cost.unit === 'person' ? '人' : cost.unit === 'vehicle' ? '辆' : '份'} × ${cost.occurrences} 次`;
      }
      if (!Number.isSafeInteger(total)) throw new Error('费用计算超出安全范围');
      budget.totalCents += total;
      budget.categories[cost.category] += total;
    } else budget.unknownItems.push(cost.label);
    budget.items.push({
      id: cost.id,
      label: cost.label,
      category: cost.category,
      totalCents: total,
      explanation,
      status: cost.status,
    });
  }
  if (request.rooms === null && content.days.some((day) => day.lodging))
    budget.notes.push(`住宿暂按每间两人，共 ${Math.ceil(request.people / 2)} 间估算，可修改房间数`);
  budget.notes = [...new Set(budget.notes)];
  return budget;
}

/** Date shifts preserve stable IDs; transfers and source timestamps remain
 * visible until the explicit AI recheck has completed successfully.
 */
export function shiftPlannerDates(content: PlannerContent, startDate: string): PlannerContent {
  const next = structuredClone(content);
  next.request.startDate = startDate;
  next.request.endDate = addPlannerDays(startDate, next.days.length - 1);
  next.days.forEach((day, index) => {
    day.date = addPlannerDays(startDate, index);
  });
  return next;
}

export function plannerConflicts(content: PlannerContent): string[] {
  const conflicts = new Set<string>();
  const bookingTitles = new Map(content.days.flatMap((day) => day.activities
    .filter((item) => item.bookingId && !isBookingBuffer(item))
    .map((item) => [item.bookingId, item.title] as const)));
  const title = (item: PlannerActivity) => bookingTitles.get(item.bookingId) ?? item.title;
  for (const day of content.days) {
    const activities = plannerActivitiesByTime(day.activities, true);
    let latestEnding = activities[0];
    for (const activity of activities.slice(1)) {
      if (activity.startTime < latestEnding.endTime && (!activity.bookingId || activity.bookingId !== latestEnding.bookingId)) {
        conflicts.add(`${day.date}「${title(latestEnding)}」与「${title(activity)}」时间重叠`);
      }
      if (activity.endTime > latestEnding.endTime) latestEnding = activity;
    }
  }
  return [...conflicts];
}

export function revisePlanner(
  plan: AiTravelPlan,
  content: PlannerContent,
  reason: string,
): AiTravelPlan {
  validatePlannerContent(content);
  const now = new Date().toISOString();
  return {
    ...plan,
    version: plan.version + 1,
    contentVersion: plan.version + 1,
    updatedAt: now,
    content,
    history: [
      ...plan.history,
      { version: plan.version, savedAt: now, reason, content: structuredClone(plan.content) },
    ].slice(-30),
  };
}

/** Enforce local edit scope in code, independent of the model's instructions. */
export function enforcePlannerScope(
  original: PlannerContent,
  proposed: PlannerContent,
  activityId: string | null,
): void {
  for (const activity of original.days
    .flatMap((day) => day.activities)
    .filter((item) => item.locked)) {
    const next = proposed.days
      .flatMap((day) => day.activities)
      .find((item) => item.id === activity.id);
    const originalDate = original.days.find((day) =>
      day.activities.some((item) => item.id === activity.id),
    )?.date;
    const nextDate = proposed.days.find((day) =>
      day.activities.some((item) => item.id === activity.id),
    )?.date;
    if (!plannerValueEqual(next, activity) || originalDate !== nextDate)
      throw new Error(`「${activity.title}」已锁定，请先解锁再修改`);
  }
  if (!activityId) return;
  if (!original.days.some((day) => day.activities.some((activity) => activity.id === activityId)))
    throw new Error('选择的活动已不存在');
  const targetDay = original.days.findIndex((day) =>
    day.activities.some((activity) => activity.id === activityId),
  );
  if (!proposed.days[targetDay]?.activities.some((activity) => activity.id === activityId))
    throw new Error('局部修改不能删除或移走所选模块');
  const strip = (content: PlannerContent) => ({
    ...content,
    sources: [],
    warnings: [],
    days: content.days.map((day) => ({
      ...day,
      activities: day.activities.filter(
        (activity) =>
          activity.id !== activityId &&
          !(
            activity.kind === 'transport' &&
            (activity.fromActivityId === activityId || activity.toActivityId === activityId)
          ),
      ),
    })),
  });
  if (!plannerValueEqual(strip(original), strip(proposed)))
    throw new Error('AI 修改超出了所选模块，请重试或选择调整全程');
}

/** 住宿与餐饮一律给出预估价（不保证准确）：AI 未给价格时，按所选住宿档次和餐别常见价位补全。
 * 只补价格为空或状态未知的住宿/餐饮项，已有价格不改；返回新对象，不修改传入的计划。
 */
const MEAL_ESTIMATE_CENTS: Record<string, number> = { breakfast: 1500, lunch: 4000, dinner: 6000, snack: 2000 };
const LODGING_ESTIMATE_CENTS: Record<string, number> = { 节省预算: 15000, 舒适经济: 25000, 舒适优先: 45000 };
const FOOD_LEVEL_FACTOR: Record<string, number> = { 节省预算: 0.8, 舒适经济: 1, 舒适优先: 1.4 };

export function plannerFillEstimates(content: PlannerContent): PlannerContent {
  const level = content.request.lodgingLevel;
  const factor = FOOD_LEVEL_FACTOR[level] ?? 1;
  const fill = (cost: PlannerCost, cents: number, unit: PlannerCost['unit'], basis: string): PlannerCost =>
    cost.unitPriceCents !== null && cost.status !== 'unknown'
      ? cost
      : {
          ...cost,
          unit,
          unitPriceCents: cost.unitPriceCents ?? cents,
          status: 'estimate',
          qualification: [cost.qualification, basis].filter(Boolean).join('；'),
        };
  return {
    ...content,
    days: content.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({
        ...activity,
        costs: activity.costs.map((cost) => cost.category === 'food'
          ? fill(cost, Math.round((MEAL_ESTIMATE_CENTS[activity.meal ?? ''] ?? 4000) * factor / 100) * 100,
            cost.unit === 'group' || cost.unit === 'ticket' ? 'person' : cost.unit, '按餐别常见价位预估，仅供参考')
          : cost),
      })),
      lodging: day.lodging && {
        ...day.lodging,
        costs: day.lodging.costs.map((cost) => cost.category === 'lodging'
          ? fill(cost, LODGING_ESTIMATE_CENTS[level] ?? 25000, 'room', '按所选住宿档次预估，仅供参考')
          : cost),
      },
    })),
  };
}

/** 修改计划后保留原有照片：AI 返回的活动照片常被清空。同一活动（编号相同）且地点未变，
 * 或全程重排后同城市、同景点的活动，沿用原照片；只有新增或换了地点的活动留空，由页面重新查找。
 */
export function plannerCarryOverPhotos(original: PlannerContent, revised: PlannerContent): PlannerContent {
  const place = (activity: PlannerActivity) => `${activity.city}|${(activity.photoQuery || activity.title).trim()}`;
  const byId = new Map<string, PlannerActivity>();
  const byPlace = new Map<string, PlannerActivity>();
  for (const activity of original.days.flatMap((day) => day.activities)) {
    if (!activity.photo) continue;
    byId.set(activity.id, activity);
    if (!byPlace.has(place(activity))) byPlace.set(place(activity), activity);
  }
  return {
    ...revised,
    days: revised.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => {
        if (activity.photo) return activity;
        const sameId = byId.get(activity.id);
        const match = sameId && place(sameId) === place(activity) ? sameId : byPlace.get(place(activity));
        return match ? { ...activity, photo: match.photo } : activity;
      }),
    })),
  };
}
