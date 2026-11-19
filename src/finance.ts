import type { CategoryAmounts, ExpenseAmounts, ExpenseCategory, ExpenseSplitItem, TripPlan } from './types.ts';
import { emptyAmounts } from './types.ts';
import type { BookingRecord, PlannerActivity, PlannerContent, PlannerCost } from './planner-types.ts';
import { calculatePlannerBudget, plannerFillEstimates } from './planner-domain.ts';

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', transport: '交通',
  tickets: '门票', other: '其他', lodging: '住宿',
};
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_LABELS) as ExpenseCategory[];

/** 计算时统一转为分，避免 0.1 + 0.2 的浮点误差进入汇总。 */
export function expenseTotal(amounts: ExpenseAmounts): number {
  return EXPENSE_CATEGORIES.reduce((total, key) => total + Math.round((amounts[key] ?? 0) * 100), 0) / 100;
}

/** 旧分类原样转为整程补充项；没有记录过的三餐仍保持空白。 */
export function overallExpenses(plan: TripPlan): ExpenseAmounts {
  return plan.overallExpenses ?? {
    transport: plan.actual.transport, lodging: plan.actual.lodging,
    tickets: plan.actual.tickets, other: plan.actual.other,
  };
}

export function unallocatedFood(plan: TripPlan): number {
  return plan.unallocatedFood ?? (plan.overallExpenses ? 0 : plan.actual.food);
}

/** 整程汇总包含所有日账和整程补充项，包括调整行程日期前已经保存的账单。 */
export function expenseTotals(plan: TripPlan): ExpenseAmounts {
  const amounts = [overallExpenses(plan), ...Object.values(plan.dailyExpenses ?? {})];
  return Object.fromEntries(EXPENSE_CATEGORIES.map((key) => [key,
    amounts.reduce((total, row) => total + Math.round((row[key] ?? 0) * 100), 0) / 100,
  ]));
}

/** 同步旧五分类汇总，保证费用卡片、导出及旧页面读取到相同总数。 */
export function updateExpenses(plan: TripPlan, changes: Pick<TripPlan, 'dailyExpenses' | 'overallExpenses' | 'unallocatedFood'>): TripPlan {
  const next = { ...plan, overallExpenses: overallExpenses(plan), unallocatedFood: unallocatedFood(plan), ...changes, manualActualTotal: null };
  const totals = expenseTotals(next);
  const actual: CategoryAmounts = emptyAmounts();
  for (const key of ['transport', 'lodging', 'tickets', 'other'] as const) actual[key] = totals[key] ?? 0;
  actual.food = (Math.round((totals.breakfast ?? 0) * 100) + Math.round((totals.lunch ?? 0) * 100)
    + Math.round((totals.dinner ?? 0) * 100) + Math.round(unallocatedFood(next) * 100)) / 100;
  return { ...next, actual };
}

/** 日期使用 UTC 递增以避开夏令时；已存日账的日期始终可选。 */
export function expenseDates(start: string, end: string, saved: string[]): string[] {
  const dates = new Set(saved);
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (Number.isFinite(first) && Number.isFinite(last)) {
    for (let day = first; day <= last; day += 86400000) dates.add(new Date(day).toISOString().slice(0, 10));
  }
  return [...dates].sort();
}

/** 只给未填写的账本预填一次；已有明细或实际花费的账本原样保留。 */
export function seedAiExpenses(plan: TripPlan, content: PlannerContent): TripPlan {
  if (plan.aiExpenseSeeded || Object.keys(plan.dailyExpenses ?? {}).length
    || Object.values(plan.actual).some((amount) => amount !== 0)
    || Object.values(plan.overallExpenses ?? {}).some((amount) => amount !== 0)
    || (plan.manualActualTotal ?? 0) !== 0) return plan;

  const estimated = plannerFillEstimates(content);
  // 复用行程的计价结果：人数、优惠票、房间数、次数及套餐排重都保持一致。
  const costs = new Map(calculatePlannerBudget(estimated).items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const dailyExpenses: Record<string, ExpenseAmounts> = {};
  function categoryFor(cost: PlannerCost, activity?: PlannerActivity): ExpenseCategory {
    if (cost.category !== 'food') return cost.category;
    if (activity?.meal === 'breakfast' || activity?.meal === 'lunch' || activity?.meal === 'dinner') return activity.meal;
    // 兼容旧计划没有 meal 的情况；零食及未标餐别的餐饮归入其他，避免猜测三餐。
    const label = `${cost.label} ${activity?.title ?? ''}`;
    if (/早餐|早饭/.test(label)) return 'breakfast';
    if (/午餐|午饭/.test(label)) return 'lunch';
    if (/晚餐|晚饭/.test(label)) return 'dinner';
    return 'other';
  }
  for (const day of estimated.days) {
    const cents = Object.fromEntries(EXPENSE_CATEGORIES.map((key) => [key, 0])) as Record<ExpenseCategory, number>;
    const add = (cost: PlannerCost, activity?: PlannerActivity) => {
      const line = costs.get(cost.id);
      if (!line || seen.has(cost.id)) return;
      seen.add(cost.id);
      cents[categoryFor(cost, activity)] += line.totalCents ?? 0;
    };
    for (const activity of day.activities) {
      if (estimated.request.skipBreakfast && activity.meal === 'breakfast') continue;
      for (const cost of activity.costs) add(cost, activity);
    }
    for (const cost of day.lodging?.costs ?? []) add(cost);
    dailyExpenses[day.date] = Object.fromEntries(EXPENSE_CATEGORIES.map((key) => [key, cents[key] / 100]));
  }
  return updateExpenses({ ...plan, aiExpenseSeeded: true }, { dailyExpenses, overallExpenses: {}, unallocatedFood: 0 });
}

export interface AaMemberBalance {
  name: string;
  paidCents: number;
  owedCents: number;
  netCents: number;
}

export interface AaTransfer {
  from: string;
  to: string;
  amountCents: number;
}

export interface AaSplitSummary {
  totalCents: number;
  members: AaMemberBalance[];
  transfers: AaTransfer[];
}

/** 默认分账成员列表：保留已有设置，否则优先带出“我”和旅行同行人。 */
export function defaultSplitMembers(people: number, companions?: string[], saved?: string[]): string[] {
  const existing = (saved ?? []).map((name) => name.trim()).filter(Boolean);
  if (existing.length) return [...new Set(existing)];
  const list = ['我'];
  for (const raw of companions ?? []) {
    const name = raw.trim();
    if (name && !list.includes(name)) list.push(name);
  }
  const count = Math.max(1, Math.floor(people || 1));
  for (let index = list.length + 1; index <= count; index++) {
    const fallback = `同行人 ${index}`;
    if (!list.includes(fallback)) list.push(fallback);
  }
  return list;
}

/** 按整数分精确计算每人实付、应付、净额，并生成最少转账次数的 AA 结算单。 */
export function calculateAaSplit(members: string[], items: ExpenseSplitItem[]): AaSplitSummary {
  const names = [...new Set(members.map((name) => name.trim()).filter(Boolean))];
  const balances = new Map<string, AaMemberBalance>();
  const ensure = (name: string) => {
    let row = balances.get(name);
    if (!row) {
      row = { name, paidCents: 0, owedCents: 0, netCents: 0 };
      balances.set(name, row);
    }
    return row;
  };
  for (const name of names) ensure(name);

  let totalCents = 0;
  for (const item of items) {
    const cents = Math.round(item.amountCents);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const payer = item.payer.trim();
    const participants = [...new Set(item.participants.map((name) => name.trim()).filter(Boolean))];
    if (!payer || !participants.length) continue;

    totalCents += cents;
    ensure(payer).paidCents += cents;
    const base = Math.floor(cents / participants.length);
    const remainder = cents % participants.length;
    participants.forEach((participant, index) => {
      ensure(participant).owedCents += base + (index < remainder ? 1 : 0);
    });
  }

  const memberRows = [...balances.values()].map((row) => ({
    ...row,
    netCents: row.paidCents - row.owedCents,
  }));

  const creditors = memberRows
    .filter((row) => row.netCents > 0)
    .map((row) => ({ name: row.name, amount: row.netCents }));
  const debtors = memberRows
    .filter((row) => row.netCents < 0)
    .map((row) => ({ name: row.name, amount: -row.netCents }));

  const transfers: AaTransfer[] = [];
  // 先消除金额完全相等的一对债权/债务人，进一步减少转账笔数。
  for (let d = debtors.length - 1; d >= 0; d--) {
    const exactIndex = creditors.findIndex((creditor) => creditor.amount === debtors[d].amount);
    if (exactIndex >= 0) {
      transfers.push({ from: debtors[d].name, to: creditors[exactIndex].name, amountCents: debtors[d].amount });
      debtors.splice(d, 1);
      creditors.splice(exactIndex, 1);
    }
  }

  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0) transfers.push({ from: debtor.name, to: creditor.name, amountCents: amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= 0) debtors.shift();
    if (creditor.amount <= 0) creditors.shift();
  }

  return { totalCents, members: memberRows, transfers };
}

/** 生成适合直接粘贴到微信群的纯文本 AA 结算单。 */
export function formatAaSettlementText(title: string, summary: AaSplitSummary): string {
  const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
  const lines = [
    `${title || '旅行'} · AA 分账结算单`,
    `总计分摊：${money(summary.totalCents)}`,
    '',
    '【每人明细】',
    ...summary.members.map((member) => {
      const sign = member.netCents > 0 ? `应收 ${money(member.netCents)}` : member.netCents < 0 ? `应付 ${money(-member.netCents)}` : '已结清';
      return `- ${member.name}：实付 ${money(member.paidCents)} / 应付 ${money(member.owedCents)}（${sign}）`;
    }),
    '',
    '【最少转账方案】',
    ...(summary.transfers.length
      ? summary.transfers.map((transfer, index) => `${index + 1}. ${transfer.from} → ${transfer.to}：${money(transfer.amountCents)}`)
      : ['当前已全部结清，无需转账。']),
  ];
  return lines.join('\n');
}

/** 计算预订对应的归属日期：酒店按入住每晚拆日期，车次/航班/门票取出发或游玩日。 */
export function bookingLedgerDates(booking: Pick<BookingRecord, 'kind' | 'date' | 'endDate'>): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return [];
  if (booking.kind !== 'hotel' || !/^\d{4}-\d{2}-\d{2}$/.test(booking.endDate) || booking.endDate <= booking.date) {
    return [booking.date];
  }
  const dates: string[] = [];
  const start = Date.parse(`${booking.date}T00:00:00Z`);
  const end = Date.parse(`${booking.endDate}T00:00:00Z`);
  // 酒店最后一晚为离店日前一天；最多限制 60 晚防止异常日期。
  for (let day = start; day < end && dates.length < 60; day += 86400000) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates.length ? dates : [booking.date];
}

export function bookingExpenseCategory(kind: BookingRecord['kind']): ExpenseCategory {
  if (kind === 'train' || kind === 'flight') return 'transport';
  if (kind === 'hotel') return 'lodging';
  if (kind === 'ticket') return 'tickets';
  return 'other';
}

/** 将车次/航班/酒店/门票订单金额精准回填到每日账本（按分计算，支持覆盖或累加）。 */
export function applyBookingToLedger(
  plan: TripPlan,
  booking: BookingRecord,
  mode: 'replace' | 'add' = 'add',
): TripPlan {
  if (booking.amountYuan == null || !Number.isFinite(booking.amountYuan) || booking.amountYuan < 0) return plan;
  const totalCents = Math.round(booking.amountYuan * 100);
  const category = bookingExpenseCategory(booking.kind);
  const dates = bookingLedgerDates(booking);
  if (!dates.length) {
    const overall = { ...overallExpenses(plan) };
    const prevCents = Math.round((overall[category] ?? 0) * 100);
    overall[category] = (mode === 'replace' ? totalCents : prevCents + totalCents) / 100;
    return updateExpenses(plan, { overallExpenses: overall });
  }
  const dailyExpenses: Record<string, ExpenseAmounts> = { ...plan.dailyExpenses };
  const base = Math.floor(totalCents / dates.length);
  const rem = totalCents % dates.length;
  dates.forEach((date, index) => {
    const shareCents = base + (index < rem ? 1 : 0);
    const row = { ...(dailyExpenses[date] ?? {}) };
    const prevCents = Math.round((row[category] ?? 0) * 100);
    row[category] = (mode === 'replace' ? shareCents : prevCents + shareCents) / 100;
    dailyExpenses[date] = row;
  });
  return updateExpenses(plan, { dailyExpenses });
}
