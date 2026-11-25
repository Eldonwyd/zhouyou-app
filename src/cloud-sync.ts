import { deleteItem, getPlannerPhotoBlob, loadSnapshot, saveItem, savePlannerPhotoBlob, upsertAiPlanFromCloud } from './db';
import type { AppSnapshot } from './types';
import type { AiTravelPlan } from './planner-types';
import { cloudApi, getCachedCloudUser, getCloudPlannerPhotoUrl, getCloudToken, type CloudQuota } from './cloud-api';
import { plannerApiUrl } from './api-base';
import { createLocalId } from './utils';

const LAST_SYNC_KEY = 'zhouyou-cloud-last-sync';
const LAST_CLOUD_VERSION_KEY = 'zhouyou-cloud-version';
const LAST_SYNC_TOKEN_KEY = 'zhouyou-cloud-sync-token';
const LAST_SYNC_USER_KEY = 'zhouyou-cloud-sync-user';
const PLAN_META_KEY = 'zhouyou-cloud-plan-meta';
const DIRTY_RECORDS_KEY = 'zhouyou-cloud-dirty-records';
const SYNC_SCHEMA_KEY = 'zhouyou-cloud-sync-schema';
const SYNC_SCHEMA_VERSION = '5';
const ASSET_ID_RE = /^[a-f0-9]{64}$/;
const RECORD_BATCH_MAX_COUNT = 25;
const RECORD_BATCH_MAX_BYTES = 380 * 1024;
const PLAN_BATCH_MAX_COUNT = 2;
const PLAN_BATCH_MAX_BYTES = 700 * 1024;
const MAX_SINGLE_PLAN_BYTES = 460 * 1024;
const PULL_OVERLAP_MS = 10_000;

/** 当前会话内最近一次同步失败的错误提示（用于个人中心与顶栏状态展示）。 */
let lastSyncErrorMessage = '';

export function getLastSyncError(): string {
  return lastSyncErrorMessage;
}

export function setLastSyncError(message: string): void {
  lastSyncErrorMessage = String(message || '').trim();
}

/** 当前会话内已确认完成云端/本地双向同步的行程照片 assetId，避免高频轮询重复检查。 */
const syncedPhotoIdsCache = new Set<string>();
let activeSyncPromise: Promise<SyncResult> | null = null;
let pendingResync = false;
let pendingForceFull = false;
let photoSyncRunning = false;
let queuedPhotoPlans: AiTravelPlan[] | null = null;

export interface CloudPlanMeta {
  ownerId: string;
  groupId: string | null;
  groupName: string;
  version: number;
  updatedByName: string;
  updatedAt: string;
}

export type CloudPlanMetaMap = Record<string, CloudPlanMeta>;

const SYNC_STORES = ['marks', 'badges', 'trips', 'places', 'entries', 'plans', 'plannerPreferences', 'profile'] as const;
export type SyncStore = typeof SYNC_STORES[number];
export type DirtyStore = SyncStore | 'aiPlans';

interface DirtyRecordEntry {
  store: DirtyStore;
  id: string;
  updatedAt: string;
  deleted?: boolean;
  allStore?: boolean;
}

function readDirtyRecords(): Record<string, DirtyRecordEntry> {
  try {
    const raw = localStorage.getItem(DIRTY_RECORDS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DirtyRecordEntry>) : {};
  } catch {
    return {};
  }
}

function writeDirtyRecords(map: Record<string, DirtyRecordEntry>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(DIRTY_RECORDS_KEY);
    else localStorage.setItem(DIRTY_RECORDS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function clearPushedDirtyKeys(dirtySnapshot: Record<string, DirtyRecordEntry>, keys: Iterable<string>): void {
  const latestDirty = readDirtyRecords();
  let changed = false;
  for (const key of keys) {
    const before = dirtySnapshot[key];
    const nowEntry = latestDirty[key];
    if (before && nowEntry && nowEntry.updatedAt === before.updatedAt) {
      delete latestDirty[key];
      changed = true;
    }
  }
  if (changed) writeDirtyRecords(latestDirty);
}

/** 标记单条本地记录已变更，确保下次同步无视设备时钟偏差强制推送到云端。 */
export function markCloudRecordDirty(store: DirtyStore, id: string): void {
  if (!id) return;
  const map = readDirtyRecords();
  map[`${store}:${id}`] = { store, id, updatedAt: new Date().toISOString() };
  writeDirtyRecords(map);
}

/** 标记单条本地记录已删除，同步时推送软删除到云端。 */
export function markCloudRecordDeleted(store: DirtyStore, id: string): void {
  if (!id) return;
  const map = readDirtyRecords();
  map[`${store}:${id}`] = { store, id, updatedAt: new Date().toISOString(), deleted: true };
  writeDirtyRecords(map);
}

/** 标记整类数据表发生多条联动写入（如新建旅程联动点亮城市），下次同步自动推送该表全量最新状态。 */
export function markCloudStoreDirty(store: DirtyStore): void {
  const map = readDirtyRecords();
  map[`${store}:*`] = { store, id: '*', updatedAt: new Date().toISOString(), allStore: true };
  writeDirtyRecords(map);
}

/** 标记全部可同步表已变更（例如恢复本地 ZIP 备份后将恢复的数据同步到云端）。 */
export function markAllCloudStoresDirty(): void {
  for (const store of SYNC_STORES) {
    markCloudStoreDirty(store);
  }
  markCloudStoreDirty('aiPlans');
}

/** 返回本机尚未成功推送到云端的待同步变更数量。 */
export function getPendingCloudChangeCount(): number {
  return Object.keys(readDirtyRecords()).length;
}

/** 是否存在本机尚未成功推送到云端的变更（用于后台自动补传与 UI 状态展示）。 */
export function hasPendingCloudChanges(): boolean {
  return getPendingCloudChangeCount() > 0;
}

export function getLastSyncTime(): string {
  try { return localStorage.getItem(LAST_SYNC_KEY) || ''; } catch { return ''; }
}

function setLastSyncTime(iso: string): void {
  try {
    if (iso) localStorage.setItem(LAST_SYNC_KEY, iso);
    else localStorage.removeItem(LAST_SYNC_KEY);
  } catch { /* ignore */ }
}

export function getLastCloudVersion(): string {
  try { return localStorage.getItem(LAST_CLOUD_VERSION_KEY) || ''; } catch { return ''; }
}

function setLastCloudVersion(iso: string): void {
  try {
    if (iso) localStorage.setItem(LAST_CLOUD_VERSION_KEY, iso);
    else localStorage.removeItem(LAST_CLOUD_VERSION_KEY);
  } catch { /* ignore */ }
}

function getLastSyncToken(): string {
  try { return localStorage.getItem(LAST_SYNC_TOKEN_KEY) || ''; } catch { return ''; }
}

function setLastSyncToken(token: string): void {
  try {
    if (token) localStorage.setItem(LAST_SYNC_TOKEN_KEY, token);
    else localStorage.removeItem(LAST_SYNC_TOKEN_KEY);
  } catch { /* ignore */ }
}

function getLastSyncUserId(): string {
  try { return localStorage.getItem(LAST_SYNC_USER_KEY) || ''; } catch { return ''; }
}

function setLastSyncUserId(userId: string): void {
  try {
    if (userId) localStorage.setItem(LAST_SYNC_USER_KEY, userId);
    else localStorage.removeItem(LAST_SYNC_USER_KEY);
  } catch { /* ignore */ }
}

export function resetCloudSyncCursor(): void {
  try {
    localStorage.removeItem(LAST_SYNC_KEY);
    localStorage.removeItem(LAST_CLOUD_VERSION_KEY);
    localStorage.removeItem(LAST_SYNC_TOKEN_KEY);
    localStorage.removeItem(LAST_SYNC_USER_KEY);
    localStorage.removeItem(DIRTY_RECORDS_KEY);
    localStorage.removeItem(PLAN_META_KEY);
  } catch { /* ignore */ }
  lastSyncErrorMessage = '';
  syncedPhotoIdsCache.clear();
}

export function getCloudPlanMetaMap(): CloudPlanMetaMap {
  try {
    const raw = localStorage.getItem(PLAN_META_KEY);
    return raw ? (JSON.parse(raw) as CloudPlanMetaMap) : {};
  } catch {
    return {};
  }
}

export function setCloudPlanMetaMap(map: CloudPlanMetaMap): void {
  try {
    localStorage.setItem(PLAN_META_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function updateCloudPlanMeta(planId: string, patch: Partial<CloudPlanMeta>): void {
  const map = getCloudPlanMetaMap();
  const prev = map[planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
  map[planId] = { ...prev, ...patch };
  setCloudPlanMetaMap(map);
}

function getRecordTimestamp(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  for (const key of ['updatedAt', 'createdAt', 'earnedAt', 'date']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key] as string;
  }
  return '';
}

function parseMs(iso: string): number {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
}

function utf8Bytes(str: string): number {
  return new TextEncoder().encode(str).byteLength;
}

/** 推送前在客户端清理 AI 攻略中的临时截图与过度膨胀的撤销历史，避免撑破 2MB 请求体或 512KB 单攻略上限。 */
function sanitizeAiPlanForPush(plan: AiTravelPlan): AiTravelPlan {
  const clone = JSON.parse(JSON.stringify(plan)) as AiTravelPlan;
  if (Array.isArray(clone.content?.request?.references)) {
    clone.content.request.references = clone.content.request.references.map((ref) => {
      if (!ref || typeof ref !== 'object') return ref;
      const { noteImages: _omit, ...rest } = ref;
      return rest;
    });
  }
  if (Array.isArray(clone.history) && clone.history.length > 0 && utf8Bytes(JSON.stringify(clone)) > MAX_SINGLE_PLAN_BYTES) {
    while (clone.history.length > 0 && utf8Bytes(JSON.stringify(clone)) > MAX_SINGLE_PLAN_BYTES) {
      clone.history.shift();
    }
  }
  return clone;
}

function extractPlanPhotoAssetIds(plans: AiTravelPlan[]): string[] {
  const ids = new Set<string>();
  for (const plan of plans) {
    for (const day of plan?.content?.days || []) {
      for (const act of day?.activities || []) {
        const id = act?.photo?.assetId?.toLowerCase();
        if (id && ASSET_ID_RE.test(id)) ids.add(id);
      }
    }
  }
  return [...ids];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function compressPhotoBlobForCloud(blob: Blob): Promise<{ mimeType: string; dataBase64: string } | null> {
  const allowedDirect = blob.type === 'image/webp' || blob.type === 'image/jpeg';
  if (allowedDirect && blob.size > 0 && blob.size <= 160 * 1024) {
    return { mimeType: blob.type, dataBase64: await blobToBase64(blob) };
  }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    if (blob.size <= 220 * 1024 && (allowedDirect || blob.type === 'image/png')) {
      return { mimeType: blob.type || 'image/jpeg', dataBase64: await blobToBase64(blob) };
    }
    return null;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const attempts: Array<{ maxSide: number; quality: number }> = [
      { maxSide: 960, quality: 0.8 },
      { maxSide: 720, quality: 0.68 },
      { maxSide: 560, quality: 0.6 },
    ];
    for (const { maxSide, quality } of attempts) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height, 1));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const encoded = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((out) => resolve(out), 'image/webp', quality);
      }) || await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((out) => resolve(out), 'image/jpeg', quality);
      });
      if (encoded && encoded.size > 0 && encoded.size <= 220 * 1024) {
        const mimeType = encoded.type === 'image/webp' || encoded.type === 'image/jpeg' ? encoded.type : 'image/jpeg';
        return { mimeType, dataBase64: await blobToBase64(encoded) };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

async function resolveLocalPlannerPhotoBlob(assetId: string): Promise<Blob | null> {
  const fromIdb = await getPlannerPhotoBlob(assetId).catch(() => null);
  if (fromIdb) return fromIdb;
  try {
    const resp = await fetch(plannerApiUrl(`photo-file/${assetId}`));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (blob.size > 0) {
      await savePlannerPhotoBlob(assetId, blob).catch(() => undefined);
      return blob;
    }
  } catch {
    // 移动端或纯网页端无本地照片服务，直接忽略
  }
  return null;
}

/** 单张搜索到的行程参考图立即后台上传云端（按内容哈希去重）。 */
export async function syncSinglePlannerPhotoToCloud(assetId: string): Promise<boolean> {
  const normalized = String(assetId || '').toLowerCase();
  if (!getCloudToken() || !ASSET_ID_RE.test(normalized) || syncedPhotoIdsCache.has(normalized)) return false;
  try {
    const { existing } = await cloudApi.checkPlannerPhotosExist([normalized]);
    if (existing.includes(normalized)) {
      syncedPhotoIdsCache.add(normalized);
      return false;
    }
    const blob = await resolveLocalPlannerPhotoBlob(normalized);
    if (!blob) return false;
    const compressed = await compressPhotoBlobForCloud(blob);
    if (!compressed) return false;
    await cloudApi.uploadPlannerPhoto({
      assetId: normalized,
      mimeType: compressed.mimeType,
      dataBase64: compressed.dataBase64,
    });
    syncedPhotoIdsCache.add(normalized);
    return true;
  } catch {
    return false;
  }
}

/** 双向同步行程计划里搜索到的参考照片（上传本地已有但云端缺失的，下载云端已有但本地缺失的）。 */
async function syncPlannerPhotosWithCloud(allPlans: AiTravelPlan[]): Promise<{ uploaded: number; downloaded: number }> {
  const assetIds = extractPlanPhotoAssetIds(allPlans).filter((id) => !syncedPhotoIdsCache.has(id));
  if (assetIds.length === 0) return { uploaded: 0, downloaded: 0 };

  let uploaded = 0;
  let downloaded = 0;

  // 每批最多 40 张，避免单次请求体过大
  for (let i = 0; i < assetIds.length; i += 40) {
    const batch = assetIds.slice(i, i + 40);
    let existingSet = new Set<string>();
    try {
      const checkRes = await cloudApi.checkPlannerPhotosExist(batch);
      existingSet = new Set((checkRes.existing || []).map((id) => id.toLowerCase()));
    } catch {
      continue;
    }

    for (const assetId of batch) {
      if (existingSet.has(assetId)) {
        // 云端已有：若本机 IndexedDB 缺失则拉到本地缓存，离线和切页都能秒开
        const localBlob = await getPlannerPhotoBlob(assetId).catch(() => null);
        if (!localBlob) {
          try {
            const resp = await fetch(getCloudPlannerPhotoUrl(assetId));
            if (resp.ok) {
              const blob = await resp.blob();
              if (blob.size > 0) {
                await savePlannerPhotoBlob(assetId, blob);
                downloaded += 1;
              }
            }
          } catch {
            // 单张下载失败不阻塞整体同步
          }
        }
        syncedPhotoIdsCache.add(assetId);
      } else {
        // 云端暂无：若本机有该照片则压缩后上传云端
        const localBlob = await resolveLocalPlannerPhotoBlob(assetId);
        if (localBlob) {
          try {
            const compressed = await compressPhotoBlobForCloud(localBlob);
            if (compressed) {
              await cloudApi.uploadPlannerPhoto({
                assetId,
                mimeType: compressed.mimeType,
                dataBase64: compressed.dataBase64,
              });
              uploaded += 1;
              syncedPhotoIdsCache.add(assetId);
            }
          } catch {
            // 单张上传失败不阻塞整体同步
          }
        }
      }
    }
  }

  return { uploaded, downloaded };
}

/** 后台异步同步行程参考图，不阻塞主文字/攻略同步与 UI 刷新。 */
function schedulePlannerPhotosSync(allPlans: AiTravelPlan[]): void {
  if (!getCloudToken() || allPlans.length === 0) return;
  queuedPhotoPlans = allPlans;
  if (photoSyncRunning) return;
  photoSyncRunning = true;
  void (async () => {
    try {
      while (queuedPhotoPlans) {
        const nextPlans = queuedPhotoPlans;
        queuedPhotoPlans = null;
        await syncPlannerPhotosWithCloud(nextPlans).catch(() => undefined);
      }
    } finally {
      photoSyncRunning = false;
    }
  })();
}

/** 轻量探测云端是否有其他设备写入的新版本（基于服务端 syncToken 指纹 + 时间戳双重判定，不受跨节点时钟偏差影响）。 */
export async function checkCloudSyncNeeded(): Promise<boolean> {
  if (!getCloudToken()) return false;
  if (hasPendingCloudChanges()) return true;
  try {
    if (localStorage.getItem(SYNC_SCHEMA_KEY) !== SYNC_SCHEMA_VERSION) return true;
  } catch { /* ignore */ }
  const currentUserId = getCachedCloudUser()?.id || '';
  const lastUserId = getLastSyncUserId();
  if (currentUserId && lastUserId && currentUserId !== lastUserId) return true;

  const res = await cloudApi.getSyncVersion();
  if (res.syncToken) {
    const lastToken = getLastSyncToken();
    if (!lastToken || res.syncToken !== lastToken) {
      return true;
    }
    return false;
  }
  const lastVersion = getLastCloudVersion();
  if (!res.latestUpdatedAt) return false;
  if (!lastVersion || res.latestUpdatedAt > lastVersion) {
    return true;
  }
  return false;
}

export interface SyncConflictInfo {
  planId: string;
  reason: string;
  backupPlanId?: string;
  backupTitle?: string;
}

export interface SyncResult {
  snapshot: AppSnapshot;
  serverTime: string;
  pulledRecords: number;
  pulledPlans: number;
  pushedRecords: number;
  pushedPlans: number;
  syncedPhotos: number;
  conflicts: SyncConflictInfo[];
  quota: CloudQuota;
}

function formatConflictStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 多人编辑冲突时，将本地未提交修改另存为独立本地副本，防止被云端版本静默覆盖丢失。 */
async function saveLocalConflictBackup(localPlan: AiTravelPlan): Promise<{ id: string; title: string }> {
  const backupId = `conflict-${createLocalId()}`;
  const baseTitle = (localPlan.content?.title || '未命名行程').replace(/（冲突备份[^）]*）$/, '').trim();
  const backupTitle = `${baseTitle}（冲突备份 ${formatConflictStamp()}）`;
  const now = new Date().toISOString();
  const backupPlan: AiTravelPlan = {
    ...localPlan,
    id: backupId,
    linkedTripId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    content: {
      ...localPlan.content,
      title: backupTitle,
    },
  };
  await upsertAiPlanFromCloud(backupPlan);
  return { id: backupId, title: backupTitle };
}

/**
 * 双向云同步（支持增量重叠窗口 + syncToken 指纹 + 地图记录与 AI 攻略解耦分片推送 + 并发自动续跑）：
 * 1. 首次/升级/切换账号/手动全量时拉全量；常规同步按上次游标向前重叠 10 秒增量拉取，杜绝时钟或毫秒边界漏拉；
 * 2. 使用服务端时间校准时钟偏差，显式脏修改永不被云端旧状态覆盖，未修改的本地记录在手动全量同步时永不反写覆盖云端新状态；
 * 3. 先分片推送个人记录（地图点亮 marks 最高优先级），再清理并分片推送 AI 攻略，彻底防止大体积攻略阻塞地图点亮上传；
 * 4. 若同步期间又有新修改到来，当前轮结束后自动补跑一轮，绝不吞掉新变更；
 * 5. 旅行计划参考图在独立后台队列同步，不阻塞主数据秒达。
 */
export async function syncWithCloud(forceFull = false): Promise<SyncResult> {
  if (!getCloudToken()) {
    throw new Error('未登录周游账号');
  }
  if (activeSyncPromise) {
    pendingResync = true;
    if (forceFull) pendingForceFull = true;
    return activeSyncPromise;
  }
  const run = (async () => {
    try {
      let lastResult = await runSyncWithCloudInternal(forceFull);
      while (pendingResync && getCloudToken()) {
        const runForce = pendingForceFull;
        pendingResync = false;
        pendingForceFull = false;
        lastResult = await runSyncWithCloudInternal(runForce);
      }
      lastSyncErrorMessage = '';
      return lastResult;
    } catch (err) {
      lastSyncErrorMessage = err instanceof Error ? err.message : '云同步失败';
      throw err;
    }
  })().finally(() => {
    activeSyncPromise = null;
    pendingResync = false;
    pendingForceFull = false;
  });
  activeSyncPromise = run;
  return run;
}

type RecordPushItem = { store: string; id: string; payload?: unknown; updatedAt?: string; deleted?: boolean; force?: boolean };
type PlanPushItem = { id: string; payload?: AiTravelPlan; baseVersion?: number; groupId?: string | null; deleted?: boolean };

function chunkByCountAndBytes<T>(items: T[], maxCount: number, maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const itemBytes = utf8Bytes(JSON.stringify(item));
    if (current.length > 0 && (current.length >= maxCount || currentBytes + itemBytes > maxBytes)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function runSyncWithCloudInternal(forceFull: boolean): Promise<SyncResult> {
  const currentUserId = getCachedCloudUser()?.id || '';
  const prevSyncUserId = getLastSyncUserId();
  const accountSwitched = Boolean(currentUserId && prevSyncUserId && currentUserId !== prevSyncUserId);
  if (accountSwitched) {
    try {
      localStorage.removeItem(LAST_SYNC_KEY);
      localStorage.removeItem(LAST_CLOUD_VERSION_KEY);
      localStorage.removeItem(LAST_SYNC_TOKEN_KEY);
      localStorage.removeItem(PLAN_META_KEY);
    } catch { /* ignore */ }
  }

  const local = await loadSnapshot();
  let needsSchemaFullSync = false;
  try {
    needsSchemaFullSync = localStorage.getItem(SYNC_SCHEMA_KEY) !== SYNC_SCHEMA_VERSION;
  } catch { /* ignore */ }

  const prevLastSyncRaw = getLastSyncTime();
  const hadSyncedBefore = Boolean(prevLastSyncRaw) && !accountSwitched;
  const effectiveForceFull = forceFull || needsSchemaFullSync || !hadSyncedBefore;
  const prevLastSync = effectiveForceFull ? '' : prevLastSyncRaw;
  const isIncremental = Boolean(prevLastSync);
  // 增量拉取向前留出 10 秒重叠窗口，彻底消除跨节点时钟误差或同毫秒写入导致的漏拉
  const pullSince = isIncremental
    ? new Date(Math.max(0, parseMs(prevLastSync) - PULL_OVERLAP_MS)).toISOString()
    : '';
  // 留出 5 分钟时钟偏差容差，兜底未标脏的本地写入
  const prevLastSyncWithSkewMs = prevLastSync
    ? Math.max(0, parseMs(prevLastSync) - 5 * 60 * 1000)
    : 0;
  const dirtySnapshot = readDirtyRecords();

  const pullLocalBeforeMs = Date.now();
  const pull = await cloudApi.pullSync(pullSince);
  const pullLocalAfterMs = Date.now();
  const serverNowMs = parseMs(pull.serverTime);
  const clientMidMs = Math.round((pullLocalBeforeMs + pullLocalAfterMs) / 2);
  // 估算「服务端时间 - 本机时间」偏差，用于校准本机时间戳与云端时间戳比较
  const clockSkewMs = serverNowMs > 0 ? serverNowMs - clientMidMs : 0;

  const metaMap = getCloudPlanMetaMap();

  let pulledRecords = 0;
  let pulledPlans = 0;
  let pushedRecords = 0;
  let pushedPlans = 0;

  // 1. 合并个人纯文本记录（含地图点亮 marks、旅程 trips、地点 places、日记 entries、账本 plans、徽章 badges、偏好与个人资料 profile）
  const cloudRecordMap = new Map<string, { payload: unknown; updatedAt: string; deletedAt: string | null }>();
  for (const rec of pull.records) {
    cloudRecordMap.set(`${rec.store}:${rec.id}`, rec);
  }

  const recordsToPush: RecordPushItem[] = [];
  const recordDirtyKeyByTarget = new Map<string, string>();
  const wholeDirtyStores = new Set<string>();

  for (const store of SYNC_STORES) {
    const localList = (local[store] as Array<{ id: string }>) || [];
    const localById = new Map<string, { id: string }>(localList.map((item) => [item.id, item]));
    const wholeStoreDirty = Boolean(dirtySnapshot[`${store}:*`]);

    // 云端 -> 本地（含软删除同步）
    for (const rec of pull.records) {
      if (rec.store !== store) continue;
      const key = `${store}:${rec.id}`;
      const dirtyEntry = dirtySnapshot[key];
      if (dirtyEntry) {
        // 本机有显式未推送修改：
        // - 全量拉取返回的是云端历史状态，无条件保留本机显式修改；
        // - 增量拉取若云端记录时间不晚于上次同步（重叠窗口带回的旧数据），无条件保留本机修改；
        // - 若另一端在本次同步间隙并发修改了同一条，则按校准后的服务端时间比较先后。
        if (!isIncremental || !rec.updatedAt || rec.updatedAt <= prevLastSync) {
          continue;
        }
        const dirtyAdjustedMs = parseMs(dirtyEntry.updatedAt) + clockSkewMs;
        if (dirtyAdjustedMs >= parseMs(rec.updatedAt)) {
          continue;
        }
      }
      if (rec.deletedAt) {
        if (localById.has(rec.id)) {
          await deleteItem(store as SyncStore, rec.id);
          localById.delete(rec.id);
          pulledRecords += 1;
        }
        continue;
      }
      if (!rec.payload) continue;
      const localItem = localById.get(rec.id);
      if (localItem && JSON.stringify(localItem) === JSON.stringify(rec.payload)) {
        continue;
      }
      const localTs = getRecordTimestamp(localItem);
      const cloudTs = rec.updatedAt || getRecordTimestamp(rec.payload);
      // 只要本机未对该条做过显式修改：
      // - 增量拉取直接采纳云端；
      // - 已同步过的设备做全量同步（如点「立即同步」）也直接以云端为准，绝不因本机时钟偏快而拒绝更新甚至反写覆盖云端；
      // - 首次登录合并离线数据时，按校准时钟比较新旧。
      const localAdjustedMs = localTs ? parseMs(localTs) + clockSkewMs : 0;
      const cloudMs = parseMs(cloudTs);
      const shouldAccept = !localItem
        || (!dirtyEntry && !wholeStoreDirty && (isIncremental || hadSyncedBefore))
        || (cloudMs > 0 && (!localTs || cloudMs >= localAdjustedMs));
      if (shouldAccept) {
        await saveItem(store as SyncStore, rec.payload as never);
        localById.set(rec.id, rec.payload as { id: string });
        pulledRecords += 1;
      }
    }

    // 推送本表的显式删除墓碑
    for (const [key, entry] of Object.entries(dirtySnapshot)) {
      if (entry.store !== store || !entry.deleted || entry.allStore) continue;
      if (!localById.has(entry.id)) {
        recordsToPush.push({ store, id: entry.id, deleted: true, updatedAt: entry.updatedAt, force: true });
        recordDirtyKeyByTarget.set(`${store}:${entry.id}`, key);
      }
    }

    // 本地 -> 云端
    for (const item of localById.values()) {
      const key = `${store}:${item.id}`;
      const dirtyEntry = dirtySnapshot[key];
      const cloudRec = cloudRecordMap.get(key);
      const localTs = getRecordTimestamp(item);
      const sameAsCloud = Boolean(cloudRec && !cloudRec.deletedAt && cloudRec.payload && JSON.stringify(cloudRec.payload) === JSON.stringify(item));

      if (dirtyEntry && !dirtyEntry.deleted) {
        if (sameAsCloud) {
          clearPushedDirtyKeys(dirtySnapshot, [key]);
          continue;
        }
        recordsToPush.push({
          store,
          id: item.id,
          payload: item,
          updatedAt: dirtyEntry.updatedAt || localTs || new Date().toISOString(),
          force: true,
        });
        recordDirtyKeyByTarget.set(key, key);
        continue;
      }

      if (wholeStoreDirty) {
        if (!cloudRec?.deletedAt && !sameAsCloud) {
          recordsToPush.push({
            store,
            id: item.id,
            payload: item,
            updatedAt: localTs || new Date().toISOString(),
            force: true,
          });
        }
        continue;
      }

      if (sameAsCloud || cloudRec?.deletedAt) continue;

      if (isIncremental) {
        const localAdjustedMs = localTs ? parseMs(localTs) + clockSkewMs : 0;
        const cloudMs = cloudRec?.updatedAt ? parseMs(cloudRec.updatedAt) : 0;
        if (localTs && localAdjustedMs > prevLastSyncWithSkewMs && (!cloudRec || !cloudMs || localAdjustedMs > cloudMs)) {
          recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs, force: true });
        }
      } else {
        if (!cloudRec) {
          // 本地独有记录（例如离线点亮或此前未上云的记录）推送到云端
          recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs || new Date().toISOString(), force: true });
        } else if (!hadSyncedBefore) {
          // 仅首次登录合并离线本地数据时按校准时钟决定是否推本地版本；已同步设备的未脏记录已在上方以云端为准
          const localAdjustedMs = localTs ? parseMs(localTs) + clockSkewMs : 0;
          const cloudMs = parseMs(cloudRec.updatedAt);
          if (localTs && cloudMs > 0 && localAdjustedMs > cloudMs) {
            recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs, force: true });
          }
        }
      }
    }

    if (wholeStoreDirty) {
      wholeDirtyStores.add(store);
    }
  }

  // 2. 合并 AI 攻略（私有 + 群共享，接入脏队列 + 冲突自动另存本地副本防止静默覆盖丢数）
  const localPlansById = new Map<string, AiTravelPlan>(local.aiPlans.map((p) => [p.id, p]));
  const cloudPlansById = new Map(pull.aiPlans.map((p) => [p.id, p]));
  const plansToPush: PlanPushItem[] = [];
  const planDirtyKeyById = new Map<string, string>();
  const wholeAiPlansDirty = Boolean(dirtySnapshot['aiPlans:*']);
  const pullConflicts: SyncConflictInfo[] = [];
  const resolvedConflictDirtyKeys: string[] = [];
  const baseVersionBeforePull = new Map<string, number>();
  for (const [planId, meta] of Object.entries(metaMap)) {
    if (typeof meta?.version === 'number') baseVersionBeforePull.set(planId, meta.version);
  }

  for (const cp of pull.aiPlans) {
    const key = `aiPlans:${cp.id}`;
    const dirtyEntry = dirtySnapshot[key];
    const prevMeta = metaMap[cp.id];
    const lp = localPlansById.get(cp.id);
    if (dirtyEntry && !dirtyEntry.deleted && !cp.deletedAt && cp.payload && lp) {
      const sanitizedLp = sanitizeAiPlanForPush(lp);
      const sameContent = JSON.stringify(cp.payload) === JSON.stringify(sanitizedLp);
      const versionAdvanced = Boolean(prevMeta && cp.version > prevMeta.version);
      if (versionAdvanced && !sameContent) {
        // 本地有未推送编辑且云端版本已前进：绝不静默覆写本地，也不篡改 baseVersion 绕过乐观锁；先另存本地冲突副本再拉取云端最新版
        const backup = await saveLocalConflictBackup(lp);
        localPlansById.set(backup.id, { ...lp, id: backup.id, content: { ...lp.content, title: backup.title } });
        await upsertAiPlanFromCloud(cp.payload);
        localPlansById.set(cp.id, cp.payload);
        pulledPlans += 1;
        resolvedConflictDirtyKeys.push(key);
        metaMap[cp.id] = {
          ownerId: cp.ownerId,
          groupId: cp.groupId,
          groupName: cp.groupName,
          version: cp.version,
          updatedByName: cp.updatedByName,
          updatedAt: cp.updatedAt,
        };
        pullConflicts.push({
          planId: cp.id,
          reason: `${cp.updatedByName || '其他设备'} 刚刚更新了「${cp.payload.content?.title || '该攻略'}」`,
          backupPlanId: backup.id,
          backupTitle: backup.title,
        });
        continue;
      }
      const keepLocal = !isIncremental
        || !cp.updatedAt
        || cp.updatedAt <= prevLastSync
        || (parseMs(dirtyEntry.updatedAt) + clockSkewMs >= parseMs(cp.updatedAt));
      if (keepLocal) {
        metaMap[cp.id] = {
          ownerId: cp.ownerId,
          groupId: cp.groupId,
          groupName: cp.groupName,
          version: prevMeta?.version ?? cp.version,
          updatedByName: cp.updatedByName,
          updatedAt: cp.updatedAt,
        };
        continue;
      }
    }
    if (cp.deletedAt) {
      if (localPlansById.has(cp.id)) {
        await deleteItem('aiPlans', cp.id);
        localPlansById.delete(cp.id);
        delete metaMap[cp.id];
        pulledPlans += 1;
      }
      continue;
    }
    if (!cp.payload) continue;
    metaMap[cp.id] = {
      ownerId: cp.ownerId,
      groupId: cp.groupId,
      groupName: cp.groupName,
      version: cp.version,
      updatedByName: cp.updatedByName,
      updatedAt: cp.updatedAt,
    };
    if (lp && JSON.stringify(lp) === JSON.stringify(cp.payload)) {
      continue;
    }
    const versionAdvanced = Boolean(prevMeta && cp.version > prevMeta.version);
    const localAdjustedMs = lp?.updatedAt ? parseMs(lp.updatedAt) + clockSkewMs : 0;
    const cloudMs = parseMs(cp.updatedAt);
    const cloudNewer = !lp
      || (!dirtyEntry && !wholeAiPlansDirty && (isIncremental || hadSyncedBefore))
      || versionAdvanced
      || !lp.updatedAt
      || cloudMs >= localAdjustedMs;
    if (cloudNewer) {
      await upsertAiPlanFromCloud(cp.payload);
      localPlansById.set(cp.id, cp.payload);
      pulledPlans += 1;
    }
  }
  if (resolvedConflictDirtyKeys.length > 0) {
    clearPushedDirtyKeys(dirtySnapshot, resolvedConflictDirtyKeys);
  }

  // 推送 AI 攻略显式删除墓碑
  for (const [key, entry] of Object.entries(dirtySnapshot)) {
    if (entry.store !== 'aiPlans' || !entry.deleted || entry.allStore) continue;
    if (!localPlansById.has(entry.id)) {
      plansToPush.push({ id: entry.id, deleted: true });
      planDirtyKeyById.set(entry.id, key);
    }
  }

  for (const lp of localPlansById.values()) {
    const cp = cloudPlansById.get(lp.id);
    if (cp?.deletedAt) continue;
    const key = `aiPlans:${lp.id}`;
    const dirtyEntry = dirtySnapshot[key];
    const knownMeta = metaMap[lp.id];
    const sanitizedLp = sanitizeAiPlanForPush(lp);
    const sameAsCloud = Boolean(cp?.payload && JSON.stringify(cp.payload) === JSON.stringify(sanitizedLp));

    if (dirtyEntry && !dirtyEntry.deleted && !resolvedConflictDirtyKeys.includes(key)) {
      if (sameAsCloud) {
        clearPushedDirtyKeys(dirtySnapshot, [key]);
        continue;
      }
      plansToPush.push({
        id: lp.id,
        payload: sanitizedLp,
        baseVersion: baseVersionBeforePull.get(lp.id) ?? cp?.version ?? knownMeta?.version,
        groupId: cp?.groupId ?? knownMeta?.groupId ?? null,
      });
      planDirtyKeyById.set(lp.id, key);
      continue;
    }

    if (wholeAiPlansDirty) {
      if (!sameAsCloud) {
        plansToPush.push({
          id: lp.id,
          payload: sanitizedLp,
          baseVersion: cp?.version ?? knownMeta?.version,
          groupId: cp?.groupId ?? knownMeta?.groupId ?? null,
        });
      }
      continue;
    }

    if (sameAsCloud) continue;

    if (isIncremental) {
      const localAdjustedMs = lp.updatedAt ? parseMs(lp.updatedAt) + clockSkewMs : 0;
      const cloudMs = cp?.updatedAt ? parseMs(cp.updatedAt) : 0;
      const needsPush =
        !knownMeta
        || (Boolean(lp.updatedAt) && localAdjustedMs > prevLastSyncWithSkewMs && (!cp || !cloudMs || localAdjustedMs > cloudMs));
      if (needsPush) {
        plansToPush.push({
          id: lp.id,
          payload: sanitizedLp,
          baseVersion: cp?.version ?? knownMeta?.version,
          groupId: cp?.groupId ?? knownMeta?.groupId ?? null,
        });
      }
    } else {
      if (!cp) {
        plansToPush.push({ id: lp.id, payload: sanitizedLp });
      } else if (!hadSyncedBefore) {
        const localAdjustedMs = lp.updatedAt ? parseMs(lp.updatedAt) + clockSkewMs : 0;
        const cloudMs = parseMs(cp.updatedAt);
        if (lp.updatedAt && cloudMs > 0 && localAdjustedMs > cloudMs) {
          plansToPush.push({
            id: lp.id,
            payload: sanitizedLp,
            baseVersion: cp.version,
            groupId: cp.groupId,
          });
        }
      }
    }
  }

  const conflicts: SyncConflictInfo[] = [...pullConflicts];
  let latestQuota = pull.quota;
  // 以拉取开始时刻作为下次增量游标：同步期间其他设备写入的点亮/记录下一轮一定能拉到，不会被推送结束时间跳过
  const serverTime = pull.serverTime;

  // 3a. 优先分片推送个人记录（地图点亮 marks 排最前，彻底与大体积 AI 攻略解耦，绝不被攻略阻塞）
  if (recordsToPush.length > 0) {
    const prioritizedRecords = [...recordsToPush].sort((a, b) => {
      if (a.store === 'marks' && b.store !== 'marks') return -1;
      if (b.store === 'marks' && a.store !== 'marks') return 1;
      return 0;
    });
    const recordChunks = chunkByCountAndBytes(prioritizedRecords, RECORD_BATCH_MAX_COUNT, RECORD_BATCH_MAX_BYTES);
    const rejectedStoreSet = new Set<string>();
    let totalRejected = 0;

    for (const chunk of recordChunks) {
      const pushRes = await cloudApi.pushSync({ records: chunk });
      latestQuota = pushRes.quota;
      const rejected = pushRes.rejectedRecords || [];
      const rejectedKeys = new Set(rejected.map((r) => `${r.store}:${r.id}`));
      totalRejected += rejected.length;
      for (const r of rejected) rejectedStoreSet.add(r.store);
      pushedRecords += chunk.length - rejected.length;

      // 仅清理本批成功上传记录的脏标记（被拒绝的记录保留以便后续提示或重试）
      const acceptedDirtyKeys: string[] = [];
      for (const item of chunk) {
        const key = `${item.store}:${item.id}`;
        if (!rejectedKeys.has(key)) {
          const dirtyKey = recordDirtyKeyByTarget.get(key);
          if (dirtyKey) acceptedDirtyKeys.push(dirtyKey);
        }
      }
      if (acceptedDirtyKeys.length > 0) {
        clearPushedDirtyKeys(dirtySnapshot, acceptedDirtyKeys);
      }
    }

    if (wholeDirtyStores.size > 0) {
      const cleanWholeKeys = [...wholeDirtyStores]
        .filter((s) => !rejectedStoreSet.has(s))
        .map((s) => `${s}:*`);
      if (cleanWholeKeys.length > 0) {
        clearPushedDirtyKeys(dirtySnapshot, cleanWholeKeys);
      }
    }

    if (totalRejected > 0) {
      conflicts.push({
        planId: '',
        reason: `有 ${totalRejected} 条记录因单条过大或云端空间不足未能上传`,
      });
    }
  } else if (wholeDirtyStores.size > 0) {
    clearPushedDirtyKeys(dirtySnapshot, [...wholeDirtyStores].map((s) => `${s}:*`));
  }

  // 3b. 再分片推送 AI 攻略（单批或单份攻略失败只记入 conflicts，不影响已同步完成的地图点亮与手账记录）
  let allPlansSucceeded = true;
  if (plansToPush.length > 0) {
    const planChunks = chunkByCountAndBytes(plansToPush, PLAN_BATCH_MAX_COUNT, PLAN_BATCH_MAX_BYTES);
    for (const chunk of planChunks) {
      try {
        const pushRes = await cloudApi.pushSync({ aiPlans: chunk });
        latestQuota = pushRes.quota;
        const acceptedIds = new Set(Object.keys(pushRes.acceptedPlanVersions || {}));
        pushedPlans += acceptedIds.size;
        for (const [planId, ver] of Object.entries(pushRes.acceptedPlanVersions || {})) {
          const prev = metaMap[planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
          metaMap[planId] = { ...prev, version: ver, updatedAt: pushRes.serverTime };
        }
        const conflictIds = new Set<string>();
        for (const c of pushRes.conflicts || []) {
          let backup: { id: string; title: string } | null = null;
          const localUnsaved = localPlansById.get(c.planId);
          if (c.serverPayload) {
            if (localUnsaved) {
              backup = await saveLocalConflictBackup(localUnsaved);
            }
            await upsertAiPlanFromCloud(c.serverPayload);
            localPlansById.set(c.planId, c.serverPayload);
            if (c.serverVersion) {
              const prev = metaMap[c.planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
              metaMap[c.planId] = { ...prev, version: c.serverVersion, updatedAt: pushRes.serverTime };
            }
          } else if (c.planId) {
            conflictIds.add(c.planId);
            allPlansSucceeded = false;
          }
          conflicts.push({
            planId: c.planId,
            reason: c.reason,
            backupPlanId: backup?.id,
            backupTitle: backup?.title,
          });
        }
        const clearedPlanKeys: string[] = [];
        for (const item of chunk) {
          if (!conflictIds.has(item.id)) {
            const dk = planDirtyKeyById.get(item.id);
            if (dk) clearedPlanKeys.push(dk);
          }
        }
        if (clearedPlanKeys.length > 0) {
          clearPushedDirtyKeys(dirtySnapshot, clearedPlanKeys);
        }
      } catch (err) {
        allPlansSucceeded = false;
        const msg = err instanceof Error ? err.message : '攻略上传失败';
        conflicts.push({ planId: chunk[0]?.id || '', reason: `部分攻略暂未同步（${msg}），地图足迹已同步` });
      }
    }
  }

  if (wholeAiPlansDirty && allPlansSucceeded) {
    clearPushedDirtyKeys(dirtySnapshot, ['aiPlans:*']);
  }

  setCloudPlanMetaMap(metaMap);
  setLastSyncTime(serverTime);
  if (currentUserId) setLastSyncUserId(currentUserId);
  // 始终以本轮 pull 时的云端指纹与最新时间戳作为已拉取基线：
  // 若本轮执行了推送，6 秒后探测会自动做一次零写入增量核对，确保推送间隙其他设备的并发写入零漏拉。
  if (pull.syncToken) setLastSyncToken(pull.syncToken);
  setLastCloudVersion(pull.latestUpdatedAt || serverTime);
  try { localStorage.setItem(SYNC_SCHEMA_KEY, SYNC_SCHEMA_VERSION); } catch { /* ignore */ }
  const refreshed = await loadSnapshot();

  // 4. 行程参考照片改为独立后台队列同步，不阻塞主文字/攻略秒达
  schedulePlannerPhotosSync([...localPlansById.values()]);

  return {
    snapshot: refreshed,
    serverTime,
    pulledRecords,
    pulledPlans,
    pushedRecords,
    pushedPlans,
    syncedPhotos: 0,
    conflicts,
    quota: latestQuota,
  };
}

/** 从剪贴板文本、URL 或口令中提取周游分享码（#ZY:XXXXXX# / /share/XXXXXX / zhouyou://share/XXXXXX）。 */
export function extractZhouyouShareCode(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const tokenMatch = text.match(/#ZY:([A-Z0-9]{4,12})#/i);
  if (tokenMatch) return tokenMatch[1].toUpperCase();
  const urlMatch = text.match(/(?:zhouyou:\/\/share\/|\/share\/|[?&]share=)([A-Z0-9]{4,12})/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  if (/^[A-Z0-9]{6,8}$/i.test(text)) return text.toUpperCase();
  return '';
}

/** 从 URL 或文本中提取好友码（ZY-XXXXXX）或群邀请码（?joinGroup=XXXXXXXX）。 */
export function extractZhouyouActionFromUrl(urlString: string): {
  shareCode?: string;
  friendCode?: string;
  groupCode?: string;
} {
  try {
    const normalized = urlString.replace(/^zhouyou:\/\//i, 'https://zhouyou.online/');
    const parsed = new URL(normalized);
    const pathShare = parsed.pathname.match(/^\/share\/([A-Z0-9]{4,12})/i)?.[1];
    const shareCode = (parsed.searchParams.get('share') || pathShare || '').trim().toUpperCase();
    const friendCode = (parsed.searchParams.get('addFriend') || '').trim().toUpperCase();
    const groupCode = (parsed.searchParams.get('joinGroup') || '').trim().toUpperCase();
    return {
      shareCode: shareCode || undefined,
      friendCode: friendCode || undefined,
      groupCode: groupCode || undefined,
    };
  } catch {
    return {};
  }
}
