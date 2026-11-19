import assert from 'node:assert/strict';
import { createPlannerService } from '../server/planner-service.mjs';
import { aiPlanFixture } from './planner-fixture.mjs';

/** 使用可控检索资料验证餐饮攻略按当前活动查店，而不是查询整个旅行目的地。 */
const queries = [];
let prompt = '';
const service = createPlannerService({
  webSearch: { available: true, search: async (query) => {
    queries.push(query);
    return [{ title: '餐厅评价资料', url: 'https://example.com/restaurant', content: '附近餐厅资料，含地址与用户评价' }];
  } },
  ai: { chat: async (input) => {
    prompt = input.messages.at(-1).content;
    return { text: JSON.stringify({ answer: '附近店铺推荐，价格为预估。', suggestions: [] }) };
  } },
});
const plan = aiPlanFixture();
const food = plan.content.days[0].activities.find((activity) => activity.kind === 'food');
food.title = '菌子火锅晚餐';
food.location = '官渡古镇';
const original = JSON.stringify(plan.content);
const response = await service.chat({ plan, baseVersion: plan.version, scopeId: food.id,
  activityGuide: true, mode: 'auto', message: '请提供详细餐饮攻略，推荐附近评价有依据的具体店铺。不修改行程。',
}, new AbortController().signal, () => {});
assert.equal(response.action, 'answer');
assert.ok(queries.some((query) => query.includes('官渡古镇') && query.includes('店名') && query.includes('人均')));
assert.ok(queries.some((query) => query.includes('官渡古镇') && query.includes('真实评价')));
assert.ok(prompt.includes('附近餐厅资料'));
assert.equal(JSON.stringify(plan.content), original);
console.log('餐饮详细攻略：按地点检索店铺评价、资料传入模型且不修改行程，通过');
