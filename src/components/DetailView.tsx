import { useEffect, useId, useMemo, useRef, useState } from 'react';
import exifr from 'exifr';
import type {
  AdministrativeFeature, CityMark, DayEntry, Journey, JourneyCity, JourneyPlace,
  TravelMedia,
} from '../types';
import { getLivePhotoVideoBlob, getMediaBlob, getMediaPreview } from '../db';
import type { JourneyLinkResult } from '../db';
import { cityFromGps, loadNationalMap, loadProvinceMap } from '../map-data';
import { createLocalId, describeStorageError, downloadBlob, isQuotaStorageError, localDay, periodFromDate } from '../utils';
import {
  detectMotionPhoto,
  formatFileSize,
  isAnimatedImageMedia,
  isLivePhotoMedia,
  pairLivePhotoItems,
} from '../live-photo';
import TravelCityBrowser from './TravelCityBrowser';
import JournalWelcome from './JournalWelcome';
import CityGuideLinks from './CityGuideLinks';
import { CuteSticker, IllustratedJourneyCover, JournalEmptyArt } from './CuteArt';
import JournalCover, { findJournalPlannerPhotos } from './JournalCover';
import type { AiTravelPlan } from '../planner-types';
import { provinceDisplayName, useI18n } from '../i18n';
import type { TourRestrictedFeature } from '../web-tour';
import ThemedDatePicker from './ThemedDatePicker';
import TicketWalletView from './TicketWalletView';

interface DetailViewProps {
  city: CityMark | null;
  marks: CityMark[];
  trips: Journey[];
  aiPlans: AiTravelPlan[];
  places: JourneyPlace[];
  entries: DayEntry[];
  media: TravelMedia[];
  targetEntryId: string | null;
  targetPlaceId?: string | null;
  onSaveTrip: (trip: Journey) => Promise<JourneyLinkResult>;
  onSavePlace: (place: JourneyPlace) => Promise<void>;
  onSaveEntry: (entry: DayEntry) => Promise<void>;
  onSaveMedia: (media: TravelMedia, blob: Blob) => Promise<void>;
  onSaveMediaGroup: (items: Array<{ media: TravelMedia; blob: Blob; liveVideoBlob?: Blob | null }>, entries: DayEntry[]) => Promise<void>;
  onUpdateMedia: (media: TravelMedia) => Promise<void>;
  onDeleteMedia: (id: string) => Promise<void>;
  onUpdateMark: (visited: boolean) => Promise<void>;
  onSaveCityMark: (mark: CityMark) => Promise<void>;
  onOpenMap?: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  webTourMode?: boolean;
  onRequireClient?: (feature: TourRestrictedFeature) => void;
}

interface SavedCitySummary extends JourneyCity {
  tripCount: number;
  placeCount: number;
  visited: boolean;
}

const PAGE_SIZE = 24;

/** Object URLs are created only for visible thumbnails or the open image. */
function useMediaUrl(id: string | null, kind: TravelMedia['kind'], preview: boolean): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!id) { setUrl(''); return; }
    let disposed = false;
    let objectUrl = '';
    const loader = preview ? getMediaPreview(id, kind) : getMediaBlob(id);
    loader.then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(''));
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, kind, preview]);
  return url;
}

function useLivePhotoVideoUrl(item: TravelMedia | null): string {
  const [url, setUrl] = useState('');
  const liveKey = item && isLivePhotoMedia(item)
    ? `${item.id}:${item.liveVideoId ?? ''}:${item.liveVideoOffset ?? ''}:${item.liveVideoLength ?? ''}`
    : '';
  useEffect(() => {
    if (!item || !liveKey) { setUrl(''); return; }
    let disposed = false;
    let objectUrl = '';
    getLivePhotoVideoBlob(item).then((blob) => {
      if (disposed || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(''));
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [liveKey]);
  return url;
}

function LivePhotoStage({ item, imageUrl, liveVideoUrl }: {
  item: TravelMedia;
  imageUrl: string;
  liveVideoUrl: string;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setPlaying(false);
    holdStartedRef.current = false;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, [item.id]);

  function stopPlayback(): void {
    const video = videoRef.current;
    if (video) {
      video.pause();
      try { video.currentTime = 0; } catch { /* ignore */ }
    }
    setPlaying(false);
  }

  async function startPlayback(): Promise<void> {
    const video = videoRef.current;
    if (!video || !liveVideoUrl) return;
    try { video.currentTime = 0; } catch { /* ignore */ }
    video.muted = muted;
    setPlaying(true);
    try {
      await video.play();
    } catch {
      // Autoplay with audio may be blocked on some WebViews; retry muted.
      video.muted = true;
      setMuted(true);
      try { await video.play(); } catch { setPlaying(false); }
    }
  }

  function handlePointerDown(): void {
    if (!liveVideoUrl) return;
    holdStartedRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdStartedRef.current = true;
      void startPlayback();
    }, 220);
  }

  function handlePointerEnd(): void {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdStartedRef.current) {
      holdStartedRef.current = false;
      stopPlayback();
    }
  }

  return (
    <div
      className={`live-photo-stage${playing ? ' playing' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onContextMenu={(event) => { if (liveVideoUrl) event.preventDefault(); }}
    >
      <img key={item.id} src={imageUrl} alt={item.fileName} draggable={false} />
      {liveVideoUrl && (
        <>
          <video
            ref={videoRef}
            className="live-photo-video"
            src={liveVideoUrl}
            playsInline
            muted={muted}
            preload="auto"
            onEnded={() => setPlaying(false)}
            onError={() => setPlaying(false)}
          />
          <div className="live-photo-controls" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={`live-photo-pill${playing ? ' active' : ''}`}
              onClick={() => { if (playing) stopPlayback(); else void startPlayback(); }}
              aria-label={playing ? t('停止实况播放', 'Stop Live Photo') : t('播放实况照片', 'Play Live Photo')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="7" strokeDasharray="2 2" />
                <circle cx="12" cy="12" r="10.5" strokeDasharray="1.5 2.5" />
              </svg>
              <span>{playing ? t('实况播放中', 'LIVE') : t('实况 LIVE', 'LIVE')}</span>
            </button>
            <button
              type="button"
              className="live-photo-sound-btn"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (videoRef.current) videoRef.current.muted = next;
              }}
              aria-label={muted ? t('开启实况声音', 'Unmute Live Photo') : t('静音实况', 'Mute Live Photo')}
              title={muted ? t('开启声音', 'Unmute') : t('静音', 'Mute')}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MemoryThumbnail({ item, onOpen }: { item: TravelMedia; onOpen: () => void }) {
  const { locale, t } = useI18n();
  const url = useMediaUrl(item.kind === 'photo' ? item.id : null, item.kind, true);
  const isLive = isLivePhotoMedia(item);
  const isGif = !isLive && isAnimatedImageMedia(item);
  return <button className="memory-thumb" onClick={onOpen} aria-label={t(`打开 ${item.fileName}`, `Open ${item.fileName}`)}>
    {item.kind === 'photo' && url ? <img src={url} alt={item.fileName} loading="lazy" /> :
      <span className="memory-video-icon">{item.kind === 'video' ? '▶' : '♪'}</span>}
    {isLive && <span className="memory-media-badge live" aria-label={t('实况照片', 'Live Photo')}>LIVE</span>}
    {isGif && <span className="memory-media-badge gif" aria-label={t('动态图', 'Animated GIF')}>GIF</span>}
    <small>{new Date(item.capturedAt).toLocaleDateString(locale)}</small>
  </button>;
}

function JourneyCover({ media, seed = 'trip', label }: { media: TravelMedia | undefined; seed?: string; label?: string }) {
  const { t } = useI18n();
  const url = useMediaUrl(media?.kind === 'photo' ? media.id : null, 'photo', true);
  return <div className="journey-cover">{url ? <img src={url} alt={t('旅行封面', 'Trip cover')} /> : <IllustratedJourneyCover seed={seed} label={label} />}</div>;
}

function SavedCityCard({ city, provinceName, photoId, onOpen }: {
  city: SavedCitySummary;
  provinceName: string;
  photoId?: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button className="saved-city-card" type="button" onClick={onOpen}>
      <span className="saved-city-cover">
        <JournalCover cityCode={city.code} photoId={photoId} />
        <span className="saved-city-province-pill">{provinceName}</span>
      </span>
      <span className="saved-city-caption">
        <strong className="saved-city-name">{city.name}</strong>
        <span className="saved-city-meta">
          {city.tripCount > 0 && <span>{t(`${city.tripCount} 次旅行`, `${city.tripCount} trips`)}</span>}
          {city.placeCount > 0 && <span>{t(`${city.placeCount} 个地点`, `${city.placeCount} places`)}</span>}
          {!city.tripCount && !city.placeCount && <span>{city.visited ? t('已点亮', 'Visited') : t('已保存', 'Saved')}</span>}
        </span>
        <span className="saved-city-arrow" aria-hidden="true">→</span>
      </span>
    </button>
  );
}

function AudioReview({ item, onDelete }: { item: TravelMedia; onDelete: (id: string) => void }) {
  const { locale, t } = useI18n();
  const url = useMediaUrl(item.id, 'audio', false);
  const [failed, setFailed] = useState(false);
  return <div className="audio-review-card">
    <div className="audio-review-head">
      <small>{new Date(item.capturedAt).toLocaleString(locale)}</small>
      <div className="audio-review-actions">
        {url && <a className="audio-action-btn" href={url} download={item.fileName || `audio-${item.id}.webm`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
          {t('下载', 'Download')}
        </a>}
        <button type="button" className="audio-action-btn danger" onClick={() => { if (window.confirm(t('删除这段语音评语？', 'Delete this voice note?'))) onDelete(item.id); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18m-2 0v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m-6 5v6m4-6v6" /></svg>
          {t('删除', 'Delete')}
        </button>
      </div>
    </div>
    <div className="audio-review">
      {url ? <audio src={url} controls preload="auto" onError={() => setFailed(true)} />
        : <span className="muted">{t('语音读取中；若长时间未显示，原始文件可能已丢失。', 'Loading audio… If it does not appear, the original file may be missing.')}</span>}
      {failed && <p role="alert">{t('这段录音无法播放，请下载检查或重新录制。', 'Unable to play this recording. Download to inspect or record again.')}</p>}
    </div>
  </div>;
}

/** 首次追加时将旧版文字作为第一条保留，不覆盖历史回忆。 */
function placeReviewNotes(place: JourneyPlace) {
  return place.reviewNotes ?? (place.reviewText.trim()
    ? [{ id: `legacy-${place.id}`, text: place.reviewText, createdAt: place.createdAt }] : []);
}

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Image EXIF wins; browsers normally expose only file time for video. */
async function readCaptureMetadata(file: File): Promise<{ date: Date; latitude: number | null; longitude: number | null }> {
  if (file.type.startsWith('image/') || /\.(jpe?g|heic|heif|webp|png)$/i.test(file.name)) {
    try {
      const metadata = await exifr.parse(file, { tiff: true, exif: true, gps: true }) as Record<string, unknown> | undefined;
      const date = parseExifDate(metadata?.DateTimeOriginal ?? metadata?.CreateDate ?? metadata?.ModifyDate);
      return { date: date ?? new Date(file.lastModified || Date.now()),
        latitude: typeof metadata?.latitude === 'number' ? metadata.latitude : null,
        longitude: typeof metadata?.longitude === 'number' ? metadata.longitude : null };
    } catch { /* A valid image without readable EXIF still has its file date. */ }
  }
  return { date: new Date(file.lastModified || Date.now()), latitude: null, longitude: null };
}

function isSupportedFile(file: File): boolean {
  return file.type.startsWith('image/')
    || file.type.startsWith('video/')
    || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|mov|mp4|m4v|webm|3gp|mkv)$/i.test(file.name);
}

function inferMediaMimeType(file: File, kind: 'photo' | 'video'): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (kind === 'video') {
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.m4v')) return 'video/x-m4v';
    if (lower.endsWith('.3gp')) return 'video/3gpp';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    return 'video/mp4';
  }
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}

/** A trip form can add cities from any province without loading all 34 maps. */
function JourneyEditor({ initial, initialCity, onSave, onCancel, onError, lockedCityCodes }: {
  initial: Journey | null;
  initialCity: CityMark | null;
  onSave: (trip: Journey) => Promise<unknown>;
  onCancel: () => void;
  onError: (message: string) => void;
  lockedCityCodes: string[];
}) {
  const { lang, t } = useI18n();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [status, setStatus] = useState<NonNullable<Journey['status']>>(initial?.status ?? 'visited');
  const [startDate, setStartDate] = useState(initial?.startDate ?? localDay(new Date()));
  const [endDate, setEndDate] = useState(initial?.endDate ?? localDay(new Date()));
  const [companions, setCompanions] = useState(initial?.companions.join('、') ?? '');
  const [cities, setCities] = useState<JourneyCity[]>(initial?.cities ?? (initialCity ? [{ code: initialCity.id, name: initialCity.name, provinceCode: initialCity.provinceCode }] : []));
  const [provinces, setProvinces] = useState<AdministrativeFeature[]>([]);
  const [provinceCode, setProvinceCode] = useState(initialCity?.provinceCode ?? initial?.cities[0]?.provinceCode ?? '');
  const [cityOptions, setCityOptions] = useState<AdministrativeFeature[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void loadNationalMap().then((data) => setProvinces(data.features)).catch(() => onError(t('全国地区列表加载失败', 'Failed to load regions'))); }, [onError]);
  useEffect(() => {
    if (!provinceCode) { setCityOptions([]); return; }
    let active = true;
    loadProvinceMap(provinceCode).then((data) => { if (active) setCityOptions(data.features); })
      .catch(() => { if (active) onError(t('该省城市列表加载失败', 'Failed to load cities for this province')); });
    return () => { active = false; };
  }, [provinceCode, onError]);

  function toggleCity(feature: AdministrativeFeature): void {
    const code = String(feature.properties.adcode);
    if (cities.some((city) => city.code === code)) {
      if (lockedCityCodes.includes(code)) { onError(t('这个城市已有地点，请先保留它', 'This city already has saved places and cannot be removed')); return; }
      setCities(cities.filter((city) => city.code !== code));
    } else {
      setCities([...cities, { code, name: feature.properties.name, provinceCode }]);
    }
  }

  async function submit(): Promise<void> {
    if (!startDate || !endDate || endDate < startDate) { onError(t('请填写正确的旅行起止日期', 'Please select valid start and end dates')); return; }
    if (!cities.length) { onError(t('请至少选择一座城市', 'Please select at least one city')); return; }
    setBusy(true);
    try {
      await onSave({ id: initial?.id ?? createLocalId(), title: title.trim() || t(`${cities[0].name}之旅`, `Trip to ${cities[0].name}`), status,
        startDate, endDate, cities,
        companions: [...new Set(companions.split(/[、,，\n]+/).map((name) => name.trim()).filter(Boolean))],
        createdAt: initial?.createdAt ?? new Date().toISOString() });
    } finally { setBusy(false); }
  }

  return <section className="card journey-editor">
    <div className="card-heading"><h2>{initial ? t('编辑旅行', 'Edit Trip') : t('新建一次旅行', 'New Trip')}</h2><button className="text-button" onClick={onCancel}>{t('取消', 'Cancel')}</button></div>
    <div className="entry-form">
      <label>{t('旅行名称', 'Trip Title')}<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('例如：贵州的夏天', 'e.g. Summer in Guizhou')} maxLength={40} /></label>
      <label>{t('开始日期', 'Start Date')}<ThemedDatePicker value={startDate} onChange={setStartDate} title={t('开始日期', 'Start Date')} required /></label>
      <label>{t('结束日期', 'End Date')}<ThemedDatePicker value={endDate} min={startDate} onChange={setEndDate} title={t('结束日期', 'End Date')} required /></label>
      <label>{t('同行者（可选）', 'Companions (optional)')}<input value={companions} onChange={(event) => setCompanions(event.target.value)} placeholder={t('用顿号分隔姓名', 'Separate names with commas')} /></label>
      <label>{t('旅行状态', 'Status')}<select value={status} onChange={(event) => setStatus(event.target.value as NonNullable<Journey['status']>)}><option value="visited">{t('已去过', 'Visited')}</option><option value="planned">{t('计划中', 'Planned')}</option></select></label>
    </div>
    <div className="city-picker"><strong>{t('这次旅行包含的城市', 'Cities in this trip')}</strong><div className="city-picker-selected">{cities.map((city) => <span key={city.code}>{city.name}<button aria-label={t(`移除 ${city.name}`, `Remove ${city.name}`)} onClick={() => {
      if (lockedCityCodes.includes(city.code)) onError(t('这个城市已有地点，请先保留它', 'This city already has saved places and cannot be removed'));
      else setCities(cities.filter((item) => item.code !== city.code));
    }}>×</button></span>)}</div>
      <label>{t('添加城市所在省份', 'Province')}<select value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}><option value="">{t('选择省份', 'Select province')}</option>{provinces.map((province) => {
        const pCode = String(province.properties.adcode);
        return <option key={pCode} value={pCode}>{provinceDisplayName(pCode, province.properties.name, lang)}</option>;
      })}</select></label>
      <div className="city-picker-options">{cityOptions.map((feature) => {
        const code = String(feature.properties.adcode);
        return <label key={code}><input type="checkbox" checked={cities.some((city) => city.code === code)} onChange={() => toggleCity(feature)} />{feature.properties.name}</label>;
      })}</div>
    </div>
    <button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? t('保存中…', 'Saving…') : t('保存旅行', 'Save Trip')}</button>
  </section>;
}

/** This page keeps a trip's cities and places together, like pages in a diary. */
export default function DetailView(props: DetailViewProps) {
  const { lang, locale, t } = useI18n();
  const { city, marks, trips, aiPlans, places, entries, media, targetEntryId, targetPlaceId, onSaveTrip, onSavePlace,
    onSaveEntry, onSaveMedia, onSaveMediaGroup, onUpdateMedia, onDeleteMedia,
    onUpdateMark, onSaveCityMark, onOpenMap, onError, onNotice, webTourMode = false, onRequireClient } = props;
  const [showAll, setShowAll] = useState(false);
  const [journalTab, setJournalTab] = useState<'journal' | 'tickets'>('journal');
  const [walletTripId, setWalletTripId] = useState<string | null>(null);
  const [recordQuery, setRecordQuery] = useState('');
  const [recordYear, setRecordYear] = useState('all');
  const [cityProvinceFilter, setCityProvinceFilter] = useState('all');
  // 折叠状态与省份筛选独立，重新展开时会保留之前选中的省份。
  const [savedCitiesExpanded, setSavedCitiesExpanded] = useState(true);
  const savedCitiesContentId = useId();
  const [browseCity, setBrowseCity] = useState<JourneyCity | null>(null);
  // 进入旅行手账时默认收起城市选择，只有用户点击入口才展开。
  const [cityBrowserOpen, setCityBrowserOpen] = useState(false);
  // 从计划进入时直接打开关联旅行里的地点，普通手账入口仍停留在旅行列表。
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => places.find((place) => place.id === targetPlaceId)?.tripId ?? null);
  const [editingTrip, setEditingTrip] = useState<Journey | 'new' | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(targetPlaceId ?? null);
  const [uploadCityCode, setUploadCityCode] = useState('');
  const [uploadPlaceId, setUploadPlaceId] = useState('');
  const [newPlaceName, setNewPlaceName] = useState('');
  const [placeVisitDate, setPlaceVisitDate] = useState(localDay(new Date()));
  const [reviewDraft, setReviewDraft] = useState('');
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const recordingBusyRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [uploadFeedbackPlaceId, setUploadFeedbackPlaceId] = useState<string | null>(null);
  const [recordingPlaceId, setRecordingPlaceId] = useState<string | null>(null);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [recordingMicLabel, setRecordingMicLabel] = useState('');
  const [provinceNames, setProvinceNames] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const memoryFileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const recordingPeakRef = useRef(0);
  const touchStartRef = useRef<number | null>(null);

  // A map click opens that city's records. The catalogue can override the
  // scope without changing the map's selected city or duplicating trips.
  const scopeCity = showAll ? null : browseCity ?? (city
    ? { code: city.id, name: city.name, provinceCode: city.provinceCode } : null);
  const scopeCityCode = scopeCity?.code ?? null;
  const scopeCityMark: CityMark | null = scopeCity
    ? city?.id === scopeCity.code ? city : {
      id: scopeCity.code, name: scopeCity.name, provinceCode: scopeCity.provinceCode,
      visited: false, planned: false, updatedAt: new Date(0).toISOString(),
    } : null;
  const visibleTrips = useMemo(() => trips.filter((trip) => (!scopeCityCode
    || trip.cities.some((item) => item.code === scopeCityCode))
    && (recordYear === 'all' || trip.startDate.startsWith(recordYear))
    && `${trip.title} ${trip.cities.map((item) => item.name).join(' ')}`.includes(recordQuery.trim()))
    .sort((a, b) => b.startDate.localeCompare(a.startDate)), [trips, scopeCityCode, recordQuery, recordYear]);
  const plannerPhotosByTrip = useMemo(() => findJournalPlannerPhotos(aiPlans), [aiPlans]);
  // A city is saved even before it belongs to a journey. Merge marks, journey
  // cities and standalone places by adcode so the overview cannot hide them.
  const savedCities = useMemo(() => {
    const byCode = new Map<string, SavedCitySummary>();
    const markByCode = new Map(marks.map((mark) => [mark.id, mark]));
    const ensureCity = (cityInfo: JourneyCity): SavedCitySummary => {
      const existing = byCode.get(cityInfo.code);
      if (existing) {
        if (existing.name === existing.code) existing.name = cityInfo.name;
        return existing;
      }
      const summary: SavedCitySummary = { ...cityInfo, tripCount: 0, placeCount: 0, visited: false };
      byCode.set(cityInfo.code, summary);
      return summary;
    };
    for (const mark of marks) if (mark.visited) {
      ensureCity({ code: mark.id, name: mark.name, provinceCode: mark.provinceCode }).visited = true;
    }
    for (const trip of trips) for (const tripCity of trip.cities) ensureCity(tripCity).tripCount += 1;
    for (const place of places) {
      const mark = markByCode.get(place.cityCode);
      const summary = ensureCity({ code: place.cityCode, name: mark?.name ?? place.cityCode,
        provinceCode: mark?.provinceCode ?? `${place.cityCode.slice(0, 2)}0000` });
      summary.placeCount += 1;
    }
    return [...byCode.values()].sort((a, b) => a.provinceCode.localeCompare(b.provinceCode)
      || a.name.localeCompare(b.name, 'zh-CN'));
  }, [marks, trips, places]);
  const savedCityGroups = useMemo(() => {
    const groups = new Map<string, SavedCitySummary[]>();
    for (const savedCity of savedCities) {
      const provinceCities = groups.get(savedCity.provinceCode);
      if (provinceCities) provinceCities.push(savedCity);
      else groups.set(savedCity.provinceCode, [savedCity]);
    }
    return [...groups.entries()];
  }, [savedCities]);
  // 单次遍历选出每座城市最近的照片，卡片只读取这一张的本地缩略图。
  const savedCityPhotos = useMemo(() => {
    const photos = new Map<string, TravelMedia>();
    for (const item of media) {
      if (item.kind !== 'photo') continue;
      const current = photos.get(item.cityCode);
      if (!current || item.capturedAt > current.capturedAt) photos.set(item.cityCode, item);
    }
    return photos;
  }, [media]);
  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;
  const selectedPlace = places.find((place) => place.id === selectedPlaceId) ?? null;
  // With no journey open, the place collection belongs directly to the city.
  const tripPlaces = selectedTrip ? places.filter((place) => place.tripId === selectedTrip.id)
    : scopeCityCode ? places.filter((place) => place.tripId === null && place.cityCode === scopeCityCode) : [];
  const uploadPlaces = tripPlaces.filter((place) => place.cityCode === uploadCityCode);
  const uploadCityName = selectedTrip?.cities.find((item) => item.code === uploadCityCode)?.name
    ?? (scopeCity?.code === uploadCityCode ? scopeCity.name : null)
    ?? marks.find((mark) => mark.id === uploadCityCode)?.name
    ?? '这座城市';
  const selectedUploadPlace = uploadPlaceId ? uploadPlaces.find((place) => place.id === uploadPlaceId) ?? null : null;
  const placeMedia = useMemo(() => media.filter((item) => item.placeId === selectedPlaceId && item.kind !== 'audio')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)), [media, selectedPlaceId]);
  const visibleMediaGroups = useMemo(() => {
    const groups = new Map<string, Array<{ item: TravelMedia; index: number }>>();
    placeMedia.slice(0, visibleCount).forEach((item, index) => {
      const captureDate = new Date(item.capturedAt);
      const period = periodFromDate(captureDate);
      const key = `${localDay(captureDate)} · ${{ morning: '上午', afternoon: '下午', evening: '晚上', 'all-day': '全天' }[period]}`;
      groups.set(key, [...(groups.get(key) ?? []), { item, index }]);
    });
    return [...groups.entries()];
  }, [placeMedia, visibleCount]);
  const selectedMedia = selectedMediaIndex === null ? null : placeMedia[selectedMediaIndex] ?? null;
  const fullMediaUrl = useMediaUrl(selectedMedia?.id ?? null, selectedMedia?.kind ?? 'photo', false);
  const liveMediaUrl = useLivePhotoVideoUrl(selectedMedia);

  async function downloadOriginalMedia(item: TravelMedia): Promise<void> {
    try {
      const original = await getMediaBlob(item.id);
      downloadBlob(original, item.fileName || `photo-${item.id}`);
    } catch (error) {
      onError(describeStorageError(error));
    }
  }

  useEffect(() => {
    let active = true;
    loadNationalMap().then((map) => {
      if (active) setProvinceNames(new Map(map.features.map((feature) =>
        [String(feature.properties.adcode), feature.properties.name])));
    }).catch(() => { /* Numeric province codes remain usable offline. */ });
    return () => { active = false; };
  }, []);

  function openSavedCity(savedCity: JourneyCity): void {
    setBrowseCity({ code: savedCity.code, name: savedCity.name, provinceCode: savedCity.provinceCode });
    setShowAll(false);
    setCityBrowserOpen(false);
    setSelectedTripId(null);
    setSelectedPlaceId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** 清除城市和详情选择，回到总览，同时保留之前的列表筛选。 */
  function returnToJournalOverview(): void {
    setShowAll(true);
    setBrowseCity(null);
    setCityBrowserOpen(false);
    setSelectedTripId(null);
    setSelectedPlaceId(null);
    setEditingTrip(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!targetEntryId) return;
    const entry = entries.find((item) => item.id === targetEntryId);
    if (entry) { setSelectedTripId(entry.tripId); setSelectedPlaceId(entry.placeId); }
  }, [targetEntryId, entries]);
  useEffect(() => {
    setReviewDraft('');
    setEditingReviewId(null);
    setVisibleCount(PAGE_SIZE);
    setSelectedMediaIndex(null);
  }, [selectedPlaceId]);
  useEffect(() => {
    if (selectedTrip) {
      setUploadCityCode(city && selectedTrip.cities.some((item) => item.code === city.id) ? city.id : selectedTrip.cities[0]?.code ?? '');
      setUploadPlaceId('');
    } else {
      setUploadCityCode(scopeCityCode ?? '');
      setUploadPlaceId('');
    }
  }, [selectedTripId, scopeCityCode]);
  useEffect(() => () => {
    // 等待 stop 的最终数据事件后再释放麦克风，保留完整尾帧。
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (meterTimerRef.current !== null) { window.clearInterval(meterTimerRef.current); meterTimerRef.current = null; }
    if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => undefined); audioCtxRef.current = null; }
  }, []);
  useEffect(() => {
    if (recordingPlaceId && recordingPlaceId !== selectedPlaceId && recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, [recordingPlaceId, selectedPlaceId]);
  useEffect(() => {
    if (selectedMediaIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMediaIndex(null);
      if (event.key === 'ArrowRight') setSelectedMediaIndex((old) => old === null ? null : Math.min(placeMedia.length - 1, old + 1));
      if (event.key === 'ArrowLeft') setSelectedMediaIndex((old) => old === null ? null : Math.max(0, old - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMediaIndex, placeMedia.length]);

  async function saveTrip(trip: Journey): Promise<void> {
    try {
      if (editingTrip !== 'new' && editingTrip) {
        const outside = media.filter((item) => item.tripId === trip.id
          && (localDay(new Date(item.capturedAt)) < trip.startDate || localDay(new Date(item.capturedAt)) > trip.endDate));
        if (outside.length && !window.confirm(`${outside.length} 个已上传文件的日期将落在新的旅行日期之外。仍保存吗？`)) return;
      }
      const linked = await onSaveTrip(trip);
      setSelectedTripId(trip.id);
      setSelectedPlaceId(null);
      setEditingTrip(null);
      onNotice(linked.places
        ? `旅行已保存，已自动归入 ${linked.places} 个地点、${linked.media} 份媒体。`
        : '旅行已保存；日期未匹配的城市记录仍保留在城市页。');
    } catch { /* App reports the persistence error. */ }
  }

  async function createPlace(): Promise<void> {
    if (!uploadCityCode || !newPlaceName.trim()) { onError('请先选择城市并填写地点名称'); return; }
    if (!selectedTrip && !placeVisitDate) { onError('请填写地点记录日期'); return; }
    const place: JourneyPlace = { id: createLocalId(), tripId: selectedTrip?.id ?? null,
      cityCode: uploadCityCode, name: newPlaceName.trim(), reviewText: '', reviewAudioId: null,
      // A city-only text or voice memory needs a visit date for later matching.
      createdAt: selectedTrip ? new Date().toISOString() : new Date(`${placeVisitDate}T12:00:00`).toISOString() };
    try {
      await onSavePlace(place);
      // A city chosen from the province catalogue may have no map mark yet.
      // Starting its collection also lights it as visited on the map.
      if (!selectedTrip && scopeCityMark && !scopeCityMark.visited) {
        await onSaveCityMark({ ...scopeCityMark, visited: true, planned: false, updatedAt: new Date().toISOString() });
      }
      setUploadPlaceId(place.id);
      setNewPlaceName('');
      onNotice(`已创建地点：${place.name}`);
    }
    catch { /* App reports the persistence error. */ }
  }

  async function ensureWholeCityPlace(): Promise<JourneyPlace | null> {
    if (!uploadCityCode) { onError('请先选择城市'); return null; }
    const activeTripId = selectedTrip?.id ?? null;
    const existing = places.find((place) =>
      place.tripId === activeTripId && place.cityCode === uploadCityCode && place.name === uploadCityName);
    if (existing) return existing;
    const visitDate = placeVisitDate || localDay(new Date());
    const place: JourneyPlace = {
      id: createLocalId(),
      tripId: activeTripId,
      cityCode: uploadCityCode,
      name: uploadCityName,
      reviewText: '',
      reviewAudioId: null,
      createdAt: selectedTrip ? new Date().toISOString() : new Date(`${visitDate}T12:00:00`).toISOString(),
    };
    try {
      await onSavePlace(place);
      if (!selectedTrip && scopeCityMark && !scopeCityMark.visited) {
        await onSaveCityMark({ ...scopeCityMark, visited: true, planned: false, updatedAt: new Date().toISOString() });
      }
      return place;
    } catch {
      return null;
    }
  }

  async function openCurrentMemoryBook(): Promise<void> {
    const target = selectedUploadPlace ?? await ensureWholeCityPlace();
    if (target) setSelectedPlaceId(target.id);
  }

  async function uploadFiles(files: FileList | null, memoryPlace?: JourneyPlace): Promise<void> {
    // Snapshot FileList immediately before any await so mobile/desktop WebViews cannot clear or invalidate it.
    const pickedFiles = files ? Array.from(files) : [];
    if (!pickedFiles.length || (!memoryPlace && !uploadCityCode)) return;
    // 地点页直接使用本条地点的城市和旅行，避免上传区之前所选的其他城市影响归档。
    const selectedPlaceForUpload = memoryPlace ?? (uploadPlaceId ? selectedUploadPlace : await ensureWholeCityPlace());
    if (!selectedPlaceForUpload) { onError('请先选择已保存的地点'); return; }
    const { cityCode: targetCityCode, tripId: activeTripId } = selectedPlaceForUpload;
    const targetTrip = trips.find((trip) => trip.id === activeTripId);
    const targetPlaceId = selectedPlaceForUpload.id;
    const candidates: Array<{ file: File; date: Date; latitude: number | null; longitude: number | null }> = [];
    const failures: string[] = [];
    setUploadFeedbackPlaceId(targetPlaceId);
    setUploadFailures([]);
    setUploadProgress('正在读取拍摄时间…');
    try {
      for (const file of pickedFiles) {
        if (!isSupportedFile(file)) { failures.push(`${file.name}：不支持的格式`); continue; }
        try { candidates.push({ file, ...await readCaptureMetadata(file) }); }
        catch { failures.push(`${file.name}：无法读取文件`); }
      }
      // The chosen city/place remains authoritative. GPS can warn about a
      // mistaken batch without silently moving photos to a different journey.
      const gpsMismatches: string[] = [];
      for (const candidate of candidates) {
        if (candidate.latitude === null || candidate.longitude === null) continue;
        try {
          const matched = await cityFromGps(candidate.latitude, candidate.longitude);
          if (matched && String(matched.properties.adcode) !== targetCityCode) gpsMismatches.push(candidate.file.name);
        } catch { /* Offline geometry may be unavailable; manual city still works. */ }
      }
      if (gpsMismatches.length && !window.confirm(`${gpsMismatches.length} 个文件的 GPS 城市与所选城市不同。仍按所选城市导入吗？`)) {
        setUploadFailures(gpsMismatches.map((name) => `${name}：请重新选择城市后上传`));
        return;
      }
      const outside = targetTrip ? candidates.filter(({ date }) => localDay(date) < targetTrip.startDate || localDay(date) > targetTrip.endDate) : [];
      const includeOutside = !outside.length || window.confirm(`${outside.length} 个文件的拍摄或文件日期不在旅行日期内。确定：仍导入；取消：跳过这些文件。`);
      const accepted = includeOutside ? candidates : candidates.filter((item) => !outside.includes(item));
      if (!includeOutside) failures.push(...outside.map(({ file }) => `${file.name}：日期不在旅行范围，已跳过`));

      // Pair iOS Live Photo uploads (e.g. IMG_0001.HEIC/.JPG + IMG_0001.MOV) into single Live Photo entries.
      const pairedAccepted = pairLivePhotoItems(accepted);

      // Chunk by both item count and total bytes so large videos/photos save in
      // small transactions without spiking WebView memory.
      const MAX_BATCH_COUNT = 5;
      const MAX_BATCH_BYTES = 12 * 1024 * 1024;
      const batches: Array<typeof pairedAccepted> = [];
      let currentBatch: typeof pairedAccepted = [];
      let currentBytes = 0;
      for (const pair of pairedAccepted) {
        const size = (pair.item.file.size || 0) + (pair.companionVideoFile?.size || 0);
        const isVideo = pair.item.file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp|mkv)$/i.test(pair.item.file.name);
        const isLivePair = Boolean(pair.companionVideoFile);
        if (currentBatch.length > 0 && (isVideo || isLivePair || currentBatch.length >= MAX_BATCH_COUNT || currentBytes + size > MAX_BATCH_BYTES)) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBytes = 0;
        }
        currentBatch.push(pair);
        currentBytes += size;
        if (isVideo || isLivePair || size > MAX_BATCH_BYTES) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBytes = 0;
        }
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      const workingEntries = [...entries];
      const buildBatchPayload = async (group: typeof pairedAccepted) => {
        const previewEntries = [...workingEntries];
        const newEntries: DayEntry[] = [];
        const items: Array<{ media: TravelMedia; blob: Blob; liveVideoBlob?: Blob | null }> = [];
        for (const { item: { file, date, latitude, longitude }, companionVideoFile } of group) {
          const day = localDay(date);
          const period = periodFromDate(date);
          let entry = previewEntries.find((row) => row.tripId === activeTripId
            && row.placeId === targetPlaceId && row.date === day && row.period === period);
          if (!entry) {
            entry = { id: createLocalId(), tripId: activeTripId, placeId: targetPlaceId,
              cityCode: targetCityCode, date: day, period, note: '', place: selectedPlaceForUpload.name,
              order: Date.now() + previewEntries.length, highlight: false };
            previewEntries.push(entry);
            newEntries.push(entry);
          }
          const kind = file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp|mkv)$/i.test(file.name) ? 'video' : 'photo';
          const mimeType = inferMediaMimeType(file, kind);
          const mediaId = createLocalId();
          let liveVideoId: string | null = null;
          let liveVideoOffset: number | null = null;
          let liveVideoLength: number | null = null;
          let liveVideoMimeType: string | null = null;

          if (kind === 'photo' && companionVideoFile) {
            liveVideoId = `${mediaId}:live`;
            liveVideoMimeType = inferMediaMimeType(companionVideoFile, 'video');
          } else if (kind === 'photo' && (mimeType === 'image/jpeg' || /\.jpe?g$/i.test(file.name))) {
            try {
              const rawBytes = new Uint8Array(await file.arrayBuffer());
              const motion = detectMotionPhoto(rawBytes);
              if (motion) {
                liveVideoOffset = motion.offset;
                liveVideoLength = motion.length;
                liveVideoMimeType = motion.mimeType;
              }
            } catch { /* Keep lossless still photo even if motion metadata scan fails. */ }
          }

          const mediaItem: TravelMedia = { id: mediaId, cityCode: targetCityCode,
            tripId: activeTripId, placeId: targetPlaceId, entryId: entry.id,
            kind, fileName: file.name, mimeType,
            capturedAt: date.toISOString(), placeName: selectedPlaceForUpload.name,
            latitude, longitude, fileSize: file.size || undefined,
            liveVideoId, liveVideoOffset, liveVideoLength, liveVideoMimeType };
          items.push({ media: mediaItem, blob: file as Blob, liveVideoBlob: companionVideoFile ?? null });
        }
        return { items, newEntries };
      };

      let completed = 0;
      let stoppedByQuota = false;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const { items, newEntries } = await buildBatchPayload(batch);
        try {
          await onSaveMediaGroup(items, newEntries);
          workingEntries.push(...newEntries);
          completed += items.length;
          setUploadProgress(`已保存 ${completed} / ${pairedAccepted.length} 个文件`);
        } catch (error) {
          if (isQuotaStorageError(error)) {
            const reason = describeStorageError(error);
            const remaining = batches.slice(batchIndex).flat();
            failures.push(...remaining.map(({ item: { file } }) => `${file.name}：保存失败（${reason}）`));
            onError(reason);
            stoppedByQuota = true;
            break;
          }
          if (batch.length === 1) {
            const reason = describeStorageError(error);
            failures.push(`${batch[0].item.file.name}：保存失败（${reason}）`);
            onError(reason);
            continue;
          }
          // Isolate single bad files so one failed item never blocks the rest of the batch.
          for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
            const single = batch[itemIndex];
            const singlePayload = await buildBatchPayload([single]);
            try {
              await onSaveMediaGroup(singlePayload.items, singlePayload.newEntries);
              workingEntries.push(...singlePayload.newEntries);
              completed += 1;
              setUploadProgress(`已保存 ${completed} / ${pairedAccepted.length} 个文件`);
            } catch (singleError) {
              const reason = describeStorageError(singleError);
              if (isQuotaStorageError(singleError)) {
                const remaining = [...batch.slice(itemIndex), ...batches.slice(batchIndex + 1).flat()];
                failures.push(...remaining.map(({ item: { file } }) => `${file.name}：保存失败（${reason}）`));
                onError(reason);
                stoppedByQuota = true;
                break;
              }
              failures.push(`${single.item.file.name}：保存失败（${reason}）`);
            }
          }
          if (stoppedByQuota) break;
        }
      }
      setUploadFailures(failures);
      if (completed) onNotice(`已导入 ${completed} 个文件至 ${selectedPlaceForUpload.name}${failures.length ? `；${failures.length} 个未导入` : ''}。`);
      if (!completed && failures.length) onError(`${failures.length} 个文件未导入，请查看下方原因`);
    } finally {
      setUploadProgress('');
      const input = memoryPlace ? memoryFileInputRef.current : fileInputRef.current;
      if (input) input.value = '';
    }
  }

  /** 默认追加，明确点击编辑才修改原条目；保留旧版单条记录。 */
  async function saveReview(place: JourneyPlace): Promise<void> {
    const text = reviewDraft.trim();
    if (!text || savingReview) return;
    setSavingReview(true);
    try {
      const notes = placeReviewNotes(place);
      const reviewNotes = editingReviewId
        ? notes.map((note) => note.id === editingReviewId ? { ...note, text } : note)
        : [...notes, { id: createLocalId(), text, createdAt: new Date().toISOString() }];
      await onSavePlace({ ...place, reviewNotes, reviewText: reviewNotes.map((note) => note.text).join('\n\n') });
      setReviewDraft('');
      setEditingReviewId(null);
      onNotice('地点评语已保存。');
    } catch { onError('文字保存失败，输入内容已保留，请重试'); }
    finally { setSavingReview(false); }
  }

  async function deleteReview(place: JourneyPlace, noteId: string): Promise<void> {
    if (savingReview) return;
    if (!window.confirm('删除这条文字回忆？')) return;
    setSavingReview(true);
    try {
      const reviewNotes = placeReviewNotes(place).filter((note) => note.id !== noteId);
      await onSavePlace({ ...place, reviewNotes, reviewText: reviewNotes.map((note) => note.text).join('\n\n') });
      if (editingReviewId === noteId) {
        setEditingReviewId(null);
        setReviewDraft('');
      }
      onNotice('文字回忆已删除。');
    } catch { onError('删除失败，请重试'); }
    finally { setSavingReview(false); }
  }

  function cleanupAudioMeter(): void {
    if (meterTimerRef.current !== null) { window.clearInterval(meterTimerRef.current); meterTimerRef.current = null; }
    if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => undefined); audioCtxRef.current = null; }
    setRecordingLevel(0);
    setRecordingMicLabel('');
  }

  /** 每段录音等待最后一个数据事件落盘后才允许开始下一段。 */
  async function toggleRecording(place: JourneyPlace): Promise<void> {
    if (webTourMode) {
      onRequireClient?.('voice');
      return;
    }
    if (recordingPlaceId === place.id) {
      if (recorderRef.current?.state === 'recording') { setAudioBusy(true); recorderRef.current.stop(); }
      return;
    }
    if (recordingBusyRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { onError('录音需要支持麦克风的 HTTPS 或 localhost 浏览器'); return; }
    recordingBusyRef.current = true;
    setAudioBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const trackLabel = stream.getAudioTracks()[0]?.label || '默认麦克风';
      setRecordingMicLabel(trackLabel);
      recordingPeakRef.current = 0;
      try {
        const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor) {
          const ctx = new AudioContextCtor();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          audioCtxRef.current = ctx;
          meterTimerRef.current = window.setInterval(() => {
            analyser.getByteTimeDomainData(samples);
            let peak = 0;
            for (let i = 0; i < samples.length; i += 1) {
              const amp = Math.abs(samples[i] - 128) / 128;
              if (amp > peak) peak = amp;
            }
            if (peak > recordingPeakRef.current) recordingPeakRef.current = peak;
            setRecordingLevel(Math.min(100, Math.round(peak * 220)));
          }, 80);
        }
      } catch { /* Volume meter is advisory; recording still proceeds. */ }
      // 使用浏览器支持的真实编码，Safari 可以回退到 MP4。
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.onerror = () => { failed = true; onError('录音中断，请检查麦克风后重新录制'); };
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        setAudioBusy(true);
        const peak = recordingPeakRef.current;
        cleanupAudioMeter();
        try {
          // stop 后 mimeType 可能被浏览器清空，优先采用实际数据块的类型。
          const blob = new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType || mimeType });
          if (failed || !blob.size) throw new Error('没有录到有效声音，请重新录制');
          const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
          const id = createLocalId();
          const item: TravelMedia = { id, cityCode: place.cityCode, tripId: place.tripId,
            placeId: place.id, entryId: null, kind: 'audio', fileName: `地点语音-${place.name}-${Date.now()}.${extension}`,
            mimeType: blob.type, capturedAt: new Date().toISOString(), placeName: place.name,
            latitude: null, longitude: null };
          // 通过 placeId 关联全部语音，不再写回旧地点快照覆盖录音期间保存的文字。
          await onSaveMedia(item, blob);
          onNotice(peak < 0.005
            ? '录音已保存，但未检测到明显人声输入；请检查系统麦克风，或用系统 Chrome / Edge 打开本页试听。'
            : '地点语音已保存，可继续录制下一段。');
        } catch (error) { onError(error instanceof Error ? error.message : '语音保存失败'); }
        finally {
          stream?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          recorderRef.current = null;
          setRecordingPlaceId(null);
          recordingBusyRef.current = false;
          setAudioBusy(false);
        }
      };
      setRecordingPlaceId(place.id);
      recorder.start(250);
      setAudioBusy(false);
    } catch (error) {
      cleanupAudioMeter();
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      recordingBusyRef.current = false;
      setRecordingPlaceId(null);
      setAudioBusy(false);
      onError(error instanceof Error ? error.message : '无法使用麦克风');
    }
  }

  async function changeMediaDate(item: TravelMedia, date: string): Promise<void> {
    if (!date) return;
    const oldDate = new Date(item.capturedAt);
    const time = `${String(oldDate.getHours()).padStart(2, '0')}:${String(oldDate.getMinutes()).padStart(2, '0')}`;
    await onUpdateMedia({ ...item, capturedAt: new Date(`${date}T${time}`).toISOString(), entryId: null });
  }

  return <div className="content-page journal-page">
    <div className="section-heading">
      <div>
        {scopeCity && <button type="button" className="secondary journal-back-button" onClick={returnToJournalOverview}>
          <span aria-hidden="true">←</span> {t('返回手账总览', 'Back to Journal')}
        </button>}
        <span className="eyebrow">MEMORY JOURNAL</span>
        <h1>{scopeCity ? t(`${scopeCity.name} · 旅行手账`, `${scopeCity.name} · Journal`) : t('我的旅行手账', 'My Travel Journal')}</h1>
        <p>{t('一段旅程、几座城市，把每个地点的照片和故事收在一起。', 'One journey, many cities—keep photos and stories from every stop together.')}</p>
      </div>
      <div className="heading-actions">
        <div className="journal-mode-tabs" role="tablist" aria-label={t('手账与票夹切换', 'Journal and Ticket Wallet')}>
          <button
            type="button"
            role="tab"
            aria-selected={journalTab === 'journal'}
            className={journalTab === 'journal' ? 'is-active' : ''}
            onClick={() => setJournalTab('journal')}
          >
            📖 {t('旅行手账', 'Journal')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={journalTab === 'tickets'}
            className={journalTab === 'tickets' ? 'is-active' : ''}
            onClick={() => {
              setWalletTripId(selectedTrip?.id ?? null);
              setJournalTab('tickets');
            }}
          >
            🎫 {t('出行票夹', 'Ticket Wallet')}
          </button>
        </div>
        {journalTab === 'journal' && (
          <>
            <button type="button" className="secondary" onClick={() => { setCityBrowserOpen(!cityBrowserOpen); setSelectedTripId(null); setSelectedPlaceId(null); }}>
              {cityBrowserOpen ? t('收起城市选择', 'Hide City Browser') : t('按省份选择城市', 'Browse by Province')}
            </button>
            {onOpenMap && (
              <button type="button" className="secondary" onClick={onOpenMap}>
                {t('去地图选择城市', 'Pick on Map')}
              </button>
            )}
            <button type="button" className="primary" onClick={() => { setEditingTrip('new'); setSelectedTripId(null); setSelectedPlaceId(null); }}>{t('＋ 新建旅行', '+ New Trip')}</button>
          </>
        )}
      </div>
    </div>
    {journalTab === 'tickets' ? (
      <TicketWalletView
        trips={trips}
        initialTripId={walletTripId}
        onNotice={onNotice}
        onError={onError}
      />
    ) : <>
    {cityBrowserOpen && !selectedTrip && !editingTrip && <TravelCityBrowser trips={trips} places={places} marks={marks} selectedCityCode={scopeCityCode} onSelectCity={(pickedCity) => { setBrowseCity(pickedCity); setShowAll(false); setSelectedTripId(null); }} onShowAll={() => { setShowAll(true); setBrowseCity(null); setCityBrowserOpen(false); setSelectedTripId(null); }} onOpenMap={onOpenMap} onError={onError} />}
    {city && !browseCity && !showAll && !selectedTrip && <div className="card status-card"><div><strong>{t(`${city.name}的城市状态`, `${city.name} Status`)}</strong><p>{trips.some((trip) => trip.cities.some((item) => item.code === city.id && trip.status !== 'planned')) ? t('这座城市已包含在去过的旅行中，地图会保持点亮。', 'This city is part of a visited trip and stays lit on the map.') : t('确认去过的城市会点亮地图，也可以在这里取消手动标记。', 'Marked cities light up the map. You can toggle manual marks here.')}</p></div><label className="checkbox"><input type="checkbox" checked={city.visited} disabled={trips.some((trip) => trip.status !== 'planned' && trip.cities.some((item) => item.code === city.id))} onChange={(event) => void onUpdateMark(event.target.checked)} />{t('已去过', 'Visited')}</label></div>}
    {editingTrip && <JourneyEditor key={editingTrip === 'new' ? 'new' : editingTrip.id} initial={editingTrip === 'new' ? null : editingTrip} initialCity={scopeCityMark} lockedCityCodes={editingTrip === 'new' ? [] : places.filter((place) => place.tripId === editingTrip.id).map((place) => place.cityCode)} onSave={saveTrip} onCancel={() => setEditingTrip(null)} onError={onError} />}
    {!selectedTrip && !editingTrip && !scopeCity && <>
      <JournalWelcome trips={trips} places={places} media={media} marks={marks} plannerPhotosByTrip={plannerPhotosByTrip} onOpenCity={openSavedCity} onStart={() => setCityBrowserOpen(true)} onNewTrip={() => { setEditingTrip('new'); setSelectedTripId(null); setSelectedPlaceId(null); }} onOpen={(tripId, place) => {
        setSelectedTripId(tripId);
        if (place && !tripId) {
          const mark = marks.find((item) => item.id === place.cityCode);
          setBrowseCity({ code: place.cityCode, name: mark?.name ?? place.cityCode, provinceCode: mark?.provinceCode ?? `${place.cityCode.slice(0, 2)}0000` });
          setShowAll(false);
        }
        setSelectedPlaceId(place?.id ?? null);
      }} />
      <div className="warm-record-filter">
        <div className="record-filter-title">
          <span className="record-filter-badge cute-deco" aria-hidden="true">✦</span>
          <h2>{t('我的旅行小册', 'My Travel Booklets')}</h2>
        </div>
        <div className="record-filter-controls">
          <label className="record-search-box">
            <span className="record-search-label">{t('找一段回忆', 'Search')}</span>
            <input aria-label={t('搜索旅行', 'Search trips')} value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder={t('搜索旅行名称或城市…', 'Search trip title or city…')} />
          </label>
          <select aria-label={t('旅行年份', 'Trip year')} value={recordYear} onChange={(event) => setRecordYear(event.target.value)}>
            <option value="all">{t('全部年份', 'All Years')}</option>
            {[...new Set(trips.map((trip) => trip.startDate.slice(0, 4)))].sort().reverse().map((year) => <option key={year}>{year}</option>)}
          </select>
        </div>
      </div>
    </>}
    {(selectedTrip || scopeCity) && !editingTrip && <>
      {selectedTrip ? <div className="journal-trip-hero"><span className="washi-tape tape-top-right" aria-hidden="true" /><CuteSticker kind="plane" className="trip-hero-plane" /><button className="text-button" onClick={() => { setSelectedTripId(null); setSelectedPlaceId(null); }}>{t('← 返回城市记录与旅行列表', '← Back to Trips & Cities')}</button><span className="eyebrow">{selectedTrip.startDate} — {selectedTrip.endDate}</span><h2>{selectedTrip.title}</h2><p>{selectedTrip.cities.map((item) => item.name).join(' · ')}</p>{selectedTrip.companions.length > 0 && <small>{t(`与 ${selectedTrip.companions.join('、')} 同行`, `With ${selectedTrip.companions.join(', ')}`)}</small>}<button className="secondary" onClick={() => setEditingTrip(selectedTrip)}>{t('编辑旅行', 'Edit Trip')}</button></div>
        : scopeCity && <div className="city-record-hero">
          <span className="washi-tape tape-top-right" aria-hidden="true" />
          <CuteSticker kind="stamp" className="trip-hero-plane" />
          <span className="eyebrow">CITY MEMORIES</span>
          <h2>{t(`${scopeCity.name}的城市记录`, `${scopeCity.name} Memories`)}</h2>
          <p>{t('先记录地点、照片和评语。创建包含这座城市的旅行后，日期匹配的记录会自动归入。', 'Log places, photos, and notes first. Matching entries will auto-link once you create a trip for this city.')}</p>
          <CityGuideLinks cities={[scopeCity.name]} />
        </div>}
      <section className={`card upload-station ${selectedTrip ? '' : 'city-upload-station'}`}>
        <div className="card-heading"><h2>{t('记录城市或地点', 'Add City or Place Memory')}</h2><span>{t('不选地点会直接记到整个市', 'Leave place blank to save under the city')}</span></div>
        <div className="entry-form">
          <label>{t('城市', 'City')}{selectedTrip ? <select value={uploadCityCode} onChange={(event) => { setUploadCityCode(event.target.value); setUploadPlaceId(''); }}>{selectedTrip.cities.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
            : <input value={scopeCity?.name ?? ''} readOnly />}</label>
          <label>{t('已有地点（可选）', 'Existing Place (optional)')}<select value={uploadPlaceId} onChange={(event) => setUploadPlaceId(event.target.value)}><option value="">{t(`整个${uploadCityName}（不选具体地点）`, `All of ${uploadCityName}`)}</option>{uploadPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
          <label>{t('或新建地点', 'Or New Place')}<input value={newPlaceName} onChange={(event) => setNewPlaceName(event.target.value)} placeholder={t('例如：黄果树瀑布', 'e.g. Erhai Lake')} /></label>
          {!selectedTrip && <label>{t('地点记录日期', 'Visit Date')}<ThemedDatePicker value={placeVisitDate} onChange={setPlaceVisitDate} title={t('地点记录日期', 'Visit Date')} /></label>}
          <button className="secondary" onClick={() => void createPlace()} disabled={!newPlaceName.trim()}>{t('创建地点', 'Create Place')}</button>
        </div>
        <div className="heading-actions">
          <button
            className="primary"
            disabled={!uploadCityCode || Boolean(uploadProgress)}
            onClick={() => {
              if (webTourMode) {
                onRequireClient?.('photo');
                return;
              }
              fileInputRef.current?.click();
            }}
          >
            {webTourMode
              ? t('🔒 上传照片 / 视频（下载客户端解锁）', '🔒 Upload Photos / Videos (Client Only)')
              : (uploadProgress || (selectedUploadPlace ? t(`上传照片 / 视频到「${selectedUploadPlace.name}」`, `Upload Photos / Videos to "${selectedUploadPlace.name}"`) : t(`上传照片 / 视频到整个${uploadCityName}`, `Upload Photos / Videos to ${uploadCityName}`)))}
          </button>
          <button className="secondary" disabled={!uploadCityCode || Boolean(uploadProgress)} onClick={() => void openCurrentMemoryBook()}>{selectedUploadPlace ? t(`写下「${selectedUploadPlace.name}」的文字 / 语音`, `Write Note / Voice for "${selectedUploadPlace.name}"`) : t(`写下整个${uploadCityName}的文字 / 语音`, `Write Note / Voice for ${uploadCityName}`)}</button>
        </div>
        {!webTourMode && <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif,.mov" hidden onChange={(event) => void uploadFiles(event.target.files)} />}
        <p className="muted">{webTourMode
          ? t('当前为在线体验模式：支持点亮地图、创建地点与写文字便签；原图照片与视频归档请下载客户端使用。', 'Web Tour mode supports lighting cities and writing notes; photo & video storage requires the client.')
          : `${t('原图无损保存，支持实况照片（iPhone 实况 / 安卓动态照片）与 GIF 动态图；不填具体地点也可直接按城市整理。', 'Lossless originals preserved, including Live Photos / Motion Photos and animated GIFs. ')}${selectedTrip ? t('日期超出旅程范围会先提示。', 'Dates outside trip range will prompt first.') : t('无需先新建旅行。', 'No trip required first.')}`}</p>
        {uploadFailures.length > 0 && <div className="upload-failures" role="alert"><strong>{t(`${uploadFailures.length} 个文件未导入`, `${uploadFailures.length} files skipped`)}</strong><ul>{uploadFailures.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></div>}
      </section>
      <div className="journal-places">{(selectedTrip?.cities ?? (scopeCity ? [scopeCity] : [])).map((tripCity) => <section key={tripCity.code}><h3>{t(`${tripCity.name} · 地点记忆`, `${tripCity.name} · Places`)}</h3><div className="place-card-grid">{tripPlaces.filter((place) => place.cityCode === tripCity.code).map((place) => {
        const placeItems = media.filter((item) => item.placeId === place.id && item.kind !== 'audio');
        const cover = placeItems.find((item) => item.kind === 'photo');
        return <button className="place-card" key={place.id} onClick={() => setSelectedPlaceId(place.id)}><JourneyCover media={cover} seed={place.id} label={tripCity.name} /><div><span className="eyebrow">{t(`${placeItems.length} 张旅行片段`, `${placeItems.length} moments`)}</span><h4>{place.name}</h4><p>{place.reviewText || t('翻开这一页，写下这里的回忆。', 'Open this page to write down your memories.')}</p></div></button>;
      })}</div></section>)}</div>
    </>}
    {!selectedTrip && !editingTrip && !scopeCity && savedCities.length > 0 && (
      <section className="card saved-city-overview" aria-label={t('已保存的城市', 'Saved Cities')}>
        <div className="saved-city-heading">
          <h2>{t(`已保存的城市 · ${savedCities.length}`, `Saved Cities · ${savedCities.length}`)}</h2>
          <button
            type="button"
            className="secondary saved-city-toggle"
            aria-expanded={savedCitiesExpanded}
            aria-controls={savedCitiesContentId}
            onClick={() => setSavedCitiesExpanded((expanded) => !expanded)}
          >
            {savedCitiesExpanded ? t('收起', 'Collapse') : t('展开', 'Expand')}
          </button>
        </div>
        <div id={savedCitiesContentId} className="saved-city-content" hidden={!savedCitiesExpanded}>
          <p className="muted">{t('像收集城市邮票一样，点选任意城市即可翻看照片、地点与短记。', 'Select any city like a travel stamp to browse its photos, places, and notes.')}</p>
          {savedCityGroups.length > 1 && (
            <div className="saved-city-province-tabs" role="tablist" aria-label={t('按省份筛选已保存城市', 'Filter saved cities by province')}>
              <button type="button" className={cityProvinceFilter === 'all' ? 'active' : ''} onClick={() => setCityProvinceFilter('all')}>
                {t(`全部 ${savedCities.length}`, `All ${savedCities.length}`)}
              </button>
              {savedCityGroups.map(([provinceCode, cities]) => (
                <button
                  type="button"
                  key={provinceCode}
                  className={cityProvinceFilter === provinceCode ? 'active' : ''}
                  onClick={() => setCityProvinceFilter(provinceCode)}
                >
                  {provinceDisplayName(provinceCode, provinceNames.get(provinceCode) ?? provinceCode, lang, true)} · {cities.length}
                </button>
              ))}
            </div>
          )}
          {savedCitiesExpanded && <div className="saved-city-grid">
            {savedCities
              .filter((savedCity) => cityProvinceFilter === 'all' || savedCity.provinceCode === cityProvinceFilter)
              .map((savedCity) => (
                <SavedCityCard
                  key={savedCity.code}
                  city={savedCity}
                  provinceName={provinceDisplayName(savedCity.provinceCode, provinceNames.get(savedCity.provinceCode) ?? `${savedCity.provinceCode.slice(0, 2)}地区`, lang, true)}
                  photoId={savedCityPhotos.get(savedCity.code)?.id}
                  onOpen={() => openSavedCity(savedCity)}
                />
              ))}
          </div>}
        </div>
      </section>
    )}
    {!selectedTrip && !editingTrip && !scopeCity && visibleTrips.length > 0 && <div className="card-heading saved-journey-heading"><h2>{t(`已保存的旅行 · ${visibleTrips.length}`, `Saved Trips · ${visibleTrips.length}`)}</h2><span>{t('一段旅行可包含多座城市', 'Each trip can span multiple cities')}</span></div>}
    {!selectedTrip && !editingTrip && (visibleTrips.length ? <div className="journey-list">{visibleTrips.map((trip) => {
      const cover = media.find((item) => item.tripId === trip.id && item.kind === 'photo');
      const tripMediaCount = media.filter((item) => item.tripId === trip.id && item.kind !== 'audio').length;
      const tripPlaceCount = places.filter((place) => place.tripId === trip.id).length;
      return (
        <button className="journey-card" type="button" key={trip.id} onClick={() => { setSelectedTripId(trip.id); setSelectedPlaceId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <span className="washi-tape tape-mini" aria-hidden="true" />
          <div className="journey-cover">
            <JournalCover cityCode={trip.cities[0]?.code} photoId={cover?.id} plannerPhotos={plannerPhotosByTrip.get(trip.id)} />
          </div>
          <div>
            <span className="eyebrow">{trip.startDate} — {trip.endDate}</span>
            <h2>{trip.title}</h2>
            <div className="journey-city-pills">{trip.cities.slice(0, 4).map((item) => <span key={item.code}>{item.name}</span>)}{trip.cities.length > 4 && <span>+{trip.cities.length - 4}</span>}</div>
            <small>{trip.companions.length ? t(`与 ${trip.companions.join('、')} 同行 · `, `With ${trip.companions.join(', ')} · `) : ''}{t(`${tripPlaceCount} 个地点 · ${tripMediaCount} 张片段`, `${tripPlaceCount} places · ${tripMediaCount} items`)}</small>
          </div>
          <strong>{t('翻开手账 →', 'Open Journal →')}</strong>
        </button>
      );
    })}</div> : !scopeCity && <div className="empty-state card journal-empty-card"><CuteSticker kind="sparkle" className="empty-float-sparkle" /><JournalEmptyArt /><h2>{savedCities.length ? t('城市足迹已收好，随时开启第一段旅行', 'Cities saved—start your first trip anytime') : t('把喜欢的风景，装进第一本旅行手账', 'Start your very first travel journal')}</h2><p>{savedCities.length ? t('上方城市可直接打开贴照片、写心情；需要按旅程打包多城或记账时，再新建一次旅行。', 'Tap a saved city above to add photos and notes, or create a multi-city trip for budgeting.') : t('挑一座去过的城市贴上照片与语音，或者新建一段多城旅程，慢慢攒成只属于自己的回忆小册。', 'Pick a city to save photos and voice notes, or create a multi-city trip to build your personal travel booklet.')}</p><div className="journal-empty-steps"><div className="empty-step-chip"><span>1</span><div><strong>{t('挑一座城市', 'Pick a City')}</strong><small>{t('按省份选城或点亮地图', 'Browse by province or tap the map')}</small></div></div><div className="empty-step-chip"><span>2</span><div><strong>{t('贴入照片与心情', 'Add Photos & Notes')}</strong><small>{t('支持文字、语音与视频', 'Supports text, audio & video')}</small></div></div><div className="empty-step-chip"><span>3</span><div><strong>{t('点亮成就与高光', 'Unlock Badges')}</strong><small>{t('自动整理成年度纪念册', 'Auto-organized yearly album')}</small></div></div></div>{!savedCities.length && <div className="empty-state-actions"><button className="secondary" onClick={() => setCityBrowserOpen(true)}>{t('按省份选择城市', 'Browse by Province')}</button><button className="primary" onClick={() => { setEditingTrip('new'); setSelectedTripId(null); setSelectedPlaceId(null); }}>{t('＋ 新建旅行', '+ New Trip')}</button></div>}</div>)}
    {selectedPlace && (selectedTrip || scopeCityCode) && <div className="memory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlaceId(null); }}><section className="memory-book" role="dialog" aria-modal="true" aria-label={t(`${selectedPlace.name}的回忆`, `Memories of ${selectedPlace.name}`)}>
      <div className="memory-header"><button className="text-button" onClick={() => setSelectedPlaceId(null)}>{t(`← 返回${selectedTrip ? '旅行' : '城市记录'}`, `← Back to ${selectedTrip ? 'Trip' : 'City'}`)}</button><span>{selectedTrip ? `${selectedTrip.startDate} — ${selectedTrip.endDate}` : t('城市记忆', 'City Memory')}</span><button aria-label={t('关闭地点回忆', 'Close place memories')} onClick={() => setSelectedPlaceId(null)}>×</button></div><div className="memory-title"><span className="eyebrow">A PLACE TO REMEMBER</span><h2>{selectedPlace.name}</h2><p>{selectedTrip?.cities.find((item) => item.code === selectedPlace.cityCode)?.name ?? scopeCity?.name} · {t(`${placeMedia.length} 个片段`, `${placeMedia.length} items`)}</p></div>
      <div className="memory-upload">
        <button
          type="button"
          className="primary"
          disabled={Boolean(uploadProgress)}
          onClick={() => {
            if (webTourMode) {
              onRequireClient?.('photo');
              return;
            }
            memoryFileInputRef.current?.click();
          }}
        >
          {webTourMode
            ? t('🔒 上传照片 / 视频（下载客户端解锁）', '🔒 Upload Photos / Videos (Client Only)')
            : (uploadProgress && uploadFeedbackPlaceId === selectedPlace.id ? uploadProgress : t('上传照片 / 视频到这里', 'Upload Photos / Videos Here'))}
        </button>
        {!webTourMode && <input ref={memoryFileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif,.mov" hidden
          onChange={(event) => void uploadFiles(event.target.files, selectedPlace)} />}
        {uploadFeedbackPlaceId === selectedPlace.id && uploadFailures.length > 0 && (
          <div className="upload-failures" role="alert"><ul>{uploadFailures.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></div>
        )}
      </div>
      <div className="memory-review">
        <label>{editingReviewId ? t('编辑这条回忆', 'Edit this memory') : t('写下关于这里的回忆', 'Write a memory about this place')}<textarea value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} placeholder={t('当时的天气、同行的人、最想记住的瞬间…', 'The weather, companions, or your favorite moment…')} /></label>
        <div className="heading-actions">
          <button className="secondary" disabled={savingReview || !reviewDraft.trim()} onClick={() => void saveReview(selectedPlace)}>{savingReview ? t('保存中…', 'Saving…') : editingReviewId ? t('保存修改', 'Save Changes') : t('保存文字', 'Save Note')}</button>
          {editingReviewId && <button className="text-button" onClick={() => { setEditingReviewId(null); setReviewDraft(''); }}>{t('取消编辑', 'Cancel')}</button>}
          <button className="secondary" disabled={audioBusy || Boolean(recordingPlaceId && recordingPlaceId !== selectedPlace.id)} onClick={() => void toggleRecording(selectedPlace)}>{webTourMode ? t('🔒 录制语音评语（客户端专属）', '🔒 Record Voice (Client Only)') : (audioBusy ? t('正在处理录音…', 'Processing audio…') : recordingPlaceId === selectedPlace.id ? t('停止录音', 'Stop Recording') : t('录制语音评语', 'Record Voice Note'))}</button>
        </div>
        {recordingPlaceId === selectedPlace.id && <div className="recording-meter" role="status">
          <span className="recording-dot" aria-hidden="true" />
          <span className="recording-mic">{t(`正在收音 · ${recordingMicLabel}`, `Recording · ${recordingMicLabel}`)}</span>
          <span className="recording-level-track" aria-hidden="true"><span style={{ width: `${Math.max(4, recordingLevel)}%` }} /></span>
        </div>}
        <div className="saved-reviews" aria-label={t('已保存的文字回忆', 'Saved text notes')}>{placeReviewNotes(selectedPlace).map((note) => <article className="saved-review" key={note.id}>
          <div className="saved-review-head">
            <small>{new Date(note.createdAt).toLocaleString(locale)}</small>
            <div className="audio-review-actions">
              <button type="button" className="audio-action-btn" disabled={savingReview} onClick={() => { setEditingReviewId(note.id); setReviewDraft(note.text); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg>
                {t('编辑', 'Edit')}
              </button>
              <button type="button" className="audio-action-btn danger" disabled={savingReview} onClick={() => void deleteReview(selectedPlace, note.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18m-2 0v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m-6 5v6m4-6v6" /></svg>
                {t('删除', 'Delete')}
              </button>
            </div>
          </div>
          <p>{note.text}</p>
        </article>)}</div>
        <div className="audio-review-list">{media.filter((item) => item.placeId === selectedPlace.id && item.kind === 'audio').sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).map((item) => <AudioReview key={item.id} item={item} onDelete={(id) => void onDeleteMedia(id)} />)}</div>
      </div>
      {visibleMediaGroups.map(([period, items]) => <section className="memory-day" key={period}><h3>{period}</h3><div className="memory-photo-grid">{items.map(({ item, index }) => <MemoryThumbnail key={item.id} item={item} onOpen={() => setSelectedMediaIndex(index)} />)}</div></section>)}{visibleCount < placeMedia.length && <button className="secondary full" onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}>{t('再看一些照片', 'Load More Photos')}</button>}
      {entries.filter((entry) => entry.placeId === selectedPlace.id && entry.highlight).map((entry) => <p className="memory-highlight" key={entry.id}>✦ {entry.date} · {t('高光时刻', 'Highlight')}</p>)}
      {placeMedia.length > 0 && <label className="memory-highlight-toggle"><input type="checkbox" checked={entries.some((entry) => entry.placeId === selectedPlace.id && entry.highlight)} onChange={(event) => {
        const entry = entries.find((row) => row.placeId === selectedPlace.id);
        if (entry) void onSaveEntry({ ...entry, highlight: event.target.checked });
      }} />{t('设为高光时刻', 'Mark as Highlight')}</label>}
    </section></div>}
    {selectedMedia && selectedPlace && <div className="lightbox-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMediaIndex(null); }}><div className="lightbox" role="dialog" aria-modal="true" aria-label={t('照片详情', 'Photo details')} onTouchStart={(event) => { touchStartRef.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (touchStartRef.current === null) return; const delta = event.changedTouches[0].clientX - touchStartRef.current; if (Math.abs(delta) > 50) setSelectedMediaIndex(Math.max(0, Math.min(placeMedia.length - 1, (selectedMediaIndex ?? 0) + (delta < 0 ? 1 : -1)))); touchStartRef.current = null; }}><div className="lightbox-top"><span>{(selectedMediaIndex ?? 0) + 1} / {placeMedia.length}</span><button aria-label={t('关闭照片详情', 'Close photo details')} onClick={() => setSelectedMediaIndex(null)}>×</button></div><div className="lightbox-stage"><button aria-label={t('上一张', 'Previous')} onClick={() => setSelectedMediaIndex(Math.max(0, (selectedMediaIndex ?? 0) - 1))}>‹</button>{fullMediaUrl && (selectedMedia.kind === 'video' ? <video key={selectedMedia.id} src={fullMediaUrl} controls preload="metadata" /> : <LivePhotoStage item={selectedMedia} imageUrl={fullMediaUrl} liveVideoUrl={liveMediaUrl} />)}<button aria-label={t('下一张', 'Next')} onClick={() => setSelectedMediaIndex(Math.min(placeMedia.length - 1, (selectedMediaIndex ?? 0) + 1))}>›</button></div><div className="lightbox-caption"><h3>{selectedPlace.name}</h3><div className="lightbox-meta-row"><small>{selectedMedia.fileName}</small><span className="lightbox-lossless-badge">{isLivePhotoMedia(selectedMedia) ? t('实况原图无损', 'Lossless Live Photo') : isAnimatedImageMedia(selectedMedia) ? t('动态原图无损', 'Lossless GIF') : t('原图无损', 'Lossless Original')}{formatFileSize(selectedMedia.fileSize) ? ` · ${formatFileSize(selectedMedia.fileSize)}` : ''}</span></div><div className="entry-form"><label>{t('拍摄日期', 'Capture Date')}<ThemedDatePicker value={selectedMedia.capturedAt.slice(0, 10)} title={t('拍摄日期', 'Capture Date')} onChange={(val) => void changeMediaDate(selectedMedia, val)} /></label><label>{t('移动到地点', 'Move to Place')}<select value={selectedMedia.placeId} onChange={(event) => { const place = tripPlaces.find((item) => item.id === event.target.value); if (place) { void onUpdateMedia({ ...selectedMedia, placeId: place.id, cityCode: place.cityCode, placeName: place.name, entryId: null }); setSelectedMediaIndex(null); } }}>{tripPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label></div><div className="lightbox-actions-row"><button type="button" className="secondary" onClick={() => void downloadOriginalMedia(selectedMedia)}>{t('下载原图', 'Download Original')}</button><button className="text-button" onClick={() => { if (window.confirm(t('删除这份媒体文件？', 'Delete this media file?'))) { void onDeleteMedia(selectedMedia.id); setSelectedMediaIndex(null); } }}>{t('删除这张照片', 'Delete Photo')}</button></div></div></div></div>}
    </>}
  </div>;
}
