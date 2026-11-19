import { useEffect, useRef, useState } from 'react';
import type { Badge, CityMark, DayEntry, Journey, TravelMedia } from '../types';
import { TravelCover, TravelIcon } from './TravelArt';
import { AchievementBadgeArt, CuteSticker, HighlightEmptyArt, getTravelerLevel } from './CuteArt';
import { createLocalId, downloadBlob } from '../utils';
import { themeColor } from '../theme';

// 每站沿用应用内的旅行图标，等级数超过现有图标时仍可显示默认地图图标。
const travelerStopIcons = ['leaf', 'detail', 'map', 'camera', 'mountain', 'train', 'sun', 'plane'];

interface AchievementsViewProps {
  marks: CityMark[];
  entries: DayEntry[];
  trips: Journey[];
  media: TravelMedia[];
  badges: Badge[];
  onSaveBadge: (badge: Badge) => Promise<void>;
  onOpenEntry: (entry: DayEntry) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
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

async function drawBadgePoster(title: string, symbol: string, image: Blob | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成海报');
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
  context.fillText('旅行足迹 · 我的旅途纪念章', 450, 962);

  context.fillStyle = accent;
  context.font = '600 22px "PingFang SC", "Microsoft YaHei UI", sans-serif';
  context.fillText(new Date().toISOString().slice(0, 10), 450, 1020);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('海报生成失败');
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
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!badge.image) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(badge.image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [badge.image]);

  return (
    <div className="badge-card custom-badge-card">
      <span className="badge-status-pill is-custom">专属手作</span>
      <div className="badge-art custom-badge-art">{url ? <img src={url} alt="" /> : '✧'}</div>
      <h3>{badge.title}</h3>
      <p>自己收藏的特别纪念章</p>
      <div className="badge-actions">
        <button className="text-button" onClick={onShare}>生成海报</button>
        {linkedEntry && <button className="text-button" onClick={() => onOpenEntry(linkedEntry)}>查看高光</button>}
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
  onSaveBadge,
  onOpenEntry,
  onError,
  onNotice,
}: AchievementsViewProps) {
  const [title, setTitle] = useState('');
  const [linkedEntryId, setLinkedEntryId] = useState('');
  const [imageName, setImageName] = useState('');
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

  const levelInfo = getTravelerLevel(visited.length, travelDays);

  const presetBadges: PresetBadgeSpec[] = [
    { id: 'first-trip', title: '初次出发', symbol: '✦', threshold: 1, unit: '城', hint: '点亮第 1 座城市', current: visited.length },
    { id: 'five-cities', title: '五城玩家', symbol: '✺', threshold: 5, unit: '城', hint: '走过 5 座不同城市', current: visited.length },
    { id: 'ten-cities', title: '十城收藏家', symbol: '◆', threshold: 10, unit: '城', hint: '足迹覆盖 10 座城市', current: visited.length },
    { id: 'province-hopper', title: '跨省达人', symbol: '❖', threshold: 3, unit: '省', hint: '足迹跨越 3 个省份', current: visitedProvinces.size },
    { id: 'photo-lover', title: '镜头捕手', symbol: '◎', threshold: 10, unit: '张', hint: '珍藏 10 张旅途照片', current: photoCount },
    { id: 'voice-keeper', title: '声音日记本', symbol: '♪', threshold: 1, unit: '段', hint: '录下 1 段旅途语音', current: audioCount },
    { id: 'highlight-hunter', title: '高光猎人', symbol: '★', threshold: 3, unit: '篇', hint: '收藏 3 个高光时刻', current: highlights.length },
    { id: 'companion-joy', title: '结伴同行', symbol: '♥', threshold: 1, unit: '次', hint: '记录 1 次同行旅程', current: companionTrips },
    { id: 'long-wanderer', title: '漫游时光', symbol: '☀', threshold: 7, unit: '天', hint: '累计旅行达到 7 天', current: travelDays },
  ];

  const unlockedPresetCount = presetBadges.filter((badge) => badge.current >= badge.threshold).length;

  async function createBadge(): Promise<void> {
    if (!title.trim()) { onError('请填写徽章名称'); return; }
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
      onNotice('专属徽章已创建。');
    } catch (error) { onError(error instanceof Error ? error.message : '徽章保存失败'); }
  }

  async function shareBadge(badgeTitle: string, symbol: string, image: Blob | null): Promise<void> {
    try { downloadBlob(await drawBadgePoster(badgeTitle, symbol, image), `${badgeTitle}-旅行徽章.png`); }
    catch (error) { onError(error instanceof Error ? error.message : '海报生成失败'); }
  }

  return (
    <div className="content-page warm-achievements">
      <div className="section-heading">
        <div>
          <h1>旅途成就</h1>
          <p>走过的每一站，都在悄悄攒成亮晶晶的纪念印章。</p>
        </div>
        <button
          className="primary"
          onClick={() => document.getElementById('badge-creator')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          ＋ 手作一枚纪念章
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
              <span className="stamp-counter-pill">已集章 {unlockedPresetCount + badges.length} 枚</span>
            </div>
            <h2>走过的路，每一站都闪闪发光。</h2>
            <p>{levelInfo.subtitle}</p>
            <div className="passport-xp-wrap">
              <div className="passport-xp-head">
                <strong>
                  {levelInfo.nextTarget !== null
                    ? `再点亮 ${levelInfo.remainingCities} 座城市 → 升级 Lv.${levelInfo.level + 1} ${levelInfo.nextTitle}`
                    : `已达成满级 Lv.${levelInfo.maxLevel} ${levelInfo.title} ✦`}
                </strong>
                <span className="passport-xp-nums">
                  {levelInfo.nextTarget !== null
                    ? `${levelInfo.visitedCities} / ${levelInfo.nextTarget} 城（${levelInfo.progressPct}%）`
                    : `已点亮 ${levelInfo.visitedCities} 城 · 100%`}
                </span>
              </div>
              <div className="passport-xp-track" role="progressbar" aria-valuenow={levelInfo.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="旅人等级进度">
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

        <section className="level-roadmap" aria-labelledby="traveler-roadmap-title">
          <div className="level-roadmap-head">
            <span className="level-roadmap-icon"><TravelIcon name="map" /></span>
            <h3 id="traveler-roadmap-title">旅人成长路线</h3>
          </div>
          <ol className="level-roadmap-steps" role="list">
            {levelInfo.tiers.map((tier) => {
              // 用同一套等级结果标记已达成、当前与下一站，满级时自然没有下一站。
              const isCurrent = tier.level === levelInfo.level;
              const isReached = tier.level < levelInfo.level;
              const isNext = tier.level === levelInfo.level + 1;
              const status = isCurrent ? 'current' : isReached ? 'reached' : isNext ? 'next' : 'upcoming';
              return (
                <li
                  key={tier.level}
                  className={`level-step is-${status}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <div className="level-step-marker">
                    <TravelIcon name={travelerStopIcons[tier.level - 1] ?? 'map'} />
                    {isReached && <span className="level-step-check" role="img" aria-label="已达成">✓</span>}
                  </div>
                  <div className="level-step-card">
                    <span className="level-step-number">Lv.{tier.level}</span>
                    {isCurrent && <span className="level-step-status">当前</span>}
                    {isNext && <span className="level-step-status">下一站</span>}
                    <strong className="level-step-title">{tier.title}</strong>
                    <span className="level-step-threshold">{tier.minCities} 座城市</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="metric-grid passport-metrics">
          <div className="metric-card metric-sage">
            <span>已去城市</span>
            <strong>{visited.length}</strong>
            <small>座城市</small>
          </div>
          <div className="metric-card metric-peach">
            <span>累计天数</span>
            <strong>{travelDays}</strong>
            <small>个旅行日</small>
          </div>
          <div className="metric-card metric-blue">
            <span>点亮省份</span>
            <strong>{visitedProvinces.size}</strong>
            <small>个省级行政区</small>
          </div>
          <div className="metric-card metric-honey">
            <span>高光时刻</span>
            <strong>{highlights.length}</strong>
            <small>篇珍藏</small>
          </div>
        </div>
      </section>

      {/* 徽章集章墙 */}
      <section className="card warm-badges">
        <div className="card-heading">
          <div>
            <h2>旅途集章册</h2>
            <p className="muted">走过城市、拍下照片、录下语音，都会自动点亮对应的贴纸印章。</p>
          </div>
          <span className="badge-wall-counter">已解锁 {unlockedPresetCount} / {presetBadges.length}{badges.length ? ` · 专属 ${badges.length}` : ''}</span>
        </div>

        <div className="badge-grid">
          {presetBadges.map((badge) => {
            const unlocked = badge.current >= badge.threshold;
            const pct = Math.min(100, Math.round((badge.current / badge.threshold) * 100));
            return (
              <div className={`badge-card ${unlocked ? 'is-unlocked' : 'locked'}`} key={badge.id}>
                <span className={`badge-status-pill ${unlocked ? 'is-done' : ''}`}>
                  {unlocked ? '已点亮 ✦' : `${Math.min(badge.current, badge.threshold)}/${badge.threshold}${badge.unit}`}
                </span>
                <AchievementBadgeArt id={badge.id} unlocked={unlocked} />
                <h3>{badge.title}</h3>
                <p>{unlocked ? badge.hint : `还差 ${badge.threshold - badge.current} ${badge.unit} · ${badge.hint}`}</p>
                {unlocked ? (
                  <button className="text-button badge-poster-btn" onClick={() => void shareBadge(badge.title, badge.symbol, null)}>
                    生成纪念海报 ↗
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

        <div className="badge-creator" id="badge-creator">
          <div className="badge-creator-head">
            <div>
              <h3>手作专属纪念章</h3>
              <p className="muted">给一次难忘的日落、一场演唱会或一段徒步，定制只属于自己的圆形徽章。</p>
            </div>
            <CuteSticker kind="stamp" className="creator-stamp-deco" />
          </div>
          <div className="entry-form">
            <label>
              徽章名称
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={12} placeholder="例如：洱海追风" />
            </label>
            <label>
              徽章图片
              <span className={`file-picker-box ${imageName ? 'has-file' : ''}`}>
                <input
                  className="file-picker-input"
                  type="file"
                  accept="image/*"
                  ref={imageInputRef}
                  onChange={(event) => setImageName(event.target.files?.[0]?.name ?? '')}
                />
                <TravelIcon name="camera" />
                <span>{imageName || '挑选一张喜欢的图片…'}</span>
              </span>
            </label>
            <label>
              关联高光记录
              <select value={linkedEntryId} onChange={(event) => setLinkedEntryId(event.target.value)}>
                <option value="">不关联</option>
                {highlights.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {marks.find((mark) => mark.id === entry.cityCode)?.name ?? '城市'} · {entry.date}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary" onClick={() => void createBadge()}>收入我的集章册</button>
        </div>
      </section>

      {/* 高光拍立得墙 */}
      <section className="warm-highlights">
        <div className="card-heading">
          <div>
            <h2>想再看一遍的高光时刻</h2>
            <p className="muted">把最心动的一页设为高光，做成贴在墙上的拍立得。</p>
          </div>
          <span>{highlights.length} 个高光时刻</span>
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
                  label={entry.place || '旅途高光'}
                />
                <div>
                  <h3>{entry.place || marks.find((mark) => mark.id === entry.cityCode)?.name || '旅途高光'}</h3>
                  <p>{entry.note || '翻开这一页，再看一遍当时的风景。'}</p>
                  <small>{entry.date} · 查看高光 ↗</small>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="warm-empty-note highlight-empty-card">
            <HighlightEmptyArt />
            <div>
              <strong>高光墙正虚位以待</strong>
              <p>在「旅行手账」打开任意地点回忆并勾选“设为高光时刻”，最喜欢的瞬间就会变成拍立得挂在这里。</p>
            </div>
          </div>
        )}
      </section>

      {/* 年度时间轴 + 回忆百宝箱 */}
      <section className="card warm-year-review">
        <div className="card-heading">
          <div>
            <h2>旅行时间轴 & 回忆百宝箱</h2>
            <p className="muted">按年份翻阅你的出发节奏与收藏统计。</p>
          </div>
          <span>{yearly.length ? `记录了 ${yearly.length} 个年份` : '随时开始记录'}</span>
        </div>

        <div className="memory-treasure-strip">
          <div className="treasure-chip chip-peach"><span>📷 珍藏照片</span><strong>{photoCount}</strong></div>
          <div className="treasure-chip chip-blue"><span>🎬 旅途视频</span><strong>{videoCount}</strong></div>
          <div className="treasure-chip chip-lilac"><span>🎙 语音评语</span><strong>{audioCount}</strong></div>
          <div className="treasure-chip chip-sage"><span>🧳 完成旅程</span><strong>{completedTrips.length}</strong></div>
        </div>

        {yearly.length ? (
          <div className="timeline">
            {yearly.map(([year, count]) => (
              <div className="timeline-item" key={year}>
                <i />
                <div className="timeline-year-head">
                  <strong>{year}</strong>
                  <span className="year-days-pill">{count} 个旅行日</span>
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
            <p>点亮第一座城市或保存一段旅程后，这里会自动按年份铺开你的旅行时间轴。</p>
          </div>
        )}
      </section>
    </div>
  );
}
