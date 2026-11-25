import type {
  AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile,
  MediaFile, TravelMedia, TripPlan,
} from './types';
import { createLocalId, localDay } from './utils';
import type { AiTravelPlan, PlannerJournalVisit, PlannerPhoto, PlannerPreferences } from './planner-types';
import { calculatePlannerBudget, plannerValueEqual, validatePlannerContent } from './planner-domain';
import { journalPlaceNameKey, plannerJournalActivityKey, plannerJournalCity, plannerJournalPlaceName, plannerJournalVisitFor } from './planner-journal';
import { upgradeLegacyBookingSchedule } from './planner-booking';

const DATABASE_NAME = 'travel-footprints';
const DATABASE_VERSION = 4;
export const STORE_NAMES = ['marks', 'entries', 'plans', 'media', 'badges', 'profile', 'trips', 'places', 'aiPlans', 'plannerPreferences'] as const;
export type StoreName = typeof STORE_NAMES[number];

interface StoreTypes {
  aiPlans: AiTravelPlan;
  plannerPreferences: PlannerPreferences;
  marks: CityMark;
  entries: DayEntry;
  plans: TripPlan;
  media: TravelMedia;
  badges: Badge;
  profile: LocalProfile;
  trips: Journey;
  places: JourneyPlace;
}

let databasePromise: Promise<IDBDatabase> | null = null;

/**
 * Version 2 moves binary media out of the listable metadata store. The upgrade
 * runs in IndexedDB's own transaction: a failed upgrade leaves version 1 intact.
 * Old diary rows become one editable journey per city and calendar day.
 */
function upgradeDatabase(request: IDBOpenDBRequest, previousVersion: number): void {
  const database = request.result;
  const transaction = request.transaction!;
  for (const name of STORE_NAMES) {
    if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
  }
  for (const name of ['mediaFiles', 'mediaPreviews', 'plannerPhotoFiles']) {
    if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
  }
  const mediaStore = transaction.objectStore('media');
  if (!mediaStore.indexNames.contains('byPlace')) mediaStore.createIndex('byPlace', 'placeId');
  if (!mediaStore.indexNames.contains('byTrip')) mediaStore.createIndex('byTrip', 'tripId');
  if (previousVersion !== 1) return;

  const marksRequest = transaction.objectStore('marks').getAll();
  marksRequest.onsuccess = () => {
    const marks = new Map((marksRequest.result as CityMark[]).map((mark) => [mark.id, mark]));
    const entriesRequest = transaction.objectStore('entries').getAll();
    entriesRequest.onsuccess = () => {
      const entries = entriesRequest.result as Array<Omit<DayEntry, 'tripId' | 'placeId'>>;
      const entryLinks = new Map<string, { tripId: string; placeId: string }>();
      const tripStore = transaction.objectStore('trips');
      const placeStore = transaction.objectStore('places');
      const entryStore = transaction.objectStore('entries');

      for (const entry of entries) {
        const mark = marks.get(entry.cityCode);
        const tripId = `legacy-${entry.cityCode}-${entry.date}`;
        const placeId = `legacy-place-${entry.id}`;
        entryLinks.set(entry.id, { tripId, placeId });
        tripStore.put({
          id: tripId, title: `${mark?.name ?? '城市'} · ${entry.date}`, startDate: entry.date,
          endDate: entry.date, cities: [{ code: entry.cityCode, name: mark?.name ?? entry.cityCode,
            provinceCode: mark?.provinceCode ?? `${entry.cityCode.slice(0, 2)}0000` }],
          companions: [], createdAt: new Date().toISOString(),
        } satisfies Journey);
        placeStore.put({
          id: placeId, tripId, cityCode: entry.cityCode,
          name: entry.place.trim() || mark?.name || '未整理地点', reviewText: entry.note,
          reviewAudioId: null, createdAt: new Date().toISOString(),
        } satisfies JourneyPlace);
        entryStore.put({ ...entry, tripId, placeId } satisfies DayEntry);
      }

      // Keep cursor work inside the upgrade transaction; no media Blob enters
      // the new metadata store after this loop finishes.
      const cursorRequest = mediaStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const oldMedia = cursor.value as TravelMedia & { blob?: Blob };
        const linked = entryLinks.get(oldMedia.entryId ?? '');
        const date = oldMedia.capturedAt?.slice(0, 10) || '1970-01-01';
        const tripId = linked?.tripId ?? `legacy-${oldMedia.cityCode}-${date}`;
        const placeId = linked?.placeId ?? `legacy-place-${oldMedia.id}`;
        if (!linked) {
          const mark = marks.get(oldMedia.cityCode);
          tripStore.put({ id: tripId, title: `${mark?.name ?? '城市'} · ${date}`,
            startDate: date, endDate: date,
            cities: [{ code: oldMedia.cityCode, name: mark?.name ?? oldMedia.cityCode,
              provinceCode: mark?.provinceCode ?? `${oldMedia.cityCode.slice(0, 2)}0000` }],
            companions: [], createdAt: new Date().toISOString() } satisfies Journey);
          placeStore.put({ id: placeId, tripId, cityCode: oldMedia.cityCode,
            name: oldMedia.placeName || mark?.name || '未整理地点', reviewText: '',
            reviewAudioId: null, createdAt: new Date().toISOString() } satisfies JourneyPlace);
        }
        if (oldMedia.blob) transaction.objectStore('mediaFiles').put({ id: oldMedia.id, blob: oldMedia.blob });
        const { blob: _blob, ...metadata } = oldMedia;
        cursor.update({ ...metadata, tripId, placeId, entryId: oldMedia.entryId || null } satisfies TravelMedia);
        cursor.continue();
      };
    };
  };
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => upgradeDatabase(request, event.oldVersion);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
    request.onblocked = () => reject(new Error('请关闭其他旧版本网页后刷新，再升级本地数据'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地数据读取失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('本地数据保存失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地数据保存中断'));
  });
}

export async function getAll<T extends StoreName>(name: T): Promise<StoreTypes[T][]> {
  const database = await openDatabase();
  return requestResult(database.transaction(name, 'readonly').objectStore(name).getAll());
}

export async function saveItem<T extends StoreName>(name: T, item: StoreTypes[T]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(name, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(name).put(item);
  await completion;
}

export interface JourneyLinkResult {
  places: number;
  media: number;
  entries: number;
}

/**
 * Save a journey and claim matching city collections in the same transaction.
 * A place stays together when every dated item matches. A mixed-date place is
 * split: matching originals move into a journey copy, while other originals
 * stay in the city collection. Voice notes are copied so both place pages keep
 * their review; no photo or video binary is duplicated.
 */
export async function saveJourneyAndLinkCityRecords(journey: Journey): Promise<JourneyLinkResult> {
  const database = await openDatabase();
  const transaction = database.transaction(['trips', 'places', 'entries', 'media', 'mediaFiles'], 'readwrite');
  const completion = transactionDone(transaction);
  const placeStore = transaction.objectStore('places');
  const entryStore = transaction.objectStore('entries');
  const mediaStore = transaction.objectStore('media');
  const mediaFileStore = transaction.objectStore('mediaFiles');
  const result: JourneyLinkResult = { places: 0, media: 0, entries: 0 };
  transaction.objectStore('trips').put(journey);

  // Queue all reads while the transaction is active, then write synchronously
  // from the final success callback. Awaiting between reads could auto-commit.
  const placeRequest = placeStore.getAll();
  const entryRequest = entryStore.getAll();
  const mediaRequest = mediaStore.getAll();
  let completedReads = 0;
  const linkWhenReady = () => {
    completedReads += 1;
    if (completedReads !== 3) return;
    const cityCodes = new Set(journey.cities.map((city) => city.code));
    const allEntries = entryRequest.result as DayEntry[];
    const allMedia = mediaRequest.result as TravelMedia[];
    const entriesByPlace = new Map<string, DayEntry[]>();
    const mediaByPlace = new Map<string, TravelMedia[]>();
    for (const entry of allEntries) if (entry.tripId === null) {
      const rows = entriesByPlace.get(entry.placeId);
      if (rows) rows.push(entry);
      else entriesByPlace.set(entry.placeId, [entry]);
    }
    for (const item of allMedia) if (item.tripId === null) {
      const rows = mediaByPlace.get(item.placeId);
      if (rows) rows.push(item);
      else mediaByPlace.set(item.placeId, [item]);
    }
    const withinJourney = (date: string) => date >= journey.startDate && date <= journey.endDate;
    for (const place of placeRequest.result as JourneyPlace[]) {
      if (place.tripId !== null || !cityCodes.has(place.cityCode)) continue;
      const relatedEntries = entriesByPlace.get(place.id) ?? [];
      const relatedMedia = mediaByPlace.get(place.id) ?? [];
      const datedMedia = relatedMedia.filter((item) => item.kind !== 'audio');
      const authoredEntries = relatedEntries.filter((entry) => entry.note.trim() || entry.highlight);
      const datedItems = [
        // Automatically generated day rows may retain an old date after a
        // photo is manually corrected, so only authored notes constrain them.
        ...authoredEntries.map((entry) => entry.date),
        ...datedMedia.map((item) => localDay(new Date(item.capturedAt))),
      ];
      // A text-only place uses its creation date; voice recorded later should
      // follow the place instead of disqualifying historical photos.
      const dates = datedItems.length ? datedItems : [localDay(new Date(place.createdAt))];
      if (!dates.some(withinJourney)) continue;

      if (dates.every(withinJourney)) {
        placeStore.put({ ...place, tripId: journey.id } satisfies JourneyPlace);
        for (const entry of relatedEntries) entryStore.put({ ...entry, tripId: journey.id } satisfies DayEntry);
        for (const item of relatedMedia) mediaStore.put({ ...item, tripId: journey.id } satisfies TravelMedia);
        result.places += 1;
        result.entries += relatedEntries.length;
        result.media += relatedMedia.length;
        continue;
      }

      // Only a subset of this place's dates belongs to the journey. Keep the
      // original city place and move matching metadata to a separate place ID.
      const journeyPlaceId = createLocalId();
      const matchingMedia = datedMedia.filter((item) => withinJourney(localDay(new Date(item.capturedAt))));
      const matchingMediaEntryIds = new Set(matchingMedia.map((item) => item.entryId).filter((id): id is string => Boolean(id)));
      const retainedMediaEntryIds = new Set(datedMedia.filter((item) => !withinJourney(localDay(new Date(item.capturedAt))))
        .map((item) => item.entryId).filter((id): id is string => Boolean(id)));
      const matchingEntries = relatedEntries.filter((entry) =>
        (entry.note.trim() || entry.highlight) ? withinJourney(entry.date) : matchingMediaEntryIds.has(entry.id));
      const movedEntryIds = new Map<string, string>();
      const voiceCopies = relatedMedia.filter((item) => item.kind === 'audio').map((item) => ({
        original: item, copyId: createLocalId(),
      }));
      const copiedReviewId = voiceCopies.find(({ original }) => original.id === place.reviewAudioId)?.copyId ?? null;
      placeStore.put({ ...place, id: journeyPlaceId, tripId: journey.id,
        reviewAudioId: copiedReviewId } satisfies JourneyPlace);
      for (const entry of matchingEntries) {
        // An imported day row may be referenced by both matching and retained
        // photos. Copy that row so neither side points into the other place.
        const movedId = retainedMediaEntryIds.has(entry.id) ? createLocalId() : entry.id;
        movedEntryIds.set(entry.id, movedId);
        entryStore.put({ ...entry, id: movedId, tripId: journey.id, placeId: journeyPlaceId } satisfies DayEntry);
      }
      for (const item of matchingMedia) {
        mediaStore.put({ ...item, tripId: journey.id, placeId: journeyPlaceId,
          entryId: item.entryId ? movedEntryIds.get(item.entryId) ?? null : null } satisfies TravelMedia);
      }
      for (const { original, copyId } of voiceCopies) {
        mediaStore.put({ ...original, id: copyId, tripId: journey.id, placeId: journeyPlaceId } satisfies TravelMedia);
        const fileRequest = mediaFileStore.get(original.id);
        fileRequest.onsuccess = () => {
          const file = fileRequest.result as MediaFile | undefined;
          if (!file?.blob) { transaction.abort(); return; }
          mediaFileStore.put({ id: copyId, blob: file.blob } satisfies MediaFile);
        };
      }
      result.places += 1;
      result.entries += matchingEntries.length;
      result.media += matchingMedia.length + voiceCopies.length;
    }
  };
  placeRequest.onsuccess = linkWhenReady;
  entryRequest.onsuccess = linkWhenReady;
  mediaRequest.onsuccess = linkWhenReady;
  await completion;
  return result;
}

export async function deleteItem(name: StoreName, id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(name, 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore(name).delete(id);
  await completion;
}

/**
 * Move an old city-wide finance sheet into a chosen journey atomically. A
 * destination sheet is never overwritten, and a failed transaction preserves
 * the original budget and expenses.
 */
export async function moveLegacyPlanToJourney(legacyId: string, journeyPlan: TripPlan): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction('plans', 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore('plans');
  const existingRequest = store.get(journeyPlan.id);
  existingRequest.onsuccess = () => {
    if (existingRequest.result) {
      transaction.abort();
      return;
    }
    store.put(journeyPlan);
    store.delete(legacyId);
  };
  await completion;
}

/** One transaction keeps each media metadata row paired with its binary file. */
export async function saveMediaBatch(items: Array<{ media: TravelMedia; blob: Blob }>, entries: DayEntry[] = []): Promise<void> {
  if (!items.length && !entries.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(['media', 'mediaFiles', 'entries'], 'readwrite');
  const completion = transactionDone(transaction);
  for (const entry of entries) transaction.objectStore('entries').put(entry);
  for (const { media, blob } of items) {
    transaction.objectStore('media').put(media);
    transaction.objectStore('mediaFiles').put({ id: media.id, blob } satisfies MediaFile);
  }
  await completion;
}

export async function getMediaBlob(id: string): Promise<Blob> {
  const database = await openDatabase();
  const file = await requestResult<MediaFile | undefined>(database.transaction('mediaFiles', 'readonly').objectStore('mediaFiles').get(id));
  if (!file?.blob) throw new Error('本机媒体文件已丢失');
  return file.blob;
}

/** AI 配图与用户原始媒体分开存储，不进入足迹、相册或实际账本。 */
export async function getPlannerPhotoBlob(id: string): Promise<Blob | null> {
  const database = await openDatabase();
  const file = await requestResult<MediaFile | undefined>(database.transaction('plannerPhotoFiles', 'readonly').objectStore('plannerPhotoFiles').get(id));
  return file?.blob ?? null;
}

export async function savePlannerPhotoBlob(id: string, blob: Blob): Promise<void> {
  if (!/^[a-f\d]{64}$/.test(id) || blob.type !== 'image/webp' || blob.size > 8 * 1024 * 1024) throw new Error('本地行程照片无效');
  const database = await openDatabase();
  const transaction = database.transaction('plannerPhotoFiles', 'readwrite');
  const completion = transactionDone(transaction);
  transaction.objectStore('plannerPhotoFiles').put({ id, blob });
  await completion;
}

/** Thumbnails are disposable; backups include originals, not this cache. */
export async function getMediaPreview(id: string, kind: TravelMedia['kind']): Promise<Blob> {
  const database = await openDatabase();
  const cached = await requestResult<MediaFile | undefined>(database.transaction('mediaPreviews', 'readonly').objectStore('mediaPreviews').get(id));
  if (cached) return cached.blob;
  const original = await getMediaBlob(id);
  if (kind !== 'photo') return original;
  try {
    const image = await createImageBitmap(original);
    const ratio = Math.min(1, 360 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const preview = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!preview) return original;
    const transaction = database.transaction('mediaPreviews', 'readwrite');
    const completion = transactionDone(transaction);
    transaction.objectStore('mediaPreviews').put({ id, blob: preview } satisfies MediaFile);
    await completion;
    return preview;
  } catch {
    return original;
  }
}

export async function deleteMediaRecord(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['media', 'mediaFiles', 'mediaPreviews'], 'readwrite');
  const completion = transactionDone(transaction);
  for (const name of ['media', 'mediaFiles', 'mediaPreviews']) transaction.objectStore(name).delete(id);
  await completion;
}

/** Snapshot lists lightweight metadata; photo and video Blobs are fetched on demand. */
export async function loadSnapshot(): Promise<AppSnapshot> {
  // 同一个只读事务读取关联表，避免跨标签页写入时导出不对应的旅行、地点和账本。
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES, 'readonly');
  const [marks, entries, plans, media, badges, profile, trips, places, aiPlans, plannerPreferences]
    = await Promise.all(STORE_NAMES.map((name) => requestResult(transaction.objectStore(name).getAll())));
  const snapshot = { marks, entries, plans, media, badges, profile, trips, places, aiPlans, plannerPreferences } as AppSnapshot;
  return { ...snapshot, aiPlans: snapshot.aiPlans.map(upgradeLegacyBookingSchedule) };
}

/** Compare-and-save in one IndexedDB transaction. A second tab or a late AI
 * response cannot silently overwrite a newer local edit.
 */
export async function saveAiPlan(plan: AiTravelPlan, expectedVersion: number | null): Promise<void> {
  validatePlannerContent(plan.content);
  const database = await openDatabase();
  const transaction = database.transaction('aiPlans', 'readwrite');
  const completion = transactionDone(transaction);
  let conflict = false;
  const store = transaction.objectStore('aiPlans');
  const request = store.get(plan.id);
  request.onsuccess = () => {
    const existing = request.result as AiTravelPlan | undefined;
    if ((expectedVersion === null && existing) || (expectedVersion !== null && existing?.version !== expectedVersion)) {
      conflict = true; transaction.abort(); return;
    }
    // 地图位置由独立事务写入，不因正在进行的AI/照片保存带着旧快照而丢失。
    store.put({ ...plan, mapPositions: { ...plan.mapPositions, ...existing?.mapPositions } });
  };
  try { await completion; } catch (error) { if (conflict) throw new Error('计划已在其他操作中更新，请刷新后重试'); throw error; }
}

/** 云同步专用：直接将云端最新 AI 攻略落盘到本地 IndexedDB，跳过本地新建/编辑乐观锁校验，且兼容历史版本字段避免单条旧攻略阻塞整轮同步。 */
export async function upsertAiPlanFromCloud(plan: AiTravelPlan): Promise<void> {
  if (!plan || !plan.id || !plan.content) return;
  const database = await openDatabase();
  const transaction = database.transaction('aiPlans', 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore('aiPlans');
  const request = store.get(plan.id);
  request.onsuccess = () => {
    const existing = request.result as AiTravelPlan | undefined;
    store.put({
      ...plan,
      mapPositions: { ...existing?.mapPositions, ...plan.mapPositions },
    });
  };
  await completion;
}

/** 在同一个事务内合并坐标，多天的自动定位与手动校正不会互相覆盖。 */
export async function savePlannerMapPositions(planId: string, positions: import('./planner-map').PlannerMapPosition[]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction('aiPlans', 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore('aiPlans');
  const request = store.get(planId);
  request.onsuccess = () => {
    const current = request.result as AiTravelPlan | undefined;
    if (!current) { transaction.abort(); return; }
    const mapPositions = { ...current.mapPositions };
    for (const position of positions) {
      // 自动重试永不覆盖已手动确认的位置。
      if (mapPositions[position.key]?.source === '手动确认' && !['手动确认', '用户选择开放地图位置'].includes(position.source || '')) continue;
      mapPositions[position.key] = position;
    }
    store.put({ ...current, mapPositions, updatedAt: new Date().toISOString() });
  };
  await completion;
}

/** 自动配图只改一张活动照片：在同一事务里读取最新计划再写回，
 * 不增加版本、不写入撤销历史，多张照片陆续返回也不会互相覆盖。
 * 活动已被删除时直接忽略。
 */
export async function saveAiPlanPhoto(planId: string, activityId: string, photo: PlannerPhoto): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction('aiPlans', 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore('aiPlans');
  const request = store.get(planId);
  request.onsuccess = () => {
    const existing = request.result as AiTravelPlan | undefined;
    const target = existing?.content.days.flatMap((day) => day.activities).find((item) => item.id === activityId);
    if (!existing || !target) return;
    target.photo = photo;
    existing.updatedAt = new Date().toISOString();
    store.put(existing);
  };
  await completion;
}

function plannerPublicationSnapshot(plan: AiTravelPlan, budgetOverride?: TripPlan['budget']): NonNullable<AiTravelPlan['linkedSnapshot']> {
  const budget = budgetOverride ?? Object.fromEntries(Object.entries(calculatePlannerBudget(plan.content).categories)
    .map(([key, cents]) => [key, cents / 100])) as TripPlan['budget'];
  return {
    title: plan.content.title, startDate: plan.content.days[0].date,
    endDate: plan.content.days.at(-1)!.date, cities: plan.content.cities, budget,
  };
}

/** 首次记录景点和手动发布沿用同样的旅行、预算初始值。 */
function plannerPublicationRecords(
  tripId: string,
  snapshot: NonNullable<AiTravelPlan['linkedSnapshot']>,
  plan: AiTravelPlan,
  trip?: Journey,
  finance?: TripPlan,
  firstFinance?: TripPlan,
): { journey: Journey; sheet: TripPlan } {
  const journey: Journey = {
    ...trip, id: tripId, title: snapshot.title, startDate: snapshot.startDate, endDate: snapshot.endDate,
    cities: snapshot.cities, status: trip?.status ?? 'planned', companions: trip?.companions ?? [],
    createdAt: trip?.createdAt ?? new Date().toISOString(),
  };
  const sheet: TripPlan = {
    ...finance, id: tripId, tripId, cityCode: journey.cities[0].code,
    dailyExpenses: firstFinance?.dailyExpenses ?? finance?.dailyExpenses,
    aiExpenseSeeded: firstFinance?.aiExpenseSeeded ?? finance?.aiExpenseSeeded,
    overallExpenses: firstFinance?.overallExpenses ?? finance?.overallExpenses,
    unallocatedFood: firstFinance?.unallocatedFood ?? finance?.unallocatedFood,
    startDate: journey.startDate, endDate: journey.endDate, people: firstFinance?.people ?? plan.content.request.people,
    budget: snapshot.budget,
    actual: firstFinance?.actual ?? finance?.actual ?? { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 },
    manualActualTotal: firstFinance?.manualActualTotal ?? finance?.manualActualTotal ?? null,
    reminderDays: firstFinance?.reminderDays ?? finance?.reminderDays ?? 1,
    splitMembers: firstFinance?.splitMembers ?? finance?.splitMembers,
    splitItems: firstFinance?.splitItems ?? finance?.splitItems,
  };
  return { journey, sheet };
}

/** 手动同步只写旅行和预算。手账已有地点的城市继续保留，原地点和照片无需搬动。
 * 它不调用 saveJourneyAndLinkCityRecords，因此不会把城市独立收藏移入这次旅行。
 */
export async function publishAiPlan(plan: AiTravelPlan, initialFinance?: TripPlan): Promise<AiTravelPlan> {
  validatePlannerContent(plan.content);
  const database = await openDatabase();
  const transaction = database.transaction(['aiPlans', 'trips', 'plans', 'places'], 'readwrite');
  const completion = transactionDone(transaction);
  const tripId = plan.linkedTripId ?? createLocalId();
  // 首次从账本保存时，用户编辑的预算与花费和旅行关联在同一事务落盘。
  const firstFinance = !plan.linkedTripId ? initialFinance : undefined;
  const snapshot = plannerPublicationSnapshot(plan, firstFinance?.budget);
  const tripRequest = transaction.objectStore('trips').get(tripId);
  const financeRequest = transaction.objectStore('plans').get(tripId);
  const currentRequest = transaction.objectStore('aiPlans').get(plan.id);
  const placesRequest = plan.linkedTripId ? transaction.objectStore('places').getAll() : null;
  let errorMessage = '';
  let updated: AiTravelPlan | null = null;
  let completed = 0;
  const writeWhenReady = () => {
    if (++completed !== (placesRequest ? 4 : 3)) return;
    const current = currentRequest.result as AiTravelPlan | undefined;
    const trip = tripRequest.result as Journey | undefined;
    const finance = financeRequest.result as TripPlan | undefined;
    if (current?.version !== plan.version) errorMessage = '计划已更新，请刷新后再同步';
    if (trip && plan.linkedSnapshot) {
      const previous = plan.linkedSnapshot;
      if (trip.title !== previous.title || trip.startDate !== previous.startDate || trip.endDate !== previous.endDate
        || !plannerValueEqual(trip.cities, previous.cities)
        || (finance && !plannerValueEqual(finance.budget, previous.budget))) errorMessage = '旅行记录或预算已有人工修改，为避免覆盖，请先在记录页核对；原内容已保留';
    }
    if (plan.linkedTripId && !trip) errorMessage = '关联旅行已不存在，无法覆盖同步';
    if (errorMessage) { transaction.abort(); return; }
    const recordedCityCodes = new Set((placesRequest?.result as JourneyPlace[] | undefined)
      ?.filter((place) => place.tripId === tripId).map((place) => place.cityCode));
    const plannedCityCodes = new Set(snapshot.cities.map((city) => city.code));
    // 行程取消了某座城市，已经在那里记录的地点仍应能从旅行手账打开。
    snapshot.cities = [...snapshot.cities, ...(trip?.cities ?? []).filter((city) =>
      recordedCityCodes.has(city.code) && !plannedCityCodes.has(city.code))];
    const { journey, sheet } = plannerPublicationRecords(tripId, snapshot, plan, trip, finance, firstFinance);
    updated = { ...plan, version: plan.version + 1, linkedTripId: tripId, linkedSnapshot: structuredClone(snapshot), updatedAt: new Date().toISOString() };
    transaction.objectStore('trips').put(journey);
    transaction.objectStore('plans').put(sheet);
    transaction.objectStore('aiPlans').put(updated);
  };
  tripRequest.onsuccess = writeWhenReady;
  financeRequest.onsuccess = writeWhenReady;
  currentRequest.onsuccess = writeWhenReady;
  if (placesRequest) placesRequest.onsuccess = writeWhenReady;
  try { await completion; } catch (error) { if (errorMessage) throw new Error(errorMessage); throw error; }
  return updated!;
}

/** 用户确认一个景点后，行程关联、地点和完成状态在同一次事务保存。
 * 按旅行与城市内的规范地名复用地点，同一景点玩两次也共用照片和回忆。
 */
export async function recordPlannerJournalVisit(
  planId: string, activityId: string, expectedActivityKey: string, selectedCityCode?: string,
): Promise<{ place: JourneyPlace; cityName: string }> {
  const database = await openDatabase();
  const transaction = database.transaction(['aiPlans', 'trips', 'plans', 'places'], 'readwrite');
  const completion = transactionDone(transaction);
  const planStore = transaction.objectStore('aiPlans');
  const tripStore = transaction.objectStore('trips');
  const placeStore = transaction.objectStore('places');
  try {
    const current = await requestResult<AiTravelPlan | undefined>(planStore.get(planId));
    const activity = current?.content.days.flatMap((day) => day.activities).find((item) => item.id === activityId);
    const activityKey = activity && plannerJournalActivityKey(activity);
    if (!current || activity?.kind !== 'sight' || activityKey !== expectedActivityKey) {
      throw new Error('景点安排已变更，请刷新行程后再记录');
    }
    const city = selectedCityCode
      ? current.content.cities.find((item) => item.code === selectedCityCode)
      : plannerJournalCity(current.content.cities, activity.city);
    if (!city) throw new Error('请先确认景点所属城市');
    const placeName = plannerJournalPlaceName(activity);
    if (!placeName) throw new Error('请先填写景点名称');

    const tripId = current.linkedTripId ?? createLocalId();
    const [trip, places] = await Promise.all([
      requestResult<Journey | undefined>(tripStore.get(tripId)),
      requestResult<JourneyPlace[]>(placeStore.getAll()),
    ]);
    if (current.linkedTripId && !trip) throw new Error('关联的旅行记录已不存在，请先核对旅行手账');
    const previous = plannerJournalVisitFor(current, activity);
    const tripPlaces = places.filter((place) => place.tripId === tripId && place.cityCode === city.code);
    const earlierPlace = previous && tripPlaces.find((place) => place.id === previous.placeId);
    if (earlierPlace) {
      await completion;
      return { place: earlierPlace, cityName: city.name };
    }

    const now = new Date().toISOString();
    const existing = tripPlaces.find((place) => journalPlaceNameKey(place.name) === journalPlaceNameKey(placeName));
    const place: JourneyPlace = existing ?? {
      id: createLocalId(), tripId, cityCode: city.code, name: placeName,
      reviewText: '', reviewAudioId: null, createdAt: now,
    };
    let linkedSnapshot = current.linkedSnapshot;
    if (!trip) {
      linkedSnapshot = plannerPublicationSnapshot(current);
      const { journey, sheet } = plannerPublicationRecords(tripId, linkedSnapshot, current);
      tripStore.add(journey);
      transaction.objectStore('plans').add(sheet);
    } else if (!trip.cities.some((item) => item.code === city.code)) {
      // 只为已确认到访的地点追加城市，保留手账已有的日期、标题和账本。
      const cities = [...trip.cities, city];
      tripStore.put({ ...trip, cities });
      if (linkedSnapshot && plannerValueEqual(trip.cities, linkedSnapshot.cities)) {
        linkedSnapshot = { ...linkedSnapshot, cities };
      }
    }
    if (!existing) placeStore.add(place);
    const visit: PlannerJournalVisit = { tripId, placeId: place.id, activityKey, completedAt: now };
    planStore.put({
      ...current, linkedTripId: tripId, linkedSnapshot, version: current.version + 1,
      contentVersion: current.contentVersion ?? current.version, updatedAt: now,
      journalVisits: { ...current.journalVisits, [activityId]: visit },
    } satisfies AiTravelPlan);
    await completion;
    return { place, cityName: city.name };
  } catch (error) {
    try { transaction.abort(); } catch { /* IndexedDB 可能已因写入失败回滚。 */ }
    await completion.catch(() => undefined);
    throw error;
  }
}

/** Validate first in backup.ts, then replace all records in one transaction. */
export async function replaceSnapshot(snapshot: AppSnapshot, files: MediaFile[], plannerPhotos: MediaFile[] = []): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...STORE_NAMES, 'mediaFiles', 'mediaPreviews', 'plannerPhotoFiles'], 'readwrite');
  const completion = transactionDone(transaction);
  try {
    for (const name of STORE_NAMES) {
      const store = transaction.objectStore(name);
      store.clear();
      for (const item of snapshot[name]) store.put(item);
    }
    transaction.objectStore('mediaFiles').clear();
    transaction.objectStore('mediaPreviews').clear();
    for (const file of files) transaction.objectStore('mediaFiles').put(file);
    transaction.objectStore('plannerPhotoFiles').clear();
    for (const photo of plannerPhotos) transaction.objectStore('plannerPhotoFiles').put(photo);
    await completion;
  } catch (error) {
    // put() 也可能同步抛错。显式回滚，避免之前排队的 clear() 被提交。
    try { transaction.abort(); } catch { /* 事务可能已因写入错误而回滚。 */ }
    await completion.catch(() => undefined);
    throw error;
  }
}
