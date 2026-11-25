import { loadSnapshot, saveAiPlan, saveItem } from './db';
import type { AppSnapshot } from './types';
import type { AiTravelPlan } from './planner-types';
import { cloudApi, getCloudToken, type CloudQuota } from './cloud-api';

const LAST_SYNC_KEY = 'zhouyou-cloud-last-sync';
const PLAN_META_KEY = 'zhouyou-cloud-plan-meta';

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

export interface SyncResult {
  snapshot: AppSnapshot;
  serverTime: string;
  pulledRecords: number;
  pulledPlans: number;
  pushedRecords: number;
  pushedPlans: number;
  conflicts: Array<{ planId: string; reason: string }>;
  quota: CloudQuota;
}

/**
 * 全文本双向云同步：
 * 1. 拉取云端个人记录（marks/badges/trips/places/entries/plans/plannerPreferences）与所有可见 AI 攻略（私有 + 所在行程群共享）；
 * 2. 与本地 IndexedDB 按 id + updatedAt 智能合并（绝不丢失本地老数据，也不碰照片/视频/语音）；
 * 3. 将本地新增或较新的记录与攻略推送回云端。
 */
export async function syncWithCloud(forceFull = false): Promise<SyncResult> {
  if (!getCloudToken()) {
    throw new Error('未登录周游账号');
  }
  const local = await loadSnapshot();
  const pull = await cloudApi.pullSync(forceFull ? '' : '');
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

    // 云端 -> 本地
    for (const rec of pull.records) {
      if (rec.store !== store || rec.deletedAt || !rec.payload) continue;
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
    for (const item of localList) {
      const cloudRec = cloudRecordMap.get(`${store}:${item.id}`);
      const localTs = getRecordTimestamp(item);
      if (!cloudRec || cloudRec.deletedAt) {
        recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs || new Date().toISOString() });
      } else if (localTs && cloudRec.updatedAt && localTs > cloudRec.updatedAt) {
        recordsToPush.push({ store, id: item.id, payload: item, updatedAt: localTs });
      }
    }
  }

  // 2. 合并 AI 攻略（私有 + 群共享）
  const localPlansById = new Map<string, AiTravelPlan>(local.aiPlans.map((p) => [p.id, p]));
  const cloudPlansById = new Map(pull.aiPlans.map((p) => [p.id, p]));
  const plansToPush: Array<{ id: string; payload: AiTravelPlan; baseVersion?: number; groupId?: string | null }> = [];

  for (const cp of pull.aiPlans) {
    if (cp.deletedAt || !cp.payload) continue;
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
      // 若是群共享攻略或云端更新，优先拉取云端最新（避免本地旧缓存覆盖同伴修改）
      const cloudNewer = !lp || !lp.updatedAt || cp.updatedAt > lp.updatedAt;
      if (cloudNewer) {
        await saveAiPlan(cp.payload, null);
        localPlansById.set(cp.id, cp.payload);
        pulledPlans += 1;
      }
    }
  }

  for (const lp of local.aiPlans) {
    const cp = cloudPlansById.get(lp.id);
    if (!cp || cp.deletedAt) {
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
        if (c.serverVersion) {
          const prev = metaMap[c.planId] || { ownerId: '', groupId: null, groupName: '', version: 1, updatedByName: '', updatedAt: '' };
          metaMap[c.planId] = { ...prev, version: c.serverVersion, updatedAt: serverTime };
        }
      }
    }
  }

  setCloudPlanMetaMap(metaMap);
  setLastSyncTime(serverTime);
  const refreshed = await loadSnapshot();

  return {
    snapshot: refreshed,
    serverTime,
    pulledRecords,
    pulledPlans,
    pushedRecords,
    pushedPlans,
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
