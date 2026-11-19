import { useEffect, useRef } from 'react';
import type { AiTravelPlan, XhsReference } from '../planner-types';
import { isExecutablePlannerSuggestion, plannerSuggestions } from '../planner-domain';
import { plannerDisplayText, splitAnswerLinks } from '../planner-display';

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
  onConfigureAi: () => void;
  aiLabel?: string;
  attachedRefs?: XhsReference[];
  onOpenXhsAttach?: (initialFiles?: File[]) => void;
  onRemoveAttachedRef?: (refId: string) => void;
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
  onConfigureAi,
  aiLabel = '',
  attachedRefs = [],
  onOpenXhsAttach,
  onRemoveAttachedRef,
}: PlannerConversationProps) {
  const transcript = useRef<HTMLDivElement>(null);
  const activities = plan.content.days.flatMap((day) => day.activities);
  const selected = activities.find((activity) => activity.id === scopeId);
  const contentVersion = plan.contentVersion ?? plan.version;
  useEffect(() => {
    // 收起期间收到的回复，在下次展开后滚动到最新消息。
    const element = transcript.current;
    if (open && element) element.scrollTop = element.scrollHeight;
  }, [open, plan.id, plan.messages.length]);

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
        {plan.messages.length > 0 && (
          <div className="planner-chat-messages" ref={transcript} aria-live="polite">
            {plan.messages.map((item) => {
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
                      <p>{body}</p>
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
      </div>
    </section>
  );
}
