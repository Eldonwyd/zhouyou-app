import type {
  AppSnapshot, Badge, CityMark, DayEntry, Journey, JourneyPlace, LocalProfile,
  MediaFile, TravelMedia, TripPlan,
} from './types';

const DATABASE_NAME = 'travel-footprints';
const DATABASE_VERSION = 2;
export const STORE_NAMES = ['marks', 'entries', 'plans', 'media', 'badges', 'profile', 'trips', 'places'] as const;
export type StoreName = typeof STORE_NAMES[number];

interface StoreTypes {
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
  for (const name of ['mediaFiles', 'mediaPreviews']) {
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
  const [marks, entries, plans, media, badges, profile, trips, places] = await Promise.all(STORE_NAMES.map((name) => getAll(name)));
  return { marks, entries, plans, media, badges, profile, trips, places } as AppSnapshot;
}

/** Validate first in backup.ts, then replace all records in one transaction. */
export async function replaceSnapshot(snapshot: AppSnapshot, files: MediaFile[]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...STORE_NAMES, 'mediaFiles', 'mediaPreviews'], 'readwrite');
  const completion = transactionDone(transaction);
  for (const name of STORE_NAMES) {
    const store = transaction.objectStore(name);
    store.clear();
    for (const item of snapshot[name]) store.put(item);
  }
  transaction.objectStore('mediaFiles').clear();
  transaction.objectStore('mediaPreviews').clear();
  for (const file of files) transaction.objectStore('mediaFiles').put(file);
  await completion;
}
