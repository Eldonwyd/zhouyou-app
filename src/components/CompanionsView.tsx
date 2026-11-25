import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RELATION_META,
  cloudApi,
  getCloudOrigin,
  type CloudNotification,
  type CloudPublicUser,
  type CloudSelfUser,
  type IntimacyBond,
  type RelationType,
  type SocialOverview,
  type TravelGroupDetail,
  type TravelGroupSummary,
} from '../cloud-api';
import { extractZhouyouShareCode } from '../cloud-sync';
import { EXPENSE_CATEGORIES, EXPENSE_LABELS, calculateAaSplit, formatAaSettlementText } from '../finance';
import type { AiTravelPlan } from '../planner-types';
import type { CityMark, ExpenseCategory, ExpenseSplitItem } from '../types';
import { TravelAvatar } from './CuteArt';
import QrCodeBox from './QrCodeBox';
import FriendFootprintModal from './FriendFootprintModal';
import ChatRoomView from './ChatRoomView';
import ThemedSelect from './ThemedSelect';

interface CompanionsViewProps {
  cloudUser: CloudSelfUser | null;
  myMarks: CityMark[];
  aiPlans: AiTravelPlan[];
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenPlan: (planId: string) => void;
  onOpenShareCode: (code: string) => void;
  onSaveShareToMyPlans?: (code: string) => Promise<void>;
  onUnreadChange: (count: number) => void;
  onIntimacyLoaded?: (bonds: IntimacyBond[]) => void;
  onSyncNow: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

type CompanionsTab = 'friends' | 'groups' | 'shares' | 'notifications';
type GroupModalMode = 'create' | 'f2f' | 'join' | null;
type GroupRoomTab = 'chat' | 'plans' | 'aa';

interface CompanionsCachePayload {
  overview: SocialOverview | null;
  groups: TravelGroupSummary[];
  notifications: CloudNotification[];
}

const COMPANIONS_CACHE_PREFIX = 'zhouyou-companions-cache:';

function readCompanionsCache(userId: string | undefined): CompanionsCachePayload {
  if (!userId) return { overview: null, groups: [], notifications: [] };
  try {
    const raw = localStorage.getItem(`${COMPANIONS_CACHE_PREFIX}${userId}`);
    if (!raw) return { overview: null, groups: [], notifications: [] };
    const parsed = JSON.parse(raw) as Partial<CompanionsCachePayload>;
    return {
      overview: parsed.overview && typeof parsed.overview === 'object' ? parsed.overview : null,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch {
    return { overview: null, groups: [], notifications: [] };
  }
}

function writeCompanionsCache(userId: string | undefined, payload: CompanionsCachePayload) {
  if (!userId) return;
  try {
    localStorage.setItem(`${COMPANIONS_CACHE_PREFIX}${userId}`, JSON.stringify(payload));
  } catch {
    // 忽略隐私模式或配额限制
  }
}

const GROUP_AVATAR_COLORS = ['#2e8b6e', '#e07a5f', '#4a7fb5', '#9c6bb8', '#d99038', '#4d9b8f'];

function pickGroupColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GROUP_AVATAR_COLORS[hash % GROUP_AVATAR_COLORS.length];
}

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const ts = Date.parse(`${dateStr}T00:00:00`);
  if (!Number.isFinite(ts)) return null;
  return Math.max(1, Math.floor((Date.now() - ts) / 86400000) + 1);
}

/** 好友发来的攻略、行程编辑、行程群邀请或聊天消息需要点进去才算已读；加好友/亲密关系类点到「消息」页即自动已读。 */
function requiresClickToRead(n: CloudNotification): boolean {
  if (n.type === 'plan_received' || n.type === 'plan_edited' || n.type === 'group_invite' || n.type === 'chat_message') {
    return true;
  }
  const ref = n.targetRef || {};
  return Boolean(ref.shareCode || ref.planId || ref.groupId);
}

function formatShortTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const now = new Date();
  const d = new Date(ts);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function CompanionsView({
  cloudUser,
  myMarks,
  aiPlans,
  onOpenAuth,
  onOpenPlan,
  onOpenShareCode,
  onSaveShareToMyPlans,
  onUnreadChange,
  onIntimacyLoaded,
  onSyncNow,
  onNotice,
  onError,
}: CompanionsViewProps) {
  const initialCache = useMemo(() => readCompanionsCache(cloudUser?.id), [cloudUser?.id]);
  const [tab, setTab] = useState<CompanionsTab>('friends');
  const [overview, setOverview] = useState<SocialOverview | null>(() => initialCache.overview);
  const [groups, setGroups] = useState<TravelGroupSummary[]>(() => initialCache.groups);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<TravelGroupDetail | null>(null);
  const [groupRoomTab, setGroupRoomTab] = useState<GroupRoomTab>('chat');
  const [activeChatFriend, setActiveChatFriend] = useState<CloudPublicUser | null>(null);
  const [notifications, setNotifications] = useState<CloudNotification[]>(() => initialCache.notifications);
  const [loading, setLoading] = useState<boolean>(() => Boolean(cloudUser && !initialCache.overview));

  // 顶栏「+」快捷菜单、名片二维码弹窗、好友更多菜单
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [showMyQr, setShowMyQr] = useState(false);
  const [openFriendMenuId, setOpenFriendMenuId] = useState<string | null>(null);
  const [groupModal, setGroupModal] = useState<GroupModalMode>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索与加好友
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CloudPublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [compareUserId, setCompareUserId] = useState<string | null>(null);

  // 亲密关系弹窗（发起 / 接受时设置我的称呼 / 修改称呼与纪念日）
  const [intimacyTarget, setIntimacyTarget] = useState<CloudPublicUser | null>(null);
  const [intimacyType, setIntimacyType] = useState<RelationType>('couple');
  const [intimacyLabel, setIntimacyLabel] = useState('');
  const [intimacyDate, setIntimacyDate] = useState('');
  const [acceptBondTarget, setAcceptBondTarget] = useState<IntimacyBond | null>(null);
  const [acceptBondLabel, setAcceptBondLabel] = useState('');
  const [editBondTarget, setEditBondTarget] = useState<IntimacyBond | null>(null);
  const [editBondLabel, setEditBondLabel] = useState('');
  const [editBondDate, setEditBondDate] = useState('');

  // 好友备注弹窗（所有旅伴均可单独设置备注）
  const [remarkTarget, setRemarkTarget] = useState<CloudPublicUser | null>(null);
  const [remarkDraft, setRemarkDraft] = useState('');

  // 发攻略给好友弹窗
  const [sendPlanFriend, setSendPlanFriend] = useState<CloudPublicUser | null>(null);
  const [sendPlanId, setSendPlanId] = useState('');
  const [sendPlanMode, setSendPlanMode] = useState<'copy' | 'collab'>('copy');
  const [savingShareCode, setSavingShareCode] = useState<string | null>(null);
  const [savedShareCodes, setSavedShareCodes] = useState<Record<string, boolean>>({});

  // 建群 / 面对面建群 / 邀请码入群
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [newGroupPlanId, setNewGroupPlanId] = useState('');
  const [f2fPin, setF2fPin] = useState('');
  const [f2fName, setF2fName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showGroupQr, setShowGroupQr] = useState(false);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renamingBusy, setRenamingBusy] = useState(false);
  const [inviteFriendId, setInviteFriendId] = useState('');
  const [bindPlanId, setBindPlanId] = useState('');

  // 群内 AA 记账表单
  const [expTitle, setExpTitle] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('dinner');
  const [expPayerId, setExpPayerId] = useState('');
  const [expParticipants, setExpParticipants] = useState<string[]>([]);

  // 周游口令粘贴框
  const [tokenInput, setTokenInput] = useState('');

  const refreshAll = useCallback(async () => {
    if (!cloudUser) return;
    setLoading(true);
    try {
      const [ov, grpRes, ntfRes] = await Promise.all([
        cloudApi.getSocialOverview(),
        cloudApi.listGroups(),
        cloudApi.getNotifications(),
      ]);
      setOverview(ov);
      setGroups(grpRes.groups);
      setNotifications(ntfRes.notifications);
      writeCompanionsCache(cloudUser.id, {
        overview: ov,
        groups: grpRes.groups,
        notifications: ntfRes.notifications,
      });
      onUnreadChange(ov.unreadCount);
      onIntimacyLoaded?.(ov.intimacyBonds);
      if (activeGroupId && !grpRes.groups.some((g) => g.id === activeGroupId)) {
        setActiveGroupId(null);
        setActiveGroup(null);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载同行旅伴数据失败');
    } finally {
      setLoading(false);
    }
  }, [cloudUser, activeGroupId, onUnreadChange, onIntimacyLoaded, onError]);

  useEffect(() => {
    if (!cloudUser) return;
    const cached = readCompanionsCache(cloudUser.id);
    if (cached.overview) {
      setOverview(cached.overview);
      setGroups(cached.groups);
      setNotifications(cached.notifications);
      onIntimacyLoaded?.(cached.overview.intimacyBonds);
    }
    void refreshAll();
  }, [cloudUser?.id]);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    try {
      const res = await cloudApi.getGroup(groupId);
      setActiveGroup(res.group);
      setActiveGroupId(groupId);
      setShowGroupQr(false);
      setShowGroupMembers(false);
      setRenamingGroup(false);
      setRenameDraft(res.group.name);
      const memberIds = res.group.members.map((m) => m.user.id);
      setExpPayerId(cloudUser?.id || memberIds[0] || '');
      setExpParticipants(memberIds);
    } catch (err) {
      onError(err instanceof Error ? err.message : '读取行程群详情失败');
    }
  }, [cloudUser?.id, onError]);

  // 群内 AA 结算计算（以稳定 userId 为分账键，防止多位已退群成员或同名成员被错误合并）
  const groupAaSummary = useMemo(() => {
    if (!activeGroup) return null;
    const displayNames: Record<string, string> = {};
    const memberIds: string[] = [];
    for (const m of activeGroup.members) {
      memberIds.push(m.user.id);
      displayNames[m.user.id] = m.user.nickname;
    }
    const ensureDisplayName = (userId: string) => {
      if (!displayNames[userId]) {
        displayNames[userId] = `已退群成员(${userId.slice(-4)})`;
      }
      return userId;
    };
    const items: ExpenseSplitItem[] = activeGroup.expenses.map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      title: e.title,
      amountCents: e.amountCents,
      payer: ensureDisplayName(e.payerUserId),
      participants: e.participantUserIds.map((id) => ensureDisplayName(id)),
    }));
    return calculateAaSplit(memberIds, items, displayNames);
  }, [activeGroup]);

  if (!cloudUser) {
    return (
      <section className="companions-guest-view">
        <div className="companions-hero-card">
          <span className="city-dialog-pill">🤝 同行旅伴</span>
          <h2>把独自规划的攻略，变成一群人的出发</h2>
          <p>登录周游账号后，即可跨端同步攻略与足迹，并解锁好友互看地图、行程群共编与 AA 分账：</p>
          <div className="companions-feature-grid">
            <div className="companions-feature-tile">
              <strong>🔍 搜昵称 / 好友码 / 名片码加好友</strong>
              <span>互看点亮的中国地图、对比共同去过的城市。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>💑 绑定亲密关系 & 专属旅途成就</strong>
              <span>支持情侣、家人、挚友、闺蜜专属卡片与纪念日记录。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>👥 行程群 & 面对面 4 位数字建群</strong>
              <span>全员共享编辑同一份攻略、景点投票与版本回退。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>💰 群内 AA 记账 & 微信 QQ 分享</strong>
              <span>一键算出最少转账方案，发微信/QQ 口令直达攻略。</span>
            </div>
          </div>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={() => onOpenAuth('login')}>密码登录</button>
            <button type="button" className="secondary" onClick={() => onOpenAuth('register')}>注册周游账号</button>
          </div>
        </div>
      </section>
    );
  }

  const activeBonds = (overview?.intimacyBonds || []).filter((b) => b.status === 'active');
  const pendingBonds = (overview?.intimacyBonds || []).filter((b) => b.status === 'pending' && b.incoming);
  const pendingCount = (overview?.pendingFriendRequests.length || 0) + pendingBonds.length;
  const myQrUrl = `${getCloudOrigin()}/?addFriend=${encodeURIComponent(cloudUser.friendCode)}`;

  async function handleSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await cloudApi.searchUsers(q);
      setSearchResults(res.users);
      if (!res.users.length) onNotice('未找到匹配的昵称或好友码');
    } catch (err) {
      onError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddFriend(targetUserId: string) {
    try {
      const res = await cloudApi.requestFriend({ targetUserId });
      onNotice(res.message);
      setSearchResults([]);
      setSearchQuery('');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送好友申请失败');
    }
  }

  async function handleFriendDecision(friendshipId: string, decision: 'accept' | 'reject' | 'remove') {
    try {
      await cloudApi.respondFriend(friendshipId, decision);
      setOpenFriendMenuId(null);
      onNotice(decision === 'accept' ? '已通过好友申请' : decision === 'remove' ? '已删除好友' : '已拒绝申请');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function handleSubmitIntimacy() {
    if (!intimacyTarget) return;
    const target = intimacyTarget;
    const rt = intimacyType;
    const custom = intimacyLabel.trim();
    const dateStr = intimacyDate.trim();
    const meta = RELATION_META[rt];
    try {
      const res = await cloudApi.requestIntimacy(target.id, rt, custom, dateStr);
      // 同步发一张亲密关系申请卡片到与该好友的私聊窗口，方便双方在聊天内直接看到与处理
      await cloudApi
        .sendChatMessage('dm', target.id, {
          msgType: 'intimacy',
          textContent: `申请与你绑定「${custom || meta.label}」亲密关系`,
          payload: {
            bondId: res.bondId || '',
            relationType: rt,
            emoji: meta.emoji,
            label: meta.label,
            customLabel: custom,
            anniversaryDate: dateStr,
          },
        })
        .catch(() => undefined);
      onNotice(`${res.message}，已同步展示在聊天中`);
      setIntimacyTarget(null);
      setIntimacyLabel('');
      setIntimacyDate('');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送亲密关系邀请失败');
    }
  }

  function friendDisplayName(user: CloudPublicUser): string {
    return (user.remark || '').trim() || user.nickname;
  }

  function openAcceptBondModal(bond: IntimacyBond) {
    setAcceptBondTarget(bond);
    setAcceptBondLabel('');
  }

  async function handleConfirmAcceptBond() {
    if (!acceptBondTarget) return;
    try {
      await cloudApi.respondIntimacy(acceptBondTarget.id, 'accept', { customLabel: acceptBondLabel.trim() });
      onNotice('亲密关系绑定成功！已解锁专属卡片与旅途成就');
      setAcceptBondTarget(null);
      setAcceptBondLabel('');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function handleSaveEditBond() {
    if (!editBondTarget) return;
    try {
      await cloudApi.respondIntimacy(editBondTarget.id, 'update', {
        customLabel: editBondLabel.trim(),
        anniversaryDate: editBondDate.trim(),
      });
      onNotice('亲密称呼已更新');
      setEditBondTarget(null);
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新亲密称呼失败');
    }
  }

  async function handleSaveRemark() {
    if (!remarkTarget) return;
    const nextRemark = remarkDraft.trim();
    try {
      await cloudApi.setFriendRemark(remarkTarget.id, nextRemark);
      onNotice(nextRemark ? '备注已保存' : '已清除备注');
      if (activeChatFriend && activeChatFriend.id === remarkTarget.id) {
        setActiveChatFriend({ ...activeChatFriend, remark: nextRemark });
      }
      setRemarkTarget(null);
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存备注失败');
    }
  }

  async function handleIntimacyDecision(bondId: string, decision: 'accept' | 'reject' | 'remove') {
    if (decision === 'accept') {
      const targetBond = (overview?.intimacyBonds || []).find((b) => b.id === bondId);
      if (targetBond) {
        openAcceptBondModal(targetBond);
        return;
      }
    }
    try {
      await cloudApi.respondIntimacy(bondId, decision);
      onNotice(decision === 'accept' ? '亲密关系绑定成功！已解锁专属卡片与旅途成就' : '已解除/拒绝该亲密关系');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function handleSendPlanToFriend() {
    if (!sendPlanFriend || !sendPlanId) return;
    const target = sendPlanFriend;
    const plan = aiPlans.find((p) => p.id === sendPlanId);
    try {
      const share = await cloudApi.createShare({
        planId: sendPlanId,
        mode: sendPlanMode,
        recipientUserId: target.id,
        planPayload: plan,
      });
      // 同步发一张攻略卡片到与该好友的私聊中，聊天与「同行旅伴 → 攻略」两边都能看到
      await cloudApi
        .sendChatMessage('dm', target.id, {
          msgType: 'plan',
          textContent: `分享了攻略「${plan?.content.title || '旅行计划'}」`,
          payload: {
            planId: sendPlanId,
            shareCode: share.code,
            title: plan?.content.title || '旅行计划',
            destination: plan?.content.request?.destination || '',
            daysCount: plan?.content.days?.length || 0,
            mode: sendPlanMode,
          },
        })
        .catch(() => undefined);
      onNotice(sendPlanMode === 'collab'
        ? `已邀请 ${target.nickname} 加入同行协作，并同步发送到聊天`
        : `已将攻略发给 ${target.nickname}，聊天与攻略页均可查看`);
      setSendPlanFriend(null);
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送攻略失败');
    }
  }

  async function handleQuickSaveShare(code: string) {
    if (!onSaveShareToMyPlans) {
      onOpenShareCode(code);
      return;
    }
    setSavingShareCode(code);
    try {
      await onSaveShareToMyPlans(code);
      setSavedShareCodes((prev) => ({ ...prev, [code]: true }));
    } finally {
      setSavingShareCode(null);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) {
      onError('请输入行程群名称');
      return;
    }
    try {
      const res = await cloudApi.createGroup(newGroupName.trim(), newGroupMembers, newGroupPlanId || undefined);
      setNewGroupName('');
      setNewGroupMembers([]);
      setNewGroupPlanId('');
      setGroupModal(null);
      setTab('groups');
      onNotice(`行程群「${res.group.name}」创建成功`);
      await refreshAll();
      await loadGroupDetail(res.group.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '创建行程群失败');
    }
  }

  async function handleFaceToFace() {
    if (!/^\d{4}$/.test(f2fPin.trim())) {
      onError('请输入 4 位数字口令');
      return;
    }
    try {
      const res = await cloudApi.faceToFaceGroup(f2fPin.trim(), f2fName.trim(), true);
      setF2fPin('');
      setF2fName('');
      setGroupModal(null);
      setTab('groups');
      onNotice(res.created
        ? `已开启面对面房间 ${res.pinCode}（30 分钟有效），让身边同伴输入相同 4 位数字即可入群！`
        : `已加入面对面行程群「${res.group.name}」`);
      await refreshAll();
      await loadGroupDetail(res.group.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '面对面建群失败');
    }
  }

  async function handleJoinByCode() {
    if (!joinCode.trim()) return;
    try {
      const res = await cloudApi.joinGroupByCode(joinCode.trim());
      setJoinCode('');
      setGroupModal(null);
      setTab('groups');
      onNotice(`已加入行程群「${res.group.name}」`);
      await refreshAll();
      await loadGroupDetail(res.group.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '加入行程群失败');
    }
  }

  async function handleAddGroupExpense() {
    if (!activeGroup) return;
    const cents = Math.round(Number(expAmount) * 100);
    if (!expTitle.trim() || !Number.isFinite(cents) || cents <= 0) {
      onError('请填写消费项目与大于 0 的金额');
      return;
    }
    try {
      await cloudApi.saveGroupExpense(activeGroup.id, {
        date: expDate,
        category: expCategory,
        title: expTitle.trim(),
        amountCents: cents,
        payerUserId: expPayerId || cloudUser?.id || '',
        participantUserIds: expParticipants.length ? expParticipants : activeGroup.members.map((m) => m.user.id),
      });
      setExpTitle('');
      setExpAmount('');
      onNotice('已记入群 AA 账本');
      await loadGroupDetail(activeGroup.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '记账失败');
    }
  }

  async function handleBindPlanToGroup() {
    if (!activeGroup || !bindPlanId) return;
    try {
      await onSyncNow();
      await cloudApi.bindPlanGroup(bindPlanId, { groupId: activeGroup.id });
      setBindPlanId('');
      onNotice('已将该攻略关联到当前行程群，全群成员可共同编辑');
      await loadGroupDetail(activeGroup.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '关联攻略失败');
    }
  }

  // 打开私聊/群聊或在聊天室回复后，自动消除该会话对应的未读消息红点并同步服务端
  const clearRoomNotifications = useCallback((roomType: 'dm' | 'group', targetId: string) => {
    if (!cloudUser || !targetId) return;
    const matchedIds = notifications
      .filter((n) => {
        if (n.readAt) return false;
        if (roomType === 'dm') {
          return n.type === 'chat_message' && (n.actorId === targetId || n.targetRef?.dmPeerId === targetId);
        }
        return (
          (n.type === 'chat_message' || n.type === 'packing_reminder' || n.type === 'trip_reminder')
          && n.targetRef?.groupId === targetId
        );
      })
      .map((n) => n.id);
    if (matchedIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(matchedIds);
    const remainingUnread = notifications.filter((n) => !n.readAt && !idSet.has(n.id)).length;
    setNotifications((prev) => prev.map((n) => (idSet.has(n.id) ? { ...n, readAt: now } : n)));
    setOverview((prev) => (prev ? { ...prev, unreadCount: remainingUnread } : prev));
    onUnreadChange(remainingUnread);
    void cloudApi.markNotificationsRead(matchedIds).catch(() => undefined);
  }, [cloudUser, notifications, onUnreadChange]);

  useEffect(() => {
    if (activeChatFriend && !activeGroup) {
      clearRoomNotifications('dm', activeChatFriend.id);
    }
  }, [activeChatFriend, activeGroup, clearRoomNotifications]);

  useEffect(() => {
    if (activeGroup && groupRoomTab === 'chat') {
      clearRoomNotifications('group', activeGroup.id);
    }
  }, [activeGroup, groupRoomTab, clearRoomNotifications]);

  // 切到「消息」页时，自动把加好友/亲密关系等非攻略类消息标记为已读；攻略/行程邀请类需点进去才算已读
  useEffect(() => {
    if (tab !== 'notifications' || !cloudUser) return;
    const autoIds = notifications
      .filter((n) => !n.readAt && !requiresClickToRead(n))
      .map((n) => n.id);
    if (autoIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(autoIds);
    const remainingUnread = notifications.filter((n) => !n.readAt && !idSet.has(n.id)).length;
    setNotifications((prev) => prev.map((n) => (idSet.has(n.id) ? { ...n, readAt: now } : n)));
    setOverview((prev) => (prev ? { ...prev, unreadCount: remainingUnread } : prev));
    onUnreadChange(remainingUnread);
    void cloudApi.markNotificationsRead(autoIds).catch(() => undefined);
  }, [tab, cloudUser, notifications, onUnreadChange]);

  async function handleMarkOneRead(notificationId: string) {
    const target = notifications.find((n) => n.id === notificationId);
    if (!target || target.readAt) return;
    const now = new Date().toISOString();
    const remainingUnread = notifications.filter((n) => !n.readAt && n.id !== notificationId).length;
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, readAt: now } : n)));
    setOverview((prev) => (prev ? { ...prev, unreadCount: remainingUnread } : prev));
    onUnreadChange(remainingUnread);
    try {
      await cloudApi.markNotificationsRead(notificationId);
    } catch { /* ignore */ }
  }

  async function handleMarkAllRead() {
    try {
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      setOverview((prev) => (prev ? { ...prev, unreadCount: 0 } : prev));
      onUnreadChange(0);
      await cloudApi.markNotificationsRead();
      onNotice('已将全部消息标记为已读');
    } catch { /* ignore */ }
  }

  function handleParseToken() {
    const code = extractZhouyouShareCode(tokenInput);
    if (!code) {
      onError('未识别到有效的周游口令或分享码（形如 #ZY:AB12CD#）');
      return;
    }
    setTokenInput('');
    onOpenShareCode(code);
  }

  async function handleRenameGroup() {
    if (!activeGroup || renamingBusy) return;
    const nextName = renameDraft.trim().slice(0, 40);
    if (!nextName) {
      onError('群名称不能为空');
      return;
    }
    if (nextName === activeGroup.name) {
      setRenamingGroup(false);
      return;
    }
    setRenamingBusy(true);
    try {
      const res = await cloudApi.renameGroup(activeGroup.id, nextName);
      const finalName = res.name || nextName;
      setActiveGroup((prev) => (prev ? { ...prev, name: finalName } : prev));
      setGroups((prev) => prev.map((g) => (g.id === activeGroup.id ? { ...g, name: finalName } : g)));
      setRenamingGroup(false);
      onNotice(`群名已修改为「${finalName}」`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '修改群名称失败');
    } finally {
      setRenamingBusy(false);
    }
  }

  const inChatRoom = Boolean(activeChatFriend || activeGroup);
  const isGroupChatLocked = Boolean(activeGroup && groupRoomTab === 'chat' && !showGroupMembers && !showGroupQr);

  return (
    <section
      className={`companions-view chat-shell ${inChatRoom ? 'is-in-chat' : ''} ${activeChatFriend ? 'is-dm-chat' : ''} ${isGroupChatLocked ? 'is-group-chat' : ''}`}
      onClick={() => { if (plusMenuOpen) setPlusMenuOpen(false); if (openFriendMenuId) setOpenFriendMenuId(null); }}
    >
      {/* 主流聊天软件风格顶部栏：进入私聊或群聊时自动收起以给聊天窗口腾出一屏空间 */}
      {!inChatRoom && (
      <header className="chat-top-bar">
        <div className="chat-top-title">
          <h2>同行旅伴</h2>
          <button
            type="button"
            className="chat-code-pill"
            title="点击复制好友码"
            onClick={() => navigator.clipboard?.writeText(cloudUser.friendCode).then(() => onNotice(`已复制好友码：${cloudUser.friendCode}`)).catch(() => undefined)}
          >
            {cloudUser.friendCode}
          </button>
        </div>
        <div className="chat-top-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`chat-icon-btn ${loading ? 'is-spinning' : ''}`}
            disabled={loading}
            title="刷新"
            aria-label="刷新"
            onClick={() => void refreshAll()}
          >
            ↻
          </button>
          <button
            type="button"
            className="chat-icon-btn"
            title="我的名片二维码"
            aria-label="我的名片二维码"
            onClick={() => { setPlusMenuOpen(false); setShowMyQr(true); }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM19 14h2v2M14 19h2v2M19 19h2v2" />
            </svg>
          </button>
          <div className="chat-plus-wrap">
            <button
              type="button"
              className={`chat-icon-btn is-plus ${plusMenuOpen ? 'active' : ''}`}
              title="更多操作"
              aria-label="添加好友或建群"
              aria-expanded={plusMenuOpen}
              onClick={() => setPlusMenuOpen((v) => !v)}
            >
              ＋
            </button>
            {plusMenuOpen && (
              <div className="chat-plus-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setTab('friends'); window.setTimeout(() => searchInputRef.current?.focus(), 40); }}>
                  <span>👤</span> 添加旅伴好友
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setGroupModal('create'); }}>
                  <span>👥</span> 新建行程群
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setGroupModal('f2f'); }}>
                  <span>📍</span> 面对面建群
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setGroupModal('join'); }}>
                  <span>🔑</span> 邀请码入群
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setTab('shares'); }}>
                  <span>✈️</span> 粘贴周游口令
                </button>
                <button type="button" role="menuitem" onClick={() => { setPlusMenuOpen(false); setShowMyQr(true); }}>
                  <span>📱</span> 我的名片二维码
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      )}

      {/* 微信/Telegram 风格圆角搜索栏 */}
      {!activeGroup && !activeChatFriend && (
        <div className="chat-search-wrap">
          <div className="chat-search-box">
            <span className="chat-search-icon" aria-hidden="true">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索昵称或好友码，添加新旅伴…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value.trim()) setSearchResults([]);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
            />
            {searchQuery && (
              <button
                type="button"
                className="chat-search-clear"
                aria-label="清空"
                onClick={() => { setSearchQuery(''); setSearchResults([]); }}
              >
                ×
              </button>
            )}
            <button
              type="button"
              className="chat-search-submit"
              disabled={searching || !searchQuery.trim()}
              onClick={() => void handleSearch()}
            >
              {searching ? '…' : '搜索'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="chat-list-group chat-search-results">
              <div className="chat-group-label">
                <span>搜索结果 ({searchResults.length})</span>
                <button type="button" className="text-button" onClick={() => setSearchResults([])}>收起</button>
              </div>
              {searchResults.map((u) => (
                <div key={u.id} className="chat-list-row">
                  <TravelAvatar avatarId={u.avatar} nickname={u.nickname} className="chat-row-avatar" />
                  <div className="chat-row-body">
                    <strong>{u.nickname}</strong>
                    <small>好友码：{u.friendCode}</small>
                  </div>
                  <button type="button" className="primary chat-mini-btn" onClick={() => void handleAddFriend(u.id)}>
                    加好友
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 单行等宽分段导航（绝不换行拥挤） */}
      {!activeGroup && !activeChatFriend && (
        <div className="chat-segment-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'friends'}
            className={tab === 'friends' ? 'active' : ''}
            onClick={() => setTab('friends')}
          >
            <span>旅伴</span>
            {(overview?.friends.length || 0) > 0 && <em className="chat-tab-count">{overview?.friends.length}</em>}
            {pendingCount > 0 && <i className="chat-tab-dot" aria-label="有待处理请求" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'groups'}
            className={tab === 'groups' ? 'active' : ''}
            onClick={() => setTab('groups')}
          >
            <span>行程群</span>
            {groups.length > 0 && <em className="chat-tab-count">{groups.length}</em>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shares'}
            className={tab === 'shares' ? 'active' : ''}
            onClick={() => setTab('shares')}
          >
            <span>攻略</span>
            {(overview?.receivedShares.length || 0) > 0 && <em className="chat-tab-count">{overview?.receivedShares.length}</em>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'notifications'}
            className={tab === 'notifications' ? 'active' : ''}
            onClick={() => setTab('notifications')}
          >
            <span>消息</span>
            {(overview?.unreadCount || 0) > 0 && <span className="nav-unread-badge">{overview?.unreadCount}</span>}
          </button>
        </div>
      )}

      {/* ===== 好友私聊窗口 ===== */}
      {activeChatFriend && !activeGroup && (
        <ChatRoomView
          roomType="dm"
          targetId={activeChatFriend.id}
          title={friendDisplayName(activeChatFriend)}
          subtitle={
            activeChatFriend.remark
              ? `昵称：${activeChatFriend.nickname}${activeChatFriend.motto ? ` · ${activeChatFriend.motto}` : ''}`
              : (activeChatFriend.motto || `好友码：${activeChatFriend.friendCode}`)
          }
          avatarId={activeChatFriend.avatar}
          cloudUser={cloudUser}
          aiPlans={aiPlans}
          groups={groups}
          intimacyBonds={overview?.intimacyBonds || []}
          onBack={() => setActiveChatFriend(null)}
          onOpenPlan={onOpenPlan}
          onOpenShareCode={onOpenShareCode}
          onRespondIntimacy={(bondId, decision) => handleIntimacyDecision(bondId, decision)}
          onJoinedGroup={(gid) => {
            setActiveChatFriend(null);
            setTab('groups');
            void refreshAll().then(() => loadGroupDetail(gid));
          }}
          onMessageSent={() => clearRoomNotifications('dm', activeChatFriend.id)}
          onNotice={onNotice}
          onError={onError}
        />
      )}

      {/* ===== TAB 1: 旅伴（通讯录风格） ===== */}
      {tab === 'friends' && !activeGroup && !activeChatFriend && (
        <div className="chat-panel">
          {/* 新的朋友 / 亲密邀请 */}
          {pendingCount > 0 && (
            <div className="chat-list-group is-highlight">
              <div className="chat-group-label">
                <span>新的朋友与邀请 ({pendingCount})</span>
              </div>
              {(overview?.pendingFriendRequests || []).map((req) => (
                <div key={req.friendshipId} className="chat-list-row">
                  <TravelAvatar avatarId={req.user.avatar} nickname={req.user.nickname} className="chat-row-avatar" />
                  <div className="chat-row-body">
                    <strong>{req.user.nickname}</strong>
                    <small>请求加你为旅伴好友 · {req.user.friendCode}</small>
                  </div>
                  <div className="chat-row-end">
                    <button type="button" className="primary chat-mini-btn" onClick={() => void handleFriendDecision(req.friendshipId, 'accept')}>同意</button>
                    <button type="button" className="text-button chat-mini-text" onClick={() => void handleFriendDecision(req.friendshipId, 'reject')}>忽略</button>
                  </div>
                </div>
              ))}
              {pendingBonds.map((bond) => (
                <div key={bond.id} className="chat-list-row">
                  <TravelAvatar avatarId={bond.peer.avatar} nickname={bond.peer.nickname} className="chat-row-avatar" />
                  <div className="chat-row-body">
                    <strong>{friendDisplayName(bond.peer)}</strong>
                    <small>
                      邀请绑定「{RELATION_META[bond.relationType].emoji} {RELATION_META[bond.relationType].label}」
                      {bond.peerCustomLabel ? ` · 对方称呼你「${bond.peerCustomLabel}」` : ''}
                    </small>
                  </div>
                  <div className="chat-row-end">
                    <button type="button" className="primary chat-mini-btn" onClick={() => openAcceptBondModal(bond)}>同意</button>
                    <button type="button" className="text-button chat-mini-text" onClick={() => void handleIntimacyDecision(bond.id, 'reject')}>拒绝</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 亲密旅伴（与普通旅伴好友保持同等紧凑行高，已绑定者仅在此展示，不在下方重复出现） */}
          {activeBonds.length > 0 && (
            <div className="chat-list-group chat-intimacy-group">
              <div className="chat-group-label">
                <span>亲密旅伴 ({activeBonds.length})</span>
              </div>
              {activeBonds.map((bond) => {
                const meta = RELATION_META[bond.relationType];
                const days = daysSince(bond.anniversaryDate);
                const friendEntry = overview?.friends.find((f) => f.user.id === bond.peer.id);
                const menuKey = `bond-${bond.id}`;
                const menuOpen = openFriendMenuId === menuKey;
                return (
                  <div
                    key={bond.id}
                    className={`chat-list-row is-clickable is-intimate type-${bond.relationType}`}
                    onClick={() => setActiveChatFriend(bond.peer)}
                  >
                    <div className="chat-avatar-wrap">
                      <TravelAvatar avatarId={bond.peer.avatar} nickname={bond.peer.nickname} className="chat-row-avatar" />
                      <span className="chat-avatar-badge" title={meta.label}>{meta.emoji}</span>
                    </div>
                    <div className="chat-row-body">
                      <div className="chat-row-title-line">
                        <strong>{friendDisplayName(bond.peer)}</strong>
                        <span className="chat-mini-tag is-intimate-tag">{meta.emoji} {bond.customLabel || meta.label}</span>
                      </div>
                      <small>
                        {bond.peer.remark ? `${bond.peer.nickname} · ` : ''}
                        共同点亮 {bond.sharedVisitedCount} 座城市{days ? ` · 相伴第 ${days} 天` : ''}
                      </small>
                    </div>
                    <div className="chat-row-end" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="chat-action-pill is-primary" onClick={() => setActiveChatFriend(bond.peer)}>聊天</button>
                      <button type="button" className="chat-action-pill chat-desktop-only" onClick={() => setCompareUserId(bond.peer.id)}>足迹</button>
                      <button
                        type="button"
                        className="chat-action-pill chat-desktop-only"
                        onClick={() => {
                          setSendPlanFriend(bond.peer);
                          setSendPlanId(aiPlans[0]?.id || '');
                          setSendPlanMode('copy');
                        }}
                      >
                        发攻略
                      </button>
                      <div className="chat-more-wrap">
                        <button
                          type="button"
                          className="chat-more-btn"
                          aria-label="更多"
                          onClick={() => setOpenFriendMenuId(menuOpen ? null : menuKey)}
                        >
                          ···
                        </button>
                        {menuOpen && (
                          <div className="chat-row-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenFriendMenuId(null);
                                setEditBondTarget(bond);
                                setEditBondLabel(bond.customLabel || '');
                                setEditBondDate(bond.anniversaryDate || '');
                              }}
                            >
                              ✏️ 修改亲密称呼
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenFriendMenuId(null);
                                setRemarkTarget(bond.peer);
                                setRemarkDraft(bond.peer.remark || '');
                              }}
                            >
                              🏷️ 设置备注
                            </button>
                            <button type="button" role="menuitem" onClick={() => { setOpenFriendMenuId(null); setCompareUserId(bond.peer.id); }}>
                              🗺️ 对比足迹地图
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenFriendMenuId(null);
                                setSendPlanFriend(bond.peer);
                                setSendPlanId(aiPlans[0]?.id || '');
                                setSendPlanMode('copy');
                              }}
                            >
                              ✈️ 发送旅行攻略
                            </button>
                            <button type="button" role="menuitem" className="danger-text" onClick={() => { setOpenFriendMenuId(null); void handleIntimacyDecision(bond.id, 'remove'); }}>
                              💔 解除亲密关系
                            </button>
                            {friendEntry && (
                              <button type="button" role="menuitem" className="danger-text" onClick={() => { setOpenFriendMenuId(null); void handleFriendDecision(friendEntry.friendshipId, 'remove'); }}>
                                🗑️ 删除好友
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 好友列表（主流聊天软件通讯录样式；已归入上方亲密旅伴的好友不再重复显示） */}
          {(() => {
            const activeBondPeerIds = new Set(activeBonds.map((b) => b.peer.id));
            const allFriends = overview?.friends || [];
            const regularFriends = allFriends.filter((f) => !activeBondPeerIds.has(f.user.id));
            if (allFriends.length > 0 && regularFriends.length === 0) return null;
            return (
              <div className="chat-list-group">
                <div className="chat-group-label">
                  <span>{activeBonds.length > 0 ? `其他旅伴好友 (${regularFriends.length})` : `全部旅伴好友 (${regularFriends.length})`}</span>
                </div>
                {!overview && loading ? (
                  <div className="chat-empty-state" style={{ padding: '24px 16px' }}>
                    <strong>正在同步旅伴列表…</strong>
                  </div>
                ) : !allFriends.length ? (
                  <div className="chat-empty-state">
                    <div className="chat-empty-icon" aria-hidden="true">💬</div>
                    <strong>还没有旅伴好友</strong>
                    <p>在上方搜索好友昵称或好友码，或出示你的名片二维码面对面扫码添加。</p>
                    <div className="chat-empty-actions">
                      <button type="button" className="primary chat-mini-btn" onClick={() => setShowMyQr(true)}>出示名片二维码</button>
                      <button
                        type="button"
                        className="secondary chat-mini-btn"
                        onClick={() => navigator.clipboard?.writeText(`加我周游地图好友！昵称：${cloudUser.nickname}，好友码：${cloudUser.friendCode}`).then(() => onNotice('已复制好友码，快发给朋友吧')).catch(() => undefined)}
                      >
                        复制我的好友码
                      </button>
                    </div>
                  </div>
                ) : (
                  regularFriends.map((f) => {
                    const menuOpen = openFriendMenuId === f.friendshipId;
                    return (
                      <div
                        key={f.friendshipId}
                        className="chat-list-row is-clickable"
                        onClick={() => setActiveChatFriend(f.user)}
                      >
                        <div className="chat-avatar-wrap">
                          <TravelAvatar avatarId={f.user.avatar} nickname={f.user.nickname} className="chat-row-avatar" />
                        </div>
                        <div className="chat-row-body">
                          <div className="chat-row-title-line">
                            <strong>{friendDisplayName(f.user)}</strong>
                          </div>
                          <small>
                            {f.user.remark ? `${f.user.nickname} · ` : ''}
                            {f.user.motto || `好友码：${f.user.friendCode}`}
                          </small>
                        </div>
                        <div className="chat-row-end" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="chat-action-pill is-primary" onClick={() => setActiveChatFriend(f.user)}>聊天</button>
                          <button type="button" className="chat-action-pill chat-desktop-only" onClick={() => setCompareUserId(f.user.id)}>足迹</button>
                          <button
                            type="button"
                            className="chat-action-pill chat-desktop-only"
                            onClick={() => {
                              setSendPlanFriend(f.user);
                              setSendPlanId(aiPlans[0]?.id || '');
                              setSendPlanMode('copy');
                            }}
                          >
                            发攻略
                          </button>
                          <div className="chat-more-wrap">
                            <button
                              type="button"
                              className="chat-more-btn"
                              aria-label="更多"
                              onClick={() => setOpenFriendMenuId(menuOpen ? null : f.friendshipId)}
                            >
                              ···
                            </button>
                            {menuOpen && (
                              <div className="chat-row-popover" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenFriendMenuId(null);
                                    setRemarkTarget(f.user);
                                    setRemarkDraft(f.user.remark || '');
                                  }}
                                >
                                  🏷️ 设置备注
                                </button>
                                <button type="button" role="menuitem" onClick={() => { setOpenFriendMenuId(null); setCompareUserId(f.user.id); }}>
                                  🗺️ 对比足迹地图
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenFriendMenuId(null);
                                    setSendPlanFriend(f.user);
                                    setSendPlanId(aiPlans[0]?.id || '');
                                    setSendPlanMode('copy');
                                  }}
                                >
                                  ✈️ 发送旅行攻略
                                </button>
                                <button type="button" role="menuitem" onClick={() => { setOpenFriendMenuId(null); setIntimacyTarget(f.user); }}>
                                  💞 绑定亲密关系
                                </button>
                                <button type="button" role="menuitem" className="danger-text" onClick={() => void handleFriendDecision(f.friendshipId, 'remove')}>
                                  🗑️ 删除好友
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== TAB 2: 行程群列表 ===== */}
      {tab === 'groups' && !activeGroup && !activeChatFriend && (
        <div className="chat-panel">
          <div className="chat-quick-bar">
            <button type="button" className="chat-quick-pill" onClick={() => setGroupModal('create')}>
              <span>＋</span> 新建行程群
            </button>
            <button type="button" className="chat-quick-pill" onClick={() => setGroupModal('f2f')}>
              <span>📍</span> 面对面建群
            </button>
            <button type="button" className="chat-quick-pill" onClick={() => setGroupModal('join')}>
              <span>🔑</span> 邀请码入群
            </button>
          </div>

          <div className="chat-list-group">
            <div className="chat-group-label">
              <span>我的行程群 ({groups.length})</span>
            </div>
            {!groups.length ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon" aria-hidden="true">👥</div>
                <strong>还没有行程群</strong>
                <p>建一个「家人群」或「好友同游群」，群内全员可共同编辑攻略、景点投票与 AA 记账。</p>
                <div className="chat-empty-actions">
                  <button type="button" className="primary chat-mini-btn" onClick={() => setGroupModal('create')}>新建行程群</button>
                  <button type="button" className="secondary chat-mini-btn" onClick={() => setGroupModal('f2f')}>面对面 4 位数字建群</button>
                </div>
              </div>
            ) : (
              groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="chat-list-row is-clickable"
                  onClick={() => { setGroupRoomTab('chat'); void loadGroupDetail(g.id); }}
                >
                  <span className="chat-group-avatar" style={{ background: pickGroupColor(g.id) }} aria-hidden="true">
                    {g.name.slice(0, 1)}
                  </span>
                  <div className="chat-row-body">
                    <div className="chat-row-title-line">
                      <strong>{g.name}</strong>
                      {g.myRole === 'owner' && <span className="chat-mini-tag">群主</span>}
                    </div>
                    <small>{g.memberCount} 位成员 · {g.planCount} 份共享攻略</small>
                  </div>
                  <span className="chat-row-meta">
                    <small>{formatShortTime(g.updatedAt)}</small>
                    <span className="chat-row-chevron" aria-hidden="true">›</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== 行程群会话详情页（进入群聊样式） ===== */}
      {activeGroup && (
        <div className="chat-room-view">
          <div className="chat-room-header">
            <button
              type="button"
              className="chat-room-back"
              onClick={() => { setActiveGroup(null); setActiveGroupId(null); setRenamingGroup(false); }}
            >
              ‹ 返回
            </button>
            <div className="chat-room-title">
              {renamingGroup ? (
                <div className="chat-room-rename-row">
                  <input
                    type="text"
                    className="chat-room-rename-input"
                    value={renameDraft}
                    maxLength={40}
                    autoFocus
                    placeholder="输入新群名称"
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleRenameGroup(); }
                      if (e.key === 'Escape') { setRenamingGroup(false); setRenameDraft(activeGroup.name); }
                    }}
                  />
                  <button type="button" className="chat-action-pill is-primary" disabled={renamingBusy} onClick={() => void handleRenameGroup()}>
                    {renamingBusy ? '…' : '保存'}
                  </button>
                  <button type="button" className="chat-action-pill" onClick={() => { setRenamingGroup(false); setRenameDraft(activeGroup.name); }}>
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div className="chat-room-name-row">
                    <strong>{activeGroup.name}</strong>
                    <button
                      type="button"
                      className="chat-room-edit-btn"
                      title="修改群名称"
                      aria-label="修改群名称"
                      onClick={() => { setRenameDraft(activeGroup.name); setRenamingGroup(true); }}
                    >
                      ✎
                    </button>
                  </div>
                  <small>{activeGroup.members.length} 人 · 邀请码 {activeGroup.inviteCode}</small>
                </>
              )}
            </div>
            {!renamingGroup && (
              <div className="chat-room-actions">
                <button
                  type="button"
                  className={`chat-icon-btn chat-members-toggle ${showGroupMembers ? 'is-active' : ''}`}
                  title="群成员与邀请"
                  aria-label="群成员与邀请"
                  onClick={() => setShowGroupMembers((v) => !v)}
                >
                  👥
                </button>
                <button type="button" className={`chat-icon-btn ${showGroupQr ? 'is-active' : ''}`} title="群二维码" onClick={() => setShowGroupQr((v) => !v)}>
                  📱
                </button>
                {activeGroup.ownerId === cloudUser.id ? (
                  <button
                    type="button"
                    className="text-button danger-text chat-mini-text"
                    onClick={() => {
                      if (window.confirm(`确认解散行程群「${activeGroup.name}」吗？`)) {
                        void cloudApi.deleteGroup(activeGroup.id).then(() => {
                          onNotice('已解散行程群');
                          setActiveGroup(null);
                          setActiveGroupId(null);
                          return refreshAll();
                        }).catch((err) => onError(err instanceof Error ? err.message : '解散失败'));
                      }
                    }}
                  >
                    解散
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button danger-text chat-mini-text"
                    onClick={() => {
                      void cloudApi.removeGroupMember(activeGroup.id, cloudUser.id).then(() => {
                        onNotice('已退出行程群');
                        setActiveGroup(null);
                        setActiveGroupId(null);
                        return refreshAll();
                      }).catch((err) => onError(err instanceof Error ? err.message : '退群失败'));
                    }}
                  >
                    退群
                  </button>
                )}
              </div>
            )}
          </div>

          {showGroupQr && (
            <div className="companions-qr-card">
              <QrCodeBox value={`${getCloudOrigin()}/?joinGroup=${encodeURIComponent(activeGroup.inviteCode)}`} size={140} caption={`扫码加入「${activeGroup.name}」`} />
              <div className="companions-qr-copy">
                <strong>邀请同行伙伴入群</strong>
                <p>让同伴扫码或输入群邀请码 <code>{activeGroup.inviteCode}</code>，入群后同步群内攻略并参与 AA 记账。</p>
                <button
                  type="button"
                  className="secondary chat-mini-btn"
                  onClick={() => navigator.clipboard?.writeText(`加入我们的周游行程群「${activeGroup.name}」，群邀请码：${activeGroup.inviteCode}，链接：${getCloudOrigin()}/?joinGroup=${activeGroup.inviteCode}`).then(() => onNotice('已复制群邀请')).catch(() => undefined)}
                >
                  复制群邀请发微信
                </button>
              </div>
            </div>
          )}

          {/* 成员头像条：电脑端常驻，手机端群聊默认折叠（点击右上角 👥 展开），保证群聊一屏展示无需外层滚动 */}
          <div className={`chat-room-members ${showGroupMembers ? 'is-expanded' : ''}`}>
            <div className="chat-members-strip">
              {activeGroup.members.map((m) => (
                <div key={m.user.id} className="chat-member-chip">
                  <TravelAvatar avatarId={m.user.avatar} nickname={m.user.nickname} className="chat-member-avatar" />
                  <span>{m.user.nickname}</span>
                  {activeGroup.ownerId === cloudUser.id && m.user.id !== cloudUser.id && (
                    <button
                      type="button"
                      className="chip-remove-btn"
                      title="移出群"
                      onClick={() => void cloudApi.removeGroupMember(activeGroup.id, m.user.id).then(() => loadGroupDetail(activeGroup.id))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {(overview?.friends.filter((f) => !activeGroup.members.some((m) => m.user.id === f.user.id)).length || 0) > 0 && (
              <div className="companions-search-row" style={{ marginTop: 8 }}>
                <ThemedSelect
                  value={inviteFriendId}
                  placeholder="邀请好友加入本群…"
                  title="选择要邀请的好友"
                  options={overview!.friends
                    .filter((f) => !activeGroup.members.some((m) => m.user.id === f.user.id))
                    .map((f) => ({ value: f.user.id, label: f.user.nickname, sublabel: `好友码 ${f.user.friendCode}` }))}
                  onChange={setInviteFriendId}
                />
                <button
                  type="button"
                  className="secondary chat-mini-btn"
                  disabled={!inviteFriendId}
                  onClick={() => void cloudApi.addGroupMembers(activeGroup.id, [inviteFriendId]).then(() => { setInviteFriendId(''); onNotice('已拉入好友'); return loadGroupDetail(activeGroup.id); })}
                >
                  拉进群
                </button>
              </div>
            )}
          </div>

          {/* 群内三分页：群聊 | 共享攻略 | AA 记账 */}
          <div className="chat-segment-tabs is-room" role="tablist">
            <button type="button" role="tab" aria-selected={groupRoomTab === 'chat'} className={groupRoomTab === 'chat' ? 'active' : ''} onClick={() => setGroupRoomTab('chat')}>
              💬 群聊
            </button>
            <button type="button" role="tab" aria-selected={groupRoomTab === 'plans'} className={groupRoomTab === 'plans' ? 'active' : ''} onClick={() => setGroupRoomTab('plans')}>
              ✈️ 共享攻略 ({activeGroup.plans.length})
            </button>
            <button type="button" role="tab" aria-selected={groupRoomTab === 'aa'} className={groupRoomTab === 'aa' ? 'active' : ''} onClick={() => setGroupRoomTab('aa')}>
              💰 AA 记账 ({activeGroup.expenses.length})
            </button>
          </div>

          {groupRoomTab === 'chat' && (
            <ChatRoomView
              roomType="group"
              targetId={activeGroup.id}
              title={activeGroup.name}
              groupColor={pickGroupColor(activeGroup.id)}
              cloudUser={cloudUser}
              aiPlans={aiPlans}
              groups={groups}
              showHeader={false}
              onOpenPlan={onOpenPlan}
              onOpenShareCode={onOpenShareCode}
              onMessageSent={() => clearRoomNotifications('group', activeGroup.id)}
              onNotice={onNotice}
              onError={onError}
            />
          )}

          {groupRoomTab === 'plans' && (
            <div className="chat-list-group">
              {activeGroup.plans.length === 0 ? (
                <div className="chat-empty-state is-compact">
                  <p>本群暂未关联攻略，在下方选择一份你的攻略共享给全群吧。</p>
                </div>
              ) : (
                activeGroup.plans.map((p) => (
                  <div key={p.id} className="chat-list-row">
                    <span className="chat-msg-icon" aria-hidden="true">🗺️</span>
                    <div className="chat-row-body">
                      <strong>{p.title || p.destination || '未命名攻略'}</strong>
                      <small>v{p.version} · 最近由 {p.updatedByName || '成员'} 更新</small>
                    </div>
                    <button type="button" className="primary chat-mini-btn" onClick={() => onOpenPlan(p.id)}>打开共编</button>
                  </div>
                ))
              )}
              {aiPlans.length > 0 && (
                <div className="chat-group-footer-form">
                  <ThemedSelect
                    value={bindPlanId}
                    placeholder="关联我的攻略到本群…"
                    title="选择要关联的攻略"
                    options={aiPlans.map((p) => ({ value: p.id, label: p.content.title || p.content.request.destination || '未命名攻略' }))}
                    onChange={setBindPlanId}
                  />
                  <button type="button" className="secondary chat-mini-btn" disabled={!bindPlanId} onClick={() => void handleBindPlanToGroup()}>关联</button>
                </div>
              )}
            </div>
          )}

          {groupRoomTab === 'aa' && (
            <div className="companions-card">
              <div className="aa-form-grid">
                <input type="text" placeholder="消费项目（如：晚餐烤肉）" value={expTitle} onChange={(e) => setExpTitle(e.target.value)} />
                <input type="number" step="0.01" min="0" placeholder="金额（元）" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
                <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                <ThemedSelect
                  value={expCategory}
                  title="选择消费分类"
                  options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_LABELS[c] }))}
                  onChange={(val) => setExpCategory(val as ExpenseCategory)}
                />
                <ThemedSelect
                  value={expPayerId}
                  title="选择付款人"
                  options={activeGroup.members.map((m) => ({ value: m.user.id, label: `付款人：${m.user.nickname}` }))}
                  onChange={setExpPayerId}
                />
                <button type="button" className="primary" onClick={() => void handleAddGroupExpense()}>记一笔</button>
              </div>
              <div className="group-friend-picker">
                <small>参与平摊成员：</small>
                <div className="compare-city-chips">
                  {activeGroup.members.map((m) => {
                    const checked = expParticipants.includes(m.user.id);
                    return (
                      <button
                        key={m.user.id}
                        type="button"
                        className={`chip-toggle ${checked ? 'active' : ''}`}
                        onClick={() => setExpParticipants((prev) => checked ? prev.filter((id) => id !== m.user.id) : [...prev, m.user.id])}
                      >
                        {checked ? '✓ ' : ''}{m.user.nickname}
                      </button>
                    );
                  })}
                </div>
              </div>

              {groupAaSummary && groupAaSummary.totalCents > 0 && (
                <div className="aa-settlement-box">
                  <div className="aa-settlement-head">
                    <strong>总计分摊：¥{(groupAaSummary.totalCents / 100).toFixed(2)}</strong>
                    <button
                      type="button"
                      className="secondary chat-mini-btn"
                      onClick={() => {
                        const text = formatAaSettlementText(activeGroup.name, groupAaSummary);
                        navigator.clipboard?.writeText(text).then(() => onNotice('已复制 AA 结算单，可直接粘贴到微信群')).catch(() => undefined);
                      }}
                    >
                      📋 复制结算单
                    </button>
                  </div>
                  <div className="aa-transfers">
                    {groupAaSummary.transfers.length === 0 ? (
                      <small>大家账目已全部结清 ✨</small>
                    ) : (
                      groupAaSummary.transfers.map((tr, i) => (
                        <div key={i} className="aa-transfer-row">
                          <span>{tr.from} → {tr.to}</span>
                          <strong>¥{(tr.amountCents / 100).toFixed(2)}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeGroup.expenses.length > 0 && (
                <div className="chat-list-group" style={{ marginTop: 12 }}>
                  {activeGroup.expenses.map((e) => {
                    const payerName = activeGroup.members.find((m) => m.user.id === e.payerUserId)?.user.nickname || '成员';
                    return (
                      <div key={e.id} className="chat-list-row">
                        <div className="chat-row-body">
                          <strong>{e.title} · ¥{(e.amountCents / 100).toFixed(2)}</strong>
                          <small>{e.date} · {EXPENSE_LABELS[e.category] || '其他'} · {payerName} 垫付 · {e.participantUserIds.length} 人平摊</small>
                        </div>
                        <button
                          type="button"
                          className="text-button chat-mini-text"
                          onClick={() => void cloudApi.deleteGroupExpense(activeGroup.id, e.id).then(() => loadGroupDetail(activeGroup.id))}
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 3: 收到的攻略与周游口令 ===== */}
      {tab === 'shares' && !activeGroup && !activeChatFriend && (
        <div className="chat-panel">
          <div className="chat-token-bar">
            <input
              type="text"
              placeholder="粘贴微信/QQ 收到的周游口令（#ZY:...#）或链接"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleParseToken(); }}
            />
            <button type="button" className="primary chat-mini-btn" disabled={!tokenInput.trim()} onClick={handleParseToken}>接收</button>
          </div>

          <div className="chat-list-group">
            <div className="chat-group-label">
              <span>好友发来的攻略 ({overview?.receivedShares.length || 0})</span>
            </div>
            {!(overview?.receivedShares.length) ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon" aria-hidden="true">✈️</div>
                <strong>暂未收到攻略</strong>
                <p>好友发送的行程攻略或粘贴的周游口令会出现在这里。</p>
              </div>
            ) : (
              overview.receivedShares.map((s) => (
                <div key={s.code} className="chat-list-row">
                  <span className="chat-msg-icon" aria-hidden="true">✈️</span>
                  <div className="chat-row-body">
                    <strong>{s.title}</strong>
                    <small>来自 {s.senderNickname} · {s.mode === 'collab' ? '邀请同游共编' : '独立副本'}{s.daysCount ? ` · ${s.daysCount}天` : ''}</small>
                  </div>
                  <div className="chat-row-end share-row-actions">
                    <button type="button" className="chat-action-pill" onClick={() => onOpenShareCode(s.code)}>预览</button>
                    <button
                      type="button"
                      className="chat-action-pill is-primary"
                      disabled={savingShareCode === s.code}
                      onClick={() => void handleQuickSaveShare(s.code)}
                    >
                      {savingShareCode === s.code
                        ? '保存中…'
                        : savedShareCodes[s.code]
                          ? '已保存 ✓'
                          : '保存到我的行程'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== TAB 4: 消息提醒 ===== */}
      {tab === 'notifications' && !activeGroup && !activeChatFriend && (
        <div className="chat-panel">
          <div className="chat-list-group">
            <div className="chat-group-label">
              <span>消息提醒</span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  className="text-button chat-mark-all-btn"
                  disabled={!notifications.some((n) => !n.readAt)}
                  onClick={() => void handleMarkAllRead()}
                >
                  ✓ 一键已读
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="chat-empty-state">
                <div className="chat-empty-icon" aria-hidden="true">🔔</div>
                <strong>暂无新消息</strong>
                <p>好友申请、行程群邀请和攻略分享动态都会在这里提醒你。</p>
              </div>
            ) : (
              notifications.map((n) => {
                const isInteractive = requiresClickToRead(n);
                const handleOpenNotif = () => {
                  void handleMarkOneRead(n.id);
                  if (typeof n.targetRef?.shareCode === 'string') {
                    onOpenShareCode(String(n.targetRef.shareCode));
                  } else if (typeof n.targetRef?.planId === 'string') {
                    onOpenPlan(String(n.targetRef.planId));
                  } else if (typeof n.targetRef?.groupId === 'string') {
                    setTab('groups');
                    void loadGroupDetail(String(n.targetRef.groupId));
                  }
                };
                return (
                  <div
                    key={n.id}
                    className={`chat-list-row ${!n.readAt ? 'is-unread' : ''} ${isInteractive ? 'is-clickable' : ''}`}
                    onClick={isInteractive ? handleOpenNotif : undefined}
                  >
                    <span className="chat-msg-icon" aria-hidden="true">
                      {!n.readAt && <i className="chat-unread-dot" />}
                      {n.type === 'plan_received' || n.type === 'plan_edited' ? '✈️' : n.type === 'group_invite' ? '👥' : '🔔'}
                    </span>
                    <div className="chat-row-body">
                      <div className="chat-row-title-line">
                        <strong>{n.title}</strong>
                        <small className="chat-row-time">{formatShortTime(n.createdAt)}</small>
                      </div>
                      {n.body && <small>{n.body}</small>}
                    </div>
                    {typeof n.targetRef?.shareCode === 'string' && (
                      <button
                        type="button"
                        className="secondary chat-mini-btn"
                        onClick={(e) => { e.stopPropagation(); handleOpenNotif(); }}
                      >
                        查看
                      </button>
                    )}
                    {typeof n.targetRef?.planId === 'string' && !n.targetRef?.shareCode && (
                      <button
                        type="button"
                        className="secondary chat-mini-btn"
                        onClick={(e) => { e.stopPropagation(); handleOpenNotif(); }}
                      >
                        打开
                      </button>
                    )}
                    {typeof n.targetRef?.groupId === 'string' && !n.targetRef?.shareCode && !n.targetRef?.planId && (
                      <button
                        type="button"
                        className="secondary chat-mini-btn"
                        onClick={(e) => { e.stopPropagation(); handleOpenNotif(); }}
                      >
                        进群
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 我的名片二维码弹窗 */}
      {showMyQr && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowMyQr(false); }}>
          <div className="dialog chat-qr-dialog" role="dialog" aria-modal="true">
            <div className="chat-qr-dialog-head">
              <TravelAvatar avatarId={cloudUser.avatar} nickname={cloudUser.nickname} className="chat-row-avatar" />
              <div>
                <strong>{cloudUser.nickname}</strong>
                <small>好友码：{cloudUser.friendCode}</small>
              </div>
            </div>
            <div className="chat-qr-dialog-box">
              <QrCodeBox value={myQrUrl} size={184} caption="微信 / 相机扫码加我为周游好友" />
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary"
                onClick={() => navigator.clipboard?.writeText(`加我周游地图好友！昵称：${cloudUser.nickname}，好友码：${cloudUser.friendCode}，链接：${myQrUrl}`).then(() => onNotice('已复制好友名片')).catch(() => undefined)}
              >
                复制名片发微信 / QQ
              </button>
              <button type="button" className="text-button" onClick={() => setShowMyQr(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 建群 / 面对面建群 / 邀请码入群弹窗 */}
      {groupModal && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setGroupModal(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            {groupModal === 'create' && (
              <>
                <h3>新建行程群</h3>
                <div className="group-form-stack">
                  <label className="auth-field">
                    <span>群名称</span>
                    <input
                      type="text"
                      maxLength={36}
                      placeholder="例如：五一川西小分队 / 家人群"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                  </label>
                  {(overview?.friends.length || 0) > 0 && (
                    <div className="group-friend-picker">
                      <small>顺便拉好友进群：</small>
                      <div className="compare-city-chips">
                        {overview!.friends.map((f) => {
                          const checked = newGroupMembers.includes(f.user.id);
                          return (
                            <button
                              key={f.user.id}
                              type="button"
                              className={`chip-toggle ${checked ? 'active' : ''}`}
                              onClick={() => setNewGroupMembers((prev) => checked ? prev.filter((id) => id !== f.user.id) : [...prev, f.user.id])}
                            >
                              {checked ? '✓ ' : '+ '}{f.user.nickname}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {aiPlans.length > 0 && (
                    <div className="auth-field">
                      <span>关联已有攻略（选填）</span>
                      <ThemedSelect
                        value={newGroupPlanId}
                        placeholder="暂不关联"
                        title="关联已有攻略"
                        options={[
                          { value: '', label: '暂不关联' },
                          ...aiPlans.map((p) => ({ value: p.id, label: p.content.title || p.content.request.destination || '未命名攻略' })),
                        ]}
                        onChange={setNewGroupPlanId}
                      />
                    </div>
                  )}
                </div>
                <div className="dialog-actions">
                  <button type="button" className="primary" onClick={() => void handleCreateGroup()}>创建行程群</button>
                  <button type="button" className="text-button" onClick={() => setGroupModal(null)}>取消</button>
                </div>
              </>
            )}

            {groupModal === 'f2f' && (
              <>
                <h3>面对面建群</h3>
                <p className="group-card-desc">30 分钟内与身边同伴输入相同 4 位数字，即可快速成群并互加好友。</p>
                <div className="group-form-stack">
                  <label className="auth-field">
                    <span>4 位数字口令</span>
                    <input
                      type="text"
                      className="f2f-pin-input"
                      maxLength={4}
                      inputMode="numeric"
                      placeholder="0 0 0 0"
                      value={f2fPin}
                      onChange={(e) => setF2fPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                  </label>
                  <label className="auth-field">
                    <span>群名称（选填）</span>
                    <input
                      type="text"
                      maxLength={30}
                      placeholder="例如：周末出游小队"
                      value={f2fName}
                      onChange={(e) => setF2fName(e.target.value)}
                    />
                  </label>
                </div>
                <div className="dialog-actions">
                  <button type="button" className="primary" onClick={() => void handleFaceToFace()}>进入面对面群</button>
                  <button type="button" className="text-button" onClick={() => setGroupModal(null)}>取消</button>
                </div>
              </>
            )}

            {groupModal === 'join' && (
              <>
                <h3>邀请码加入行程群</h3>
                <p className="group-card-desc">输入好友发来的群邀请码，立即加入对应的行程群。</p>
                <div className="group-form-stack">
                  <label className="auth-field">
                    <span>群邀请码</span>
                    <input
                      type="text"
                      maxLength={12}
                      placeholder="输入 8 位邀请码"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                    />
                  </label>
                </div>
                <div className="dialog-actions">
                  <button type="button" className="primary" onClick={() => void handleJoinByCode()}>加入行程群</button>
                  <button type="button" className="text-button" onClick={() => setGroupModal(null)}>取消</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 亲密关系绑定弹窗 */}
      {intimacyTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setIntimacyTarget(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>与 {intimacyTarget.nickname} 绑定亲密关系</h3>
            <div className="intimacy-type-grid">
              {(['couple', 'family', 'soulmate', 'bestie'] as RelationType[]).map((rt) => (
                <button
                  key={rt}
                  type="button"
                  className={`chip-toggle ${intimacyType === rt ? 'active' : ''}`}
                  onClick={() => setIntimacyType(rt)}
                >
                  {RELATION_META[rt].emoji} {RELATION_META[rt].label}
                </button>
              ))}
            </div>
            <label className="auth-field" style={{ marginTop: 12 }}>
              <span>我给 TA 的亲密称呼（可选）</span>
              <input maxLength={24} value={intimacyLabel} onChange={(e) => setIntimacyLabel(e.target.value)} />
            </label>
            <label className="auth-field" style={{ marginTop: 8 }}>
              <span>纪念日（可选）</span>
              <input type="date" value={intimacyDate} onChange={(e) => setIntimacyDate(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => void handleSubmitIntimacy()}>发送绑定邀请</button>
              <button type="button" className="text-button" onClick={() => setIntimacyTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 同意亲密关系邀请弹窗（可设置自己给对方的亲密称呼） */}
      {acceptBondTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAcceptBondTarget(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>同意与 {friendDisplayName(acceptBondTarget.peer)} 绑定亲密关系</h3>
            <p className="auth-hint" style={{ marginTop: 6 }}>
              关系类型：{RELATION_META[acceptBondTarget.relationType].emoji} {RELATION_META[acceptBondTarget.relationType].label}
              {acceptBondTarget.peerCustomLabel ? ` · 对方称呼你「${acceptBondTarget.peerCustomLabel}」` : ''}
            </p>
            <label className="auth-field" style={{ marginTop: 10 }}>
              <span>我给 TA 的亲密称呼（可选）</span>
              <input
                maxLength={24}
                value={acceptBondLabel}
                onChange={(e) => setAcceptBondLabel(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => void handleConfirmAcceptBond()}>确认绑定</button>
              <button type="button" className="text-button" onClick={() => setAcceptBondTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 修改亲密称呼弹窗 */}
      {editBondTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditBondTarget(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>修改对 {friendDisplayName(editBondTarget.peer)} 的亲密称呼</h3>
            <label className="auth-field" style={{ marginTop: 10 }}>
              <span>亲密称呼（可选）</span>
              <input
                maxLength={24}
                value={editBondLabel}
                onChange={(e) => setEditBondLabel(e.target.value)}
              />
            </label>
            <label className="auth-field" style={{ marginTop: 8 }}>
              <span>纪念日（可选）</span>
              <input type="date" value={editBondDate} onChange={(e) => setEditBondDate(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => void handleSaveEditBond()}>保存</button>
              <button type="button" className="text-button" onClick={() => setEditBondTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 旅伴备注设置弹窗 */}
      {remarkTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setRemarkTarget(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>设置旅伴备注</h3>
            <p className="auth-hint" style={{ marginTop: 4 }}>原昵称：{remarkTarget.nickname}（好友码：{remarkTarget.friendCode}）</p>
            <label className="auth-field" style={{ marginTop: 10 }}>
              <span>备注名（留空则恢复显示原昵称）</span>
              <input
                maxLength={24}
                placeholder="输入你对 TA 的备注名"
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => void handleSaveRemark()}>保存备注</button>
              <button type="button" className="text-button" onClick={() => setRemarkTarget(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 发攻略给好友弹窗 */}
      {sendPlanFriend && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSendPlanFriend(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>发攻略给 {sendPlanFriend.nickname}</h3>
            {aiPlans.length === 0 ? (
              <p className="auth-hint">你还没有可发送的攻略，先去「行程规划」生成一份吧。</p>
            ) : (
              <>
                <div className="auth-field">
                  <span>选择要发送的攻略</span>
                  <ThemedSelect
                    value={sendPlanId}
                    title="选择要发送的攻略"
                    options={aiPlans.map((p) => ({ value: p.id, label: p.content.title || p.content.request.destination || '未命名攻略' }))}
                    onChange={setSendPlanId}
                  />
                </div>
                <div className="auth-subtabs" style={{ marginTop: 10 }}>
                  <button type="button" className={sendPlanMode === 'copy' ? 'active' : ''} onClick={() => setSendPlanMode('copy')}>发送副本（互不影响）</button>
                  <button type="button" className={sendPlanMode === 'collab' ? 'active' : ''} onClick={() => setSendPlanMode('collab')}>邀请同游（共同编辑）</button>
                </div>
              </>
            )}
            <div className="dialog-actions">
              {aiPlans.length > 0 && <button type="button" className="primary" onClick={() => void handleSendPlanToFriend()}>确认发送</button>}
              <button type="button" className="text-button" onClick={() => setSendPlanFriend(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 好友中国足迹地图对比弹窗 */}
      <FriendFootprintModal
        targetUserId={compareUserId}
        myMarks={myMarks}
        onClose={() => setCompareUserId(null)}
      />
    </section>
  );
}
