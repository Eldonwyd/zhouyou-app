import { useEffect, useMemo, useState } from 'react';
import type { BudgetCategory, CategoryAmounts, CityMark, Journey, TripPlan } from '../types';
import { BUDGET_CATEGORIES, BUDGET_LABELS, emptyAmounts } from '../types';
import { currency, sumAmounts } from '../utils';
import type { AiTravelPlan } from '../planner-types';
import { calculatePlannerBudget, plannerFillEstimates } from '../planner-domain';
import DailyLedger from './DailyLedger';
import { seedAiExpenses } from '../finance';

interface PlanViewProps {
  aiPlans?: AiTravelPlan[];
  selectedFinanceKey?: string | null;
  onPublishAi?: (plan: AiTravelPlan, initialFinance?: TripPlan) => Promise<AiTravelPlan>;
  city: CityMark | null;
  marks: CityMark[];
  trips: Journey[];
  plans: TripPlan[];
  onSave: (plan: TripPlan) => Promise<void>;
  onMoveLegacy: (legacyId: string, plan: TripPlan) => Promise<void>;
  onCreateJourney: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

interface FinanceItem {
  aiPlan?: AiTravelPlan;
  key: string;
  title: string;
  dates: string;
  cities: string;
  journey: Journey | null;
  plan: TripPlan | null;
}

/** A new budget belongs to one journey, even when that journey spans cities. */
function freshPlan(journey: Journey): TripPlan {
  return {
    id: journey.id, tripId: journey.id, cityCode: journey.cities[0]?.code ?? '',
    startDate: journey.startDate, endDate: journey.endDate, people: 1,
    budget: emptyAmounts(), actual: emptyAmounts(), manualActualTotal: null, reminderDays: 1,
  };
}

function AmountFields({ title, amounts, onChange }: { title: string; amounts: CategoryAmounts; onChange: (value: CategoryAmounts) => void }) {
  return <div className="amount-section"><h3>{title}</h3><div className="amount-grid">{BUDGET_CATEGORIES.map((category: BudgetCategory) => <label key={category}>{BUDGET_LABELS[category]}<span className="money-input"><span>¥</span><input type="number" min="0" step="0.01" value={amounts[category] || ''} placeholder="0" onChange={(event) => onChange({ ...amounts, [category]: Math.max(0, Number(event.target.value) || 0) })} /></span></label>)}</div></div>;
}

export default function PlanView({ city, marks, trips, plans, aiPlans, selectedFinanceKey, onPublishAi, onSave, onMoveLegacy, onCreateJourney, onError, onNotice }: PlanViewProps) {
  const [showAll, setShowAll] = useState(Boolean(selectedFinanceKey) || !city);
  const [activeKey, setActiveKey] = useState<string | null>(selectedFinanceKey ?? null);
  const [draft, setDraft] = useState<TripPlan | null>(null);
  const [moveTargetTripId, setMoveTargetTripId] = useState('');
  const [saving, setSaving] = useState(false);

  // 行程上的入口指定对应账本；跨城市行程也必须能够直接打开。
  useEffect(() => {
    if (selectedFinanceKey) { setActiveKey(selectedFinanceKey); setShowAll(true); }
  }, [selectedFinanceKey]);

  // Legacy city sheets stay visible until the owner chooses the right trip.
  // Guessing from dates could silently attach an expense to the wrong trip.
  const financeItems = useMemo<FinanceItem[]>(() => {
    const journeyItems = [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((journey) => ({
      key: `journey:${journey.id}`, title: journey.title,
      dates: `${journey.startDate} — ${journey.endDate}`,
      cities: journey.cities.map((item) => item.name).join(' · '), journey,
      plan: plans.find((plan) => plan.tripId === journey.id) ?? null,
    }));
    const legacyItems = plans.filter((plan) => !plan.tripId).map((plan) => ({
      key: `legacy:${plan.id}`, title: `${marks.find((mark) => mark.id === plan.cityCode)?.name ?? plan.cityCode} · 旧版城市账单`,
      dates: plan.startDate && plan.endDate ? `${plan.startDate} — ${plan.endDate}` : '尚未填写日期',
      cities: marks.find((mark) => mark.id === plan.cityCode)?.name ?? plan.cityCode,
      journey: null, plan,
    }));
    // 尚未加入旅行记录的行程也可预览预算；仅保存账本时创建真实旅行关联。
    const itineraryItems: FinanceItem[] = (aiPlans ?? []).filter((plan) => !plan.linkedTripId).map((aiPlan) => {
      const content = aiPlan.content;
      const journey: Journey = { id: aiPlan.id, title: content.title, status: 'planned',
        startDate: content.days[0].date, endDate: content.days.at(-1)!.date,
        cities: content.cities, companions: [], createdAt: aiPlan.createdAt };
      const categories = calculatePlannerBudget(plannerFillEstimates(content)).categories;
      const plan = freshPlan(journey);
      plan.people = content.request.people;
      for (const category of BUDGET_CATEGORIES) plan.budget[category] = categories[category] / 100;
      return { key: `ai:${aiPlan.id}`, title: content.title, dates: `${journey.startDate} — ${journey.endDate}`,
        cities: content.cities.map((item) => item.name).join(' · '), journey, plan, aiPlan };
    });
    return [...itineraryItems, ...journeyItems, ...legacyItems];
  }, [trips, plans, marks, aiPlans]);

  const visibleItems = useMemo(() => financeItems.filter((item) => showAll || !city
    || item.journey?.cities.some((travelCity) => travelCity.code === city.id)
    || item.plan?.cityCode === city.id), [financeItems, showAll, city]);
  // 首次保存会把临时行程项变为真实旅行项，关联完成时仍保持原选择。
  const linkedTripId = activeKey?.startsWith('ai:')
    ? aiPlans?.find((plan) => `ai:${plan.id}` === activeKey)?.linkedTripId : null;
  const activeItem = visibleItems.find((item) => item.key === activeKey || (linkedTripId && item.key === `journey:${linkedTripId}`)) ?? visibleItems[0] ?? null;
  const activeJourney = activeItem?.journey ?? null;
  const isLegacy = Boolean(activeItem && !activeJourney);

  useEffect(() => {
    const plan = activeItem ? activeItem.plan ?? (activeItem.journey ? freshPlan(activeItem.journey) : null) : null;
    const aiPlan = activeItem?.aiPlan ?? aiPlans?.find((item) => item.linkedTripId === activeItem?.journey?.id);
    setDraft(plan && aiPlan ? seedAiExpenses(plan, aiPlan.content) : plan);
    setMoveTargetTripId('');
    // 后台抢票或照片更新也会刷新 aiPlans；不能因此重置正在编辑的账本。
  }, [activeItem?.key]);

  const budgetTotal = draft ? sumAmounts(draft.budget) : 0;
  const itemizedActual = draft ? sumAmounts(draft.actual) : 0;
  const actualTotal = draft?.manualActualTotal ?? itemizedActual;
  const perPerson = actualTotal / Math.max(1, draft?.people ?? 1);
  const progress = budgetTotal > 0 ? Math.round(actualTotal / budgetTotal * 100) : 0;
  const matchingMoveTargets = isLegacy && draft ? trips.filter((journey) =>
    journey.cities.some((travelCity) => travelCity.code === draft.cityCode)
    && !plans.some((plan) => plan.tripId === journey.id)) : [];

  async function save(): Promise<void> {
    if (!draft || !activeItem || saving) return;
    const updated = activeJourney ? {
      ...draft, id: activeJourney.id, tripId: activeJourney.id,
      cityCode: activeJourney.cities[0]?.code ?? '',
      startDate: activeJourney.startDate, endDate: activeJourney.endDate,
    } : draft;
    if (updated.endDate && updated.startDate && updated.endDate < updated.startDate) {
      onError('结束日期不能早于出发日期');
      return;
    }
    setSaving(true);
    try {
      if (activeItem.aiPlan) {
        if (!onPublishAi) throw new Error('无法关联行程，请重新打开预算与账本');
        const linked = await onPublishAi(activeItem.aiPlan, updated);
        if (!linked.linkedTripId) throw new Error('行程关联失败');
        setActiveKey(`journey:${linked.linkedTripId}`);
      } else await onSave(updated);
      onNotice('这次旅行的预算与账本已保存。');
    } catch (error) { onError(error instanceof Error ? error.message : '账本保存失败'); }
    finally { setSaving(false); }
  }

  async function moveLegacy(): Promise<void> {
    if (!isLegacy || !draft || !moveTargetTripId) return;
    const destination = trips.find((trip) => trip.id === moveTargetTripId);
    if (!destination) return;
    const moved: TripPlan = {
      ...draft, id: destination.id, tripId: destination.id,
      cityCode: destination.cities[0]?.code ?? draft.cityCode,
      startDate: destination.startDate, endDate: destination.endDate,
    };
    try {
      await onMoveLegacy(draft.id, moved);
      setActiveKey(`journey:${destination.id}`);
      onNotice(`旧版账单已归入“${destination.title}”。`);
    } catch { /* The transaction leaves the original sheet intact. */ }
  }

  return <div className="content-page"><div className="section-heading"><div><span className="eyebrow">TRIP PLANNER</span>
    <h1>{city && !showAll ? `${city.name} · 预算与账本` : '全部旅行 · 预算与账本'}</h1>
    <p>每次旅行有独立的预算与实际花费，多座城市共用同一本账。</p></div>
    <div className="heading-actions">{city && <button className="secondary" onClick={() => { setShowAll(!showAll); setActiveKey(null); }}>{showAll ? `只看${city.name}` : '查看全部旅行'}</button>}
      {draft && <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存计划'}</button>}</div></div>

    <section className="card finance-journeys"><div className="card-heading"><div><h2>选择行程</h2><p>选择“我的行程”中的计划或已有旅行，分别管理预算与实际花费。</p></div>
      <button className="secondary" onClick={onCreateJourney}>前往旅行手账新建</button></div>
      <label>当前行程<select aria-label="账本对应行程" disabled={saving} value={activeItem?.key ?? ''} onChange={(event) => { setShowAll(true); setActiveKey(event.target.value); }}>
        {!activeItem && <option value="">请选择行程</option>}
        {financeItems.map((item) => <option key={item.key} value={item.key}>{item.title} · {item.dates}</option>)}
      </select></label>
      {visibleItems.length ? <div className="finance-journey-grid">{visibleItems.map((item) => {
        const total = item.plan ? sumAmounts(item.plan.budget) : 0;
        const actual = item.plan ? item.plan.manualActualTotal ?? sumAmounts(item.plan.actual) : 0;
        return <button key={item.key} disabled={saving} className={`finance-journey-card ${activeItem?.key === item.key ? 'active' : ''}`} onClick={() => setActiveKey(item.key)}>
          <span className="eyebrow">{item.dates}</span><strong>{item.title}</strong><small>{item.cities}</small>
          <span>预算 {currency(total)} · 已花 {currency(actual)}</span></button>;
      })}</div> : <div className="empty-state"><h2>{city && !showAll ? `还没有${city.name}的旅行` : '还没有可记账的行程'}</h2><p>{city && !showAll ? '新建旅行并选择这座城市后，就能按整次旅程管理预算与花费。' : '先在「我的行程」生成计划，或在「旅行手账」新建旅行，就能开始记账。'}</p></div>}
    </section>

    {draft && activeItem && <>
      {isLegacy && <section className="card legacy-finance"><h2>旧版城市账单</h2><p>这份账单原来按城市保存。选择包含该城市的一次旅行后，预算和花费会一同归入旅程。</p>
        {matchingMoveTargets.length > 0 ? <div className="legacy-move-controls"><select aria-label="选择归入的旅行" value={moveTargetTripId} onChange={(event) => setMoveTargetTripId(event.target.value)}><option value="">选择旅行</option>{matchingMoveTargets.map((trip) => <option key={trip.id} value={trip.id}>{trip.title} · {trip.startDate}</option>)}</select><button className="secondary" disabled={!moveTargetTripId} onClick={() => void moveLegacy()}>归入旅行</button></div>
          : <p className="muted">先新建一段包含这座城市的旅行，之后即可归档。旧账单仍可编辑。</p>}</section>}
      <div className="planner-grid"><section className="card planner-main"><h2>{activeItem.title}</h2>
        <div className="entry-form">{activeJourney ? <div className="journey-finance-dates">旅行时间：{activeJourney.startDate} — {activeJourney.endDate}<small>修改日期请前往旅行手账编辑这次旅行。</small></div> : <><label>出发日期<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label><label>结束日期<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label></>}
          <label>同行人数<input type="number" min="1" step="1" value={draft.people} onChange={(event) => setDraft({ ...draft, people: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label></div>
        <AmountFields title="分类预算" amounts={draft.budget} onChange={(budget) => setDraft({ ...draft, budget })} />
        <DailyLedger
          key={activeItem.key}
          plan={draft}
          startDate={activeJourney?.startDate ?? draft.startDate}
          endDate={activeJourney?.endDate ?? draft.endDate}
          companions={activeJourney?.companions ?? []}
          tripTitle={activeItem.title}
          onChange={setDraft}
        />
      </section><aside className="card planner-summary"><span className="eyebrow">AT A GLANCE</span><h2>费用概览</h2><div className="summary-number"><span>总预算</span><strong>{currency(budgetTotal)}</strong></div><div className="summary-number"><span>人均预算</span><strong>{currency(budgetTotal / Math.max(1, draft.people))}</strong></div><div className="summary-number"><span>实际总额</span><strong>{currency(actualTotal)}</strong></div><div className="summary-number"><span>人均实际</span><strong>{currency(perPerson)}</strong></div>{draft.manualActualTotal !== null && <p className="muted">总额与分类明细差额：{currency(actualTotal - itemizedActual)}</p>}
        <div className="progress-title"><span>预算使用进度</span><strong>{budgetTotal ? `${progress}%` : '尚未设置预算'}</strong></div><div className="progress-track"><div style={{ width: `${Math.min(progress, 100)}%` }} /></div><p className="muted">超过预算时仍显示实际百分比。</p>
      </aside></div>
    </>}
  </div>;
}
