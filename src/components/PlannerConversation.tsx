import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiTravelPlan, PlannerContent, PlannerMessage, XhsReference } from '../planner-types';
import { isExecutablePlannerSuggestion, plannerSuggestions } from '../planner-domain';
import { plannerDisplayText, splitAnswerLinks } from '../planner-display';
import {
  EXTERNAL_FREE_AI_APPS,
  buildExternalAiEditPrompt,
  previewExternalAiEdit,
  type ExternalAiEditPreview,
} from '../planner-external-ai';
import { cloudApi, type ChatMessage, type CloudSelfUser } from '../cloud-api';
import { getCloudPlanMetaMap } from '../cloud-sync';
import RichAiText from './RichAiText';

interface PlannerConversationProps {
  plan: AiTravelPlan;
  open: boolean;
  onToggle: () => void;
  scopeId: string | null;
  message: string;
  busy: boolean;
  onScopeChange: (id: string | null) => void;
  onMessageChange: (text: string) => void;
  onSend: () => void;
  onApplySuggestion: (messageId: string, suggestionId: string) => void;
  onApplyExternalEdit?: (nextContent: PlannerContent, summary: string) => Promise<void> | void;
  onConfigureAi: () => void;
  aiLabel?: string;
  attachedRefs?: XhsReference[];
  onOpenXhsAttach?: (initialFiles?: File[]) => void;
  onRemoveAttachedRef?: (refId: string) => void;
  cloudUser?: CloudSelfUser | null;
  onExecutePollOption?: (prompt: string) => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
}

interface PollDraftOption {
  label: string;
  suggestionId?: string;
}

/** 从 AI 回复中提取候选方案选项（优先结构化建议，其次识别文本中的「方案A/1.」等条目）。 */
function extractPollOptionsFromMessage(item: PlannerMessage, plan: AiTravelPlan): PollDraftOption[] {
  const structured = plannerSuggestions(item);
  if (structured.length >= 2) {
    return structured.slice(0, 6).map((s) => ({
      label: `方案 ${s.label}：${plannerDisplayText(s.title, plan.content)}`.slice(0, 60),
      suggestionId: s.id,
    }));
  }
  const lines = plannerDisplayText(item.text, plan.content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: PollDraftOption[] = [];
  for (const line of lines) {
    const m = line.match(/^(?:[#*\-\s]*)(?:方案\s*[A-Za-z一二三四五1-6]|选项\s*[A-Za-z1-6]|[1-6][\.、\)）])\s*[:：\-—]?\s*(.+)$/);
    if (m && m[1]) {
      const cleaned = m[1].replace(/\*\*/g, '').replace(/[。；;]+$/, '').trim().slice(0, 60);
      if (cleaned.length >= 2 && !candidates.some((c) => c.label === cleaned)) {
        candidates.push({ label: cleaned });
      }
    }
    if (candidates.length >= 6) break;
  }
  if (candidates.length >= 2) return candidates;
  if (structured.length === 1) {
    return [
      { label: `方案 ${structured[0].label}：${plannerDisplayText(structured[0].title, plan.content)}`.slice(0, 60), suggestionId: structured[0].id },
      { label: '维持当前安排不变' },
    ];
  }
  return [{ label: '方案一' }, { label: '方案二' }];
}

/** Keep the conversation above the long itinerary on every screen size.
 * Suggestions are visible, version-bound proposals: displaying an answer never
 * applies it, and an old or locked proposal cannot be submitted accidentally.
 */
export default function PlannerConversation({
  plan,
  open,
  onToggle,
  scopeId,
  message,
  busy,
  onScopeChange,
  onMessageChange,
  onSend,
  onApplySuggestion,
  onApplyExternalEdit,
  onConfigureAi,
  aiLabel = '',
  attachedRefs = [],
  onOpenXhsAttach,
  onRemoveAttachedRef,
  cloudUser = null,
  onExecutePollOption,
  onNotice,
  onError,
}: PlannerConversationProps) {
  const transcript = useRef<HTMLDivElement>(null);
  const activities = plan.content.days.flatMap((day) => day.activities);
  const selected = activities.find((activity) => activity.id === scopeId);
  const contentVersion = plan.contentVersion ?? plan.version;

  const planMeta = useMemo(() => getCloudPlanMetaMap()[plan.id] || null, [plan.id, open, plan.version]);
  const groupId = planMeta?.groupId || '';
  const groupName = planMeta?.groupName || '行程群';
  const canGroupPoll = Boolean(groupId && cloudUser);

  const [groupPolls, setGroupPolls] = useState<ChatMessage[]>([]);
  const [pollsBusy, setPollsBusy] = useState(false);
  const [pollEditor, setPollEditor] = useState<{
    sourceMessageId: string;
    question: string;
    options: PollDraftOption[];
    multi: boolean;
  } | null>(null);
  const [sendingPoll, setSendingPoll] = useState(false);

  // 「对话修改」 vs 「外部 AI 修改」模式切换
  const [panelMode, setPanelMode] = useState<'chat' | 'external'>('chat');
  const [extHint, setExtHint] = useState('');
  const [extCopied, setExtCopied] = useState(false);
  const [extRawText, setExtRawText] = useState('');
  const [extParsing, setExtParsing] = useState(false);
  const [extError, setExtError] = useState('');
  const [extPreview, setExtPreview] = useState<ExternalAiEditPreview | null>(null);
  const [extApplying, setExtApplying] = useState(false);

  // 切换行程时清空外部 AI 草稿与预览，防止串计划
  useEffect(() => {
    setExtPreview(null);
    setExtRawText('');
    setExtError('');
    setExtCopied(false);
  }, [plan.id]);

  const extPromptPreviewLen = useMemo(
    () => buildExternalAiEditPrompt(plan, extHint).length,
    [plan, extHint],
  );

  async function handleCopyExternalEditPrompt() {
    const promptText = buildExternalAiEditPrompt(plan, extHint);
    try {
      await navigator.clipboard.writeText(promptText);
      setExtCopied(true);
      onNotice?.('已复制当前行程与修改提示词，去豆包 / DeepSeek / Kimi 粘贴聊聊吧');
      window.setTimeout(() => setExtCopied(false), 2600);
    } catch {
      // 兼容不支持 clipboard API 的环境
      try {
        const ta = document.createElement('textarea');
        ta.value = promptText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setExtCopied(true);
        onNotice?.('已复制当前行程与修改提示词');
        window.setTimeout(() => setExtCopied(false), 2600);
      } catch {
        onError?.('复制失败，请检查剪贴板权限');
      }
    }
  }

  async function handlePreviewExternalEdit() {
    setExtError('');
    setExtParsing(true);
    try {
      const preview = await previewExternalAiEdit(extRawText, plan);
      setExtPreview(preview);
    } catch (err) {
      setExtPreview(null);
      setExtError(err instanceof Error ? err.message : '解析外部 AI 回复失败');
    } finally {
      setExtParsing(false);
    }
  }

  async function handleConfirmExternalEdit() {
    if (!extPreview || !onApplyExternalEdit || extApplying) return;
    setExtApplying(true);
    try {
      await onApplyExternalEdit(extPreview.content, extPreview.summary);
      setExtPreview(null);
      setExtRawText('');
      setExtHint('');
      setExtError('');
      setPanelMode('chat');
    } catch (err) {
      setExtError(err instanceof Error ? err.message : '应用外部 AI 修改失败');
    } finally {
      setExtApplying(false);
    }
  }

  const fetchGroupPolls = useCallback(async () => {
    if (!groupId || !cloudUser) {
      setGroupPolls([]);
      return;
    }
    setPollsBusy(true);
    try {
      const res = await cloudApi.getChatMessages('group', groupId);
      const list = (Array.isArray(res?.messages) ? res.messages : [])
        .filter((m) => m.msgType === 'poll')
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setGroupPolls(list);
    } catch {
      /* 静默失败，避免打断 AI 对话 */
    } finally {
      setPollsBusy(false);
    }
  }, [groupId, cloudUser]);

  useEffect(() => {
    if (open && canGroupPoll) {
      void fetchGroupPolls();
    }
  }, [open, canGroupPoll, fetchGroupPolls]);

  useEffect(() => {
    // 收起期间收到的回复，在下次展开后滚动到最新消息。
    const element = transcript.current;
    if (open && element) element.scrollTop = element.scrollHeight;
  }, [open, plan.id, plan.messages.length]);

  function openPollComposer(item: PlannerMessage, idx: number) {
    const prevUser = [...plan.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    const defaultQuestion = prevUser
      ? `${prevUser.text.trim().slice(0, 36)}（选个方案）`
      : `${plan.content.title || '行程'} · 方案投票`;
    setPollEditor({
      sourceMessageId: item.id,
      question: defaultQuestion,
      options: extractPollOptionsFromMessage(item, plan),
      multi: false,
    });
  }

  async function handlePublishGroupPoll() {
    if (!pollEditor || !groupId || sendingPoll) return;
    const question = pollEditor.question.trim();
    const cleaned = pollEditor.options
      .map((o) => ({ label: o.label.trim(), suggestionId: o.suggestionId }))
      .filter((o) => o.label.length > 0);
    if (!question || cleaned.length < 2) {
      onError?.('请填写投票主题，并至少保留 2 个有效方案选项');
      return;
    }
    setSendingPoll(true);
    try {
      const options = cleaned.map((o, i) => ({
        id: `opt_${i + 1}`,
        label: o.label,
        ...(o.suggestionId ? { suggestionId: o.suggestionId } : {}),
      }));
      const res = await cloudApi.sendChatMessage('group', groupId, {
        msgType: 'poll',
        textContent: `发起方案投票：${question}`,
        payload: {
          question,
          options,
          multi: pollEditor.multi,
          planId: plan.id,
          sourceMessageId: pollEditor.sourceMessageId,
        },
      });
      setGroupPolls((prev) => [res.message, ...prev]);
      setPollEditor(null);
      onNotice?.(`已发送到行程群「${groupName}」发起投票`);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '发送到群投票失败');
    } finally {
      setSendingPoll(false);
    }
  }

  function renderPollResultCard(poll: ChatMessage, sourceMessage?: PlannerMessage) {
    const opts = Array.isArray(poll.payload?.options)
      ? (poll.payload.options as Array<{ id: string; label: string; suggestionId?: string }>)
      : [];
    const votes = poll.pollVotes || [];
    const totalVoters = new Set(votes.map((v) => v.userId)).size;
    const counts = opts.map((o) => votes.filter((v) => v.optionId === o.id).length);
    const maxVotes = Math.max(0, ...counts);
    const question = String(poll.payload?.question || '群方案投票');
    const sourceSuggestions = sourceMessage ? plannerSuggestions(sourceMessage) : [];

    return (
      <div key={poll.id} className="ai-poll-card">
        <div className="ai-poll-card-head">
          <span>
            <strong>🗳️ {question}</strong>
            <small> · 群「{groupName}」{totalVoters} 人已投</small>
          </span>
          <button
            type="button"
            className="text-button"
            disabled={pollsBusy}
            onClick={() => void fetchGroupPolls()}
          >
            {pollsBusy ? '…' : '↻ 刷新'}
          </button>
        </div>
        <div className="ai-poll-options">
          {opts.map((opt, idx) => {
            const count = counts[idx] || 0;
            const pct = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
            const isLeader = maxVotes > 0 && count === maxVotes;
            const matchedSuggestion = opt.suggestionId
              ? sourceSuggestions.find((s) => s.id === opt.suggestionId)
              : undefined;
            const canDirectApply = Boolean(
              sourceMessage
              && matchedSuggestion
              && !matchedSuggestion.appliedAt
              && matchedSuggestion.baseContentVersion === contentVersion
              && isExecutablePlannerSuggestion(matchedSuggestion),
            );

            return (
              <div key={opt.id} className="ai-poll-option-row">
                <div className={`ai-poll-bar-box${isLeader ? ' is-leader' : ''}`}>
                  <span className="im-poll-bar" style={{ width: `${pct}%` }} />
                  <span className="im-poll-opt-text">
                    {opt.label}
                    {isLeader && <em className="ai-poll-winner-tag">🏆 最多票</em>}
                  </span>
                  <span className="im-poll-opt-count">{count} 票</span>
                </div>
                <button
                  type="button"
                  className="ai-poll-exec-btn"
                  disabled={busy}
                  onClick={() => {
                    if (canDirectApply && sourceMessage && matchedSuggestion?.id) {
                      onApplySuggestion(sourceMessage.id, matchedSuggestion.id);
                    } else if (onExecutePollOption) {
                      onExecutePollOption(`按群投票结果执行方案「${opt.label}」（投票主题：${question}，当前 ${count} 票），请直接修改并更新当前行程。`);
                    }
                  }}
                >
                  执行
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section
      className="card planner-chat planner-chat-top"
      id="planner-conversation"
      aria-label="AI 行程对话"
    >
      <div className="planner-chat-heading">
        <h2>
          <button className="planner-chat-toggle" type="button" aria-expanded={open}
            aria-controls="planner-conversation-body" onClick={onToggle}>
            <span className="planner-chat-chevron" aria-hidden="true" />
            AI 助手
          </button>
        </h2>
        <div className="planner-chat-tools">
          {open && <span className="planner-lock-count">
            {activities.filter((activity) => activity.locked).length} 项已锁定
          </span>}
          <button className="secondary planner-ai-config" type="button" onClick={onConfigureAi} title="配置或切换 AI">
            {aiLabel ? <>⚙ {aiLabel}<span className="planner-ai-config-ok"> · 已配置</span></> : '⚙ 配置 AI'}
          </button>
        </div>
      </div>
      <div id="planner-conversation-body" hidden={!open}>
        {onApplyExternalEdit && (
          <div className="planner-ai-mode-bar" role="tablist" aria-label="修改方式">
            <button
              type="button"
              role="tab"
              aria-selected={panelMode === 'chat'}
              className={`planner-ai-mode-pill${panelMode === 'chat' ? ' is-active' : ''}`}
              onClick={() => setPanelMode('chat')}
            >
              ✦ 对话修改
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panelMode === 'external'}
              className={`planner-ai-mode-pill${panelMode === 'external' ? ' is-active' : ''}`}
              onClick={() => setPanelMode('external')}
            >
              📋 外部 AI 修改
              <span className="planner-ai-mode-badge">免额度</span>
            </button>
          </div>
        )}

        {panelMode === 'external' && onApplyExternalEdit ? (
          <div className="ext-edit-panel">
            <p className="ext-edit-intro">
              额度用完或想在外部 AI 里慢慢聊细节？复制当前精简行程发给它，聊妥后按格式粘贴回这里，自动保留已有图片与历史撤销。
            </p>

            <div className="ext-edit-step">
              <div className="ext-edit-step-head">
                <span className="ext-edit-step-num">1</span>
                <strong>复制当前行程 + 修改提示词</strong>
                <span className="ext-edit-step-meta">约 {(extPromptPreviewLen / 1000).toFixed(1)}k 字 · 已精简图片</span>
              </div>
              <input
                type="text"
                className="ext-edit-hint-input"
                value={extHint}
                onChange={(e) => setExtHint(e.target.value)}
                placeholder="选填修改方向：如“第2天下午太赶，加个咖啡馆，晚上换本地烧烤”"
              />
              <div className="ext-edit-copy-row">
                <button
                  type="button"
                  className={`primary ext-edit-copy-btn${extCopied ? ' is-copied' : ''}`}
                  onClick={() => void handleCopyExternalEditPrompt()}
                >
                  {extCopied ? '✓ 已复制当前行程与提示词' : '📋 一键复制当前行程 + 提示词'}
                </button>
                <div className="ext-edit-app-links" aria-label="常用免费外部 AI">
                  {EXTERNAL_FREE_AI_APPS.map((app) => (
                    <a
                      key={app.id}
                      className="ext-edit-app-chip"
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={app.hint}
                    >
                      {app.name} ↗
                    </a>
                  ))}
                </div>
              </div>
            </div>

            <div className="ext-edit-step">
              <div className="ext-edit-step-head">
                <span className="ext-edit-step-num">2</span>
                <strong>粘贴外部 AI 回复的 JSON</strong>
                {extRawText.trim() && (
                  <button
                    type="button"
                    className="text-button ext-edit-clear-btn"
                    onClick={() => {
                      setExtRawText('');
                      setExtPreview(null);
                      setExtError('');
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <textarea
                className="ext-edit-textarea"
                rows={4}
                value={extRawText}
                onChange={(e) => {
                  setExtRawText(e.target.value);
                  if (extPreview) setExtPreview(null);
                  if (extError) setExtError('');
                }}
                placeholder="和外部 AI 聊好后，把它回复的完整内容（含 ```json ... ```）粘贴到这里…"
              />
              {extError && <p className="ext-edit-error" role="alert">⚠ {extError}</p>}
              <div className="ext-edit-actions">
                <button
                  type="button"
                  className="secondary ext-edit-preview-btn"
                  disabled={busy || extParsing || !extRawText.trim()}
                  onClick={() => void handlePreviewExternalEdit()}
                >
                  {extParsing ? '正在解析对比…' : '🔍 预览修改差异'}
                </button>
              </div>
            </div>

            {extPreview && (
              <div className="ext-edit-preview-card">
                <div className="ext-edit-preview-head">
                  <div className="ext-edit-preview-title">
                    <span className="ext-edit-mode-tag">
                      {extPreview.mode === 'patch_days' ? '按天局部修改' : '整份行程更新'}
                    </span>
                    <strong>{extPreview.summary}</strong>
                  </div>
                  <span className={`ext-edit-delta-pill${extPreview.budgetDeltaCents > 0 ? ' is-up' : extPreview.budgetDeltaCents < 0 ? ' is-down' : ''}`}>
                    {extPreview.budgetDeltaCents === 0
                      ? '预算不变'
                      : `预算 ${extPreview.budgetDeltaCents > 0 ? '+' : '-'}¥${Math.round(Math.abs(extPreview.budgetDeltaCents) / 100)}`}
                  </span>
                </div>

                {extPreview.lockedWarnings.length > 0 && (
                  <div className="ext-edit-lock-warn">
                    <strong>⚠ 锁定条目提醒：</strong>
                    {extPreview.lockedWarnings.join('；')}（应用后仍可在「历史撤销」一键恢复）
                  </div>
                )}

                {extPreview.changedDays.length > 0 ? (
                  <div className="ext-edit-diff-list">
                    {extPreview.changedDays.map((d) => (
                      <div key={d.dayNumber} className="ext-edit-diff-day">
                        <div className="ext-edit-diff-day-head">
                          <strong>第 {d.dayNumber} 天</strong>
                          {d.date && <small>{d.date.slice(5)}</small>}
                          <span className="ext-edit-diff-kept">保留 {d.kept} 项</span>
                        </div>
                        <div className="ext-edit-diff-chips">
                          {d.added.map((t, i) => (
                            <span key={`add-${i}`} className="ext-diff-chip is-add">＋ {t}</span>
                          ))}
                          {d.removed.map((t, i) => (
                            <span key={`rm-${i}`} className="ext-diff-chip is-remove">－ {t}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ext-edit-diff-empty">已更新行程时间、描述或费用细节（景点名称未增减）。</p>
                )}

                <div className="ext-edit-confirm-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || extApplying}
                    onClick={() => void handleConfirmExternalEdit()}
                  >
                    {extApplying ? '正在应用…' : '✓ 确认应用到当前行程'}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={extApplying}
                    onClick={() => setExtPreview(null)}
                  >
                    取消预览
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
        {plan.messages.length > 0 && (
          <div className="planner-chat-messages" ref={transcript} aria-live="polite">
            {plan.messages.map((item, idx) => {
              const linkedPolls = canGroupPoll
                ? groupPolls.filter((p) => p.payload?.sourceMessageId === item.id)
                : [];
              return (
                <div key={item.id} className={`planner-message ${item.role}`}>
                  <small>
                    {item.role === 'user'
                      ? '你'
                      : item.kind === 'revision'
                        ? '旅行助手 · 已修改，可撤销'
                        : '旅行助手 · 建议与回答'}
                  </small>
                  {(() => {
                    // 助手回答里的网址单独列为“相关链接”，在新窗口打开，手机和电脑都可直接点。
                    const text = plannerDisplayText(item.text, plan.content);
                    if (item.role !== 'assistant') return <>
                      {item.attachments && item.attachments.length > 0 && (
                        <div className="xhs-msg-attachments">
                          {item.attachments.map((att, idx) => (
                            <span className="xhs-msg-attachment-chip" key={`${att.title}-${idx}`}>
                              <span>📎</span>
                              {att.url ? (
                                <a href={att.url} target="_blank" rel="noopener noreferrer">{att.title}</a>
                              ) : (
                                <strong>{att.title}</strong>
                              )}
                              {att.placeNames.length > 0 && (
                                <small>· {att.placeNames.slice(0, 4).join('、')}{att.placeNames.length > 4 ? ` 等${att.placeNames.length}处` : ''}</small>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <p>{text}</p>
                    </>;
                    const { body, links } = splitAnswerLinks(text);
                    return <>
                      <RichAiText text={body} />
                      {links.length > 0 && <div className="planner-links">
                        <strong>相关链接</strong>
                        <ul>
                          {links.map((link) => <li key={link.url}>
                            <a href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>
                            <small>{link.host}</small>
                          </li>)}
                        </ul>
                      </div>}
                    </>;
                  })()}
                  {item.role === 'assistant' && plannerSuggestions(item).map((suggestion) => {
                    const locked = activities.find((activity) => activity.id === suggestion.scopeId)?.locked;
                    const stale = suggestion.baseContentVersion !== contentVersion;
                    const ambiguous = !isExecutablePlannerSuggestion(suggestion);
                    return <div className="planner-chat-suggestion" key={suggestion.id}>
                      <strong>方案 {suggestion.label} · {plannerDisplayText(suggestion.title, plan.content)}</strong>
                      <p>{plannerDisplayText(suggestion.instruction, plan.content)}</p>
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          Boolean(suggestion.appliedAt) ||
                          Boolean(locked) ||
                          Boolean(stale) ||
                          Boolean(ambiguous)
                        }
                        onClick={() => onApplySuggestion(item.id, suggestion.id!)}
                      >
                        {suggestion.appliedAt ? '已实施' : '实施计划'}
                      </button>
                      {!suggestion.appliedAt && locked && (
                        <small>目标已锁定，请先解锁后重新询问。</small>
                      )}
                      {!suggestion.appliedAt && !locked && stale && (
                        <small>行程已更新，请重新询问后再应用。</small>
                      )}
                      {!suggestion.appliedAt && ambiguous && (
                        <small>这条建议还有未确定的选项，请先明确一种方案。</small>
                      )}
                    </div>;
                  })}
                  {item.role === 'assistant' && canGroupPoll && (
                    <div className="ai-poll-trigger-row">
                      <button
                        type="button"
                        className="ai-poll-send-btn"
                        disabled={busy}
                        onClick={() => openPollComposer(item, idx)}
                      >
                        🗳️ 发到群「{groupName}」投票
                      </button>
                    </div>
                  )}
                  {linkedPolls.length > 0 && (
                    <div className="ai-poll-linked-list">
                      {linkedPolls.map((poll) => renderPollResultCard(poll, item))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && message.trim()) onSend();
          }}
        >
          <label>
            修改范围
            <select
              aria-label="修改范围"
              disabled={busy}
              value={scopeId ?? ''}
              onChange={(event) => onScopeChange(event.target.value || null)}
            >
              <option value="">全程 / 普通问答</option>
              {plan.content.days.flatMap((day) =>
                day.activities.map((activity) => (
                  <option disabled={activity.locked} key={activity.id} value={activity.id}>
                    {day.date.slice(5)} {plannerDisplayText(activity.title, plan.content)}
                    {activity.locked ? '（已锁定）' : ''}
                  </option>
                )),
              )}
            </select>
          </label>
          {selected && (
            <div className="planner-banner">当前仅允许修改：{plannerDisplayText(selected.title, plan.content)}及直接相邻交通</div>
          )}
          <div className="xhs-composer-header">
            <label htmlFor="planner-chat-input">问题或修改要求</label>
            {onOpenXhsAttach && (
              <button
                type="button"
                className="text-button xhs-attach-btn"
                disabled={busy}
                onClick={() => onOpenXhsAttach()}
              >
                📎 附小红书链接 / 截图
              </button>
            )}
          </div>
          {attachedRefs.length > 0 && (
            <div className="xhs-chat-attachments">
              {attachedRefs.map((ref) => {
                const count = ref.places.filter((p) => p.selected).length;
                return (
                  <span className="xhs-attach-chip" key={ref.id}>
                    <span>📎 {ref.title}</span>
                    <small>{count} 个地点</small>
                    {onRemoveAttachedRef && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`移除参考 ${ref.title}`}
                        onClick={() => onRemoveAttachedRef(ref.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div
            className="planner-chat-composer"
            onDragOver={(event) => {
              if (onOpenXhsAttach && Array.from(event.dataTransfer.types).includes('Files')) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (!onOpenXhsAttach || busy) return;
              const imageFiles = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
              if (imageFiles.length) {
                event.preventDefault();
                onOpenXhsAttach(imageFiles);
              }
            }}
          >
            <textarea
              id="planner-chat-input"
              rows={3}
              disabled={busy}
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              onPaste={(event) => {
                if (!onOpenXhsAttach || busy) return;
                const items = event.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (const item of items) {
                  if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                  }
                }
                if (files.length) {
                  event.preventDefault();
                  onOpenXhsAttach(files);
                }
              }}
              onKeyDown={(event) => {
                // 回车发送；Shift+回车换行；输入法选字时的回车不发送。
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (!busy && message.trim()) onSend();
              }}
              placeholder="例如：如果第二天早上休息怎么样？／直接 Ctrl+V 粘贴小红书截图或点右上角附笔记对比改计划。（回车发送，Shift+回车换行）"
            />
            <button className="primary" type="submit" disabled={busy || !message.trim()}>
              发送
            </button>
          </div>
        </form>
          </>
        )}
      </div>

      {pollEditor && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setPollEditor(null)}>
          <div className="dialog ai-poll-editor-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>🗳️ 发到群「{groupName}」方案投票</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
              已为你自动整理方案选项，可自由修改、增删选项后发到群里让同伴投票；结果会直接回显在 AI 对话中，随时点「执行」即可落实。
            </p>
            <input
              type="text"
              className="ai-poll-question-input"
              placeholder="投票主题（如：第二天下午去哪里玩？）"
              value={pollEditor.question}
              onChange={(e) => setPollEditor((prev) => (prev ? { ...prev, question: e.target.value } : prev))}
            />
            <div className="ai-poll-editor-list">
              {pollEditor.options.map((opt, idx) => (
                <div key={idx} className="ai-poll-editor-row">
                  <input
                    type="text"
                    placeholder={`方案选项 ${idx + 1}`}
                    value={opt.label}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPollEditor((prev) => (prev
                        ? {
                            ...prev,
                            options: prev.options.map((o, i) => (i === idx ? { label: val, suggestionId: val === o.label ? o.suggestionId : undefined } : o)),
                          }
                        : prev));
                    }}
                  />
                  {pollEditor.options.length > 2 && (
                    <button
                      type="button"
                      className="text-button"
                      aria-label="删除选项"
                      onClick={() => setPollEditor((prev) => (prev
                        ? { ...prev, options: prev.options.filter((_, i) => i !== idx) }
                        : prev))}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pollEditor.options.length < 6 && (
              <button
                type="button"
                className="text-button"
                style={{ marginBottom: 8 }}
                onClick={() => setPollEditor((prev) => (prev
                  ? { ...prev, options: [...prev.options, { label: '' }] }
                  : prev))}
              >
                ＋ 添加方案选项
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={pollEditor.multi}
                onChange={(e) => setPollEditor((prev) => (prev ? { ...prev, multi: e.target.checked } : prev))}
              />
              允许多选
            </label>
            <div className="dialog-actions">
              <button type="button" className="primary" disabled={sendingPoll} onClick={() => void handlePublishGroupPoll()}>
                {sendingPoll ? '发送中…' : '发送到行程群投票'}
              </button>
              <button type="button" className="secondary" onClick={() => setPollEditor(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
