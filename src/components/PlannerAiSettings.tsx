import { useEffect, useState } from 'react';
import { plannerApi } from '../planner-api';

interface ProviderOption { id: string; label: string; baseUrl: string; model: string; keyUrl: string }
export interface SavedAiProfile { id: string; label: string; model: string; search: 'direct' | 'citation' | 'none' }
/** 页面外部显示用的 AI 状态（来自 health 或保存/切换的返回）。 */
export interface AiStatus {
  configured: boolean; provider: string; label?: string; model?: string;
  searchAvailable: boolean; searchLabel: string; saved: SavedAiProfile[];
}
interface AiState extends AiStatus {
  model: string; baseUrl: string; label: string; keyConfigured: boolean; providers: ProviderOption[];
}
/** 服务端返回的状态补齐默认值：旧版服务没有 saved/searchLabel 字段时也能正常显示。 */
export function normalizeAiStatus<T extends Partial<AiStatus>>(value: T): T & AiStatus {
  const configured = Boolean(value.configured);
  const provider = value.provider ?? 'deepseek';
  const fallback = configured ? [{ id: provider, label: (value.label ?? value.model ?? provider).split(' · ')[0], model: (value.label ?? value.model ?? '').split(' · ')[1] ?? '', search: 'direct' as const }] : [];
  return { ...value, configured, provider, searchAvailable: Boolean(value.searchAvailable), searchLabel: value.searchLabel ?? (value.searchAvailable ? '已联网' : ''), saved: value.saved ?? fallback };
}
const SEARCH_TEXT = { direct: '可联网', citation: '可联网', none: '不支持联网' } as const;

/** 切换到已保存的服务商（不需要再填 Key）。 */
export function switchAiProvider(provider: string) {
  return plannerApi<AiState>('ai-switch', { provider }, AbortSignal.timeout(30000), () => {}).then(normalizeAiStatus);
}

/** 页面外部的 AI 状态条：显示是否已配置、当前服务商与联网方式，可直接切换已保存的配置。 */
export function PlannerAiStatusBar({ status, onOpen, onChange }: { status: AiStatus | null; onOpen: () => void; onChange: (status: AiStatus) => void }) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  if (!status) return null;
  if (!status.configured)
    return (
      <div className="planner-banner">
        AI 服务尚未配置。已有计划和账本仍可使用。{' '}
        <button className="text-button" type="button" onClick={onOpen}>配置 AI</button>
      </div>
    );
  const name = (status.label ?? status.model ?? '').split(' · ');
  return (
    <div className="planner-ai-status" role="status">
      <span className="planner-ai-status-dot" aria-hidden="true" />
      <strong>AI 已配置</strong>
      {status.saved.length > 1 ? (
        <select aria-label="切换 AI 服务" value={status.provider} disabled={switching}
          onChange={async (event) => {
            setSwitching(true); setError('');
            try { onChange(await switchAiProvider(event.target.value)); }
            catch (reason) { setError(reason instanceof Error ? reason.message : '切换失败'); }
            finally { setSwitching(false); }
          }}>
          {status.saved.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.model}</option>)}
        </select>
      ) : (
        <span>{name[0]}{name[1] ? <small> · {name[1]}</small> : null}</span>
      )}
      <span className={status.searchAvailable ? 'planner-ai-chip ok' : 'planner-ai-chip'}>
        {status.searchAvailable ? status.searchLabel : '未联网，按模型知识规划'}
      </span>
      {error && <span className="planner-error">{error}</span>}
      <button className="text-button" type="button" onClick={onOpen}>{status.saved.length > 1 ? '管理' : '更换 / 添加'}</button>
    </div>
  );
}

/** 配置 AI 服务：选择服务商、填写 API Key、模型与接口地址。Key 只保存在本机服务端，
 * 页面不会读回已保存的 Key；留空表示沿用当前服务商已保存的 Key。
 */
export default function PlannerAiSettings({ onClose, onSaved }: { onClose: () => void; onSaved: (status: AiStatus) => void }) {
  const [state, setState] = useState<AiState | null>(null);
  const [provider, setProvider] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'switch'>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const request = <T,>(endpoint: string, body: unknown) => plannerApi<T>(endpoint, body, AbortSignal.timeout(60000), () => {});

  useEffect(() => {
    void request<AiState>('ai-settings', {}).then(normalizeAiStatus).then((current) => {
      setState(current);
      setProvider(current.provider);
      setModel(current.model);
      setBaseUrl(current.baseUrl);
    }).catch(() => setMessage({ ok: false, text: '暂时无法读取 AI 配置，请确认本地服务已启动' }));
  }, []);

  const option = state?.providers.find((item) => item.id === provider);
  const savedProfile = state?.saved.find((item) => item.id === provider);
  const keyHint = savedProfile ? '已保存，留空则继续使用' : '粘贴该服务商的 API Key';
  const choose = (id: string) => {
    const next = state?.providers.find((item) => item.id === id);
    const saved = state?.saved.find((item) => item.id === id);
    setProvider(id);
    // 已保存的服务商恢复已保存的模型，否则填入该服务商的默认值。
    setModel(id === state?.provider ? state.model : saved?.model ?? next?.model ?? '');
    setBaseUrl(id === state?.provider ? state.baseUrl : next?.baseUrl ?? '');
    setApiKey('');
    setMessage(null);
  };
  const payload = () => ({ provider, apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() });

  async function test() {
    setBusy('test'); setMessage(null);
    try {
      const result = await request<{ ok: boolean; label: string; seconds?: number; error?: string }>('ai-test', payload());
      setMessage(result.ok
        ? { ok: true, text: `连接成功：${result.label}（用时 ${result.seconds} 秒）` }
        : { ok: false, text: result.error ?? '连接失败，请检查配置' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '连接失败，请检查配置' });
    } finally { setBusy(''); }
  }
  async function save() {
    setBusy('save'); setMessage(null);
    try {
      const saved = normalizeAiStatus(await request<AiState>('ai-settings', { ...payload(), save: true }));
      setState(saved); setApiKey('');
      onSaved(saved);
      setMessage({ ok: true, text: `已保存并启用：${saved.label}` });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '保存失败，请重试' });
    } finally { setBusy(''); }
  }

  async function use(id: string) {
    setBusy('switch'); setMessage(null);
    try {
      const next = await switchAiProvider(id);
      setState(next); onSaved(next);
      setProvider(next.provider); setModel(next.model); setBaseUrl(next.baseUrl); setApiKey('');
      setMessage({ ok: true, text: `已切换到：${next.label}` });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '切换失败，请重试' });
    } finally { setBusy(''); }
  }

  return (
    <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog planner-ai-settings" role="dialog" aria-modal="true" aria-label="配置 AI">
        <div className="card-heading">
          <h2>配置 AI</h2>
          <button className="text-button" type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭">×</button>
        </div>
        <p className="muted">
          当前：{state ? state.label : '读取中…'}{state && !state.configured ? '（未配置）' : ''}
          {state && (state.searchAvailable ? ` · ${state.searchLabel}` : ' · 未联网，按模型知识规划')}
        </p>
        {state && state.saved.length > 0 && (
          <div className="planner-ai-saved">
            <h3>已保存的配置</h3>
            {state.saved.map((item) => (
              <div key={item.id} className={item.id === state.provider ? 'planner-ai-saved-row active' : 'planner-ai-saved-row'}>
                <span><strong>{item.label}</strong><small>{item.model} · {SEARCH_TEXT[item.search]}</small></span>
                {item.id === state.provider
                  ? <em>使用中</em>
                  : <button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => void use(item.id)}>切换使用</button>}
              </div>
            ))}
          </div>
        )}
        <h3 className="planner-ai-subtitle">{state?.saved.length ? '添加或修改配置' : '选择服务商'}</h3>
        <div className="planner-ai-providers" role="radiogroup" aria-label="AI 服务商">
          {(state?.providers ?? []).map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={provider === item.id}
              className={provider === item.id ? 'active' : ''} onClick={() => choose(item.id)}>
              {item.label}{state?.saved.some((saved) => saved.id === item.id) && <span className="planner-ai-saved-mark"> ✓</span>}
            </button>
          ))}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>
            API Key
            <input type="password" autoComplete="off" value={apiKey} placeholder={keyHint} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          {option?.keyUrl && <a className="planner-ai-keylink" href={option.keyUrl} target="_blank" rel="noopener noreferrer">去 {option.label} 获取 API Key</a>}
          <label>
            模型
            <input value={model} placeholder={option?.model || '填写模型名称'} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label>
            接口地址{provider === 'custom' ? '' : '（一般不用改）'}
            <input value={baseUrl} placeholder={option?.baseUrl || 'https://…/v1'} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <small className="muted">
            模型名称以服务商官网为准；Key 只保存在本机服务端，页面不会显示已保存的 Key。每个服务商的配置单独保存，可随时切换。
            {provider === 'moonshot' || provider === 'doubao' || provider === 'custom'
              ? ' 该服务商不提供可读取的联网结果，规划时借用其他已保存服务商的联网检索；都没有则按模型知识规划。'
              : provider === 'deepseek' || provider === 'zhipu' ? ' 联网检索使用该服务商的搜索接口。'
                : ' 联网检索使用该服务商的搜索，网页正文由本机读取。'}
          </small>
          {message && <p role="status" className={message.ok ? 'planner-ai-ok' : 'planner-error'}>{message.text}</p>}
          <div className="dialog-actions">
            <button className="secondary" type="button" disabled={Boolean(busy) || !state} onClick={() => void test()}>
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button className="primary" type="submit" disabled={Boolean(busy) || !state}>
              {busy === 'save' ? '保存中…' : '保存并启用'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
