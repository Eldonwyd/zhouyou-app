import assert from 'node:assert/strict';
import { railwaySaleDate, railwayTicketItems, sortTicketItems } from '../server/ticket-plan.mjs';
import { ticketPlanSignature } from '../src/planner-ticket-signature.ts';
import { plannerFixture } from './planner-fixture.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import { needsTicketPreparation } from '../src/planner-ticket-display.ts';

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
