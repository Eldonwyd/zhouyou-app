import type { AiTravelPlan, PackingCategory, PlannerCost } from './planner-types.ts';
import type { TripPlan } from './types.ts';
import { BUDGET_LABELS } from './types.ts';
import { calculatePlannerBudget, PLANNER_PERIODS, plannerActivitiesByTime, plannerDurationLabel, plannerFillEstimates, plannerParty } from './planner-domain.ts';
import { formatTransferOption, isIntraCityTransferCard, plannerDisplayText, plannerExportText, plannerGapTransfer, plannerTransferDisplay, plannerTransferOptions, plannerTransportActivityKey, splitAnswerLinks } from './planner-display.ts';
import type { PlannerTransferModeKind } from './planner-types.ts';
import { plannerAmapUrl } from './planner-map.ts';
import { plannerLuggageNoteText } from './planner-luggage.ts';
import { needsTicketPreparation } from './planner-ticket-display.ts';
import { BOOKING_KIND_LABELS } from './planner-booking.ts';
import { calculateAaSplit, defaultSplitMembers } from './finance.ts';
import { downloadBlob } from './utils.ts';

const PACKING_CATEGORY_LABELS: Record<PackingCategory, string> = {
  documents: '证件票据',
  clothing: '衣物鞋帽',
  medicine: '常备药品',
  electronics: '电子设备',
  bookings: '预约核对',
  other: '其他物品',
};

const KIND_LABELS = { sight: '游玩', food: '餐饮', transport: '交通', rest: '休息' } as const;

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents: number | null): string {
  if (cents == null) return '以现场为准';
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function formatCostLine(cost: PlannerCost): string {
  if (cost.includedIn) return '套餐已含';
  const prefix = cost.status === 'verified' || cost.status === 'booked' ? '' : '约 ';
  if (cost.unitPriceCents == null) return '以现场为准';
  return `${prefix}${money(cost.unitPriceCents)}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** 打包导出前将过大的本地照片适度压缩，确保单文件 HTML 在微信内秒开。 */
async function compressPhotoForHtml(blob: Blob): Promise<string> {
  if (blob.size <= 160 * 1024 || typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return blobToDataUrl(blob);
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const maxEdge = 760;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compact = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    return blobToDataUrl(compact ?? blob);
  } catch {
    return blobToDataUrl(blob);
  }
}

/**
 * 构建完全自包含的单文件离线 HTML 路书（零外链依赖，适合发微信直接打开）。
 */
export function buildOfflineRoadbookHtml(
  plan: AiTravelPlan,
  options: { photoDataUrls?: Record<string, string>; tripPlan?: TripPlan | null } = {},
): string {
  const content = plannerFillEstimates(plan.content);
  const budget = calculatePlannerBudget(content);
  const party = plannerParty(content.request);
  const partyText = [
    [party.adults, '成人'],
    [party.students, '学生'],
    [party.seniors, '老人'],
    [party.children, '儿童'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count}${label}`)
    .join(' · ');

  const title = plannerExportText(content.title, content);
  const summary = plannerExportText(content.summary, content);
  const startDate = content.days[0]?.date ?? '';
  const endDate = content.days.at(-1)?.date ?? '';
  const citiesText = content.cities.map((c) => c.name).join(' → ');
  const perPerson = money(Math.round(budget.totalCents / Math.max(1, content.request.people)));
  const photoMap = options.photoDataUrls ?? {};
  const visibleTickets = (plan.ticketPlan?.items ?? []).filter(needsTicketPreparation);
  const packingItems = plan.packingList?.items ?? [];
  const bookings = plan.bookings ?? [];

  const tripPlan = options.tripPlan ?? null;
  const aaSummary =
    tripPlan && (tripPlan.splitItems?.length ?? 0) > 0
      ? calculateAaSplit(defaultSplitMembers(tripPlan.people, undefined, tripPlan.splitMembers), tripPlan.splitItems!)
      : null;

  const navLinks = [
    ...content.days.map((day, idx) => `<a class="pill-nav" href="#day-${idx + 1}">D${idx + 1} · ${escapeHtml(day.date.slice(5))}</a>`),
    ...(bookings.length ? ['<a class="pill-nav" href="#sec-bookings">车次与酒店</a>'] : []),
    ...(visibleTickets.length ? ['<a class="pill-nav" href="#sec-tickets">抢票计划</a>'] : []),
    ...(packingItems.length ? ['<a class="pill-nav" href="#sec-packing">行前清单</a>'] : []),
    '<a class="pill-nav" href="#sec-budget">预算明细</a>',
  ].join('');

  const bookingsHtml = bookings.length
    ? `<section id="sec-bookings" class="card section-card">
        <div class="sec-head"><span class="eyebrow">BOOKINGS</span><h2>已录入的车次与酒店</h2></div>
        <div class="booking-grid">${bookings
          .map((item) => {
            const route = [item.fromLocation, item.toLocation].filter(Boolean).join(' → ');
            const dateRange = item.endDate && item.endDate !== item.date ? `${item.date} 至 ${item.endDate}` : item.date;
            const timeRange = [item.startTime, item.endTime].filter(Boolean).join('—');
            const detail = [route, item.seatOrRoom, item.note].filter(Boolean).join(' · ');
            return `<article class="booking-card">
              <div class="booking-top"><span class="badge">${escapeHtml(BOOKING_KIND_LABELS[item.kind])}</span>${
                item.amountYuan != null ? `<strong class="booking-price">¥${item.amountYuan.toFixed(item.amountYuan % 1 === 0 ? 0 : 2)}</strong>` : ''
              }</div>
              <h3>${escapeHtml(item.hotelName || item.title)}</h3>
              <p class="meta">${escapeHtml([dateRange, timeRange, item.code].filter(Boolean).join(' · '))}</p>
              ${detail ? `<p class="desc">${escapeHtml(detail)}</p>` : ''}
            </article>`;
          })
          .join('')}</div>
      </section>`
    : '';

  const ticketsHtml = visibleTickets.length
    ? `<section id="sec-tickets" class="card section-card">
        <div class="sec-head"><span class="eyebrow">RESERVATIONS</span><h2>抢票与预约计划</h2></div>
        <div class="ticket-list">${visibleTickets
          .map(
            (item) => `<article class="ticket-item ${item.difficulty === '难' ? 'hard' : ''}">
              <div class="ticket-time"><strong>${escapeHtml(item.saleDate || '开售日期待核实')}</strong><span>${escapeHtml(item.saleTime || '时刻待核实')}</span></div>
              <div class="ticket-body">
                <h3>${escapeHtml(plannerDisplayText(item.title, content))}${item.difficulty === '难' ? '<mark>难抢 · 优先</mark>' : ''}</h3>
                <p class="meta">使用日期：${escapeHtml(item.travelDate)} · 难度：${escapeHtml(item.difficulty)} · ${escapeHtml(item.platform)}</p>
                <p class="desc">${escapeHtml(plannerExportText(item.note, content))}</p>
              </div>
            </article>`,
          )
          .join('')}</div>
      </section>`
    : '';

  const packingHtml = packingItems.length
    ? `<section id="sec-packing" class="card section-card">
        <div class="sec-head"><span class="eyebrow">PACKING LIST</span><h2>行前准备清单</h2><p class="meta">可直接点击勾选，状态会保存在当前浏览器中。</p></div>
        <div class="packing-groups">${(Object.keys(PACKING_CATEGORY_LABELS) as PackingCategory[])
          .map((cat) => {
            const rows = packingItems.filter((item) => item.category === cat);
            if (!rows.length) return '';
            return `<div class="packing-group">
              <h3>${escapeHtml(PACKING_CATEGORY_LABELS[cat])}</h3>
              <ul>${rows
                .map(
                  (item) => `<li><label class="pack-row"><input type="checkbox" data-pack-id="${escapeHtml(item.id)}" ${
                    item.checked ? 'checked' : ''
                  } /><span><strong>${escapeHtml(item.name)}</strong>${
                    item.note ? `<small>${escapeHtml(item.note)}</small>` : ''
                  }</span></label></li>`,
                )
                .join('')}</ul>
            </div>`;
          })
          .join('')}</div>
      </section>`
    : '';

  const modeIcons: Record<PlannerTransferModeKind, string> = {
    walk: '🚶', subway: '🚇', bus: '🚌', taxi: '🚕', drive: '🚗', train: '🚄', flight: '✈️', other: '🧭',
  };
  const renderTransferBridgeHtml = (opts: ReturnType<typeof plannerTransferOptions>, selectedIndex?: number) => {
    const visible =
      selectedIndex !== undefined && selectedIndex >= 0 && selectedIndex < opts.length
        ? [opts[selectedIndex]]
        : opts;
    const rows = visible.map((opt) => {
      const fmt = formatTransferOption(opt);
      return `<div class="transfer-opt mode-${escapeHtml(fmt.mode)}">
        <span class="transfer-emoji">${modeIcons[fmt.mode]}</span>
        <div class="transfer-copy">
          <strong>${escapeHtml(plannerExportText(fmt.title, content))}</strong>
          ${fmt.stations ? `<span class="transfer-station">${escapeHtml(plannerExportText(fmt.stations, content))}</span>` : ''}
          ${fmt.metrics.map((m) => `<span class="transfer-chip">${escapeHtml(plannerExportText(m, content))}</span>`).join('')}
          ${fmt.carpool ? `<span class="transfer-chip">${escapeHtml(plannerExportText(fmt.carpool, content))}</span>` : ''}
          ${fmt.note ? `<small>${escapeHtml(plannerExportText(fmt.note, content))}</small>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="transfer-bridge">${rows}</div>`;
  };
  const activitiesById = new Map(content.days.flatMap((day) => day.activities.map((activity) => [activity.id, activity] as const)));
  const daysHtml = content.days
    .map((day, dayIndex) => {
      const dayOrdered = plannerActivitiesByTime(day.activities);
      const prevById = new Map(dayOrdered.slice(1).map((item, idx) => [item.id, dayOrdered[idx]] as const));
      const periodsHtml = (Object.entries(PLANNER_PERIODS) as Array<[keyof typeof PLANNER_PERIODS, string]>)
        .map(([period, label]) => {
          const acts = plannerActivitiesByTime(day.activities.filter((item) => item.period === period));
          if (!acts.length) return '';
          return `<div class="period-block">
            <h3 class="period-label">${escapeHtml(label)}</h3>
            ${acts
              .map((act) => {
                const transfer = plannerTransferDisplay(act, activitiesById);
                const savedActOpts = act.kind === 'transport' && !act.transferOptions?.length
                  ? plan.legTransfers?.[plannerTransportActivityKey(act, content.request)]
                  : undefined;
                const transferOpts = act.kind === 'transport'
                  ? plannerTransferOptions(savedActOpts?.length ? { ...act, transferOptions: savedActOpts } : act, content.request)
                  : [];
                const compact = isIntraCityTransferCard(act, activitiesById, day.activities);
                if (compact && transferOpts.length) {
                  return renderTransferBridgeHtml(transferOpts, plan.selectedTransfers?.[act.id]);
                }
                const gap = plannerGapTransfer(prevById.get(act.id), act, content.request);
                const directGapOpts = gap ? plan.legTransfers?.[gap.key] : undefined;
                const gapHtml = directGapOpts?.length
                  ? renderTransferBridgeHtml(directGapOpts, plan.selectedTransfers?.[gap!.key])
                  : '';
                const photoUrl = act.photo?.assetId ? photoMap[act.photo.assetId] : '';
                const amapHref = plannerAmapUrl({ city: act.city, name: act.location || act.photoQuery || act.title });
                const guide = plan.activityGuides?.[act.id];
                const guideBody = guide ? splitAnswerLinks(plannerDisplayText(guide.text, content)).body : '';
                const costText = act.costs
                  .map((cost) => `${plannerExportText(cost.label, content)}：${formatCostLine(cost)}`)
                  .join(' · ');
                const transferText = transferOpts.length
                  ? transferOpts.map((opt) => `${modeIcons[opt.mode]} ${formatTransferOption(opt).summaryText}`).join(' / ')
                  : transfer?.details;
                return `${gapHtml}<article class="act-card kind-${escapeHtml(act.kind)}">
                  ${photoUrl ? `<div class="act-photo"><img src="${photoUrl}" alt="${escapeHtml(act.title)}" loading="lazy" /></div>` : ''}
                  <div class="act-body">
                    <div class="act-meta">
                      <span class="time-pill">${escapeHtml(act.startTime)}—${escapeHtml(act.endTime)}</span>
                      <span class="kind-pill">${escapeHtml(KIND_LABELS[act.kind])}${transfer ? '' : ` · ${escapeHtml(plannerDurationLabel(act.startTime, act.endTime))}`}</span>
                    </div>
                    <h4>${escapeHtml(plannerExportText(transfer?.route || act.title, content))}</h4>
                    <p class="${transfer ? 'act-transfer' : 'act-loc'}">${escapeHtml(plannerExportText(transferText || [act.city, act.location, act.transportMode].filter(Boolean).join(' · '), content))}</p>
                    <p class="act-desc">${escapeHtml(plannerExportText(act.description, content))}</p>
                    ${content.request.luggageMode !== 'backpack' && act.luggageNote ? `<p class="act-desc">${escapeHtml(plannerExportText(plannerLuggageNoteText(act), content))}</p>` : ''}
                    ${costText ? `<p class="act-cost">${escapeHtml(costText)}</p>` : ''}
                    <div class="act-actions">
                      <a class="amap-btn" href="${escapeHtml(amapHref)}" target="_blank" rel="noopener noreferrer">在高德地图查看 ↗</a>
                    </div>
                    ${
                      guideBody
                        ? `<details class="guide-box"><summary>展开 AI 详细攻略</summary><p>${escapeHtml(guideBody).replace(/\n/g, '<br/>')}</p></details>`
                        : ''
                    }
                  </div>
                </article>`;
              })
              .join('')}
          </div>`;
        })
        .join('');

      const hotelName = plan.hotels?.[day.date]?.trim() || '';
      const lodgingHtml = day.lodging
        ? `<div class="lodging-card">
            <span class="eyebrow">STAY TONIGHT</span>
            ${
              hotelName
                ? `<h4>已订酒店：${escapeHtml(hotelName)}</h4>
                   <a class="amap-btn" href="${escapeHtml(plannerAmapUrl({ city: day.lodging.city, name: hotelName }))}" target="_blank" rel="noopener noreferrer">高德地图导航去酒店 ↗</a>`
                : `<h4>住宿片区建议：${escapeHtml(day.lodging.city)} · ${escapeHtml(day.lodging.area)}</h4>`
            }
            <p class="desc">${escapeHtml(plannerExportText(day.lodging.reason, content))}</p>
            ${!hotelName ? `<p class="meta">订房关键词：${escapeHtml(day.lodging.searchKeyword)}</p>` : ''}
          </div>`
        : '';

      return `<section id="day-${dayIndex + 1}" class="card day-card">
        <div class="day-head">
          <span class="day-badge">DAY ${dayIndex + 1}</span>
          <div>
            <h2>${escapeHtml(plannerExportText(day.title, content))}</h2>
            <p class="meta">${escapeHtml(day.date)} · ${escapeHtml(plannerExportText(day.weather, content))}</p>
          </div>
        </div>
        ${periodsHtml}
        ${lodgingHtml}
      </section>`;
    })
    .join('');

  const aaHtml = aaSummary
    ? `<div class="aa-box">
        <h3>同行人 AA 分账结算（已记录 ${money(aaSummary.totalCents)}）</h3>
        <div class="aa-members">${aaSummary.members
          .map(
            (m) => `<div class="aa-row"><span>${escapeHtml(m.name)}</span><span>实付 ${money(m.paidCents)} · 应付 ${money(m.owedCents)}</span><strong>${
              m.netCents > 0 ? `应收 +${money(m.netCents)}` : m.netCents < 0 ? `应付 -${money(-m.netCents)}` : '已结清'
            }</strong></div>`,
          )
          .join('')}</div>
        ${
          aaSummary.transfers.length
            ? `<div class="aa-transfers">${aaSummary.transfers
                .map((t) => `<p>${escapeHtml(t.from)} → ${escapeHtml(t.to)}：<strong>${money(t.amountCents)}</strong></p>`)
                .join('')}</div>`
            : '<p class="meta">当前全部结清，无需转账。</p>'
        }
      </div>`
    : '';

  const budgetHtml = `<section id="sec-budget" class="card section-card">
    <div class="sec-head"><span class="eyebrow">BUDGET & SUMMARY</span><h2>行程费用预估</h2></div>
    <div class="budget-hero">
      <div><span>预计总开销</span><strong>${escapeHtml(money(budget.totalCents))}</strong></div>
      <div><span>人均约</span><strong>${escapeHtml(perPerson)}</strong></div>
      <div><span>出行人群</span><strong>${escapeHtml(partyText || `${content.request.people}人`)}</strong></div>
    </div>
    <div class="budget-cats">${Object.entries(budget.categories)
      .map(
        ([cat, cents]) =>
          `<div class="cat-pill"><span>${escapeHtml(BUDGET_LABELS[cat as keyof typeof BUDGET_LABELS] ?? cat)}</span><strong>${escapeHtml(money(cents))}</strong></div>`,
      )
      .join('')}</div>
    ${aaHtml}
  </section>`;

  const warnings = [...new Set(content.warnings)];
  const warningsHtml = warnings.length
    ? `<section class="card section-card warnings-card">
        <div class="sec-head"><span class="eyebrow">REMINDERS</span><h2>出行提醒</h2></div>
        <ul>${warnings.map((w) => `<li>${escapeHtml(plannerExportText(w, content))}</li>`).join('')}</ul>
      </section>`
    : '';

  const storageKey = `roadbook-pack-${plan.id}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)} · 离线路书</title>
<style>
  :root {
    --bg: #faf7f2; --surface: #ffffff; --surface-2: #f4efe6; --ink: #243025; --muted: #657266;
    --line: #e6dfd2; --green: #5c764c; --green-soft: #e9efdf; --peach: #d47b52; --peach-soft: #f9e7dc;
    --honey-soft: #f8edd2; --honey-ink: #8a6c27; --radius: 18px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 14px 48px; background: var(--bg); color: var(--ink);
    font-family: 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.65; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 860px; margin: 0 auto; display: grid; gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; box-shadow: 0 8px 24px -14px rgba(36,48,37,.12); }
  .hero { background: linear-gradient(155deg, #eef3e6 0%, #faf3e5 100%); border-color: #dce4d2; }
  .eyebrow { display: inline-block; font-size: 11px; letter-spacing: .12em; color: var(--green); font-weight: 700; text-transform: uppercase; }
  h1 { margin: 6px 0 8px; font-size: 26px; line-height: 1.28; }
  h2 { margin: 4px 0 0; font-size: 19px; line-height: 1.35; }
  h3 { margin: 0 0 8px; font-size: 15px; }
  h4 { margin: 4px 0 6px; font-size: 16px; }
  p { margin: 0 0 8px; }
  .meta { color: var(--muted); font-size: 13px; }
  .desc { font-size: 14px; color: #364337; white-space: pre-line; }
  .hero-tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .hero-tags span { background: rgba(255,255,255,.78); border: 1px solid var(--line); padding: 4px 11px; border-radius: 999px; font-size: 13px; font-weight: 500; }
  .quick-nav { position: sticky; top: 8px; z-index: 20; display: flex; gap: 8px; overflow-x: auto; padding: 10px 12px; background: rgba(255,255,255,.92); backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: 14px; }
  .pill-nav { flex: 0 0 auto; text-decoration: none; color: var(--ink); background: var(--surface-2); padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500; }
  .pill-nav:hover { background: var(--green-soft); color: var(--green); }
  .day-head { display: flex; gap: 14px; align-items: flex-start; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
  .day-badge { flex: 0 0 auto; background: var(--green); color: #fff; font-weight: 700; font-size: 12px; padding: 6px 11px; border-radius: 10px; letter-spacing: .06em; }
  .period-block { margin-bottom: 16px; }
  .period-label { font-size: 13px; color: var(--green); background: var(--green-soft); display: inline-block; padding: 3px 10px; border-radius: 999px; margin-bottom: 10px; }
  .act-card { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 14px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: #fffcf8; margin-bottom: 10px; }
  .act-card:not(:has(.act-photo)) { grid-template-columns: 1fr; }
  .act-photo { width: 100%; height: 124px; border-radius: 10px; overflow: hidden; background: var(--surface-2); }
  .act-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .act-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 4px; }
  .time-pill { font-size: 12px; font-weight: 700; color: var(--peach); background: var(--peach-soft); padding: 2px 8px; border-radius: 999px; }
  .kind-pill { font-size: 12px; color: var(--muted); }
  .act-loc { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  .act-transfer { font-size: 13px; color: var(--green); font-weight: 700; margin-bottom: 6px; }
  .transfer-bridge { display: grid; gap: 6px; margin: -2px 0 10px 8px; padding: 8px 12px; border-radius: 12px; background: #f4f7ef; border: 1px dashed #cfd9c2; }
  .transfer-opt { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
  .transfer-emoji { font-size: 16px; line-height: 1.3; flex: 0 0 auto; }
  .transfer-copy { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .transfer-station { color: var(--ink); font-weight: 600; }
  .transfer-chip { background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-size: 12px; color: var(--muted); }
  .transfer-copy small { width: 100%; font-size: 12px; color: var(--muted); }
  .act-desc { font-size: 14px; margin-bottom: 8px; white-space: pre-line; }
  .act-cost { font-size: 13px; font-weight: 600; color: var(--green); margin-bottom: 8px; }
  .amap-btn { display: inline-block; text-decoration: none; font-size: 13px; font-weight: 600; color: var(--green); background: var(--green-soft); padding: 5px 12px; border-radius: 999px; }
  .guide-box { margin-top: 10px; padding: 10px 12px; background: var(--surface-2); border-radius: 10px; font-size: 13px; }
  .guide-box summary { cursor: pointer; font-weight: 600; color: var(--ink); }
  .guide-box p { margin-top: 8px; }
  .lodging-card { margin-top: 12px; padding: 14px; border-radius: 14px; background: var(--honey-soft); border: 1px solid #eadab2; }
  .lodging-card h4 { color: var(--honey-ink); margin: 4px 0 6px; }
  .booking-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; margin-top: 12px; }
  .booking-card { padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); }
  .booking-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--green-soft); color: var(--green); font-weight: 600; }
  .booking-price { color: var(--peach); }
  .ticket-list { display: grid; gap: 10px; margin-top: 12px; }
  .ticket-item { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); }
  .ticket-item.hard { border-color: #e4b59f; background: #fff7f2; }
  .ticket-time strong { display: block; font-size: 14px; color: var(--peach); }
  .ticket-time span { font-size: 12px; color: var(--muted); }
  .ticket-body mark { margin-left: 8px; font-size: 11px; padding: 2px 7px; border-radius: 999px; background: var(--peach); color: #fff; }
  .packing-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-top: 12px; }
  .packing-group { padding: 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
  .packing-group ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .pack-row { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; font-size: 14px; }
  .pack-row input { margin-top: 4px; accent-color: var(--green); }
  .pack-row small { display: block; font-size: 12px; color: var(--muted); }
  .pack-row input:checked + span { text-decoration: line-through; opacity: .55; }
  .budget-hero { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0; }
  .budget-hero > div { padding: 12px; border-radius: 12px; background: var(--surface-2); }
  .budget-hero span { display: block; font-size: 12px; color: var(--muted); }
  .budget-hero strong { font-size: 18px; color: var(--ink); }
  .budget-cats { display: flex; flex-wrap: wrap; gap: 8px; }
  .cat-pill { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 6px 12px; font-size: 13px; display: flex; gap: 8px; }
  .aa-box { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--line); }
  .aa-members { display: grid; gap: 6px; margin: 8px 0; }
  .aa-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 13px; padding: 6px 10px; background: var(--bg); border-radius: 8px; }
  .aa-transfers { padding: 10px 12px; background: var(--green-soft); border-radius: 10px; color: var(--green); font-size: 14px; }
  .warnings-card ul { margin: 10px 0 0; padding-left: 18px; font-size: 14px; }
  footer { text-align: center; font-size: 12px; color: var(--muted); padding-top: 8px; }
  @media (max-width: 640px) {
    .act-card { grid-template-columns: 1fr; }
    .act-photo { height: 170px; }
    .ticket-item { grid-template-columns: 1fr; }
    .budget-hero { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .quick-nav, .amap-btn { display: none; }
    .card { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="card hero">
    <span class="eyebrow">OFFLINE TRAVEL ROADBOOK</span>
    <h1>${escapeHtml(title)}</h1>
    <p class="desc">${escapeHtml(summary)}</p>
    <div class="hero-tags">
      <span>📅 ${escapeHtml(startDate)} — ${escapeHtml(endDate)}（${content.days.length} 天）</span>
      ${citiesText ? `<span>📍 ${escapeHtml(citiesText)}</span>` : ''}
      <span>👥 ${escapeHtml(partyText || `${content.request.people}人`)}</span>
      <span>💰 预估 ${escapeHtml(money(budget.totalCents))}（人均 ${escapeHtml(perPerson)}）</span>
    </div>
  </header>
  <nav class="quick-nav" aria-label="快捷导航">${navLinks}</nav>
  ${bookingsHtml}
  ${ticketsHtml}
  ${packingHtml}
  ${warningsHtml}
  <main>${daysHtml}</main>
  ${budgetHtml}
  <footer>离线单文件路书 · 导出于 ${escapeHtml(new Date().toLocaleString('zh-CN'))} · 无需联网即可打开浏览</footer>
</div>
<script>
(function(){
  var key = ${JSON.stringify(storageKey)};
  try {
    var saved = JSON.parse(localStorage.getItem(key) || '{}');
    document.querySelectorAll('input[data-pack-id]').forEach(function(box){
      var id = box.getAttribute('data-pack-id');
      if (id in saved) box.checked = !!saved[id];
      box.addEventListener('change', function(){
        saved[id] = box.checked;
        try { localStorage.setItem(key, JSON.stringify(saved)); } catch(e) {}
      });
    });
  } catch(e) {}
})();
</script>
</body>
</html>`;
}

/** 收集本地缓存的实景照片并下载为独立的单文件离线 HTML 路书。 */
export async function exportOfflineRoadbook(plan: AiTravelPlan, tripPlan?: TripPlan | null): Promise<void> {
  const { getPlannerPhotoBlob } = await import('./db');
  const assetIds = new Set<string>();
  for (const day of plan.content.days) {
    for (const act of day.activities) {
      if (act.photo?.assetId) assetIds.add(act.photo.assetId);
    }
  }
  const photoDataUrls: Record<string, string> = {};
  for (const assetId of assetIds) {
    try {
      let blob = await getPlannerPhotoBlob(assetId);
      if (!blob && typeof fetch === 'function') {
        const res = await fetch(`${import.meta.env.BASE_URL}api/planner/photo-file/${assetId}`);
        if (res.ok) blob = await res.blob();
      }
      if (blob) photoDataUrls[assetId] = await compressPhotoForHtml(blob);
    } catch {
      // 单张图片缺失不阻断路书导出。
    }
  }
  const html = buildOfflineRoadbookHtml(plan, { photoDataUrls, tripPlan });
  const safeName = plan.content.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '旅行路书';
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeName}-离线路书.html`);
}
