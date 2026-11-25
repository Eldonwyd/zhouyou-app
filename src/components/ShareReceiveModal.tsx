import { useEffect, useState } from 'react';
import { cloudApi, type SharePreviewData } from '../cloud-api';
import type { AiTravelPlan } from '../planner-types';

interface ShareReceiveModalProps {
  shareCode: string | null;
  loggedIn: boolean;
  onRequireLogin: () => void;
  onAccepted: (plan: AiTravelPlan, mode: 'copy' | 'collab', groupId?: string) => Promise<void>;
  onClose: () => void;
}

export default function ShareReceiveModal({
  shareCode,
  loggedIn,
  onRequireLogin,
  onAccepted,
  onClose,
}: ShareReceiveModalProps) {
  const [preview, setPreview] = useState<SharePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!shareCode) {
      setPreview(null);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    cloudApi.previewShare(shareCode)
      .then((res) => {
        if (active) setPreview(res.share);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : '无法读取该分享');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [shareCode]);

  if (!shareCode) return null;

  async function handleAccept() {
    if (!shareCode) return;
    if (!loggedIn) {
      onRequireLogin();
      return;
    }
    setAccepting(true);
    setError('');
    try {
      const res = await cloudApi.acceptShare(shareCode);
      await onAccepted(res.plan, res.mode, res.groupId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '接收攻略失败');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog share-receive-dialog" role="dialog" aria-modal="true" aria-labelledby="share-receive-title">
        <div className="auth-dialog-head">
          <div>
            <span className="city-dialog-pill">✈️ 收到行程分享 · #{shareCode}</span>
            <h2 id="share-receive-title">{preview ? preview.title : '正在识别周游口令…'}</h2>
          </div>
          <button type="button" className="text-button auth-close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {loading && <div className="empty-state">正在读取行程预览…</div>}
        {error && <div className="auth-alert auth-alert-error">{error}</div>}

        {preview && (
          <>
            <p className="share-receive-meta">
              来自 <strong>{preview.senderNickname}</strong> · {preview.mode === 'collab' ? '邀请你加入行程群共同编辑' : '发送给你一份独立攻略副本'}
              {preview.destination ? ` · 📍 ${preview.destination}` : ''}
              {preview.daysCount ? ` · 🗓 ${preview.daysCount} 天` : ''}
            </p>

            {preview.summary?.highlights && preview.summary.highlights.length > 0 && (
              <div className="share-preview-days">
                {preview.summary.highlights.map((day) => (
                  <div key={day.day} className="share-preview-day">
                    <strong>Day {day.day} · {day.theme || '行程安排'}</strong>
                    {day.stops && day.stops.length > 0 && (
                      <div className="compare-city-chips">
                        {day.stops.map((s, idx) => <span key={idx} className="stop-pill">{s}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" className="primary" disabled={accepting} onClick={() => void handleAccept()}>
                {!loggedIn
                  ? '登录后接收这份行程'
                  : accepting
                    ? '正在接收…'
                    : preview.mode === 'collab'
                      ? '加入行程群并打开攻略'
                      : '保存到我的攻略'}
              </button>
              <button type="button" className="text-button" onClick={onClose}>暂不接收</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
