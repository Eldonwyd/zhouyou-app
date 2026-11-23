import { useEffect, useMemo, useState } from 'react';
import { plannerApiUrl } from '../api-base';
import { getPlannerPhotoBlob } from '../db';
import { calculatePlannerBudget, plannerFillEstimates, plannerLocalTransport } from '../planner-domain';
import { plannerDisplayText } from '../planner-display';
import type { AiTravelPlan } from '../planner-types';
import { currency } from '../utils';

/** 优先加载服务端本地图；若服务未启动或离线则回退 IndexedDB 缓存，再失败则展示柔和占位卡而非裂图图标。 */
function PlanCardPhoto({ title, assetId, url }: { title: string; assetId?: string; url?: string }) {
  const primarySrc = assetId ? plannerApiUrl(`photo-file/${assetId}`) : (url ?? '');
  const [src, setSrc] = useState(primarySrc);
  const [triedIdb, setTriedIdb] = useState(false);
  const [failed, setFailed] = useState(!primarySrc);

  useEffect(() => {
    setSrc(primarySrc);
    setTriedIdb(false);
    setFailed(!primarySrc);
  }, [primarySrc]);

  useEffect(() => {
    if (!triedIdb || !assetId) return;
    let active = true;
    let objectUrl = '';
    void getPlannerPhotoBlob(assetId).then((blob) => {
      if (!active) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setFailed(false);
      } else {
        setFailed(true);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [triedIdb, assetId]);

  if (failed || !src) {
    return <span className="planner-card-photo-fallback" title={title}>{title}</span>;
  }
  return <img src={src} alt={title} loading="lazy" onError={() => {
    if (assetId && !triedIdb) setTriedIdb(true);
    else if (url && src !== url) setSrc(url);
    else setFailed(true);
  }} />;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const CATEGORY = [
  ['transport', '交通'], ['lodging', '住宿'], ['tickets', '门票'], ['food', '餐饮'], ['other', '其他'],
] as const;
const shortDate = (date: string) => date.slice(5).replace('-', '/');
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
const yuan = (cents: number) => currency(cents / 100).replace(/\.00$/, '');

/** 行程卡集中展示简介、日期、预算和每日路线，方便在列表里直接对比。 */
export default function PlannerPlanCard({ plan, active, disabled, onSelect }: {
  plan: AiTravelPlan; active: boolean; disabled: boolean; onSelect: () => void;
}) {
  const content = plan.content;
  const request = content.request;
  const budget = useMemo(() => calculatePlannerBudget(plannerFillEstimates(content)), [content]);
  const activities = content.days.flatMap((day) => day.activities);
  const count = (kind: string) => activities.filter((activity) => activity.kind === kind).length;
  const photos = activities
    .map((activity) => activity.photo && { title: activity.title, assetId: activity.photo.assetId, url: activity.photo.url })
    .filter((photo): photo is { title: string; assetId: string | undefined; url: string } => Boolean(photo && (photo.assetId || photo.url)))
    .slice(0, 4);
  const people = Math.max(1, request.people || 1);
  const travelers = [
    `${request.people} 人`,
    request.students ? `${request.students} 学生` : '',
    request.seniors ? `${request.seniors} 老人` : '',
    request.children ? `${request.children} 儿童` : '',
  ].filter(Boolean).join(' · ');
  const preferences = [request.pace, plannerLocalTransport(request.transport), request.lodgingLevel && `住${request.lodgingLevel}`].filter(Boolean);
  const budgetDiff = request.budgetCents ? request.budgetCents - budget.totalCents : null;
  const shownDays = content.days.slice(0, 7);
  const first = content.days[0].date;
  const last = content.days.at(-1)!.date;

  return (
    <button type="button" className={`planner-plan-card${active ? ' active' : ''}`} aria-current={active || undefined} disabled={disabled} onClick={onSelect}>
      <span className="planner-card-main">
        <span className="planner-plan-cities">
          {content.cities.map((city) => city.name).join(' → ') || request.destination}
        </span>
        <strong className="planner-card-title">{content.title}</strong>
        {content.summary?.trim() && (
          <span className="planner-card-summary">{plannerDisplayText(content.summary, content)}</span>
        )}
        <span className="planner-plan-meta">
          <span>{shortDate(first)} {weekday(first)} – {shortDate(last)} {weekday(last)}</span>
          <span>{content.days.length} 天</span>
          <span>{travelers}</span>
          {preferences.map((item) => <span key={item}>{item}</span>)}
        </span>
        <span className="planner-card-stats">
          <span><b>{count('sight')}</b>景点</span>
          <span><b>{count('food')}</b>餐饮</span>
          <span><b>{count('transport')}</b>交通</span>
          <span><b>{activities.filter((activity) => activity.locked).length}</b>已锁定</span>
          <span><b>{content.sources.length}</b>资料来源</span>
        </span>
        <span className="planner-card-budget">
          <span className="planner-card-price">
            <span className="planner-plan-price">{yuan(budget.totalCents)}</span>
            <small>人均 {yuan(Math.round(budget.totalCents / people))}</small>
            {budgetDiff !== null && (
              <small className={budgetDiff >= 0 ? 'planner-card-under' : 'planner-card-over'}>
                {budgetDiff >= 0 ? `低于预算 ${yuan(budgetDiff)}` : `超出预算 ${yuan(-budgetDiff)}`}
              </small>
            )}
          </span>
          {budget.totalCents > 0 && (
            <span className="planner-card-bar" aria-label="花费构成">
              {CATEGORY.map(([key, label]) => budget.categories[key] > 0 && (
                <span key={key} className={`planner-card-bar-${key}`} style={{ flexGrow: budget.categories[key] }}
                  title={`${label} ${yuan(budget.categories[key])}`} />
              ))}
            </span>
          )}
          <span className="planner-card-legend">
            {CATEGORY.filter(([key]) => budget.categories[key] > 0).map(([key, label]) => (
              <span key={key}><i className={`planner-card-bar-${key}`} />{label} {yuan(budget.categories[key])}</span>
            ))}
          </span>
        </span>
        <span className="planner-card-foot">
          <small>更新于 {plan.updatedAt.slice(0, 10)}</small>
          {plan.linkedTripId && <em>已加入记录</em>}
        </span>
      </span>
      <span className="planner-card-side">
        {photos.length > 0 && (
          <span className={`planner-card-photos n${photos.length}`}>
            {photos.map((photo, index) => <PlanCardPhoto key={`${photo.assetId ?? photo.url ?? index}`} title={photo.title} assetId={photo.assetId} url={photo.url} />)}
          </span>
        )}
        <span className="planner-card-days">
          {shownDays.map((day, index) => (
            <span key={day.date} className="planner-card-day">
              <b>D{index + 1}</b>
              <small>{shortDate(day.date)}</small>
              <span>{day.title || day.activities.filter((activity) => activity.kind === 'sight').map((activity) => activity.title).slice(0, 3).join('、')}</span>
            </span>
          ))}
          {content.days.length > shownDays.length && <small className="planner-card-more">还有 {content.days.length - shownDays.length} 天…</small>}
        </span>
      </span>
    </button>
  );
}
