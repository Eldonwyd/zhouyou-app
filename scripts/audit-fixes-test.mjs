import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { aiPlanFixture } from './planner-fixture.mjs';
import { applyBookingToPlan, emptyBookingDraft, removeBookingFromPlan } from '../src/planner-booking.ts';
import { validateTransportBooking } from '../src/planner-booking-schedule.ts';
import { calculatePlannerBudget } from '../src/planner-domain.ts';
import { applyBookingToLedger, calculateAaSplit, removeBookingFromLedger } from '../src/finance.ts';
import { plannerMapRouteStops } from '../src/planner-map.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundled = await esbuild.build({
  entryPoints: [path.resolve(__dirname, '../src/planner-external-ai.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});
const {
  buildExternalAiEditPrompt,
  buildExternalAiPrompt,
  parseExternalAiResponse,
  previewExternalAiEdit,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

// 1. 条目 06：外部 AI 提示词包含结构化约束与 unit: "ticket"
{
  const plan = aiPlanFixture();
  const prompt = buildExternalAiPrompt({
    ...plan.content.request,
    people: 3,
    students: 1,
    seniors: 1,
    rooms: 2,
    skipBreakfast: true,
    dietary: '不吃海鲜',
    foodMode: true,
  });
  assert.match(prompt, /不安排早餐/);
  assert.match(prompt, /不吃海鲜/);
  assert.match(prompt, /2 间房/);
  assert.match(prompt, /"ticket"/);
}

// 2. 条目 15、16、19、21、22、23、31、32：外部 AI 局部补丁不覆写其他天、ID 全局去重、禁跨城继承、保留分精度与 null 未知价、保留凌晨时间、过滤早餐
{
  const plan = aiPlanFixture();
  // 构造 3 天行程，第 1 天成都人民公园带照片和 19.90 元学生票 + 未知票价，第 2 天重庆，第 3 天成都
  const day1 = plan.content.days[0];
  const day2 = structuredClone(day1);
  day2.date = '2026-12-02';
  day2.title = '第 2 天 · 重庆';
  day2.activities = day2.activities.map((a, idx) => ({
    ...a,
    id: `d2-orig-${idx + 1}`,
    city: '重庆市',
    costs: a.costs.map((c, ci) => ({ ...c, id: `d2-cost-${idx}-${ci}` })),
  }));
  const day3 = structuredClone(day1);
  day3.date = '2026-12-03';
  day3.title = '第 3 天 · 成都返程';
  day3.lodging = null;
  day3.activities = day3.activities.map((a, idx) => ({
    ...a,
    id: `d3-orig-${idx + 1}`,
    costs: a.costs.map((c, ci) => ({ ...c, id: `d3-cost-${idx}-${ci}` })),
  }));
  day1.activities[0].title = '人民公园';
  day1.activities[0].city = '成都市';
  day1.activities[0].photo = {
    url: 'https://example.org/cd.webp',
    sourceUrl: 'https://example.org/cd',
    attribution: '成都图',
    assetId: 'a'.repeat(64),
  };
  day1.activities[0].costs = [
    {
      id: 'cost-decimal',
      label: '景区门票',
      category: 'tickets',
      unit: 'ticket',
      unitPriceCents: 1990,
      studentPriceCents: 995,
      quantity: 1,
      occurrences: 1,
      status: 'estimate',
      qualification: '学生半价',
      sourceIds: [],
      includedIn: null,
    },
    {
      id: 'cost-unknown',
      label: '特展票',
      category: 'tickets',
      unit: 'ticket',
      unitPriceCents: null,
      studentPriceCents: null,
      quantity: 1,
      occurrences: 1,
      status: 'unknown',
      qualification: '',
      sourceIds: [],
      includedIn: null,
    },
  ];
  plan.content.days = [day1, day2, day3];
  plan.content.request.days = 3;
  plan.content.request.endDate = '2026-12-03';
  plan.content.request.skipBreakfast = true;

  // 验证精简快照保留 19.9 小数精度与 null 未知价（条目 23、31）
  const editPrompt = buildExternalAiEditPrompt(plan, '只改第 2 天');
  assert.match(editPrompt, /"unitAmountYuan": 19\.9\b/);
  assert.match(editPrompt, /"studentYuan": 9\.95\b/);
  assert.match(editPrompt, /"unitAmountYuan": null\b/);

  // 局部补丁仅改第 2 天（按 date 定位，不提供 day 序号，测试条目 15 + 32）
  // 同时测试：凌晨 04:30 看日出不被裁剪（条目 21）、早餐被 skipBreakfast 过滤（条目 22）、重庆人民公园不继承成都照片（条目 19）、同日同名活动 ID 去重（条目 16）
  const patchJson = JSON.stringify({
    mode: 'patch_days',
    summary: '调整第 2 天为重庆早起看日出',
    days: [
      {
        date: '2026-12-02',
        city: '重庆市',
        title: '重庆山城早起',
        activities: [
          {
            kind: 'sight',
            startTime: '04:30',
            endTime: '05:45',
            title: '人民公园',
            city: '重庆市',
            location: '渝中区人民公园',
            description: '清晨看日出',
            costs: [],
          },
          {
            kind: 'food',
            meal: 'breakfast',
            startTime: '08:00',
            endTime: '08:45',
            title: '酒店早餐',
            city: '重庆市',
            location: '酒店餐厅',
            description: '自助早餐',
            costs: [{ category: 'food', label: '早餐', unitAmountYuan: 40, unit: 'person' }],
          },
          {
            kind: 'sight',
            startTime: '10:00',
            endTime: '12:00',
            title: '人民公园',
            city: '重庆市',
            location: '北门游览',
            description: '再次游览',
            costs: [],
          },
        ],
      },
    ],
  });

  const preview = await previewExternalAiEdit(`\`\`\`json\n${patchJson}\n\`\`\``, plan);
  assert.equal(preview.mode, 'patch_days');
  assert.equal(preview.content.days.length, 3);
  // 第 1 天和第 3 天未被覆写
  assert.equal(preview.content.days[0].activities[0].id, day1.activities[0].id);
  assert.equal(preview.content.days[2].title, '第 3 天 · 成都返程');
  // 第 2 天仅剩 2 个活动（早餐已被 skipBreakfast 真正过滤），且 04:30 未被裁剪成 06:00
  const d2Acts = preview.content.days[1].activities;
  assert.equal(d2Acts.length, 2);
  assert.equal(d2Acts[0].startTime, '04:30');
  assert.equal(d2Acts[0].endTime, '05:45');
  // 重庆人民公园不得跨城继承成都人民公园照片，且两条同名活动 ID 全局唯一
  assert.equal(d2Acts[0].photo, null);
  assert.notEqual(d2Acts[0].id, d2Acts[1].id);
  assert.notEqual(d2Acts[0].id, day1.activities[0].id);
  // 补丁未传 lodging 时保留第 2 天原住宿
  assert.equal(preview.content.days[1].lodging?.area, day2.lodging?.area);
}

// 3. 条目 03：外部导入天数与原设定不符时写入 warning
{
  const plan = aiPlanFixture();
  const imported = await parseExternalAiResponse(
    JSON.stringify({
      title: '成都 1 日',
      days: [
        {
          day: 1,
          date: '2026-12-01',
          city: '成都市',
          activities: [{ kind: 'sight', startTime: '09:00', endTime: '11:00', title: '宽窄巷子', city: '成都市', location: '宽窄巷子', costs: [] }],
        },
      ],
    }),
    { ...plan.content.request, startDate: '2026-12-01', endDate: '2026-12-05', days: 5 },
  );
  assert.equal(imported.content.days.length, 1);
  assert.ok(imported.warnings.some((w) => w.includes('原设定为 5 天') && w.includes('实际返回 1 天')));
}

// 4. 条目 25 & 26：行程外门票禁止静默回填到第一天；同门票重复保存幂等不重复创建活动
{
  const plan = aiPlanFixture();
  const outOfRangeTicket = {
    ...emptyBookingDraft('ticket', '2026-12-09', '成都市'),
    id: 'tk-out',
    title: '故宫门票',
    startTime: '09:00',
    endTime: '11:00',
    amountYuan: 60,
  };
  assert.throws(
    () => applyBookingToPlan(plan, outOfRangeTicket, { updatePlan: true }),
    /不在当前行程内/,
  );

  const inRangeTicket = {
    ...emptyBookingDraft('ticket', plan.content.days[0].date, '成都市'),
    id: 'tk-in',
    title: '武侯祠门票',
    startTime: '14:00',
    endTime: '16:00',
    amountYuan: 50,
  };
  const once = applyBookingToPlan(plan, inRangeTicket, { updatePlan: true });
  const countOnce = once.content.days[0].activities.length;
  const twice = applyBookingToPlan(once, { ...inRangeTicket, amountYuan: 55 }, { updatePlan: true });
  assert.equal(twice.content.days[0].activities.length, countOnce);
}

// 5. 条目 27：同晚多笔酒店订单聚合费用与名称，不互相覆盖
{
  const plan = aiPlanFixture();
  // 确保第 1 天有 lodging
  plan.content.days[0].lodging = {
    city: '丽江市',
    area: '古城',
    searchKeyword: '丽江古城酒店',
    reason: '方便',
    costs: [],
    sourceIds: [],
  };
  const h1 = {
    ...emptyBookingDraft('hotel', plan.content.days[0].date, '丽江市'),
    id: 'h-1',
    hotelName: '悦榕庄',
    title: '悦榕庄',
    endDate: '2026-12-02',
    amountYuan: 500,
  };
  const h2 = {
    ...emptyBookingDraft('hotel', plan.content.days[0].date, '丽江市'),
    id: 'h-2',
    hotelName: '花间堂',
    title: '花间堂',
    endDate: '2026-12-02',
    amountYuan: 600,
  };
  const p1 = applyBookingToPlan(plan, h1, { updatePlan: true });
  const p2 = applyBookingToPlan(p1, h2, { updatePlan: true });
  assert.equal(p2.content.days[0].lodging?.costs.length, 2);
  const sumLodging = p2.content.days[0].lodging?.costs.reduce((s, c) => s + (c.unitPriceCents ?? 0), 0);
  assert.equal(sumLodging, 110000);
  assert.match(p2.hotels[plan.content.days[0].date], /悦榕庄/);
  assert.match(p2.hotels[plan.content.days[0].date], /花间堂/);
}

// 6. 条目 33：套餐主项被延期后，仍执行的子费用不再被静默跳过
{
  const plan = aiPlanFixture();
  const acts = plan.content.days[0].activities;
  acts[0].bookingTiming = { startTime: acts[0].startTime, endTime: acts[0].endTime, period: acts[0].period, deferred: 'no-time' };
  acts[0].costs = [{
    id: 'combo-main',
    label: '景区套票',
    category: 'tickets',
    unit: 'group',
    unitPriceCents: 20000,
    studentPriceCents: null,
    quantity: 1,
    occurrences: 1,
    status: 'estimate',
    qualification: '',
    sourceIds: [],
    includedIn: null,
  }];
  acts[1].costs = [{
    id: 'combo-sub',
    label: '子景点单票',
    category: 'tickets',
    unit: 'group',
    unitPriceCents: 8000,
    studentPriceCents: null,
    quantity: 1,
    occurrences: 1,
    status: 'estimate',
    qualification: '',
    sourceIds: [],
    includedIn: 'combo-main',
  }];
  const budget = calculatePlannerBudget(plan.content);
  assert.ok(budget.items.some((item) => item.id === 'combo-sub' && item.totalCents === 8000));
  assert.ok(budget.notes.some((n) => n.includes('原属套餐主项已暂缓')));
}

// 7. 条目 10 & 35：国际航班同日西行允许早于起飞时刻；23:59 发车跨午夜不丢主票卡和费用
{
  validateTransportBooking({
    ...emptyBookingDraft('flight', '2026-12-01', '北京市'),
    id: 'intl-west',
    code: 'CA987',
    title: 'CA987',
    fromLocation: '北京首都国际机场',
    toLocation: '洛杉矶国际机场',
    startTime: '13:00',
    endTime: '10:00',
    endDate: '2026-12-01',
    internationalFlight: true,
  });

  const plan = aiPlanFixture();
  const midnightTrain = {
    ...emptyBookingDraft('train', plan.content.days[0].date, '丽江市'),
    id: 'train-2359',
    code: 'K9601',
    title: 'K9601',
    fromLocation: '丽江站',
    toLocation: '昆明站',
    startTime: '23:59',
    endTime: '06:30',
    endDate: '2026-12-02',
    amountYuan: 150,
  };
  const scheduled = applyBookingToPlan(plan, midnightTrain, { updatePlan: true });
  const mainRide = scheduled.content.days[0].activities.find((a) => a.bookingId === 'train-2359' && a.costs.length > 0);
  assert.ok(mainRide, '23:59 发车的主票卡与费用应保留在出发日');
  assert.equal(mainRide.costs[0].unitPriceCents, 15000);
}

// 8. 条目 39 & 14：订单账本按 booking.id 幂等防重 + 删单扣回；群 AA 多位已退群成员按 userId 独立分账不合并
{
  let sheet = {
    id: 't1',
    tripId: 't1',
    cityCode: '530700',
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    people: 2,
    budget: { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 },
    actual: { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 },
    manualActualTotal: null,
    reminderDays: 1,
  };
  const bk = { ...emptyBookingDraft('ticket', '2026-12-01', '丽江市'), id: 'b-idem', title: '玉龙雪山', amountYuan: 100 };
  sheet = applyBookingToLedger(sheet, bk, 'add');
  assert.equal(sheet.actual.tickets, 100);
  // 同一订单金额改为 120 再次 add，不重复叠加成 220，而是幂等更新为 120
  sheet = applyBookingToLedger(sheet, { ...bk, amountYuan: 120 }, 'add');
  assert.equal(sheet.actual.tickets, 120);
  // 删除订单时精确扣回 120
  sheet = removeBookingFromLedger(sheet, 'b-idem');
  assert.equal(sheet.actual.tickets, 0);

  // 群 AA：两位已退群成员分别传独立 userId，分母保持 3 人而非被合并成 2 人
  const aa = calculateAaSplit(
    ['u1'],
    [{ id: 'e1', date: '2026-12-01', category: 'food', title: '聚餐', amountCents: 30000, payer: 'u1', participants: ['u1', 'leftA', 'leftB'] }],
    { u1: '小明', leftA: '已退群成员(eftA)', leftB: '已退群成员(eftB)' },
  );
  assert.equal(aa.members.length, 3);
  assert.equal(aa.members.find((m) => m.name === '小明')?.owedCents, 10000);
}

// 9. 条目 29：同日同名景点拥有独立定位键，首条保持兼容 3 元组
{
  const plan = aiPlanFixture();
  const d0 = plan.content.days[0];
  d0.activities = [
    { ...d0.activities[0], id: 'visit-north', kind: 'sight', startTime: '09:00', endTime: '11:00', title: '西湖', city: '杭州市', location: '西湖', photoQuery: '西湖' },
    { ...d0.activities[0], id: 'visit-south', kind: 'sight', startTime: '19:00', endTime: '21:00', title: '西湖', city: '杭州市', location: '西湖', photoQuery: '西湖' },
  ];
  const stops = plannerMapRouteStops(plan.content).filter((s) => s.visits[0]?.date === d0.date);
  assert.equal(stops.length, 2);
  assert.notEqual(stops[0].key, stops[1].key);
}

process.stdout.write('全部审查修复回归测试（条目 03/06/10/14/15/16/19/21/22/23/25/26/27/29/31/32/33/35/39）通过！\n');
