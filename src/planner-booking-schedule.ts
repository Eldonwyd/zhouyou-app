import { addPlannerDays, plannerDayCount } from './planner-domain.ts';
import type { BookingRecord, PlannerActivity, PlannerContent, PlannerPeriod } from './planner-types.ts';

export const isTransportBooking = (booking: Pick<BookingRecord, 'kind'>) =>
  booking.kind === 'train' || booking.kind === 'flight';

const MINUTES_PER_DAY = 1440;
const LAST_MINUTE = MINUTES_PER_DAY - 1;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export function inferPeriodFromTime(time: string): PlannerPeriod {
  const value = minutes(time);
  if (value >= 18 * 60) return 'evening';
  if (value >= 14 * 60) return 'afternoon';
  if (value >= 11 * 60 + 30) return 'noon';
  return 'morning';
}

/** 路上用时和到站提前量分别预留。出发前可按实际路线、站点和值机要求修改。 */
export function bookingTransportTiming(booking: BookingRecord) {
  const flight = booking.kind === 'flight';
  return {
    lead: booking.stationLeadMinutes ?? (flight ? booking.internationalFlight ? 180 : 120 : 30),
    access: booking.accessMinutes ?? (flight ? 75 : 40),
    onward: booking.onwardMinutes ?? (flight ? 60 : 30),
  };
}

export function validateTransportBooking(booking: BookingRecord) {
  if (!isTransportBooking(booking)) return;
  addPlannerDays(booking.date, 0);
  if (!booking.fromLocation.trim() || !booking.toLocation.trim()) throw new Error('请填写出发和到达站点或机场。');
  const validClock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!validClock.test(booking.startTime) || !validClock.test(booking.endTime)) {
    throw new Error('请填写实际发车或起飞时间，以及到达时间。');
  }
  const endDate = bookingArrivalDate(booking);
  if (endDate < booking.date || (endDate === booking.date && booking.endTime <= booking.startTime)) {
    throw new Error('到达日期和时间需要晚于出发。');
  }
  const timing = bookingTransportTiming(booking);
  if (Object.values(timing).some((value) => !Number.isInteger(value) || value < 0 || value > 360) || timing.lead < 15) {
    throw new Error('到站提前量请填 15～360 分钟，接驳用时请填 0～360 分钟。');
  }
}

export function bookingArrivalDate(booking: BookingRecord) {
  if (booking.endDate) return addPlannerDays(booking.endDate, 0);
  return booking.endTime < booking.startTime ? addPlannerDays(booking.date, 1) : booking.date;
}

/** 票券可展开查看缓冲时间，包括清晨出发和跨日到达的情况。 */
export function bookingConnectionTimes(booking: BookingRecord) {
  const { lead, access, onward } = bookingTransportTiming(booking);
  const stationArrival = minutes(booking.startTime) - lead;
  const ready = minutes(booking.endTime) + onward;
  const label = (value: number) => `${value < 0 ? '前一天 ' : value >= MINUTES_PER_DAY ? '次日 ' : ''}${clock((value + MINUTES_PER_DAY) % MINUTES_PER_DAY)}`;
  return { leave: label(stationArrival - access), stationArrival: label(stationArrival), ready: label(ready), onward };
}

const mealWords = /早餐|早饭|早点|午餐|午饭|晚餐|晚饭|下午茶|夜宵|宵夜/g;

function mealAt(time: string): { meal: NonNullable<PlannerActivity['meal']>; label: string } {
  const start = minutes(time);
  if (start < 10 * 60 + 30) return { meal: 'breakfast', label: '早餐' };
  if (start < 14 * 60 + 30) return { meal: 'lunch', label: '午餐' };
  if (start < 17 * 60) return { meal: 'snack', label: '下午小吃' };
  if (start < 21 * 60) return { meal: 'dinner', label: '晚餐' };
  return { meal: 'snack', label: '夜宵' };
}

/** 只在餐饮换时段时重新安排餐别。预订餐饮的原单信息和一般小吃保留。 */
export function bookingMealNeedsUpdate(activity: PlannerActivity, originalStart: string, nextStart: string) {
  if (activity.kind !== 'food' || originalStart === nextStart || activity.costs.some((cost) => cost.status === 'booked')) return false;
  const previous = mealAt(originalStart);
  const next = mealAt(nextStart);
  const breakfast = activity.meal === 'breakfast' || /早餐|早饭|早点/.test(activity.title);
  if (breakfast) return next.meal !== 'breakfast';
  return previous.label !== next.label && (activity.meal ?? previous.meal) !== next.meal;
}

function retimeMeal(activity: PlannerActivity, timing: NonNullable<PlannerActivity['bookingTiming']>, nextStart: string, skipBreakfast: boolean) {
  if (!bookingMealNeedsUpdate(activity, timing.startTime, nextStart)) return;
  const predicted = mealAt(nextStart);
  const { meal, label } = skipBreakfast && predicted.meal === 'breakfast'
    ? { meal: 'snack' as const, label: '上午小吃' } : predicted;
  timing.originalMeal = { meal: activity.meal, title: activity.title, description: activity.description, costs: activity.costs };
  activity.meal = meal;
  const title = activity.title.replace(mealWords, label);
  activity.title = title === activity.title ? `${title} · ${label}` : title;
  // 旧摊位和菜品未必在新时段供应。沿用地点，用在当地核对后可执行的安排替换旧说明。
  activity.description = `在原安排地点附近用${label}，到时选择仍营业的店铺，按现场供应点餐。`;
  activity.costs = activity.costs.map((cost) => cost.category === 'food' && !cost.includedIn
    ? { ...cost, label, unitPriceCents: null, status: 'unknown', qualification: '', sourceIds: [] } : cost);
}

/** 使用原始活动重算，避免反复改签把午餐继续当成原来的早餐。 */
export function restoreBookingActivity(activity: PlannerActivity) {
  const timing = activity.bookingTiming;
  if (!timing) return;
  if (!activity.locked) {
    const { startTime, endTime, period, originalMeal } = timing;
    Object.assign(activity, { startTime, endTime, period }, originalMeal);
  }
  delete activity.bookingTiming;
}

function placeKey(place: string) {
  return place.replace(/白族自治州|纳西族自治县|市|高铁站|火车站|站|国际机场|机场|航站楼|T\d+/gi, '').replace(/[\s（）()]/g, '');
}

interface TransportLeg { date: string; activity: PlannerActivity; kind: 'train' | 'flight'; from: string; to: string }

/** 只提示乘车/乘机本身。步行、打车、地铁接驳和交通订单生成的卡片不提示填票。 */
export function plannedTransportLegs(content: PlannerContent): TransportLeg[] {
  const byId = new Map(content.days.flatMap((day) => day.activities.map((activity) => [activity.id, activity])));
  return content.days.flatMap((day) => day.activities.flatMap((activity): TransportLeg[] => {
    if (activity.kind !== 'transport' || activity.bookingId || activity.bookingTiming?.deferred) return [];
    const mode = activity.transportMode;
    const routePattern = /(.+?)(?:→|->|—>|—|➡|至|到)(.+)/;
    const route = activity.location.match(routePattern) ?? activity.title.match(routePattern);
    const modeAndTitle = `${mode} ${activity.title}`;
    const kind = /高铁|动车|火车|铁路|城际列车|普速|\b[GCDKZT]\d{2,}/i.test(modeAndTitle) ? 'train'
      : /航班|飞机|乘机|飞往|起飞|航空/.test(modeAndTitle) ? 'flight' : null;
    if (!kind) return [];
    const from = route?.[1].replace(/^(?:(?:乘坐|搭乘)?(?:高铁|动车|火车|飞机|航班|[A-Z]*\d{2,})\s*|从)/i, '').trim()
      || byId.get(activity.fromActivityId ?? '')?.city || '';
    const to = route?.[2].trim() || byId.get(activity.toActivityId ?? '')?.city || '';
    if (!route && /(?:前往|去|抵达)\S*(?:车站|机场)/.test(activity.title) && !/高铁|动车|火车|铁路|飞机|航班/.test(mode)) return [];
    return [{ date: day.date, activity, kind, from, to }];
  }));
}

/** 旧版本只按标题保存已回填的订单，没有活动编号。优先通过原标题或车次找回原卡片。 */
export function legacyTransportActivity(content: PlannerContent, booking: BookingRecord) {
  if (!booking.backfilledToPlan || booking.itineraryActivityId || !isTransportBooking(booking)) return undefined;
  return content.days.find((day) => day.date === booking.date)?.activities.find((activity) =>
    activity.kind === 'transport' && !activity.bookingId &&
    (activity.title === booking.title || Boolean(booking.code && `${activity.title} ${activity.transportMode}`.includes(booking.code))));
}

export function pendingTransportLegs(content: PlannerContent, bookings: readonly BookingRecord[]) {
  const linked = new Set(bookings.flatMap((booking) => [
    booking.itineraryActivityId,
    legacyTransportActivity(content, booking)?.id,
  ]));
  return plannedTransportLegs(content).filter(({ activity }) => !linked.has(activity.id));
}

export function matchTransportLeg(content: PlannerContent, booking: BookingRecord, bookings: readonly BookingRecord[]) {
  const from = placeKey(booking.fromLocation);
  const to = placeKey(booking.toLocation);
  const matches = pendingTransportLegs(content, bookings).filter((leg) => {
    if (leg.date !== booking.date || leg.kind !== booking.kind) return false;
    const legFrom = placeKey(leg.from);
    const legTo = placeKey(leg.to);
    return Boolean(from && to && legFrom && legTo && (legFrom.includes(from) || from.includes(legFrom)) &&
      (legTo.includes(to) || to.includes(legTo)));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

type TimeWindow = { start: number; end: number };
type BookingWindow = TimeWindow & { booking: BookingRecord; leave: number; depart: number; arrive: number; fromCity: string; toCity: string };

/** 沿用行程里的城市全名，站点只能确定到达城市时也保留用户填写的城市。 */
function stationCity(station: string, content: PlannerContent, fallback = '') {
  const key = placeKey(station);
  return content.cities.find((city) => {
    const cityKey = placeKey(city.name);
    return cityKey && key.includes(cityKey);
  })?.name ?? fallback;
}

function addBookingWindow(content: PlannerContent, booking: BookingRecord): BookingWindow | undefined {
  const departureIndex = content.days.findIndex((day) => day.date === booking.date);
  if (departureIndex < 0 || !booking.itineraryActivityId) return;
  const depart = departureIndex * MINUTES_PER_DAY + minutes(booking.startTime);
  const arrivalIndex = departureIndex + plannerDayCount(booking.date, bookingArrivalDate(booking)) - 1;
  const arrive = arrivalIndex * MINUTES_PER_DAY + minutes(booking.endTime);
  const { lead, access, onward } = bookingTransportTiming(booking);
  const leave = depart - lead - access;
  const fromCity = stationCity(booking.fromLocation, content, booking.estimatedLeg?.activity.city);
  const toCity = stationCity(booking.toLocation, content, booking.city);
  const flight = booking.kind === 'flight';
  const route = `${booking.fromLocation} → ${booking.toLocation}`;
  const description = [route, booking.code, booking.seatOrRoom, booking.note].filter(Boolean).join(' · ');
  const estimate = booking.estimatedLeg?.activity;
  const rideCosts = booking.amountYuan != null ? [{
    id: estimate?.costs[0]?.id ?? `booking-cost-${booking.id}`,
    label: booking.title, category: 'transport' as const, unit: 'group' as const,
    unitPriceCents: Math.round(booking.amountYuan * 100), studentPriceCents: null,
    quantity: 1, occurrences: 1, status: 'booked' as const, qualification: '', sourceIds: [], includedIn: null,
  }] : (estimate?.costs ?? []).filter((cost) => cost.sourceIds.every((id) => content.sources.some((source) => source.id === id)));
  const phases = [
    { key: 'access', start: leave, end: depart - lead, title: `前往${booking.fromLocation}`, location: booking.fromLocation, city: fromCity, mode: '市内接驳（预估）', description: `路上预计 ${access} 分钟。请按出发地点、实际交通和进站口调整。` },
    { key: 'check', start: depart - lead, end: depart, title: `到达${booking.fromLocation}并${flight ? '办理登机' : '候车'}`, location: booking.fromLocation, city: fromCity, mode: flight ? '值机 / 安检 / 候机' : '进站 / 安检 / 候车', description: `预留 ${lead} 分钟办理手续。请核对${flight ? '航司值机和登机截止时间' : '车站检票截止时间'}。` },
    { key: 'ride', start: depart, end: arrive, title: booking.title, location: route, city: fromCity || toCity, mode: `${flight ? '航班' : '火车/高铁'} ${booking.code}`.trim(), description },
    { key: 'onward', start: arrive, end: arrive + onward, title: `从${booking.toLocation}出站接驳`, location: booking.toLocation, city: toCity, mode: '到达接驳（预估）', description: `预留 ${onward} 分钟用于${flight ? '下机、取行李及后续交通' : '出站及后续交通'}。` },
  ];
  for (const phase of phases) {
    let firstSegment = true;
    for (const [index, day] of content.days.entries()) {
      const midnight = index * MINUTES_PER_DAY;
      const start = Math.max(0, phase.start - midnight);
      const end = Math.min(LAST_MINUTE, phase.end - midnight);
      if (end <= start) continue;
      const rideStart = phase.key === 'ride' && firstSegment;
      day.activities.push({
        id: rideStart ? booking.itineraryActivityId : `booking-${booking.id}-${phase.key}-${day.date}`,
        bookingId: booking.id, kind: 'transport', title: `${phase.title}${firstSegment ? '' : '（续）'}`,
        period: inferPeriodFromTime(clock(start)), startTime: clock(start), endTime: clock(end),
        city: phase.city, location: phase.location, transportMode: phase.mode, description: phase.description,
        meal: null, locked: false, photo: null, sourceIds: [],
        costs: rideStart ? rideCosts : [], fromActivityId: null, toActivityId: null,
      });
      firstSegment = false;
    }
  }
  if (leave < 0) content.warnings.push(`「${booking.title}」预计需在行程开始前出发，请查看预订并安排前一晚接驳。`);
  if (arrive + onward >= content.days.length * MINUTES_PER_DAY) {
    content.warnings.push(`「${booking.title}」的到达或接驳超出行程日期，请按订单另行安排。`);
  }
  return { start: leave, end: arrive + onward, booking, leave, depart, arrive, fromCity, toCity };
}

/** 把不可移动的订单与锁定项目当作区间，按实际可用空档放回活动，优先保留游玩时长。 */
function freeWindows(occupied: TimeWindow[], lower: number, upper: number) {
  const available: TimeWindow[] = [];
  let cursor = lower;
  for (const block of occupied) {
    if (block.end <= cursor || block.start >= upper) continue;
    if (block.start > cursor) available.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < upper) available.push({ start: cursor, end: upper });
  return available;
}

function scheduleDay(activities: PlannerActivity[], windows: BookingWindow[], midnight: number, skipBreakfast: boolean) {
  const occupied = activities.filter((activity) => activity.bookingId || activity.locked)
    .map((activity) => ({ start: minutes(activity.startTime), end: minutes(activity.endTime) }))
    .sort((a, b) => a.start - b.start);
  const flexible = activities.filter((activity) => !activity.bookingId && !activity.locked)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const lastEndByCity = new Map<string, number>();
  for (const activity of flexible) {
    const base: NonNullable<PlannerActivity['bookingTiming']> = {
      startTime: activity.startTime, endTime: activity.endTime, period: activity.period,
    };
    const city = placeKey(activity.city);
    let lower = Math.max(Math.min(minutes(activity.startTime), 7 * 60), lastEndByCity.get(city) ?? 0);
    let upper = Math.max(minutes(activity.endTime), 22 * 60);
    // 跨城当天，出发地活动必须在接驳前结束，到达地活动要等出站之后。
    for (const window of windows) {
      const from = placeKey(window.fromCity);
      const to = placeKey(window.toCity);
      if (!city || !from || !to || from === to) continue;
      // 多票联程时允许在同一天回到同一座城市，按原活动所在的出发或抵达一侧限制。
      if (city === from && !windows.some((other) => other !== window && placeKey(other.toCity) === city && other.arrive > window.depart
        && minutes(activity.startTime) + midnight >= other.arrive)) upper = Math.min(upper, window.leave - midnight);
      if (city === to && !windows.some((other) => other !== window && placeKey(other.fromCity) === city && other.depart < window.arrive
        && minutes(activity.startTime) + midnight < other.depart)) lower = Math.max(lower, window.end - midnight);
    }
    const isReplacedTransfer = activity.kind === 'transport' && windows.some(({ booking }) => {
      const estimateId = booking.estimatedLeg?.activity.id ?? booking.itineraryActivityId;
      if (activity.toActivityId === estimateId || activity.fromActivityId === estimateId) return true;
      const text = `${activity.title} ${activity.location}`;
      return /前往|出站|接驳|送站|接站|去机场/.test(text)
        && [booking.fromLocation, booking.toLocation].some((station) => station && text.includes(station));
    });
    if (isReplacedTransfer) {
      activity.bookingTiming = { ...base, deferred: 'replaced-transfer' };
      continue;
    }
    const originalStart = minutes(base.startTime);
    const duration = minutes(base.endTime) - originalStart;
    const minimum = activity.kind === 'transport' ? duration : Math.min(duration, 30);
    const slots = freeWindows(occupied, lower, upper)
      .filter((slot) => slot.end - slot.start >= minimum)
      .map((slot) => {
        const length = Math.min(duration, slot.end - slot.start);
        const start = Math.min(Math.max(originalStart, slot.start), slot.end - length);
        return { start, end: start + length, length };
      }).sort((a, b) => b.length - a.length || Math.abs(a.start - originalStart) - Math.abs(b.start - originalStart));
    const chosen = slots[0];
    if (!chosen) {
      activity.bookingTiming = { ...base, deferred: 'no-time' };
      continue;
    }
    occupied.push(chosen);
    occupied.sort((a, b) => a.start - b.start);
    lastEndByCity.set(city, chosen.end);
    if (chosen.start === originalStart && chosen.length === duration) continue;
    activity.bookingTiming = base;
    const nextStart = clock(chosen.start);
    retimeMeal(activity, base, nextStart, skipBreakfast);
    activity.startTime = nextStart;
    activity.endTime = clock(chosen.end);
    activity.period = inferPeriodFromTime(activity.startTime);
  }
}

/** 每次从原估算重排，避免多次改签后累计缩短行程；活动及费用编号仍用于地图、备份和编辑。 */
export function syncTransportBookings(input: PlannerContent, bookings: readonly BookingRecord[], previous = bookings): PlannerContent {
  const managed = [...previous, ...bookings].filter((item) => item.itineraryActivityId);
  if (!managed.length) return input;
  const content = structuredClone(input);
  const managedIds = new Set(managed.map((booking) => booking.itineraryActivityId));
  const managedBookingIds = new Set(managed.map((booking) => booking.id));
  for (const day of content.days) {
    day.activities = day.activities.filter((activity) =>
      !managedIds.has(activity.id) && !managedBookingIds.has(activity.bookingId ?? '') &&
      !managed.some((booking) => activity.id.startsWith(`booking-${booking.id}-`)));
    for (const activity of day.activities) restoreBookingActivity(activity);
  }
  const activeIds = new Set(bookings.filter((booking) => booking.itineraryActivityId).map((booking) => booking.id));
  for (const booking of previous) {
    if (activeIds.has(booking.id) || !booking.estimatedLeg) continue;
    const { date, activity } = booking.estimatedLeg;
    content.days.find((day) => day.date === date)?.activities.push(structuredClone(activity));
  }
  content.warnings = content.warnings.filter((warning) =>
    !/^\d{4}-\d{2}-\d{2}「.+」与「.+」时间重叠$/.test(warning) &&
    !/预计需在行程开始前出发|的到达或接驳超出行程日期/.test(warning));
  const windows = bookings.filter((booking) => booking.itineraryActivityId)
    .map((booking) => addBookingWindow(content, booking)).filter((window): window is BookingWindow => Boolean(window));
  for (const [index, day] of content.days.entries()) {
    const midnight = index * MINUTES_PER_DAY;
    const limits = windows.filter((window) => window.end > midnight && window.start < midnight + MINUTES_PER_DAY);
    if (limits.length) scheduleDay(day.activities, limits, midnight, content.request.skipBreakfast);
    // 换走当天唯一的预订后仍保留日期和可编辑的时间轴。
    if (!day.activities.length) day.activities.push({
      id: `booking-empty-${day.date}`, kind: 'rest', title: '当天待安排', startTime: '09:00', endTime: '09:30',
      period: 'morning', city: '', location: '', description: '可按新的车次或航班补充当天安排。',
      transportMode: '', meal: null, locked: false, photo: null, sourceIds: [], costs: [], fromActivityId: null, toActivityId: null,
    });
    day.activities.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  const activities = content.days.flatMap((day) => day.activities);
  const ids = new Set(activities.map((activity) => activity.id));
  for (const activity of activities) {
    if (activity.fromActivityId && !ids.has(activity.fromActivityId)) activity.fromActivityId = null;
    if (activity.toActivityId && !ids.has(activity.toActivityId)) activity.toActivityId = null;
  }
  const costs = [...activities.flatMap((activity) => activity.costs), ...content.days.flatMap((day) => day.lodging?.costs ?? [])];
  const costIds = new Set(costs.map((cost) => cost.id));
  for (const cost of costs) if (cost.includedIn && !costIds.has(cost.includedIn)) cost.includedIn = null;
  return content;
}
