import {
  addPlannerDays,
  calculatePlannerBudget,
  plannerConflicts,
  plannerDayCount,
  plannerPartyText,
  validatePlannerContent,
} from './planner-domain';
import { extractJsonObject, handleMobilePlannerApi } from './mobile-ai-runtime';
import type { AiTravelPlan, PlannerActivity, PlannerBudget, PlannerContent, PlannerCost, PlannerDay, PlannerRequest } from './planner-types';
import { createLocalId } from './utils';

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
            { "category": "tickets", "label": "成人门票", "unitAmountYuan": 55, "unit": "ticket", "basis": "官方公开票价" }
          ]
        },
        {
          "kind": "food",
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
  const travelers = request.travelersText?.trim() || plannerPartyText(request);
  const budgetYuan = typeof request.budgetCents === 'number' && request.budgetCents > 0
    ? Math.round(request.budgetCents / 100)
    : null;
  const budget = budgetYuan ? `总预算约 ¥${budgetYuan}` : '中等舒适预算';
  const notes = request.notes?.trim() || '无特殊限制，路线顺路不折返、节奏舒适即可';
  const luggage = request.luggageMode === 'backpack' ? '轻装背包出行' : '携带行李箱（尽量减少换酒店与寄存折腾）';
  const pace = request.pace?.trim() || '舒适';
  const transport = request.transport?.trim() || '公共交通为主';
  const lodging = request.lodgingLevel?.trim() || '舒适型';
  const roomsText = request.rooms ? `${request.rooms} 间房` : `按人数合理安排（约 ${Math.ceil(Math.max(1, request.people) / 2)} 间）`;
  const diningPrefs = [
    request.skipBreakfast ? '不安排早餐活动' : '',
    request.foodMode ? '美食导向（重点推荐地道小吃与特色正餐）' : '',
    request.dietary?.trim() ? `饮食忌口/过敏：${request.dietary.trim()}` : '',
  ].filter(Boolean).join('；');

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
    `- 同行人员：${travelers}`,
    `- 节奏与交通：节奏 ${pace}；市内交通偏好 ${transport}`,
    `- 住宿偏好：${lodging}，房间数 ${roomsText}`,
    `- 预算参考：${budget}`,
    `- 行李方式：${luggage}`,
    ...(diningPrefs ? [`- 餐饮要求：${diningPrefs}`] : []),
    `- 补充要求：${notes}`,
    ...(xhsRefLines ? ['', `【小红书参考攻略${request.referenceMode === 'follow' ? '（请优先按参考路线安排）' : ''}】`, xhsRefLines] : []),
    '',
    '【严格输出要求（非常重要）】',
    '1. 请只输出一个 ```json ... ``` 代码块，不要在 JSON 里面写注释，确保是合法 JSON。',
    `2. days 数组必须包含全部 ${days} 天（日期从 ${startDate} 连续排到 ${endDate}），最后一天 lodging 填 null。`,
    '3. 每天安排 4~6 个活动（kind 只能是 "sight" | "food" | "transport" | "rest"，兼容 "meal"/"transfer"），时间按先后顺序排列且不重叠。',
    '4. 每个 sight 景点的 description 控制在 25~55 字内，若是国家 4A/5A 景区请注明（如“国家5A级景区 · ...”）。',
    '5. costs 里的 category 只能是 "tickets" | "food" | "transport" | "lodging" | "other"，unit 只能是 "ticket" | "person" | "room" | "vehicle" | "group"（景区门票务必用 "ticket"，未知价格填 null，0 仅代表免费）。',
    '6. 请在 unvisitedHighlights 中列出 4~6 个目的地非常热门、但本次行程尚未去到的景点（字段：title、city、grade 如 5A/4A 或空串、feature 15字内一句话特色、location 所在区或具体地址）。',
    '',
    '【JSON 格式示例（请严格按此字段结构输出）】',
    '```json',
    EXTERNAL_JSON_TEMPLATE,
    '```',
  ].join('\n');
}

/** 从任意外部 AI 回复中提取最像行程对象的 JSON 结构（兼容数组、嵌套 data/plan、itinerary/schedule 别名等）。 */
function unwrapExternalPlanObject(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
    return { days: raw };
  }
  if (!raw || typeof raw !== 'object') return null;
  let obj = raw as Record<string, unknown>;
  // 兼容 { data: { days: [...] } } / { plan: { ... } } / { itinerary: { days: [...] } }
  for (const wrapperKey of ['data', 'plan', 'result', 'trip', 'itinerary']) {
    const nested = obj[wrapperKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nObj = nested as Record<string, unknown>;
      if (Array.isArray(nObj.days) || Array.isArray(nObj.itinerary) || Array.isArray(nObj.schedule) || Array.isArray(nObj.dailyPlans)) {
        obj = nObj;
        break;
      }
    }
  }
  const daysAlias = obj.days ?? obj.itinerary ?? obj.schedule ?? obj.dailyPlans ?? obj.daily_plans ?? obj.daily;
  if (Array.isArray(daysAlias) && daysAlias.length > 0) {
    return { ...obj, days: daysAlias };
  }
  return obj;
}

/** 将用户从豆包 / DeepSeek / Kimi / 腾讯元宝 / ChatGPT / Claude 等复制回来的回复一键解析并标准化为周游行程。 */
export async function parseExternalAiResponse(
  rawText: string,
  request: PlannerRequest,
): Promise<{ content: PlannerContent; budget: PlannerBudget; warnings: string[] }> {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('请先粘贴外部 AI（豆包 / DeepSeek / Kimi / 元宝 / ChatGPT 等）生成的完整回复内容');
  }
  if (!trimmed.includes('{') && !trimmed.includes('[')) {
    throw new Error('未检测到 JSON 行程结构。请确认已把「第 1 步」的完整提示词发给外部 AI，并将它回复的 JSON 内容粘贴到这里');
  }

  let parsedRaw: unknown;
  try {
    // 优先尝试所有 ```json ... ``` 代码块，防止 AI 输出多个代码块时取错
    const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    let best: Record<string, unknown> | null = null;
    for (const m of fenceMatches) {
      try {
        const candidate = unwrapExternalPlanObject(extractJsonObject<unknown>(m[1]));
        if (candidate && Array.isArray(candidate.days) && candidate.days.length > 0) {
          best = candidate;
          break;
        }
      } catch {
        // 尝试下一个代码块
      }
    }
    parsedRaw = best ?? extractJsonObject<unknown>(trimmed);
  } catch {
    throw new Error('粘贴的内容无法解析为有效 JSON，请检查是否复制完整（从 { 到 } 的全部内容）后重试');
  }

  const parsed = unwrapExternalPlanObject(parsedRaw);
  if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
    throw new Error('JSON 中缺少有效的每日行程数组（days / itinerary），请让外部 AI 按示例 JSON 格式重新输出');
  }

  const firstDay = (parsed.days[0] && typeof parsed.days[0] === 'object' ? parsed.days[0] : {}) as Record<string, unknown>;
  const rawFirstDate = typeof firstDay.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(firstDay.date.trim()) ? firstDay.date.trim() : '';
  const startDate = request.startDate || rawFirstDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const requestedDays = request.endDate
    ? plannerDayCount(startDate, request.endDate)
    : (typeof request.days === 'number' && request.days >= 1 ? request.days : null);
  const inferredDays = parsed.days.length;
  const inferredDest =
    request.destination?.trim()
    || String((Array.isArray(parsed.cities) && (parsed.cities[0] as Record<string, unknown>)?.name) || '')
    || String(firstDay.city || '')
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
  const importWarnings: string[] = [];
  if (requestedDays !== null && requestedDays !== inferredDays) {
    importWarnings.push(`你原设定为 ${requestedDays} 天，外部 AI 实际返回 ${inferredDays} 天，已按返回天数导入，请核对是否被截断。`);
  }
  content.warnings = [
    ...new Set([
      ...importWarnings,
      ...content.warnings,
      '本行程通过外部免费 AI 导入生成，票价、开放时间与交通细节请出行前核对，可在群内自由手动编辑、投票与记 AA 账。',
    ]),
  ];
  validatePlannerContent(content);
  const budget = calculatePlannerBudget(content);
  return { content, budget, warnings: content.warnings };
}

export interface ExternalAiEditDayDiff {
  dayNumber: number;
  date: string;
  title: string;
  added: string[];
  removed: string[];
  updated?: string[];
  kept: number;
}

export interface ExternalAiEditPreview {
  mode: 'patch_days' | 'full';
  summary: string;
  content: PlannerContent;
  budget: PlannerBudget;
  budgetDeltaCents: number;
  changedDays: ExternalAiEditDayDiff[];
  lockedWarnings: string[];
  conflicts?: string[];
}

function normalizePlaceKey(city = '', title = ''): string {
  return `${city.replace(/市$/, '')}${title}`
    .replace(/[\s·•・（）()《》「」【】\-—–_]+/g, '')
    .toLowerCase();
}

function normalizeCityKey(city = ''): string {
  return city.replace(/市$/, '').replace(/\s+/g, '').toLowerCase();
}

function formatCompactYuan(cents: number | null, status?: PlannerCost['status']): number | null {
  if (cents === null || status === 'unknown') return null;
  return Number((cents / 100).toFixed(2));
}

function buildCompactPlanSnapshot(content: PlannerContent): Record<string, unknown> {
  const effectiveRooms = content.request.rooms ?? Math.ceil(Math.max(1, content.request.people) / 2);
  return {
    title: content.title,
    summary: content.summary,
    days: content.days.map((day, idx) => {
      const dayCity = day.lodging?.city || day.activities.find((a) => a.city)?.city || content.request.destination;
      const firstLodgingCost = day.lodging?.costs?.[0];
      return {
        day: idx + 1,
        date: day.date,
        city: dayCity,
        title: day.title,
        ...(day.lodging
          ? {
              lodging: {
                area: day.lodging.area,
                nightlyCostYuan: firstLodgingCost
                  ? formatCompactYuan(firstLodgingCost.unitPriceCents, firstLodgingCost.status)
                  : null,
                roomCount: effectiveRooms,
              },
            }
          : { lodging: null }),
        activities: day.activities.map((act) => ({
          id: act.id,
          kind: act.kind,
          startTime: act.startTime,
          endTime: act.endTime,
          title: act.title,
          city: act.city,
          location: act.location,
          description: act.description,
          ...(act.meal ? { meal: act.meal } : {}),
          ...(act.transportMode ? { transportMode: act.transportMode } : {}),
          ...(act.distanceKm !== undefined ? { distanceKm: act.distanceKm } : {}),
          ...(act.locked ? { locked: true } : {}),
          costs: act.costs.map((c) => ({
            category: c.category,
            label: c.label,
            unitAmountYuan: formatCompactYuan(c.unitPriceCents, c.status),
            unit: c.unit,
            ...(c.studentPriceCents != null ? { studentYuan: Number((c.studentPriceCents / 100).toFixed(2)) } : {}),
            ...(c.seniorPriceCents != null ? { seniorYuan: Number((c.seniorPriceCents / 100).toFixed(2)) } : {}),
            ...(c.childPriceCents != null ? { childYuan: Number((c.childPriceCents / 100).toFixed(2)) } : {}),
            ...(c.quantity !== 1 ? { quantity: c.quantity } : {}),
            ...(c.occurrences !== 1 ? { occurrences: c.occurrences } : {}),
            ...(c.includedIn ? { includedIn: c.includedIn } : {}),
            ...(c.qualification ? { qualification: c.qualification } : {}),
          })),
        })),
      };
    }),
  };
}

/** 导出当前行程的精简 JSON + 修改提示词，供用户发给豆包 / DeepSeek / Kimi / ChatGPT 讨论并按固定格式导回。 */
export function buildExternalAiEditPrompt(plan: AiTravelPlan, userHint = ''): string {
  const snapshot = buildCompactPlanSnapshot(plan.content);
  const req = plan.content.request;
  const constraintLines = [
    `同行人员：${req.travelersText?.trim() || plannerPartyText(req)}`,
    req.skipBreakfast ? '不安排早餐活动' : '',
    req.dietary?.trim() ? `饮食忌口：${req.dietary.trim()}` : '',
    req.pace ? `节奏：${req.pace}` : '',
    req.rooms ? `房间数：${req.rooms} 间` : '',
  ].filter(Boolean);
  const lockedTitles = plan.content.days
    .flatMap((d, idx) => d.activities.filter((a) => a.locked).map((a) => `第${idx + 1}天「${a.title}」(${a.startTime}-${a.endTime})`));
  const hint = userHint.trim();

  return [
    '你是一位资深中国旅行路线规划师。下面是我当前在「周游地图」App 里的精简行程 JSON，请帮我一起讨论并修改这份行程：',
    '',
    '【我的修改想法】',
    hint || '（请先听我接下来告诉你的具体修改需求，我们可以多轮讨论；等我确认方案后，你再按下方固定 JSON 格式输出最终结果）',
    ...(constraintLines.length ? ['', '【行程约束】', constraintLines.join('；')] : []),
    ...(lockedTitles.length ? ['', '【已锁定条目（除非我明确要求，请勿删除或改动时间/地点/费用）】', lockedTitles.join('、')] : []),
    '',
    '【当前行程精简 JSON】',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
    '',
    '【最终输出格式要求（聊定后请严格按此格式输出，方便我一键导回 App）】',
    '1. 只输出一个 ```json ... ``` 代码块，不要在 JSON 中写注释，确保是合法 JSON。',
    '2. 如果只修改了其中某几天，推荐使用局部模式（省字数、不易截断）：',
    '   - 顶层写 `"mode": "patch_days"`、`"summary": "一句话概括改动"`，`"days"` 数组里只需包含**被修改的那几天**（每项必须带正确的 `"day"` 序号或 `"date"` 日期）。',
    '3. 如果增减了总天数或整体重排，顶层写 `"mode": "full"`，`"days"` 包含全部天数。',
    '4. 活动字段保持与上方一致：kind 只能是 "sight" | "food" | "transport" | "rest"（兼容 "meal"/"transfer"）；costs 的 category 只能是 "tickets" | "food" | "transport" | "lodging" | "other"，unit 只能是 "ticket" | "person" | "room" | "vehicle" | "group"（未知价格填 null，0 仅代表免费）。',
    '5. 原来未改动的活动请尽量保留原 id 与名称，这样 App 导入时能自动保留我已保存的景点实景图、优惠票价与预订关联。',
  ].join('\n');
}

function mergePreservedCosts(nextCosts: PlannerCost[], prevCosts: PlannerCost[]): PlannerCost[] {
  if (!prevCosts.length) return nextCosts;
  const prevByLabel = new Map<string, PlannerCost[]>();
  for (const c of prevCosts) {
    const key = normalizePlaceKey('', c.label);
    const bucket = prevByLabel.get(key) ?? [];
    bucket.push(c);
    prevByLabel.set(key, bucket);
  }
  const consumed = new Set<PlannerCost>();
  return nextCosts.map((c) => {
    const key = normalizePlaceKey('', c.label);
    const bucket = prevByLabel.get(key) ?? [];
    const matched = bucket.find((old) => !consumed.has(old) && old.category === c.category)
      ?? bucket.find((old) => !consumed.has(old));
    if (!matched) return c;
    consumed.add(matched);
    const samePrice = matched.unitPriceCents === c.unitPriceCents;
    return {
      ...c,
      studentPriceCents: c.studentPriceCents ?? matched.studentPriceCents,
      seniorPriceCents: c.seniorPriceCents ?? matched.seniorPriceCents,
      childPriceCents: c.childPriceCents ?? matched.childPriceCents,
      status: samePrice ? matched.status : c.status,
      qualification: c.qualification || matched.qualification,
      sourceIds: samePrice ? matched.sourceIds : c.sourceIds,
      includedIn: c.includedIn ?? matched.includedIn,
    };
  });
}

function preserveExistingActivityMeta(
  nextDays: PlannerDay[],
  prevDays: PlannerDay[],
  touchedIndices?: Set<number>,
): PlannerDay[] {
  const byId = new Map<string, PlannerActivity>();
  const byCityTitle = new Map<string, PlannerActivity[]>();
  const byTitle = new Map<string, PlannerActivity[]>();
  for (const day of prevDays) {
    for (const act of day.activities) {
      if (act.id) byId.set(act.id, act);
      const k1 = normalizePlaceKey(act.city, act.title);
      const k2 = normalizePlaceKey('', act.title);
      if (k1) {
        const list = byCityTitle.get(k1) ?? [];
        list.push(act);
        byCityTitle.set(k1, list);
      }
      if (k2) {
        const list = byTitle.get(k2) ?? [];
        list.push(act);
        byTitle.set(k2, list);
      }
    }
  }

  // 预占位未修改天的活动 ID 与费用 ID，确保局部修改后跨天 ID 全局唯一
  const usedActIds = new Set<string>();
  const usedCostIds = new Set<string>();
  const consumedPrev = new Set<PlannerActivity>();
  nextDays.forEach((day, idx) => {
    if (touchedIndices && !touchedIndices.has(idx)) {
      for (const act of day.activities) {
        usedActIds.add(act.id);
        const orig = byId.get(act.id);
        if (orig) consumedPrev.add(orig);
        for (const cost of act.costs) usedCostIds.add(cost.id);
      }
      for (const cost of day.lodging?.costs ?? []) usedCostIds.add(cost.id);
    }
  });

  const allocActId = (preferred: string): string => {
    let candidate = preferred && preferred.trim() ? preferred.trim() : createLocalId();
    if (usedActIds.has(candidate)) {
      candidate = createLocalId();
    }
    usedActIds.add(candidate);
    return candidate;
  };
  const allocCostId = (preferred: string): string => {
    let candidate = preferred && preferred.trim() ? preferred.trim() : createLocalId();
    if (usedCostIds.has(candidate)) {
      candidate = createLocalId();
    }
    usedCostIds.add(candidate);
    return candidate;
  };

  return nextDays.map((day, idx) => {
    if (touchedIndices && !touchedIndices.has(idx)) return day;
    const prevDay = prevDays[idx];
    const nextActivities = day.activities.map((act) => {
      const actCityKey = normalizeCityKey(act.city);
      let prev: PlannerActivity | undefined;
      const directById = act.id ? byId.get(act.id) : undefined;
      if (directById && !consumedPrev.has(directById)) {
        const prevCityKey = normalizeCityKey(directById.city);
        if (!actCityKey || !prevCityKey || actCityKey === prevCityKey) {
          prev = directById;
        }
      }
      if (!prev) {
        const cityList = byCityTitle.get(normalizePlaceKey(act.city, act.title)) ?? [];
        prev = cityList.find((candidate) => !consumedPrev.has(candidate));
      }
      if (!prev) {
        // 严禁跨城市按标题回退继承（避免成都人民公园串用另一城市人民公园的照片或 bookingId）
        const titleList = byTitle.get(normalizePlaceKey('', act.title)) ?? [];
        prev = titleList.find((candidate) => {
          if (consumedPrev.has(candidate)) return false;
          const prevCityKey = normalizeCityKey(candidate.city);
          return !actCityKey || !prevCityKey || actCityKey === prevCityKey;
        });
      }
      if (prev) consumedPrev.add(prev);

      const finalId = allocActId(prev ? prev.id : act.id);
      const mergedCosts = (prev ? mergePreservedCosts(act.costs, prev.costs) : act.costs)
        .map((c) => ({ ...c, id: allocCostId(c.id) }));
      if (!prev) {
        return { ...act, id: finalId, costs: mergedCosts };
      }
      const sameCityAndKind = (!actCityKey || !normalizeCityKey(prev.city) || actCityKey === normalizeCityKey(prev.city))
        && act.kind === prev.kind;
      return {
        ...act,
        id: finalId,
        locked: act.locked || prev.locked,
        photo: act.photo ?? prev.photo,
        photoQuery: act.photoQuery || prev.photoQuery,
        bookingId: act.bookingId ?? (sameCityAndKind ? prev.bookingId : undefined),
        transferOptions: act.transferOptions ?? prev.transferOptions,
        luggageNote: act.luggageNote ?? prev.luggageNote,
        costs: mergedCosts,
      };
    });

    let nextLodging = day.lodging;
    if (nextLodging) {
      const prevLodging = prevDay?.lodging;
      const sameArea = prevLodging
        && normalizePlaceKey(prevLodging.city, prevLodging.area) === normalizePlaceKey(nextLodging.city, nextLodging.area);
      const mergedLodgingCosts = (sameArea && prevLodging ? mergePreservedCosts(nextLodging.costs, prevLodging.costs) : nextLodging.costs)
        .map((c) => ({ ...c, id: allocCostId(c.id) }));
      nextLodging = {
        ...nextLodging,
        reason: nextLodging.reason || prevLodging?.reason || '',
        searchKeyword: nextLodging.searchKeyword || prevLodging?.searchKeyword || '',
        ...(sameArea && prevLodging?.bookingOriginalCosts ? { bookingOriginalCosts: prevLodging.bookingOriginalCosts } : {}),
        costs: mergedLodgingCosts,
      };
    }

    return {
      ...day,
      activities: nextActivities,
      lodging: nextLodging,
    };
  });
}

/** 解析外部 AI 返回的修改 JSON，支持按天局部补丁（patch_days）与整份替换（full），生成差异预览而不直接修改原行程。 */
export async function previewExternalAiEdit(
  rawText: string,
  currentPlan: AiTravelPlan,
): Promise<ExternalAiEditPreview> {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('请先粘贴外部 AI 回复的修改 JSON 内容');
  }
  if (!trimmed.includes('{') && !trimmed.includes('[')) {
    throw new Error('未检测到 JSON 内容。请让外部 AI 按提示词中的 ```json ... ``` 格式输出最终修改结果后再粘贴');
  }

  let parsedRaw: unknown;
  try {
    const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    let best: Record<string, unknown> | null = null;
    for (const m of fenceMatches) {
      try {
        const candidate = unwrapExternalPlanObject(extractJsonObject<unknown>(m[1]));
        if (candidate && Array.isArray(candidate.days) && candidate.days.length > 0) {
          best = candidate;
          break;
        }
      } catch {
        // 尝试下一个代码块
      }
    }
    parsedRaw = best ?? extractJsonObject<unknown>(trimmed);
  } catch {
    throw new Error('粘贴的内容无法解析为有效 JSON，请确认已复制完整代码块（从 { 到 }）');
  }

  const parsed = unwrapExternalPlanObject(parsedRaw);
  if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
    throw new Error('JSON 中缺少有效的 days 数组，请让外部 AI 按格式重新输出');
  }

  const prevContent = currentPlan.content;
  const prevDays = prevContent.days;
  const rawMode = String(parsed.mode || '').toLowerCase();
  const prevDateToDayNum = new Map(prevDays.map((d, idx) => [d.date, idx + 1]));
  const explicitDayNums = parsed.days.map((d) => {
    const rec = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const n = Number(rec.day ?? rec.dayNumber ?? rec.dayIndex ?? 0);
    if (Number.isInteger(n) && n >= 1) return n;
    const rawDate = typeof rec.date === 'string' ? rec.date.trim() : '';
    if (rawDate && prevDateToDayNum.has(rawDate)) return prevDateToDayNum.get(rawDate)!;
    return 0;
  });
  const looksLikePatch =
    rawMode === 'patch_days'
    || rawMode === 'patch'
    || (
      rawMode !== 'full'
      && parsed.days.length < prevDays.length
      && explicitDayNums.every((n) => n >= 1 && n <= prevDays.length)
    );

  if (looksLikePatch) {
    const invalidIdx = explicitDayNums.findIndex((n) => n < 1 || n > prevDays.length);
    if (invalidIdx >= 0) {
      throw new Error(`局部修改 JSON 的第 ${invalidIdx + 1} 项缺少有效的 day 序号或 date（需在 1~${prevDays.length} 天范围内），请让外部 AI 补充后重试`);
    }
  }

  const normalizedIncoming = await handleMobilePlannerApi<PlannerContent>(
    'normalize-external',
    {
      raw: parsed,
      patchMode: looksLikePatch,
      request: {
        ...prevContent.request,
        days: parsed.days.length,
        endDate: addPlannerDays(prevContent.request.startDate, Math.max(1, parsed.days.length) - 1),
      },
    },
    new AbortController().signal,
    () => {},
  );

  let mergedDays: PlannerDay[];
  const touchedDayIndices = new Set<number>();

  if (looksLikePatch) {
    mergedDays = prevDays.map((d) => ({ ...d, activities: [...d.activities] }));
    const rawPatchDays = parsed.days as Array<Record<string, unknown> | undefined>;
    // 严格只遍历真实补丁条目，禁止扩展成全程或按 i+1 覆写其他天
    for (let i = 0; i < rawPatchDays.length && i < normalizedIncoming.days.length; i += 1) {
      const incomingDay = normalizedIncoming.days[i];
      const rawDay = rawPatchDays[i] && typeof rawPatchDays[i] === 'object' ? rawPatchDays[i]! : {};
      const hasExplicitLodging = Object.prototype.hasOwnProperty.call(rawDay, 'lodging')
        || Object.prototype.hasOwnProperty.call(rawDay, 'stayArea');
      const targetIdx = explicitDayNums[i] - 1;
      if (targetIdx < 0 || targetIdx >= mergedDays.length) continue;
      const prevDay = mergedDays[targetIdx];
      mergedDays[targetIdx] = {
        ...incomingDay,
        date: prevDay.date,
        lodging: targetIdx === mergedDays.length - 1
          ? null
          : (hasExplicitLodging ? (rawDay.lodging === null ? null : (incomingDay.lodging ?? prevDay.lodging)) : prevDay.lodging),
      };
      touchedDayIndices.add(targetIdx);
    }
  } else {
    mergedDays = normalizedIncoming.days.map((d, idx) => ({
      ...d,
      date: prevDays[idx]?.date || addPlannerDays(prevContent.request.startDate, idx),
      lodging: idx === normalizedIncoming.days.length - 1 ? null : d.lodging,
    }));
    mergedDays.forEach((_, idx) => touchedDayIndices.add(idx));
  }

  mergedDays = preserveExistingActivityMeta(mergedDays, prevDays, looksLikePatch ? touchedDayIndices : undefined);

  // 同步全局 cities（优先保留原有 6 位行政区划码，不冲掉小城 adcode）与未去热门景点
  const prevCityByName = new Map(prevContent.cities.map((c) => [normalizeCityKey(c.name), c]));
  const incomingCityByName = new Map(normalizedIncoming.cities.map((c) => [normalizeCityKey(c.name), c]));
  const mergedCityList: PlannerContent['cities'] = [];
  const seenCityCodes = new Set<string>();
  const addCityIfPresent = (cityName: string) => {
    const key = normalizeCityKey(cityName);
    if (!key) return;
    const found = prevCityByName.get(key) ?? incomingCityByName.get(key);
    if (found && !seenCityCodes.has(found.code)) {
      seenCityCodes.add(found.code);
      mergedCityList.push(found);
    }
  };
  for (const day of mergedDays) {
    for (const act of day.activities) addCityIfPresent(act.city);
    if (day.lodging?.city) addCityIfPresent(day.lodging.city);
  }
  const nextCities = mergedCityList.length ? mergedCityList : prevContent.cities;
  const scheduledTitleKeys = new Set(
    mergedDays.flatMap((d) => d.activities.map((a) => normalizePlaceKey('', a.title))),
  );
  const baseHighlights = !looksLikePatch && normalizedIncoming.unvisitedHighlights?.length
    ? normalizedIncoming.unvisitedHighlights
    : (prevContent.unvisitedHighlights ?? []);
  const nextHighlights = baseHighlights.filter((h) => !scheduledTitleKeys.has(normalizePlaceKey('', h.title)));

  const nextContent: PlannerContent = {
    ...prevContent,
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : prevContent.title,
    summary: typeof parsed.summary === 'string' && parsed.summary.trim() && !looksLikePatch
      ? parsed.summary.trim()
      : prevContent.summary,
    cities: nextCities,
    ...(nextHighlights.length ? { unvisitedHighlights: nextHighlights } : { unvisitedHighlights: undefined }),
    ...(!looksLikePatch && normalizedIncoming.alternatives.length ? { alternatives: normalizedIncoming.alternatives } : {}),
    warnings: looksLikePatch
      ? [...new Set([...prevContent.warnings, ...normalizedIncoming.warnings])]
      : (normalizedIncoming.warnings.length ? normalizedIncoming.warnings : prevContent.warnings),
    request: {
      ...prevContent.request,
      days: mergedDays.length,
      endDate: addPlannerDays(prevContent.request.startDate, Math.max(1, mergedDays.length) - 1),
    },
    days: mergedDays,
  };

  validatePlannerContent(nextContent);
  const nextBudget = calculatePlannerBudget(nextContent);
  const prevBudget = calculatePlannerBudget(prevContent);
  const conflicts = plannerConflicts(nextContent);

  // 计算每天的增删与字段级差异，以及锁定项变更提醒
  const changedDays: ExternalAiEditDayDiff[] = [];
  const lockedWarnings: string[] = [];
  const maxLen = Math.max(prevDays.length, mergedDays.length);
  const newActDayById = new Map<string, { dayNumber: number; act: PlannerActivity }>();
  mergedDays.forEach((day, idx) => {
    for (const act of day.activities) newActDayById.set(act.id, { dayNumber: idx + 1, act });
  });
  const costSignature = (costs: PlannerCost[]) =>
    costs.map((c) => `${c.label}:${c.unitPriceCents ?? 'null'}:${c.unit}`).join('|');

  for (let i = 0; i < maxLen; i += 1) {
    if (!touchedDayIndices.has(i) && i < prevDays.length && i < mergedDays.length) continue;
    const oldActs = prevDays[i]?.activities ?? [];
    const newActs = mergedDays[i]?.activities ?? [];
    const oldById = new Map(oldActs.map((a) => [a.id, a]));
    const oldKeys = new Set(oldActs.map((a) => normalizePlaceKey('', a.title)));
    const newKeys = new Set(newActs.map((a) => normalizePlaceKey('', a.title)));
    const added = newActs.filter((a) => !oldKeys.has(normalizePlaceKey('', a.title))).map((a) => a.title);
    const removed = oldActs.filter((a) => !newKeys.has(normalizePlaceKey('', a.title))).map((a) => a.title);
    const updated: string[] = [];
    for (const act of newActs) {
      const old = oldById.get(act.id) ?? oldActs.find((o) => normalizePlaceKey('', o.title) === normalizePlaceKey('', act.title));
      if (!old) continue;
      const fields: string[] = [];
      if (old.startTime !== act.startTime || old.endTime !== act.endTime) fields.push('时间');
      if (old.location !== act.location || old.city !== act.city) fields.push('地点');
      if (costSignature(old.costs) !== costSignature(act.costs)) fields.push('费用');
      if (fields.length) updated.push(`${act.title}（${fields.join('/')}）`);
    }
    const oldLodgingArea = prevDays[i]?.lodging?.area || '';
    const newLodgingArea = mergedDays[i]?.lodging?.area || '';
    if (oldLodgingArea !== newLodgingArea && (oldLodgingArea || newLodgingArea)) {
      updated.push(`住宿：${newLodgingArea || '已取消'}`);
    }
    const kept = newActs.length - added.length;

    for (const act of oldActs) {
      if (!act.locked) continue;
      const located = newActDayById.get(act.id);
      if (!located) {
        if (!newKeys.has(normalizePlaceKey('', act.title))) {
          lockedWarnings.push(`第 ${i + 1} 天已锁定活动「${act.title}」在新方案中被移除`);
        }
      } else {
        const diffs: string[] = [];
        if (located.dayNumber !== i + 1) diffs.push(`移至第 ${located.dayNumber} 天`);
        if (located.act.startTime !== act.startTime || located.act.endTime !== act.endTime) diffs.push('时间变动');
        if (located.act.location !== act.location || located.act.city !== act.city) diffs.push('地点变动');
        if (costSignature(located.act.costs) !== costSignature(act.costs)) diffs.push('费用变动');
        if (diffs.length) {
          lockedWarnings.push(`第 ${i + 1} 天已锁定活动「${act.title}」发生变更（${diffs.join('、')}）`);
        }
      }
    }
    if (added.length || removed.length || updated.length || !prevDays[i] || !mergedDays[i]) {
      changedDays.push({
        dayNumber: i + 1,
        date: mergedDays[i]?.date || prevDays[i]?.date || '',
        title: mergedDays[i]?.title || prevDays[i]?.title || `第 ${i + 1} 天`,
        added,
        removed,
        ...(updated.length ? { updated } : {}),
        kept: Math.max(0, kept),
      });
    }
  }

  const aiSummary = typeof parsed.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : (looksLikePatch
      ? `外部 AI 局部调整了 ${changedDays.length || touchedDayIndices.size} 天行程`
      : '外部 AI 更新了完整行程');

  return {
    mode: looksLikePatch ? 'patch_days' : 'full',
    summary: aiSummary,
    content: nextContent,
    budget: nextBudget,
    budgetDeltaCents: nextBudget.totalCents - prevBudget.totalCents,
    changedDays,
    lockedWarnings,
    conflicts,
  };
}
