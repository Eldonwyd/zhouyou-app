import { useEffect, useRef, useState } from 'react';
import type { Badge, CityMark, DayEntry, Journey, TravelMedia } from '../types';
import { TravelCover, TravelIcon } from './TravelArt';
import { AchievementBadgeArt, CuteSticker, HighlightEmptyArt, getTravelerLevel } from './CuteArt';
import { createLocalId, downloadBlob } from '../utils';
import { themeColor } from '../theme';
import { useI18n, type AppLanguage } from '../i18n';
import type { TourRestrictedFeature } from '../web-tour';
import { RELATION_META, type IntimacyBond } from '../cloud-api';
import { AchievementsTicketShowcase } from './TicketWalletView';

// 每站沿用应用内的旅行图标，等级数超过现有图标时仍可显示默认地图图标。
const travelerStopIcons = ['leaf', 'detail', 'map', 'camera', 'mountain', 'train', 'sun', 'plane'];

interface AchievementsViewProps {
  marks: CityMark[];
  entries: DayEntry[];
  trips: Journey[];
  media: TravelMedia[];
  badges: Badge[];
  intimacyBonds?: IntimacyBond[];
  onSaveBadge: (badge: Badge) => Promise<void>;
  onOpenEntry: (entry: DayEntry) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  webTourMode?: boolean;
  onRequireClient?: (feature: TourRestrictedFeature) => void;
}

interface PresetBadgeSpec {
  id: string;
  title: string;
  symbol: string;
  threshold: number;
  unit: string;
  hint: string;
  current: number;
}

async function drawBadgePoster(title: string, symbol: string, image: Blob | null, lang: AppLanguage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(lang === 'en' ? 'Unable to generate poster in this browser' : '当前浏览器无法生成海报');
  const paper = themeColor('--paper', '#fff8f2');
  const surface = themeColor('--surface', '#ffffff');
  const accent = themeColor('--warm-green', '#eb6b56');
  const soft = themeColor('--app-sage', '#ffe8cf');
  const ink = themeColor('--ink', '#3c2e2a');
  const muted = themeColor('--muted', '#8a7670');
  const line = themeColor('--line-strong', '#ecd8ca');

  context.fillStyle = paper;
  context.fillRect(0, 0, 900, 1200);

  const drawRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
  };
  context.fillStyle = surface;
  drawRoundRect(68, 68, 764, 1064, 48);
  context.fill();
  context.strokeStyle = line;
  context.lineWidth = 4;
  context.stroke();

  context.fillStyle = soft;
  drawRoundRect(108, 108, 684, 596, 36);
  context.fill();

  if (image) {
    const bitmap = await createImageBitmap(image);
    context.save();
    context.beginPath();
    context.arc(450, 406, 224, 0, Math.PI * 2);
    context.clip();
    const scale = Math.max(448 / bitmap.width, 448 / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    context.drawImage(bitmap, 450 - dw / 2, 406 - dh / 2, dw, dh);
    context.restore();
    bitmap.close();
    context.beginPath();
    context.arc(450, 406, 224, 0, Math.PI * 2);
    context.strokeStyle = surface;
    context.lineWidth = 14;
    context.stroke();
  } else {
    context.beginPath();
    context.arc(450, 406, 178, 0, Math.PI * 2);
    context.fillStyle = surface;
    context.fill();
    context.strokeStyle = line;
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = accent;
    context.font = '180px serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(symbol, 450, 418);
  }

  context.textBaseline = 'alphabetic';
  context.fillStyle = ink;
  context.textAlign = 'center';
  context.font = '700 62px "PingFang SC", "Microsoft YaHei UI", sans-serif';
  context.fillText(title.slice(0, 12), 450, 825);

  context.strokeStyle = line;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(350, 886);
  context.lineTo(550, 886);
  context.stroke();

  context.fillStyle = muted;
  context.font = '28px "PingFang SC", "Microsoft YaHei UI", sans-serif';
  context.fillText(lang === 'en' ? 'Zhouyou Map · Travel Commemorative Badge' : '旅行足迹 · 我的旅途纪念章', 450, 962);

  context.fillStyle = accent;
  context.font = '600 22px "PingFang SC", "Microsoft YaHei UI", sans-serif';
  context.fillText(new Date().toISOString().slice(0, 10), 450, 1020);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(lang === 'en' ? 'Failed to generate poster' : '海报生成失败');
  return blob;
}

function CustomBadgeCard({
  badge,
  onShare,
  onOpenEntry,
  linkedEntry,
}: {
  badge: Badge;
  onShare: () => void;
  onOpenEntry: (entry: DayEntry) => void;
  linkedEntry?: DayEntry;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!badge.image) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(badge.image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [badge.image]);

  return (
    <div className="badge-card custom-badge-card">
      <span className="badge-status-pill is-custom">{t('专属手作', 'Custom')}</span>
      <div className="badge-art custom-badge-art">{url ? <img src={url} alt="" /> : '✧'}</div>
      <h3>{badge.title}</h3>
      <p>{t('自己收藏的特别纪念章', 'Your custom travel keepsake')}</p>
      <div className="badge-actions">
        <button className="text-button" onClick={onShare}>{t('生成海报', 'Poster')}</button>
        {linkedEntry && <button className="text-button" onClick={() => onOpenEntry(linkedEntry)}>{t('查看高光', 'View Highlight')}</button>}
      </div>
    </div>
  );
}

/** Date strings are expanded in UTC so overlapping journeys count each day once. */
function uniqueTravelDates(trips: Journey[], entries: DayEntry[]): string[] {
  const days = new Set<string>();
  for (const trip of trips) {
    const start = Date.parse(`${trip.startDate}T00:00:00Z`);
    const end = Date.parse(`${trip.endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    for (let cursor = start, count = 0; cursor <= end && count < 3660; cursor += 86_400_000, count += 1) {
      days.add(new Date(cursor).toISOString().slice(0, 10));
    }
  }
  for (const entry of entries) if (entry.tripId === null) days.add(entry.date);
  return [...days].sort();
}

export default function AchievementsView({
  marks,
  entries,
  trips,
  media,
  badges,
  intimacyBonds = [],
  onSaveBadge,
  onOpenEntry,
  onError,
  onNotice,
  webTourMode = false,
  onRequireClient,
}: AchievementsViewProps) {
  const { lang, isEn, t } = useI18n();
  const [title, setTitle] = useState('');
  const [linkedEntryId, setLinkedEntryId] = useState('');
  const [imageName, setImageName] = useState('');
  const [roadmapExpanded, setRoadmapExpanded] = useState(false);
  const [badgeWallExpanded, setBadgeWallExpanded] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const visited = marks.filter((mark) => mark.visited);
  const visitedProvinces = new Set(visited.map((mark) => mark.provinceCode).filter(Boolean));
  const completedTrips = trips.filter((trip) => trip.status !== 'planned');
  const dates = uniqueTravelDates(completedTrips, entries);
  const travelDays = dates.length;
  const yearly = Object.entries(dates.reduce<Record<string, number>>((counts, date) => {
    counts[date.slice(0, 4)] = (counts[date.slice(0, 4)] || 0) + 1;
    return counts;
  }, {})).sort(([yearA], [yearB]) => yearB.localeCompare(yearA));
  const highlights = entries.filter((entry) => entry.highlight);
  const photoCount = media.filter((item) => item.kind === 'photo').length;
  const videoCount = media.filter((item) => item.kind === 'video').length;
  const audioCount = media.filter((item) => item.kind === 'audio').length;
  const companionTrips = completedTrips.filter((trip) => trip.companions.length > 0).length;

  const levelInfo = getTravelerLevel(visited.length, travelDays, lang);

  const presetBadges: PresetBadgeSpec[] = [
    { id: 'first-trip', title: t('初次出发', 'First Departure'), symbol: '✦', threshold: 1, unit: t('城', ' cities'), hint: t('点亮第 1 座城市', 'Light up your 1st city'), current: visited.length },
    { id: 'five-cities', title: t('五城玩家', 'Five-City Explorer'), symbol: '✺', threshold: 5, unit: t('城', ' cities'), hint: t('走过 5 座不同城市', 'Visit 5 different cities'), current: visited.length },
    { id: 'ten-cities', title: t('十城收藏家', 'Ten-City Collector'), symbol: '◆', threshold: 10, unit: t('城', ' cities'), hint: t('足迹覆盖 10 座城市', 'Cover 10 cities on the map'), current: visited.length },
    { id: 'province-hopper', title: t('跨省达人', 'Province Hopper'), symbol: '❖', threshold: 3, unit: t('省', ' provinces'), hint: t('足迹跨越 3 个省份', 'Travel across 3 provinces'), current: visitedProvinces.size },
    { id: 'photo-lover', title: t('镜头捕手', 'Shutterbug'), symbol: '◎', threshold: 10, unit: t('张', ' photos'), hint: t('珍藏 10 张旅途照片', 'Save 10 travel photos'), current: photoCount },
    { id: 'voice-keeper', title: t('声音日记本', 'Voice Keeper'), symbol: '♪', threshold: 1, unit: t('段', ' clip'), hint: t('录下 1 段旅途语音', 'Record 1 voice memo'), current: audioCount },
    { id: 'highlight-hunter', title: t('高光猎人', 'Highlight Hunter'), symbol: '★', threshold: 3, unit: t('篇', ' highlights'), hint: t('收藏 3 个高光时刻', 'Bookmark 3 highlights'), current: highlights.length },
    { id: 'companion-joy', title: t('结伴同行', 'Travel Buddies'), symbol: '♥', threshold: 1, unit: t('次', ' trip'), hint: t('记录 1 次同行旅程', 'Log 1 trip with companions'), current: companionTrips },
    { id: 'long-wanderer', title: t('漫游时光', 'Weeklong Wanderer'), symbol: '☀', threshold: 7, unit: t('天', ' days'), hint: t('累计旅行达到 7 天', 'Reach 7 total travel days'), current: travelDays },
  ];

  const unlockedPresetCount = presetBadges.filter((badge) => badge.current >= badge.threshold).length;

  async function createBadge(): Promise<void> {
    if (!title.trim()) { onError(t('请填写徽章名称', 'Please enter a badge name')); return; }
    const image = imageInputRef.current?.files?.[0] ?? null;
    try {
      await onSaveBadge({
        id: createLocalId(),
        title: title.trim(),
        linkedEntryId: linkedEntryId || null,
        image,
        createdAt: new Date().toISOString(),
      });
      setTitle('');
      setLinkedEntryId('');
      setImageName('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      onNotice(t('专属徽章已创建。', 'Custom badge created.'));
    } catch (error) { onError(error instanceof Error ? error.message : t('徽章保存失败', 'Failed to save badge')); }
  }

  async function shareBadge(badgeTitle: string, symbol: string, image: Blob | null): Promise<void> {
    try {
      downloadBlob(
        await drawBadgePoster(badgeTitle, symbol, image, lang),
        isEn ? `${badgeTitle}-travel-badge.png` : `${badgeTitle}-旅行徽章.png`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : t('海报生成失败', 'Failed to generate poster'));
    }
  }

  function showBadgeCreator(): void {
    const creator = document.getElementById('badge-creator');
    // 先把键盘焦点移到表单，再滚动，避免窄屏上从页首继续按 Tab。
    creator?.focus({ preventScroll: true });
    creator?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }

  return (
    <div className="content-page warm-achievements">
      <div className="section-heading">
        <div>
          <h1>{t('旅途成就', 'Travel Achievements')}</h1>
          <p>{t('走过的每一站，都在悄悄攒成亮晶晶的纪念印章。', 'Every stop along the way turns into a shiny commemorative stamp.')}</p>
        </div>
        <button
          type="button"
          className="primary desktop-badge-create"
          onClick={showBadgeCreator}
        >
          {t('＋ 手作一枚纪念章', '+ Craft a Custom Badge')}
        </button>
      </div>

      {/* 旅人等级护照卡片 */}
      <section className="passport-hero-card">
        <span className="washi-tape tape-top-right" aria-hidden="true" />
        <CuteSticker kind="sparkle" className="passport-sparkle" />
        <div className="passport-hero-top">
          <div className="passport-level-copy">
            <div className="passport-level-badges">
              <span className="level-pill">Lv.{levelInfo.level} / {levelInfo.maxLevel} · {levelInfo.title}</span>
              <span className="stamp-counter-pill">{t(`已集章 ${unlockedPresetCount + badges.length} 枚`, `${unlockedPresetCount + badges.length} Stamps`)}</span>
            </div>
            <h2 className="passport-desktop-intro">{t('走过的路，每一站都闪闪发光。', 'Every stop you visit shines bright.')}</h2>
            <p className="passport-desktop-intro">{levelInfo.subtitle}</p>
            {/* 手机把当前称号作为主要信息，保留等级徽章与罗盘角标，沿用桌面进度条。 */}
            <div className="passport-mobile-level">
              <div className="passport-mobile-level-main">
                <div className="passport-mobile-badges">
                  <span className="level-pill passport-mobile-level-number">Lv.{levelInfo.level} / {levelInfo.maxLevel}</span>
                  <span className="stamp-counter-pill">{t(`已集章 ${unlockedPresetCount + badges.length} 枚`, `${unlockedPresetCount + badges.length} Stamps`)}</span>
                </div>
                <h2>{levelInfo.title}</h2>
                <p className="passport-mobile-subtitle">{levelInfo.subtitle}</p>
              </div>
              <div className="passport-emblem-box passport-mobile-emblem" aria-hidden="true">
                <CuteSticker kind="compass" className="passport-compass-icon" />
                <div className="passport-fallback-icon">
                  <TravelIcon name="mountain" />
                </div>
              </div>
            </div>
            <div className="passport-xp-wrap">
              <div className="passport-xp-head">
                <strong>
                  {levelInfo.nextTarget !== null
                    ? t(
                      `再点亮 ${levelInfo.remainingCities} 座城市 → 升级 Lv.${levelInfo.level + 1} ${levelInfo.nextTitle}`,
                      `Light ${levelInfo.remainingCities} more ${levelInfo.remainingCities === 1 ? 'city' : 'cities'} → Lv.${levelInfo.level + 1} ${levelInfo.nextTitle}`,
                    )
                    : t(
                      `已达成满级 Lv.${levelInfo.maxLevel} ${levelInfo.title} ✦`,
                      `Max Level Reached: Lv.${levelInfo.maxLevel} ${levelInfo.title} ✦`,
                    )}
                </strong>
                <span className="passport-xp-nums">
                  {levelInfo.nextTarget !== null
                    ? t(`${levelInfo.visitedCities} / ${levelInfo.nextTarget} 城（${levelInfo.progressPct}%）`, `${levelInfo.visitedCities} / ${levelInfo.nextTarget} (${levelInfo.progressPct}%)`)
                    : t(`已点亮 ${levelInfo.visitedCities} 城 · 100%`, `${levelInfo.visitedCities} cities · 100%`)}
                </span>
              </div>
              <div className="passport-mobile-progress">
                <strong>{levelInfo.nextTarget !== null ? t(`下一站 · Lv.${levelInfo.level + 1} ${levelInfo.nextTitle}`, `Next · Lv.${levelInfo.level + 1} ${levelInfo.nextTitle}`) : t('已达成满级', 'Max Level')}</strong>
                {levelInfo.nextTarget !== null && <span>{t(`还差 ${levelInfo.remainingCities} 城`, `${levelInfo.remainingCities} to go`)}</span>}
              </div>
              <div className="passport-xp-track" role="progressbar" aria-valuenow={levelInfo.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={t('旅人等级进度', 'Traveler level progress')}>
                <span style={{ width: `${Math.max(levelInfo.progressPct, levelInfo.visitedCities > 0 ? 4 : 0)}%` }} />
              </div>
            </div>
          </div>
          <div className="passport-emblem-box">
            <CuteSticker kind="compass" className="passport-compass-icon" />
            <div className="passport-fallback-icon">
              <TravelIcon name="mountain" />
            </div>
          </div>
        </div>

        <section className="level-roadmap" aria-labelledby="traveler-roadmap-title" data-expanded={roadmapExpanded}>
          <div className="level-roadmap-head">
            <span className="level-roadmap-icon"><TravelIcon name="map" /></span>
            <h3 id="traveler-roadmap-title">{t('旅人成长路线', 'Traveler Roadmap')}</h3>
            <span className="level-roadmap-progress-pill">
              Lv.{levelInfo.level} / {levelInfo.maxLevel}
            </span>
            <button
              type="button"
              className="level-roadmap-toggle"
              aria-expanded={roadmapExpanded}
              aria-controls="traveler-roadmap-steps"
              onClick={() => setRoadmapExpanded((expanded) => !expanded)}
            >
              {roadmapExpanded ? t('收起', 'Collapse') : t(`查看全部 ${levelInfo.maxLevel} 级`, `View all ${levelInfo.maxLevel} tiers`)}
              <span aria-hidden="true" />
            </button>
          </div>
          {!roadmapExpanded && (
            <div
              className="level-roadmap-mini-preview"
              onClick={() => setRoadmapExpanded(true)}
              role="presentation"
            >
              <span className="roadmap-mini-node is-current" data-tier={levelInfo.level}>
                <span className="roadmap-mini-icon"><TravelIcon name={travelerStopIcons[levelInfo.level - 1] ?? 'map'} /></span>
                <span className="roadmap-mini-copy">
                  <b>Lv.{levelInfo.level}</b> {levelInfo.title}
                </span>
                <em className="roadmap-mini-tag">{t('当前', 'Now')}</em>
              </span>
              <span className="roadmap-mini-rail" />
              {levelInfo.nextTitle ? (
                <span className="roadmap-mini-node is-next" data-tier={levelInfo.level + 1}>
                  <span className="roadmap-mini-icon"><TravelIcon name={travelerStopIcons[levelInfo.level] ?? 'map'} /></span>
                  <span className="roadmap-mini-copy">
                    <b>Lv.{levelInfo.level + 1}</b> {levelInfo.nextTitle}
                  </span>
                  <em className="roadmap-mini-tag">{t('下一站', 'Next')}</em>
                </span>
              ) : (
                <span className="roadmap-mini-node is-done">{t('✦ 已达成满级', '✦ Max Level')}</span>
              )}
            </div>
          )}
          {/* 桌面端与移动端统一默认折叠为当前→下一站紧凑条，点击展开完整 8 级多彩路线。 */}
          <ol id="traveler-roadmap-steps" className="level-roadmap-steps" role="list" data-expanded={roadmapExpanded}>
            {levelInfo.tiers.map((tier) => {
              // 用同一套等级结果标记已达成、当前与下一站，满级时自然没有下一站。
              const isCurrent = tier.level === levelInfo.level;
              const isReached = tier.level < levelInfo.level;
              const isNext = tier.level === levelInfo.level + 1;
              const status = isCurrent ? 'current' : isReached ? 'reached' : isNext ? 'next' : 'upcoming';
              return (
                <li
                  key={tier.level}
                  data-tier={tier.level}
                  className={`level-step is-${status}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <div className="level-step-marker">
                    <TravelIcon name={travelerStopIcons[tier.level - 1] ?? 'map'} />
                    {isReached && <span className="level-step-check" role="img" aria-label={t('已达成', 'Reached')}>✓</span>}
                  </div>
                  <div className="level-step-card">
                    <span className="level-step-number">Lv.{tier.level}</span>
                    {isCurrent && <span className="level-step-status">{t('当前', 'Now')}</span>}
                    {isNext && <span className="level-step-status">{t('下一站', 'Next')}</span>}
                    <strong className="level-step-title">{tier.title}</strong>
                    <span className="level-step-threshold">{t(`${tier.minCities} 座城市`, `${tier.minCities} cities`)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="metric-grid passport-metrics">
          <div className="metric-card metric-sage">
            <span>{t('已去城市', 'Visited Cities')}</span>
            <strong>{visited.length}</strong>
            <small>{t('座城市', 'cities')}</small>
          </div>
          <div className="metric-card metric-peach">
            <span>{t('累计天数', 'Travel Days')}</span>
            <strong>{travelDays}</strong>
            <small>{t('个旅行日', 'days')}</small>
          </div>
          <div className="metric-card metric-blue">
            <span>{t('点亮省份', 'Provinces')}</span>
            <strong>{visitedProvinces.size}</strong>
            <small>{t('个省级行政区', 'regions')}</small>
          </div>
          <div className="metric-card metric-honey">
            <span>{t('高光时刻', 'Highlights')}</span>
            <strong>{highlights.length}</strong>
            <small>{t('篇珍藏', 'saved')}</small>
          </div>
        </div>
      </section>

      {/* 亲密关系与同行成就（联动「同行旅伴」） */}
      {(() => {
        const activeBonds = intimacyBonds.filter((b) => b.status === 'active');
        if (!activeBonds.length) return null;
        const maxShared = Math.max(0, ...activeBonds.map((b) => b.sharedVisitedCount || 0));
        const socialBadges = [
          { id: 'intimate-first', emoji: '💞', title: '初次绑定同行', unlocked: activeBonds.length >= 1, hint: `已绑定 ${activeBonds.length} 位亲密旅伴` },
          { id: 'intimate-five', emoji: '🗺️', title: '携手五城', unlocked: maxShared >= 5, hint: maxShared >= 5 ? `与旅伴共同点亮 ${maxShared} 座城市` : `与亲密旅伴共同去过 5 城解锁（当前 ${maxShared}/5）` },
          { id: 'intimate-ten', emoji: '🏆', title: '携手十城', unlocked: maxShared >= 10, hint: maxShared >= 10 ? `与旅伴共同点亮 ${maxShared} 座城市` : `与亲密旅伴共同去过 10 城解锁（当前 ${maxShared}/10）` },
          ...activeBonds.slice(0, 4).map((b) => ({
            id: `bond-${b.id}`,
            emoji: RELATION_META[b.relationType].emoji,
            title: `${RELATION_META[b.relationType].badgeTitle} · ${b.peer.nickname}`,
            unlocked: true,
            hint: `${b.customLabel || RELATION_META[b.relationType].label} · 共同点亮 ${b.sharedVisitedCount} 城${b.anniversaryDate ? ` · 纪念日 ${b.anniversaryDate}` : ''}`,
          })),
        ];
        return (
          <section className="card warm-badges intimacy-achievements-card">
            <div className="card-heading">
              <div>
                <h2>{t('亲密同行徽章', 'Companion & Intimacy Badges')}</h2>
                <p className="muted">{t('在「同行旅伴」绑定情侣、家人、挚友或闺蜜并共同点亮城市后自动解锁。', 'Unlocked automatically by bonding with companions and lighting shared cities.')}</p>
              </div>
            </div>
            <div className="badge-grid">
              {socialBadges.map((sb) => (
                <div key={sb.id} className={`badge-card preset-badge ${sb.unlocked ? 'is-unlocked' : 'locked'}`}>
                  <span className={`badge-status-pill ${sb.unlocked ? 'is-done' : ''}`}>
                    {sb.unlocked ? '已点亮 ✦' : '待解锁'}
                  </span>
                  <div className="badge-art custom-badge-art" style={{ fontSize: 34 }}>{sb.emoji}</div>
                  <h3>{sb.title}</h3>
                  <p>{sb.hint}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* 徽章集章墙 */}
      <section className="card warm-badges">
        <div className="card-heading">
          <div>
            <h2>{t('旅途集章册', 'Stamp Collection')}</h2>
            <p className="muted">{t('走过城市、拍下照片、录下语音，都会自动点亮对应的贴纸印章。', 'Visiting cities, saving photos, and recording voice notes automatically unlock matching badges.')}</p>
          </div>
          <div className="badge-wall-actions">
            <span className="badge-wall-counter">
              {t(`已解锁 ${unlockedPresetCount} / ${presetBadges.length}`, `Unlocked ${unlockedPresetCount} / ${presetBadges.length}`)}
              {badges.length ? t(` · 专属 ${badges.length}`, ` · ${badges.length} custom`) : ''}
            </span>
            <button type="button" className="secondary mobile-badge-create" onClick={showBadgeCreator}>
              {t('＋ 手作纪念章', '+ Custom Badge')}
            </button>
          </div>
        </div>

        {/* 手机首屏预览四枚预设徽章，自制徽章始终保留在墙上。 */}
        <div id="achievement-badge-grid" className="badge-grid" data-expanded={badgeWallExpanded}>
          {presetBadges.map((badge) => {
            const unlocked = badge.current >= badge.threshold;
            const pct = Math.min(100, Math.round((badge.current / badge.threshold) * 100));
            return (
              <div className={`badge-card preset-badge ${unlocked ? 'is-unlocked' : 'locked'}`} key={badge.id}>
                <span className={`badge-status-pill ${unlocked ? 'is-done' : ''}`}>
                  {unlocked ? t('已点亮 ✦', 'Unlocked ✦') : `${Math.min(badge.current, badge.threshold)}/${badge.threshold}${badge.unit}`}
                </span>
                <AchievementBadgeArt id={badge.id} unlocked={unlocked} />
                <h3>{badge.title}</h3>
                <p>
                  {unlocked
                    ? badge.hint
                    : t(`还差 ${badge.threshold - badge.current} ${badge.unit} · ${badge.hint}`, `${badge.threshold - badge.current} left · ${badge.hint}`)}
                </p>
                {unlocked ? (
                  <button className="text-button badge-poster-btn" onClick={() => void shareBadge(badge.title, badge.symbol, null)}>
                    {t('生成纪念海报 ↗', 'Download Poster ↗')}
                  </button>
                ) : (
                  <div className="badge-mini-progress" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
          {badges.map((badge) => (
            <CustomBadgeCard
              key={badge.id}
              badge={badge}
              linkedEntry={entries.find((entry) => entry.id === badge.linkedEntryId)}
              onOpenEntry={onOpenEntry}
              onShare={() => void shareBadge(badge.title, '✧', badge.image)}
            />
          ))}
        </div>
        <button
          type="button"
          className="mobile-disclosure-toggle badge-wall-toggle"
          aria-expanded={badgeWallExpanded}
          aria-controls="achievement-badge-grid"
          onClick={() => setBadgeWallExpanded((expanded) => !expanded)}
        >
          <span>{badgeWallExpanded ? t('收起预设徽章', 'Show fewer badges') : t(`查看全部 ${presetBadges.length} 枚预设徽章`, `View all ${presetBadges.length} preset badges`)}</span>
        </button>

        <div className="badge-creator" id="badge-creator" tabIndex={-1}>
          <div className="badge-creator-head">
            <div>
              <h3>{t('手作专属纪念章', 'Craft a Custom Badge')}</h3>
              <p className="muted">{t('给一次难忘的日落、一场演唱会或一段徒步，定制只属于自己的圆形徽章。', 'Create a personal round keepsake for an unforgettable sunset, concert, or hike.')}</p>
            </div>
            <CuteSticker kind="stamp" className="creator-stamp-deco" />
          </div>
          <div className="entry-form">
            <label>
              {t('徽章名称', 'Badge Name')}
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={24} placeholder={t('例如：洱海追风', 'e.g. Erhai Breeze')} />
            </label>
            <label>
              {t('徽章图片', 'Badge Image')}
              {webTourMode ? (
                <button
                  type="button"
                  className="file-picker-box"
                  onClick={() => onRequireClient?.('photo')}
                >
                  <TravelIcon name="camera" />
                  <span>{t('🔒 上传图片请下载客户端', '🔒 Client only for photo upload')}</span>
                </button>
              ) : (
                <span className={`file-picker-box ${imageName ? 'has-file' : ''}`}>
                  <input
                    className="file-picker-input"
                    type="file"
                    accept="image/*"
                    ref={imageInputRef}
                    onChange={(event) => setImageName(event.target.files?.[0]?.name ?? '')}
                  />
                  <TravelIcon name="camera" />
                  <span>{imageName || t('挑选一张喜欢的图片…', 'Choose a photo…')}</span>
                </span>
              )}
            </label>
            <label>
              {t('关联高光记录', 'Link Highlight Entry')}
              <select value={linkedEntryId} onChange={(event) => setLinkedEntryId(event.target.value)}>
                <option value="">{t('不关联', 'None')}</option>
                {highlights.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {marks.find((mark) => mark.id === entry.cityCode)?.name ?? t('城市', 'City')} · {entry.date}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary" onClick={() => void createBadge()}>{t('收入我的集章册', 'Add to Collection')}</button>
        </div>
      </section>

      {/* 出行票夹珍藏墙（直接预览高清拟物票据与出行路线图） */}
      <AchievementsTicketShowcase trips={trips} onNotice={onNotice} onError={onError} />

      {/* 高光拍立得墙 */}
      <section className="warm-highlights">
        <div className="card-heading">
          <div>
            <h2>{t('想再看一遍的高光时刻', 'Highlight Moments')}</h2>
            <p className="muted">{t('把最心动的一页设为高光，做成贴在墙上的拍立得。', 'Star your favorite journal moments to display them like Polaroids on the wall.')}</p>
          </div>
          <span>{t(`${highlights.length} 个高光时刻`, `${highlights.length} highlights`)}</span>
        </div>
        {highlights.length ? (
          <div className="warm-highlight-grid">
            {highlights.map((entry) => (
              <button className="warm-highlight-card" key={entry.id} onClick={() => onOpenEntry(entry)}>
                <span className="washi-tape tape-mini" aria-hidden="true" />
                <TravelCover
                  media={
                    media.find((item) => item.kind === 'photo' && item.entryId === entry.id)
                    ?? media.find((item) => item.kind === 'photo' && item.placeId === entry.placeId)
                  }
                  label={entry.place || t('旅途高光', 'Highlight')}
                />
                <div>
                  <h3>{entry.place || marks.find((mark) => mark.id === entry.cityCode)?.name || t('旅途高光', 'Highlight')}</h3>
                  <p>{entry.note || t('翻开这一页，再看一遍当时的风景。', 'Open this page to revisit the view.')}</p>
                  <small>{entry.date} · {t('查看高光 ↗', 'View ↗')}</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="warm-empty-note highlight-empty-card">
            <HighlightEmptyArt />
            <div>
              <strong>{t('高光墙正虚位以待', 'Your Highlight Wall awaits')}</strong>
              <p>{t('在「旅行手账」打开任意地点回忆并勾选“设为高光时刻”，最喜欢的瞬间就会变成拍立得挂在这里。', 'Open any place memory in Travel Journal and check "Mark as Highlight" to pin it here.')}</p>
            </div>
          </div>
        )}
      </section>

      {/* 年度时间轴 + 回忆百宝箱 */}
      <section className="card warm-year-review">
        <div className="card-heading">
          <div>
            <h2>{t('旅行时间轴 & 回忆百宝箱', 'Travel Timeline & Keepsakes')}</h2>
            <p className="muted">{t('按年份翻阅你的出发节奏与收藏统计。', 'Browse your travel cadence and keepsakes by year.')}</p>
          </div>
          <span>{yearly.length ? t(`记录了 ${yearly.length} 个年份`, `${yearly.length} ${yearly.length === 1 ? 'year' : 'years'} logged`) : t('随时开始记录', 'Ready to begin')}</span>
        </div>

        <div className="memory-treasure-strip">
          <div className="treasure-chip chip-peach"><span>📷 {t('珍藏照片', 'Photos')}</span><strong>{photoCount}</strong></div>
          <div className="treasure-chip chip-blue"><span>🎬 {t('旅途视频', 'Videos')}</span><strong>{videoCount}</strong></div>
          <div className="treasure-chip chip-lilac"><span>🎙 {t('语音评语', 'Voice Notes')}</span><strong>{audioCount}</strong></div>
          <div className="treasure-chip chip-sage"><span>🧳 {t('完成旅程', 'Trips')}</span><strong>{completedTrips.length}</strong></div>
        </div>

        {yearly.length ? (
          <div className="timeline">
            {yearly.map(([year, count]) => (
              <div className="timeline-item" key={year}>
                <i />
                <div className="timeline-year-head">
                  <strong>{year}</strong>
                  <span className="year-days-pill">{t(`${count} 个旅行日`, `${count} travel ${count === 1 ? 'day' : 'days'}`)}</span>
                </div>
                <div className="warm-year-photos">
                  {media
                    .filter((item) => item.kind === 'photo' && item.capturedAt.startsWith(year))
                    .slice(0, 3)
                    .map((item) => (
                      <TravelCover key={item.id} media={item} label={item.placeName} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="timeline-empty-note">
            <CuteSticker kind="plane" className="timeline-empty-plane" />
            <p>{t('点亮第一座城市或保存一段旅程后，这里会自动按年份铺开你的旅行时间轴。', 'Light up your first city or save a trip to automatically build your yearly travel timeline.')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
