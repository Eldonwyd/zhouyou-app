import assert from 'node:assert/strict';
import { createXhsBridge, parseXhsFeedRef } from '../server/xhs-bridge.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import { createPlannerServer } from '../server/index.mjs';
import {
  buildXhsInsertPrompt,
  extractXhsUrlFromText,
  extractXhsUrlsFromText,
  mergeXhsReferences,
  referencesToWishlist,
  summarizeXhsForMessage,
} from '../src/planner-xhs.ts';
import { aiPlanFixture, plannerFixture } from './planner-fixture.mjs';

const signal = new AbortController().signal;

// 1. 纯函数工具：口令提取、多帖合并去重、待选灵感池与插入提示词
const shareCopy = '89 旅行博主发布了一篇小红书笔记，快来看吧！ 😆 abc123 😆 http://xhslink.com/a/Demo123 复制本条信息，打开【小红书】App查看精彩内容！';
assert.equal(extractXhsUrlFromText(shareCopy), 'http://xhslink.com/a/Demo123');
// 保留分享文案中的反斜杠，验证转义格式和原始格式都指向同一条短链。
const tianjinShareCopy = String.raw`人均300｜天津48h特种兵citywalk✨不绕路版 谁懂啊！... https\://xhslink.cn/o/42dqlXVtptg 这篇笔记在【小红书】候着你瞧\~`;
const tianjinShortUrl = 'https://xhslink.cn/o/42dqlXVtptg';
assert.equal(extractXhsUrlFromText(tianjinShareCopy), tianjinShortUrl);
assert.equal(extractXhsUrlFromText(tianjinShortUrl), tianjinShortUrl);
assert.equal(extractXhsUrlFromText('https://xhslink.cn.example/o/42dqlXVtptg'), null);
assert.deepEqual(extractXhsUrlsFromText(`${tianjinShareCopy}\n${shareCopy}\n${tianjinShortUrl}`), [
  tianjinShortUrl,
  'http://xhslink.com/a/Demo123',
]);
assert.equal(
  parseXhsFeedRef('https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=tok_1&xsec_source=pc_share')?.id,
  '0123456789abcdef01234567',
);
assert.equal(parseXhsFeedRef('https://evil.example/explore/0123456789abcdef01234567?xsec_token=tok_1'), null);

const refA = {
  id: 'ref-a',
  sourceType: 'xhs_link',
  title: '大理苍山洱海3天慢游',
  url: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=tok_1',
  destinations: ['大理'],
  suggestedDays: 3,
  styleTags: ['慢节奏'],
  routeOutline: ['D1：龙龛码头→才村→大理古城'],
  tips: ['龙龛码头看日出建议 7:00 前到'],
  places: [
    { id: 'p1', name: '龙龛码头', canonicalName: '龙龛码头', city: '大理市', kind: 'sight', dayHint: 1, note: '日出绝美', selected: true },
    { id: 'p2', name: '菌菇火锅老店', canonicalName: '菌菇火锅老店', city: '大理', kind: 'food', dayHint: 1, note: '土鸡汤底', selected: true },
  ],
};
const refB = {
  ...refA,
  id: 'ref-b',
  title: '大理美食与日落合集',
  places: [
    { id: 'p3', name: '龙龛码头', canonicalName: '龙龛码头', city: '大理', kind: 'sight', dayHint: null, note: '重复点位', selected: true },
    { id: 'p4', name: '喜洲古镇稻田', canonicalName: '喜洲古镇', city: '大理', kind: 'photo_spot', dayHint: 2, note: '下午顺光', selected: true },
  ],
};
const merged = mergeXhsReferences([refA], refB);
assert.equal(merged.length, 2);
assert.equal(merged[1].places[0].selected, false, 'duplicate place across notes is unchecked by default');
assert.equal(merged[1].places[1].selected, true);

const { next: wishlist, addedCount } = referencesToWishlist(merged, []);
assert.equal(addedCount, 3);
assert.equal(wishlist[0].sourceUrl, refA.url);
assert.equal(referencesToWishlist(merged, wishlist).addedCount, 0, 'wishlist deduplicates repeat saves');

const insertAskPrompt = buildXhsInsertPrompt([wishlist[2]], { targetDate: 'auto', mode: 'insert', askFirst: true });
assert.match(insertAskPrompt, /喜洲古镇稻田/);
assert.match(insertAskPrompt, /不要直接修改/);
const summaryAttachments = summarizeXhsForMessage(merged);
assert.equal(summaryAttachments.length, 2);
assert.deepEqual(summaryAttachments[0].placeNames, ['龙龛码头', '菌菇火锅老店']);

// 2. XHS Bridge：短链 302 重定向解析 + 只读详情读取 + SSRF 防护
const feedId = '0123456789abcdef01234567';
const bridge = createXhsBridge({
  baseUrl: 'http://127.0.0.1:18060',
  token: 'xhs-test',
  fetchImpl: async (address, options = {}) => {
    const u = String(address);
    if (u === 'http://xhslink.com/a/Demo123' || u === tianjinShortUrl) {
      return new Response('', {
        status: 302,
        headers: { location: `https://www.xiaohongshu.com/discovery/item/${feedId}?xsec_token=sec_ok&xsec_source=app_share` },
      });
    }
    if (u === 'http://xhslink.com/a/BadHost') {
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:9999/internal' } });
    }
    const parsed = new URL(u);
    assert.equal(parsed.hostname, '127.0.0.1');
    if (parsed.pathname.endsWith('/login/status')) return Response.json({ success: true, data: { is_logged_in: true } });
    if (parsed.pathname.endsWith('/feeds/detail')) {
      const body = JSON.parse(options.body);
      assert.equal(body.feed_id, feedId);
      assert.equal(body.xsec_token, 'sec_ok');
      return Response.json({
        success: true,
        data: {
          data: {
            note: {
              title: '丽江大理3天不赶路',
              desc: '第一天丽江古城慢逛，吃腊排骨；第二天去玉龙雪山蓝月谷，记得提前抢索道票。',
              user: { nickname: '慢游日记' },
              time: 1742000000000,
              imageList: [
                { urlDefault: 'http://sns-webpic-qc.xhscdn.com/note1.jpg?sign=abc' },
                { urlDefault: 'http://evil.example/hack.jpg' },
              ],
            },
            comments: { list: [{ content: '蓝月谷下午逆光，上午去更蓝！' }] },
          },
        },
      });
    }
    throw new Error(`Unexpected URL: ${u}`);
  },
});

const note = await bridge.readNoteByUrl(shareCopy, signal);
assert.equal(note.id, feedId);
assert.equal(note.author, '慢游日记');
assert.equal(note.images.length, 1);
assert.equal(note.images[0], 'https://sns-webpic-qc.xhscdn.com/note1.jpg?sign=abc');
assert.equal(note.comments[0], '蓝月谷下午逆光，上午去更蓝！');
await assert.rejects(() => bridge.readNoteByUrl('http://xhslink.com/a/BadHost', signal), /未能从该小红书链接解析/);
await assert.rejects(
  () => bridge.readNoteByUrl(`https://www.xiaohongshu.com/explore/${feedId}`, signal),
  /xsec_token/,
);

// 3. Planner Service：parseXhs（链接 / 截图 / 文字）+ generate + chat 融合验证
const promptLog = [];
const mockAi = {
  configured: true,
  vision: true,
  label: 'MockVision · test',
  async chat({ messages }) {
    const last = messages.at(-1).content;
    const textPart = Array.isArray(last) ? last.find((p) => p.type === 'text')?.text ?? '' : String(last);
    const hasImage = Array.isArray(last) && last.some((p) => p.type === 'image');
    promptLog.push({ textPart, hasImage });

    if (textPart.includes('提取出结构化的行程参考与所有具体地点清单')) {
      return {
        text: JSON.stringify({
          title: hasImage ? '截图里的丽江美食攻略' : '丽江大理3天不赶路',
          destinations: ['丽江'],
          suggestedDays: 3,
          styleTags: ['慢节奏', '美食打卡'],
          routeOutline: ['D1：丽江古城→腊排骨火锅', 'D2：玉龙雪山→蓝月谷'],
          tips: ['蓝月谷上午去更顺光'],
          places: [
            { name: '蓝月谷', canonicalName: '蓝月谷', city: '丽江', kind: 'sight', dayHint: 2, note: '上午光线好' },
            { name: '阿婆腊排骨', canonicalName: '阿婆腊排骨', city: '丽江', kind: 'food', dayHint: 1, note: '本地老店' },
          ],
        }),
        truncated: false,
      };
    }
    if (textPart.includes('只回答与提出建议')) {
      return {
        text: JSON.stringify({
          answer: `对比小红书笔记，可以把蓝月谷放在第二天上午并避开下午逆光。\n相关链接：小红书参考 ${note.url}`,
          suggestions: [
            {
              label: 'A',
              title: '第二天加入阿婆腊排骨晚餐',
              instruction: '请把第二天晚餐改为丽江阿婆腊排骨，保留其余活动与锁定项。',
            },
          ],
        }),
        truncated: false,
      };
    }
    if (textPart.includes('生成完整行程')) {
      const content = plannerFixture();
      content.days[0].activities[0].sourceIds = ['s-xhs-ref-1'];
      return { text: JSON.stringify(content), truncated: false };
    }
    return { text: JSON.stringify({ action: 'answer' }), truncated: false };
  },
};

const service = createPlannerService({
  apiKey: 'test',
  ai: mockAi,
  visionAi: mockAi,
  webSearch: { available: false, search: async () => [] },
  xhsBridge: bridge,
});

// 3a. 链接解析
const linkParsed = await service.parseXhs({ text: shareCopy }, signal, () => {});
assert.equal(linkParsed.reference.sourceType, 'xhs_link');
assert.equal(linkParsed.reference.url, note.url);
assert.equal(linkParsed.reference.places.length, 2);
assert.equal(linkParsed.usedVision, false);

// 本地连接不可用时，纯分享摘要给出读取错误，额外粘贴的正文仍可独立解析。
const disconnectedService = createPlannerService({
  ai: mockAi,
  xhsBridge: { async readNoteByUrl() { throw new Error('小红书尚未登录'); } },
});
await assert.rejects(() => disconnectedService.parseXhs({ text: tianjinShareCopy }, signal, () => {}), /小红书尚未登录/);
const pastedBody = '第一天沿海河步行，从天津站到意式风情区，下午去古文化街和鼓楼，第二天去五大道。';
const bodyParsed = await disconnectedService.parseXhs({ text: `${tianjinShareCopy}\n${pastedBody}` }, signal, () => {});
assert.equal(bodyParsed.reference.sourceType, 'text');
assert.ok(promptLog.at(-1).textPart.includes(pastedBody));
assert.ok(!promptLog.at(-1).textPart.includes('这篇笔记在【小红书】'));

// 3b. 截图解析（瞬时 base64，返回不含原图）
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const shotParsed = await service.parseXhs({ images: [tinyPng] }, signal, () => {});
assert.equal(shotParsed.reference.sourceType, 'screenshot');
assert.equal(shotParsed.usedVision, true);
assert.ok(!JSON.stringify(shotParsed).includes(tinyPng), 'screenshot base64 is never echoed back');

// 3c. 基于小红书参考生成新行程（原帖 URL 进入 sources，且参考策略传入提示词）
const genReq = {
  ...plannerFixture().request,
  references: [linkParsed.reference],
  referenceMode: 'follow',
};
const generated = await service.generate({ request: genReq }, signal, () => {});
assert.ok(generated.content.sources.some((s) => s.url === note.url), 'XHS reference URL saved as real PlannerSource');
assert.ok(
  promptLog.some((entry) => entry.textPart.includes('尽量复刻原帖') && entry.textPart.includes('蓝月谷')),
  'referenceMode and selected places injected into generate prompt',
);

// 多篇综合参考会进入同一份请求，保留用户选定的行程时长和各自的来源。
const secondNote = {
  ...refB,
  url: 'https://www.xiaohongshu.com/explore/0123456789abcdef01234568?xsec_token=tok_2',
  suggestedDays: 5,
};
const blended = await service.generate({ request: {
  ...genReq, references: [linkParsed.reference, secondNote], referenceMode: 'blend',
} }, signal, () => {});
assert.equal(blended.content.request.referenceMode, 'blend');
assert.equal(blended.content.request.days, genReq.days);
assert.ok(blended.content.sources.some((source) => source.url === secondNote.url));
const blendPrompt = promptLog.find((entry) => entry.textPart.includes('参考策略【综合参考】')).textPart;
assert.ok(blendPrompt.includes(linkParsed.reference.title) && blendPrompt.includes(secondNote.title));
assert.match(blendPrompt, /不要求照搬任何一篇/);

// 3d. 在现有行程对话中附带小红书参考（只读对比 + 保留真实原帖链接 + 返回可执行方案）
const plan = aiPlanFixture();
const chatRes = await service.chat(
  {
    plan,
    baseVersion: plan.version,
    mode: 'auto',
    message: '对比这篇小红书给我排雷和建议，不要直接修改',
    xhsReferences: [linkParsed.reference],
  },
  signal,
  () => {},
);
assert.equal(chatRes.action, 'answer');
assert.ok(chatRes.answer.includes(note.url), 'real user XHS reference URL preserved in answer links');
assert.equal(chatRes.suggestions.length, 1);

// 4. HTTP 路由 /api/planner/xhs-parse 端到端 NDJSON 验证
const server = await createPlannerServer({ apiKey: 'test', service, xhsBridge: bridge });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const resp = await fetch(`${origin}/api/planner/xhs-parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: tianjinShareCopy }),
  });
  assert.equal(resp.status, 200);
  const lines = (await resp.text()).trim().split('\n').map((l) => JSON.parse(l));
  const resultEvent = lines.find((e) => e.type === 'result');
  assert.equal(resultEvent?.result?.reference?.sourceType, 'xhs_link');
  assert.equal(resultEvent?.result?.reference?.url, note.url);
  assert.ok(resultEvent?.result?.reference?.places?.length === 2);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

process.stdout.write('Xiaohongshu import, wishlist, prompt fusion and /api/planner/xhs-parse: OK\n');
