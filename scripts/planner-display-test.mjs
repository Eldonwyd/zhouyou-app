import assert from 'node:assert/strict';
import { plannerExportText, plannerTransferSelection, splitAnswerLinks } from '../src/planner-display.ts';
import { plannerShortStage } from '../src/planner-stage.ts';

/** 回答里的链接单独列为“相关链接”；进度只显示正在做什么。 */
const answer = '玉龙雪山需提前 7 天实名预约。\n\n相关链接：玉龙雪山预约与票价 https://www.sina.cn/news/article/comos_niuvanp5849903.html ；昆大丽交通指南 https://www.sina.cn/gc/article/niuqqhr7145196.html ；云南天气 https://health.weather.com.cn/news/2026/11/4855689.shtml。';
const { body, links } = splitAnswerLinks(answer);
// 纯文字导出保留关键说明，清除引用编号、Markdown/裸链接及来源占位编号。
const exportContent = { sources: [{ id: 'source-1', title: '冗长的来源标题' }], days: [] };
const plainExport = plannerExportText('提前预约[1] [source-1]。\n[查看预约说明](https://example.com/?token=abc)\nhttps://example.com/%E4%BA%91?tracking=abc\n\uE200cite\uE202turn0search0\uE201', exportContent);
assert.ok(plainExport.includes('提前预约'));
assert.ok(plainExport.includes('查看预约说明'));
assert.ok(!/https?:|source-1|冗长|tracking|turn0search|\[1\]/.test(plainExport));
assert.equal(body, '玉龙雪山需提前 7 天实名预约。');
assert.deepEqual(links.map((link) => link.title), ['玉龙雪山预约与票价', '昆大丽交通指南', '云南天气']);
assert.equal(links[2].url, 'https://health.weather.com.cn/news/2026/11/4855689.shtml', 'trailing punctuation is not part of the link');
assert.equal(links[0].host, 'sina.cn');

// 正文夹带的网址也提取出来，正文不再显示裸网址；同一网址只列一次。
const inline = splitAnswerLinks('可查滇池官网的观鸥专线页面（https://dianchi.km.gov.cn/c/2026-11-09/7196516.shtml），以官网为准。相关链接：滇池观鸥 https://dianchi.km.gov.cn/c/2026-11-09/7196516.shtml');
assert.ok(!inline.body.includes('http'));
assert.equal(inline.links.length, 1);
assert.equal(splitAnswerLinks('没有任何链接的回答。').links.length, 0);
assert.equal(splitAnswerLinks('相关链接：坏链接 javascript:alert(1)').links.length, 0);

// 同一路段单人可步行，同行三人时分摊车费后打车更划算。手动选择优先于实时推荐。
const transferOptions = [
  { mode: 'walk', distanceKm: 1.2, durationMinutes: 16 },
  { mode: 'subway', durationMinutes: 18, costCents: 200, recommended: true },
  { mode: 'taxi', distanceKm: 2.4, durationMinutes: 8, costCents: 1100 },
];
assert.deepEqual(plannerTransferSelection(transferOptions, 1), { recommendedIndex: 0, chosenIndex: 0 });
assert.deepEqual(plannerTransferSelection(transferOptions, 3), { recommendedIndex: 2, chosenIndex: 2 });
assert.deepEqual(plannerTransferSelection(transferOptions, 3, 1), { recommendedIndex: 2, chosenIndex: 1 });
assert.equal(plannerTransferSelection(transferOptions, 3, 99).chosenIndex, 2);

// 同等耗时和票价时优先少绕路；长距离步行与短距离步行即使耗时相同也会得到不同评分。
assert.equal(plannerTransferSelection([
  { mode: 'bus', distanceKm: 6, durationMinutes: 15, costCents: 200, recommended: true },
  { mode: 'subway', distanceKm: 3, durationMinutes: 15, costCents: 200 },
], 1).chosenIndex, 1);
assert.equal(plannerTransferSelection([{ ...transferOptions[0], distanceKm: 3 }, transferOptions[1]], 1).chosenIndex, 1);
assert.equal(plannerTransferSelection([{ mode: 'walk' }, { mode: 'bus', recommended: true }], 1).chosenIndex, 1);
assert.equal(plannerTransferSelection([], 1).chosenIndex, -1);

assert.equal(plannerShortStage('正在优先检索小红书攻略与游玩评价，同时核对官方资料'), '搜索资料中…');
assert.equal(plannerShortStage('正在安排每日路线、交通与住宿片区'), '规划行程中…');
assert.equal(plannerShortStage('正在检查小红书封面（2/4）'), '寻找图片…');
assert.equal(plannerShortStage('正在计算预算'), '计算开销…');
assert.equal(plannerShortStage('正在保存照片与行程到本地'), '保存中…');
assert.equal(plannerShortStage('正在连接本地 AI 服务…'), '连接中…');
assert.equal(plannerShortStage('正在理解问题或修改要求'), '理解问题中…');
console.log('Planner display: related links split from answers, short progress stages: OK');
