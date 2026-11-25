import type { AiTravelPlan, BookingRecord, TicketReminderSetting } from './planner-types';

export type MergedTicketPlanItem = NonNullable<AiTravelPlan['ticketPlan']>['items'][number] & {
  /** 来自“未购买车次/航班”录入时附带原预订 ID，便于展示标签。 */
  fromUnpurchasedBookingId?: string;
};

/** 12306 预售期 15 天（含乘车日），使用 UTC 日历运算避免时区跨日。 */
export function railwaySaleDate(travelDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) return '';
  const date = new Date(`${travelDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

/** 旧计划没有结构化预约标记时，识别明确的“无需预约”结论；规则未知仍保留。 */
export function needsTicketPreparation(item: { bookingRequired?: boolean; platform: string; note: string }): boolean {
  if (typeof item.bookingRequired === 'boolean') return item.bookingRequired;
  return !/无需预约|不需预约|不需要预约|无需抢票|无需购票|无门票与预约环节/.test(`${item.platform} ${item.note}`);
}

/** 将用户录入的“未购买”车次与航班同步转换为抢票计划条目。 */
export function buildUnpurchasedBookingTicketItems(bookings: readonly BookingRecord[] = []): MergedTicketPlanItem[] {
  return bookings
    .filter((b) => (b.kind === 'train' || b.kind === 'flight') && b.purchaseStatus === 'unpurchased')
    .map((booking) => {
      const isFlight = booking.kind === 'flight';
      const route = [booking.fromLocation, booking.toLocation].filter(Boolean).join(' → ');
      const timeRange = [booking.startTime, booking.endTime].filter(Boolean).join('—');
      const codePrefix = booking.code ? `${booking.code} ` : '';
      const title = `${isFlight ? '航班' : '车次'} ${codePrefix}${route || booking.title}`.trim();
      const saleDate = isFlight ? '' : railwaySaleDate(booking.date);
      const noteParts = [
        timeRange ? `计划班次：${timeRange}` : '',
        booking.seatOrRoom ? `预期席别/舱位：${booking.seatOrRoom}` : '',
        booking.note ? booking.note : '',
        isFlight
          ? '尚未购票，建议关注机票价格波动并提前设置抢票/出票提醒。'
          : '尚未购票，铁路预售期 15 天（含乘车日），请核对出发站起售时刻并开启提前提醒。',
      ].filter(Boolean);
      return {
        activityId: `booking-ticket-${booking.id}`,
        title,
        travelDate: booking.date,
        saleDate,
        saleTime: '',
        difficulty: isFlight ? '待购票' : '中',
        platform: isFlight ? '航司官网 / 携程 / 去哪儿' : '铁路12306',
        note: noteParts.join(' · '),
        bookingRequired: true,
        sources: isFlight
          ? []
          : [{ title: '12306 预售期说明', url: 'https://help.12306.cn/cms/answer/h5/001531826595438842083440b580b2e0' }],
        fromUnpurchasedBookingId: booking.id,
      };
    });
}

/** 合并 AI 生成的抢票计划与用户录入的未购买车次/航班，避免同一车次重复展示。 */
export function mergeTicketPlanItems(plan: AiTravelPlan): MergedTicketPlanItem[] {
  const unpurchasedBookings = (plan.bookings ?? []).filter(
    (b) => (b.kind === 'train' || b.kind === 'flight') && b.purchaseStatus === 'unpurchased',
  );
  const replacedActivityIds = new Set(
    unpurchasedBookings.map((b) => b.itineraryActivityId).filter((id): id is string => Boolean(id)),
  );
  const bookingItems = buildUnpurchasedBookingTicketItems(plan.bookings);
  const aiItems: MergedTicketPlanItem[] = (plan.ticketPlan?.items ?? []).filter(
    (item) => !replacedActivityIds.has(item.activityId),
  );
  return [...bookingItems, ...aiItems].sort(
    (left, right) =>
      `${left.saleDate || '9999'} ${left.saleTime || '99:99'}`.localeCompare(
        `${right.saleDate || '9999'} ${right.saleTime || '99:99'}`,
      ) || Number(right.difficulty === '难') - Number(left.difficulty === '难'),
  );
}

export const DEFAULT_TICKET_REMINDER_LEAD_MINUTES = 20;

export interface ParsedTicketSchedule {
  /** YYYY-MM-DD（若无法解析则为空串） */
  dateStr: string;
  /** HH:mm（若原文无时刻则默认 08:00） */
  timeStr: string;
  /** 是否显式解析出了时刻（或用户自定义了时刻） */
  hasExplicitTime: boolean;
  /** 开售本地时间戳（毫秒），无效时为 null */
  saleMs: number | null;
  /** 提醒触发本地时间戳（毫秒），无效时为 null */
  triggerMs: number | null;
}

/** 从抢票条目与用户自定义覆盖中解析出精确开售时刻与提醒触发时刻。 */
export function resolveTicketReminderSchedule(
  item: Pick<MergedTicketPlanItem, 'saleDate' | 'saleTime' | 'travelDate'>,
  setting?: Pick<TicketReminderSetting, 'leadMinutes' | 'customSaleDate' | 'customSaleTime'>,
): ParsedTicketSchedule {
  const rawDate = (setting?.customSaleDate || item.saleDate || '').trim();
  const dateMatch = rawDate.match(/(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch ? dateMatch[1] : '';

  const rawTime = (setting?.customSaleTime || item.saleTime || '').trim();
  const hhmmMatch = rawTime.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
  const cnHourMatch = !hhmmMatch ? rawTime.match(/(上午|下午|晚上|晚间)?\s*(\d{1,2})\s*[点时](半)?/) : null;
  let timeStr = '08:00';
  let hasExplicitTime = false;
  if (hhmmMatch) {
    timeStr = `${hhmmMatch[1].padStart(2, '0')}:${hhmmMatch[2]}`;
    hasExplicitTime = true;
  } else if (cnHourMatch) {
    let hour = Number(cnHourMatch[2]);
    if ((cnHourMatch[1] === '下午' || cnHourMatch[1] === '晚上' || cnHourMatch[1] === '晚间') && hour < 12) {
      hour += 12;
    }
    if (hour >= 0 && hour <= 23) {
      timeStr = `${String(hour).padStart(2, '0')}:${cnHourMatch[3] ? '30' : '00'}`;
      hasExplicitTime = true;
    }
  }

  if (!dateStr) {
    return { dateStr: '', timeStr, hasExplicitTime, saleMs: null, triggerMs: null };
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const saleDateObj = new Date(y, m - 1, d, hh, mm, 0, 0);
  const saleMs = Number.isFinite(saleDateObj.getTime()) ? saleDateObj.getTime() : null;
  const lead = Number.isFinite(setting?.leadMinutes)
    ? Math.max(1, Math.min(1440, Math.round(setting!.leadMinutes)))
    : DEFAULT_TICKET_REMINDER_LEAD_MINUTES;
  const triggerMs = saleMs != null ? saleMs - lead * 60_000 : null;
  return { dateStr, timeStr, hasExplicitTime, saleMs, triggerMs };
}

export function formatReminderClock(ms: number): string {
  const d = new Date(ms);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hh}:${mm}`;
}

export interface TicketUrgencyInfo {
  urgentCount: number;
  soonestMs: number | null;
  soonestTitle: string;
  soonestLabel: string;
}

const TICKET_POST_OPEN_GRACE_MS = 30 * 60_000; // 开售后 30 分钟内仍保持红点提醒（与提醒弹窗窗口一致）

/** 判断单个抢票条目是否满足“已开启通知且已进入提前提醒窗口（默认 20 分钟内）或正在开抢”。 */
export function isTicketReminderUrgent(
  item: Pick<MergedTicketPlanItem, 'saleDate' | 'saleTime' | 'travelDate' | 'bookingRequired' | 'platform' | 'note'>,
  setting?: TicketReminderSetting,
  now = Date.now(),
): boolean {
  if (!setting?.enabled) return false;
  if (!needsTicketPreparation(item)) return false;
  const schedule = resolveTicketReminderSchedule(item, setting);
  if (schedule.saleMs == null || schedule.triggerMs == null) return false;
  return now >= schedule.triggerMs && now <= schedule.saleMs + TICKET_POST_OPEN_GRACE_MS;
}

/** 计算单个旅行计划中已开启通知且到达提醒窗口（默认开售前 20 分钟内）的抢票条目数量与最近倒计时文案。 */
export function getUpcomingTicketUrgency(plan: AiTravelPlan, now = Date.now()): TicketUrgencyInfo {
  const items = mergeTicketPlanItems(plan);
  let urgentCount = 0;
  let soonestMs: number | null = null;
  let soonestTitle = '';

  for (const item of items) {
    const setting = plan.ticketReminders?.[item.activityId];
    if (!isTicketReminderUrgent(item, setting, now)) continue;
    const schedule = resolveTicketReminderSchedule(item, setting);
    if (schedule.saleMs == null) continue;
    urgentCount += 1;
    if (soonestMs == null || schedule.saleMs < soonestMs) {
      soonestMs = schedule.saleMs;
      soonestTitle = item.title;
    }
  }

  let soonestLabel = '';
  if (soonestMs != null) {
    const diff = soonestMs - now;
    if (diff <= 0) {
      soonestLabel = '正在开抢';
    } else if (diff <= 60 * 60_000) {
      soonestLabel = `${Math.max(1, Math.ceil(diff / 60_000))} 分钟后开抢`;
    } else if (diff <= 24 * 60 * 60_000) {
      soonestLabel = `${Math.max(1, Math.ceil(diff / (60 * 60_000)))} 小时后开抢`;
    } else {
      soonestLabel = '即将开抢';
    }
  }

  return { urgentCount, soonestMs, soonestTitle, soonestLabel };
}

/** 汇总所有旅行计划中即将开抢的条目总数，用于导航栏消息红点提示。 */
export function countAllUpcomingUrgentTickets(plans: readonly AiTravelPlan[], now = Date.now()): number {
  let total = 0;
  for (const plan of plans) {
    total += getUpcomingTicketUrgency(plan, now).urgentCount;
  }
  return total;
}
