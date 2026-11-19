import assert from 'node:assert/strict';
import { calculateAaSplit, formatAaSettlementText, applyBookingToLedger, defaultSplitMembers } from '../src/finance.ts';
import { applyBookingToPlan, emptyBookingDraft, finalizeBookingRecord, pendingTransportLegs, plannerContentForAi, removeBookingFromPlan, upgradeLegacyBookingSchedule } from '../src/planner-booking.ts';
import { plannerActivitiesByTime, plannerConflicts, validatePlannerContent } from '../src/planner-domain.ts';
import { buildOfflineRoadbookHtml } from '../src/planner-html-export.ts';
import { createPlannerService } from '../server/planner-service.mjs';
import { emptyAmounts } from '../src/types.ts';

function samplePlan() {
  return {
    id: 'plan-1',
    version: 1,
    contentVersion: 1,
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
    linkedTripId: null,
    linkedSnapshot: null,
    messages: [],
    history: [],
    hotels: {},
    ticketPlan: {
      signature: 'sig',
      checkedAt: '2026-11-19T00:00:00Z',
      networkAvailable: true,
      items: [
        {
          activityId: 'a-1',
          title: '玉龙雪山冰川公园',
          travelDate: '2026-12-01',
          saleDate: '2026-11-24',
          saleTime: '20:00',
          difficulty: '难',
          platform: '丽江旅游集团小程序',
          note: '提前7天放票',
          bookingRequired: true,
          sources: [],
        },
      ],
    },
    packingList: {
      updatedAt: '2026-11-19T00:00:00Z',
      items: [
        { id: 'p-1', category: 'documents', name: '身份证与学生证', note: '景区优惠核验', checked: true },
        { id: 'p-2', category: 'medicine', name: '红景天与布洛芬', note: '高原备用', checked: false },
      ],
    },
    content: {
      title: '昆明大理 3 日暖冬游',
      summary: '昆明观鸥后乘高铁赴大理环洱海。',
      request: {
        destination: '昆明、大理',
        people: 3,
        students: 1,
        seniors: 0,
        children: 0,
        startDate: '2026-12-01',
        days: 3,
        endDate: '2026-12-03',
        base: '上海',
        budgetCents: 600000,
        pace: '适中',
        transport: '公共交通',
        foodMode: true,
        skipBreakfast: false,
        dietary: '',
        lodgingLevel: '舒适经济',
        rooms: 2,
        notes: '',
      },
      cities: [
        { code: '530100', name: '昆明市', provinceCode: '530000' },
        { code: '532900', name: '大理白族自治州', provinceCode: '530000' },
      ],
      constraints: [],
      warnings: ['昼夜温差较大，建议洋葱穿衣法'],
      days: [
        {
          date: '2026-12-01',
          title: '昆明翠湖与老街',
          weather: '晴 8~19°C',
          activities: [
            {
              id: 'a-1',
              kind: 'sight',
              period: 'morning',
              startTime: '09:30',
              endTime: '11:30',
              title: '翠湖公园',
              city: '昆明市',
              location: '翠湖公园',
              description: '看红嘴鸥',
              transportMode: '',
              meal: null,
              locked: false,
              photo: { url: 'https://example.com/a.webp', sourceUrl: 'https://example.com', attribution: 'test', assetId: 'a'.repeat(64) },
              sourceIds: [],
              costs: [],
              fromActivityId: null,
              toActivityId: null,
            },
          ],
          lodging: {
            city: '昆明市',
            area: '翠湖片区',
            searchKeyword: '昆明 翠湖 酒店',
            reason: '步行可达景点',
            costs: [],
            sourceIds: [],
          },
        },
        {
          date: '2026-12-02',
          title: '高铁赴大理古城',
          weather: '多云 6~18°C',
          activities: [
            {
              id: 't-1',
              kind: 'transport',
              period: 'morning',
              startTime: '09:00',
              endTime: '11:00',
              title: '昆明→大理高铁',
              city: '大理白族自治州',
              location: '昆明站→大理站',
              description: '预计车程2小时',
              transportMode: '高铁',
              meal: null,
              locked: false,
              photo: null,
              sourceIds: [],
              costs: [],
              fromActivityId: null,
              toActivityId: null,
            },
          ],
          lodging: {
            city: '大理白族自治州',
            area: '大理古城',
            searchKeyword: '大理古城 民宿',
            reason: '夜游方便',
            costs: [],
            sourceIds: [],
          },
        },
        {
          date: '2026-12-03',
          title: '洱海生态廊道',
          weather: '晴 7~18°C',
          activities: [
            {
              id: 'a-3',
              kind: 'sight',
              period: 'morning',
              startTime: '09:30',
              endTime: '11:30',
              title: '洱海生态廊道骑行',
              city: '大理白族自治州',
              location: '龙龛码头',
              description: '沿湖漫骑看晨光',
              transportMode: '',
              meal: null,
              locked: false,
              photo: null,
              sourceIds: [],
              costs: [],
              fromActivityId: null,
              toActivityId: null,
            },
          ],
          lodging: null,
        },
      ],
      alternatives: [],
      sources: [],
    },
  };
}

// 1. AA 分账结算（精确到分、余数分配、最少转账次数）
{
  const members = defaultSplitMembers(3, ['小红', '小李']);
  assert.deepEqual(members, ['我', '小红', '小李']);
  const summary = calculateAaSplit(members, [
    { id: '1', date: '2026-12-01', category: 'dinner', title: '火锅', amountCents: 10000, payer: '我', participants: ['我', '小红', '小李'] },
    { id: '2', date: '2026-12-01', category: 'transport', title: '打车', amountCents: 6000, payer: '小红', participants: ['我', '小红', '小李'] },
    { id: '3', date: '2026-12-02', category: 'tickets', title: '门票', amountCents: 8000, payer: '我', participants: ['我', '小李'] },
  ]);
  assert.equal(summary.totalCents, 24000);
  // 净额总和必须严格为 0
  const netSum = summary.members.reduce((sum, row) => sum + row.netCents, 0);
  assert.equal(netSum, 0);
  // 实付总额 === 应付总额 === 24000
  assert.equal(summary.members.reduce((sum, row) => sum + row.paidCents, 0), 24000);
  assert.equal(summary.members.reduce((sum, row) => sum + row.owedCents, 0), 24000);
  // 校验：我 实付 18000 应付 3334+2000+4000=9334 净额 +8666
  // 小红 实付 6000 应付 3333+2000=5333 净额 +667
  // 小李 实付 0 应付 3333+2000+4000=9333 净额 -9333
  assert.equal(summary.transfers.length, 2);
  assert.equal(summary.transfers.reduce((sum, t) => sum + t.amountCents, 0), 9333);
  const text = formatAaSettlementText('云南游', summary);
  assert.match(text, /小李 → 我：¥86\.66/);
  assert.match(text, /小李 → 小红：¥6\.67/);
}

// 2. 订单一键回填到行程卡片 + 酒店 + 每日账本（不含截图）
{
  const plan = samplePlan();
  // 2a. 酒店入住两晚回填
  const hotelBooking = finalizeBookingRecord({
    id: 'b-hotel',
    kind: 'hotel',
    title: '',
    code: '',
    date: '2026-12-01',
    endDate: '2026-12-03',
    startTime: '14:00',
    endTime: '12:00',
    fromLocation: '',
    toLocation: '翠湖西路1号',
    city: '昆明市',
    hotelName: '全季酒店（昆明翠湖店）',
    amountYuan: 500,
    seatOrRoom: '高级大床房 含早',
    note: '',
    createdAt: '2026-11-19T00:00:00Z',
  });
  const afterHotel = applyBookingToPlan(plan, hotelBooking, { updatePlan: true });
  assert.equal(afterHotel.hotels?.['2026-12-01'], '全季酒店（昆明翠湖店）');
  assert.equal(afterHotel.hotels?.['2026-12-02'], '全季酒店（昆明翠湖店）');
  assert.equal(afterHotel.hotels?.['2026-12-03'], undefined);
  assert.equal(afterHotel.content.days[0].lodging?.costs[0]?.unitPriceCents, 25000);
  assert.equal(afterHotel.content.days[0].lodging?.costs[0]?.status, 'booked');
  validatePlannerContent(afterHotel.content);
  assert.equal(afterHotel.bookings?.length, 1);

  // 2b. 手动输入高铁车次替换已有交通卡片
  const trainBooking = finalizeBookingRecord({
    id: 'b-train',
    kind: 'train',
    title: '',
    code: 'D8712',
    date: '2026-12-02',
    endDate: '',
    startTime: '08:40',
    endTime: '10:42',
    fromLocation: '昆明站',
    toLocation: '大理站',
    city: '大理白族自治州',
    hotelName: '',
    amountYuan: 145,
    seatOrRoom: '04车 08F',
    note: '检票口 6A',
    createdAt: '2026-11-19T00:00:00Z',
  });
  const afterTrain = applyBookingToPlan(afterHotel, trainBooking, { updatePlan: true, targetActivityId: 't-1' });
  const updatedAct = afterTrain.content.days[1].activities.find((a) => a.id === 't-1');
  assert.equal(updatedAct?.title, 'D8712 昆明站 → 大理站');
  assert.equal(updatedAct?.startTime, '08:40');
  assert.equal(updatedAct?.costs[0]?.unitPriceCents, 14500);
  assert.equal(updatedAct?.costs[0]?.status, 'booked');
  validatePlannerContent(afterTrain.content);
  // 网页查证的报价仍须有来源，订单实付使用自己的状态。
  const missingWebSource = structuredClone(afterTrain.content);
  missingWebSource.days[1].activities.find((activity) => activity.id === 't-1').costs[0].status = 'verified';
  assert.throws(() => validatePlannerContent(missingWebSource), /已查证价格缺少来源/);

  // 2c. 回填到每日账本（两晚住宿均摊 + 高铁交通）
  let ledger = {
    id: 'trip-1',
    tripId: 'trip-1',
    cityCode: '530100',
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    people: 3,
    budget: emptyAmounts(),
    actual: emptyAmounts(),
    manualActualTotal: null,
    reminderDays: 1,
    dailyExpenses: {},
    overallExpenses: {},
  };
  ledger = applyBookingToLedger(ledger, hotelBooking, 'replace');
  assert.equal(ledger.dailyExpenses?.['2026-12-01']?.lodging, 250);
  assert.equal(ledger.dailyExpenses?.['2026-12-02']?.lodging, 250);
  ledger = applyBookingToLedger(ledger, trainBooking, 'add');
  assert.equal(ledger.dailyExpenses?.['2026-12-02']?.transport, 145);
  assert.equal(ledger.actual.lodging, 500);
  assert.equal(ledger.actual.transport, 145);
}

// 改签重新使用原估算，准确预留出发与抵达接驳；酒店修改不改变活动时间。
{
  const plan = samplePlan();
  const day = plan.content.days[1];
  const estimate = day.activities.find((activity) => activity.id === 't-1');
  Object.assign(estimate, { title: '大理 → 丽江', location: '大理 → 丽江', transportMode: '高铁', startTime: '14:00', endTime: '16:00' });
  const sight = structuredClone(plan.content.days[0].activities[0]);
  const visit = (id, city, startTime, endTime) => ({ ...sight, id, city, startTime, endTime, costs: [], locked: false });
  day.activities = [visit('visit-from', '大理市', '13:30', '15:30'), estimate, visit('visit-to', '丽江市', '16:00', '17:00')];
  assert.equal(pendingTransportLegs(plan.content, []).at(0)?.activity.id, estimate.id);
  const train = {
    ...emptyBookingDraft('train', day.date, '丽江市'), id: 'ticket-train', code: 'D8712',
    fromLocation: '大理站', toLocation: '丽江站', startTime: '15:30', endTime: '16:50',
    note: '本地订单备注',
  };
  const booked = applyBookingToPlan(plan, train);
  const timeline = (value) => value.content.days[1].activities;
  assert.equal(pendingTransportLegs(booked.content, booked.bookings).length, 0);
  assert.equal(timeline(booked).find((item) => item.title.includes('并候车')).startTime, '15:00');
  assert.equal(plannerActivitiesByTime(timeline(booked)).filter((item) => item.bookingId === train.id).length, 1);
  assert.equal(timeline(booked).find((item) => item.title === '前往大理站').startTime, '14:20');
  assert.equal(timeline(booked).find((item) => item.id === 'visit-from').endTime, '14:20');
  assert.equal(timeline(booked).find((item) => item.id === 'visit-to').startTime, '17:20');
  assert.deepEqual(plannerConflicts(booked.content), []);
  const changed = applyBookingToPlan(booked, { ...train, code: 'D8720', startTime: '17:00', endTime: '18:20' });
  assert.equal(changed.bookings.length, 1);
  assert.equal(timeline(changed).find((item) => item.id === estimate.id).startTime, '17:00');
  assert.equal(timeline(changed).find((item) => item.id === 'visit-from').endTime, '15:30');
  assert.ok(!timeline(changed).some((item) => item.title.includes('D8712')));
  assert.deepEqual(plannerConflicts(changed.content), []);
  const modelContent = plannerContentForAi(changed);
  validatePlannerContent(modelContent);
  assert.doesNotMatch(JSON.stringify(modelContent), /D8720|本地订单备注|大理站/);
  const original = removeBookingFromPlan(changed, train.id);
  assert.equal(timeline(original).find((item) => item.id === estimate.id).startTime, '14:00');
  assert.equal(timeline(original).find((item) => item.id === 'visit-from').startTime, '13:30');

  const flight = { ...train, id: 'ticket-flight', kind: 'flight', code: 'MU5801',
    fromLocation: '大理机场', toLocation: '丽江机场', startTime: '15:30', endTime: '17:00' };
  const flown = applyBookingToPlan(original, flight, { targetActivityId: estimate.id });
  assert.equal(timeline(flown).find((item) => item.title.includes('办理登机')).startTime, '13:30');
  const international = applyBookingToPlan(flown, { ...flight, internationalFlight: true, startTime: '23:15', endTime: '00:45' });
  assert.equal(timeline(international).find((item) => item.title.includes('办理登机')).startTime, '20:15');
  assert.ok(international.content.days[2].activities.some((item) => item.bookingId === flight.id && item.endTime === '00:45'));
  validatePlannerContent(international.content);
  const hotel = { ...emptyBookingDraft('hotel', day.date, '丽江市'), hotelName: '丽江已订酒店', amountYuan: 500 };
  const stayed = applyBookingToPlan(international, hotel);
  const moved = applyBookingToPlan(stayed, { ...hotel, date: plan.content.days[0].date, hotelName: '替换酒店' });
  assert.equal(moved.hotels[day.date], undefined);
  assert.equal(moved.hotels[plan.content.days[0].date], '替换酒店');
  assert.deepEqual(timeline(moved), timeline(international));
  const legacy = structuredClone(plan);
  Object.assign(legacy.content.days[1].activities.find((item) => item.id === estimate.id),
    { title: 'D8712 大理站 → 丽江站', startTime: '15:30', endTime: '16:50' });
  legacy.bookings = [finalizeBookingRecord({ ...train, backfilledToPlan: true })];
  assert.equal(upgradeLegacyBookingSchedule(legacy).version, legacy.version);
  assert.deepEqual(plannerConflicts(upgradeLegacyBookingSchedule(legacy).content), []);

  // 到达后已过早餐时间，旧早餐文案和费用随实际用餐时段更新；取消订单可恢复原早餐。
  const withBreakfast = structuredClone(plan);
  withBreakfast.content.request.skipBreakfast = false;
  const breakfast = withBreakfast.content.days[1].activities.find((item) => item.id === 'visit-to');
  Object.assign(breakfast, { kind: 'food', meal: 'breakfast', title: '老街吃早点', description: '清晨去排队吃早餐。',
    period: 'morning', startTime: '08:30', endTime: '09:00' });
  const middayTrain = { ...train, startTime: '08:40', endTime: '11:15' };
  const atLunch = applyBookingToPlan(withBreakfast, middayTrain);
  const scheduledMeal = (value) => timeline(value).find((item) => item.id === breakfast.id);
  assert.equal(scheduledMeal(atLunch).startTime, '11:45');
  assert.equal(scheduledMeal(atLunch).title, '老街吃午餐');
  assert.equal(scheduledMeal(atLunch).meal, 'lunch');
  assert.doesNotMatch(scheduledMeal(atLunch).description, /早餐|清晨/);
  const oldMeal = structuredClone(atLunch);
  const oldScheduled = scheduledMeal(oldMeal);
  Object.assign(oldScheduled, oldScheduled.bookingTiming.originalMeal);
  delete oldScheduled.bookingTiming.originalMeal;
  assert.equal(scheduledMeal(upgradeLegacyBookingSchedule(oldMeal)).title, '老街吃午餐');
  assert.equal(scheduledMeal(removeBookingFromPlan(atLunch, train.id)).meal, 'breakfast');

  const bufferConflict = structuredClone(booked.content);
  const lockedVisit = bufferConflict.days[1].activities.find((item) => item.id === 'visit-from');
  Object.assign(lockedVisit, { locked: true, startTime: '14:35', endTime: '14:55' });
  assert.ok(plannerConflicts(bufferConflict).some((warning) => warning.includes('D8712') && !warning.includes('前往')));
}

// 3. 单文件离线 HTML 路书导出（内嵌照片、抢票、清单、预订、高德链接与 XSS 转义）
{
  const plan = samplePlan();
  plan.content.title = '昆明<script>alert(1)</script>游';
  plan.hotels = { '2026-12-01': '全季酒店（昆明翠湖店）' };
  const html = buildOfflineRoadbookHtml(plan, {
    photoDataUrls: { ['a'.repeat(64)]: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4' },
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('data:image/webp;base64,UklGRh4AAABXRUJQVlA4'));
  assert.ok(html.includes('玉龙雪山冰川公园'));
  assert.ok(html.includes('红景天与布洛芬'));
  assert.ok(html.includes('全季酒店（昆明翠湖店）'));
  assert.ok(html.includes('https://uri.amap.com/search'));
}

// 4. 服务端 AI 行前清单 + 截图识别（不保存图片 + 纯文本模型清晰提示）
{
  const mockAi = {
    configured: true,
    vision: true,
    label: 'MockVision · v1',
    async chat({ messages }) {
      const last = messages.at(-1);
      if (Array.isArray(last.content)) {
        assert.equal(last.content[1].type, 'image');
        return {
          text: JSON.stringify({
            bookings: [{
              kind: 'train',
              title: 'G1234 昆明南→大理',
              code: 'G1234',
              date: '2026-12-02',
              endDate: '',
              startTime: '09:10',
              endTime: '11:05',
              fromLocation: '昆明南站',
              toLocation: '大理站',
              city: '大理白族自治州',
              hotelName: '',
              amountYuan: 145,
              seatOrRoom: '03车 05A',
              note: '电子客票',
            }],
          }),
          truncated: false,
        };
      }
      return {
        text: JSON.stringify({
          items: [
            { category: 'documents', name: '学生证', note: '享受学生门票优惠' },
            { category: 'clothing', name: '轻薄羽绒服', note: '大理早晚温差大' },
          ],
        }),
        truncated: false,
      };
    },
  };
  const service = createPlannerService({ ai: mockAi, visionAi: mockAi, webSearch: { available: false } });
  const packing = await service.packing({ plan: samplePlan() }, new AbortController().signal, () => {});
  assert.equal(packing.items.length, 2);
  assert.equal(packing.items[0].category, 'documents');
  assert.equal(packing.items[0].checked, false);

  const parsed = await service.parseBooking(
    { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b0AAAAASUVORK5CYII=' },
    new AbortController().signal,
    () => {},
  );
  assert.equal(parsed.bookings.length, 1);
  assert.equal(parsed.bookings[0].code, 'G1234');
  assert.equal(parsed.bookings[0].amountYuan, 145);
  // 确认返回结果不包含截图原始数据
  assert.ok(!JSON.stringify(parsed).includes('iVBORw0KGgo'));

  // DeepSeek 等纯文本模型自动走「本机离线 OCR + DeepSeek 文本解析」路径
  let seenOcrPrompt = '';
  const deepseekMock = {
    configured: true,
    vision: false,
    label: 'DeepSeek · deepseek-flash',
    async chat({ messages }) {
      seenOcrPrompt = String(messages.at(-1)?.content ?? '');
      return {
        text: JSON.stringify({
          bookings: [{
            kind: 'hotel',
            title: '全季酒店（昆明翠湖公园店）',
            code: '',
            date: '2026-12-01',
            endDate: '2026-12-03',
            startTime: '14:00',
            endTime: '12:00',
            fromLocation: '',
            toLocation: '翠湖西路',
            city: '昆明市',
            hotelName: '全季酒店（昆明翠湖公园店）',
            amountYuan: 500,
            seatOrRoom: '大床房 含双早',
            note: '',
          }],
        }),
        truncated: false,
      };
    },
  };
  const fakeLocalOcr = {
    async recognize(buf) {
      assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
      return { text: '全季酒店(昆明翠湖公园店)\n入住 2026-12-01 离店 2026-12-03\n实付 500.00元', lines: [] };
    },
  };
  const deepseekService = createPlannerService({
    ai: deepseekMock,
    visionAi: deepseekMock,
    localOcr: fakeLocalOcr,
    webSearch: { available: false },
  });
  const dsParsed = await deepseekService.parseBooking(
    { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b0AAAAASUVORK5CYII=' },
    new AbortController().signal,
    () => {},
  );
  assert.match(seenOcrPrompt, /全季酒店\(昆明翠湖公园店\)/);
  assert.equal(dsParsed.providerLabel, '本机离线 OCR + DeepSeek · deepseek-flash');
  assert.equal(dsParsed.bookings[0].hotelName, '全季酒店（昆明翠湖公园店）');
  assert.equal(dsParsed.bookings[0].amountYuan, 500);

  // 5. 按车次 / 航班号联网查询时刻与参考价
  const lookupAi = {
    configured: true,
    vision: false,
    label: 'DeepSeek · deepseek-flash',
    async chat({ messages }) {
      const text = String(messages.at(-1)?.content ?? '');
      if (text.includes('车次 G128')) {
        return {
          text: JSON.stringify({
            found: true,
            fromLocation: '上海虹桥站',
            toLocation: '北京南站',
            city: '北京市',
            startTime: '10:05',
            endTime: '14:55',
            amountYuan: 553,
            priceNote: '二等座参考价，浮动票价请按实付核对',
            stops: ['上海虹桥 10:05', '南京南 11:08', '济南西 13:18', '北京南 14:55'],
            note: '全程约4小时50分',
          }),
          truncated: false,
        };
      }
      return {
        text: JSON.stringify({
          found: true,
          fromLocation: '上海浦东国际机场T2',
          toLocation: '昆明长水国际机场',
          city: '昆明市',
          startTime: '08:15',
          endTime: '11:45',
          amountYuan: 999, // 即便模型返回机票价，服务端也必须强制置空不编造动态机票价
          priceNote: '机票价格实时浮动，请按实际订单金额填写',
          stops: [],
          note: '中国东方航空',
        }),
        truncated: false,
      };
    },
  };
  const lookupService = createPlannerService({
    ai: lookupAi,
    webSearch: {
      available: true,
      async search(query) {
        return [{ title: `${query} 时刻表`, url: 'https://example.com/train', content: 'G128 10:05 上海虹桥 - 14:55 北京南 二等座553元' }];
      },
    },
  });
  const trainRes = await lookupService.lookupBooking({ kind: 'train', code: 'g128', date: '2026-12-01' }, new AbortController().signal, () => {});
  assert.equal(trainRes.code, 'G128');
  assert.equal(trainRes.fromLocation, '上海虹桥站');
  assert.equal(trainRes.startTime, '10:05');
  assert.equal(trainRes.amountYuan, 553);
  assert.equal(trainRes.stops.length, 4);

  const flightRes = await lookupService.lookupBooking({ kind: 'flight', code: 'mu5801', date: '2026-12-01' }, new AbortController().signal, () => {});
  assert.equal(flightRes.code, 'MU5801');
  assert.equal(flightRes.amountYuan, null);
  assert.equal(flightRes.toLocation, '昆明长水国际机场');
}

console.log('travel-plus-features-test: ALL PASSED');
