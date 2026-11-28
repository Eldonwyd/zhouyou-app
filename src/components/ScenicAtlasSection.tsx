import { useEffect, useMemo, useRef, useState } from 'react';
import type { CityMark, DayEntry, JourneyPlace } from '../types';
import type { AiTravelPlan } from '../planner-types';
import {
  readScenicManualMap,
  resolveScenicProgress,
  SCENIC_MANUAL_CHANGED_EVENT,
  toggleScenicManualVisit,
  type ScenicCategory,
  type ScenicManualMap,
  type ScenicVisitInfo,
} from '../scenic-atlas';
import { provinceColor } from '../map-data';
import { useI18n } from '../i18n';

interface ScenicAtlasSectionProps {
  marks: CityMark[];
  aiPlans?: AiTravelPlan[];
  places?: JourneyPlace[];
  entries?: DayEntry[];
  focusProvinceCode?: string | null;
  focusProvinceToken?: number;
  onNotice?: (message: string) => void;
}

type AtlasTab = '5a' | 'heritage';
type HeritageSubFilter = 'all' | 'heritage-cultural' | 'heritage-natural' | 'heritage-mixed';
type VisitFilter = 'all' | 'visited' | 'unvisited' | 'my-provinces';

function pct(visited: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((visited / total) * 1000) / 10);
}

function categoryLabel(cat: ScenicCategory, isEn: boolean): string {
  if (cat === '5a') return '5A';
  if (cat === 'heritage-cultural') return isEn ? 'Cultural' : '文化遗产';
  if (cat === 'heritage-natural') return isEn ? 'Natural' : '自然遗产';
  return isEn ? 'Mixed' : '双遗产';
}

function matchSourceLabel(from: ScenicVisitInfo['matchedFrom'], isEn: boolean): string {
  if (from === 'plan') return isEn ? 'Auto · Trip' : '行程自动点亮';
  if (from === 'ticket') return isEn ? 'Auto · Ticket' : '票根自动点亮';
  return isEn ? 'Auto · Journal' : '手账自动点亮';
}

export default function ScenicAtlasSection({
  marks,
  aiPlans = [],
  places = [],
  entries = [],
  focusProvinceCode = null,
  focusProvinceToken = 0,
  onNotice,
}: ScenicAtlasSectionProps) {
  const { isEn, t } = useI18n();
  const [manual, setManual] = useState<ScenicManualMap>(() => readScenicManualMap());
  const [tab, setTab] = useState<AtlasTab>('5a');
  const [heritageSub, setHeritageSub] = useState<HeritageSubFilter>('all');
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('all');
  const [query, setQuery] = useState('');
  const [expandedProvinces, setExpandedProvinces] = useState<Record<string, boolean>>({});
  const sectionRef = useRef<HTMLElement>(null);
  const provRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const sync = () => setManual(readScenicManualMap());
    window.addEventListener(SCENIC_MANUAL_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SCENIC_MANUAL_CHANGED_EVENT, sync);
  }, []);

  const report = useMemo(
    () => resolveScenicProgress({ aiPlans, places, entries, manual }),
    [aiPlans, places, entries, manual],
  );

  const visitedProvinceSet = useMemo(
    () => new Set(marks.filter((m) => m.visited).map((m) => String(m.provinceCode || ''))),
    [marks],
  );

  // 从地图页点击某省名胜进度卡跳转时，自动展开对应省份并平滑滚动过去
  useEffect(() => {
    if (!focusProvinceCode) return;
    setVisitFilter('all');
    setQuery('');
    const prov = report.byProvince.get(focusProvinceCode);
    if (prov && prov.fiveATotal === 0 && prov.heritageTotal > 0) {
      setTab('heritage');
      setHeritageSub('all');
    } else {
      setTab('5a');
    }
    setExpandedProvinces((prev) => ({ ...prev, [focusProvinceCode]: true }));
    const timer = window.setTimeout(() => {
      const target = provRefs.current[focusProvinceCode] ?? sectionRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusProvinceCode, focusProvinceToken, report.byProvince]);

  const filteredProvinces = useMemo(() => {
    const q = query.trim().toLowerCase();
    return report.provinces
      .map((prov) => {
        if (visitFilter === 'my-provinces' && !visitedProvinceSet.has(prov.provinceCode)) {
          return null;
        }
        const inTab = prov.spots.filter((item) => {
          if (tab === '5a') return item.spot.category === '5a';
          if (heritageSub === 'all') return item.spot.category !== '5a';
          return item.spot.category === heritageSub;
        });
        if (!inTab.length) return null;

        const matchingSpots = inTab.filter((item) => {
          if (visitFilter === 'visited' && !item.visited) return false;
          if (visitFilter === 'unvisited' && item.visited) return false;
          if (!q) return true;
          const hay = [
            item.spot.name,
            item.spot.provinceName,
            item.spot.city ?? '',
            ...(item.spot.aliases ?? []),
          ].join(' ').toLowerCase();
          return hay.includes(q);
        });
        if (!matchingSpots.length) return null;

        const visitedInTab = inTab.filter((i) => i.visited).length;
        const autoInTab = inTab.filter((i) => i.visited && i.source === 'auto').length;
        return {
          provinceCode: prov.provinceCode,
          provinceName: prov.provinceName,
          totalInTab: inTab.length,
          visitedInTab,
          autoInTab,
          spots: matchingSpots,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [report.provinces, tab, heritageSub, visitFilter, visitedProvinceSet, query]);

  const fiveAPct = pct(report.totals.fiveA.visited, report.totals.fiveA.total);
  const whAllPct = pct(report.totals.heritageAll.visited, report.totals.heritageAll.total);
  const whCultPct = pct(report.totals.heritageCultural.visited, report.totals.heritageCultural.total);
  const whNatPct = pct(report.totals.heritageNatural.visited, report.totals.heritageNatural.total);
  const whMixPct = pct(report.totals.heritageMixed.visited, report.totals.heritageMixed.total);

  function handleToggleSpot(info: ScenicVisitInfo) {
    const nextVisited = !info.visited;
    setManual(toggleScenicManualVisit(info.spot.id, nextVisited));
    onNotice?.(
      nextVisited
        ? t(`已点亮「${info.spot.name}」`, `Marked "${info.spot.name}" as visited`)
        : t(`已取消「${info.spot.name}」的打卡标记`, `Unmarked "${info.spot.name}"`),
    );
  }

  return (
    <section
      className="card scenic-atlas-section"
      id="scenic-atlas-section"
      ref={sectionRef}
      aria-label={t('名胜图鉴与景区收集', 'Scenic Atlas & Heritage Collection')}
    >
      <div className="card-heading scenic-atlas-heading">
        <div>
          <span className="eyebrow">SCENIC ATLAS</span>
          <h2>{t('名胜图鉴 · 5A 与世界遗产', 'Scenic Atlas · 5A & World Heritage')}</h2>
          <p className="muted">
            {t(
              '自动识别已结束行程、旅行手账与票根中的 5A 景区和世界文化/自然遗产；点击任意名胜也可手动点亮。',
              'Automatically recognizes 5A sites & UNESCO World Heritage from past trips, journal, and tickets. Tap any site to toggle.',
            )}
          </p>
        </div>
        <span className="scenic-atlas-total-pill">
          {t(
            `已收集 ${report.totals.fiveA.visited + report.totals.heritageAll.visited} 处`,
            `${report.totals.fiveA.visited + report.totals.heritageAll.visited} collected`,
          )}
        </span>
      </div>

      {/* 顶部双进度总览卡 */}
      <div className="scenic-progress-grid">
        <div className={`scenic-progress-card is-5a${tab === '5a' ? ' is-active' : ''}`} onClick={() => setTab('5a')}>
          <div className="scenic-progress-head">
            <span className="scenic-progress-badge is-5a">5A</span>
            <div className="scenic-progress-title">
              <strong>{t('国家 5A 级景区', 'China 5A Scenic Spots')}</strong>
              <small>{t('全国精选名录 · 按省收集', 'Curated nationwide by province')}</small>
            </div>
            <span className="scenic-progress-num">
              <b>{report.totals.fiveA.visited}</b>
              <em> / {report.totals.fiveA.total}</em>
              <i>{fiveAPct}%</i>
            </span>
          </div>
          <div className="scenic-progress-track" aria-hidden="true">
            <span className="scenic-progress-fill is-5a" style={{ width: `${fiveAPct}%` }} />
          </div>
        </div>

        <div className={`scenic-progress-card is-heritage${tab === 'heritage' ? ' is-active' : ''}`} onClick={() => setTab('heritage')}>
          <div className="scenic-progress-head">
            <span className="scenic-progress-badge is-heritage">遗产</span>
            <div className="scenic-progress-title">
              <strong>{t('中国世界遗产', 'UNESCO World Heritage')}</strong>
              <small>{t('文化遗产 · 自然遗产 · 双遗产', 'Cultural · Natural · Mixed')}</small>
            </div>
            <span className="scenic-progress-num">
              <b>{report.totals.heritageAll.visited}</b>
              <em> / {report.totals.heritageAll.total}</em>
              <i>{whAllPct}%</i>
            </span>
          </div>
          <div className="scenic-progress-track" aria-hidden="true">
            <span className="scenic-progress-fill is-heritage" style={{ width: `${whAllPct}%` }} />
          </div>
          <div className="scenic-heritage-subbars">
            <div className="scenic-subbar">
              <div className="scenic-subbar-row">
                <span>{t('文化遗产', 'Cultural')}</span>
                <b>{report.totals.heritageCultural.visited}/{report.totals.heritageCultural.total}</b>
              </div>
              <div className="scenic-mini-track"><span className="is-cultural" style={{ width: `${whCultPct}%` }} /></div>
            </div>
            <div className="scenic-subbar">
              <div className="scenic-subbar-row">
                <span>{t('自然遗产', 'Natural')}</span>
                <b>{report.totals.heritageNatural.visited}/{report.totals.heritageNatural.total}</b>
              </div>
              <div className="scenic-mini-track"><span className="is-natural" style={{ width: `${whNatPct}%` }} /></div>
            </div>
            <div className="scenic-subbar">
              <div className="scenic-subbar-row">
                <span>{t('双遗产', 'Mixed')}</span>
                <b>{report.totals.heritageMixed.visited}/{report.totals.heritageMixed.total}</b>
              </div>
              <div className="scenic-mini-track"><span className="is-mixed" style={{ width: `${whMixPct}%` }} /></div>
            </div>
          </div>
        </div>
      </div>

      {/* 切换栏与筛选 */}
      <div className="scenic-toolbar">
        <div className="scenic-tabs" role="tablist" aria-label={t('名胜分类', 'Scenic category')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === '5a'}
            className={tab === '5a' ? 'active' : ''}
            onClick={() => setTab('5a')}
          >
            {t('国家 5A 景区', '5A Spots')} <span>{report.totals.fiveA.visited}/{report.totals.fiveA.total}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'heritage'}
            className={tab === 'heritage' ? 'active' : ''}
            onClick={() => setTab('heritage')}
          >
            {t('世界遗产', 'World Heritage')} <span>{report.totals.heritageAll.visited}/{report.totals.heritageAll.total}</span>
          </button>
        </div>

        <div className="scenic-filters">
          {tab === 'heritage' && (
            <div className="scenic-chip-group">
              {([
                ['all', t('全部遗产', 'All')],
                ['heritage-cultural', t('文化遗产', 'Cultural')],
                ['heritage-natural', t('自然遗产', 'Natural')],
                ['heritage-mixed', t('双遗产', 'Mixed')],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`scenic-filter-chip${heritageSub === key ? ' active' : ''}`}
                  onClick={() => setHeritageSub(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="scenic-chip-group">
            {([
              ['all', t('全部', 'All')],
              ['visited', t('已打卡', 'Visited')],
              ['unvisited', t('未打卡', 'Unvisited')],
              ['my-provinces', t('我去过的省', 'My Provinces')],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`scenic-filter-chip${visitFilter === key ? ' active' : ''}`}
                onClick={() => setVisitFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="scenic-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜景区、遗产或省份…', 'Search site or province…')}
            aria-label={t('搜索名胜景区', 'Search scenic spots')}
          />
        </div>
      </div>

      {/* 按省折叠清单 */}
      {filteredProvinces.length > 0 ? (
        <div className="scenic-province-list">
          {filteredProvinces.map((prov) => {
            const isOpen = Boolean(expandedProvinces[prov.provinceCode] || query.trim() || focusProvinceCode === prov.provinceCode);
            const provPct = pct(prov.visitedInTab, prov.totalInTab);
            const accent = provinceColor(prov.provinceCode);
            return (
              <div
                key={prov.provinceCode}
                ref={(el) => { provRefs.current[prov.provinceCode] = el; }}
                className={`scenic-province-card${isOpen ? ' is-open' : ''}${focusProvinceCode === prov.provinceCode ? ' is-focused' : ''}`}
              >
                <button
                  type="button"
                  className="scenic-province-row"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setExpandedProvinces((prev) => ({
                      ...prev,
                      [prov.provinceCode]: !isOpen,
                    }))
                  }
                >
                  <span className="scenic-prov-name">
                    <i className="scenic-prov-dot" style={{ background: accent }} />
                    <strong>{prov.provinceName}</strong>
                    {prov.autoInTab > 0 && (
                      <em className="scenic-auto-pill">{t(`自动识别 ${prov.autoInTab}`, `Auto ${prov.autoInTab}`)}</em>
                    )}
                  </span>
                  <span className="scenic-prov-progress">
                    <span className="scenic-prov-track" aria-hidden="true">
                      <span style={{ width: `${provPct}%`, background: accent }} />
                    </span>
                    <small>{prov.visitedInTab} / {prov.totalInTab}</small>
                    <svg className="scenic-prov-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4.2 6.2 8 10l3.8-3.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                {isOpen && (
                  <div className="scenic-spot-grid">
                    {prov.spots.map((info) => (
                      <button
                        key={info.spot.id}
                        type="button"
                        className={`scenic-spot-pill${info.visited ? ' is-visited' : ''}${info.source === 'auto' ? ' is-auto' : ''}`}
                        onClick={() => handleToggleSpot(info)}
                        title={
                          info.visited
                            ? (info.source === 'auto'
                              ? `${matchSourceLabel(info.matchedFrom, isEn)}${info.date ? ` · ${info.date}` : ''}（点击可取消）`
                              : t('已手动点亮（点击可取消）', 'Manually marked (tap to unmark)'))
                            : t('点击点亮此名胜', 'Tap to mark visited')
                        }
                      >
                        <span className="scenic-spot-top">
                          <span className="scenic-spot-check" aria-hidden="true">{info.visited ? '✓' : '＋'}</span>
                          <span className="scenic-spot-name">{info.spot.name}</span>
                        </span>
                        <span className="scenic-spot-meta">
                          <span className={`scenic-cat-tag is-${info.spot.category}`}>
                            {categoryLabel(info.spot.category, isEn)}
                          </span>
                          {info.spot.city && <small>{info.spot.city}</small>}
                          {info.visited && info.source === 'auto' && (
                            <em className="scenic-spot-origin">{matchSourceLabel(info.matchedFrom, isEn)}</em>
                          )}
                          {info.visited && info.source === 'manual' && (
                            <em className="scenic-spot-origin is-manual">{t('手动点亮', 'Manual')}</em>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="scenic-empty">
          {t('当前筛选条件下暂无名胜记录，试试切换「全部」或搜索其他关键词。', 'No matching sites for this filter. Try switching to All or clearing search.')}
        </div>
      )}
    </section>
  );
}
