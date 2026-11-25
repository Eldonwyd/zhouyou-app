import { useEffect, useMemo, useState } from 'react';
import {
  cloudApi,
  type CloudSelfUser,
  type FriendItem,
  type PlanComment,
  type PlanRevision,
  type PlanVote,
  type TravelGroupSummary,
} from '../cloud-api';
import { getCloudPlanMetaMap, updateCloudPlanMeta } from '../cloud-sync';
import type { AiTravelPlan } from '../planner-types';

interface PlanCollabBarProps {
  plan: AiTravelPlan;
  cloudUser: CloudSelfUser | null;
  onOpenAuth: () => void;
  onPlanReverted: (restored: AiTravelPlan) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const VOTE_LABELS: Record<'want' | 'backup' | 'skip', string> = {
  want: '👍 想去',
  backup: '🤔 备选',
  skip: '⏭ 跳过',
};

export default function PlanCollabBar({
  plan,
  cloudUser,
  onOpenAuth,
  onPlanReverted,
  onSyncNow,
  onNotice,
  onError,
}: PlanCollabBarProps) {
  const [panel, setPanel] = useState<'none' | 'invite' | 'share' | 'group' | 'collab' | 'history'>('none');
  const [invitedFriendIds, setInvitedFriendIds] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState<TravelGroupSummary[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [votes, setVotes] = useState<PlanVote[]>([]);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // 分享弹窗状态
  const [shareMode, setShareMode] = useState<'copy' | 'collab'>('copy');
  const [shareResult, setShareResult] = useState<{ shareUrl: string; zhouyouToken: string; code: string } | null>(null);
  const [shareFriendId, setShareFriendId] = useState('');
  const [busy, setBusy] = useState(false);

  // 绑定群状态
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState(plan.content.title || '同游小队');
  const [metaTick, setMetaTick] = useState(0);

  const planMeta = useMemo(() => getCloudPlanMetaMap()[plan.id] || null, [plan.id, metaTick]);

  // 收集当前攻略的所有可投票/批注景点与餐厅条目
  const activityItems = useMemo(() => {
    const list: Array<{ key: string; dayLabel: string; title: string; subtitle: string }> = [];
    for (const [dayIdx, day] of (plan.content?.days || []).entries()) {
      for (const act of day.activities || []) {
        list.push({
          key: `${dayIdx + 1}:${act.id}`,
          dayLabel: `Day ${dayIdx + 1}`,
          title: act.title || '行程条目',
          subtitle: act.location || act.startTime || '',
        });
      }
    }
    return list;
  }, [plan]);

  useEffect(() => {
    setNewGroupName(plan.content.title || '同游小队');
    setShareResult(null);
  }, [plan.id]);

  async function openPanel(next: 'invite' | 'share' | 'group' | 'collab' | 'history') {
    if (!cloudUser) {
      onOpenAuth();
      return;
    }
    if (panel === next) {
      setPanel('none');
      return;
    }
    setPanel(next);
    try {
      if (next === 'invite' || next === 'group' || next === 'share') {
        const [gRes, sRes] = await Promise.all([cloudApi.listGroups(), cloudApi.getSocialOverview()]);
        setGroups(gRes.groups);
        setFriends(sRes.friends);
        setSelectedGroupId(planMeta?.groupId || '');
      }
      if (next === 'history') {
        await onSyncNow();
        const revRes = await cloudApi.getPlanRevisions(plan.id);
        setRevisions(revRes.revisions);
      }
      if (next === 'collab') {
        await onSyncNow();
        const cRes = await cloudApi.getPlanCollab(plan.id);
        setVotes(cRes.votes);
        setComments(cRes.comments);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载云端协作信息失败');
    }
  }

  async function handleGenerateShare(recipientUserId?: string) {
    setBusy(true);
    try {
      const res = await cloudApi.createShare({
        planId: plan.id,
        mode: shareMode,
        recipientUserId: recipientUserId || undefined,
        planPayload: plan,
      });
      if (res.groupId) {
        updateCloudPlanMeta(plan.id, { groupId: res.groupId });
        setMetaTick((t) => t + 1);
      }
      if (recipientUserId) {
        onNotice(shareMode === 'collab' ? '已邀请好友加入同行群共同编辑' : '已推送攻略副本给好友');
      } else {
        setShareResult({ shareUrl: res.shareUrl, zhouyouToken: res.zhouyouToken, code: res.code });
        navigator.clipboard?.writeText(res.zhouyouToken).then(() => onNotice('已生成并复制周游口令与微信/QQ分享链接')).catch(() => onNotice('已生成分享链接与周游口令'));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : '分享失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleBindExistingGroup() {
    setBusy(true);
    try {
      await onSyncNow();
      const res = await cloudApi.bindPlanGroup(plan.id, { groupId: selectedGroupId || null });
      updateCloudPlanMeta(plan.id, { groupId: res.groupId, groupName: res.groupName });
      setMetaTick((t) => t + 1);
      onNotice(res.groupId ? `已绑定行程群「${res.groupName}」，群成员将自动同步并共同编辑` : '已取消绑定行程群');
    } catch (err) {
      onError(err instanceof Error ? err.message : '绑定行程群失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoCreateGroup() {
    setBusy(true);
    try {
      await onSyncNow();
      const res = await cloudApi.bindPlanGroup(plan.id, { createNew: true, groupName: newGroupName.trim() || plan.content.title || '同行小队' });
      updateCloudPlanMeta(plan.id, { groupId: res.groupId, groupName: res.groupName });
      setMetaTick((t) => t + 1);
      onNotice(`已自动创建行程群「${res.groupName}」并绑定本攻略`);
      const gRes = await cloudApi.listGroups();
      setGroups(gRes.groups);
      setSelectedGroupId(res.groupId || '');
    } catch (err) {
      onError(err instanceof Error ? err.message : '自动建群失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(itemKey: string, vote: 'want' | 'backup' | 'skip') {
    const mine = votes.find((v) => v.itemKey === itemKey && v.userId === cloudUser?.id);
    const nextVote = mine?.vote === vote ? '' : vote;
    try {
      await cloudApi.votePlanItem(plan.id, itemKey, nextVote);
      const cRes = await cloudApi.getPlanCollab(plan.id);
      setVotes(cRes.votes);
    } catch (err) {
      onError(err instanceof Error ? err.message : '投票失败');
    }
  }

  async function handleAddComment(itemKey: string) {
    const content = (commentDrafts[itemKey] || '').trim();
    if (!content) return;
    try {
      const res = await cloudApi.commentPlanItem(plan.id, itemKey, content);
      setComments((prev) => [...prev, res.comment]);
      setCommentDrafts((prev) => ({ ...prev, [itemKey]: '' }));
    } catch (err) {
      onError(err instanceof Error ? err.message : '发表批注失败');
    }
  }

  async function handleRevert(revisionId: string, version: number) {
    if (!window.confirm(`确定回退到历史版本 v${version} 吗？（当前版本仍会保留在历史记录中）`)) return;
    setBusy(true);
    try {
      const res = await cloudApi.revertPlan(plan.id, revisionId);
      updateCloudPlanMeta(plan.id, { version: res.version });
      setMetaTick((t) => t + 1);
      await onPlanReverted(res.payload);
      onNotice(`已恢复到 v${version}`);
      const revRes = await cloudApi.getPlanRevisions(plan.id);
      setRevisions(revRes.revisions);
    } catch (err) {
      onError(err instanceof Error ? err.message : '回退失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteFriendDirect(friend: FriendItem) {
    setBusy(true);
    try {
      const res = await cloudApi.createShare({
        planId: plan.id,
        mode: 'collab',
        recipientUserId: friend.user.id,
        planPayload: plan,
      });
      if (res.groupId) {
        updateCloudPlanMeta(plan.id, { groupId: res.groupId });
        setMetaTick((t) => t + 1);
      }
      setInvitedFriendIds((prev) => ({ ...prev, [friend.user.id]: true }));
      onNotice(`已邀请「${friend.user.nickname}」进入本行程共同规划`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '邀请好友失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plan-collab-bar">
      <div className="plan-collab-strip">
        <span className="plan-collab-status">
          {planMeta?.groupId
            ? `👥 已关联行程群「${planMeta.groupName || '同行群'}」· v${planMeta.version}`
            : cloudUser
              ? '☁️ 已开启云端自动同步'
              : '☁️ 登录后可同步到手机并邀请好友同行'}
        </span>
        <div className="plan-collab-actions">
          <button type="button" className="primary" onClick={() => void openPanel('invite')}>🤝 邀请好友进入</button>
          <button type="button" className="secondary" onClick={() => void openPanel('share')}>✈️ 分享攻略 / 口令</button>
          <button type="button" className="secondary" onClick={() => void openPanel('group')}>👥 绑定行程群</button>
          <button type="button" className="secondary" onClick={() => void openPanel('collab')}>🗳️ 投票与批注</button>
          <button type="button" className="secondary" onClick={() => void openPanel('history')}>🕘 修改动态与回退</button>
        </div>
      </div>

      {panel === 'invite' && (
        <div className="plan-collab-drawer">
          <h4>邀请好友进入本行程（同游共编）</h4>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
            点击好友右侧「邀请进入」，对方会收到邀请并自动加入本行程的同游群，可一起修改攻略、投票与记账。
          </p>
          {friends.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              还没有站内好友，先去「同行旅伴」搜索昵称/好友码添加，或点击下方生成微信/QQ 邀请口令。
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
              {friends.map((f) => {
                const invited = Boolean(invitedFriendIds[f.user.id]);
                return (
                  <div
                    key={f.user.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 12,
                      background: 'var(--surface-2, rgba(0,0,0,0.03))',
                      border: '1px solid var(--line, rgba(0,0,0,0.06))',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{f.user.nickname}</strong>
                      <small className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                        好友码：{f.user.friendCode}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={invited ? 'secondary' : 'primary'}
                      disabled={busy || invited}
                      style={{ minHeight: 30, padding: '4px 12px', fontSize: 12 }}
                      onClick={() => void handleInviteFriendDirect(f)}
                    >
                      {invited ? '已邀请 ✓' : '+ 邀请进入'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setShareMode('collab');
                void handleGenerateShare();
              }}
            >
              🔗 生成微信 / QQ 同游邀请口令
            </button>
            {shareResult && (
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                口令已复制：{shareResult.code}
              </span>
            )}
          </div>
        </div>
      )}

      {panel === 'share' && (
        <div className="plan-collab-drawer">
          <h4>发给好友 / 分享到微信、QQ</h4>
          <div className="auth-subtabs">
            <button type="button" className={shareMode === 'copy' ? 'active' : ''} onClick={() => { setShareMode('copy'); setShareResult(null); }}>
              发送副本（对方存成独立攻略，互不影响）
            </button>
            <button type="button" className={shareMode === 'collab' ? 'active' : ''} onClick={() => { setShareMode('collab'); setShareResult(null); }}>
              邀请同游（加入行程群一起编辑）
            </button>
          </div>

          <div className="companions-search-row" style={{ marginTop: 10 }}>
            <select value={shareFriendId} onChange={(e) => setShareFriendId(e.target.value)}>
              <option value="">直接推送给站内好友…</option>
              {friends.map((f) => <option key={f.user.id} value={f.user.id}>{f.user.nickname}（{f.user.friendCode}）</option>)}
            </select>
            <button type="button" className="secondary" disabled={!shareFriendId || busy} onClick={() => void handleGenerateShare(shareFriendId)}>
              一键发给好友
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleGenerateShare()}>
              生成微信/QQ 链接与周游口令
            </button>
          </div>

          {shareResult && (
            <div className="share-result-box">
              <p><strong>已生成分享（已安装 App 可直接唤起，未安装跳下载页，微信内可复制口令识别）：</strong></p>
              <div className="token-preview">{shareResult.zhouyouToken}</div>
              <div className="companions-row-actions" style={{ marginTop: 8 }}>
                <button type="button" className="primary" onClick={() => navigator.clipboard?.writeText(shareResult.zhouyouToken).then(() => onNotice('已复制周游口令与链接')).catch(() => undefined)}>
                  复制整段发微信 / QQ
                </button>
                <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(shareResult.shareUrl).then(() => onNotice('已复制预览链接')).catch(() => undefined)}>
                  仅复制链接
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {panel === 'group' && (
        <div className="plan-collab-drawer">
          <h4>绑定行程群（群成员自动同步并共同编辑）</h4>
          <div className="companions-search-row">
            <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
              <option value="">不绑定群（仅自己可见）</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}（{g.memberCount}人）</option>)}
            </select>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleBindExistingGroup()}>保存群绑定</button>
          </div>
          <div className="companions-search-row" style={{ marginTop: 10 }}>
            <input type="text" placeholder="或自动为本行程新建一个群" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
            <button type="button" className="secondary" disabled={busy} onClick={() => void handleAutoCreateGroup()}>自动新建并绑定</button>
          </div>
        </div>
      )}

      {panel === 'collab' && (
        <div className="plan-collab-drawer">
          <h4>群内景点 / 餐厅小投票 & 留言批注</h4>
          {activityItems.length === 0 ? (
            <p className="auth-hint">当前攻略暂无行程条目。</p>
          ) : (
            <div className="collab-vote-list">
              {activityItems.map((item) => {
                const itemVotes = votes.filter((v) => v.itemKey === item.key);
                const myVote = itemVotes.find((v) => v.userId === cloudUser?.id)?.vote;
                const itemComments = comments.filter((c) => c.itemKey === item.key);
                return (
                  <div key={item.key} className="collab-vote-card">
                    <div className="collab-vote-head">
                      <span className="day-mini-badge">{item.dayLabel}</span>
                      <strong>{item.title}</strong>
                      {item.subtitle && <small>{item.subtitle}</small>}
                    </div>
                    <div className="collab-vote-buttons">
                      {(['want', 'backup', 'skip'] as const).map((vType) => {
                        const count = itemVotes.filter((v) => v.vote === vType).length;
                        return (
                          <button
                            key={vType}
                            type="button"
                            className={`chip-toggle ${myVote === vType ? 'active' : ''}`}
                            onClick={() => void handleVote(item.key, vType)}
                          >
                            {VOTE_LABELS[vType]} {count > 0 ? `(${count})` : ''}
                          </button>
                        );
                      })}
                    </div>
                    {itemComments.length > 0 && (
                      <div className="collab-comment-list">
                        {itemComments.map((c) => (
                          <div key={c.id} className="collab-comment-row">
                            <span><strong>{c.authorNickname}：</strong>{c.content}</span>
                            {c.userId === cloudUser?.id && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => void cloudApi.deletePlanComment(plan.id, c.id).then(() => setComments((prev) => prev.filter((x) => x.id !== c.id)))}
                              >
                                删
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="collab-comment-input">
                      <input
                        type="text"
                        placeholder="留一句批注（如：这家排队久，建议提前取号）"
                        value={commentDrafts[item.key] || ''}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleAddComment(item.key); }}
                      />
                      <button type="button" className="secondary" onClick={() => void handleAddComment(item.key)}>留言</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {panel === 'history' && (
        <div className="plan-collab-drawer">
          <h4>多人编辑动态 & 防误删一键回退（保留最近 20 个版本）</h4>
          {revisions.length === 0 ? (
            <p className="auth-hint">暂无历史修改记录。</p>
          ) : (
            <div className="companions-user-list">
              {revisions.map((r, idx) => (
                <div key={r.id} className="companions-user-row">
                  <div>
                    <strong>v{r.version} · {r.editorNickname}</strong>：{r.summary}
                    <small>{new Date(r.createdAt).toLocaleString('zh-CN')}</small>
                  </div>
                  {idx === 0 ? (
                    <span className="session-current-tag">当前版本</span>
                  ) : (
                    <button type="button" className="secondary" disabled={busy} onClick={() => void handleRevert(r.id, r.version)}>
                      回退到此版
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
