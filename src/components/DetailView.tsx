import { useEffect, useMemo, useRef, useState } from 'react';
import exifr from 'exifr';
import type {
  AdministrativeFeature, CityMark, DayEntry, Journey, JourneyCity, JourneyPlace,
  TravelMedia,
} from '../types';
import { getMediaBlob, getMediaPreview } from '../db';
import type { JourneyLinkResult } from '../db';
import { cityFromGps, loadNationalMap, loadProvinceMap } from '../map-data';
import { describeStorageError, localDay, periodFromDate } from '../utils';
import TravelCityBrowser from './TravelCityBrowser';

interface DetailViewProps {
  city: CityMark | null;
  trips: Journey[];
  places: JourneyPlace[];
  entries: DayEntry[];
  media: TravelMedia[];
  targetEntryId: string | null;
  onSaveTrip: (trip: Journey) => Promise<JourneyLinkResult>;
  onSavePlace: (place: JourneyPlace) => Promise<void>;
  onSaveEntry: (entry: DayEntry) => Promise<void>;
  onSaveMedia: (media: TravelMedia, blob: Blob) => Promise<void>;
  onSaveMediaGroup: (items: Array<{ media: TravelMedia; blob: Blob }>, entries: DayEntry[]) => Promise<void>;
  onUpdateMedia: (media: TravelMedia) => Promise<void>;
  onDeleteMedia: (id: string) => Promise<void>;
  onUpdateMark: (visited: boolean) => Promise<void>;
  onSaveCityMark: (mark: CityMark) => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
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

function MemoryThumbnail({ item, onOpen }: { item: TravelMedia; onOpen: () => void }) {
  const url = useMediaUrl(item.kind === 'photo' ? item.id : null, item.kind, true);
  return <button className="memory-thumb" onClick={onOpen} aria-label={`打开 ${item.fileName}`}>
    {item.kind === 'photo' && url ? <img src={url} alt={item.fileName} loading="lazy" /> :
      <span className="memory-video-icon">{item.kind === 'video' ? '▶' : '♪'}</span>}
    <small>{new Date(item.capturedAt).toLocaleDateString('zh-CN')}</small>
  </button>;
}

function JourneyCover({ media }: { media: TravelMedia | undefined }) {
  const url = useMediaUrl(media?.kind === 'photo' ? media.id : null, 'photo', true);
  return <div className="journey-cover">{url ? <img src={url} alt="旅行封面" /> : <span>✦</span>}</div>;
}

function AudioReview({ mediaId }: { mediaId: string | null }) {
  const url = useMediaUrl(mediaId, 'audio', false);
  return mediaId ? <div className="audio-review">{url ? <audio src={url} controls preload="none" /> : '正在读取语音…'}</div> : null;
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
  if (file.type.startsWith('image/')) {
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
  return file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(heic|heif|mov|mp4|m4v|webm)$/i.test(file.name);
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

  useEffect(() => { void loadNationalMap().then((data) => setProvinces(data.features)).catch(() => onError('全国地区列表加载失败')); }, [onError]);
  useEffect(() => {
    if (!provinceCode) { setCityOptions([]); return; }
    let active = true;
    loadProvinceMap(provinceCode).then((data) => { if (active) setCityOptions(data.features); })
      .catch(() => { if (active) onError('该省城市列表加载失败'); });
    return () => { active = false; };
  }, [provinceCode, onError]);

  function toggleCity(feature: AdministrativeFeature): void {
    const code = String(feature.properties.adcode);
    if (cities.some((city) => city.code === code)) {
      if (lockedCityCodes.includes(code)) { onError('这个城市已有地点，请先保留它'); return; }
      setCities(cities.filter((city) => city.code !== code));
    } else {
      setCities([...cities, { code, name: feature.properties.name, provinceCode }]);
    }
  }

  async function submit(): Promise<void> {
    if (!startDate || !endDate || endDate < startDate) { onError('请填写正确的旅行起止日期'); return; }
    if (!cities.length) { onError('请至少选择一座城市'); return; }
    setBusy(true);
    try {
      await onSave({ id: initial?.id ?? crypto.randomUUID(), title: title.trim() || `${cities[0].name}之旅`, status,
        startDate, endDate, cities,
        companions: [...new Set(companions.split(/[、,，\n]+/).map((name) => name.trim()).filter(Boolean))],
        createdAt: initial?.createdAt ?? new Date().toISOString() });
    } finally { setBusy(false); }
  }

  return <section className="card journey-editor">
    <div className="card-heading"><h2>{initial ? '编辑旅行' : '新建一次旅行'}</h2><button className="text-button" onClick={onCancel}>取消</button></div>
    <div className="entry-form">
      <label>旅行名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：贵州的夏天" maxLength={40} /></label>
      <label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
      <label>结束日期<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
      <label>同行者（可选）<input value={companions} onChange={(event) => setCompanions(event.target.value)} placeholder="用顿号分隔姓名" /></label>
      <label>旅行状态<select value={status} onChange={(event) => setStatus(event.target.value as NonNullable<Journey['status']>)}><option value="visited">已去过</option><option value="planned">计划中</option></select></label>
    </div>
    <div className="city-picker"><strong>这次旅行包含的城市</strong><div className="city-picker-selected">{cities.map((city) => <span key={city.code}>{city.name}<button aria-label={`移除 ${city.name}`} onClick={() => {
      if (lockedCityCodes.includes(city.code)) onError('这个城市已有地点，请先保留它');
      else setCities(cities.filter((item) => item.code !== city.code));
    }}>×</button></span>)}</div>
      <label>添加城市所在省份<select value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}><option value="">选择省份</option>{provinces.map((province) => <option key={String(province.properties.adcode)} value={String(province.properties.adcode)}>{province.properties.name}</option>)}</select></label>
      <div className="city-picker-options">{cityOptions.map((feature) => {
        const code = String(feature.properties.adcode);
        return <label key={code}><input type="checkbox" checked={cities.some((city) => city.code === code)} onChange={() => toggleCity(feature)} />{feature.properties.name}</label>;
      })}</div>
    </div>
    <button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '保存旅行'}</button>
  </section>;
}

/** This page keeps a trip's cities and places together, like pages in a diary. */
export default function DetailView(props: DetailViewProps) {
  const { city, trips, places, entries, media, targetEntryId, onSaveTrip, onSavePlace,
    onSaveEntry, onSaveMedia, onSaveMediaGroup, onUpdateMedia, onDeleteMedia,
    onUpdateMark, onSaveCityMark, onError, onNotice } = props;
  const [showAll, setShowAll] = useState(false);
  const [browseCity, setBrowseCity] = useState<JourneyCity | null>(null);
  const [cityBrowserOpen, setCityBrowserOpen] = useState(!city);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [editingTrip, setEditingTrip] = useState<Journey | 'new' | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [uploadCityCode, setUploadCityCode] = useState('');
  const [uploadPlaceId, setUploadPlaceId] = useState('');
  const [newPlaceName, setNewPlaceName] = useState('');
  const [placeVisitDate, setPlaceVisitDate] = useState(localDay(new Date()));
  const [reviewDraft, setReviewDraft] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [recordingPlaceId, setRecordingPlaceId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
  const visibleTrips = useMemo(() => trips.filter((trip) => !scopeCityCode
    || trip.cities.some((item) => item.code === scopeCityCode))
    .sort((a, b) => b.startDate.localeCompare(a.startDate)), [trips, scopeCityCode]);
  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;
  const selectedPlace = places.find((place) => place.id === selectedPlaceId) ?? null;
  // With no journey open, the place collection belongs directly to the city.
  const tripPlaces = selectedTrip ? places.filter((place) => place.tripId === selectedTrip.id)
    : scopeCityCode ? places.filter((place) => place.tripId === null && place.cityCode === scopeCityCode) : [];
  const uploadPlaces = tripPlaces.filter((place) => place.cityCode === uploadCityCode);
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

  useEffect(() => {
    if (!targetEntryId) return;
    const entry = entries.find((item) => item.id === targetEntryId);
    if (entry) { setSelectedTripId(entry.tripId); setSelectedPlaceId(entry.placeId); }
  }, [targetEntryId, entries]);
  useEffect(() => {
    if (selectedPlace) setReviewDraft(selectedPlace.reviewText);
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
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    if (recordingPlaceId && recordingPlaceId !== selectedPlaceId) recorderRef.current?.stop();
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
    const place: JourneyPlace = { id: crypto.randomUUID(), tripId: selectedTrip?.id ?? null,
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

  async function uploadFiles(files: FileList | null): Promise<void> {
    if (!files?.length || !uploadCityCode || !uploadPlaceId) return;
    const activeTripId = selectedTrip?.id ?? null;
    const selectedPlaceForUpload = places.find((place) => place.id === uploadPlaceId);
    if (!selectedPlaceForUpload) { onError('请先选择已保存的地点'); return; }
    const candidates: Array<{ file: File; date: Date; latitude: number | null; longitude: number | null }> = [];
    const failures: string[] = [];
    setUploadFailures([]);
    setUploadProgress('正在读取拍摄时间…');
    try {
      for (const file of Array.from(files)) {
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
          if (matched && String(matched.properties.adcode) !== uploadCityCode) gpsMismatches.push(candidate.file.name);
        } catch { /* Offline geometry may be unavailable; manual city still works. */ }
      }
      if (gpsMismatches.length && !window.confirm(`${gpsMismatches.length} 个文件的 GPS 城市与所选城市不同。仍按所选城市导入吗？`)) {
        setUploadFailures(gpsMismatches.map((name) => `${name}：请重新选择城市后上传`));
        return;
      }
      const outside = selectedTrip ? candidates.filter(({ date }) => localDay(date) < selectedTrip.startDate || localDay(date) > selectedTrip.endDate) : [];
      const includeOutside = !outside.length || window.confirm(`${outside.length} 个文件的拍摄或文件日期不在旅行日期内。确定：仍导入；取消：跳过这些文件。`);
      const accepted = includeOutside ? candidates : candidates.filter((item) => !outside.includes(item));
      if (!includeOutside) failures.push(...outside.map(({ file }) => `${file.name}：日期不在旅行范围，已跳过`));
      const workingEntries = [...entries];
      let completed = 0;
      for (let start = 0; start < accepted.length; start += 10) {
        const batch = accepted.slice(start, start + 10);
        const newEntries: DayEntry[] = [];
        const items = batch.map(({ file, date, latitude, longitude }) => {
          const day = localDay(date);
          const period = periodFromDate(date);
          let entry = workingEntries.find((row) => row.tripId === activeTripId
            && row.placeId === uploadPlaceId && row.date === day && row.period === period);
          if (!entry) {
            entry = { id: crypto.randomUUID(), tripId: activeTripId, placeId: uploadPlaceId,
              cityCode: uploadCityCode, date: day, period, note: '', place: selectedPlaceForUpload.name,
              order: Date.now() + workingEntries.length, highlight: false };
            workingEntries.push(entry);
            newEntries.push(entry);
          }
          const kind = file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name) ? 'video' : 'photo';
          const mediaItem: TravelMedia = { id: crypto.randomUUID(), cityCode: uploadCityCode,
            tripId: activeTripId, placeId: uploadPlaceId, entryId: entry.id,
            kind, fileName: file.name, mimeType: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
            capturedAt: date.toISOString(), placeName: selectedPlaceForUpload.name,
            latitude, longitude };
          return { media: mediaItem, blob: file as Blob };
        });
        try {
          await onSaveMediaGroup(items, newEntries);
          completed += items.length;
          setUploadProgress(`已保存 ${completed} / ${accepted.length} 个文件`);
        } catch (error) {
          const reason = describeStorageError(error);
          failures.push(...accepted.slice(start).map(({ file }) => `${file.name}：保存失败（${reason}）`));
          onError(reason);
          break;
        }
      }
      setUploadFailures(failures);
      if (completed) onNotice(`已导入 ${completed} 个文件至 ${selectedPlaceForUpload.name}${failures.length ? `；${failures.length} 个未导入` : ''}。`);
      if (!completed && failures.length) onError(`${failures.length} 个文件未导入，请查看下方原因`);
    } finally {
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function toggleRecording(place: JourneyPlace): Promise<void> {
    if (recordingPlaceId === place.id) { recorderRef.current?.stop(); return; }
    if (recordingPlaceId) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { onError('录音需要支持麦克风的 HTTPS 或 localhost 浏览器'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const id = crypto.randomUUID();
        const item: TravelMedia = { id, cityCode: place.cityCode, tripId: place.tripId,
          placeId: place.id, entryId: null, kind: 'audio', fileName: `地点语音-${place.name}.webm`,
          mimeType: blob.type, capturedAt: new Date().toISOString(), placeName: place.name,
          latitude: null, longitude: null };
        void onSaveMedia(item, blob).then(() => onSavePlace({ ...place, reviewAudioId: id }))
          .then(() => onNotice('地点语音已保存。')).catch(() => onError('语音保存失败'));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecordingPlaceId(null);
      };
      setRecordingPlaceId(place.id);
      recorder.start();
    } catch (error) { onError(error instanceof Error ? error.message : '无法使用麦克风'); }
  }

  async function changeMediaDate(item: TravelMedia, date: string): Promise<void> {
    if (!date) return;
    const oldDate = new Date(item.capturedAt);
    const time = `${String(oldDate.getHours()).padStart(2, '0')}:${String(oldDate.getMinutes()).padStart(2, '0')}`;
    await onUpdateMedia({ ...item, capturedAt: new Date(`${date}T${time}`).toISOString(), entryId: null });
  }

  return <div className="content-page journal-page">
    <div className="section-heading"><div><span className="eyebrow">MEMORY JOURNAL</span><h1>{scopeCity ? `${scopeCity.name} · 旅行手账` : '我的旅行手账'}</h1><p>一段旅程、几座城市，把每个地点的照片和故事收在一起。</p></div>
      <div className="heading-actions"><button className="secondary" onClick={() => { setCityBrowserOpen(!cityBrowserOpen); setSelectedTripId(null); setSelectedPlaceId(null); }}>{cityBrowserOpen ? '收起城市选择' : '按省份选择城市'}</button>{scopeCity && <button className="secondary" onClick={() => { setShowAll(true); setBrowseCity(null); setCityBrowserOpen(true); setSelectedTripId(null); setSelectedPlaceId(null); }}>查看全部旅行</button>}<button className="primary" onClick={() => { setEditingTrip('new'); setSelectedTripId(null); setSelectedPlaceId(null); }}>＋ 新建旅行</button></div></div>
    {cityBrowserOpen && !selectedTrip && !editingTrip && <TravelCityBrowser trips={trips} selectedCityCode={scopeCityCode} onSelectCity={(pickedCity) => { setBrowseCity(pickedCity); setShowAll(false); setSelectedTripId(null); }} onShowAll={() => { setShowAll(true); setBrowseCity(null); setSelectedTripId(null); }} onError={onError} />}
    {city && !browseCity && !showAll && !selectedTrip && <div className="card status-card"><div><strong>{city.name}的城市状态</strong><p>{trips.some((trip) => trip.cities.some((item) => item.code === city.id && trip.status !== 'planned')) ? '这座城市已包含在去过的旅行中，地图会保持点亮。' : '确认去过的城市会点亮地图，也可以在这里取消手动标记。'}</p></div><label className="checkbox"><input type="checkbox" checked={city.visited} disabled={trips.some((trip) => trip.status !== 'planned' && trip.cities.some((item) => item.code === city.id))} onChange={(event) => void onUpdateMark(event.target.checked)} />已去过</label></div>}
    {editingTrip && <JourneyEditor key={editingTrip === 'new' ? 'new' : editingTrip.id} initial={editingTrip === 'new' ? null : editingTrip} initialCity={scopeCityMark} lockedCityCodes={editingTrip === 'new' ? [] : places.filter((place) => place.tripId === editingTrip.id).map((place) => place.cityCode)} onSave={saveTrip} onCancel={() => setEditingTrip(null)} onError={onError} />}
    {(selectedTrip || scopeCity) && !editingTrip && <>
      {selectedTrip ? <div className="journal-trip-hero"><button className="text-button" onClick={() => { setSelectedTripId(null); setSelectedPlaceId(null); }}>← 返回城市记录与旅行列表</button><span className="eyebrow">{selectedTrip.startDate} — {selectedTrip.endDate}</span><h2>{selectedTrip.title}</h2><p>{selectedTrip.cities.map((item) => item.name).join(' · ')}</p>{selectedTrip.companions.length > 0 && <small>与 {selectedTrip.companions.join('、')} 同行</small>}<button className="secondary" onClick={() => setEditingTrip(selectedTrip)}>编辑旅行</button></div>
        : <div className="city-record-hero"><span className="eyebrow">CITY MEMORIES</span><h2>{scopeCity?.name}的城市记录</h2><p>先记录地点、照片和评语。创建包含这座城市的旅行后，日期匹配的记录会自动归入。</p></div>}
      <section className={`card upload-station ${selectedTrip ? '' : 'city-upload-station'}`}>
        <div className="card-heading"><h2>把照片放进一个地点</h2><span>每批上传前先选地点</span></div>
        <div className="entry-form">
          <label>城市{selectedTrip ? <select value={uploadCityCode} onChange={(event) => { setUploadCityCode(event.target.value); setUploadPlaceId(''); }}>{selectedTrip.cities.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
            : <input value={scopeCity?.name ?? ''} readOnly />}</label>
          <label>已有地点<select value={uploadPlaceId} onChange={(event) => setUploadPlaceId(event.target.value)}><option value="">请选择地点</option>{uploadPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
          <label>或新建地点<input value={newPlaceName} onChange={(event) => setNewPlaceName(event.target.value)} placeholder="例如：黄果树瀑布" /></label>
          {!selectedTrip && <label>地点记录日期<input type="date" value={placeVisitDate} onChange={(event) => setPlaceVisitDate(event.target.value)} /></label>}
          <button className="secondary" onClick={() => void createPlace()} disabled={!newPlaceName.trim()}>创建地点</button>
        </div>
        <button className="primary" disabled={!uploadPlaceId || Boolean(uploadProgress)} onClick={() => fileInputRef.current?.click()}>{uploadProgress || '上传照片 / 视频到所选地点'}</button>
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif,.mov" hidden onChange={(event) => void uploadFiles(event.target.files)} />
        <p className="muted">拍摄时间用于排序；没有 EXIF 时使用文件时间。{selectedTrip ? '日期超出旅程范围会先提示。' : '无需先新建旅行。'}</p>
        {uploadFailures.length > 0 && <div className="upload-failures" role="alert"><strong>{uploadFailures.length} 个文件未导入</strong><ul>{uploadFailures.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></div>}
      </section>
      <div className="journal-places">{(selectedTrip?.cities ?? (scopeCity ? [scopeCity] : [])).map((tripCity) => <section key={tripCity.code}><h3>{tripCity.name} · 地点记忆</h3><div className="place-card-grid">{tripPlaces.filter((place) => place.cityCode === tripCity.code).map((place) => {
        const placeItems = media.filter((item) => item.placeId === place.id && item.kind !== 'audio');
        const cover = placeItems.find((item) => item.kind === 'photo');
        return <button className="place-card" key={place.id} onClick={() => setSelectedPlaceId(place.id)}><JourneyCover media={cover} /><div><span className="eyebrow">{placeItems.length} 张旅行片段</span><h4>{place.name}</h4><p>{place.reviewText || '翻开这一页，写下这里的回忆。'}</p></div></button>;
      })}</div></section>)}</div>
    </>}
    {!selectedTrip && !editingTrip && (visibleTrips.length ? <div className="journey-list">{visibleTrips.map((trip) => {
      const cover = media.find((item) => item.tripId === trip.id && item.kind === 'photo');
      return <button className="journey-card" key={trip.id} onClick={() => { setSelectedTripId(trip.id); setSelectedPlaceId(null); }}><JourneyCover media={cover} /><div><span className="eyebrow">{trip.startDate} — {trip.endDate}</span><h2>{trip.title}</h2><p>{trip.cities.map((item) => item.name).join(' · ')}</p><small>{trip.companions.length ? `与 ${trip.companions.join('、')} 同行 · ` : ''}{places.filter((place) => place.tripId === trip.id).length} 个地点</small></div><strong>翻开手账 →</strong></button>;
    })}</div> : !scopeCity && <div className="empty-state card"><h2>从一座城市开始</h2><p>按省份选择城市，可直接上传照片与写下记录；计划花费时再创建旅行。</p></div>)}
    {selectedPlace && (selectedTrip || scopeCityCode) && <div className="memory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlaceId(null); }}><section className="memory-book" role="dialog" aria-modal="true" aria-label={`${selectedPlace.name}的回忆`}>
      <div className="memory-header"><button className="text-button" onClick={() => setSelectedPlaceId(null)}>← 返回{selectedTrip ? '旅行' : '城市记录'}</button><span>{selectedTrip ? `${selectedTrip.startDate} — ${selectedTrip.endDate}` : '城市记忆'}</span><button aria-label="关闭地点回忆" onClick={() => setSelectedPlaceId(null)}>×</button></div><div className="memory-title"><span className="eyebrow">A PLACE TO REMEMBER</span><h2>{selectedPlace.name}</h2><p>{selectedTrip?.cities.find((item) => item.code === selectedPlace.cityCode)?.name ?? scopeCity?.name} · {placeMedia.length} 个片段</p></div>
      <div className="memory-review"><label>写下关于这里的回忆<textarea value={reviewDraft} onChange={(event) => setReviewDraft(event.target.value)} placeholder="当时的天气、同行的人、最想记住的瞬间…" /></label><div className="heading-actions"><button className="secondary" onClick={() => void onSavePlace({ ...selectedPlace, reviewText: reviewDraft }).then(() => onNotice('地点评语已保存。')).catch(() => undefined)}>保存文字</button><button className="secondary" onClick={() => void toggleRecording(selectedPlace)}>{recordingPlaceId === selectedPlace.id ? '停止录音' : '录制语音评语'}</button></div>{media.filter((item) => item.placeId === selectedPlace.id && item.kind === 'audio').map((item) => <AudioReview key={item.id} mediaId={item.id} />)}</div>
      {visibleMediaGroups.map(([period, items]) => <section className="memory-day" key={period}><h3>{period}</h3><div className="memory-photo-grid">{items.map(({ item, index }) => <MemoryThumbnail key={item.id} item={item} onOpen={() => setSelectedMediaIndex(index)} />)}</div></section>)}{visibleCount < placeMedia.length && <button className="secondary full" onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}>再看一些照片</button>}
      {entries.filter((entry) => entry.placeId === selectedPlace.id && entry.highlight).map((entry) => <p className="memory-highlight" key={entry.id}>✦ {entry.date} · 高光时刻</p>)}
      {placeMedia.length > 0 && <label className="memory-highlight-toggle"><input type="checkbox" checked={entries.some((entry) => entry.placeId === selectedPlace.id && entry.highlight)} onChange={(event) => {
        const entry = entries.find((row) => row.placeId === selectedPlace.id);
        if (entry) void onSaveEntry({ ...entry, highlight: event.target.checked });
      }} />设为高光时刻</label>}
    </section></div>}
    {selectedMedia && selectedPlace && <div className="lightbox-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMediaIndex(null); }}><div className="lightbox" role="dialog" aria-modal="true" aria-label="照片详情" onTouchStart={(event) => { touchStartRef.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (touchStartRef.current === null) return; const delta = event.changedTouches[0].clientX - touchStartRef.current; if (Math.abs(delta) > 50) setSelectedMediaIndex(Math.max(0, Math.min(placeMedia.length - 1, (selectedMediaIndex ?? 0) + (delta < 0 ? 1 : -1)))); touchStartRef.current = null; }}><div className="lightbox-top"><span>{(selectedMediaIndex ?? 0) + 1} / {placeMedia.length}</span><button aria-label="关闭照片详情" onClick={() => setSelectedMediaIndex(null)}>×</button></div><div className="lightbox-stage"><button aria-label="上一张" onClick={() => setSelectedMediaIndex(Math.max(0, (selectedMediaIndex ?? 0) - 1))}>‹</button>{fullMediaUrl && (selectedMedia.kind === 'video' ? <video key={selectedMedia.id} src={fullMediaUrl} controls preload="metadata" /> : <img key={selectedMedia.id} src={fullMediaUrl} alt={selectedMedia.fileName} />)}<button aria-label="下一张" onClick={() => setSelectedMediaIndex(Math.min(placeMedia.length - 1, (selectedMediaIndex ?? 0) + 1))}>›</button></div><div className="lightbox-caption"><h3>{selectedPlace.name}</h3><small>{selectedMedia.fileName}</small><div className="entry-form"><label>拍摄日期<input type="date" value={selectedMedia.capturedAt.slice(0, 10)} onChange={(event) => void changeMediaDate(selectedMedia, event.target.value)} /></label><label>移动到地点<select value={selectedMedia.placeId} onChange={(event) => { const place = tripPlaces.find((item) => item.id === event.target.value); if (place) { void onUpdateMedia({ ...selectedMedia, placeId: place.id, cityCode: place.cityCode, placeName: place.name, entryId: null }); setSelectedMediaIndex(null); } }}>{tripPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label></div><button className="text-button" onClick={() => { if (window.confirm('删除这份媒体文件？')) { void onDeleteMedia(selectedMedia.id); setSelectedMediaIndex(null); } }}>删除这张照片</button></div></div></div>}
  </div>;
}
