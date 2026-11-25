import { useEffect, useMemo, useState } from 'react';
import {
  cloudApi,
  type ChatMessage,
  type CloudSelfUser,
  type FriendItem,
  type PlanRevision,
  type TravelGroupSummary,
} from '../cloud-api';
import { getCloudPlanMetaMap, updateCloudPlanMeta } from '../cloud-sync';
import type { AiTravelPlan } from '../planner-types';
import ThemedSelect from './ThemedSelect';

interface PlanCollabBarProps {
  plan: AiTravelPlan;
  cloudUser: CloudSelfUser | null;
  onOpenAuth: () => void;
  onPlanReverted: (restored: AiTravelPlan) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onExecutePollOption?: (prompt: string) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export default function PlanCollabBar({
  plan,
  cloudUser,
  onOpenAuth,
  onPlanReverted,
  onSyncNow,
  onExecutePollOption,
  onNotice,
  onError,
}: PlanCollabBarProps) {
  const [panel, setPanel] = useState<'none' | 'invite' | 'share' | 'group' | 'collab' | 'history'>('none');
  const [invitedFriendIds, setInvitedFriendIds] = useState<Record<string, boolean>>({});
  const [groups, setGroups] = useState<TravelGroupSummary[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [groupPolls, setGroupPolls] = useState<ChatMessage[]>([]);
  const [pollsLoading, setPollsLoading] = useState(false);

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

  async function refreshGroupPolls(groupId: string) {
    setPollsLoading(true);
    try {
      const res = await cloudApi.getChatMessages('group', groupId);
      const list = (Array.isArray(res?.messages) ? res.messages : [])
        .filter((m) => m.msgType === 'poll')
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setGroupPolls(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载群投票结果失败');
    } finally {
      setPollsLoading(false);
    }
  }

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
        if (planMeta?.groupId) {
          await refreshGroupPolls(planMeta.groupId);
        } else {
          setGroupPolls([]);
        }
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

  async function handleVoteGroupPoll(messageId: string, optionId: string) {
    try {
      const res = await cloudApi.voteChatPoll(messageId, optionId);
      setGroupPolls((prev) => prev.map((m) => (m.id === messageId ? { ...m, pollVotes: res.pollVotes } : m)));
    } catch (err) {
      onError(err instanceof Error ? err.message : '投票失败');
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
        <div className="plan-collab-head">
          <span className="plan-collab-status">
            <i className={`plan-collab-dot${planMeta?.groupId ? ' is-group' : cloudUser ? ' is-cloud' : ''}`} aria-hidden="true" />
            <span className="plan-collab-status-text">
              {planMeta?.groupId
                ? `已关联「${planMeta.groupName || '同行群'}」· v${planMeta.version}`
                : cloudUser
                  ? '云端自动同步已开启'
                  : '登录后可云端同步与好友同游'}
            </span>
          </span>
          <button
            type="button"
            className={`plan-collab-invite-btn${panel === 'invite' ? ' is-active' : ''}`}
            onClick={() => void openPanel('invite')}
          >
            ＋ 邀请好友
          </button>
        </div>
        <div className="plan-collab-actions" role="group" aria-label="协作工具">
          <button
            type="button"
            className={`plan-collab-chip${panel === 'share' ? ' is-active' : ''}`}
            onClick={() => void openPanel('share')}
          >
            <span className="plan-collab-chip-ic" aria-hidden="true">↗</span>
            <span>分享口令</span>
          </button>
          <button
            type="button"
            className={`plan-collab-chip${panel === 'group' ? ' is-active' : ''}`}
            onClick={() => void openPanel('group')}
          >
            <span className="plan-collab-chip-ic" aria-hidden="true">◎</span>
            <span>行程群</span>
          </button>
          <button
            type="button"
            className={`plan-collab-chip${panel === 'collab' ? ' is-active' : ''}`}
            onClick={() => void openPanel('collab')}
          >
            <span className="plan-collab-chip-ic" aria-hidden="true">☑</span>
            <span>投票结果</span>
          </button>
          <button
            type="button"
            className={`plan-collab-chip${panel === 'history' ? ' is-active' : ''}`}
            onClick={() => void openPanel('history')}
          >
            <span className="plan-collab-chip-ic" aria-hidden="true">↺</span>
            <span>修改动态</span>
          </button>
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
            <ThemedSelect
              value={shareFriendId}
              placeholder="直接推送给站内好友…"
              title="选择接收好友"
              options={friends.map((f) => ({ value: f.user.id, label: f.user.nickname, sublabel: `好友码 ${f.user.friendCode}` }))}
              onChange={setShareFriendId}
            />
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
            <ThemedSelect
              value={selectedGroupId}
              placeholder="不绑定群（仅自己可见）"
              title="选择要绑定的行程群"
              options={[
                { value: '', label: '不绑定群（仅自己可见）' },
                ...groups.map((g) => ({ value: g.id, label: g.name, sublabel: `${g.memberCount} 人` })),
              ]}
              onChange={setSelectedGroupId}
            />
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
          <div className="ai-poll-drawer-head">
            <h4>🗳️ 群方案投票结果</h4>
            {planMeta?.groupId && (
              <button
                type="button"
                className="text-button"
                disabled={pollsLoading}
                onClick={() => void refreshGroupPolls(planMeta.groupId!)}
              >
                {pollsLoading ? '刷新中…' : '↻ 刷新票数'}
              </button>
            )}
          </div>
          {!planMeta?.groupId ? (
            <p className="auth-hint" style={{ margin: 0 }}>
              当前行程尚未关联行程群。先点击「行程群」绑定群聊后，向 AI 询问多个方案时即可一键发到群里让同伴投票，并在此查看结果。
            </p>
          ) : pollsLoading && groupPolls.length === 0 ? (
            <p className="auth-hint" style={{ margin: 0 }}>正在读取群投票结果…</p>
          ) : groupPolls.length === 0 ? (
            <p className="auth-hint" style={{ margin: 0 }}>
              群里还没有方案投票。打开下方「AI 助手」让 AI 给出多个方案后，点击回复下方的「🗳️ 发到群里投票」即可发起。
            </p>
          ) : (
            <div className="collab-vote-list">
              {groupPolls.map((poll) => {
                const opts = Array.isArray(poll.payload?.options)
                  ? (poll.payload.options as Array<{ id: string; label: string }>)
                  : [];
                const votes = poll.pollVotes || [];
                const totalVoters = new Set(votes.map((v) => v.userId)).size;
                const counts = opts.map((o) => votes.filter((v) => v.optionId === o.id).length);
                const maxVotes = Math.max(0, ...counts);
                const question = String(poll.payload?.question || '群方案投票');
                return (
                  <div key={poll.id} className="ai-poll-card">
                    <div className="ai-poll-card-head">
                      <strong>{question}</strong>
                      <small>{totalVoters} 人已投{poll.payload?.multi ? ' · 多选' : ''}</small>
                    </div>
                    <div className="ai-poll-options">
                      {opts.map((opt, idx) => {
                        const count = counts[idx] || 0;
                        const pct = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
                        const mine = votes.some((v) => v.optionId === opt.id && v.userId === cloudUser?.id);
                        const isLeader = maxVotes > 0 && count === maxVotes;
                        return (
                          <div key={opt.id} className="ai-poll-option-row">
                            <button
                              type="button"
                              className={`im-poll-opt ${mine ? 'is-voted' : ''}`}
                              onClick={() => void handleVoteGroupPoll(poll.id, opt.id)}
                            >
                              <span className="im-poll-bar" style={{ width: `${pct}%` }} />
                              <span className="im-poll-opt-text">
                                {mine ? '✓ ' : ''}{opt.label}
                                {isLeader && <em className="ai-poll-winner-tag">🏆 最多票</em>}
                              </span>
                              <span className="im-poll-opt-count">{count} 票</span>
                            </button>
                            {onExecutePollOption && (
                              <button
                                type="button"
                                className="ai-poll-exec-btn"
                                onClick={() => {
                                  setPanel('none');
                                  onExecutePollOption(`按群投票方案执行「${opt.label}」（投票主题：${question}，当前 ${count} 票），请直接修改并更新当前行程。`);
                                }}
                              >
                                AI 执行
                              </button>
                            )}
                          </div>
                        );
                      })}
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
