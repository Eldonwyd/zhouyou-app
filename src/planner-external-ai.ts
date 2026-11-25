import {
  addPlannerDays,
  calculatePlannerBudget,
  plannerDayCount,
  validatePlannerContent,
} from './planner-domain';
import { extractJsonObject, handleMobilePlannerApi } from './mobile-ai-runtime';
import type { PlannerBudget, PlannerContent, PlannerRequest } from './planner-types';

const EXTERNAL_JSON_TEMPLATE = `{
  "title": "成都 4 日悠闲漫游",
  "summary": "2 句话概括行程节奏、核心亮点与适合人群",
  "cities": [
    { "name": "成都", "province": "四川省", "days": 4, "reason": "美食与慢生活核心城市" }
  ],
  "days": [
    {
      "day": 1,
      "date": "2026-05-01",
      "city": "成都",
      "title": "老城烟火与茶馆初体验",
      "summary": "轻松适应节奏，逛宽窄巷子与人民公园",
      "lodging": {
        "area": "春熙路 / 太古里片区",
        "reason": "地铁 2/3 号线换乘方便，夜宵多",
        "nightlyCostYuan": 380,
        "roomCount": 1
      },
      "activities": [
        {
          "kind": "sight",
          "startTime": "09:30",
          "endTime": "11:30",
          "title": "成都大熊猫繁育研究基地",
          "city": "成都",
          "location": "成华区熊猫大道1375号",
          "description": "国家4A级景区 · 上午看大熊猫最活跃，建议从南门进西门出",
          "tips": "提前在公众号预约早场票",
          "reservation": "建议提前 1-3 天预约",
          "costs": [
            { "category": "tickets", "label": "成人门票", "unitAmountYuan": 55, "unit": "person", "basis": "官方公开票价" }
          ]
        },
        {
          "kind": "meal",
          "startTime": "12:00",
          "endTime": "13:15",
          "title": "建设路地道川菜午餐",
          "city": "成都",
          "location": "成华区建设路商圈",
          "description": "品尝麻婆豆腐、回锅肉与冰粉，性价比高",
          "costs": [
            { "category": "food", "label": "午餐餐饮", "unitAmountYuan": 65, "unit": "person", "basis": "人均估算" }
          ]
        }
      ]
    }
  ],
  "unvisitedHighlights": [
    { "title": "青城山", "city": "成都", "grade": "5A", "feature": "道教名山清幽避暑", "location": "都江堰市青城山镇" }
  ],
  "warnings": [
    "热门博物馆与景区请提前预约，出行前以官方开放时间为准"
  ]
}`;

export interface ExternalAiAppLink {
  id: string;
  name: string;
  url: string;
  hint: string;
}

export const EXTERNAL_FREE_AI_APPS: ExternalAiAppLink[] = [
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/', hint: '免费、速度快' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', hint: '免费、路线细腻' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', hint: '免费、长文稳' },
  { id: 'yuanbao', name: '腾讯元宝', url: 'https://yuanbao.tencent.com/', hint: '免费、可联网' },
];

/** 根据用户当前填写的出行条件，生成可直接粘贴给豆包 / DeepSeek / Kimi / 腾讯元宝的专属提示词。 */
export function buildExternalAiPrompt(request: PlannerRequest): string {
  const dest = request.destination?.trim() || '请结合季节帮我推荐一个热门中国旅行目的地';
  const startDate = request.startDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const days = request.endDate
    ? Math.max(1, plannerDayCount(startDate, request.endDate))
    : Math.max(1, Number(request.days) || 3);
  const endDate = request.endDate || addPlannerDays(startDate, days - 1);
  const base = request.base?.trim() || '未指定';
  const travelers = request.travelersText?.trim()
    || (request.people ? `${request.people} 人` : '未指定（默认按 2 人估算）');
  const students = request.students ? `含学生 ${request.students} 人` : '';
  const budgetYuan = typeof request.budgetCents === 'number' && request.budgetCents > 0
    ? Math.round(request.budgetCents / 100)
    : null;
  const budget = budgetYuan ? `总预算约 ¥${budgetYuan}` : '中等舒适预算';
  const notes = request.notes?.trim() || '无特殊限制，路线顺路不折返、节奏舒适即可';
  const luggage = request.luggageMode === 'backpack' ? '轻装背包出行' : '携带行李箱（尽量减少换酒店与寄存折腾）';

  const xhsRefLines = (request.references || [])
    .slice(0, 4)
    .map((ref, idx) => {
      const placeList = (ref.places || []).map((p) => p.name).filter(Boolean).slice(0, 8).join('、');
      const outline = (ref.routeOutline || []).join('；').slice(0, 120);
      return `${idx + 1}. 《${ref.title}》：${outline || placeList || (ref.tips || []).join('；').slice(0, 120)}`;
    })
    .join('\n');

  return [
    '你是一位资深中国旅行路线规划师。请根据以下出行需求，为「周游地图」App 生成一份完整、顺路、可直接导入的 JSON 旅行攻略：',
    '',
    '【出行需求】',
    `- 目的地：${dest}`,
    `- 出发地：${base}`,
    `- 出行日期：${startDate} 至 ${endDate}（共 ${days} 天，只安排目的地内部行程，最后一天不住宿）`,
    `- 同行人数：${travelers}${students ? `（${students}）` : ''}`,
    `- 预算参考：${budget}`,
    `- 行李方式：${luggage}`,
    `- 补充要求：${notes}`,
    ...(xhsRefLines ? ['', '【小红书参考攻略】', xhsRefLines] : []),
    '',
    '【严格输出要求（非常重要）】',
    '1. 请只输出一个 ```json ... ``` 代码块，不要在 JSON 里面写注释，确保是合法 JSON。',
    `2. days 数组必须包含全部 ${days} 天（日期从 ${startDate} 连续排到 ${endDate}），最后一天 lodging 填 null。`,
    '3. 每天安排 4~6 个活动（kind 只能是 "sight" | "meal" | "transfer" | "rest" | "shopping" | "lodging"），时间按先后顺序排列且不重叠。',
    '4. 每个 sight 景点的 description 控制在 25~55 字内，若是国家 4A/5A 景区请注明（如“国家5A级景区 · ...”）。',
    '5. costs 里的 category 只能是 "tickets" | "food" | "transport" | "lodging" | "shopping" | "other"，unit 只能是 "person" | "room" | "vehicle" | "group"。',
    '',
    '【JSON 格式示例（请严格按此字段结构输出）】',
    '```json',
    EXTERNAL_JSON_TEMPLATE,
    '```',
  ].join('\n');
}

/** 将用户从豆包 / DeepSeek / Kimi / 腾讯元宝复制回来的回复一键解析并标准化为周游行程。 */
export async function parseExternalAiResponse(
  rawText: string,
  request: PlannerRequest,
): Promise<{ content: PlannerContent; budget: PlannerBudget; warnings: string[] }> {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('请先粘贴外部 AI（豆包 / DeepSeek / Kimi / 元宝）生成的完整回复内容');
  }
  if (!trimmed.includes('{') || !trimmed.includes('}')) {
    throw new Error('未检测到 JSON 行程结构。请确认已把「第 1 步」的完整提示词发给外部 AI，并将它回复的 JSON 内容粘贴到这里');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject<Record<string, unknown>>(trimmed);
  } catch {
    throw new Error('粘贴的内容无法解析为有效 JSON，请检查是否复制完整（从 { 到 } 的全部内容）后重试');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.days) || parsed.days.length === 0) {
    throw new Error('JSON 中缺少有效的 days 每日行程数组，请让外部 AI 严格按示例 JSON 格式重新输出');
  }

  const startDate = request.startDate || String((parsed.days[0] as Record<string, unknown>)?.date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const inferredDays = parsed.days.length;
  const inferredDest =
    request.destination?.trim()
    || String((Array.isArray(parsed.cities) && (parsed.cities[0] as Record<string, unknown>)?.name) || '')
    || String((parsed.days[0] as Record<string, unknown>)?.city || '')
    || String(parsed.title || '旅行计划').replace(/\d+日.*/, '').trim();

  const normalizedRequest: PlannerRequest = {
    ...request,
    destination: inferredDest || '旅行计划',
    startDate,
    days: inferredDays,
    endDate: addPlannerDays(startDate, inferredDays - 1),
  };

  const content = await handleMobilePlannerApi<PlannerContent>(
    'normalize-external',
    { raw: parsed, request: normalizedRequest },
    new AbortController().signal,
    () => {},
  );
  if (Array.isArray(content.days) && content.days.length > 0) {
    content.days[content.days.length - 1].lodging = null;
  }
  content.warnings = [
    ...new Set([
      ...content.warnings,
      '本行程通过外部免费 AI 导入生成，票价、开放时间与交通细节请出行前核对，可在群内自由手动编辑、投票与记 AA 账。',
    ]),
  ];
  validatePlannerContent(content);
  const budget = calculatePlannerBudget(content);
  return { content, budget, warnings: content.warnings };
}
