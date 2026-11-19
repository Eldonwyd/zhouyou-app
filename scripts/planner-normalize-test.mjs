import assert from 'node:assert/strict';
import { normalizePlannerOutput, preparePlannerInput } from '../server/normalize-planner.mjs';
import {
  validatePlannerContent,
  calculatePlannerBudget,
  plannerValueEqual,
} from '../src/planner-domain.ts';
import { plannerFixture } from './planner-fixture.mjs';

const original = plannerFixture();
const sources = original.sources;
const flexible = structuredClone(original);
flexible.request.people = 3;
flexible.request.students = 1;
flexible.days[0].activities[0].costs = [
  {
    label: '门票',
    category: '门票',
    unit: '每人',
    unitPriceCents: '10000',
    quantity: '1',
    occurrences: '1',
  },
];
flexible.days[1].activities[0].costs = [
  { label: '接驳', category: '交通费', unit: '每辆', unitPriceYuan: '60元' },
];
flexible.days[2].activities[1].costs = '体验费用到现场确认';
const request = {
  ...original.request,
  travelersText: '三个人，其中一名学生',
  notes: '随意填写的要求，不限定选项',
};
const normalized = normalizePlannerOutput(flexible, request, sources);
validatePlannerContent(normalized);
assert.equal(normalized.request.travelersText, request.travelersText);
assert.equal(normalized.request.notes, request.notes);
assert.equal(normalized.request.people, 3);
assert.equal(normalized.days[0].activities[0].costs[0].status, 'estimate');
assert.equal(normalized.days[1].activities[0].costs[0].unitPriceCents, 6000);
assert.equal(normalized.days[2].activities[1].costs[0].unitPriceCents, null);
assert.ok(calculatePlannerBudget(normalized).unknownItems.includes('体验费用到现场确认'));

const unknown = structuredClone(original);
unknown.days[0].activities[0].costs = [
  { name: '门票', unit: '不明确', price: '成人约100元，学生待确认' },
];
const uncertain = normalizePlannerOutput(unknown, request, sources);
validatePlannerContent(uncertain);
assert.equal(uncertain.days[0].activities[0].costs[0].unitPriceCents, null);
assert.match(uncertain.days[0].activities[0].costs[0].qualification, /成人约100元/);
assert.ok(
  plannerValueEqual(normalizePlannerOutput(uncertain, uncertain.request, sources, true), uncertain),
  'normalization must be idempotent',
);

const freeObject = structuredClone(original);
freeObject.days[0].activities[0].costs = {
  门票: { unit: '票', unitPriceCents: 10000 },
  额外体验: '现场询价',
};
validatePlannerContent(normalizePlannerOutput(freeObject, request, sources));
const duplicate = structuredClone(original);
duplicate.days[1].activities[0].costs[0].id = duplicate.days[0].activities[0].costs[0].id;
validatePlannerContent(normalizePlannerOutput(duplicate, request, sources));

const prepared = preparePlannerInput({
  ...request,
  startTime: '04:00',
  returnTo: '常住地',
  endDate: '',
  days: 3,
});
assert.equal(prepared.endDate, '2026-12-03');
assert.ok(!('startTime' in prepared) && !('returnTo' in prepared));
assert.equal(prepared.notes, request.notes);
assert.equal(preparePlannerInput({ ...request, transport: '火车＋当地公共交通' }).transport, '公共交通');
assert.equal(preparePlannerInput({ ...request, transport: '火车 + 租车' }).transport, '租车');
assert.equal(preparePlannerInput({ ...request, transport: '飞机＋公共交通' }).transport, '公共交通');
assert.equal(preparePlannerInput({ ...request, transport: '打车／网约车' }).transport, '打车／网约车');

const explicit = {
  ...original.request,
  travelersText: '3 人，其中 1 位学生',
  people: 3,
  students: 1,
  budgetCents: 500000,
  rooms: 2,
};
const changedByModel = structuredClone(original);
changedByModel.request.people = 8;
changedByModel.request.students = 0;
changedByModel.request.budgetCents = 900000;
changedByModel.request.rooms = 5;
const preserved = normalizePlannerOutput(changedByModel, explicit, sources);
assert.equal(preserved.request.people, 3);
assert.equal(preserved.request.students, 1);
assert.equal(preserved.request.budgetCents, 500000);
assert.equal(preserved.request.rooms, 2);
console.log('Flexible cost normalization, raw descriptions, party prose and calendar input: OK');
