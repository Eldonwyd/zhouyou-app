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
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="借用外部免费 AI 生成行程"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-card external-ai-modal" style={{ maxWidth: 640, width: '94vw', maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="card-heading" style={{ marginBottom: 8 }}>
          <div>
            <span className="eyebrow">ZERO-COST AI IMPORT</span>
            <h2 style={{ margin: '2px 0 4px' }}>借用外部免费 AI 生成（0 成本）</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              没有 API Key 或免费额度用完？用手机/电脑里免费的豆包、DeepSeek、Kimi、元宝生成，粘贴回来一键变成标准周游行程！
            </p>
          </div>
          <button type="button" className="text-button" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="external-ai-step" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-soft, rgba(0,0,0,0.03))', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <strong>第 1 步：复制周游专属提示词</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                已自动带入：{request.destination?.trim() || '待 AI 推荐目的地'} · {request.days || 3} 天
                {request.people ? ` · ${request.people} 人` : ''}
                {typeof request.budgetCents === 'number' && request.budgetCents > 0 ? ` · 预算 ¥${Math.round(request.budgetCents / 100)}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="primary" onClick={() => void handleCopyPrompt()}>
                {copied ? '✓ 已复制专属提示词' : '📋 一键复制专属提示词'}
              </button>
              <button type="button" className="text-button" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? '收起预览' : '查看提示词'}
              </button>
            </div>
          </div>
          {showPreview && (
            <textarea
              readOnly
              rows={7}
              value={promptText}
              style={{ width: '100%', marginTop: 10, fontSize: 12, fontFamily: 'monospace' }}
            />
          )}
        </div>

        <div className="external-ai-step" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-soft, rgba(0,0,0,0.03))', marginBottom: 12 }}>
          <strong>第 2 步：去任意免费 AI 里粘贴发送</strong>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
            打开你手机里的 App 或直接点下面网页版，把刚才复制的提示词发给它，等它生成完 JSON 后整段复制回来：
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXTERNAL_FREE_AI_APPS.map((app) => (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary"
                style={{ textDecoration: 'none', padding: '6px 12px', borderRadius: 999, fontSize: 13 }}
              >
                {app.name} <small style={{ opacity: 0.7 }}>· {app.hint}</small>
              </a>
            ))}
          </div>
        </div>

        <div className="external-ai-step" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-soft, rgba(0,0,0,0.03))', marginBottom: 12 }}>
          <label htmlFor="external-ai-reply-input" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
            第 3 步：粘贴 AI 生成的回复，一键导入周游
          </label>
          <textarea
            id="external-ai-reply-input"
            rows={7}
            disabled={busy}
            value={rawReply}
            onChange={(e) => {
              setRawReply(e.target.value);
              if (error) setError('');
            }}
            placeholder={'把豆包 / DeepSeek / Kimi / 元宝的完整回复粘贴到这里（包含 ```json ... ``` 即可，前后有多余文字也能自动识别）'}
            style={{ width: '100%', fontSize: 13 }}
          />
          {error && (
            <p role="alert" style={{ color: 'var(--danger, #c62828)', fontSize: 13, margin: '8px 0 0' }}>
              {error}
            </p>
          )}
        </div>

        <div className="heading-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
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
