import { isPublicWebUrl, plannerActivitiesByTime } from '../src/planner-domain.ts';
import { plannerPhotoCityName, plannerPhotoPlaceName } from '../src/planner-photo.ts';
import { plannerPlaceSearchTarget } from '../src/planner-place-name.ts';

/** 让路线在第一次排程时就考虑行李，寄存点和价格由后续定点检索填写。 */
export function luggagePlanningRule(mode) {
  if (mode === 'backpack') return '背包出行：按景点顺路串联，尽量走单向路线；不因寄存或取行李折返酒店、景点或车站。';
  return '行李箱出行：当天游玩后仍需离开时，优先考虑把行李放在原住宿并在离开前顺路取件；若先游玩再去车站且回原酒店会折返，优先考虑景点附近寄存。为顺路取件和赶车保留合理衔接时间。应用稍后联网核对寄存点和价格，并在对应卡片写一行。模型只负责顺路排程和预留时间，不生成寄存模块或寄存文案。';
}

/** 说明由应用根据实查结果生成，模型回填的同名字段不作为来源。 */
export function clearModelLuggageNotes(content, previousActivities = []) {
  const locked = new Map(previousActivities.filter((activity) => activity.locked).map((activity) => [activity.id, activity.luggageNote]));
  for (const day of Array.isArray(content?.days) ? content.days : []) {
    for (const activity of Array.isArray(day?.activities) ? day.activities : []) {
      if (!activity || typeof activity !== 'object') continue;
      const original = locked.get(activity.id);
      if (original) activity.luggageNote = original;
      else delete activity.luggageNote;
    }
  }
}

const STORAGE = /寄存|存包|储物柜|行李柜/;
const OFFERED = /(?:可|能|支持|提供|设有|有|使用|领取).{0,12}(?:寄存|存包|储物柜|行李柜)|(?:寄存|存包|储物柜|行李柜).{0,12}(?:服务|在|位于|收费|免费)|(?:免费|付费|自助)(?:寄存|存包|储物柜)|(?:寄存|存包).{0,12}\d+(?:\.\d+)?\s*[元块]/;
const UNCERTAIN = /(?:不提供|不支持|不可|不能|无法|禁止|停止|暂停|取消|没有|不确定|是否|能否|能不能|不再|暂不|暂未|无).{0,9}(?:寄存|存包|储物柜|行李柜)|(?:寄存|存包|储物柜|行李柜).{0,8}(?:没有|暂停|取消|不确定|待确认|未核实)|[?？]/;
const LOCATION = /(?:(?:东门|南门|西门|北门|正门|入口)(?:旁|处|的)?)?(?:游客服务中心|游客中心|行李寄存处|寄存柜|储物柜|行李柜|咨询服务台|服务台|票务中心|前台)/;
const FEE = /免费|(?:每(?:件|包|柜|小时|天|次))?(?:\d+(?:\.\d+)?\s*[-–—至~～]\s*)?\d+(?:\.\d+)?\s*[元块](?:\s*(?:[/／]|每)\s*(?:件|包|柜|小时|天|次))?/;
const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');

/** 只采用命中同一公开地点且明确提及寄存的原文，不把门票或其他费用当成寄存价。 */
function storageFact(item, stop) {
  if (!isPublicWebUrl(item?.url)) return null;
  const title = String(item.title ?? '');
  const text = String(item.content || item.summary || item.snippet || '').slice(0, 10000);
  const fullText = normalize(`${title} ${text}`);
  const name = normalize(stop.name);
  const city = normalize(stop.city).replace(/市$/, '');
  if (!fullText.includes(name) || (city && !fullText.includes(city))) return null;

  const clauses = (`${title}\n${text}`.match(/[^。！!？?；;\n]+[？?]?/g) ?? []).map(normalize);
  let best = null;
  for (const [indexInSource, clause] of clauses.entries()) {
    if (!STORAGE.test(clause) || !OFFERED.test(clause) || UNCERTAIN.test(clause)) continue;
    if (!normalize(title).includes(name) && !`${clauses[indexInSource - 1] ?? ''}${clause}`.includes(name)) continue;
    const index = clause.search(STORAGE);
    let detail = clause.slice(Math.max(0, index - 26), index + 52);
    // 费用必须和寄存说在一起。逗号隔开的门票、停车费等不参与判断。
    const feeParts = detail.split(/[，,、]/);
    const storagePart = feeParts.findIndex((part) => STORAGE.test(part));
    const priced = feeParts.slice(Math.max(0, storagePart), storagePart + 2)
      .find((part) => !/门票|停车|餐费|餐饮|电瓶车|车票|票价|(?:并非|不是|不再|不一定|不含|非|不)免费/.test(part) && FEE.test(part));
    const fee = priced?.match(FEE)?.[0] ?? '';
    detail = feeParts[storagePart] ?? detail;
    const location = detail.match(LOCATION)?.[0] ?? (priced?.match(LOCATION)?.[0] ?? '');
    const fact = { item, fee, location };
    if (fee && location) return fact;
    if (!best || (fee ? 2 : 0) + Number(Boolean(location)) > (best.fee ? 2 : 0) + Number(Boolean(best.location))) best = fact;
  }
  return best;
}

function storageStop(activity) {
  const rawName = activity.photoQuery || activity.location || activity.title;
  const name = plannerPlaceSearchTarget(plannerPhotoPlaceName(rawName) || rawName, activity.city).name;
  return { city: activity.city.trim(), name: name.slice(0, 60) };
}

/** 只在整天游玩需留行李、退房或接驳离开时提示，选择当天第一张相关景点卡。 */
function luggageStops(content) {
  const jobs = [];
  const mentionedStays = new Set();
  const cityKey = (city) => plannerPhotoCityName(city).replace(/市$/, '');
  const stayKey = (lodging) => lodging ? `${cityKey(lodging.city)}\n${lodging.area}` : '';
  for (const [index, day] of content.days.entries()) {
    const activities = plannerActivitiesByTime(day.activities);
    const activity = activities.find((item) => item.kind === 'sight');
    if (!activity) continue;
    const overnight = content.days[index - 1]?.lodging;
    const previous = overnight && cityKey(overnight.city) === cityKey(activity.city) ? overnight : null;
    const sameStay = previous && stayKey(previous) === stayKey(day.lodging);
    if (sameStay) {
      const key = stayKey(previous);
      if (mentionedStays.has(key)) continue;
      mentionedStays.add(key);
      jobs.push({ activity, fallback: '行李留在原酒店，最后离开时取。' });
    } else if (overnight || !day.lodging) {
      const stop = storageStop(activity);
      const outbound = activities.some((item) => item.kind === 'transport' && item.startTime >= activity.endTime
        && /车站|火车站|高铁站|机场|航站楼|高铁|城际|火车|航班/.test(`${item.title} ${item.location} ${item.transportMode}`));
      jobs.push({ activity, stop, preferHotel: !outbound && (previous ? '先问原酒店前台，离开前取；' : !overnight && content.days.length === 1 ? '已有住宿可先问前台；' : ''),
        fallback: outbound ? '先核对景点寄存位置和收费，游览后取件再去乘车。'
          : previous ? '优先问原酒店前台能否寄存，离开前取件；赶车时可先核对景点寄存。'
          : !overnight && content.days.length === 1 ? '已有住宿可先问酒店前台；也可核对景点寄存，离开前取件。'
            : '先核对景点寄存位置和价格，游览后取件再离开。' });
    } else if (index === 0) {
      jobs.push({ activity, fallback: '如果入住前需要放行李，先问酒店前台能否寄存。' });
    }
  }
  return jobs;
}

/** 给活动补充一行。公开检索缺少寄存点或价格时，自动补查小红书并提供手动入口。 */
export async function addPlannerLuggageNotes(content, {
  web, searchXhs, isXhsNote, createSource, signal, progress, allowedActivityIds,
}) {
  if (content.request.luggageMode === 'backpack') return;
  const jobs = luggageStops(content).filter(({ activity }) => !activity.locked
    && (!allowedActivityIds || allowedActivityIds.has(activity.id)));
  // 多城长行程优先检查最后几次离开，确保返程日有检索机会。
  const searchable = jobs.filter(({ stop }) => stop?.name.length >= 2).slice(-4);
  if (searchable.length) progress('正在核对景点行李寄存与费用');
  const pending = new Map();
  // 这一步不阻塞行程太久。超时继续返回计划，并把具体景点的搜索入口放在原卡片上。
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(28000)]);
  for (const { stop } of searchable) {
    const key = `${stop.city} ${stop.name}`.trim();
    if (pending.has(key)) continue;
    pending.set(key, (async () => {
      const findFacts = (items) => items.map((item) => storageFact(item, stop)).filter(Boolean);
      let publicFacts = [];
      try {
        const results = web.available ? await web.search(`${key} 行李寄存 游客中心 收费`.slice(0, 128),
          { count: 4, needContent: true, signal: deadline, timeout: 10000 }) : [];
        publicFacts = findFacts(results);
      } catch { /* 公开检索失败时，仍可通过本机小红书连接补查。 */ }
      const official = publicFacts.filter(({ item }) => !isXhsNote(item.url));
      const complete = official.find(({ fee, location }) => fee && location);
      if (complete) return complete;
      if (deadline.aborted) return publicFacts[0] ?? null;
      try {
        progress('公开资料未确认寄存点或价格，正在补查小红书');
        const fromXhs = findFacts(await searchXhs(stop, deadline, (item) => Boolean(storageFact(item, stop))));
        return [...fromXhs, ...publicFacts].find(({ fee, location }) => fee && location)
          ?? official[0] ?? fromXhs[0] ?? publicFacts[0] ?? null;
      } catch {
        return official[0] ?? publicFacts[0] ?? null;
      }
    })());
  }

  for (const { activity, stop, preferHotel, fallback } of jobs) {
    const key = stop && `${stop.city} ${stop.name}`.trim();
    const fact = key ? await pending.get(key) : null;
    signal.throwIfAborted();
    if (!fact) {
      activity.luggageNote = { text: fallback, ...(key && stop.name.length >= 2 ? { searchQuery: `${key} 行李寄存`.slice(0, 120) } : {}) };
      continue;
    }
    const source = content.sources.find(({ url }) => url === fact.item.url) ?? (() => {
      const result = createSource(fact.item);
      content.sources.push(result);
      return result;
    })();
    const where = fact.location ? `${stop.name}${fact.location}` : stop.name;
    const price = [fact.fee || '价格需确认', !fact.location && '位置需确认'].filter(Boolean).join('，');
    const basis = isXhsNote(fact.item.url) ? '游客经验' : '公开资料';
    const choice = `${basis}提到${where}可寄存（${price}），游览后取件，以现场为准。`;
    activity.luggageNote = { text: `${preferHotel || ''}${choice}`.slice(0, 160), sourceId: source.id,
      ...(!fact.fee || !fact.location ? { searchQuery: `${key} 行李寄存`.slice(0, 120) } : {}) };
  }
}
