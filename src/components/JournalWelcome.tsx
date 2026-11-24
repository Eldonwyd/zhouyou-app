import type { CityMark, Journey, JourneyCity, JourneyPlace, TravelMedia } from '../types';
import type { PlannerPhoto } from '../planner-types';
import { useI18n } from '../i18n';
import { TravelCover, TravelIcon } from './TravelArt';
import { CuteSticker } from './CuteArt';
import JournalCover from './JournalCover';
import MobileDisclosure from './MobileDisclosure';

/** 首页照片与便笺取自真实记录；紧凑双卡明信片与手账便签，把空间留给城市和旅行列表。 */
export default function JournalWelcome({
  trips,
  places,
  media,
  marks = [],
  plannerPhotosByTrip,
  onOpen,
  onOpenCity,
  onStart,
  onNewTrip,
}: {
  trips: Journey[];
  places: JourneyPlace[];
  media: TravelMedia[];
  marks?: CityMark[];
  plannerPhotosByTrip: ReadonlyMap<string, PlannerPhoto[]>;
  onOpen: (tripId: string | null, place: JourneyPlace | null) => void;
  onOpenCity: (city: JourneyCity) => void;
  onStart?: () => void;
  onNewTrip?: () => void;
}) {
  const { t } = useI18n();
  const latestMedia = [...media]
    .filter((item) => item.kind === 'photo')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  const place = places.find((item) => item.id === latestMedia?.placeId)
    ?? [...places].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const trip = (place ? trips.find((item) => item.id === place.tripId)
    : [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]) ?? null;
  const visitedCities = marks.filter((mark) => mark.visited);
  // 只有点亮记录时，置顶卡也能直接翻开最近点亮的城市。
  const recentMark = !place && !trip ? visitedCities.reduce<CityMark | undefined>((latest, mark) =>
    !latest || mark.updatedAt > latest.updatedAt ? mark : latest, undefined) : undefined;
  const coverCityCode = place?.cityCode ?? trip?.cities[0]?.code ?? recentMark?.id;
  // 照片只来自置顶卡实际打开的地点或旅行，避免回退时串到另一座城市。
  const coverPhoto = latestMedia && (place ? latestMedia.placeId === place.id : trip && latestMedia.tripId === trip.id)
    ? latestMedia : undefined;
  const notePlace = [...places]
    .filter((item) => item.reviewText.trim() || (item.reviewNotes?.length ?? 0) > 0)
    .sort((a, b) => (b.reviewNotes?.at(-1)?.createdAt ?? b.createdAt).localeCompare(a.reviewNotes?.at(-1)?.createdAt ?? a.createdAt))[0];
  const hasMemory = Boolean(place || trip || recentMark);
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
        onClick={() => {
          if (recentMark) onOpenCity({ code: recentMark.id, name: recentMark.name, provinceCode: recentMark.provinceCode });
          else if (hasMemory) onOpen(place ? place.tripId : trip?.id ?? null, place);
          else onStart?.();
        }}
        disabled={!hasMemory && !onStart}
      >
        <span className="washi-tape tape-top-left" aria-hidden="true" />
        <div className="postcard-thumb-frame">
          {coverCityCode ? <JournalCover cityCode={coverCityCode} photoId={coverPhoto?.id}
            plannerPhotos={trip && !coverPhoto ? plannerPhotosByTrip.get(trip.id) : undefined} />
            : <TravelCover label={t('旅途明信片', 'Travel Postcard')} />}
          <span className="postcard-stamp-dot cute-deco" aria-hidden="true">✦</span>
        </div>
        <div className="postcard-info">
          <div className="postcard-info-top">
            <span className="postcard-tag">
              <span className="cute-deco" aria-hidden="true">✦</span>
              {hasMemory ? t('最近去过', 'Recent Stop') : t('旅途明信片', 'Travel Postcard')}
            </span>
            <small className="postcard-date">
              {trip ? `${trip.startDate} — ${trip.endDate}` : (place?.createdAt ?? recentMark?.updatedAt)?.slice(0, 10) ?? t('待出发', 'Upcoming')}
            </small>
          </div>
          <h2>{trip?.title ?? place?.name ?? recentMark?.name ?? t('下一页精彩，等你来贴', 'Your next story starts here')}</h2>
          <p className="postcard-desc">
            {trip?.cities.map((city) => city.name).join(' · ') ?? t('把照片、短记与声音收进这一页小册子。', 'Collect photos, notes, and voice memos in this travel booklet.')}
          </p>
          <div className="postcard-footer">
            <span className="postcard-cta">{hasMemory ? t('翻开这一页', 'Open this page') : t('去记录第一站', 'Log your first stop')} <b>↗</b></span>
            <CuteSticker kind="plane" className="postcard-mini-plane" />
          </div>
        </div>
      </button>

      {/* 右卡：紧凑手账便签 + 四色计数条 */}
      <aside className="warm-note-paper compact-note-card">
        <span className="washi-tape tape-center" aria-hidden="true" />
        <CuteSticker kind="sparkle" className="note-float-sparkle" />
        <MobileDisclosure label={t('最近便签', 'Latest Note')} value={notePlace?.name}>
          <div className="note-paper-head">
            <span className="warm-note-label"><TravelIcon name="detail" />{t('最近便签', 'Latest Note')}</span>
            <div className="note-head-right">
              {audioCount > 0 && <span className="note-audio-pill">🎙 {audioCount}</span>}
              <small className="note-date-pill">{noteDate || t('小贴士', 'Tip')}</small>
              <button
                type="button"
                className="note-mini-link"
                disabled={!notePlace && !onStart}
                onClick={() => { if (notePlace) onOpen(notePlace.tripId, notePlace); else onStart?.(); }}
              >
                {notePlace ? t('打开 ↗', 'Open ↗') : t('去写 ↗', 'Write ↗')}
              </button>
            </div>
          </div>

          <div className="note-memo-box">
            <span className="note-memo-quote cute-deco" aria-hidden="true">“</span>
            <div className="note-memo-row">
              <h3>{notePlace?.name ?? t('还没有贴上第一张便签', 'No notes pinned yet')}</h3>
              {!notePlace && onNewTrip && (
                <button type="button" className="note-quick-pill" onClick={onNewTrip}>{t('＋ 记一段旅行', '+ New Trip')}</button>
              )}
            </div>
            <p>{noteText || t('挑一座去过的城市，贴几张照片或写几句当时的天气与心情。', 'Pick a visited city to add photos, weather, and thoughts from that day.')}</p>
          </div>
        </MobileDisclosure>

        <dl className="warm-memory-counts compact-counts">
          <div className="count-pill-sage"><dt>{t('旅行', 'Trips')}</dt><dd>{trips.length}</dd></div>
          <div className="count-pill-blue"><dt>{t('城市', 'Cities')}</dt><dd>{visitedCities.length}</dd></div>
          <div className="count-pill-peach"><dt>{t('地点', 'Places')}</dt><dd>{places.length}</dd></div>
          <div className="count-pill-honey"><dt>{t('照片', 'Photos')}</dt><dd>{photoCount}</dd></div>
        </dl>
      </aside>
    </section>
  );
}
