import { useMemo, useState } from 'react';
import {
  EXTERNAL_FREE_AI_APPS,
  buildExternalAiPrompt,
  parseExternalAiResponse,
} from '../planner-external-ai';
import type { PlannerBudget, PlannerContent, PlannerRequest } from '../planner-types';

interface PlannerExternalAiImporterProps {
  request: PlannerRequest;
  onClose: () => void;
  onImported: (result: { content: PlannerContent; budget: PlannerBudget }) => Promise<void> | void;
}

export default function PlannerExternalAiImporter({
  request,
  onClose,
  onImported,
}: PlannerExternalAiImporterProps) {
  const promptText = useMemo(() => buildExternalAiPrompt(request), [request]);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [rawReply, setRawReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleCopyPrompt() {
    setError('');
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // 兜底兼容不支持 clipboard API 的浏览器/WebView
      try {
        const el = document.createElement('textarea');
        el.value = promptText;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch {
        setShowPreview(true);
        setError('自动复制受限，请展开下方提示词手动全选复制');
      }
    }
  }

  async function handleImport() {
    setError('');
    setBusy(true);
    try {
      const parsed = await parseExternalAiResponse(rawReply, request);
      await onImported({ content: parsed.content, budget: parsed.budget });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败，请确认粘贴了完整的 JSON 回复');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop external-ai-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="借用外部免费 AI 生成行程"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog external-ai-modal">
        <div className="external-ai-head">
          <div>
            <span className="eyebrow">ZERO-COST AI IMPORT</span>
            <h2>借用外部免费 AI 生成（0 成本）</h2>
            <p className="muted">
              支持豆包、DeepSeek、Kimi、元宝、ChatGPT 等任意 AI，复制提示词生成后粘贴回来即可一键导入。
            </p>
          </div>
          <button type="button" className="text-button external-ai-close" disabled={busy} onClick={onClose}>
            ✕ 关闭
          </button>
        </div>

        <div className="external-ai-step">
          <div className="external-ai-step-row">
            <div>
              <strong>第 1 步：复制周游专属提示词</strong>
              <p className="muted">
                已自动带入：{request.destination?.trim() || '待 AI 推荐目的地'} · {request.days || 3} 天
                {request.people ? ` · ${request.people} 人` : ''}
                {typeof request.budgetCents === 'number' && request.budgetCents > 0 ? ` · 预算 ¥${Math.round(request.budgetCents / 100)}` : ''}
              </p>
            </div>
            <div className="external-ai-step-btns">
              <button type="button" className="primary" onClick={() => void handleCopyPrompt()}>
                {copied ? '✓ 已复制提示词' : '📋 一键复制提示词'}
              </button>
              <button type="button" className="text-button" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? '收起' : '预览'}
              </button>
            </div>
          </div>
          {showPreview && (
            <textarea
              readOnly
              rows={6}
              value={promptText}
              className="external-ai-textarea is-mono"
            />
          )}
        </div>

        <div className="external-ai-step">
          <strong>第 2 步：去任意免费 AI 粘贴发送</strong>
          <p className="muted">
            打开手机 App 或点下方网页版，发给它并复制完整回复回来：
          </p>
          <div className="external-ai-apps">
            {EXTERNAL_FREE_AI_APPS.map((app) => (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary external-ai-app-pill"
              >
                {app.name} <small>· {app.hint}</small>
              </a>
            ))}
          </div>
        </div>

        <div className="external-ai-step">
          <label htmlFor="external-ai-reply-input" className="external-ai-label">
            第 3 步：粘贴 AI 生成的回复，一键导入周游
          </label>
          <textarea
            id="external-ai-reply-input"
            rows={6}
            disabled={busy}
            value={rawReply}
            onChange={(e) => {
              setRawReply(e.target.value);
              if (error) setError('');
            }}
            placeholder={'把豆包 / DeepSeek / Kimi / 元宝 / ChatGPT 的完整回复粘贴到这里（自动兼容 JSON 与各种字段格式）'}
            className="external-ai-textarea"
          />
          {error && (
            <p role="alert" className="external-ai-error">
              {error}
            </p>
          )}
        </div>

        <div className="external-ai-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !rawReply.trim()}
            onClick={() => void handleImport()}
          >
            {busy ? '正在解析行程…' : '✨ 一键解析并生成周游行程'}
          </button>
        </div>
      </div>
    </div>
  );
}
