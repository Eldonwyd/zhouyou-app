import assert from 'node:assert/strict';
import {
  calculatePlannerBudget,
  enforcePlannerScope,
  plannerConflicts,
  revisePlanner,
  shiftPlannerDates,
  validatePlannerContent,
  updatePlannerDates,
  freshPlannerRequest,
  validatePlannerRequest,
  plannerPartyText,
  plannerValueEqual,
  isExecutablePlannerSuggestion,
} from '../src/planner-domain.ts';
import { plannerFixture, aiPlanFixture } from './planner-fixture.mjs';

const content = plannerFixture();
assert.equal(
  isExecutablePlannerSuggestion({ title: '休息', instruction: '请把早上改为休息，其余不变。' }),
  true,
);
assert.equal(
  isExecutablePlannerSuggestion({
    title: '选择方案',
    instruction: '方案A缩短，方案B休息，请确认采用哪个。',
  }),
  false,
);
validatePlannerContent(content);
const budget = calculatePlannerBudget(content);
assert.equal(budget.categories.tickets, 25000, 'two adults plus one student');
assert.equal(budget.categories.lodging, 80000, 'two rooms on two nights, no return-night hotel');
assert.equal(budget.categories.transport, 30000, 'shared taxi once, three train tickets');
assert.equal(budget.categories.food, 36000);
assert.equal(budget.totalCents, 171000);
assert.deepEqual(budget.unknownItems, ['待确认体验']);

const unknownStudent = structuredClone(content);
unknownStudent.days[0].activities[0].costs[0].studentPriceCents = null;
assert.equal(calculatePlannerBudget(unknownStudent).categories.tickets, 30000);
assert.ok(calculatePlannerBudget(unknownStudent).notes.some((note) => note.includes('暂按成人价')));
const included = structuredClone(content);
included.days[1].activities[0].costs[0].includedIn = 'train-1';
assert.equal(
  calculatePlannerBudget(included).categories.transport,
  24000,
  'included transfer is not charged again',
);
const manualRooms = structuredClone(content);
manualRooms.request.rooms = 3;
assert.equal(calculatePlannerBudget(manualRooms).categories.lodging, 120000);
const missingBase = structuredClone(content);
missingBase.request.base = '';
assert.ok(!calculatePlannerBudget(missingBase).notes.some((note) => /出发地|往返/.test(note)));

const dateOnly = { ...freshPlannerRequest(), startDate: '2027-01-31' };
validatePlannerRequest(dateOnly); // Destination and party prose are optional.
const byDays = updatePlannerDates(dateOnly, { days: 3 });
assert.equal(byDays.endDate, '2027-02-02');
const byEnd = updatePlannerDates(dateOnly, { endDate: '2027-02-03' });
assert.equal(byEnd.days, 4);
assert.equal(updatePlannerDates(byEnd, { startDate: '2027-02-01' }).endDate, '2027-02-04');
assert.equal(updatePlannerDates(byDays, { days: null }).endDate, '');
assert.equal(updatePlannerDates(byDays, { endDate: '' }).days, null);
validatePlannerRequest({ ...byDays, days: 120, endDate: '', people: 150 }); // No old 30-day/100-person caps.

const moved = shiftPlannerDates(content, '2027-01-31');
assert.equal(moved.days[2].date, '2027-02-02');
validatePlannerContent(moved);
assert.deepEqual(plannerConflicts(content), []);
const overlap = structuredClone(content);
overlap.days[0].activities[1].startTime = '10:30';
assert.ok(plannerConflicts(overlap).length > 0);
const badMoney = structuredClone(content);
badMoney.days[0].activities[0].costs[0].unitPriceCents = 1.5;
assert.throws(() => validatePlannerContent(badMoney), /整数分/);
const invalidDate = structuredClone(content);
invalidDate.days[0].date = '2026-12-02';
assert.throws(() => validatePlannerContent(invalidDate), /日期/);
const badRef = structuredClone(content);
badRef.days[0].activities[0].sourceIds = ['invented'];
assert.throws(() => validatePlannerContent(badRef), /来源/);

const localEdit = structuredClone(content);
localEdit.days[0].activities[0].title = '休息';
enforcePlannerScope(content, localEdit, 'sight-1');
const reordered = Object.fromEntries(Object.entries(content).reverse());
enforcePlannerScope(content, reordered, 'sight-1');
const deleted = structuredClone(content);
deleted.days[0].activities.shift();
assert.throws(() => enforcePlannerScope(content, deleted, 'sight-1'), /删除或移走/);
localEdit.days[1].activities[0].title = '越界修改';
assert.throws(() => enforcePlannerScope(content, localEdit, 'sight-1'), /超出/);
const locked = structuredClone(content);
locked.days[0].activities[0].locked = true;
assert.throws(() => enforcePlannerScope(locked, content, null), /锁定/);
const lockedDateShift = shiftPlannerDates(locked, '2026-12-02');
assert.throws(() => enforcePlannerScope(locked, lockedDateShift, null), /锁定/);
const revised = revisePlanner(aiPlanFixture(), moved, '改日期');
assert.equal(revised.version, 2);
assert.deepEqual(revised.history[0].content, content);
const restored = revisePlanner(revised, revised.history[0].content, '撤销');
assert.deepEqual(restored.content, content);
// 学生/老人/儿童：默认 0；旧数据缺项按 0；合计不能超过总人数；门票分人群计价。
assert.equal(freshPlannerRequest().seniors, 0);
assert.equal(freshPlannerRequest().children, 0);
assert.equal(plannerPartyText({ people: 4, students: 0 }), '4 人');
assert.equal(plannerPartyText({ people: 4, students: 1, seniors: 2, children: 0 }), '4 人，其中学生 1 位、老人 2 位');
const party = { ...freshPlannerRequest(), people: 3, students: 1, seniors: 1, children: 2 };
assert.throws(() => validatePlannerRequest(party), /不能超过总人数/);
assert.throws(() => validatePlannerRequest({ ...party, people: 5, children: -1 }), /儿童人数/);
const legacy = { ...freshPlannerRequest(), people: 2, students: 1 };
delete legacy.seniors;
delete legacy.children;
validatePlannerRequest(legacy);
// 旧计划缺少的新字段与默认值视为相同，不能被局部修改的范围检查当作“改动”。
assert.ok(plannerValueEqual({ people: 2, unitPriceCents: 100 }, { people: 2, seniors: 0, children: 0, unitPriceCents: 100, seniorPriceCents: null, childPriceCents: null }));
assert.ok(!plannerValueEqual({ people: 2 }, { people: 2, seniors: 1 }));
const familyContent = structuredClone(content);
familyContent.request = { ...familyContent.request, people: 5, students: 1, seniors: 1, children: 2 };
const ticket = familyContent.days.flatMap((day) => day.activities).flatMap((activity) => activity.costs).find((cost) => cost.unit === 'ticket');
Object.assign(ticket, { unitPriceCents: 10000, studentPriceCents: 5000, seniorPriceCents: 0, childPriceCents: null, occurrences: 1, includedIn: null, status: 'estimate' });
const familyBudget = calculatePlannerBudget(familyContent);
const ticketItem = familyBudget.items.find((item) => item.id === ticket.id);
// 1 成人 100 + 1 学生 50 + 1 老人 0（已知免票）+ 2 儿童未知按成人价 100×2 = 350 元
assert.equal(ticketItem.totalCents, 35000);
assert.match(ticketItem.explanation, /1 位成人＋1 位学生＋1 位老人＋2 位儿童/);
assert.ok(familyBudget.notes.some((note) => note.includes('儿童优惠待确认')));
assert.ok(!familyBudget.notes.some((note) => note.includes(`${ticket.label}老人优惠待确认`)), 'a known free senior ticket is not flagged');
process.stdout.write('Planner money, dates, unknown prices, scope, locks, undo and student/senior/child tickets: OK\n');
