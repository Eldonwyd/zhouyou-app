import assert from 'node:assert/strict';
import { normalizePlannerOutput } from '../server/normalize-planner.mjs';
import { plannerActivitiesByTime, validatePlannerContent } from '../src/planner-domain.ts';
import {
  formatTransferOption,
  isIntraCityTransferCard,
  plannerGapTransfer,
  plannerTransferDisplay,
  plannerTransferOptions,
} from '../src/planner-display.ts';

/** AI 活动里常见的小格式问题应被修复，而不是让整份行程校验失败。 */
const request = { destination: '加格达奇', startDate: '2026-11-12', days: 2, endDate: '2026-11-13' };
const activity = (extra) => ({ title: '甘河雾凇', city: '加格达奇', location: '甘河', description: '看雾凇', costs: [], ...extra });
const raw = {
  title: '加格达奇两日', summary: '', constraints: [], warnings: [], sources: [], alternatives: [],
  cities: [{ code: '232700', provinceCode: '230000', name: '大兴安岭地区' }],
  days: [
    { date: '2026-11-12', title: '第一天', weather: '晴', lodging: { city: '加格达奇', area: '城区', searchKeyword: '加格达奇 城区', reason: '方便', costs: [] },
      activities: [
        activity({ id: 'a1', kind: '景点', period: '上午', startTime: '7:30', endTime: '9:00' }),
        activity({ id: 'a1', kind: 'food', meal: '午餐', period: 'noon', startTime: '12:00:00', endTime: '13：00' }),
        activity({ id: 'a3', kind: 'transport', startTime: '14:00-16:30', toActivityId: 'missing', photo: { url: 'bad' } }),
        activity({ kind: 'rest', period: '晚上', startTime: '23:00', endTime: '01:00', locked: 'false' }),
        null,
      ] },
    { date: '2026-11-13', title: '第二天', weather: '雪', lodging: null,
      activities: [activity({ id: 'b1', kind: 'sight', period: 'afternoon', startTime: '15:00', endTime: '15:00', fromActivityId: 'a3' })] },
  ],
};
const content = normalizePlannerOutput(raw, request, []);
validatePlannerContent(content);
const [day1, day2] = content.days;
assert.equal(day1.activities.length, 4, 'null activity dropped');
assert.deepEqual(day1.activities.map((item) => item.startTime), ['07:30', '12:00', '14:00', '23:00']);
assert.deepEqual(day1.activities.map((item) => item.endTime), ['09:00', '13:00', '16:30', '23:59']);
assert.equal(new Set(day1.activities.map((item) => item.id)).size, 4, 'duplicate ids made unique');
assert.equal(day1.activities[0].kind, 'sight');
assert.equal(day1.activities[0].period, 'morning');
assert.equal(day1.activities[1].meal, 'lunch');
assert.equal(day1.activities[2].period, 'afternoon', 'period derived from time');
assert.equal(day1.activities[2].toActivityId, null, 'dangling link removed');
assert.equal(day1.activities[2].photo, null, 'invalid photo cleared');
assert.equal(day2.activities[0].endTime, '16:00', 'zero-length activity gets an hour');
assert.equal(day2.activities[0].fromActivityId, 'a3');

// 交通距离兼容模型输出的米和公里，显示时按排程计算预计耗时。
const routeRaw = structuredClone(raw);
const routeActivities = routeRaw.days[0].activities;
Object.assign(routeActivities[2], { title: '去下一站', startTime: '09:00', endTime: '09:15', distanceKm: '约 750 米', transportMode: '步行', fromActivityId: 'a1', toActivityId: 'next' });
routeActivities[1].id = 'next';
routeActivities[1].title = '博物馆';
routeActivities[1].distanceKm = 12;
const routeContent = normalizePlannerOutput(routeRaw, request, []);
validatePlannerContent(routeContent);
const routeDay = routeContent.days[0];
const routeById = new Map(routeDay.activities.map((item) => [item.id, item]));
const transfer = routeById.get('a3');
assert.equal(transfer.distanceKm, 0.75);
assert.equal(routeById.get('next').distanceKm, undefined);
assert.deepEqual(plannerActivitiesByTime(routeDay.activities).slice(0, 3).map((item) => item.id), ['a1', 'a3', 'next']);
assert.deepEqual(plannerTransferDisplay(transfer, routeById), {
  route: '甘河雾凇 → 博物馆',
  sameCity: true,
  details: '步行 · 约 750 米 · 预计 15 分钟',
});
const crossCity = new Map(routeById).set('next', { ...routeById.get('next'), city: '漠河市' });
assert.equal(plannerTransferDisplay(transfer, crossCity).sameCity, false);
routeActivities[2].distanceKm = '约 6.2 公里';
routeActivities[2].transportMode = '地铁 2 号线';
const subway = normalizePlannerOutput(routeRaw, request, []).days[0].activities.find((item) => item.id === 'a3');
assert.equal(plannerTransferDisplay(subway, routeById).details, '地铁 2 号线 · 约 6.2 公里 · 预计 15 分钟');
routeActivities[2].distanceKm = '无资料';
const unknownDistance = normalizePlannerOutput(routeRaw, request, []).days[0].activities.find((item) => item.id === 'a3');
assert.match(plannerTransferDisplay(unknownDistance, routeById).details, /距离待确认/);
// 单独的“学生票/老人票”费用项并入主门票，避免预算按全部人数重复计费。
const tickets = structuredClone(raw);
tickets.days[1].activities[0].costs = [
  { label: '崇圣寺三塔成人票', category: 'tickets', unit: 'ticket', unitPriceCents: 7500, studentPriceCents: 3750, qualification: '学生证减半' },
  { label: '崇圣寺三塔学生票', category: 'tickets', unit: 'ticket', unitPriceCents: 3000 },
  { label: '崇圣寺三塔老人票', category: 'tickets', unit: 'ticket', unitPriceCents: 3750, qualification: '60-69岁减半' },
  { label: '电瓶车', category: 'transport', unit: 'person', unitPriceCents: 3500 },
];
const merged = normalizePlannerOutput(tickets, request, []);
validatePlannerContent(merged);
const mergedCosts = merged.days[1].activities[0].costs;
assert.deepEqual(mergedCosts.map((cost) => cost.label), ['崇圣寺三塔成人票', '电瓶车']);
assert.equal(mergedCosts[0].studentPriceCents, 3750, 'an existing student price is kept');
assert.equal(mergedCosts[0].seniorPriceCents, 3750, 'senior price comes from the separate senior ticket');
assert.match(mergedCosts[0].qualification, /60-69岁减半/);
// 局部修改不动其他活动：保留原样（避免旧计划被判为超出所选模块）。
assert.equal(normalizePlannerOutput(tickets, request, [], true).days[1].activities[0].costs.length, 4);

// 公共交通与自驾的结构化交通方案（步行/地铁换乘/打车 vs 自驾仅保留公里与分钟）。
const transitRaw = structuredClone(routeRaw);
transitRaw.days[0].activities[2].transferOptions = [
  { mode: '步行', distanceKm: '750米', durationMinutes: '11分钟' },
  {
    mode: '地铁',
    recommended: true,
    line: '地铁 1 号线换乘 2 号线',
    fromStation: '西北角站',
    toStation: '东南角站',
    transferNote: '西南角站换乘',
    durationMinutes: 18,
    costYuan: '3元',
    costUnit: '人',
  },
  {
    mode: '打车',
    durationMinutes: 35,
    distanceKm: '24公里',
    costYuan: '72元',
    costUnit: '辆',
    carpoolYuan: '36元',
    carpoolNote: '顺风车可提前预约',
  },
];
transitRaw.days[0].activities[1].transferOptions = [{ mode: 'walk', distanceKm: 0.5, durationMinutes: 8 }];
const transitContent = normalizePlannerOutput(transitRaw, { ...request, transport: '公共交通' }, []);
validatePlannerContent(transitContent);
const transitDay = transitContent.days[0];
const transitById = new Map(transitDay.activities.map((item) => [item.id, item]));
const transitLeg = transitById.get('a3');
assert.equal(transitById.get('next').transferOptions, undefined, 'non-transport strips transferOptions');
assert.equal(isIntraCityTransferCard(transitLeg, transitById, transitDay.activities), true);
const publicOpts = plannerTransferOptions(transitLeg, transitContent.request).map(formatTransferOption);
assert.equal(publicOpts.length, 3);
assert.equal(publicOpts[0].title, '步行');
assert.deepEqual(publicOpts[0].metrics, ['约 750 米', '预计 11 分钟']);
assert.equal(publicOpts[1].title, '地铁 1 号线换乘 2 号线');
assert.equal(publicOpts[1].stations, '西北角站 → 东南角站');
assert.deepEqual(publicOpts[1].metrics, ['预计 18 分钟', '约 ¥3/人']);
assert.equal(publicOpts[1].note, '西南角站换乘');
assert.equal(publicOpts[2].title, '打车');
assert.deepEqual(publicOpts[2].metrics, ['预计 35 分钟', '约 24 公里', '预计 ¥72']);
assert.equal(publicOpts[2].carpool, '顺风车约 ¥36');
assert.equal(publicOpts[2].note, '顺风车可提前预约');

// 自驾模式只展示开车几公里几分钟，过滤公共交通备选。
const driveRaw = structuredClone(transitRaw);
driveRaw.days[0].activities[2].transferOptions.push({ mode: '自驾', distanceKm: '4.5公里', durationMinutes: '14分钟' });
const driveContent = normalizePlannerOutput(driveRaw, { ...request, transport: '自驾' }, []);
validatePlannerContent(driveContent);
const driveLeg = driveContent.days[0].activities.find((item) => item.id === 'a3');
const driveOpts = plannerTransferOptions(driveLeg, driveContent.request).map(formatTransferOption);
assert.equal(driveOpts.length, 1);
assert.equal(driveOpts[0].mode, 'drive');
assert.equal(driveOpts[0].title, '自驾开车');
assert.deepEqual(driveOpts[0].metrics, ['约 4.5 公里', '预计 14 分钟']);

// 旧计划没有独立交通卡时，两张相邻卡片缝隙自动识别交通提示。
const gap = plannerGapTransfer(
  { ...transitById.get('a1'), title: '西北角特色街区吃津味午餐', location: '红桥区芥园道', transportMode: '地铁' },
  { ...transitById.get('next'), title: '古文化街·津门故里', location: '南开区通北路', transportMode: '地铁+步行' },
  { transport: '公共交通' },
);
assert.ok(gap);
assert.deepEqual(gap.modes, ['subway', 'walk']);
assert.equal(gap.label, '地铁+步行');
assert.equal(gap.isSelfDrive, false);

console.log('Planner activity repair: times, periods, kinds, ids, links, photos, merged group tickets, transferOptions: OK');
