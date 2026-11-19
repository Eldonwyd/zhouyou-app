import type { CityMark, Journey, JourneyPlace, TravelMedia } from '../types';
import { TravelCover, TravelIcon } from './TravelArt';
import { CuteSticker } from './CuteArt';

/** 首页照片与便笺取自真实记录；紧凑双卡明信片与手账便签，把空间留给城市和旅行列表。 */
export default function JournalWelcome({
  trips,
  places,
  media,
  marks = [],
  onOpen,
  onStart,
  onNewTrip,
}: {
  trips: Journey[];
  places: JourneyPlace[];
  media: TravelMedia[];
  marks?: CityMark[];
  onOpen: (tripId: string | null, place: JourneyPlace | null) => void;
  onStart?: () => void;
  onNewTrip?: () => void;
}) {
  const latestMedia = [...media]
    .filter((item) => item.kind === 'photo')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  const place = places.find((item) => item.id === latestMedia?.placeId)
    ?? [...places].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const trip = (place ? trips.find((item) => item.id === place.tripId)
    : [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]) ?? null;
  const notePlace = [...places]
    .filter((item) => item.reviewText.trim() || (item.reviewNotes?.length ?? 0) > 0)
    .sort((a, b) => (b.reviewNotes?.at(-1)?.createdAt ?? b.createdAt).localeCompare(a.reviewNotes?.at(-1)?.createdAt ?? a.createdAt))[0];
  const hasMemory = Boolean(place || trip);
  const visitedCitiesCount = marks.filter((m) => m.visited).length;
  const photoCount = media.filter((item) => item.kind === 'photo').length;
  const audioCount = media.filter((item) => item.kind === 'audio').length;
  const noteDate = notePlace ? (notePlace.reviewNotes?.at(-1)?.createdAt ?? notePlace.createdAt).slice(5, 10).replace('-', '/') : '';
  const noteText = notePlace?.reviewNotes?.at(-1)?.text ?? notePlace?.reviewText ?? '';

  return (
    <section className="warm-journal-hero compact-journal-hero">
      {/* 左卡：紧凑迷你明信片，不再占满半屏 */}
      <button
        type="button"
        className="warm-featured compact-postcard"
        onClick={() => (hasMemory ? onOpen(place ? place.tripId : trip?.id ?? null, place) : onStart?.())}
        disabled={!hasMemory && !onStart}
      >
        <span className="washi-tape tape-top-left" aria-hidden="true" />
        <div className="postcard-thumb-frame">
          <TravelCover media={latestMedia} full label={place?.name ?? trip?.title ?? '旅途明信片'} />
          <span className="postcard-stamp-dot cute-deco" aria-hidden="true">✦</span>
        </div>
        <div className="postcard-info">
          <div className="postcard-info-top">
            <span className="postcard-tag">
              <span className="cute-deco" aria-hidden="true">✦</span>
              {hasMemory ? '最近去过' : '旅途明信片'}
            </span>
            <small className="postcard-date">
              {trip ? `${trip.startDate} — ${trip.endDate}` : place ? place.createdAt.slice(0, 10) : '待出发'}
            </small>
          </div>
          <h2>{trip?.title ?? place?.name ?? '下一页精彩，等你来贴'}</h2>
          <p className="postcard-desc">
            {trip?.cities.map((city) => city.name).join(' · ') ?? '把照片、短记与声音收进这一页小册子。'}
          </p>
          <div className="postcard-footer">
            <span className="postcard-cta">{hasMemory ? '翻开这一页' : '去记录第一站'} <b>↗</b></span>
            <CuteSticker kind="plane" className="postcard-mini-plane" />
          </div>
        </div>
      </button>

      {/* 右卡：紧凑手账便签 + 四色计数条 */}
      <aside className="warm-note-paper compact-note-card">
        <span className="washi-tape tape-center" aria-hidden="true" />
        <CuteSticker kind="sparkle" className="note-float-sparkle" />
        <div className="note-paper-head">
          <span className="warm-note-label"><TravelIcon name="detail" />最近便签</span>
          <div className="note-head-right">
            {audioCount > 0 && <span className="note-audio-pill">🎙 {audioCount}</span>}
            <small className="note-date-pill">{noteDate || '小贴士'}</small>
            <button
              type="button"
              className="note-mini-link"
              disabled={!notePlace && !onStart}
              onClick={() => { if (notePlace) onOpen(notePlace.tripId, notePlace); else onStart?.(); }}
            >
              {notePlace ? '打开 ↗' : '去写 ↗'}
            </button>
          </div>
        </div>

        <div className="note-memo-box">
          <span className="note-memo-quote cute-deco" aria-hidden="true">“</span>
          <div className="note-memo-row">
            <h3>{notePlace?.name ?? '还没有贴上第一张便签'}</h3>
            {!notePlace && onNewTrip && (
              <button type="button" className="note-quick-pill" onClick={onNewTrip}>＋ 记一段旅行</button>
            )}
          </div>
          <p>{noteText || '挑一座去过的城市，贴几张照片或写几句当时的天气与心情。'}</p>
        </div>

        <dl className="warm-memory-counts compact-counts">
          <div className="count-pill-sage"><dt>旅行</dt><dd>{trips.length}</dd></div>
          <div className="count-pill-blue"><dt>城市</dt><dd>{visitedCitiesCount}</dd></div>
          <div className="count-pill-peach"><dt>地点</dt><dd>{places.length}</dd></div>
          <div className="count-pill-honey"><dt>照片</dt><dd>{photoCount}</dd></div>
        </dl>
      </aside>
    </section>
  );
}
