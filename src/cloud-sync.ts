import { deleteItem, getPlannerPhotoBlob, loadSnapshot, saveAiPlan, saveItem, savePlannerPhotoBlob } from './db';
import type { AppSnapshot } from './types';
import type { AiTravelPlan } from './planner-types';
import { cloudApi, getCloudPlannerPhotoUrl, getCloudToken, type CloudQuota } from './cloud-api';
import { plannerApiUrl } from './api-base';

const LAST_SYNC_KEY = 'zhouyou-cloud-last-sync';
const LAST_CLOUD_VERSION_KEY = 'zhouyou-cloud-version';
const PLAN_META_KEY = 'zhouyou-cloud-plan-meta';
const ASSET_ID_RE = /^[a-f0-9]{64}$/;

/** 当前会话内已确认完成云端/本地双向同步的行程照片 assetId，避免高频轮询重复检查。 */
const syncedPhotoIdsCache = new Set<string>();
let activeSyncPromise: Promise<SyncResult> | null = null;

export interface CloudPlanMeta {
  ownerId: string;
  groupId: string | null;
  groupName: string;
  version: number;
  updatedByName: string;
  updatedAt: string;
}

export type CloudPlanMetaMap = Record<string, CloudPlanMeta>;

const SYNC_STORES = ['marks', 'badges', 'trips', 'places', 'entries', 'plans', 'plannerPreferences'] as const;
type SyncStore = typeof SYNC_STORES[number];

export function getLastSyncTime(): string {
  try { return localStorage.getItem(LAST_SYNC_KEY) || ''; } catch { return ''; }
}

function setLastSyncTime(iso: string): void {
  try { localStorage.setItem(LAST_SYNC_KEY, iso); } catch { /* ignore */ }
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

export function resetCloudSyncCursor(): void {
  try {
    localStorage.removeItem(LAST_SYNC_KEY);
    localStorage.removeItem(LAST_CLOUD_VERSION_KEY);
  } catch { /* ignore */ }
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

/** 轻量探测云端是否有其他设备写入的新版本（仅查 1 行时间戳，极低开销）。 */
export async function checkCloudSyncNeeded(): Promise<boolean> {
  if (!getCloudToken()) return false;
  const lastVersion = getLastCloudVersion();
  const res = await cloudApi.getSyncVersion();
  if (!res.latestUpdatedAt) return false;
  if (!lastVersion || res.latestUpdatedAt > lastVersion) {
    return true;
  }
  return false;
}

export interface SyncResult {
  snapshot: AppSnapshot;
  serverTime: string;
  pulledRecords: number;
  pulledPlans: number;
  pushedRecords: number;
  pushedPlans: number;
  syncedPhotos: number;
  conflicts: Array<{ planId: string; reason: string }>;
  quota: CloudQuota;
}

/**
 * 双向云同步（支持增量拉取 + 删除同步 + 行程参考图双向同步）：
 * 1. 首次或强制全量时拉取全量，后续自动按 lastSyncTime 增量拉取；
 * 2. 与本地 IndexedDB 按 id + updatedAt 智能合并，并同步云端软删除；
 * 3. 将本地新增或较新的记录与攻略推送回云端；
 * 4. 双向同步旅行计划里搜索到的参考照片（压缩去重存云端，跨端秒看并缓存离线）。
 */
export async function syncWithCloud(forceFull = false): Promise<SyncResult> {
  if (!getCloudToken()) {
    throw new Error('未登录周游账号');
  }
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  const run = runSyncWithCloudInternal(forceFull).finally(() => {
    activeSyncPromise = null;
  });
  activeSyncPromise = run;
  return run;
}

async function runSyncWithCloudInternal(forceFull: boolean): Promise<SyncResult> {
  const local = await loadSnapshot();
  const prevLastSync = forceFull ? '' : getLastSyncTime();
  const isIncremental = Boolean(prevLastSync);
  const pull = await cloudApi.pullSync(prevLastSync);
  const metaMap = getCloudPlanMetaMap();

  let pulledRecords = 0;
  let pulledPlans = 0;
  let pushedRecords = 0;
  let pushedPlans = 0;

  // 1. 合并个人纯文本记录
  const cloudRecordMap = new Map<string, { payload: unknown; updatedAt: string; deletedAt: string | null }>();
  for (const rec of pull.records) {
    cloudRecordMap.set(`${rec.store}:${rec.id}`, rec);
  }

  const recordsToPush: Array<{ store: string; id: string; payload: unknown; updatedAt: string }> = [];

  for (const store of SYNC_STORES) {
    const localList = (local[store] as Array<{ id: string }>) || [];
    const localById = new Map<string, { id: string }>(localList.map((item) => [item.id, item]));

    // 云端 -> 本地（含软删除同步）
    for (const rec of pull.records) {
      if (rec.store !== store) continue;
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
      const localTs = getRecordTimestamp(localItem);
      const cloudTs = rec.updatedAt || getRecordTimestamp(rec.payload);
      if (!localItem || (cloudTs && (!localTs || cloudTs > localTs))) {
        await saveItem(store as SyncStore, rec.payload as never);
        localById.set(rec.id, rec.payload as { id: string });
        pulledRecords += 1;
      }
    }

    // 本地 -> 云端
    for (const item of localById.values()) {
      const cloudRec = cloudRecordMap.get(`${store}:${item.id}`);
      const localTs = getRecordTimestamp(item);
      if (isIncremental) {
        // 增量模式下仅推送上次同步之后本地有更新的记录，避免重复推全量老数据
        if (cloudRec?.deletedAt) continue;
        if (localTs && localTs > prevLastSync && (!cloudRec || !cloudRec.updatedAt || localTs > cloudRec.updatedAt)) {
          recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs });
        }
      } else {
        if (cloudRec?.deletedAt) continue;
        if (!cloudRec) {
          recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs || new Date().toISOString() });
        } else if (localTs && cloudRec.updatedAt && localTs > cloudRec.updatedAt) {
          recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs });
        }
      }
    }
  }

  // 2. 合并 AI 攻略（私有 + 群共享）
  const localPlansById = new Map<string, AiTravelPlan>(local.aiPlans.map((p) => [p.id, p]));
  const cloudPlansById = new Map(pull.aiPlans.map((p) => [p.id, p]));
  const plansToPush: Array<{ id: string; payload: AiTravelPlan; baseVersion?: number; groupId?: string | null }> = [];

  for (const cp of pull.aiPlans) {
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
    const lp = localPlansById.get(cp.id);
    if (!lp || !lp.updatedAt || cp.updatedAt >= lp.updatedAt || cp.groupId) {
      const cloudNewer = !lp || !lp.updatedAt || cp.updatedAt > lp.updatedAt;
      if (cloudNewer) {
        await saveAiPlan(cp.payload, null);
        localPlansById.set(cp.id, cp.payload);
        pulledPlans += 1;
      }
    }
  }

  for (const lp of localPlansById.values()) {
    const cp = cloudPlansById.get(lp.id);
    if (cp?.deletedAt) continue;
    const knownMeta = metaMap[lp.id];
    if (isIncremental) {
      const needsPush =
        !knownMeta
        || (lp.updatedAt && lp.updatedAt > prevLastSync && (!cp || !cp.updatedAt || lp.updatedAt > cp.updatedAt));
      if (needsPush) {
        plansToPush.push({
          id: lp.id,
          payload: lp,
          baseVersion: cp?.version ?? knownMeta?.version,
          groupId: cp?.groupId ?? knownMeta?.groupId ?? null,
        });
      }
    } else {
      if (!cp) {
        plansToPush.push({ id: lp.id, payload: lp });
      } else if (lp.updatedAt && cp.updatedAt && lp.updatedAt > cp.updatedAt) {
        plansToPush.push({
          id: lp.id,
          payload: lp,
          baseVersion: cp.version,
          groupId: cp.groupId,
        });
      }
    }
  }

  let conflicts: Array<{ planId: string; reason: string }> = [];
  let latestQuota = pull.quota;
  let serverTime = pull.serverTime;

  if (recordsToPush.length > 0 || plansToPush.length > 0) {
    const pushRes = await cloudApi.pushSync({
      records: recordsToPush,
      aiPlans: plansToPush,
    });
    pushedRecords = recordsToPush.length;
    pushedPlans = Object.keys(pushRes.acceptedPlanVersions || {}).length;
    latestQuota = pushRes.quota;
    serverTime = pushRes.serverTime;
    for (const [planId, ver] of Object.entries(pushRes.acceptedPlanVersions || {})) {
      const prev = metaMap[planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
      metaMap[planId] = { ...prev, version: ver, updatedAt: serverTime };
    }
    conflicts = (pushRes.conflicts || []).map((c) => ({ planId: c.planId, reason: c.reason }));
    // 若有版本冲突且服务端返回了更新后的攻略，拉取到本地
    for (const c of pushRes.conflicts || []) {
      if (c.serverPayload) {
        await saveAiPlan(c.serverPayload, null);
        localPlansById.set(c.planId, c.serverPayload);
        if (c.serverVersion) {
          const prev = metaMap[c.planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
          metaMap[c.planId] = { ...prev, version: c.serverVersion, updatedAt: serverTime };
        }
      }
    }
  }

  // 3. 双向同步旅行计划里搜索到的参考照片（上传本地已有、拉取云端已有）
  const photoSync = await syncPlannerPhotosWithCloud([...localPlansById.values()]).catch(() => ({ uploaded: 0, downloaded: 0 }));

  setCloudPlanMetaMap(metaMap);
  setLastSyncTime(serverTime);
  setLastCloudVersion(serverTime);
  const refreshed = await loadSnapshot();

  return {
    snapshot: refreshed,
    serverTime,
    pulledRecords,
    pulledPlans,
    pushedRecords,
    pushedPlans,
    syncedPhotos: photoSync.uploaded + photoSync.downloaded,
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
