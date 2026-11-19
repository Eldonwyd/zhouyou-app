import type {
  AiTravelPlan,
  BookingKind,
  BookingRecord,
  PlannerActivity,
  PlannerContent,
} from './planner-types.ts';
import { bookingLedgerDates } from './finance.ts';
import { createLocalId } from './utils.ts';
import { plannerValueEqual, validatePlannerContent } from './planner-domain.ts';
import {
  bookingMealNeedsUpdate, inferPeriodFromTime, isTransportBooking, legacyTransportActivity, matchTransportLeg,
  restoreBookingActivity, syncTransportBookings, validateTransportBooking,
} from './planner-booking-schedule.ts';

export { bookingArrivalDate, bookingConnectionTimes, isTransportBooking, pendingTransportLegs, bookingTransportTiming, validateTransportBooking } from './planner-booking-schedule.ts';

export const BOOKING_KIND_LABELS: Record<BookingKind, string> = {
  train: '高铁 / 火车',
  flight: '航班',
  hotel: '酒店住宿',
  ticket: '门票 / 预约',
  other: '其他订单',
};

export { inferPeriodFromTime };

function normalizeTime(raw: string, fallback: string): string {
  const match = String(raw || '').trim().match(/^([01]?\d|2[0-3])[:：]([0-5]\d)$/);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function ensureValidTimeRange(startRaw: string, endRaw: string): { startTime: string; endTime: string } {
  const startTime = normalizeTime(startRaw, '09:00');
  const endCandidate = normalizeTime(endRaw, '');
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const startMin = toMin(startTime);
  if (endCandidate && toMin(endCandidate) > startMin) return { startTime, endTime: endCandidate };
  const endMin = Math.min(23 * 60 + 55, startMin + 60);
  const hh = String(Math.floor(endMin / 60)).padStart(2, '0');
  const mm = String(endMin % 60).padStart(2, '0');
  return { startTime, endTime: `${hh}:${mm}` };
}

/** 构造一条干净的空白预订草稿。 */
export function emptyBookingDraft(kind: BookingKind, defaultDate: string, defaultCity: string): BookingRecord {
  return {
    id: createLocalId(),
    kind,
    title: '',
    code: '',
    date: defaultDate,
    endDate: '',
    startTime: kind === 'hotel' ? '14:00' : '',
    endTime: kind === 'hotel' ? '12:00' : '',
    fromLocation: '',
    toLocation: '',
    city: defaultCity,
    hotelName: '',
    amountYuan: null,
    seatOrRoom: '',
    note: '',
    createdAt: new Date().toISOString(),
  };
}

/** 校验并生成可读标题，保证即使手动只填车次或酒店名也能落库。 */
export function finalizeBookingRecord(draft: BookingRecord): BookingRecord {
  const kind = draft.kind;
  const code = draft.code.trim().toUpperCase();
  const hotelName = draft.hotelName.trim();
  const fromLocation = draft.fromLocation.trim();
  const toLocation = draft.toLocation.trim();
  const city = draft.city.trim();
  const route = [fromLocation, toLocation].filter(Boolean).join(' → ');
  const fallbackTitle =
    kind === 'hotel'
      ? hotelName || '已预订酒店'
      : kind === 'train'
        ? [code || '火车/高铁', route].filter(Boolean).join(' ')
        : kind === 'flight'
          ? [code || '航班', route].filter(Boolean).join(' ')
          : draft.title.trim() || '已预订项目';
  const title = isTransportBooking(draft) || kind === 'hotel' ? fallbackTitle : draft.title.trim() || fallbackTitle;
  const amountYuan =
    draft.amountYuan == null || !Number.isFinite(draft.amountYuan)
      ? null
      : Math.round(Math.max(0, draft.amountYuan) * 100) / 100;
  return {
    ...draft,
    id: draft.id || createLocalId(),
    title,
    code,
    hotelName,
    fromLocation,
    toLocation,
    city,
    startTime: normalizeTime(draft.startTime, ''),
    endTime: normalizeTime(draft.endTime, ''),
    seatOrRoom: draft.seatOrRoom.trim(),
    note: draft.note.trim(),
    amountYuan,
    createdAt: draft.createdAt || new Date().toISOString(),
  };
}

/** 已录入住宿和住宿费用按日期同步。酒店更新不调用交通排程。 */
function syncHotelBookings(content: PlannerContent, hotels: Record<string, string>, previous: readonly BookingRecord[], next: readonly BookingRecord[]) {
  const previousHotels = previous.filter((item) => item.kind === 'hotel' && item.backfilledToPlan);
  const nextHotels = next.filter((item) => item.kind === 'hotel' && item.backfilledToPlan);
  for (const order of previousHotels) {
    for (const date of bookingLedgerDates(order)) if (hotels[date] === order.hotelName) delete hotels[date];
  }
  for (const day of content.days) {
    if (!day.lodging) continue;
    if (day.lodging.bookingOriginalCosts) {
      day.lodging.costs = day.lodging.bookingOriginalCosts;
      delete day.lodging.bookingOriginalCosts;
    } else {
      const old = previousHotels.find((order) => bookingLedgerDates(order).includes(day.date));
      if (old) day.lodging.costs = day.lodging.costs.filter((cost) => cost.status !== 'booked' || cost.label !== `${old.hotelName}（已订）`);
    }
  }
  for (const order of [...nextHotels].reverse()) {
    const dates = bookingLedgerDates(order);
    const cents = order.amountYuan == null ? null : Math.round(order.amountYuan * 100);
    for (const [index, date] of dates.entries()) {
      const lodging = content.days.find((day) => day.date === date)?.lodging;
      hotels[date] = order.hotelName;
      if (!lodging || cents == null) continue;
      lodging.bookingOriginalCosts ??= lodging.costs;
      const share = Math.floor(cents / dates.length) + Number(index < cents % dates.length);
      lodging.costs = [{
        id: lodging.bookingOriginalCosts[0]?.id ?? `booking-hotel-${order.id}-${date}`,
        label: `${order.hotelName}（已订）`, category: 'lodging', unit: 'group', unitPriceCents: share,
        studentPriceCents: null, quantity: 1, occurrences: 1, status: 'booked',
        qualification: [order.seatOrRoom, order.note].filter(Boolean).join(' · '), sourceIds: [], includedIn: null,
      }];
    }
  }
}

/** 用新订单替换同一条预订，交通改签从原始估算重排，其他订单仍沿用原回填逻辑。 */
function changeCoreBooking(plan: AiTravelPlan, booking: BookingRecord | undefined, bookingId: string, targetActivityId?: string) {
  const previous = plan.bookings ?? [];
  const original = previous.find((item) => item.id === bookingId);
  if (booking && isTransportBooking(booking)) {
    validateTransportBooking(booking);
    if (!plan.content.days.some((day) => day.date === booking.date)) {
      throw new Error('出发日期不在当前行程内，请修改行程日期或核对订单。');
    }
    const legacy = original && legacyTransportActivity(plan.content, original);
    const explicitDay = targetActivityId && plan.content.days.find((day) => day.activities.some((activity) => activity.id === targetActivityId));
    const explicitActivity = explicitDay && explicitDay.activities.find((activity) => activity.id === targetActivityId && !activity.locked && !activity.bookingId);
    const match = !targetActivityId && !original?.itineraryActivityId
      ? matchTransportLeg(plan.content, booking, previous) : undefined;
    const estimate = explicitActivity && explicitDay ? { date: explicitDay.date, activity: explicitActivity } : match;
    if (legacy?.locked) throw new Error(`「${legacy.title}」已锁定，请先解锁该交通卡片。`);
    if (targetActivityId && targetActivityId !== 'new' && !explicitActivity && !original?.itineraryActivityId) {
      throw new Error('原预估交通段已更新，请重新选择需要替换的行程卡片。');
    }
    booking.itineraryActivityId = original?.itineraryActivityId ?? legacy?.id ?? estimate?.activity.id ?? `booking-${booking.id}-ride`;
    const originalEstimate = estimate && !estimate.activity.locked ? estimate : undefined;
    booking.estimatedLeg = original?.estimatedLeg ?? (originalEstimate ? structuredClone({
      date: originalEstimate.date, activity: originalEstimate.activity,
    }) : undefined);
  }
  const bookings = original
    ? previous.flatMap((item) => item.id !== bookingId ? [item] : booking ? [booking] : [])
    : booking ? [booking, ...previous] : previous;
  const hotels = { ...plan.hotels };
  let content = plan.content;
  if ((booking && isTransportBooking(booking)) || (original && isTransportBooking(original))) {
    const legacyId = original && legacyTransportActivity(plan.content, original)?.id;
    const oldBooking = legacyId && original ? { ...original, itineraryActivityId: legacyId } : original;
    content = syncTransportBookings(content, bookings, previous.map((item) => item.id === oldBooking?.id ? oldBooking : item));
  }
  if (booking?.kind === 'hotel' || original?.kind === 'hotel') {
    if (content === plan.content) content = structuredClone(content);
    syncHotelBookings(content, hotels, previous, bookings);
  }
  return saveBookingChange(plan, content, hotels, bookings, booking
    ? `${original ? '更新' : '录入'}预订：${booking.title}` : `移除预订：${original?.title ?? ''}`);
}

function saveBookingChange(plan: AiTravelPlan, content: PlannerContent, hotels: Record<string, string>, bookings: BookingRecord[], reason: string): AiTravelPlan {
  const now = new Date().toISOString();
  const version = plan.version + 1;
  return {
    ...plan, version, updatedAt: now, hotels, bookings, content,
    contentVersion: content !== plan.content ? version : plan.contentVersion ?? plan.version,
    history: content === plan.content ? plan.history : [
      ...plan.history.slice(-29),
      { version: plan.version, savedAt: now, reason, content: structuredClone(plan.content) },
    ],
  };
}

export function removeBookingFromPlan(plan: AiTravelPlan, bookingId: string) {
  return changeCoreBooking(plan, undefined, bookingId);
}

export function hotelBookingForDay(plan: AiTravelPlan, date: string) {
  return plan.bookings?.find((booking) => booking.kind === 'hotel' && booking.hotelName === plan.hotels?.[date]
    && booking.date <= date && (booking.endDate > booking.date ? date < booking.endDate : date === booking.date));
}

/** 旧订单没有关联编号。识别同日的旧卡片并重排，保留原版本号，后续保存仍做版本校验。 */
export function upgradeLegacyBookingSchedule(plan: AiTravelPlan): AiTravelPlan {
  let upgraded = plan;
  for (const booking of plan.bookings ?? []) {
    if (!legacyTransportActivity(upgraded.content, booking)) continue;
    try {
      const next = applyBookingToPlan(upgraded, booking);
      validatePlannerContent(next.content);
      upgraded = next;
    } catch { /* 旧订单字段不齐时保留原数据，用户可从预订面板补齐。 */ }
  }
  // 旧版只挪动时间，重算这些餐饮的标题、说明和费用。已有新字段的安排无需重复处理。
  if (upgraded.bookings?.some((item) => item.itineraryActivityId) && upgraded.content.days.some((day) =>
    day.activities.some((activity) => {
      const timing = activity.bookingTiming;
      return timing && !timing.originalMeal && !timing.deferred && !activity.locked
        && bookingMealNeedsUpdate(activity, timing.startTime, activity.startTime);
    }))) {
    try {
      const content = syncTransportBookings(upgraded.content, upgraded.bookings);
      validatePlannerContent(content);
      upgraded = { ...upgraded, content };
    } catch { /* 数据不完整的旧订单继续使用已保存的时间。 */ }
  }
  return upgraded === plan ? plan : {
    ...upgraded, version: plan.version, contentVersion: plan.contentVersion, updatedAt: plan.updatedAt, history: plan.history,
  };
}

/** 发给模型的是游玩计划。票面、接驳和住宿订单费用在模型返回后由本机重新套用。 */
export function plannerContentForAi(plan: AiTravelPlan): PlannerContent {
  const bookings = plan.bookings ?? [];
  if (!bookings.some((booking) => booking.itineraryActivityId || booking.kind === 'hotel')) return plan.content;
  const content = structuredClone(plan.content);
  const managed = new Set(bookings.map((booking) => booking.itineraryActivityId).filter(Boolean));
  for (const day of content.days) {
    day.activities = day.activities.filter((activity) => !activity.bookingId && !managed.has(activity.id));
    for (const activity of day.activities) restoreBookingActivity(activity);
    if (!day.activities.length) day.activities.push({
      id: `booking-empty-${day.date}`, kind: 'rest', title: '当天待安排', startTime: '09:00', endTime: '09:30',
      period: 'morning', city: '', location: '', description: '', transportMode: '', meal: null, locked: false, photo: null,
      sourceIds: [], costs: [], fromActivityId: null, toActivityId: null,
    });
  }
  syncHotelBookings(content, {}, bookings, []);
  const activities = content.days.flatMap((day) => day.activities);
  const ids = new Set(activities.map((activity) => activity.id));
  for (const activity of activities) {
    if (activity.fromActivityId && !ids.has(activity.fromActivityId)) activity.fromActivityId = null;
    if (activity.toActivityId && !ids.has(activity.toActivityId)) activity.toActivityId = null;
  }
  const costs = [...activities.flatMap((activity) => activity.costs), ...content.days.flatMap((day) => day.lodging?.costs ?? [])];
  const costIds = new Set(costs.map((cost) => cost.id));
  for (const cost of costs) if (cost.includedIn && !costIds.has(cost.includedIn)) cost.includedIn = null;
  content.warnings = content.warnings.filter((warning) => !/预计需在行程开始前出发|的到达或接驳超出行程日期|时间重叠$/.test(warning));
  return content;
}

/** AI 修改和历史恢复后仍以当前订单为准，活动自己改过的时间则成为新的排程偏好。 */
export function reconcileBookedContent(plan: AiTravelPlan, candidate: PlannerContent) {
  const bookings = plan.bookings ?? [];
  if (!bookings.some((item) => item.itineraryActivityId || (item.kind === 'hotel' && item.backfilledToPlan))) return candidate;
  const content = structuredClone(candidate);
  const previous = new Map(plan.content.days.flatMap((day) => day.activities.map((activity) => [activity.id, activity])));
  for (const day of content.days) for (const activity of day.activities) {
    const old = previous.get(activity.id);
    if (old?.bookingTiming && ((activity.startTime === old.startTime && activity.endTime === old.endTime)
      || (activity.startTime === old.bookingTiming.startTime && activity.endTime === old.bookingTiming.endTime))) {
      const timing = { ...old.bookingTiming };
      if (timing.originalMeal) {
        // 手动编辑或 AI 返回的新文案成为重算时的原始内容，避免恢复时覆盖用户修改。
        const previous = timing.originalMeal;
        timing.originalMeal = {
          title: activity.title === old.title ? previous.title : activity.title,
          description: activity.description === old.description ? previous.description : activity.description,
          meal: activity.meal === old.meal ? previous.meal : activity.meal,
          costs: plannerValueEqual(activity.costs, old.costs) ? previous.costs : activity.costs,
        };
      }
      activity.bookingTiming = timing;
    } else if (old && (activity.startTime !== old.startTime || activity.endTime !== old.endTime)) {
      delete activity.bookingTiming;
    }
  }
  if (bookings.some((item) => item.itineraryActivityId && !content.days.some((day) => day.date === item.date))) {
    throw new Error('新日期没有覆盖已录入的车票或机票。请先在预订面板核对并更新相应订单。');
  }
  syncHotelBookings(content, { ...plan.hotels }, bookings, bookings);
  return syncTransportBookings(content, bookings);
}

/**
 * 将结构化预订信息写入计划，并按需一键回填到具体酒店或当天行程活动卡。
 * 不改动锁定卡片；不保存任何原始截图。
 */
export function applyBookingToPlan(
  plan: AiTravelPlan,
  rawBooking: BookingRecord,
  options: { updatePlan?: boolean; targetActivityId?: string | 'new'; backfilledToLedger?: boolean } = {},
): AiTravelPlan {
  const booking = finalizeBookingRecord({
    ...rawBooking,
    backfilledToPlan: options.updatePlan === true || isTransportBooking(rawBooking) || rawBooking.kind === 'hotel',
    backfilledToLedger: options.backfilledToLedger ?? rawBooking.backfilledToLedger,
  });
  if (isTransportBooking(booking) || booking.kind === 'hotel') {
    return changeCoreBooking(plan, booking, booking.id, options.targetActivityId);
  }
  const content = options.updatePlan ? structuredClone(plan.content) : plan.content;
  const day = options.updatePlan ? content.days.find((item) => item.date === booking.date) ?? content.days[0] : undefined;
  if (day) {
    const { startTime, endTime } = ensureValidTimeRange(booking.startTime, booking.endTime);
    const description = [
      booking.code && `单号：${booking.code}`,
      booking.seatOrRoom && `规格：${booking.seatOrRoom}`,
      booking.note,
    ].filter(Boolean).join('；');
    const costs = booking.amountYuan == null ? [] : [{
      id: createLocalId(), label: booking.title, category: booking.kind === 'ticket' ? 'tickets' as const : 'other' as const,
      unit: 'group' as const, unitPriceCents: Math.round(booking.amountYuan * 100), studentPriceCents: null,
      quantity: 1, occurrences: 1, status: 'booked' as const, qualification: '', sourceIds: [], includedIn: null,
    }];
    const target = day.activities.find((activity) => activity.id === options.targetActivityId && !activity.locked && !activity.bookingId);
    const fields = { startTime, endTime, period: inferPeriodFromTime(startTime), title: booking.title };
    if (target) {
      Object.assign(target, fields);
      if (booking.city) target.city = booking.city;
      if (booking.toLocation) target.location = booking.toLocation;
      if (description) target.description = [description, target.description].filter(Boolean).join('\n');
      if (costs.length) target.costs = costs;
    } else {
      const activity: PlannerActivity = {
        ...fields, id: createLocalId(), kind: booking.kind === 'ticket' ? 'sight' : 'rest',
        city: booking.city || day.activities[0]?.city || content.cities[0]?.name || '',
        location: booking.toLocation || booking.title, description: description || '已确认预订',
        transportMode: '', meal: null, locked: false, photo: null, sourceIds: [], costs,
        fromActivityId: null, toActivityId: null,
      };
      day.activities.push(activity);
    }
    day.activities.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  const previous = plan.bookings ?? [];
  const bookings = previous.some((item) => item.id === booking.id)
    ? previous.map((item) => item.id === booking.id ? booking : item) : [booking, ...previous];
  return saveBookingChange(plan, content, { ...plan.hotels }, bookings, `录入预订：${booking.title}`);
}
