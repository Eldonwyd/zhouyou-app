import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import type { Entry, FileEntry } from '@zip.js/zip.js';
import type { AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, MediaFile, TravelMedia } from './types';
import { getMediaBlob, getPlannerPhotoBlob, loadSnapshot, replaceSnapshot, savePlannerPhotoBlob, STORE_NAMES } from './db';
import { downloadBlob, localDay } from './utils';
import { validatePlannerContent } from './planner-domain';
import { upgradeLegacyBookingSchedule } from './planner-booking';
import { getCloudPlannerPhotoUrl } from './cloud-api';
import { plannerApiUrl } from './api-base';

interface PlannerPhotoBackupMeta {
  mimeType: string;
  sha256: string;
  fileName: string;
}

type SerializedBadge = Omit<Badge, 'image'> & { hasImage?: boolean; imageMimeType?: string | null; image?: Blob | null };

interface BackupManifest {
  format: 'travel-footprints-backup';
  version: 1 | 2 | 3;
  exportedAt: string;
  plannerPhotoIds?: string[];
  plannerPhotoMeta?: Record<string, PlannerPhotoBackupMeta>;
  missingPlannerPhotoIds?: string[];
  data: (Omit<AppSnapshot, 'badges'> & { badges: SerializedBadge[] }) | (Omit<AppSnapshot, 'trips' | 'places' | 'entries' | 'media' | 'badges'> & {
    badges: SerializedBadge[];
    entries: Array<Omit<DayEntry, 'tripId' | 'placeId'>>;
    media: Array<Omit<TravelMedia, 'tripId' | 'placeId'>>;
  });
}

export interface ExportBackupResult {
  skippedPlannerPhotos: number;
  missingPlannerPhotoIds: string[];
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

function plannerPhotoExt(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

async function resolvePlannerPhotoForBackup(id: string): Promise<Blob | null> {
  const local = await getPlannerPhotoBlob(id).catch(() => null);
  if (local && local.size > 0) return local;
  const candidates = [getCloudPlannerPhotoUrl(id), plannerApiUrl(`photo-file/${id}`)];
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) continue;
        const blob = await resp.blob();
        if (blob.size > 0 && ['image/webp', 'image/jpeg', 'image/png'].includes(blob.type)) {
          await savePlannerPhotoBlob(id, blob).catch(() => undefined);
          return blob;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 网络离线或本地服务未启动时继续尝试下一个来源，不阻断备份
    }
  }
  return null;
}

/** 从数据库读取最新的已保存记录，再把原始媒体作为独立文件装入 ZIP。可重建参考图缺失时优雅跳过，不阻断核心备份。 */
export async function exportBackup(): Promise<ExportBackupResult> {
  const snapshot = await loadSnapshot();
  const referencedPhotoIds = plannerPhotoIds(snapshot);
  const includedPhotoIds: string[] = [];
  const missingPlannerPhotoIds: string[] = [];
  const plannerPhotoMeta: Record<string, PlannerPhotoBackupMeta> = {};
  const photoBlobs: Array<{ fileName: string; blob: Blob }> = [];

  for (const id of referencedPhotoIds) {
    const blob = await resolvePlannerPhotoForBackup(id);
    if (!blob) {
      missingPlannerPhotoIds.push(id);
      continue;
    }
    const mimeType = ['image/webp', 'image/jpeg', 'image/png'].includes(blob.type) ? blob.type : 'image/webp';
    const fileName = `planner-photos/${id}.${plannerPhotoExt(mimeType)}`;
    const sha256 = await plannerPhotoDigest(blob);
    includedPhotoIds.push(id);
    plannerPhotoMeta[id] = { mimeType, sha256, fileName };
    photoBlobs.push({ fileName, blob });
  }

  const manifest: BackupManifest = {
    format: 'travel-footprints-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    plannerPhotoIds: includedPhotoIds,
    plannerPhotoMeta,
    missingPlannerPhotoIds: missingPlannerPhotoIds.length ? missingPlannerPhotoIds : undefined,
    data: {
      ...snapshot,
      badges: snapshot.badges.map(({ image, ...badge }) => ({
        ...badge, hasImage: Boolean(image), imageMimeType: image?.type ?? null,
      })),
    },
  };
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
  for (const { fileName, blob } of photoBlobs) {
    await writer.add(fileName, new BlobReader(blob));
  }
  for (const item of snapshot.media) await writer.add(`media/${item.id}`, new BlobReader(await getMediaBlob(item.id)));
  for (const badge of snapshot.badges) {
    if (badge.image) await writer.add(`badges/${badge.id}`, new BlobReader(badge.image));
  }
  downloadBlob(await writer.close(), `旅行足迹备份-${localDay(new Date())}.zip`);
  return {
    skippedPlannerPhotos: missingPlannerPhotoIds.length,
    missingPlannerPhotoIds,
  };
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

/** 照片编号是内容的 SHA-256。手机通过局域网 HTTP 打开时，浏览器可能不提供 SubtleCrypto。 */
async function plannerPhotoDigest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    : (await import('fast-sha256')).hash(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 先读取和校验备份，确认后再用一个事务替换本机数据。 */
export async function importBackup(
  file: File,
  confirmReplace: (snapshot: AppSnapshot) => boolean,
): Promise<AppSnapshot | null> {
  const reader = new ZipReader(new BlobReader(file), { checkSignature: true });
  let snapshot: AppSnapshot;
  const files: MediaFile[] = [];
  const plannerPhotos: MediaFile[] = [];
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
    snapshot = { ...normalized, badges, aiPlans: normalized.aiPlans.map(upgradeLegacyBookingSchedule) };
    for (const name of STORE_NAMES) {
      const ids = new Set<string>();
      for (const row of snapshot[name]) {
        if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('备份包含无效或重复的记录 ID');
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
    const expectedPhotoIds = Array.isArray(manifest.plannerPhotoIds)
      ? manifest.plannerPhotoIds
      : plannerPhotoIds(snapshot).filter((id) =>
        isFileEntry(byName.get(`planner-photos/${id}.webp`))
        || isFileEntry(byName.get(`planner-photos/${id}.jpg`))
        || isFileEntry(byName.get(`planner-photos/${id}.png`))
      );
    for (const id of expectedPhotoIds) {
      if (!/^[a-f\d]{64}$/.test(id)) throw new Error('备份中的行程照片编号无效');
      const meta = manifest.plannerPhotoMeta?.[id];
      const member = (meta?.fileName ? byName.get(meta.fileName) : undefined)
        ?? byName.get(`planner-photos/${id}.webp`)
        ?? byName.get(`planner-photos/${id}.jpg`)
        ?? byName.get(`planner-photos/${id}.png`);
      if (!isFileEntry(member) || member.uncompressedSize > 8 * 1024 * 1024) throw new Error('备份中的行程照片缺失或过大');
      const mimeType = meta?.mimeType && ['image/webp', 'image/jpeg', 'image/png'].includes(meta.mimeType)
        ? meta.mimeType
        : member.filename.endsWith('.jpg') ? 'image/jpeg' : member.filename.endsWith('.png') ? 'image/png' : 'image/webp';
      const blob = await member.getData(new BlobWriter(mimeType));
      const expectedDigest = meta?.sha256 && /^[a-f\d]{64}$/.test(meta.sha256) ? meta.sha256 : id;
      if (await plannerPhotoDigest(blob) !== expectedDigest) throw new Error('备份中的行程照片已损坏');
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      plannerPhotos.push({ id, blob });
    }
  } finally {
    await reader.close();
  }
  if (!confirmReplace(snapshot)) return null;
  await replaceSnapshot(snapshot, files, plannerPhotos);
  return snapshot;
}
