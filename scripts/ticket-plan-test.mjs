import assert from 'node:assert/strict';
import { railwaySaleDate, railwayTicketItems, sortTicketItems } from '../server/ticket-plan.mjs';
import { ticketPlanSignature } from '../src/planner-ticket-signature.ts';
import { plannerFixture } from './planner-fixture.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import {
  countAllUpcomingUrgentTickets,
  getUpcomingTicketUrgency,
  isTicketReminderUrgent,
  needsTicketPreparation,
} from '../src/planner-ticket-display.ts';

// 已保存的旧结果立即隐藏无需预约项，免费但需要预约以及未知规则仍保留。
assert.equal(needsTicketPreparation({ platform: '无需预约', note: '自由活动，无需抢票' }), false);
assert.equal(needsTicketPreparation({ platform: '官方平台', note: '免费，但需要预约' }), true);
assert.equal(needsTicketPreparation({ platform: '待核实', note: '' }), true);
assert.equal(needsTicketPreparation({ bookingRequired: false, platform: '', note: '' }), false);

// 覆盖含当日的预售期、跨年及闰年，避免开售日算晚一天。
assert.equal(railwaySaleDate('2026-12-01'), '2026-11-17');
assert.equal(railwaySaleDate('2027-01-05'), '2026-12-22');
assert.equal(railwaySaleDate('2028-03-01'), '2028-02-16');
const items = railwayTicketItems({ days: [{ date: '2026-12-01', activities: [
  { id: 'train', kind: 'transport', title: '昆明到大理动车', transportMode: '动车', description: '' },
  { id: 'metro', kind: 'transport', title: '地铁', transportMode: '地铁', description: '' },
] }] });
assert.equal(items.length, 1);
assert.equal(items[0].saleDate, '2026-11-17');
assert.equal(items[0].difficulty, '待核实');
const sorted = sortTicketItems([
  { saleDate: '', difficulty: '难' },
  { saleDate: '2026-11-17', saleTime: '09:00', difficulty: '易' },
  { saleDate: '2026-11-17', saleTime: '09:00', difficulty: '难' },
]);
assert.equal(sorted[0].difficulty, '难');
assert.equal(sorted[2].saleDate, '');
console.log('抢票计划：预售日期、铁路识别、时间排序与优先标记通过');

// 自动更新只依赖预约相关内容：照片更新不重复查询，改期/改活动则触发更新。
const content = plannerFixture();
const signature = ticketPlanSignature(content);
content.days[0].activities[0].photo = { url: 'https://example.com/photo.jpg' };
assert.equal(ticketPlanSignature(content), signature);
content.days[0].date = '2026-12-02';
assert.notEqual(ticketPlanSignature(content), signature);
const datedSignature = ticketPlanSignature(content);
content.days[0].activities[0].title = '新景点';
assert.notEqual(ticketPlanSignature(content), datedSignature);

// 用可控服务验证完整查询流程，确保每个景点实际发起搜索并返回可保存的结果。
const searches = [];
const service = createPlannerService({
  webSearch: { available: true, search: async (query) => {
    searches.push(query);
    return [{ title: '官方预约', url: 'https://www.lijiang.gov.cn/', content: '需要提前预约' }];
  } },
  ai: { chat: async () => ({ text: JSON.stringify({ items: [] }) }) },
});
const result = await service.tickets({ plan: { content: plannerFixture() } }, new AbortController().signal, () => {});
assert.ok(searches.length > 0);
assert.ok(result.items.length > 0);
assert.equal(result.networkAvailable, true);
assert.ok(result.checkedAt);
console.log('抢票计划：自动更新签名及完整查询流程通过');

// 红点提醒规则：必须用户主动开启通知，且已进入提前提醒窗口（默认 20 分钟内）或开售后 30 分钟内才显示红点。
{
  const saleMs = new Date(2026, 10, 26, 8, 0, 0, 0).getTime(); // 2026-11-26 08:00 本地时间
  const basePlan = {
    id: 'p-urgency',
    version: 1,
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
    linkedTripId: null,
    linkedSnapshot: null,
    messages: [],
    history: [],
    hotels: {},
    content: plannerFixture(),
    ticketPlan: {
      signature: 's',
      checkedAt: '2026-11-25T00:00:00Z',
      networkAvailable: true,
      items: [
        {
          activityId: 'ticket-a',
          title: '南山一棵树观景台夜景',
          travelDate: '2026-11-26',
          saleDate: '2026-11-26',
          saleTime: '08:00',
          difficulty: '易',
          platform: '官方渠道',
          note: '提前购票',
          bookingRequired: true,
          sources: [],
        },
      ],
    },
    ticketReminders: {},
  };

  // 未开启通知：即便距离开抢仅剩 10 分钟也不出红点
  assert.equal(getUpcomingTicketUrgency(basePlan, saleMs - 10 * 60_000).urgentCount, 0);
  assert.equal(countAllUpcomingUrgentTickets([basePlan], saleMs - 10 * 60_000), 0);

  // 开启通知（默认提前 20 分钟）：开抢前 9 小时不出红点，开抢前 21 分钟不出红点
  const enabledPlan = {
    ...basePlan,
    ticketReminders: {
      'ticket-a': { enabled: true, leadMinutes: 20 },
    },
  };
  assert.equal(getUpcomingTicketUrgency(enabledPlan, saleMs - 9 * 60 * 60_000).urgentCount, 0);
  assert.equal(getUpcomingTicketUrgency(enabledPlan, saleMs - 21 * 60_000).urgentCount, 0);

  // 开抢前 20 分钟整 & 15 分钟内：出现红点与准确倒计时
  const at20 = getUpcomingTicketUrgency(enabledPlan, saleMs - 20 * 60_000);
  assert.equal(at20.urgentCount, 1);
  assert.equal(at20.soonestLabel, '20 分钟后开抢');
  const at15 = getUpcomingTicketUrgency(enabledPlan, saleMs - 15 * 60_000);
  assert.equal(at15.urgentCount, 1);
  assert.equal(at15.soonestLabel, '15 分钟后开抢');
  assert.equal(isTicketReminderUrgent(enabledPlan.ticketPlan.items[0], enabledPlan.ticketReminders['ticket-a'], saleMs - 15 * 60_000), true);

  // 开售后 10 分钟仍在 30 分钟宽限期内：显示“正在开抢”；开售后 35 分钟自动消红点
  const live = getUpcomingTicketUrgency(enabledPlan, saleMs + 10 * 60_000);
  assert.equal(live.urgentCount, 1);
  assert.equal(live.soonestLabel, '正在开抢');
  assert.equal(getUpcomingTicketUrgency(enabledPlan, saleMs + 35 * 60_000).urgentCount, 0);

  // 自定义提前 45 分钟：开抢前 30 分钟出现红点
  const customLeadPlan = {
    ...basePlan,
    ticketReminders: {
      'ticket-a': { enabled: true, leadMinutes: 45 },
    },
  };
  assert.equal(getUpcomingTicketUrgency(customLeadPlan, saleMs - 30 * 60_000).urgentCount, 1);
  assert.equal(getUpcomingTicketUrgency(customLeadPlan, saleMs - 50 * 60_000).urgentCount, 0);
  console.log('抢票计划：红点仅在开启通知且进入提前窗口后触发测试通过');
}
