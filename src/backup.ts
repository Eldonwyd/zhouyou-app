import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import type { Entry, FileEntry } from '@zip.js/zip.js';
import type { AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, MediaFile, TravelMedia } from './types';
import { getMediaBlob, getPlannerPhotoBlob, replaceSnapshot } from './db';
import { downloadBlob, localDay } from './utils';
import { validatePlannerContent } from './planner-domain';

interface BackupManifest {
  format: 'travel-footprints-backup';
  version: 1 | 2 | 3;
  exportedAt: string;
  plannerPhotoIds?: string[];
  data: AppSnapshot | (Omit<AppSnapshot, 'trips' | 'places' | 'entries' | 'media'> & {
    entries: Array<Omit<DayEntry, 'tripId' | 'placeId'>>;
    media: Array<Omit<TravelMedia, 'tripId' | 'placeId'>>;
  });
}

/** 图片只收集当前计划及可撤销历史中的引用，避免把无关缓存塞进备份。 */
function plannerPhotoIds(snapshot: AppSnapshot): string[] {
  const ids = new Set<string>();
  for (const plan of snapshot.aiPlans ?? []) {
    for (const content of [plan.content, ...plan.history.map((revision) => revision.content)]) {
      for (const day of content.days) for (const activity of day.activities) {
        if (activity.photo?.assetId) ids.add(activity.photo.assetId);
      }
    }
  }
  return [...ids];
}

function isFileEntry(entry: Entry | undefined): entry is FileEntry {
  return Boolean(entry && !entry.directory && 'getData' in entry);
}

/** Binary assets stay in separate ZIP members, including every original photo. */
export async function exportBackup(snapshot: AppSnapshot): Promise<void> {
  const photoIds = plannerPhotoIds(snapshot);
  const manifest = {
    format: 'travel-footprints-backup', version: 3, exportedAt: new Date().toISOString(),
    plannerPhotoIds: photoIds,
    data: {
      ...snapshot,
      badges: snapshot.badges.map(({ image, ...badge }) => ({
        ...badge, hasImage: Boolean(image), imageMimeType: image?.type ?? null,
      })),
    },
  };
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
  for (const id of photoIds) {
    const blob = await getPlannerPhotoBlob(id);
    if (!blob) throw new Error('本地行程照片缺失，请重新查找照片后再导出完整备份');
    await writer.add(`planner-photos/${id}.webp`, new BlobReader(blob));
  }
  for (const item of snapshot.media) await writer.add(`media/${item.id}`, new BlobReader(await getMediaBlob(item.id)));
  for (const badge of snapshot.badges) {
    if (badge.image) await writer.add(`badges/${badge.id}`, new BlobReader(badge.image));
  }
  downloadBlob(await writer.close(), `旅行足迹备份-${localDay(new Date())}.zip`);
}

/** Legacy ZIPs have no journeys; create a stable one for each city and day. */
function upgradeLegacyData(data: BackupManifest['data']): AppSnapshot {
  const old = data as Omit<AppSnapshot, 'trips' | 'places' | 'entries' | 'media'> & {
    entries: Array<Omit<DayEntry, 'tripId' | 'placeId'>>;
    media: Array<Omit<TravelMedia, 'tripId' | 'placeId'>>;
  };
  const marks = new Map(old.marks.map((mark: CityMark) => [mark.id, mark]));
  const trips = new Map<string, Journey>();
  const places: JourneyPlace[] = [];
  const links = new Map<string, { tripId: string; placeId: string }>();

  function ensureTrip(cityCode: string, date: string): string {
    const id = `legacy-${cityCode}-${date}`;
    if (!trips.has(id)) {
      const mark = marks.get(cityCode);
      trips.set(id, { id, title: `${mark?.name ?? '城市'} · ${date}`, startDate: date,
        endDate: date, cities: [{ code: cityCode, name: mark?.name ?? cityCode,
          provinceCode: mark?.provinceCode ?? `${cityCode.slice(0, 2)}0000` }],
        companions: [], createdAt: new Date().toISOString() });
    }
    return id;
  }

  const entries = old.entries.map((entry) => {
    const tripId = ensureTrip(entry.cityCode, entry.date);
    const placeId = `legacy-place-${entry.id}`;
    links.set(entry.id, { tripId, placeId });
    places.push({ id: placeId, tripId, cityCode: entry.cityCode,
      name: entry.place?.trim() || marks.get(entry.cityCode)?.name || '未整理地点',
      reviewText: entry.note ?? '', reviewAudioId: null, createdAt: new Date().toISOString() });
    return { ...entry, tripId, placeId };
  });
  const media = old.media.map((item) => {
    const link = links.get(item.entryId ?? '');
    const date = item.capturedAt?.slice(0, 10) || '1970-01-01';
    const tripId = link?.tripId ?? ensureTrip(item.cityCode, date);
    const placeId = link?.placeId ?? `legacy-place-${item.id}`;
    if (!link) places.push({ id: placeId, tripId, cityCode: item.cityCode,
      name: item.placeName || marks.get(item.cityCode)?.name || '未整理地点',
      reviewText: '', reviewAudioId: null, createdAt: new Date().toISOString() });
    return { ...item, tripId, placeId, entryId: item.entryId || null };
  });
  return { ...old, entries, media, trips: [...trips.values()], places };
}

/** Validate every file and relationship before replacing the browser database. */
export async function importBackup(file: File): Promise<AppSnapshot> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const manifestEntry = byName.get('manifest.json');
    if (!isFileEntry(manifestEntry)) throw new Error('备份缺少 manifest.json');
    const manifest = JSON.parse(await manifestEntry.getData(new TextWriter())) as BackupManifest;
    if (manifest.format !== 'travel-footprints-backup' || ![1, 2, 3].includes(manifest.version)) {
      throw new Error('备份文件格式或版本不受支持');
    }
    const data = manifest.data;
    if (!data || !Array.isArray(data.marks) || !Array.isArray(data.entries)
      || !Array.isArray(data.plans) || !Array.isArray(data.media)
      || !Array.isArray(data.badges) || !Array.isArray(data.profile)
      || (manifest.version >= 2 && (!('trips' in data) || !Array.isArray(data.trips)
        || !('places' in data) || !Array.isArray(data.places)))
      || (manifest.version === 3 && (!Array.isArray(data.aiPlans) || !Array.isArray(data.plannerPreferences)))) {
      throw new Error('备份内容不完整');
    }
    const normalized = manifest.version === 1 ? upgradeLegacyData(data) : data as AppSnapshot;
    // Older archives predate AI planning; initialize only the new stores.
    normalized.aiPlans ??= [];
    normalized.plannerPreferences ??= [];
    for (const plan of normalized.aiPlans) {
      if (!Number.isInteger(plan.version) || plan.version < 1 || !Array.isArray(plan.messages) || !Array.isArray(plan.history)) throw new Error('AI 计划版本或历史无效');
      validatePlannerContent(plan.content);
      for (const revision of plan.history) validatePlannerContent(revision.content);
      // Older backups have plain dialogue only. New suggestions remain inert
      // after import and must still match the itinerary revision when applied.
      if (plan.contentVersion !== undefined && (!Number.isSafeInteger(plan.contentVersion) || plan.contentVersion < 1)) throw new Error('AI 计划内容版本无效');
      for (const message of plan.messages) {
        if (message.suggestions !== undefined && !Array.isArray(message.suggestions))
          throw new Error('AI 修改建议列表无效');
        // 同时校验新多方案和旧单方案；普通备份保留编号、版本及已实施状态。
        const suggestions = [...(message.suggestions ?? []), ...(message.suggestion ? [message.suggestion] : [])];
        for (const suggestion of suggestions) {
          if (
            !suggestion || typeof suggestion.title !== 'string' || typeof suggestion.instruction !== 'string'
            || !(suggestion.scopeId === null || typeof suggestion.scopeId === 'string')
            || !Number.isSafeInteger(suggestion.baseContentVersion) || suggestion.baseContentVersion < 1
            || (suggestion.id !== undefined && typeof suggestion.id !== 'string')
            || (suggestion.label !== undefined && typeof suggestion.label !== 'string')
            || (suggestion.appliedAt !== undefined && (
              typeof suggestion.appliedAt !== 'string' || !Number.isFinite(Date.parse(suggestion.appliedAt))
            ))
          ) throw new Error('AI 修改建议格式无效');
        }
      }
    }
    const files: MediaFile[] = [];
    for (const media of normalized.media) {
      const member = byName.get(`media/${media.id}`);
      if (!isFileEntry(member)) throw new Error(`备份缺少媒体文件 ${media.fileName}`);
      files.push({ id: media.id, blob: await member.getData(new BlobWriter(media.mimeType || 'application/octet-stream')) });
    }
    const badges: Badge[] = [];
    for (const badge of data.badges as Array<Badge & { hasImage?: boolean; imageMimeType?: string }>) {
      const member = byName.get(`badges/${badge.id}`);
      if (badge.hasImage && !isFileEntry(member)) throw new Error(`备份缺少徽章图片 ${badge.title}`);
      const image = isFileEntry(member) ? await member.getData(new BlobWriter(badge.imageMimeType || 'image/png')) : null;
      badges.push({ id: badge.id, title: badge.title, linkedEntryId: badge.linkedEntryId,
        createdAt: badge.createdAt, image });
    }
    const snapshot: AppSnapshot = { ...normalized, badges };
    for (const rows of [snapshot.marks, snapshot.entries, snapshot.plans, snapshot.media,
      snapshot.badges, snapshot.trips, snapshot.places, snapshot.aiPlans, snapshot.plannerPreferences]) {
      const ids = new Set<string>();
      for (const row of rows) {
        if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('备份包含无效或重复的记录 ID');
        ids.add(row.id);
      }
    }
    const tripIds = new Set(snapshot.trips.map((trip) => trip.id));
    const placeIds = new Set(snapshot.places.map((place) => place.id));
    if (snapshot.plans.some((plan) => plan.tripId && !tripIds.has(plan.tripId))
      || snapshot.places.some((place) => place.tripId !== null && !tripIds.has(place.tripId))
      || snapshot.entries.some((entry) => entry.tripId !== null && !tripIds.has(entry.tripId))
      || snapshot.media.some((item) => (item.tripId !== null && !tripIds.has(item.tripId)) || !placeIds.has(item.placeId))) {
      throw new Error('备份中的旅行、账单与地点关联不完整');
    }
    const photoIds = plannerPhotoIds(snapshot);
    const plannerPhotos: MediaFile[] = [];
    for (const id of photoIds) {
      if (!/^[a-f\d]{64}$/.test(id)) throw new Error('备份中的行程照片编号无效');
      const member = byName.get(`planner-photos/${id}.webp`);
      if (!isFileEntry(member) || member.uncompressedSize > 8 * 1024 * 1024) throw new Error('备份中的行程照片缺失或过大');
      const blob = await member.getData(new BlobWriter('image/webp'));
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const actualId = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (actualId !== id) throw new Error('备份中的行程照片已损坏');
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      plannerPhotos.push({ id, blob });
    }
    await replaceSnapshot(snapshot, files, plannerPhotos);
    return snapshot;
  } finally {
    await reader.close();
  }
}
