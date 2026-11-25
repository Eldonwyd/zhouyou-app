import type { AiTravelPlan } from './planner-types';
import type { CityMark, ExpenseCategory } from './types';

export const CLOUD_TOKEN_KEY = 'zhouyou-cloud-token';
export const CLOUD_USER_KEY = 'zhouyou-cloud-user';
export const CLOUD_ORIGIN_KEY = 'zhouyou-cloud-origin';
export const CLOUD_AUTH_EVENT = 'zhouyou-cloud-auth-change';
export const DEFAULT_CLOUD_ORIGIN = 'https://zhouyou.online';

export type MapVisibility = 'friends' | 'intimate' | 'private';
export type RelationType = 'couple' | 'family' | 'soulmate' | 'bestie';

export const RELATION_META: Record<RelationType, { label: string; emoji: string; badgeTitle: string; desc: string }> = {
  couple: { label: '情侣', emoji: '💑', badgeTitle: '携手同行', desc: '浪漫双人旅途与纪念日专属卡片' },
  family: { label: '家人', emoji: '🏡', badgeTitle: '全家出游', desc: '温馨家庭旅行与家人群行程共享' },
  soulmate: { label: '挚友', emoji: '🤝', badgeTitle: '挚友远行', desc: '默契结伴探索全国山海' },
  bestie: { label: '闺蜜', emoji: '🌸', badgeTitle: '闺蜜同游', desc: '一起打卡美食与拍照圣地' },
};

export const SECURITY_QUESTIONS = [
  '你的第一所小学名称是？',
  '你最喜欢的旅行城市是？',
  '你童年最好的朋友叫什么？',
  '你第一只宠物的名字是？',
  '你母亲的姓氏是？',
  '你最难忘的一次旅行目的地是？',
];

export interface CloudPublicUser {
  id: string;
  nickname: string;
  remark?: string;
  friendCode: string;
  avatar: string;
  motto: string;
  mapVisibility: MapVisibility;
  createdAt?: string;
}

export interface CloudSelfUser extends CloudPublicUser {
  phone: string;
  hasPhone: boolean;
  email: string;
  hasEmail: boolean;
  securityQuestion: string;
  updatedAt?: string;
}

export interface CloudSessionInfo {
  id: string;
  deviceName: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export interface CloudQuota {
  usedBytes: number;
  maxBytes: number;
}

export interface ChatPollVote {
  userId: string;
  userNickname: string;
  optionId: string;
  createdAt: string;
}

export type ChatMessageType = 'text' | 'image' | 'plan' | 'invite' | 'poll' | 'intimacy' | 'packing' | 'reminder';

export interface ChatMessage {
  id: string;
  roomType: 'dm' | 'group';
  roomId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  msgType: ChatMessageType;
  textContent: string;
  payload: Record<string, unknown>;
  pollVotes?: ChatPollVote[];
  createdAt: string;
}

export interface FreeAiQuotaSnapshot {
  enabled: boolean;
  label: string;
  model: string;
  vip: boolean;
  dayKey: string;
  monthKey: string;
  daily: {
    used: number;
    limit: number;
    remaining: number;
    requests: number;
  };
  monthly: {
    used: number;
    limit: number;
    remaining: number;
    requests: number;
  };
  site: {
    used: number;
    limit: number;
    remaining: number;
    exhausted: boolean;
  };
}

export interface FriendItem {
  friendshipId: string;
  since: string;
  user: CloudPublicUser;
}

export interface PendingFriendRequest {
  friendshipId: string;
  createdAt: string;
  user: CloudPublicUser;
}

export interface IntimacyBond {
  id: string;
  relationType: RelationType;
  status: 'pending' | 'active';
  requesterId: string;
  incoming: boolean;
  customLabel: string;
  peerCustomLabel?: string;
  anniversaryDate: string;
  sharedVisitedCount: number;
  createdAt: string;
  peer: CloudPublicUser;
}

export interface ReceivedShare {
  code: string;
  planId: string;
  senderId: string;
  senderNickname: string;
  mode: 'copy' | 'collab';
  title: string;
  destination: string;
  daysCount: number;
  createdAt: string;
}

export interface SocialOverview {
  friends: FriendItem[];
  pendingFriendRequests: PendingFriendRequest[];
  intimacyBonds: IntimacyBond[];
  receivedShares: ReceivedShare[];
  unreadCount: number;
}

export interface CloudNotification {
  id: string;
  type: string;
  actorId: string | null;
  actorNickname: string;
  title: string;
  body: string;
  targetRef: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface FriendFootprintCompare {
  peer: CloudPublicUser;
  intimacy: { relationType: RelationType; customLabel: string; anniversaryDate: string } | null;
  peerMarks: CityMark[];
  stats: {
    peerVisitedCount: number;
    myVisitedCount: number;
    sharedVisitedCount: number;
    sharedPlannedCount: number;
    sharedVisitedCities: Array<{ id: string; name: string; provinceCode: string }>;
    sharedPlannedCities: Array<{ id: string; name: string; provinceCode: string }>;
  };
}

export interface TravelGroupSummary {
  id: string;
  name: string;
  ownerId: string;
  myRole: 'owner' | 'member';
  inviteCode: string;
  memberCount: number;
  planCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupExpenseItem {
  id: string;
  groupId: string;
  planId: string | null;
  date: string;
  category: ExpenseCategory;
  title: string;
  amountCents: number;
  payerUserId: string;
  participantUserIds: string[];
  createdBy: string;
  updatedAt: string;
}

export interface TravelGroupDetail {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
  members: Array<{ role: 'owner' | 'member'; joinedAt: string; user: CloudPublicUser }>;
  plans: Array<{ id: string; title: string; destination: string; version: number; updatedByName: string; updatedAt: string }>;
  expenses: GroupExpenseItem[];
}

export interface PlanRevision {
  id: string;
  version: number;
  editorId: string;
  editorNickname: string;
  summary: string;
  createdAt: string;
}

export interface PlanVote {
  itemKey: string;
  userId: string;
  nickname: string;
  vote: 'want' | 'backup' | 'skip';
  updatedAt: string;
}

export interface PlanComment {
  id: string;
  itemKey: string;
  userId: string;
  authorNickname: string;
  content: string;
  createdAt: string;
}

export interface SharePreviewData {
  code: string;
  planId: string;
  senderNickname: string;
  mode: 'copy' | 'collab';
  title: string;
  destination: string;
  daysCount: number;
  summary: {
    destination?: string;
    startDate?: string;
    endDate?: string;
    people?: number;
    daysCount?: number;
    highlights?: Array<{ day: number; date?: string; theme?: string; stops?: string[] }>;
  };
  expiresAt: string;
  createdAt: string;
}

export function getCloudOrigin(): string {
  try {
    const custom = localStorage.getItem(CLOUD_ORIGIN_KEY)?.trim();
    if (custom) return custom.replace(/\/+$/, '');
  } catch { /* ignore */ }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'zhouyou.online' || host === 'www.zhouyou.online' || host.endsWith('.zhouyou.online') || host.endsWith('.pages.dev')) {
      return window.location.origin;
    }
  }
  return DEFAULT_CLOUD_ORIGIN;
}

export function getCloudPlannerPhotoUrl(assetId: string): string {
  return `${getCloudOrigin()}/api/sync/photo/${encodeURIComponent(assetId.toLowerCase())}`;
}

export function getCloudToken(): string {
  try {
    return localStorage.getItem(CLOUD_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getCachedCloudUser(): CloudSelfUser | null {
  try {
    const raw = localStorage.getItem(CLOUD_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CloudSelfUser;
  } catch {
    return null;
  }
}

export function setCloudAuthState(token: string, user: CloudSelfUser | null): void {
  try {
    if (token) localStorage.setItem(CLOUD_TOKEN_KEY, token);
    else localStorage.removeItem(CLOUD_TOKEN_KEY);
    if (user) localStorage.setItem(CLOUD_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CLOUD_USER_KEY);
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTH_EVENT, { detail: { user, loggedIn: Boolean(token && user) } }));
  } catch { /* ignore */ }
}

export function clearCloudAuthState(): void {
  setCloudAuthState('', null);
}

export function detectClientPlatform(): { platform: 'web' | 'desktop' | 'mobile'; deviceName: string } {
  if (typeof window === 'undefined') return { platform: 'web', deviceName: 'Web' };
  const w = window as unknown as { zhouyouDesktop?: unknown; Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
  if (w.zhouyouDesktop) {
    return { platform: 'desktop', deviceName: '周游桌面端' };
  }
  if (w.Capacitor?.isNativePlatform?.()) {
    const p = w.Capacitor.getPlatform?.() || 'mobile';
    return { platform: 'mobile', deviceName: p === 'ios' ? '周游 iOS 端' : '周游 Android 端' };
  }
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|Android/i.test(ua)) {
    return { platform: 'web', deviceName: '手机网页版' };
  }
  return { platform: 'web', deviceName: '电脑网页版' };
}

export class CloudApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function cloudRequest<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getCloudToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getCloudOrigin()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CloudApiError('无法连接周游云服务，请检查网络后重试', 0, 'NETWORK_ERROR');
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // non-json
  }

  if (!response.ok || data.ok === false) {
    const code = String(data.code || 'ERROR');
    if (response.status === 401 && (code === 'SESSION_INVALID' || code === 'SESSION_EXPIRED')) {
      clearCloudAuthState();
    }
    throw new CloudApiError(String(data.error || `请求失败（HTTP ${response.status}）`), response.status, code);
  }
  return data as T;
}

export const cloudApi = {
  // ---- Auth ----
  checkNickname(nickname: string, excludeUserId?: string) {
    return cloudRequest<{ ok: true; available: boolean; reason: string }>('/api/auth/check-nickname', {
      method: 'POST',
      auth: false,
      body: { nickname, excludeUserId },
    });
  },
  register(payload: {
    phone?: string;
    email?: string;
    password: string;
    nickname: string;
    securityQuestion: string;
    securityAnswer: string;
    avatar?: string;
  }) {
    const dev = detectClientPlatform();
    return cloudRequest<{ ok: true; token: string; expiresAt: string; user: CloudSelfUser }>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { ...payload, ...dev },
    });
  },
  login(identifier: string, password: string) {
    const dev = detectClientPlatform();
    return cloudRequest<{ ok: true; token: string; expiresAt: string; user: CloudSelfUser }>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { identifier, password, ...dev },
    });
  },
  logout() {
    return cloudRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return cloudRequest<{ ok: true; user: CloudSelfUser; currentSessionId: string; sessions: CloudSessionInfo[]; quota: CloudQuota }>('/api/auth/me');
  },
  revokeSession(sessionId: string) {
    return cloudRequest<{ ok: true }>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  },
  updateProfile(patch: Partial<{ nickname: string; avatar: string; motto: string; mapVisibility: MapVisibility; phone: string; email: string }>) {
    return cloudRequest<{ ok: true; user: CloudSelfUser }>('/api/auth/profile', { method: 'PATCH', body: patch });
  },
  changePassword(payload: { currentPassword: string; newPassword?: string; securityQuestion?: string; securityAnswer?: string }) {
    return cloudRequest<{ ok: true }>('/api/auth/change-password', { method: 'POST', body: payload });
  },
  getSecurityQuestion(identifier: string) {
    return cloudRequest<{ ok: true; question: string; nickname: string }>('/api/auth/security-question', {
      method: 'POST',
      auth: false,
      body: { identifier },
    });
  },
  resetPassword(identifier: string, securityAnswer: string, newPassword: string) {
    return cloudRequest<{ ok: true; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      auth: false,
      body: { identifier, securityAnswer, newPassword },
    });
  },

  // ---- Sync & Collaborative Plans ----
  getSyncVersion() {
    return cloudRequest<{ ok: true; latestUpdatedAt: string; serverTime: string }>('/api/sync/version');
  },
  checkPlannerPhotosExist(assetIds: string[]) {
    return cloudRequest<{ ok: true; existing: string[] }>('/api/sync/photos/exists', {
      method: 'POST',
      body: { assetIds },
    });
  },
  uploadPlannerPhoto(payload: { assetId: string; mimeType: string; dataBase64: string }) {
    return cloudRequest<{ ok: true; assetId: string }>('/api/sync/photos', {
      method: 'POST',
      body: payload,
    });
  },
  pullSync(since = '') {
    return cloudRequest<{
      ok: true;
      serverTime: string;
      records: Array<{ store: string; id: string; payload: unknown; updatedAt: string; deletedAt: string | null }>;
      aiPlans: Array<{
        id: string;
        ownerId: string;
        groupId: string | null;
        groupName: string;
        version: number;
        updatedBy: string;
        updatedByName: string;
        updatedAt: string;
        deletedAt: string | null;
        payload: AiTravelPlan | null;
      }>;
      quota: CloudQuota;
    }>('/api/sync/pull', { method: 'POST', body: { since } });
  },
  pushSync(payload: {
    records?: Array<{ store: string; id: string; payload?: unknown; updatedAt?: string; deleted?: boolean; force?: boolean }>;
    aiPlans?: Array<{ id: string; payload?: AiTravelPlan; baseVersion?: number; groupId?: string | null; summary?: string; deleted?: boolean; force?: boolean }>;
  }) {
    return cloudRequest<{
      ok: true;
      serverTime: string;
      acceptedPlanVersions: Record<string, number>;
      conflicts: Array<{ planId: string; reason: string; serverVersion?: number; serverPayload?: AiTravelPlan | null }>;
      quota: CloudQuota;
    }>('/api/sync/push', { method: 'POST', body: payload });
  },
  getPlanRevisions(planId: string) {
    return cloudRequest<{ ok: true; currentVersion: number; revisions: PlanRevision[] }>(`/api/sync/plans/${encodeURIComponent(planId)}/revisions`);
  },
  revertPlan(planId: string, revisionId: string) {
    return cloudRequest<{ ok: true; version: number; payload: AiTravelPlan; summary: string }>(`/api/sync/plans/${encodeURIComponent(planId)}/revert`, {
      method: 'POST',
      body: { revisionId },
    });
  },
  bindPlanGroup(planId: string, body: { groupId?: string | null; createNew?: boolean; groupName?: string; memberUserIds?: string[] }) {
    return cloudRequest<{ ok: true; groupId: string | null; groupName: string }>(`/api/sync/plans/${encodeURIComponent(planId)}/bind-group`, {
      method: 'POST',
      body,
    });
  },
  getPlanCollab(planId: string) {
    return cloudRequest<{ ok: true; votes: PlanVote[]; comments: PlanComment[] }>(`/api/sync/plans/${encodeURIComponent(planId)}/collab`);
  },
  votePlanItem(planId: string, itemKey: string, vote: 'want' | 'backup' | 'skip' | '') {
    return cloudRequest<{ ok: true; vote: string | null }>(`/api/sync/plans/${encodeURIComponent(planId)}/vote`, {
      method: 'POST',
      body: { itemKey, vote },
    });
  },
  commentPlanItem(planId: string, itemKey: string, content: string) {
    return cloudRequest<{ ok: true; comment: PlanComment }>(`/api/sync/plans/${encodeURIComponent(planId)}/comment`, {
      method: 'POST',
      body: { itemKey, content },
    });
  },
  deletePlanComment(planId: string, commentId: string) {
    return cloudRequest<{ ok: true }>(`/api/sync/plans/${encodeURIComponent(planId)}/comment/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    });
  },

  // ---- Social & Friends & Intimacy ----
  getSocialOverview() {
    return cloudRequest<{ ok: true } & SocialOverview>('/api/social/overview');
  },
  searchUsers(q: string) {
    return cloudRequest<{ ok: true; users: CloudPublicUser[] }>(`/api/social/search?q=${encodeURIComponent(q)}`);
  },
  requestFriend(payload: { targetUserId?: string; friendCode?: string; nickname?: string }) {
    return cloudRequest<{ ok: true; status: string; message: string }>('/api/social/friends/request', {
      method: 'POST',
      body: payload,
    });
  },
  respondFriend(friendshipId: string, decision: 'accept' | 'reject' | 'remove') {
    return cloudRequest<{ ok: true; status: string }>('/api/social/friends/respond', {
      method: 'POST',
      body: { friendshipId, decision },
    });
  },
  setFriendRemark(peerUserId: string, remark: string) {
    return cloudRequest<{ ok: true; remark: string }>('/api/social/friends/remark', {
      method: 'POST',
      body: { peerUserId, remark },
    });
  },
  getFriendFootprints(userId: string) {
    return cloudRequest<{ ok: true } & FriendFootprintCompare>(`/api/social/friends/${encodeURIComponent(userId)}/footprints`);
  },
  requestIntimacy(targetUserId: string, relationType: RelationType, customLabel = '', anniversaryDate = '') {
    return cloudRequest<{ ok: true; bondId?: string; message: string }>('/api/social/intimacy/request', {
      method: 'POST',
      body: { targetUserId, relationType, customLabel, anniversaryDate },
    });
  },
  respondIntimacy(bondId: string, decision: 'accept' | 'reject' | 'update' | 'remove', extra?: { customLabel?: string; anniversaryDate?: string }) {
    return cloudRequest<{ ok: true; status?: string }>('/api/social/intimacy/respond', {
      method: 'POST',
      body: { bondId, decision, ...extra },
    });
  },
  getNotifications() {
    return cloudRequest<{ ok: true; notifications: CloudNotification[] }>('/api/social/notifications');
  },
  markNotificationsRead(notificationId?: string | string[]) {
    const body = Array.isArray(notificationId)
      ? { notificationIds: notificationId }
      : notificationId
        ? { notificationId }
        : {};
    return cloudRequest<{ ok: true }>('/api/social/notifications/read', {
      method: 'POST',
      body,
    });
  },

  // ---- Groups & Face-to-Face & AA Expenses ----
  listGroups() {
    return cloudRequest<{ ok: true; groups: TravelGroupSummary[] }>('/api/groups');
  },
  createGroup(name: string, memberUserIds: string[] = [], planId?: string) {
    return cloudRequest<{ ok: true; group: TravelGroupDetail }>('/api/groups', {
      method: 'POST',
      body: { name, memberUserIds, planId },
    });
  },
  getGroup(groupId: string) {
    return cloudRequest<{ ok: true; group: TravelGroupDetail }>(`/api/groups/${encodeURIComponent(groupId)}`);
  },
  renameGroup(groupId: string, name: string) {
    return cloudRequest<{ ok: true; name: string }>(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: { name },
    });
  },
  deleteGroup(groupId: string) {
    return cloudRequest<{ ok: true }>(`/api/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  },
  addGroupMembers(groupId: string, userIds: string[]) {
    return cloudRequest<{ ok: true; group: TravelGroupDetail }>(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST',
      body: { userIds },
    });
  },
  removeGroupMember(groupId: string, userId: string) {
    return cloudRequest<{ ok: true }>(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },
  joinGroupByCode(inviteCode: string) {
    return cloudRequest<{ ok: true; group: TravelGroupDetail }>('/api/groups/join-by-code', {
      method: 'POST',
      body: { inviteCode },
    });
  },
  faceToFaceGroup(pinCode: string, groupName = '', autoAddFriends = true) {
    return cloudRequest<{ ok: true; created: boolean; pinCode: string; expiresAt: string; group: TravelGroupDetail }>('/api/groups/face-to-face', {
      method: 'POST',
      body: { pinCode, groupName, autoAddFriends },
    });
  },
  saveGroupExpense(
    groupId: string,
    payload: {
      id?: string;
      planId?: string | null;
      date: string;
      category: ExpenseCategory;
      title: string;
      amountCents: number;
      payerUserId: string;
      participantUserIds: string[];
    },
  ) {
    return cloudRequest<{ ok: true; expense: GroupExpenseItem }>(`/api/groups/${encodeURIComponent(groupId)}/expenses`, {
      method: 'POST',
      body: payload,
    });
  },
  deleteGroupExpense(groupId: string, expenseId: string) {
    return cloudRequest<{ ok: true }>(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`, {
      method: 'DELETE',
    });
  },

  // ---- Share ----
  createShare(payload: { planId: string; mode: 'copy' | 'collab'; recipientUserId?: string; planPayload?: AiTravelPlan }) {
    return cloudRequest<{
      ok: true;
      code: string;
      mode: 'copy' | 'collab';
      groupId: string | null;
      shareUrl: string;
      zhouyouToken: string;
      expiresAt: string;
    }>('/api/share/create', { method: 'POST', body: payload });
  },
  previewShare(code: string) {
    return cloudRequest<{ ok: true; share: SharePreviewData }>(`/api/share/${encodeURIComponent(code)}`, { auth: false });
  },
  acceptShare(code: string) {
    return cloudRequest<{
      ok: true;
      mode: 'copy' | 'collab';
      groupId?: string;
      planId: string;
      plan: AiTravelPlan;
      message: string;
    }>(`/api/share/${encodeURIComponent(code)}/accept`, { method: 'POST' });
  },

  // ---- Platform Free Trial AI ----
  getFreeAiQuota() {
    return cloudRequest<{ ok: true; quota: FreeAiQuotaSnapshot }>('/api/free-ai/quota');
  },

  // ---- Chat (DM & Group) ----
  getChatMessages(roomType: 'dm' | 'group', targetId: string, opts?: { after?: string; pollIds?: string[] }) {
    const params = new URLSearchParams();
    if (opts?.after) params.set('after', opts.after);
    if (opts?.pollIds?.length) params.set('pollIds', opts.pollIds.slice(0, 20).join(','));
    const qs = params.toString();
    return cloudRequest<{
      ok: true;
      incremental?: boolean;
      messages: ChatMessage[];
      pollUpdates?: Record<string, ChatPollVote[]>;
    }>(
      `/api/chat/${roomType}/${encodeURIComponent(targetId)}${qs ? `?${qs}` : ''}`,
    );
  },
  sendChatMessage(
    roomType: 'dm' | 'group',
    targetId: string,
    body: {
      msgType: ChatMessageType;
      textContent?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    return cloudRequest<{ ok: true; message: ChatMessage }>(
      `/api/chat/${roomType}/${encodeURIComponent(targetId)}`,
      { method: 'POST', body },
    );
  },
  voteChatPoll(messageId: string, optionId: string) {
    return cloudRequest<{ ok: true; pollVotes: ChatPollVote[] }>(
      `/api/chat/poll/${encodeURIComponent(messageId)}/vote`,
      { method: 'POST', body: { optionId } },
    );
  },
};
