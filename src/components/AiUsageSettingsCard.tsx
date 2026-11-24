import { useCallback, useEffect, useState } from 'react';
import { plannerApi } from '../planner-api';
import {
  AI_USAGE_UPDATED_EVENT,
  readAiUsageStats,
  resetAiUsageStats,
  type AiUsageStats,
} from '../mobile-ai-runtime';
import type { AiStatus, SubscriptionQuota } from './PlannerAiSettings';
import { useI18n } from '../i18n';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatResetCountdown(iso?: string, isEn = false): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return isEn ? 'Resetting soon' : '即将重置';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return isEn ? `Resets in ${mins}m` : `${mins} 分钟后重置`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return isEn ? `Resets in ${hours}h ${remMins}m` : `${hours} 小时 ${remMins} 分后重置`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return isEn ? `Resets in ${days}d ${remHours}h` : `${days} 天 ${remHours} 小时后重置`;
}

export default function AiUsageSettingsCard() {
  const { isEn, t } = useI18n();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [quotas, setQuotas] = useState<Record<string, SubscriptionQuota>>({});
  const [loadingQuota, setLoadingQuota] = useState(false);
  const [usage, setUsage] = useState<AiUsageStats>(() => readAiUsageStats());

  const refreshAll = useCallback(async (forceQuota = false) => {
    setUsage(readAiUsageStats());
    setLoadingQuota(true);
    try {
      const ctrl = new AbortController();
      const next = await plannerApi<AiStatus>('ai-settings', {}, ctrl.signal, () => {});
      setStatus(next);
      const connectedSubs = (next.subscriptions ?? []).filter((s) => s.connected);
      const nextQuotas: Record<string, SubscriptionQuota> = {};
      for (const sub of connectedSubs) {
        if (sub.quota) nextQuotas[sub.key] = sub.quota;
      }
      if (connectedSubs.length > 0) {
        await Promise.all(
          connectedSubs.map(async (sub) => {
            try {
              const qRes = await plannerApi<{ quota?: SubscriptionQuota }>(
                'ai-sub-quota',
                { provider: sub.key, force: forceQuota },
                ctrl.signal,
                () => {},
              );
              if (qRes?.quota) nextQuotas[sub.key] = qRes.quota;
            } catch {
              // keep previous quota
            }
          }),
        );
      }
      setQuotas(nextQuotas);
    } catch {
      // offline or unavailable
    } finally {
      setLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll(false);
    const onUpdated = () => setUsage(readAiUsageStats());
    window.addEventListener(AI_USAGE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(AI_USAGE_UPDATED_EVENT, onUpdated);
  }, [refreshAll]);

  const connectedSubs = (status?.subscriptions ?? []).filter((s) => s.connected);
  const providerUsageList = Object.values(usage.byProvider).sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

  return (
    <section id="settings-ai-usage" className="card ai-usage-settings-card" aria-labelledby="settings-ai-usage-title">
      <div className="card-heading">
        <div>
          <h2 id="settings-ai-usage-title">{t('AI 订阅额度与 API 用量', 'AI Subscription Quota & API Usage')}</h2>
          <p className="muted">
            {t('查看已登录订阅的实时剩余额度，以及本机 API 调用次数与 Token 消耗统计。', 'Check remaining quota for connected subscriptions and track local API call & token usage.')}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={loadingQuota}
          onClick={() => void refreshAll(true)}
        >
          {loadingQuota ? t('刷新中…', 'Refreshing…') : t('刷新额度', 'Refresh Quota')}
        </button>
      </div>

      {/* 1. 已登录订阅额度 */}
      <div className="ai-usage-block">
        <h3 className="ai-usage-subtitle">{t('已登录订阅额度', 'Connected Subscription Quota')}</h3>
        {connectedSubs.length > 0 ? (
          <div className="ai-quota-list">
            {connectedSubs.map((sub) => {
              const q = quotas[sub.key] ?? sub.quota;
              const pct = typeof q?.remainingPercent === 'number' ? q.remainingPercent : null;
              const fivePct = typeof q?.fiveHourRemainingPercent === 'number' ? q.fiveHourRemainingPercent : null;
              return (
                <div key={sub.id} className="ai-quota-item">
                  <div className="ai-quota-item-head">
                    <strong>
                      {sub.name}
                      {sub.active && <span className="ai-quota-active-pill">{t('当前使用', 'Active')}</span>}
                    </strong>
                    <span className="muted">{sub.model}</span>
                  </div>
                  {pct !== null ? (
                    <>
                      <div className="ai-quota-bar-row">
                        <span>{q?.title || t('剩余额度', 'Remaining')}</span>
                        <strong>{pct}%</strong>
                      </div>
                      <div className="ai-quota-track"><span style={{ width: `${pct}%` }} /></div>
                      <div className="ai-quota-meta-row">
                        {q?.resetsAt && <span>{formatResetCountdown(q.resetsAt, isEn)}</span>}
                        {fivePct !== null && (
                          <span>
                            {t(`5 小时剩余 ${fivePct}%`, `5h left: ${fivePct}%`)}
                            {q?.fiveHourResetsAt ? ` · ${formatResetCountdown(q.fiveHourResetsAt, isEn)}` : ''}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="muted ai-quota-note">{q?.note || t('已登录并保存在本机。', 'Signed in and saved locally.')}</p>
                  )}
                  {sub.manageUrl && (
                    <a className="text-button" href={sub.manageUrl} target="_blank" rel="noopener noreferrer">
                      {t('前往官网查看详情 ↗', 'View on Provider ↗')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">
            {t('暂未登录任何订阅账号，可在「行程规划 → AI 服务设置」中直接登录 ChatGPT / Claude / Kimi。', 'No subscriptions signed in yet. Sign in to ChatGPT, Claude, or Kimi under Planner → AI Settings.')}
          </p>
        )}
      </div>

      {/* 2. API 与本地调用统计 */}
      <div className="ai-usage-block">
        <div className="ai-usage-subtitle-row">
          <h3 className="ai-usage-subtitle">{t('API 调用与 Token 消耗统计', 'API Calls & Token Usage')}</h3>
          {usage.totalRequests > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm(t('确定清空本机累计的 API 用量统计吗？', 'Reset local API usage statistics?'))) {
                  resetAiUsageStats();
                }
              }}
            >
              {t('清空统计', 'Reset')}
            </button>
          )}
        </div>
        <div className="ai-usage-summary-grid">
          <div className="ai-usage-stat-box">
            <small>{t('累计调用', 'Total Calls')}</small>
            <strong>{usage.totalRequests}</strong>
          </div>
          <div className="ai-usage-stat-box">
            <small>{t('总计 Token', 'Total Tokens')}</small>
            <strong>{formatTokens(usage.totalTokens)}</strong>
          </div>
          <div className="ai-usage-stat-box">
            <small>{t('输入 / 输出', 'In / Out')}</small>
            <strong>{formatTokens(usage.totalInputTokens)} / {formatTokens(usage.totalOutputTokens)}</strong>
          </div>
        </div>
        {providerUsageList.length > 0 ? (
          <div className="ai-usage-provider-list">
            {providerUsageList.map((item) => (
              <div key={item.provider} className="ai-usage-provider-row">
                <div>
                  <strong>{item.label}</strong>
                  <small className="muted">{item.lastModel || item.provider}</small>
                </div>
                <div className="ai-usage-provider-nums">
                  <span>{t(`${item.requests} 次`, `${item.requests} calls`)}</span>
                  <strong>{formatTokens(item.totalTokens)} tokens</strong>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('尚未产生 AI 调用记录，使用行程规划或对话后会自动累计每次消耗。', 'No AI calls recorded yet. Usage will be tracked automatically after planning or chatting.')}</p>
        )}
      </div>
    </section>
  );
}
