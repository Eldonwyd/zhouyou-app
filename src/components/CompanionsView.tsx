import { useCallback, useEffect, useMemo, useState } from 'react';
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

interface CompanionsViewProps {
  cloudUser: CloudSelfUser | null;
  myMarks: CityMark[];
  aiPlans: AiTravelPlan[];
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenPlan: (planId: string) => void;
  onOpenShareCode: (code: string) => void;
  onUnreadChange: (count: number) => void;
  onIntimacyLoaded?: (bonds: IntimacyBond[]) => void;
  onSyncNow: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

type CompanionsTab = 'friends' | 'groups' | 'shares' | 'notifications';

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const ts = Date.parse(`${dateStr}T00:00:00`);
  if (!Number.isFinite(ts)) return null;
  return Math.max(1, Math.floor((Date.now() - ts) / 86400000) + 1);
}

export default function CompanionsView({
  cloudUser,
  myMarks,
  aiPlans,
  onOpenAuth,
  onOpenPlan,
  onOpenShareCode,
  onUnreadChange,
  onIntimacyLoaded,
  onSyncNow,
  onNotice,
  onError,
}: CompanionsViewProps) {
  const [tab, setTab] = useState<CompanionsTab>('friends');
  const [overview, setOverview] = useState<SocialOverview | null>(null);
  const [groups, setGroups] = useState<TravelGroupSummary[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<TravelGroupDetail | null>(null);
  const [notifications, setNotifications] = useState<CloudNotification[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索与加好友
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CloudPublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [showMyQr, setShowMyQr] = useState(false);
  const [compareUserId, setCompareUserId] = useState<string | null>(null);

  // 亲密关系弹窗
  const [intimacyTarget, setIntimacyTarget] = useState<CloudPublicUser | null>(null);
  const [intimacyType, setIntimacyType] = useState<RelationType>('couple');
  const [intimacyLabel, setIntimacyLabel] = useState('');
  const [intimacyDate, setIntimacyDate] = useState('');

  // 发攻略给好友弹窗
  const [sendPlanFriend, setSendPlanFriend] = useState<CloudPublicUser | null>(null);
  const [sendPlanId, setSendPlanId] = useState('');
  const [sendPlanMode, setSendPlanMode] = useState<'copy' | 'collab'>('copy');

  // 建群 / 面对面建群 / 邀请码入群
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [newGroupPlanId, setNewGroupPlanId] = useState('');
  const [groupActionTab, setGroupActionTab] = useState<'create' | 'join'>('create');
  const [f2fPin, setF2fPin] = useState('');
  const [f2fName, setF2fName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showGroupQr, setShowGroupQr] = useState(false);
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
    if (cloudUser) void refreshAll();
  }, [cloudUser?.id]);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    try {
      const res = await cloudApi.getGroup(groupId);
      setActiveGroup(res.group);
      setActiveGroupId(groupId);
      const memberIds = res.group.members.map((m) => m.user.id);
      setExpPayerId(cloudUser?.id || memberIds[0] || '');
      setExpParticipants(memberIds);
    } catch (err) {
      onError(err instanceof Error ? err.message : '读取行程群详情失败');
    }
  }, [cloudUser?.id, onError]);

  // 群内 AA 结算计算（直接复用项目已有的 calculateAaSplit）
  const groupAaSummary = useMemo(() => {
    if (!activeGroup) return null;
    const nameById = new Map(activeGroup.members.map((m) => [m.user.id, m.user.nickname]));
    const memberNames = activeGroup.members.map((m) => m.user.nickname);
    const items: ExpenseSplitItem[] = activeGroup.expenses.map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      title: e.title,
      amountCents: e.amountCents,
      payer: nameById.get(e.payerUserId) || '成员',
      participants: e.participantUserIds.map((id) => nameById.get(id) || '成员'),
    }));
    return calculateAaSplit(memberNames, items);
  }, [activeGroup]);

  if (!cloudUser) {
    return (
      <section className="companions-guest-view">
        <div className="companions-hero-card">
          <span className="city-dialog-pill">🤝 全新模块 · 同行旅伴</span>
          <h2>把独自规划的攻略，变成一群人的出发</h2>
          <p>注册或登录周游账号后，即可在电脑与手机间自动同步全部攻略与足迹，并解锁以下旅伴协作功能：</p>
          <div className="companions-feature-grid">
            <div className="companions-feature-tile">
              <strong>🔍 搜昵称 / 好友码 / 名片码加好友</strong>
              <span>全站唯一昵称与专属好友码，互看点亮的中国地图、对比共同去过的城市。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>💑 绑定亲密关系 & 专属旅途成就</strong>
              <span>支持情侣、家人、挚友、闺蜜专属卡片、纪念日记录与双人同行徽章。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>👥 行程群 & 面对面 4 位数字建群</strong>
              <span>创建多人行程自动建群或直接选家人群，群成员共编攻略、景点投票、防误删回退。</span>
            </div>
            <div className="companions-feature-tile">
              <strong>💰 群内 AA 记账 & 微信 QQ 分享</strong>
              <span>记录垫付一键算出最少转账方案；微信/QQ 发链接与周游口令，免下载预览、已装直达。</span>
            </div>
          </div>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={() => onOpenAuth('register')}>注册周游账号</button>
            <button type="button" className="secondary" onClick={() => onOpenAuth('login')}>已有账号，去登录</button>
          </div>
        </div>
      </section>
    );
  }

  const activeBonds = (overview?.intimacyBonds || []).filter((b) => b.status === 'active');
  const pendingBonds = (overview?.intimacyBonds || []).filter((b) => b.status === 'pending' && b.incoming);
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
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送好友申请失败');
    }
  }

  async function handleFriendDecision(friendshipId: string, decision: 'accept' | 'reject' | 'remove') {
    try {
      await cloudApi.respondFriend(friendshipId, decision);
      onNotice(decision === 'accept' ? '已通过好友申请' : decision === 'remove' ? '已删除好友' : '已拒绝申请');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function handleSubmitIntimacy() {
    if (!intimacyTarget) return;
    try {
      const res = await cloudApi.requestIntimacy(intimacyTarget.id, intimacyType, intimacyLabel, intimacyDate);
      onNotice(res.message);
      setIntimacyTarget(null);
      setIntimacyLabel('');
      setIntimacyDate('');
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送亲密关系邀请失败');
    }
  }

  async function handleIntimacyDecision(bondId: string, decision: 'accept' | 'reject' | 'remove') {
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
    const plan = aiPlans.find((p) => p.id === sendPlanId);
    try {
      await cloudApi.createShare({
        planId: sendPlanId,
        mode: sendPlanMode,
        recipientUserId: sendPlanFriend.id,
        planPayload: plan,
      });
      onNotice(sendPlanMode === 'collab'
        ? `已邀请 ${sendPlanFriend.nickname} 加入同行协作！`
        : `已将攻略副本发给 ${sendPlanFriend.nickname}`);
      setSendPlanFriend(null);
      await refreshAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送攻略失败');
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

  async function handleMarkAllRead() {
    try {
      await cloudApi.markNotificationsRead();
      onUnreadChange(0);
      await refreshAll();
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

  return (
    <section className="companions-view">
      <div className="companions-header-bar">
        <div>
          <h2>同行旅伴</h2>
          <p>
            我的唯一昵称：<strong>{cloudUser.nickname}</strong> · 好友码：
            <button
              type="button"
              className="inline-code-btn"
              onClick={() => navigator.clipboard?.writeText(cloudUser.friendCode).then(() => onNotice(`已复制好友码：${cloudUser.friendCode}`)).catch(() => undefined)}
            >
              {cloudUser.friendCode}
            </button>
          </p>
        </div>
        <div className="companions-header-actions">
          <button type="button" className="secondary" onClick={() => setShowMyQr((v) => !v)}>
            {showMyQr ? '收起名片二维码' : '📱 我的名片二维码'}
          </button>
          <button type="button" className="secondary" disabled={loading} onClick={() => void refreshAll()}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {showMyQr && (
        <div className="companions-qr-card">
          <QrCodeBox value={myQrUrl} size={160} caption={`微信/相机扫码加 ${cloudUser.nickname} 为好友`} />
          <div className="companions-qr-copy">
            <strong>{cloudUser.nickname} 的周游名片</strong>
            <p>当面出示二维码，或把好友码 <code>{cloudUser.friendCode}</code> 发给朋友即可互加好友、互看足迹地图与共同规划行程。</p>
            <button
              type="button"
              className="secondary"
              onClick={() => navigator.clipboard?.writeText(`加我周游地图好友！昵称：${cloudUser.nickname}，好友码：${cloudUser.friendCode}，链接：${myQrUrl}`).then(() => onNotice('已复制好友名片')).catch(() => undefined)}
            >
              复制名片发微信 / QQ
            </button>
          </div>
        </div>
      )}

      <div className="companions-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'friends'} className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
          好友与亲密关系 ({overview?.friends.length || 0})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'groups'} className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
          行程群 ({groups.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'shares'} className={tab === 'shares' ? 'active' : ''} onClick={() => setTab('shares')}>
          收到的攻略 & 口令 ({overview?.receivedShares.length || 0})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'notifications'} className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>
          消息提醒 {(overview?.unreadCount || 0) > 0 && <span className="nav-unread-badge">{overview?.unreadCount}</span>}
        </button>
      </div>

      {/* ===== TAB 1: 好友与亲密关系 ===== */}
      {tab === 'friends' && (
        <div className="companions-panel">
          {/* 添加好友搜索框 */}
          <div className="companions-card">
            <h3>添加旅伴好友</h3>
            <div className="companions-search-row">
              <input
                type="text"
                placeholder="输入昵称或好友码"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
              />
              <button type="button" className="primary" disabled={searching} onClick={() => void handleSearch()}>
                {searching ? '搜索中…' : '搜索'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="companions-user-list">
                {searchResults.map((u) => (
                  <div key={u.id} className="companions-user-row">
                    <div className="companions-user-info">
                      <TravelAvatar avatarId={u.avatar} nickname={u.nickname} className="avatar" />
                      <div>
                        <strong>{u.nickname}</strong>
                        <small>好友码：{u.friendCode}</small>
                      </div>
                    </div>
                    <button type="button" className="primary" onClick={() => void handleAddFriend(u.id)}>加为好友</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 待处理的好友 / 亲密关系申请 */}
          {((overview?.pendingFriendRequests.length || 0) > 0 || pendingBonds.length > 0) && (
            <div className="companions-card accent-card">
              <h3>待处理邀请</h3>
              {(overview?.pendingFriendRequests || []).map((req) => (
                <div key={req.friendshipId} className="companions-user-row">
                  <div className="companions-user-info">
                    <TravelAvatar avatarId={req.user.avatar} nickname={req.user.nickname} className="avatar" />
                    <div>
                      <strong>{req.user.nickname}</strong> 请求加你为好友
                      <small>好友码：{req.user.friendCode}</small>
                    </div>
                  </div>
                  <div className="companions-row-actions">
                    <button type="button" className="primary" onClick={() => void handleFriendDecision(req.friendshipId, 'accept')}>同意</button>
                    <button type="button" className="text-button" onClick={() => void handleFriendDecision(req.friendshipId, 'reject')}>拒绝</button>
                  </div>
                </div>
              ))}
              {pendingBonds.map((bond) => (
                <div key={bond.id} className="companions-user-row">
                  <div className="companions-user-info">
                    <TravelAvatar avatarId={bond.peer.avatar} nickname={bond.peer.nickname} className="avatar" />
                    <div>
                      <strong>{bond.peer.nickname}</strong> 邀请绑定「{RELATION_META[bond.relationType].emoji} {RELATION_META[bond.relationType].label}」
                      {bond.customLabel && <small>备注：{bond.customLabel}</small>}
                    </div>
                  </div>
                  <div className="companions-row-actions">
                    <button type="button" className="primary" onClick={() => void handleIntimacyDecision(bond.id, 'accept')}>同意绑定</button>
                    <button type="button" className="text-button" onClick={() => void handleIntimacyDecision(bond.id, 'reject')}>拒绝</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 亲密关系专属卡片 */}
          {activeBonds.length > 0 && (
            <div className="companions-card">
              <h3>亲密关系专属卡片（联动旅途成就）</h3>
              <div className="intimacy-cards-grid">
                {activeBonds.map((bond) => {
                  const meta = RELATION_META[bond.relationType];
                  const days = daysSince(bond.anniversaryDate);
                  return (
                    <div key={bond.id} className={`intimacy-card type-${bond.relationType}`}>
                      <div className="intimacy-card-top">
                        <span className="intimacy-badge">{meta.emoji} {bond.customLabel || meta.label}</span>
                        {days && <small>相伴第 {days} 天</small>}
                      </div>
                      <div className="intimacy-card-peer">
                        <TravelAvatar avatarId={bond.peer.avatar} nickname={bond.peer.nickname} className="avatar" />
                        <div>
                          <strong>{bond.peer.nickname}</strong>
                          <small>共同点亮 {bond.sharedVisitedCount} 座城市{bond.anniversaryDate ? ` · 纪念日 ${bond.anniversaryDate}` : ''}</small>
                        </div>
                      </div>
                      <div className="intimacy-card-actions">
                        <button type="button" className="secondary" onClick={() => setCompareUserId(bond.peer.id)}>🗺️ 对比足迹地图</button>
                        <button type="button" className="text-button" onClick={() => void handleIntimacyDecision(bond.id, 'remove')}>解除</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 我的好友列表 */}
          <div className="companions-card">
            <h3>我的旅伴好友（{overview?.friends.length || 0}）</h3>
            {!(overview?.friends.length) ? (
              <p className="auth-hint">还没有好友，试试搜索朋友的昵称、好友码，或者出示你的名片二维码吧。</p>
            ) : (
              <div className="companions-user-list">
                {overview.friends.map((f) => (
                  <div key={f.friendshipId} className="companions-user-row">
                    <div className="companions-user-info">
                      <TravelAvatar avatarId={f.user.avatar} nickname={f.user.nickname} className="avatar" />
                      <div>
                        <strong>{f.user.nickname}</strong>
                        <small>好友码：{f.user.friendCode}</small>
                      </div>
                    </div>
                    <div className="companions-row-actions">
                      <button type="button" className="secondary" onClick={() => setCompareUserId(f.user.id)}>🗺️ 对比足迹</button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setSendPlanFriend(f.user);
                          setSendPlanId(aiPlans[0]?.id || '');
                          setSendPlanMode('copy');
                        }}
                      >
                        ✈️ 发攻略
                      </button>
                      <button type="button" className="secondary" onClick={() => setIntimacyTarget(f.user)}>💞 亲密关系</button>
                      <button type="button" className="text-button" onClick={() => void handleFriendDecision(f.friendshipId, 'remove')}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB 2: 行程群 ===== */}
      {tab === 'groups' && (
        <div className="companions-panel">
          <div className="companions-grid-2">
            {/* 面对面建群 */}
            <div className="companions-card group-entry-card">
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
                <button type="button" className="primary group-card-submit" onClick={() => void handleFaceToFace()}>
                  进入面对面群
                </button>
              </div>
            </div>

            {/* 行程群（新建 / 邀请码加入） */}
            <div className="companions-card group-entry-card">
              <div className="group-card-head-row">
                <h3>行程群</h3>
                <div className="auth-account-switch group-mini-switch" role="tablist" aria-label="行程群操作">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={groupActionTab === 'create'}
                    className={groupActionTab === 'create' ? 'active' : ''}
                    onClick={() => setGroupActionTab('create')}
                  >
                    新建群
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={groupActionTab === 'join'}
                    className={groupActionTab === 'join' ? 'active' : ''}
                    onClick={() => setGroupActionTab('join')}
                  >
                    邀请码加入
                  </button>
                </div>
              </div>

              {groupActionTab === 'create' ? (
                <div className="group-form-stack">
                  <label className="auth-field">
                    <span>群名称</span>
                    <input
                      type="text"
                      maxLength={36}
                      placeholder="例如：家人群"
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
                    <label className="auth-field">
                      <span>关联已有攻略（选填）</span>
                      <select value={newGroupPlanId} onChange={(e) => setNewGroupPlanId(e.target.value)}>
                        <option value="">暂不关联</option>
                        {aiPlans.map((p) => <option key={p.id} value={p.id}>{p.content.title || p.content.request.destination || '未命名攻略'}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" className="primary group-card-submit" onClick={() => void handleCreateGroup()}>
                    创建行程群
                  </button>
                </div>
              ) : (
                <div className="group-form-stack">
                  <p className="group-card-desc">输入好友发来的群邀请码，立即加入对应的行程群。</p>
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
                  <button type="button" className="primary group-card-submit" onClick={() => void handleJoinByCode()}>
                    加入行程群
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 群列表 + 群详情 */}
          <div className="companions-card">
            <h3>我的行程群（{groups.length}）</h3>
            {!groups.length ? (
              <p className="auth-hint">还没有行程群，可以先创建一个「家人群」或「好友同游群」，以后做多人攻略直接选中它即可全员共享！</p>
            ) : (
              <div className="group-list-grid">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`group-list-item ${activeGroupId === g.id ? 'active' : ''}`}
                    onClick={() => void loadGroupDetail(g.id)}
                  >
                    <strong>{g.name}</strong>
                    <small>{g.memberCount} 人 · {g.planCount} 份共享攻略 · {g.myRole === 'owner' ? '群主' : '成员'}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeGroup && (
            <div className="companions-card group-detail-panel">
              <div className="companions-header-bar">
                <div>
                  <h3>👥 {activeGroup.name}</h3>
                  <small>群邀请码：<code>{activeGroup.inviteCode}</code> · {activeGroup.members.length} 位成员</small>
                </div>
                <div className="companions-row-actions">
                  <button type="button" className="secondary" onClick={() => setShowGroupQr((v) => !v)}>
                    {showGroupQr ? '收起群二维码' : '📱 群二维码'}
                  </button>
                  {activeGroup.ownerId === cloudUser.id ? (
                    <button
                      type="button"
                      className="text-button danger-text"
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
                      解散群
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() => {
                        void cloudApi.removeGroupMember(activeGroup.id, cloudUser.id).then(() => {
                          onNotice('已退出行程群');
                          setActiveGroup(null);
                          setActiveGroupId(null);
                          return refreshAll();
                        }).catch((err) => onError(err instanceof Error ? err.message : '退群失败'));
                      }}
                    >
                      退出群
                    </button>
                  )}
                </div>
              </div>

              {showGroupQr && (
                <div className="companions-qr-card">
                  <QrCodeBox value={`${getCloudOrigin()}/?joinGroup=${encodeURIComponent(activeGroup.inviteCode)}`} size={148} caption={`扫码加入「${activeGroup.name}」`} />
                  <div className="companions-qr-copy">
                    <strong>邀请同行伙伴入群</strong>
                    <p>让同伴扫码或输入群邀请码 <code>{activeGroup.inviteCode}</code>，入群后即可同步群内全部行程、一起编辑、投票并参与 AA 记账。</p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => navigator.clipboard?.writeText(`加入我们的周游行程群「${activeGroup.name}」，群邀请码：${activeGroup.inviteCode}，链接：${getCloudOrigin()}/?joinGroup=${activeGroup.inviteCode}`).then(() => onNotice('已复制群邀请')).catch(() => undefined)}
                    >
                      复制群邀请发微信
                    </button>
                  </div>
                </div>
              )}

              {/* 群成员与拉人 */}
              <div className="group-sub-section">
                <h4>群成员</h4>
                <div className="compare-city-chips">
                  {activeGroup.members.map((m) => (
                    <span key={m.user.id} className="stop-pill">
                      {m.user.nickname}{m.role === 'owner' ? ' (群主)' : ''}
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
                    </span>
                  ))}
                </div>
                {(overview?.friends.length || 0) > 0 && (
                  <div className="companions-search-row" style={{ marginTop: 8 }}>
                    <select value={inviteFriendId} onChange={(e) => setInviteFriendId(e.target.value)}>
                      <option value="">选择好友拉入本群…</option>
                      {overview!.friends
                        .filter((f) => !activeGroup.members.some((m) => m.user.id === f.user.id))
                        .map((f) => <option key={f.user.id} value={f.user.id}>{f.user.nickname}</option>)}
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!inviteFriendId}
                      onClick={() => void cloudApi.addGroupMembers(activeGroup.id, [inviteFriendId]).then(() => { setInviteFriendId(''); onNotice('已拉入好友'); return loadGroupDetail(activeGroup.id); })}
                    >
                      拉进群
                    </button>
                  </div>
                )}
              </div>

              {/* 群内共享攻略 */}
              <div className="group-sub-section">
                <h4>群内共享攻略（全员可共同编辑）</h4>
                {activeGroup.plans.length === 0 ? (
                  <p className="auth-hint">本群暂未关联攻略，可在下方选择一份你的攻略关联进来。</p>
                ) : (
                  <div className="companions-user-list">
                    {activeGroup.plans.map((p) => (
                      <div key={p.id} className="companions-user-row">
                        <div>
                          <strong>{p.title || p.destination || '未命名攻略'}</strong>
                          <small>v{p.version} · 最近由 {p.updatedByName || '成员'} 更新</small>
                        </div>
                        <button type="button" className="primary" onClick={() => onOpenPlan(p.id)}>打开共编</button>
                      </div>
                    ))}
                  </div>
                )}
                {aiPlans.length > 0 && (
                  <div className="companions-search-row" style={{ marginTop: 8 }}>
                    <select value={bindPlanId} onChange={(e) => setBindPlanId(e.target.value)}>
                      <option value="">把我的另一份攻略关联到本群…</option>
                      {aiPlans.map((p) => <option key={p.id} value={p.id}>{p.content.title || p.content.request.destination || '未命名攻略'}</option>)}
                    </select>
                    <button type="button" className="secondary" disabled={!bindPlanId} onClick={() => void handleBindPlanToGroup()}>关联进群</button>
                  </div>
                )}
              </div>

              {/* 群内 AA 记账与一键结算 */}
              <div className="group-sub-section">
                <h4>💰 群内 AA 记账与一键结算</h4>
                <div className="aa-form-grid">
                  <input type="text" placeholder="消费项目（如：晚餐烤肉）" value={expTitle} onChange={(e) => setExpTitle(e.target.value)} />
                  <input type="number" step="0.01" min="0" placeholder="金额（元）" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
                  <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />
                  <select value={expCategory} onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_LABELS[c]}</option>)}
                  </select>
                  <select value={expPayerId} onChange={(e) => setExpPayerId(e.target.value)}>
                    {activeGroup.members.map((m) => <option key={m.user.id} value={m.user.id}>付款人：{m.user.nickname}</option>)}
                  </select>
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
                        className="secondary"
                        onClick={() => {
                          const text = formatAaSettlementText(activeGroup.name, groupAaSummary);
                          navigator.clipboard?.writeText(text).then(() => onNotice('已复制 AA 结算单，可直接粘贴到微信群')).catch(() => undefined);
                        }}
                      >
                        📋 复制结算单发微信
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
                  <div className="companions-user-list" style={{ marginTop: 10 }}>
                    {activeGroup.expenses.map((e) => {
                      const payerName = activeGroup.members.find((m) => m.user.id === e.payerUserId)?.user.nickname || '成员';
                      return (
                        <div key={e.id} className="companions-user-row">
                          <div>
                            <strong>{e.title} · ¥{(e.amountCents / 100).toFixed(2)}</strong>
                            <small>{e.date} · {EXPENSE_LABELS[e.category] || '其他'} · {payerName} 垫付 · {e.participantUserIds.length} 人平摊</small>
                          </div>
                          <button
                            type="button"
                            className="text-button"
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
            </div>
          )}
        </div>
      )}

      {/* ===== TAB 3: 收到的攻略与周游口令 ===== */}
      {tab === 'shares' && (
        <div className="companions-panel">
          <div className="companions-card">
            <h3>🔑 粘贴周游口令 / 分享码接收攻略</h3>
            <p className="auth-hint">从微信或 QQ 复制好友发来的整段周游口令（如 #ZY:AB12CD#）或链接，粘贴到这里一键接收：</p>
            <div className="companions-search-row">
              <input
                type="text"
                placeholder="粘贴周游口令、分享链接或 6 位分享码"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <button type="button" className="primary" onClick={handleParseToken}>识别并接收</button>
            </div>
          </div>

          <div className="companions-card">
            <h3>好友推送给我的攻略（{overview?.receivedShares.length || 0}）</h3>
            {!(overview?.receivedShares.length) ? (
              <p className="auth-hint">暂未收到好友直接推送的攻略。</p>
            ) : (
              <div className="companions-user-list">
                {overview.receivedShares.map((s) => (
                  <div key={s.code} className="companions-user-row">
                    <div>
                      <strong>{s.title}</strong>
                      <small>来自 {s.senderNickname} · {s.mode === 'collab' ? '邀请同游共编' : '独立攻略副本'}{s.daysCount ? ` · ${s.daysCount}天` : ''}</small>
                    </div>
                    <button type="button" className="primary" onClick={() => onOpenShareCode(s.code)}>查看接收</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB 4: 消息提醒 ===== */}
      {tab === 'notifications' && (
        <div className="companions-panel">
          <div className="companions-card">
            <div className="companions-header-bar">
              <h3>站内消息提醒</h3>
              <button type="button" className="secondary" onClick={() => void handleMarkAllRead()}>全部标为已读</button>
            </div>
            {notifications.length === 0 ? (
              <p className="auth-hint">暂无消息提醒。</p>
            ) : (
              <div className="companions-user-list">
                {notifications.map((n) => (
                  <div key={n.id} className={`companions-user-row ${!n.readAt ? 'unread-row' : ''}`}>
                    <div>
                      <strong>{n.title}</strong>
                      {n.body && <small>{n.body}</small>}
                      <small>{new Date(n.createdAt).toLocaleString('zh-CN')}</small>
                    </div>
                    {typeof n.targetRef?.shareCode === 'string' && (
                      <button type="button" className="secondary" onClick={() => onOpenShareCode(String(n.targetRef.shareCode))}>查看</button>
                    )}
                    {typeof n.targetRef?.planId === 'string' && !n.targetRef?.shareCode && (
                      <button type="button" className="secondary" onClick={() => onOpenPlan(String(n.targetRef.planId))}>打开攻略</button>
                    )}
                  </div>
                ))}
              </div>
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
              <span>专属称呼 / 备注（可选）</span>
              <input maxLength={24} placeholder="例如：一起看世界的人" value={intimacyLabel} onChange={(e) => setIntimacyLabel(e.target.value)} />
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

      {/* 发攻略给好友弹窗 */}
      {sendPlanFriend && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSendPlanFriend(null); }}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>发攻略给 {sendPlanFriend.nickname}</h3>
            {aiPlans.length === 0 ? (
              <p className="auth-hint">你还没有可发送的攻略，先去「行程规划」生成一份吧。</p>
            ) : (
              <>
                <label className="auth-field">
                  <span>选择要发送的攻略</span>
                  <select value={sendPlanId} onChange={(e) => setSendPlanId(e.target.value)}>
                    {aiPlans.map((p) => <option key={p.id} value={p.id}>{p.content.title || p.content.request.destination || '未命名攻略'}</option>)}
                  </select>
                </label>
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
