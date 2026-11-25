import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cloudApi,
  getCloudOrigin,
  RELATION_META,
  type ChatMessage,
  type CloudSelfUser,
  type IntimacyBond,
  type RelationType,
  type TravelGroupSummary,
} from '../cloud-api';
import type { AiTravelPlan } from '../planner-types';
import { TravelAvatar } from './CuteArt';
import { buildPackingShareData, buildTripReminderShareData } from './TripReminderShareModal';

interface ChatRoomViewProps {
  roomType: 'dm' | 'group';
  targetId: string;
  title: string;
  subtitle?: string;
  avatarId?: string;
  groupColor?: string;
  cloudUser: CloudSelfUser;
  aiPlans: AiTravelPlan[];
  groups: TravelGroupSummary[];
  intimacyBonds?: IntimacyBond[];
  /** 是否在独立视图顶部显示返回栏（群内 Tab 嵌入时可隐藏顶部栏） */
  showHeader?: boolean;
  onBack?: () => void;
  onOpenPlan: (planId: string) => void;
  onOpenShareCode: (code: string) => void;
  onRespondIntimacy?: (bondId: string, decision: 'accept' | 'reject') => Promise<void>;
  onJoinedGroup?: (groupId: string) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

const QUICK_EMOJIS = [
  '😄', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘',
  '😋', '😎', '🤩', '🥳', '🤔', '😅', '😭', '😤',
  '👍', '👏', '🙌', '🤝', '🙏', '👌', '✌️', '❤️',
  '🔥', '✨', '🎉', '🎊', '💯', '🌈', '☀️', '🌙',
  '✈️', '🚄', '🚗', '🗺️', '🧳', '🏨', '📸', '⛺',
  '🍜', '🍲', '🧋', '☕', '🍰', '串', '🍻', '🏖️',
].map((e) => (e === '串' ? '🍢' : e));

function formatMsgTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return timeStr;
  return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

async function compressChatImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('解析图片失败'));
    el.src = dataUrl;
  });
  const maxDim = 960;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.max(1, Math.round(w * ratio));
    h = Math.max(1, Math.round(h * ratio));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.78;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > 260 * 1024 && quality > 0.35) {
    quality -= 0.12;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  return out;
}

export default function ChatRoomView({
  roomType,
  targetId,
  title,
  subtitle,
  avatarId,
  groupColor,
  cloudUser,
  aiPlans,
  groups,
  intimacyBonds = [],
  showHeader = true,
  onBack,
  onOpenPlan,
  onOpenShareCode,
  onRespondIntimacy,
  onJoinedGroup,
  onNotice,
  onError,
}: ChatRoomViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [tray, setTray] = useState<'none' | 'emoji' | 'more'>('none');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // 子弹窗：发攻略 / 发群邀请 / 发起投票 / 发行前清单 / 发出行提醒
  const [pickerModal, setPickerModal] = useState<'none' | 'plan' | 'invite' | 'poll' | 'packing' | 'reminder'>('none');
  const [selectedPlanId, setSelectedPlanId] = useState(aiPlans[0]?.id || '');
  const [planMode, setPlanMode] = useState<'copy' | 'collab'>('collab');
  const [tripNoteText, setTripNoteText] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || '');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollMulti, setPollMulti] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const prevCountRef = useRef(0);
  const lastCreatedAtRef = useRef('');
  const pollIdsRef = useRef<string[]>([]);
  const fetchingRef = useRef(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const syncRefsFromMessages = useCallback((list: ChatMessage[]) => {
    const last = list[list.length - 1];
    if (last?.createdAt) lastCreatedAtRef.current = last.createdAt;
    pollIdsRef.current = list.filter((m) => m.msgType === 'poll').map((m) => m.id).slice(-20);
    prevCountRef.current = list.length;
  }, []);

  const fetchMessages = useCallback(async (silent = false) => {
    if (silent && fetchingRef.current) return;
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const useIncremental = silent && Boolean(lastCreatedAtRef.current);
      const res = await cloudApi.getChatMessages(
        roomType,
        targetId,
        useIncremental
          ? { after: lastCreatedAtRef.current, pollIds: pollIdsRef.current }
          : undefined,
      );
      const incoming = Array.isArray(res?.messages) ? res.messages : [];
      const pollUpdates = res?.pollUpdates;

      if (useIncremental && res?.incremental) {
        if (incoming.length > 0 || (pollUpdates && Object.keys(pollUpdates).length > 0)) {
          let appended = 0;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            let next = prev;
            if (pollUpdates) {
              next = next.map((m) => (
                pollUpdates[m.id] ? { ...m, pollVotes: pollUpdates[m.id] } : m
              ));
            }
            const fresh = incoming.filter((m) => !seen.has(m.id));
            if (fresh.length > 0) {
              appended = fresh.length;
              next = [...next, ...fresh];
            }
            syncRefsFromMessages(next);
            return next;
          });
          if (appended > 0) {
            setTimeout(() => scrollToBottom(true), 40);
          }
        }
      } else {
        setMessages(incoming);
        const grew = incoming.length > prevCountRef.current;
        syncRefsFromMessages(incoming);
        if (grew) {
          setTimeout(() => scrollToBottom(silent), 40);
        }
      }
    } catch (err) {
      if (!silent) onError(err instanceof Error ? err.message : '加载聊天记录失败');
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [roomType, targetId, onError, scrollToBottom, syncRefsFromMessages]);

  useEffect(() => {
    prevCountRef.current = 0;
    lastCreatedAtRef.current = '';
    pollIdsRef.current = [];
    void fetchMessages(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchMessages(true);
      }
    }, 2000);
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        void fetchMessages(true);
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [fetchMessages]);

  async function handleSendText() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    setTray('none');
    try {
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: 'text',
        textContent: text,
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setTimeout(() => scrollToBottom(true), 30);
    } catch (err) {
      setDraft(text);
      onError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage(file: File | undefined) {
    if (!file || sending) return;
    setSending(true);
    setTray('none');
    try {
      const dataUrl = await compressChatImage(file);
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: 'image',
        textContent: '[图片]',
        payload: { dataUrl },
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setTimeout(() => scrollToBottom(true), 30);
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送图片失败');
    } finally {
      setSending(false);
    }
  }

  async function handleSendPlanCard() {
    const plan = aiPlans.find((p) => p.id === selectedPlanId) || aiPlans[0];
    if (!plan) {
      onError('暂无可发送的行程攻略，请先在「行程规划」生成一份');
      return;
    }
    setSending(true);
    try {
      const share = await cloudApi.createShare({
        planId: plan.id,
        mode: planMode,
        recipientUserId: roomType === 'dm' ? targetId : undefined,
        planPayload: plan,
      });
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: 'plan',
        textContent: `分享了攻略「${plan.content.title}」`,
        payload: {
          planId: plan.id,
          shareCode: share.code,
          title: plan.content.title,
          destination: plan.content.request?.destination || '',
          daysCount: plan.content.days?.length || 0,
          mode: planMode,
        },
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setPickerModal('none');
      setTray('none');
      setTimeout(() => scrollToBottom(true), 30);
      onNotice('已发送攻略卡片到聊天');
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送攻略失败');
    } finally {
      setSending(false);
    }
  }

  async function handleSendGroupInvite() {
    const grp = groups.find((g) => g.id === selectedGroupId) || groups[0];
    if (!grp) {
      onError('还没有行程群，请先创建一个行程群');
      return;
    }
    setSending(true);
    try {
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: 'invite',
        textContent: `邀请你加入行程群「${grp.name}」`,
        payload: {
          groupId: grp.id,
          groupName: grp.name,
          inviteCode: grp.inviteCode,
          memberCount: grp.memberCount,
        },
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setPickerModal('none');
      setTray('none');
      setTimeout(() => scrollToBottom(true), 30);
      onNotice('已发送行程群邀请卡片');
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送邀请失败');
    } finally {
      setSending(false);
    }
  }

  async function handleSendTripNote(kind: 'packing' | 'reminder') {
    const plan = aiPlans.find((p) => p.id === selectedPlanId) || aiPlans[0];
    if (!plan) {
      onError('还没有可用的行程攻略');
      return;
    }
    const shareData = kind === 'packing' ? buildPackingShareData(plan) : buildTripReminderShareData(plan);
    setSending(true);
    try {
      const note = tripNoteText.trim();
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: kind,
        textContent: note || `${shareData.title}（${shareData.subtitle}）`,
        payload: {
          planId: shareData.planId,
          planTitle: shareData.planTitle,
          title: shareData.title,
          subtitle: shareData.subtitle,
          items: shareData.items.slice(0, 40),
          note,
        },
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setTripNoteText('');
      setPickerModal('none');
      setTray('none');
      setTimeout(() => scrollToBottom(true), 30);
      onNotice(kind === 'packing' ? '已发送行前准备清单并推送通知' : '已发送出行提醒并推送通知');
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  async function handleCreatePoll() {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      onError('请填写投票主题并至少填 2 个选项');
      return;
    }
    setSending(true);
    try {
      const res = await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: 'poll',
        textContent: `[投票] ${q}`,
        payload: {
          question: q,
          multi: pollMulti,
          options: opts.map((label, idx) => ({ id: `opt_${idx + 1}`, label })),
        },
      });
      setMessages((prev) => [...prev, res.message]);
      prevCountRef.current += 1;
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollMulti(false);
      setPickerModal('none');
      setTray('none');
      setTimeout(() => scrollToBottom(true), 30);
    } catch (err) {
      onError(err instanceof Error ? err.message : '发起投票失败');
    } finally {
      setSending(false);
    }
  }

  async function handleVotePoll(messageId: string, optionId: string) {
    try {
      const res = await cloudApi.voteChatPoll(messageId, optionId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pollVotes: res.pollVotes } : m)));
    } catch (err) {
      onError(err instanceof Error ? err.message : '投票失败');
    }
  }

  async function handleJoinFromInvite(inviteCode: string) {
    try {
      const res = await cloudApi.joinGroupByCode(inviteCode);
      onNotice(`已加入行程群「${res.group.name}」`);
      onJoinedGroup?.(res.group.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : '加入行程群失败');
    }
  }

  return (
    <div className="im-chat-shell">
      {showHeader && (
        <div className="im-chat-header">
          {onBack && (
            <button type="button" className="chat-back-btn" onClick={onBack}>← 返回</button>
          )}
          <div className="im-chat-peer">
            {roomType === 'dm' ? (
              <TravelAvatar avatarId={avatarId} nickname={title} className="im-header-avatar" />
            ) : (
              <span className="chat-group-avatar im-header-group-avatar" style={{ background: groupColor || '#2e8b6e' }}>
                {title.slice(0, 1)}
              </span>
            )}
            <div className="im-chat-peer-meta">
              <strong>{title}</strong>
              {subtitle && <small>{subtitle}</small>}
            </div>
          </div>
          <button
            type="button"
            className="im-header-icon-btn"
            title="刷新消息"
            aria-label="刷新消息"
            onClick={() => void fetchMessages(false)}
          >
            ↻
          </button>
        </div>
      )}

      {/* 消息流 */}
      <div className="im-chat-messages" ref={listRef} onClick={() => setTray('none')}>
        {loading && messages.length === 0 ? (
          <div className="im-chat-empty">正在加载聊天记录…</div>
        ) : messages.length === 0 ? (
          <div className="im-chat-empty">
            <span>💬</span>
            <p>打个招呼吧！可发文字、表情、照片、攻略卡片{roomType === 'group' ? '或发起群投票' : '和行程群邀请'}。</p>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isMine = m.senderId === cloudUser.id;
            const prev = messages[idx - 1];
            const showTime =
              !prev || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 5 * 60 * 1000;
            return (
              <div key={m.id} className="im-msg-block">
                {showTime && <div className="im-time-divider">{formatMsgTime(m.createdAt)}</div>}
                <div className={`im-msg-row ${isMine ? 'is-mine' : 'is-peer'}`}>
                  {!isMine && (
                    <TravelAvatar avatarId={m.senderAvatar} nickname={m.senderNickname} className="im-msg-avatar" />
                  )}
                  <div className="im-msg-col">
                    {!isMine && roomType === 'group' && (
                      <span className="im-sender-name">{m.senderNickname}</span>
                    )}

                    {/* 文本消息 */}
                    {m.msgType === 'text' && (() => {
                      const trimmed = m.textContent.trim();
                      const isEmojiOnly =
                        trimmed.length > 0
                        && trimmed.length <= 12
                        && /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]){1,3}$/u.test(trimmed);
                      return (
                        <div className={`im-bubble ${isMine ? 'is-mine' : 'is-peer'} ${isEmojiOnly ? 'is-emoji-only' : ''}`}>
                          {m.textContent}
                        </div>
                      );
                    })()}

                    {/* 图片消息（兼容新外置 imageUrl 与历史 dataUrl） */}
                    {m.msgType === 'image' && (() => {
                      const rawUrl = typeof m.payload?.imageUrl === 'string' && m.payload.imageUrl
                        ? (m.payload.imageUrl.startsWith('http') ? m.payload.imageUrl : `${getCloudOrigin()}${m.payload.imageUrl}`)
                        : (typeof m.payload?.dataUrl === 'string' ? m.payload.dataUrl : '');
                      if (!rawUrl) return null;
                      return (
                        <button
                          type="button"
                          className="im-image-bubble"
                          onClick={() => setLightboxUrl(rawUrl)}
                        >
                          <img src={rawUrl} alt="聊天图片" loading="lazy" />
                        </button>
                      );
                    })()}

                    {/* 攻略卡片 */}
                    {m.msgType === 'plan' && (
                      <div className="im-rich-card is-plan">
                        <div className="im-rich-card-badge">✈️ 旅行攻略</div>
                        <strong>{String(m.payload?.title || '旅行计划')}</strong>
                        <small>
                          {m.payload?.destination ? `${String(m.payload.destination)} · ` : ''}
                          {m.payload?.daysCount ? `${Number(m.payload.daysCount)} 天行程 · ` : ''}
                          {m.payload?.mode === 'collab' ? '邀请同游共编' : '独立攻略副本'}
                        </small>
                        <div className="im-rich-card-foot">
                          <button
                            type="button"
                            className="primary im-card-btn"
                            onClick={() => {
                              if (typeof m.payload?.shareCode === 'string' && m.payload.shareCode) {
                                onOpenShareCode(String(m.payload.shareCode));
                              } else if (typeof m.payload?.planId === 'string') {
                                onOpenPlan(String(m.payload.planId));
                              }
                            }}
                          >
                            {isMine ? '查看攻略' : '查看 / 保存到我的行程'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 亲密关系申请卡片 */}
                    {m.msgType === 'intimacy' && (() => {
                      const rt = String(m.payload?.relationType || 'couple') as RelationType;
                      const meta = RELATION_META[rt] || RELATION_META.couple;
                      const emoji = String(m.payload?.emoji || meta.emoji);
                      const label = String(m.payload?.customLabel || m.payload?.label || meta.label);
                      const anniversary = String(m.payload?.anniversaryDate || '');
                      const payloadBondId = String(m.payload?.bondId || '');
                      const matchedBond = intimacyBonds.find((b) =>
                        (payloadBondId && b.id === payloadBondId)
                        || (roomType === 'dm' && b.peer.id === targetId),
                      );
                      const isActive = matchedBond?.status === 'active';
                      const canRespond = Boolean(!isMine && matchedBond && matchedBond.status === 'pending' && matchedBond.incoming && onRespondIntimacy);
                      return (
                        <div className="im-rich-card is-intimacy">
                          <div className="im-rich-card-badge">💞 亲密关系申请</div>
                          <strong>{emoji} 邀请绑定「{label}」</strong>
                          <small>
                            {anniversary ? `纪念日：${anniversary} · ` : ''}
                            {isActive
                              ? '已成功绑定亲密关系'
                              : canRespond
                                ? '点击下方即可确认绑定'
                                : isMine
                                  ? '等待对方确认中…'
                                  : '该邀请已处理或已失效'}
                          </small>
                          {canRespond && matchedBond && (
                            <div className="im-rich-card-foot im-intimacy-foot">
                              <button
                                type="button"
                                className="primary im-card-btn"
                                onClick={() => void onRespondIntimacy?.(matchedBond.id, 'accept')}
                              >
                                同意绑定
                              </button>
                              <button
                                type="button"
                                className="secondary im-card-btn"
                                onClick={() => void onRespondIntimacy?.(matchedBond.id, 'reject')}
                              >
                                拒绝
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 邀请卡片 */}
                    {m.msgType === 'invite' && (
                      <div className="im-rich-card is-invite">
                        <div className="im-rich-card-badge">🤝 行程群邀请</div>
                        <strong>{String(m.payload?.groupName || '同行小队')}</strong>
                        <small>
                          邀请码：{String(m.payload?.inviteCode || '')}
                          {m.payload?.memberCount ? ` · 已有 ${Number(m.payload.memberCount)} 人` : ''}
                        </small>
                        <div className="im-rich-card-foot">
                          {typeof m.payload?.inviteCode === 'string' && m.payload.inviteCode && (
                            <button
                              type="button"
                              className="primary im-card-btn"
                              onClick={() => void handleJoinFromInvite(String(m.payload.inviteCode))}
                            >
                              立即加入行程群
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 行前准备清单 / 出行提醒卡片 */}
                    {(m.msgType === 'packing' || m.msgType === 'reminder') && (() => {
                      const isPacking = m.msgType === 'packing';
                      const items = Array.isArray(m.payload?.items)
                        ? (m.payload.items as Array<{ text?: string; checked?: boolean; meta?: string }>)
                        : [];
                      const note = typeof m.payload?.note === 'string' ? m.payload.note : '';
                      const planId = typeof m.payload?.planId === 'string' ? m.payload.planId : '';
                      const hasLocalPlan = Boolean(planId && aiPlans.some((p) => p.id === planId));
                      return (
                        <div className={`im-rich-card ${isPacking ? 'is-packing' : 'is-reminder'}`}>
                          <div className="im-rich-card-badge">
                            {isPacking ? '🧳 行前准备清单' : '📌 出行提醒'}
                          </div>
                          <strong>{String(m.payload?.title || (isPacking ? '行前准备清单' : '出行提醒'))}</strong>
                          {typeof m.payload?.subtitle === 'string' && m.payload.subtitle && (
                            <small>{m.payload.subtitle}</small>
                          )}
                          {note && <p className="im-trip-note-quote">{note}</p>}
                          {items.length > 0 && (
                            <ul className="im-trip-note-list">
                              {items.slice(0, 8).map((it, idx) => (
                                <li key={`${it.text || ''}-${idx}`} className={it.checked ? 'is-checked' : ''}>
                                  <span>{isPacking ? (it.checked ? '☑' : '☐') : '•'}</span>
                                  <div>
                                    <span>{String(it.text || '')}</span>
                                    {it.meta && <small>（{it.meta}）</small>}
                                  </div>
                                </li>
                              ))}
                              {items.length > 8 && (
                                <li className="im-trip-note-more">…… 共 {items.length} 项</li>
                              )}
                            </ul>
                          )}
                          {hasLocalPlan && (
                            <div className="im-rich-card-foot">
                              <button
                                type="button"
                                className="secondary im-card-btn"
                                onClick={() => onOpenPlan(planId)}
                              >
                                打开对应行程
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 群投票卡片 */}
                    {m.msgType === 'poll' && (() => {
                      const opts = Array.isArray(m.payload?.options)
                        ? (m.payload.options as Array<{ id: string; label: string }>)
                        : [];
                      const votes = m.pollVotes || [];
                      const totalVoters = new Set(votes.map((v) => v.userId)).size;
                      return (
                        <div className="im-rich-card is-poll">
                          <div className="im-rich-card-badge">
                            🗳️ 群投票 {m.payload?.multi ? '（多选）' : '（单选）'}
                          </div>
                          <strong>{String(m.payload?.question || '群投票')}</strong>
                          <div className="im-poll-options">
                            {opts.map((opt) => {
                              const optVotes = votes.filter((v) => v.optionId === opt.id);
                              const mine = optVotes.some((v) => v.userId === cloudUser.id);
                              const pct = totalVoters > 0 ? Math.round((optVotes.length / totalVoters) * 100) : 0;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  className={`im-poll-opt ${mine ? 'is-voted' : ''}`}
                                  onClick={() => void handleVotePoll(m.id, opt.id)}
                                >
                                  <span className="im-poll-bar" style={{ width: `${pct}%` }} />
                                  <span className="im-poll-opt-text">
                                    {mine ? '✓ ' : ''}{opt.label}
                                  </span>
                                  <span className="im-poll-opt-count">{optVotes.length} 票</span>
                                </button>
                              );
                            })}
                          </div>
                          <small className="im-poll-foot">
                            共 {totalVoters} 人参与 · 点击选项即可投票或改票
                          </small>
                        </div>
                      );
                    })()}
                  </div>
                  {isMine && (
                    <TravelAvatar avatarId={cloudUser.avatar} nickname={cloudUser.nickname} className="im-msg-avatar" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部输入栏（微信 / QQ / 抖音风格） */}
      <div className="im-composer">
        <button
          type="button"
          className={`im-tool-icon-btn ${tray === 'emoji' ? 'is-active' : ''}`}
          title="表情"
          onClick={() => setTray((t) => (t === 'emoji' ? 'none' : 'emoji'))}
        >
          😊
        </button>
        <input
          type="text"
          className="im-input"
          placeholder={`发消息给 ${title}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setTray('none')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSendText();
            }
          }}
        />
        <button
          type="button"
          className={`im-tool-icon-btn ${tray === 'more' ? 'is-active' : ''}`}
          title="更多功能（拍照、发攻略、投票）"
          onClick={() => setTray((t) => (t === 'more' ? 'none' : 'more'))}
        >
          ＋
        </button>
        <button
          type="button"
          className="primary im-send-btn"
          disabled={sending || !draft.trim()}
          onClick={() => void handleSendText()}
        >
          发送
        </button>
      </div>

      {/* 表情面板 */}
      {tray === 'emoji' && (
        <div className="im-emoji-tray">
          {QUICK_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className="im-emoji-btn"
              onClick={() => setDraft((prev) => prev + em)}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {/* 「+」扩展功能面板 */}
      {tray === 'more' && (
        <div className="im-more-tray">
          <button type="button" className="im-more-item" onClick={() => cameraInputRef.current?.click()}>
            <span>📷</span>
            <small>拍照</small>
          </button>
          <button type="button" className="im-more-item" onClick={() => albumInputRef.current?.click()}>
            <span>🖼️</span>
            <small>相册</small>
          </button>
          <button
            type="button"
            className="im-more-item"
            onClick={() => {
              setSelectedPlanId(aiPlans[0]?.id || '');
              setPickerModal('plan');
            }}
          >
            <span>✈️</span>
            <small>发攻略</small>
          </button>
          <button
            type="button"
            className="im-more-item"
            onClick={() => {
              setSelectedPlanId(aiPlans[0]?.id || '');
              setTripNoteText('');
              setPickerModal('packing');
            }}
          >
            <span>🧳</span>
            <small>行前清单</small>
          </button>
          <button
            type="button"
            className="im-more-item"
            onClick={() => {
              setSelectedPlanId(aiPlans[0]?.id || '');
              setTripNoteText('');
              setPickerModal('reminder');
            }}
          >
            <span>📌</span>
            <small>出行提醒</small>
          </button>
          {roomType === 'dm' && (
            <button
              type="button"
              className="im-more-item"
              onClick={() => {
                setSelectedGroupId(groups[0]?.id || '');
                setPickerModal('invite');
              }}
            >
              <span>👥</span>
              <small>邀进群</small>
            </button>
          )}
          {roomType === 'group' && (
            <button type="button" className="im-more-item" onClick={() => setPickerModal('poll')}>
              <span>🗳️</span>
              <small>群投票</small>
            </button>
          )}
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void handlePickImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handlePickImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* 图片大图预览 */}
      {lightboxUrl && (
        <div className="dialog-backdrop" onClick={() => setLightboxUrl(null)}>
          <div className="im-lightbox" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxUrl} alt="大图预览" />
            <button type="button" className="secondary" onClick={() => setLightboxUrl(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* 发攻略弹窗 */}
      {pickerModal === 'plan' && (
        <div className="dialog-backdrop" onClick={() => setPickerModal('none')}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>✈️ 发送攻略到聊天</h3>
            {aiPlans.length === 0 ? (
              <p className="muted">还没有 AI 攻略，请先去「行程规划」生成一份。</p>
            ) : (
              <>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  style={{ width: '100%', marginBottom: 10 }}
                >
                  {aiPlans.map((p) => (
                    <option key={p.id} value={p.id}>{p.content.title}</option>
                  ))}
                </select>
                <div className="auth-subtabs" style={{ marginBottom: 12 }}>
                  <button type="button" className={planMode === 'collab' ? 'active' : ''} onClick={() => setPlanMode('collab')}>
                    邀请同游共编
                  </button>
                  <button type="button" className={planMode === 'copy' ? 'active' : ''} onClick={() => setPlanMode('copy')}>
                    发送独立副本
                  </button>
                </div>
              </>
            )}
            <div className="dialog-actions">
              {aiPlans.length > 0 && (
                <button type="button" className="primary" disabled={sending} onClick={() => void handleSendPlanCard()}>
                  {sending ? '发送中…' : '发送攻略卡片'}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setPickerModal('none')}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 发行前清单 / 出行提醒弹窗 */}
      {(pickerModal === 'packing' || pickerModal === 'reminder') && (
        <div className="dialog-backdrop" onClick={() => setPickerModal('none')}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {pickerModal === 'packing' ? '🧳 发送行前准备清单' : '📌 发送出行提醒'}
            </h3>
            {aiPlans.length === 0 ? (
              <p className="muted">还没有 AI 攻略，请先去「行程规划」生成一份。</p>
            ) : (
              <>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  style={{ width: '100%', marginBottom: 10 }}
                >
                  {aiPlans.map((p) => (
                    <option key={p.id} value={p.id}>{p.content.title}</option>
                  ))}
                </select>
                <input
                  type="text"
                  maxLength={120}
                  placeholder={pickerModal === 'packing' ? '可选附言：出发前一起核对行李清单～' : '可选附言：记得提前抢票与关注天气～'}
                  value={tripNoteText}
                  onChange={(e) => setTripNoteText(e.target.value)}
                  style={{ width: '100%', marginBottom: 12 }}
                />
              </>
            )}
            <div className="dialog-actions">
              {aiPlans.length > 0 && (
                <button
                  type="button"
                  className="primary"
                  disabled={sending}
                  onClick={() => void handleSendTripNote(pickerModal)}
                >
                  {sending ? '发送中…' : pickerModal === 'packing' ? '发送清单卡片' : '发送出行提醒'}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setPickerModal('none')}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 发群邀请弹窗 */}
      {pickerModal === 'invite' && (
        <div className="dialog-backdrop" onClick={() => setPickerModal('none')}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>👥 邀请加入行程群</h3>
            {groups.length === 0 ? (
              <p className="muted">你还没有行程群，先在「行程群」创建一个吧。</p>
            ) : (
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                style={{ width: '100%', marginBottom: 12 }}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}（{g.memberCount}人）</option>
                ))}
              </select>
            )}
            <div className="dialog-actions">
              {groups.length > 0 && (
                <button type="button" className="primary" disabled={sending} onClick={() => void handleSendGroupInvite()}>
                  {sending ? '发送中…' : '发送入群邀请'}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setPickerModal('none')}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 发起群投票弹窗 */}
      {pickerModal === 'poll' && (
        <div className="dialog-backdrop" onClick={() => setPickerModal('none')}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>🗳️ 发起群聊投票</h3>
            <input
              type="text"
              placeholder="投票主题（如：第一天晚上吃什么？）"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
              {pollOptions.map((opt, i) => (
                <input
                  key={i}
                  type="text"
                  placeholder={`选项 ${i + 1}`}
                  value={opt}
                  onChange={(e) => setPollOptions((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                />
              ))}
            </div>
            {pollOptions.length < 6 && (
              <button
                type="button"
                className="text-button"
                style={{ marginBottom: 8 }}
                onClick={() => setPollOptions((prev) => [...prev, ''])}
              >
                ＋ 添加选项
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" checked={pollMulti} onChange={(e) => setPollMulti(e.target.checked)} />
              允许多人多选
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" disabled={sending} onClick={() => void handleCreatePoll()}>
                {sending ? '发布中…' : '发布投票'}
              </button>
              <button type="button" className="secondary" onClick={() => setPickerModal('none')}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
