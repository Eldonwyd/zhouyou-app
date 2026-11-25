import { Capacitor, registerPlugin } from '@capacitor/core';
import sha256 from 'fast-sha256';
import { jsonrepair } from 'jsonrepair';
import { getPlannerApiOrigin } from './api-base';
import {
  addPlannerDays,
  freshPlannerRequest,
  isSelfDriveTransport,
  plannerDayCount,
  plannerFillEstimates,
  plannerLocalTransport,
  updatePlannerDates,
  validatePlannerContent,
} from './planner-domain';
import type {
  AiTravelPlan,
  DestinationRecommendation,
  PackingCategory,
  PackingItem,
  PackingList,
  PlannerActivity,
  PlannerContent,
  PlannerCost,
  PlannerDay,
  PlannerPeriod,
  PlannerRequest,
  PlannerSource,
  PlannerTransferModeKind,
  PlannerTransferOption,
} from './planner-types';
import type { JourneyCity } from './types';
import type {
  AiStatus,
  ModelCatalogItem,
  SavedAiProfile,
  SubscriptionProfile,
  SubscriptionQuota,
} from './components/PlannerAiSettings';

interface AiProviderMeta {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  models: ModelCatalogItem[];
  keyUrl: string;
}

export interface MobileAiState extends AiStatus {
  model: string;
  baseUrl: string;
  label: string;
  keyConfigured: boolean;
  providers: AiProviderMeta[];
  subscriptions: SubscriptionProfile[];
}

interface NativeHttpResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

interface NativeAiBridgePlugin {
  openExternalUrl(options: { url: string }): Promise<{ ok: boolean }>;
  httpRequest(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<NativeHttpResponse>;
  startOAuthCallbackServer(options: { port: number; callbackPath: string }): Promise<{ ok: boolean; port: number }>;
  stopOAuthCallbackServer(): Promise<void>;
  addListener(
    eventName: 'oauthCallback',
    listener: (params: Record<string, string>) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const NativeAiBridge = registerPlugin<NativeAiBridgePlugin>('NativeAiBridge');

function getNativeBridge(): NativeAiBridgePlugin | null {
  if (!Capacitor.isNativePlatform()) return null;
  if (!Capacitor.isPluginAvailable('NativeAiBridge')) return null;
  return NativeAiBridge;
}

/** 静态托管的网页 / PWA（无本地 Node 后端）也启用本地直连运行时，支持直接填 API Key 规划。 */
function isStaticHostedWebPwa(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if ((window as unknown as { zhouyouDesktop?: { isDesktop?: boolean } }).zhouyouDesktop?.isDesktop) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pwa') === '1') return true;
  } catch {
    // ignore
  }
  const host = (window.location.hostname || '').toLowerCase();
  return host.endsWith('.github.io') || host === 'zhouyou.online' || host.endsWith('.zhouyou.online') || host.endsWith('.pages.dev');
}

/** 原生手机端或静态托管 PWA（未指向外部远程服务器时）启用本机直连 AI 运行时。 */
export function isMobileNativeAiActive(): boolean {
  if (getPlannerApiOrigin()) return false;
  return Boolean(getNativeBridge() || isStaticHostedWebPwa());
}

const PROXY_ALLOWED_HOSTS = new Set([
  'auth.openai.com',
  'chatgpt.com',
  'api.openai.com',
  'platform.claude.com',
  'api.anthropic.com',
  'auth.kimi.com',
  'api.kimi.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.moonshot.cn',
  'ark.cn-beijing.volces.com',
  'zh.wikipedia.org',
  'en.wikipedia.org',
  'commons.wikimedia.org',
  'photon.komoot.io',
  'nominatim.openstreetmap.org',
]);

function resolveAiProxyEndpoint(): string {
  const host = (window.location.hostname || '').toLowerCase();
  if (host === 'zhouyou.online' || host === 'www.zhouyou.online' || host.endsWith('.zhouyou.online') || host.endsWith('.pages.dev')) {
    return `${window.location.origin}/api/ai-proxy`;
  }
  return 'https://zhouyou.online/api/ai-proxy';
}

function shouldUseEdgeProxy(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && !parsed.port && PROXY_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function openAuthPage(url: string): Promise<void> {
  const bridge = getNativeBridge();
  if (bridge) {
    await bridge.openExternalUrl({ url });
    return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // 浏览器拦截弹窗时，用户可直接点击卡片上的授权链接
  }
}

async function transportHttpRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<NativeHttpResponse> {
  const bridge = getNativeBridge();
  if (bridge) {
    return bridge.httpRequest(options);
  }
  const timeoutMs = options.timeoutMs ?? 90000;
  if (shouldUseEdgeProxy(options.url)) {
    const proxyRes = await fetch(resolveAiProxyEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        url: options.url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        timeoutMs,
      }),
      signal: AbortSignal.timeout(timeoutMs + 5000),
    });
    const rawText = await proxyRes.text();
    let parsed: { status?: number; body?: string; headers?: Record<string, string>; error?: string } | null = null;
    try {
      parsed = JSON.parse(rawText) as { status?: number; body?: string; headers?: Record<string, string>; error?: string };
    } catch {
      // non-json proxy response
    }
    if (!proxyRes.ok) {
      throw new Error(parsed?.error || `边缘转发接口返回异常（HTTP ${proxyRes.status}）`);
    }
    return {
      status: typeof parsed?.status === 'number' ? parsed.status : 502,
      body: typeof parsed?.body === 'string' ? parsed.body : '',
      headers: parsed?.headers,
    };
  }
  const resp = await fetch(options.url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

/* ============================================================================
 * 1. 全平台通用：API 与订阅本地调用统计（在「个人中心 → 偏好与设置」中展示）
 * ========================================================================== */
const USAGE_STORAGE_KEY = 'zhouyou-ai-usage-stats-v1';
export const AI_USAGE_UPDATED_EVENT = 'zhouyou-ai-usage-updated';

export interface ProviderUsageEntry {
  provider: string;
  label: string;
  authMode: 'api' | 'subscription';
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastModel: string;
  lastUsedAt: string;
}

export interface AiUsageStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  updatedAt: string;
  byProvider: Record<string, ProviderUsageEntry>;
}

function emptyUsageStats(): AiUsageStats {
  return {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    updatedAt: '',
    byProvider: {},
  };
}

export function readAiUsageStats(): AiUsageStats {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return emptyUsageStats();
    const parsed = JSON.parse(raw) as Partial<AiUsageStats>;
    return {
      totalRequests: Number(parsed.totalRequests) || 0,
      totalInputTokens: Number(parsed.totalInputTokens) || 0,
      totalOutputTokens: Number(parsed.totalOutputTokens) || 0,
      totalTokens: Number(parsed.totalTokens) || 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      byProvider: parsed.byProvider && typeof parsed.byProvider === 'object' ? parsed.byProvider : {},
    };
  } catch {
    return emptyUsageStats();
  }
}

export function recordAiUsage(entry: {
  provider: string;
  label?: string;
  authMode?: 'api' | 'subscription';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const stats = readAiUsageStats();
  const inTok = Math.max(0, Math.round(entry.inputTokens ?? 0));
  const outTok = Math.max(0, Math.round(entry.outputTokens ?? 0));
  const totTok = inTok + outTok;
  const now = new Date().toISOString();
  const providerKey = entry.provider || 'unknown';
  const prev = stats.byProvider[providerKey];
  stats.totalRequests += 1;
  stats.totalInputTokens += inTok;
  stats.totalOutputTokens += outTok;
  stats.totalTokens += totTok;
  stats.updatedAt = now;
  stats.byProvider[providerKey] = {
    provider: providerKey,
    label: entry.label || prev?.label || providerKey,
    authMode: entry.authMode ?? (providerKey.startsWith('sub:') ? 'subscription' : 'api'),
    requests: (prev?.requests ?? 0) + 1,
    inputTokens: (prev?.inputTokens ?? 0) + inTok,
    outputTokens: (prev?.outputTokens ?? 0) + outTok,
    totalTokens: (prev?.totalTokens ?? 0) + totTok,
    lastModel: entry.model || prev?.lastModel || '',
    lastUsedAt: now,
  };
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(stats));
    window.dispatchEvent(new CustomEvent(AI_USAGE_UPDATED_EVENT));
  } catch {
    // ignore quota errors
  }
}

export function resetAiUsageStats(): void {
  try {
    localStorage.removeItem(USAGE_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AI_USAGE_UPDATED_EVENT));
  } catch {
    // ignore
  }
}

/* ============================================================================
 * 2. 手机端持久化凭据、模型目录与 OAuth 常量
 * ========================================================================== */
const STORE_KEY = 'zhouyou-mobile-ai-state-v1';

interface StoredSubCred {
  access: string;
  refresh: string;
  expires: number; // epoch ms
  accountId?: string;
}

interface StoredApiConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: string;
}

interface MobileAiStore {
  activeProvider: string;
  subCreds: Record<string, StoredSubCred>;
  subModels: Record<string, string>;
  subThinking: Record<string, string>;
  apiConfigs: Record<string, StoredApiConfig>;
}

const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CHATGPT_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CHATGPT_REDIRECT_URI = 'http://localhost:1455/auth/callback';

const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_REDIRECT_URI = 'http://localhost:53692/callback';
const CLAUDE_COPY_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const CLAUDE_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const KIMI_DEVICE_URL = 'https://auth.kimi.com/api/oauth/device_authorization';
const KIMI_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';

const SUB_CATALOG: Record<string, { name: string; defaultModel: string; manageUrl: string; loginKind: SubscriptionProfile['loginKind']; vision: boolean; models: ModelCatalogItem[] }> = {
  chatgpt: {
    name: 'ChatGPT',
    defaultModel: 'gpt-6.2-sol',
    manageUrl: 'https://chatgpt.com/#settings/Usage',
    loginKind: 'oauth_browser',
    vision: true,
    models: [
      { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], latest: true },
    ],
  },
  claude: {
    name: 'Claude',
    defaultModel: 'claude-sonnet-5-5',
    manageUrl: 'https://claude.ai/settings/usage',
    loginKind: 'oauth_browser',
    vision: true,
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], latest: true },
      { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', vision: true, reasoning: true, thinkingLevels: ['minimal', 'low', 'medium', 'high'], latest: true },
    ],
  },
  kimi: {
    name: 'Kimi Code',
    defaultModel: 'k3.1-pro-highspeed',
    manageUrl: 'https://www.kimi.com/code/console',
    loginKind: 'device_code',
    vision: true,
    models: [
      { id: 'k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'k3.1-pro', name: 'Kimi K3.1 Pro', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'k3', name: 'Kimi K3', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
    ],
  },
  gemini: {
    name: 'Gemini',
    defaultModel: 'gemini-4-neon',
    manageUrl: 'https://aistudio.google.com/apikey',
    loginKind: 'gemini_cli',
    vision: false,
    models: [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
    ],
  },
};

const API_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', vision: false, reasoning: true, thinkingLevels: ['off', 'low', 'high'], latest: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vision: false, reasoning: true, thinkingLevels: ['off', 'high'], latest: true },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', vision: false, reasoning: false, thinkingLevels: ['off', 'low'], latest: false },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
    models: SUB_CATALOG.claude.models,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.2-sol',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: SUB_CATALOG.chatgpt.models,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-4-neon',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: false },
    ],
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen4-max-preview',
    keyUrl: 'https://bailian.console.aliyun.com/',
    models: [
      { id: 'qwen4-max-preview', name: 'Qwen4 Max Preview', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: false },
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: false },
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-highspeed',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed', vision: false, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'glm-5.3', name: 'GLM-5.3', vision: false, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro-highspeed',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
      { id: 'kimi-k3', name: 'Kimi K3', vision: true, reasoning: true, thinkingLevels: ['low', 'high'], latest: true },
    ],
  },
  {
    id: 'doubao',
    label: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-pro',
    keyUrl: 'https://console.volcengine.com/ark',
    models: [
      { id: 'doubao-seed-2-0-pro', name: 'Doubao Seed 2.0 Pro', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], latest: true },
    ],
  },
  { id: 'custom', label: '其他 OpenAI 兼容接口', baseUrl: '', model: '', keyUrl: '', models: [] },
];

/** 将模型展示名（如 "DeepSeek V4.1 Flash"）统一还原为真实 API 模型 ID（如 "deepseek-flash"）。 */
function normalizeModelId(provider: string, rawModel?: string): string {
  const trimmed = (rawModel ?? '').trim();
  const isSub = provider.startsWith('sub:');
  const subKey = isSub ? provider.slice(4) : '';
  const providerMeta = isSub ? undefined : API_PROVIDERS.find((p) => p.id === provider);
  const subSpec = isSub ? SUB_CATALOG[subKey] : undefined;
  const catalog = subSpec?.models ?? providerMeta?.models ?? [];
  const defaultId = subSpec?.defaultModel ?? providerMeta?.model ?? '';
  if (!trimmed) return defaultId;

  const exactId = catalog.find((m) => m.id === trimmed);
  if (exactId) return exactId.id;

  const lower = trimmed.toLowerCase();
  const matchedInProvider = catalog.find(
    (m) => m.id.toLowerCase() === lower || m.name.toLowerCase() === lower,
  );
  if (matchedInProvider) return matchedInProvider.id;

  // 兜底：若用户误填了其他服务商目录中的模型展示名，也尝试按展示名还原
  for (const p of API_PROVIDERS) {
    const found = p.models.find((m) => m.name.toLowerCase() === lower);
    if (found) return found.id;
  }
  for (const spec of Object.values(SUB_CATALOG)) {
    const found = spec.models.find((m) => m.name.toLowerCase() === lower);
    if (found) return found.id;
  }
  return trimmed;
}

function loadStore(): MobileAiStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { activeProvider: '', subCreds: {}, subModels: {}, subThinking: {}, apiConfigs: {} };
    const parsed = JSON.parse(raw) as Partial<MobileAiStore>;
    const store: MobileAiStore = {
      activeProvider: typeof parsed.activeProvider === 'string' ? parsed.activeProvider : '',
      subCreds: parsed.subCreds && typeof parsed.subCreds === 'object' ? parsed.subCreds : {},
      subModels: parsed.subModels && typeof parsed.subModels === 'object' ? parsed.subModels : {},
      subThinking: parsed.subThinking && typeof parsed.subThinking === 'object' ? parsed.subThinking : {},
      apiConfigs: parsed.apiConfigs && typeof parsed.apiConfigs === 'object' ? parsed.apiConfigs : {},
    };
    let repaired = false;
    for (const [provId, cfg] of Object.entries(store.apiConfigs)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const fixed = normalizeModelId(provId, cfg.model);
      if (fixed && fixed !== cfg.model) {
        cfg.model = fixed;
        repaired = true;
      }
    }
    for (const [subKey, model] of Object.entries(store.subModels)) {
      if (typeof model !== 'string') continue;
      const fixed = normalizeModelId(`sub:${subKey}`, model);
      if (fixed && fixed !== model) {
        store.subModels[subKey] = fixed;
        repaired = true;
      }
    }
    if (repaired) saveStore(store);
    return store;
  } catch {
    return { activeProvider: '', subCreds: {}, subModels: {}, subThinking: {}, apiConfigs: {} };
  }
}

function saveStore(store: MobileAiStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkceSync(): { verifier: string; challenge: string; state: string } {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const encoded = new TextEncoder().encode(verifier);
  const challenge = base64Url(sha256(encoded));
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64Url(stateBytes);
  return { verifier, challenge, state };
}

function extractJwtAccountId(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
    if (typeof auth?.chatgpt_account_id === 'string') return auth.chatgpt_account_id;
    if (typeof payload.chatgpt_account_id === 'string') return payload.chatgpt_account_id;
  } catch {
    // ignore
  }
  return undefined;
}

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/* ============================================================================
 * 3. 登录会话管理（OAuth PKCE 本地回调 + 手动粘贴兜底 + Kimi 设备码）
 * ========================================================================== */
interface ActiveLoginSession {
  key: 'chatgpt' | 'claude' | 'kimi';
  state: 'pending' | 'completed' | 'failed';
  authUrl?: string;
  userCode?: string;
  verificationUri?: string;
  instructions?: string;
  error?: string;
  verifier?: string;
  oauthState?: string;
  redirectUri?: string;
  cancelled?: boolean;
  listenerRemove?: () => Promise<void>;
}

const loginSessions = new Map<string, ActiveLoginSession>();
const quotaCache = new Map<string, { fetchedAt: number; value: SubscriptionQuota }>();

async function cleanupLoginSession(key: string): Promise<void> {
  const existing = loginSessions.get(key);
  if (existing) {
    existing.cancelled = true;
    if (existing.listenerRemove) {
      await existing.listenerRemove().catch(() => {});
    }
    loginSessions.delete(key);
  }
  const bridge = getNativeBridge();
  if (bridge && (key === 'chatgpt' || key === 'claude')) {
    await bridge.stopOAuthCallbackServer().catch(() => {});
  }
}

async function exchangeChatGptCode(code: string, verifier: string, redirectUri: string): Promise<StoredSubCred> {
  const resp = await transportHttpRequest({
    url: CHATGPT_TOKEN_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formEncode({
      grant_type: 'authorization_code',
      client_id: CHATGPT_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    timeoutMs: 30000,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ChatGPT 换取令牌失败（HTTP ${resp.status}）`);
  }
  const json = JSON.parse(resp.body) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('ChatGPT 未返回 access_token');
  return {
    access: json.access_token,
    refresh: json.refresh_token || '',
    expires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    accountId: extractJwtAccountId(json.access_token),
  };
}

async function exchangeClaudeCode(code: string, state: string, verifier: string, redirectUri: string): Promise<StoredSubCred> {
  const resp = await transportHttpRequest({
    url: CLAUDE_TOKEN_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLAUDE_CLIENT_ID,
      code,
      state,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    timeoutMs: 30000,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Claude 换取令牌失败（HTTP ${resp.status}）`);
  }
  const json = JSON.parse(resp.body) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Claude 未返回 access_token');
  return {
    access: json.access_token,
    refresh: json.refresh_token || '',
    expires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  };
}

async function ensureFreshSubCred(key: 'chatgpt' | 'claude' | 'kimi'): Promise<StoredSubCred> {
  const store = loadStore();
  const cred = store.subCreds[key];
  if (!cred?.access) throw new Error(`请先登录 ${SUB_CATALOG[key]?.name ?? key} 订阅账号`);
  if (!cred.refresh || Date.now() < cred.expires - 120_000) return cred;

  try {
    if (key === 'chatgpt') {
      const resp = await transportHttpRequest({
        url: CHATGPT_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: formEncode({
          grant_type: 'refresh_token',
          client_id: CHATGPT_CLIENT_ID,
          refresh_token: cred.refresh,
        }),
        timeoutMs: 25000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const json = JSON.parse(resp.body) as { access_token?: string; refresh_token?: string; expires_in?: number };
        if (json.access_token) {
          const updated: StoredSubCred = {
            access: json.access_token,
            refresh: json.refresh_token || cred.refresh,
            expires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
            accountId: extractJwtAccountId(json.access_token) || cred.accountId,
          };
          store.subCreds[key] = updated;
          saveStore(store);
          return updated;
        }
      }
    } else if (key === 'claude') {
      const resp = await transportHttpRequest({
        url: CLAUDE_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: CLAUDE_CLIENT_ID,
          refresh_token: cred.refresh,
        }),
        timeoutMs: 25000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const json = JSON.parse(resp.body) as { access_token?: string; refresh_token?: string; expires_in?: number };
        if (json.access_token) {
          const updated: StoredSubCred = {
            access: json.access_token,
            refresh: json.refresh_token || cred.refresh,
            expires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
          };
          store.subCreds[key] = updated;
          saveStore(store);
          return updated;
        }
      }
    } else if (key === 'kimi') {
      const resp = await transportHttpRequest({
        url: KIMI_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: formEncode({
          grant_type: 'refresh_token',
          client_id: KIMI_CLIENT_ID,
          refresh_token: cred.refresh,
        }),
        timeoutMs: 25000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const json = JSON.parse(resp.body) as { access_token?: string; refresh_token?: string; expires_in?: number };
        if (json.access_token) {
          const updated: StoredSubCred = {
            access: json.access_token,
            refresh: json.refresh_token || cred.refresh,
            expires: Date.now() + (Number(json.expires_in) || 3600) * 1000,
          };
          store.subCreds[key] = updated;
          saveStore(store);
          return updated;
        }
      }
    }
  } catch {
    // 刷新失败时先尝试旧 token，调用报错时再提示重登
  }
  return cred;
}

function parseManualCodeInput(raw: string): { code: string; state?: string } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('请粘贴浏览器回调地址或授权码');
  if (/^https?:\/\//i.test(trimmed)) {
    const u = new URL(trimmed);
    const code = u.searchParams.get('code') || '';
    const state = u.searchParams.get('state') || undefined;
    if (!code) throw new Error('回调地址中未找到 code 参数');
    return { code, state };
  }
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#');
    if (code) return { code: code.trim(), state: state?.trim() };
  }
  return { code: trimmed };
}

async function finishOAuthLogin(session: ActiveLoginSession, code: string, returnedState?: string): Promise<void> {
  if (session.cancelled) return;
  if (returnedState && session.oauthState && returnedState !== session.oauthState) {
    session.state = 'failed';
    session.error = 'OAuth 状态校验不匹配，请重新点击登录';
    return;
  }
  try {
    const cred = session.key === 'chatgpt'
      ? await exchangeChatGptCode(code, session.verifier || '', session.redirectUri || CHATGPT_REDIRECT_URI)
      : await exchangeClaudeCode(code, returnedState || session.oauthState || '', session.verifier || '', session.redirectUri || CLAUDE_REDIRECT_URI);
    const store = loadStore();
    store.subCreds[session.key] = cred;
    store.activeProvider = `sub:${session.key}`;
    if (!store.subModels[session.key]) store.subModels[session.key] = SUB_CATALOG[session.key].defaultModel;
    if (!store.subThinking[session.key]) store.subThinking[session.key] = 'low';
    saveStore(store);
    quotaCache.delete(session.key);
    session.state = 'completed';
    if (session.listenerRemove) {
      await session.listenerRemove().catch(() => {});
      session.listenerRemove = undefined;
    }
  } catch (err) {
    session.state = 'failed';
    session.error = err instanceof Error ? err.message : '登录交换令牌失败';
  }
}

async function startSubLogin(providerKey: string, method?: string): Promise<Record<string, unknown>> {
  const key = providerKey.replace(/^sub:/, '') as 'chatgpt' | 'claude' | 'kimi' | 'gemini';
  if (key === 'gemini') {
    throw new Error('手机端与 PWA 不支持电脑命令行 Gemini CLI；请在下方「API Key」中填写 Google AI Studio 免费 API Key，即可直接用 Gemini 4 Neon。');
  }
  const bridge = getNativeBridge();

  await cleanupLoginSession(key);

  // 仅当用户显式点击「设备码登录（免回调）」时走设备码流；默认统一走标准 OAuth（无需去安全设置开开关）
  if (key === 'chatgpt' && method === 'device_code') {
    const resp = await transportHttpRequest({
      url: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
      timeoutMs: 25000,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`ChatGPT 设备码申请失败（HTTP ${resp.status}），请稍后重试或安装 Android APK 客户端`);
    }
    const json = JSON.parse(resp.body) as { device_auth_id?: string; user_code?: string; interval?: number };
    if (!json.device_auth_id || !json.user_code) throw new Error('ChatGPT 未返回有效设备码');
    const authUrl = 'https://auth.openai.com/codex/device';
    const session: ActiveLoginSession = {
      key: 'chatgpt',
      state: 'pending',
      authUrl,
      userCode: json.user_code,
      verificationUri: authUrl,
      instructions: `请在浏览器打开页面并输入设备码 ${json.user_code}，确认后会自动保存登录状态（无需电脑端）。`,
    };
    loginSessions.set('chatgpt', session);
    void openAuthPage(authUrl).catch(() => {});

    const intervalMs = Math.max(3000, (Number(json.interval) || 5) * 1000);
    const deadline = Date.now() + 15 * 60 * 1000;
    void (async () => {
      while (!session.cancelled && session.state === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (session.cancelled || session.state !== 'pending') break;
        try {
          const poll = await transportHttpRequest({
            url: 'https://auth.openai.com/api/accounts/deviceauth/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              device_auth_id: json.device_auth_id,
              user_code: json.user_code,
            }),
            timeoutMs: 20000,
          });
          if (poll.status >= 200 && poll.status < 300) {
            const data = JSON.parse(poll.body || '{}') as { authorization_code?: string; code_verifier?: string };
            if (data.authorization_code && data.code_verifier) {
              const cred = await exchangeChatGptCode(
                data.authorization_code,
                data.code_verifier,
                'https://auth.openai.com/deviceauth/callback',
              );
              const store = loadStore();
              store.subCreds.chatgpt = cred;
              store.activeProvider = 'sub:chatgpt';
              if (!store.subModels.chatgpt) store.subModels.chatgpt = SUB_CATALOG.chatgpt.defaultModel;
              if (!store.subThinking.chatgpt) store.subThinking.chatgpt = 'low';
              saveStore(store);
              quotaCache.delete('chatgpt');
              session.state = 'completed';
              return;
            }
          }
        } catch {
          // keep polling
        }
      }
      if (!session.cancelled && session.state === 'pending') {
        session.state = 'failed';
        session.error = '设备码登录超时，请重试';
      }
    })();

    return {
      status: 'pending',
      authUrl: session.authUrl,
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      instructions: session.instructions,
    };
  }

  if (key === 'kimi') {
    const resp = await transportHttpRequest({
      url: KIMI_DEVICE_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formEncode({ client_id: KIMI_CLIENT_ID }),
      timeoutMs: 25000,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Kimi 设备码申请失败（HTTP ${resp.status}）`);
    }
    const json = JSON.parse(resp.body) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      interval?: number;
      expires_in?: number;
    };
    if (!json.device_code || !json.user_code) throw new Error('Kimi 未返回有效的设备码');
    const authUrl = json.verification_uri_complete || json.verification_uri || 'https://www.kimi.com/code';
    const session: ActiveLoginSession = {
      key: 'kimi',
      state: 'pending',
      authUrl,
      userCode: json.user_code,
      verificationUri: json.verification_uri || authUrl,
      instructions: `请在浏览器中确认设备码 ${json.user_code}，确认后会自动保存登录状态。`,
    };
    loginSessions.set('kimi', session);
    void openAuthPage(authUrl).catch(() => {});

    // 后台轮询 Kimi 设备码
    const intervalMs = Math.max(3000, (Number(json.interval) || 5) * 1000);
    const deadline = Date.now() + Math.min(900, Number(json.expires_in) || 600) * 1000;
    void (async () => {
      while (!session.cancelled && session.state === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (session.cancelled || session.state !== 'pending') break;
        try {
          const poll = await transportHttpRequest({
            url: KIMI_TOKEN_URL,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: formEncode({
              client_id: KIMI_CLIENT_ID,
              device_code: json.device_code || '',
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
            timeoutMs: 20000,
          });
          const data = JSON.parse(poll.body || '{}') as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            error?: string;
          };
          if (poll.status >= 200 && poll.status < 300 && data.access_token) {
            const store = loadStore();
            store.subCreds.kimi = {
              access: data.access_token,
              refresh: data.refresh_token || '',
              expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
            };
            store.activeProvider = 'sub:kimi';
            if (!store.subModels.kimi) store.subModels.kimi = SUB_CATALOG.kimi.defaultModel;
            if (!store.subThinking.kimi) store.subThinking.kimi = 'low';
            saveStore(store);
            session.state = 'completed';
            return;
          }
          if (data.error === 'expired_token' || data.error === 'access_denied') {
            session.state = 'failed';
            session.error = data.error === 'access_denied' ? '已拒绝授权' : '设备码已过期，请重试';
            return;
          }
        } catch {
          // continue polling
        }
      }
      if (!session.cancelled && session.state === 'pending') {
        session.state = 'failed';
        session.error = '设备码确认超时，请重试';
      }
    })();

    return {
      status: 'pending',
      authUrl: session.authUrl,
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      instructions: session.instructions,
    };
  }

  // ChatGPT / Claude 标准 OAuth PKCE（同步构造链接，避免浏览器拦截弹窗）
  const { verifier, challenge, state } = generatePkceSync();
  const isChatGpt = key === 'chatgpt';
  const port = isChatGpt ? 1455 : 53692;
  const callbackPath = isChatGpt ? '/auth/callback' : '/callback';
  const redirectUri = isChatGpt
    ? CHATGPT_REDIRECT_URI
    : (bridge ? CLAUDE_REDIRECT_URI : CLAUDE_COPY_CODE_REDIRECT_URI);

  const params = new URLSearchParams(
    isChatGpt
      ? {
          response_type: 'code',
          client_id: CHATGPT_CLIENT_ID,
          redirect_uri: redirectUri,
          scope: 'openid profile email offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
          originator: 'pi',
        }
      : {
          code: 'true',
          client_id: CLAUDE_CLIENT_ID,
          response_type: 'code',
          redirect_uri: redirectUri,
          scope: CLAUDE_SCOPES,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        },
  );
  const authUrl = `${isChatGpt ? CHATGPT_AUTHORIZE_URL : CLAUDE_AUTHORIZE_URL}?${params.toString()}`;

  // 无原生桥接（PWA 网页版）时在进入任何 await 前同步打开授权页，防止 Chrome / Safari 拦截弹窗
  if (!bridge) {
    try {
      window.open(authUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // 用户也可点击下方链接手动打开
    }
  }

  const session: ActiveLoginSession = {
    key,
    state: 'pending',
    authUrl,
    verifier,
    oauthState: state,
    redirectUri,
    instructions: bridge
      ? '已在手机浏览器打开登录页，完成授权后会自动跳回本机并保存；如浏览器未自动跳转，也可复制回调网址粘贴到下方完成登录。'
      : (isChatGpt
          ? '请在打开的 ChatGPT 页面点「继续」；跳转后显示无法访问页面属正常现象，复制浏览器地址栏完整网址粘贴到下方提交即可（仅需一次，之后自动续期）。'
          : '请点击上方链接完成 Claude 授权，授权后网页会显示授权码，复制粘贴到下方输入框即可完成登录并保存在本机。'),
  };
  loginSessions.set(key, session);

  if (bridge) {
    try {
      await bridge.startOAuthCallbackServer({ port, callbackPath });
      const handle = await bridge.addListener('oauthCallback', (cbParams) => {
        if (session.cancelled || session.state !== 'pending') return;
        if (cbParams.error) {
          session.state = 'failed';
          session.error = cbParams.error_description || cbParams.error;
          return;
        }
        if (cbParams.code) {
          void finishOAuthLogin(session, cbParams.code, cbParams.state);
        }
      });
      session.listenerRemove = handle.remove;
    } catch {
      // 即使本地回调端口被占用，用户仍可粘贴回调网址手动完成
    }
    await openAuthPage(authUrl);
  }

  return {
    status: 'pending',
    authUrl,
    instructions: session.instructions,
    needsCodeInput: true,
  };
}

/* ============================================================================
 * 4. 订阅剩余额度查询（ChatGPT / Claude / Kimi）
 * ========================================================================== */
export async function fetchMobileSubscriptionQuota(idOrKey: string, force = false): Promise<SubscriptionQuota> {
  const key = idOrKey.replace(/^sub:/, '') as 'chatgpt' | 'claude' | 'kimi' | 'gemini';
  const spec = SUB_CATALOG[key];
  if (!spec) return { status: 'disconnected', title: '', note: '不支持的订阅', manageUrl: '' };
  if (key === 'gemini') {
    return { status: 'disconnected', title: 'Gemini', note: '手机端请使用 Google Gemini API Key', manageUrl: spec.manageUrl };
  }

  const store = loadStore();
  if (!store.subCreds[key]?.access) {
    return { status: 'disconnected', title: '', note: '未登录', manageUrl: spec.manageUrl };
  }

  const cached = quotaCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < 60_000) return cached.value;

  try {
    const cred = await ensureFreshSubCred(key);
    if (key === 'chatgpt') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${cred.access}`,
        Accept: 'application/json',
        'User-Agent': 'codex_cli_rs/0.38.0',
      };
      if (cred.accountId) headers['chatgpt-account-id'] = cred.accountId;
      const resp = await transportHttpRequest({
        url: 'https://chatgpt.com/backend-api/wham/usage',
        method: 'GET',
        headers,
        timeoutMs: 12000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const data = JSON.parse(resp.body) as {
          rate_limit?: {
            primary_window?: { used_percent?: number; reset_at?: number };
            secondary_window?: { used_percent?: number; reset_at?: number };
          };
          plan_type?: string;
        };
        const secondary = data.rate_limit?.secondary_window;
        const primary = data.rate_limit?.primary_window;
        if (typeof secondary?.used_percent === 'number' || typeof primary?.used_percent === 'number') {
          const mainWindow = secondary ?? primary;
          const remaining = Math.max(0, Math.min(100, Math.round(100 - (mainWindow?.used_percent ?? 0))));
          const fiveHourRemaining = typeof primary?.used_percent === 'number'
            ? Math.max(0, Math.min(100, Math.round(100 - primary.used_percent)))
            : undefined;
          const value: SubscriptionQuota = {
            status: 'ok',
            title: secondary ? '7 天剩余额度' : '5 小时剩余额度',
            remainingPercent: remaining,
            resetsAt: mainWindow?.reset_at ? new Date(mainWindow.reset_at * 1000).toISOString() : undefined,
            fiveHourRemainingPercent: secondary ? fiveHourRemaining : undefined,
            fiveHourResetsAt: secondary && primary?.reset_at ? new Date(primary.reset_at * 1000).toISOString() : undefined,
            note: data.plan_type ? `当前订阅：${data.plan_type}` : undefined,
            manageUrl: spec.manageUrl,
          };
          quotaCache.set(key, { fetchedAt: Date.now(), value });
          return value;
        }
      }
      const fallback: SubscriptionQuota = {
        status: 'info',
        title: 'ChatGPT 订阅',
        note: '已登录并保存在本机，可点击「查看用量」前往官网查看详细限额',
        manageUrl: spec.manageUrl,
      };
      quotaCache.set(key, { fetchedAt: Date.now(), value: fallback });
      return fallback;
    }

    if (key === 'claude') {
      const resp = await transportHttpRequest({
        url: 'https://api.anthropic.com/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cred.access}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.0',
          Accept: 'application/json',
        },
        timeoutMs: 12000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const data = JSON.parse(resp.body) as {
          seven_day?: { utilization?: number; resets_at?: string };
          five_hour?: { utilization?: number; resets_at?: string };
        };
        if (typeof data.seven_day?.utilization === 'number') {
          const remaining = Math.max(0, Math.min(100, Math.round(100 - data.seven_day.utilization)));
          const fiveHourRemaining = typeof data.five_hour?.utilization === 'number'
            ? Math.max(0, Math.min(100, Math.round(100 - data.five_hour.utilization)))
            : undefined;
          const value: SubscriptionQuota = {
            status: 'ok',
            title: '7 天剩余额度',
            remainingPercent: remaining,
            resetsAt: data.seven_day.resets_at,
            fiveHourRemainingPercent: fiveHourRemaining,
            fiveHourResetsAt: data.five_hour?.resets_at,
            manageUrl: spec.manageUrl,
          };
          quotaCache.set(key, { fetchedAt: Date.now(), value });
          return value;
        }
      }
      const fallback: SubscriptionQuota = {
        status: 'unavailable',
        title: '7 天额度',
        note: '暂无法获取 Claude 实时额度，请在 Claude 用量设置中查看',
        manageUrl: spec.manageUrl,
      };
      quotaCache.set(key, { fetchedAt: Date.now(), value: fallback });
      return fallback;
    }

    if (key === 'kimi') {
      const resp = await transportHttpRequest({
        url: 'https://api.kimi.com/coding/v1/usages',
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.access}`, Accept: 'application/json' },
        timeoutMs: 10000,
      });
      if (resp.status >= 200 && resp.status < 300) {
        const data = JSON.parse(resp.body || '{}') as {
          usage?: { limit?: number; used?: number; remaining?: number };
        };
        const limit = Number(data.usage?.limit);
        const remainingNum = Number(data.usage?.remaining);
        if (limit > 0 && Number.isFinite(remainingNum)) {
          const pct = Math.max(0, Math.min(100, Math.round((remainingNum / limit) * 100)));
          const value: SubscriptionQuota = {
            status: 'ok',
            title: '当前周期剩余额度',
            remainingPercent: pct,
            note: `剩余 ${remainingNum} / ${limit}`,
            manageUrl: spec.manageUrl,
          };
          quotaCache.set(key, { fetchedAt: Date.now(), value });
          return value;
        }
      }
      const fallback: SubscriptionQuota = {
        status: 'info',
        title: 'Kimi Code 订阅',
        note: '已登录并保存在本机，可在 Kimi 控制台查看用量',
        manageUrl: spec.manageUrl,
      };
      quotaCache.set(key, { fetchedAt: Date.now(), value: fallback });
      return fallback;
    }
  } catch {
    // fall through
  }

  return {
    status: 'unavailable',
    title: '订阅额度',
    note: '额度刷新失败，请检查网络或稍后重试',
    manageUrl: spec.manageUrl,
  };
}

/* ============================================================================
 * 5. 构建 AiStatus 快照（供 PlannerAiSettings / ProfileView / PlannerWorkspace 消费）
 * ========================================================================== */
export function buildMobileAiStatus(): MobileAiState {
  const store = loadStore();
  const subscriptions: SubscriptionProfile[] = (['chatgpt', 'claude', 'kimi', 'gemini'] as const).map((key) => {
    const spec = SUB_CATALOG[key];
    const connected = Boolean(store.subCreds[key]?.access);
    const active = connected && store.activeProvider === `sub:${key}`;
    const model = store.subModels[key] || spec.defaultModel;
    const modelMeta = spec.models.find((m) => m.id === model) || spec.models[0];
    return {
      id: `sub:${key}`,
      key,
      name: spec.name,
      loginKind: spec.loginKind,
      connected,
      active,
      model,
      defaultModel: spec.defaultModel,
      thinking: store.subThinking[key] || 'low',
      thinkingLevels: modelMeta?.thinkingLevels ?? ['off', 'low', 'medium', 'high'],
      vision: modelMeta?.vision ?? spec.vision,
      models: spec.models,
      manageUrl: spec.manageUrl,
      search: key === 'chatgpt' ? 'direct' : 'none',
      quota: quotaCache.get(key)?.value ?? (connected ? { status: 'info', title: '已登录', note: '点击刷新查看最新剩余额度', manageUrl: spec.manageUrl } : null),
      cliInstalled: false,
      cliLoggedIn: false,
    };
  });

  const saved: SavedAiProfile[] = [];
  for (const sub of subscriptions) {
    if (sub.connected) {
      saved.push({
        id: sub.id,
        label: `${sub.name} 订阅`,
        model: sub.model,
        thinking: sub.thinking,
        thinkingLevels: sub.thinkingLevels,
        vision: sub.vision,
        search: sub.search,
        authMode: 'subscription',
      });
    }
  }
  for (const [provId, cfg] of Object.entries(store.apiConfigs)) {
    if (!cfg?.apiKey) continue;
    const meta = API_PROVIDERS.find((p) => p.id === provId);
    const normalizedModel = normalizeModelId(provId, cfg.model || meta?.model || '');
    const modelMeta = meta?.models.find((m: ModelCatalogItem) => m.id === normalizedModel);
    saved.push({
      id: provId,
      label: meta?.label || provId,
      model: normalizedModel,
      thinking: cfg.thinking || 'low',
      thinkingLevels: modelMeta?.thinkingLevels,
      vision: modelMeta?.vision ?? true,
      search: 'none',
      authMode: 'api',
    });
  }

  let activeProvider = store.activeProvider;
  if (!saved.some((item) => item.id === activeProvider)) {
    activeProvider = saved[0]?.id || 'deepseek';
  }
  const activeItem = saved.find((item) => item.id === activeProvider);
  const configured = Boolean(activeItem);
  const isSub = activeProvider.startsWith('sub:');
  const activeSub = isSub ? subscriptions.find((s) => s.id === activeProvider) : undefined;
  const activeApiCfg = !isSub ? store.apiConfigs[activeProvider] : undefined;
  const activeApiMeta = !isSub ? API_PROVIDERS.find((p) => p.id === activeProvider) : undefined;
  const activeModel = normalizeModelId(
    activeProvider,
    activeSub?.model || activeApiCfg?.model || activeApiMeta?.model || 'deepseek-flash',
  );
  const activeModelsList: ModelCatalogItem[] = activeSub?.models || activeApiMeta?.models || [];
  const activeModelMeta = activeModelsList.find((m: ModelCatalogItem) => m.id === activeModel);

  return {
    configured,
    provider: activeProvider,
    authMode: isSub ? 'subscription' : 'api',
    label: activeItem?.label || activeApiMeta?.label || '',
    model: activeModel,
    modelId: activeModel,
    models: activeModelsList,
    baseUrl: activeApiCfg?.baseUrl || activeApiMeta?.baseUrl || '',
    keyConfigured: Boolean(activeApiCfg?.apiKey),
    thinking: activeSub?.thinking || activeApiCfg?.thinking || 'low',
    thinkingLevels: activeModelMeta?.thinkingLevels ?? ['off', 'low', 'medium', 'high'],
    vision: activeModelMeta?.vision ?? true,
    searchAvailable: activeProvider === 'sub:chatgpt',
    searchLabel: activeProvider === 'sub:chatgpt' ? 'ChatGPT 内置联网' : '',
    saved,
    subscriptions,
    providers: API_PROVIDERS,
  };
}

/* ============================================================================
 * 6. 底层手机端原生 AI 模型调用（支持 ChatGPT 订阅 / Claude 订阅 / Kimi / 全 API）
 * ========================================================================== */
function parseSseResponsesText(sseBody: string): { text: string; inputTokens: number; outputTokens: number } {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for (const rawLine of sseBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const evt = JSON.parse(payload) as Record<string, unknown>;
      if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        text += evt.delta;
      } else if (evt.type === 'response.completed' && evt.response && typeof evt.response === 'object') {
        const resp = evt.response as {
          output_text?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (!text && typeof resp.output_text === 'string') text = resp.output_text;
        inputTokens = Number(resp.usage?.input_tokens) || inputTokens;
        outputTokens = Number(resp.usage?.output_tokens) || outputTokens;
      }
    } catch {
      // skip malformed SSE chunk
    }
  }
  return { text, inputTokens, outputTokens };
}

interface MobileCallOverride {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  thinking?: string;
}

async function callMobileModel(
  systemPrompt: string,
  userPrompt: string,
  {
    maxTokens = 4096,
    timeoutMs = 120000,
    override,
  }: { maxTokens?: number; timeoutMs?: number; override?: MobileCallOverride } = {},
): Promise<{ text: string; latencyMs: number; model: string; provider: string; label: string; thinkingUsed: string }> {
  const status = buildMobileAiStatus();
  const store = loadStore();
  const provider = (override?.provider || '').trim() || status.provider;
  const isSub = provider.startsWith('sub:');
  const subKey = isSub ? provider.slice(4) : '';
  const apiMeta = !isSub ? API_PROVIDERS.find((p) => p.id === provider) : undefined;
  const subMeta = isSub ? SUB_CATALOG[subKey] : undefined;
  const savedApiCfg = !isSub ? store.apiConfigs[provider] : undefined;
  const hasCred = isSub
    ? Boolean(store.subCreds[subKey]?.access)
    : Boolean((override?.apiKey || '').trim() || savedApiCfg?.apiKey);
  if (!override && !status.configured) throw new Error('请先在 AI 设置中登录订阅账号或填入 API Key');
  if (!hasCred) {
    throw new Error(
      isSub
        ? `请先登录 ${subMeta?.name ?? provider} 订阅账号`
        : `请先填写 ${apiMeta?.label || provider} 的 API Key`,
    );
  }

  const rawModel =
    (override?.model || '').trim() ||
    (isSub ? store.subModels[subKey] : savedApiCfg?.model) ||
    (provider === status.provider ? status.modelId || status.model : '');
  const modelId = normalizeModelId(provider, rawModel);
  const thinkingUsed =
    (override?.thinking || '').trim() ||
    (isSub ? store.subThinking[subKey] : savedApiCfg?.thinking) ||
    status.thinking ||
    'low';
  const providerLabel = isSub ? `${subMeta?.name ?? subKey} 订阅` : (apiMeta?.label || provider);
  const displayLabel = modelId ? `${providerLabel} · ${modelId}` : providerLabel;
  const startedAt = Date.now();

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === 'sub:chatgpt') {
    const cred = await ensureFreshSubCred('chatgpt');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cred.access}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      originator: 'pi',
      'User-Agent': 'codex_cli_rs/0.38.0',
    };
    if (cred.accountId) headers['chatgpt-account-id'] = cred.accountId;
    const resp = await transportHttpRequest({
      url: 'https://chatgpt.com/backend-api/codex/responses',
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        instructions: systemPrompt,
        input: [{ role: 'user', content: [{ type: 'input_text', text: userPrompt }] }],
        stream: true,
        store: false,
      }),
      timeoutMs,
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('ChatGPT 登录已过期，请在 AI 设置中重新登录 ChatGPT');
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`ChatGPT 请求失败（HTTP ${resp.status}）：${resp.body.slice(0, 180)}`);
    }
    if (resp.body.includes('data:')) {
      const parsed = parseSseResponsesText(resp.body);
      text = parsed.text;
      inputTokens = parsed.inputTokens;
      outputTokens = parsed.outputTokens;
    } else {
      const json = JSON.parse(resp.body) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      text = json.output_text || json.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('') || '';
      inputTokens = Number(json.usage?.input_tokens) || 0;
      outputTokens = Number(json.usage?.output_tokens) || 0;
    }
  } else if (provider === 'sub:claude' || provider === 'sub:kimi' || provider === 'anthropic') {
    const isSubClaude = provider === 'sub:claude';
    const isSubKimi = provider === 'sub:kimi';
    let url = 'https://api.anthropic.com/v1/messages';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (isSubClaude) {
      const cred = await ensureFreshSubCred('claude');
      headers.Authorization = `Bearer ${cred.access}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
      headers['User-Agent'] = 'claude-code/2.1.0';
    } else if (isSubKimi) {
      const cred = await ensureFreshSubCred('kimi');
      url = 'https://api.kimi.com/coding/v1/messages';
      headers.Authorization = `Bearer ${cred.access}`;
    } else {
      const cfg = store.apiConfigs.anthropic;
      const apiKey = (override?.apiKey || '').trim() || cfg?.apiKey || '';
      if (!apiKey) throw new Error('请先填写 Anthropic API Key');
      const base = ((override?.baseUrl || '').trim() || cfg?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      url = `${base}/v1/messages`;
      headers['x-api-key'] = apiKey;
    }

    const resp = await transportHttpRequest({
      url,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      timeoutMs,
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`${providerLabel} 鉴权失败（HTTP ${resp.status}），请检查登录状态或 API Key`);
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`AI 请求失败（HTTP ${resp.status}）：${resp.body.slice(0, 180)}`);
    }
    const json = JSON.parse(resp.body) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    text = (json.content ?? []).filter((b) => b.type === 'text' || typeof b.text === 'string').map((b) => b.text ?? '').join('\n');
    inputTokens = Number(json.usage?.input_tokens) || 0;
    outputTokens = Number(json.usage?.output_tokens) || 0;
  } else {
    // OpenAI 兼容接口（DeepSeek / OpenAI / Gemini / 通义千问 / 智谱 / Kimi API / 豆包 / 自定义）
    const cfg = store.apiConfigs[provider];
    const meta = API_PROVIDERS.find((p) => p.id === provider);
    const apiKey = (override?.apiKey || '').trim() || cfg?.apiKey || '';
    if (!apiKey) throw new Error(`请先填写 ${meta?.label || provider} 的 API Key`);
    const base = ((override?.baseUrl || '').trim() || cfg?.baseUrl || meta?.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('请填写有效的接口地址（Base URL）');
    const url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
    const resp = await transportHttpRequest({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      timeoutMs,
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`${meta?.label || provider} API Key 无效或无权限（HTTP ${resp.status}）`);
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`AI 请求失败（HTTP ${resp.status}）：${resp.body.slice(0, 180)}`);
    }
    const json = JSON.parse(resp.body) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    text = json.choices?.[0]?.message?.content ?? '';
    inputTokens = Number(json.usage?.prompt_tokens) || 0;
    outputTokens = Number(json.usage?.completion_tokens) || 0;
  }

  // 若服务端未返回 usage 字段，按字符粗估以便统计面板有直观反馈
  if (!inputTokens && !outputTokens) {
    inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 2.2);
    outputTokens = Math.ceil(text.length / 2.2);
  }
  recordAiUsage({
    provider,
    label: providerLabel,
    authMode: isSub ? 'subscription' : 'api',
    model: modelId,
    inputTokens,
    outputTokens,
  });

  return {
    text: text.trim(),
    latencyMs: Date.now() - startedAt,
    model: modelId || '',
    provider,
    label: displayLabel,
    thinkingUsed,
  };
}

function extractJsonObject<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonrepair(slice)) as T;
}

/* ============================================================================
 * 7. 统一处理手机端所有 /api/planner/* 路由
 * ========================================================================== */
export async function handleMobilePlannerApi<T>(
  endpoint: string,
  body: unknown,
  _signal: AbortSignal,
  onProgress: (stage: string) => void,
): Promise<T> {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (endpoint === 'health') {
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-settings') {
    const store = loadStore();
    if (typeof payload.provider === 'string' && payload.provider) {
      const prov = payload.provider;
      const prev = store.apiConfigs[prov];
      const meta = API_PROVIDERS.find((p) => p.id === prov);
      const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim()
        ? payload.apiKey.trim()
        : (prev?.apiKey ?? '');
      if (apiKey) {
        store.apiConfigs[prov] = {
          provider: prov,
          apiKey,
          baseUrl: typeof payload.baseUrl === 'string' && payload.baseUrl.trim() ? payload.baseUrl.trim() : (prev?.baseUrl || meta?.baseUrl || ''),
          model: normalizeModelId(
            prov,
            typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : (prev?.model || meta?.model || ''),
          ),
          thinking: typeof payload.thinking === 'string' ? payload.thinking : (prev?.thinking || 'low'),
        };
        store.activeProvider = prov;
        saveStore(store);
      }
    }
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-switch') {
    const store = loadStore();
    const prov = String(payload.provider || '');
    if (prov.startsWith('sub:')) {
      const key = prov.slice(4);
      if (store.subCreds[key]?.access) {
        store.activeProvider = prov;
        if (typeof payload.model === 'string' && payload.model.trim()) {
          store.subModels[key] = normalizeModelId(prov, payload.model);
        }
        if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.subThinking[key] = payload.thinking.trim();
        saveStore(store);
      }
    } else if (store.apiConfigs[prov]?.apiKey) {
      store.activeProvider = prov;
      if (typeof payload.model === 'string' && payload.model.trim()) {
        store.apiConfigs[prov].model = normalizeModelId(prov, payload.model);
      }
      if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.apiConfigs[prov].thinking = payload.thinking.trim();
      saveStore(store);
    }
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-test') {
    const override: MobileCallOverride | undefined =
      typeof payload.provider === 'string' && payload.provider.trim()
        ? {
            provider: payload.provider.trim(),
            apiKey: typeof payload.apiKey === 'string' ? payload.apiKey.trim() : undefined,
            model: typeof payload.model === 'string' ? payload.model.trim() : undefined,
            baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : undefined,
            thinking: typeof payload.thinking === 'string' ? payload.thinking.trim() : undefined,
          }
        : undefined;
    const startedAt = Date.now();
    try {
      const res = await callMobileModel('你是一个连通性测试助手。', '请只回复：连接正常', {
        maxTokens: 32,
        timeoutMs: 25000,
        override,
      });
      const seconds = Math.round(res.latencyMs / 100) / 10;
      const speedTier = seconds <= 2.5 ? 'fast' : seconds <= 7 ? 'normal' : 'slow';
      return {
        ok: true,
        label: res.label,
        seconds,
        speedTier,
        thinkingUsed: res.thinkingUsed,
        reply: res.text || '连接正常',
        latencyMs: res.latencyMs,
        model: res.model,
      } as unknown as T;
    } catch (error) {
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      return {
        ok: false,
        seconds,
        speedTier: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      } as unknown as T;
    }
  }

  if (endpoint === 'ai-models-refresh') {
    const status = buildMobileAiStatus();
    return { count: status.models?.length ?? 0, state: status } as unknown as T;
  }

  if (endpoint === 'ai-sub-login') {
    return await startSubLogin(String(payload.provider || ''), typeof payload.method === 'string' ? payload.method : undefined) as unknown as T;
  }

  if (endpoint === 'ai-sub-status') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    const session = loginSessions.get(key);
    if (!session) {
      const store = loadStore();
      return { status: store.subCreds[key]?.access ? 'completed' : 'idle' } as unknown as T;
    }
    return {
      status: session.state,
      authUrl: session.authUrl,
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      instructions: session.instructions,
      error: session.error,
      needsCodeInput: session.key === 'chatgpt' || session.key === 'claude',
    } as unknown as T;
  }

  if (endpoint === 'ai-sub-code') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    const session = loginSessions.get(key);
    if (!session) throw new Error('没有正在进行的登录会话，请先点击「去登录」');
    const parsed = parseManualCodeInput(String(payload.code || ''));
    await finishOAuthLogin(session, parsed.code, parsed.state);
    if (session.state === 'failed') throw new Error(session.error || '授权码验证失败');
    return { status: 'completed', settings: buildMobileAiStatus() } as unknown as T;
  }

  if (endpoint === 'ai-sub-cancel') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    await cleanupLoginSession(key);
    return { ok: true } as unknown as T;
  }

  if (endpoint === 'ai-sub-logout') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    await cleanupLoginSession(key);
    const store = loadStore();
    delete store.subCreds[key];
    if (store.activeProvider === `sub:${key}`) store.activeProvider = '';
    saveStore(store);
    quotaCache.delete(key);
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-sub-model') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    const store = loadStore();
    if (typeof payload.model === 'string' && payload.model.trim()) {
      store.subModels[key] = normalizeModelId(`sub:${key}`, payload.model);
    }
    if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.subThinking[key] = payload.thinking.trim();
    saveStore(store);
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-sub-quota') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    const quota = await fetchMobileSubscriptionQuota(key, Boolean(payload.force));
    return { quota } as unknown as T;
  }

const MOBILE_CITY_ADCODES: Array<[string, string, string]> = [
  ['北京', '110100', '110000'], ['天津', '120100', '120000'], ['上海', '310100', '310000'], ['重庆', '500100', '500000'],
  ['广州', '440100', '440000'], ['深圳', '440300', '440000'], ['珠海', '440400', '440000'], ['佛山', '440600', '440000'],
  ['潮州', '445100', '440000'], ['汕头', '440500', '440000'], ['杭州', '330100', '330000'], ['宁波', '330200', '330000'],
  ['绍兴', '330600', '330000'], ['嘉兴', '330400', '330000'], ['舟山', '330900', '330000'], ['南京', '320100', '320000'],
  ['苏州', '320500', '320000'], ['无锡', '320200', '320000'], ['扬州', '321000', '320000'], ['成都', '510100', '510000'],
  ['乐山', '511100', '510000'], ['阿坝', '513200', '510000'], ['甘孜', '513300', '510000'], ['西安', '610100', '610000'],
  ['武汉', '420100', '420000'], ['宜昌', '420500', '420000'], ['恩施', '422800', '420000'], ['长沙', '430100', '430000'],
  ['张家界', '430800', '430000'], ['湘西', '433100', '430000'], ['青岛', '370200', '370000'], ['济南', '370100', '370000'],
  ['烟台', '370600', '370000'], ['威海', '371000', '370000'], ['泰安', '370900', '370000'], ['厦门', '350200', '350000'],
  ['福州', '350100', '350000'], ['泉州', '350500', '350000'], ['三亚', '460200', '460000'], ['海口', '460100', '460000'],
  ['昆明', '530100', '530000'], ['大理', '532900', '530000'], ['丽江', '530700', '530000'], ['西双版纳', '532800', '530000'],
  ['迪庆', '533400', '530000'], ['香格里拉', '533400', '530000'], ['贵阳', '520100', '520000'], ['黔东南', '522600', '520000'],
  ['桂林', '450300', '450000'], ['北海', '450500', '450000'], ['南宁', '450100', '450000'], ['拉萨', '540100', '540000'],
  ['林芝', '540400', '540000'], ['乌鲁木齐', '650100', '650000'], ['伊犁', '654000', '650000'], ['喀什', '653100', '650000'],
  ['阿勒泰', '654300', '650000'], ['哈尔滨', '230100', '230000'], ['沈阳', '210100', '210000'], ['大连', '210200', '210000'],
  ['长春', '220100', '220000'], ['延边', '222400', '220000'], ['郑州', '410100', '410000'], ['洛阳', '410300', '410000'],
  ['开封', '410200', '410000'], ['合肥', '340100', '340000'], ['黄山', '341000', '340000'], ['南昌', '360100', '360000'],
  ['景德镇', '360200', '360000'], ['上饶', '361100', '360000'], ['太原', '140100', '140000'], ['大同', '140200', '140000'],
  ['晋中', '140700', '140000'], ['石家庄', '130100', '130000'], ['秦皇岛', '130300', '130000'], ['承德', '130800', '130000'],
  ['兰州', '620100', '620000'], ['敦煌', '620900', '620000'], ['酒泉', '620900', '620000'], ['张掖', '620700', '620000'],
  ['西宁', '630100', '630000'], ['银川', '640100', '640000'], ['呼和浩特', '150100', '150000'], ['呼伦贝尔', '150700', '150000'],
  ['香港', '810000', '810000'], ['澳门', '820000', '820000'], ['台北', '710000', '710000'],
];

function lookupMobileCity(name: string, rawCode?: unknown, rawProvinceCode?: unknown): JourneyCity {
  const cleanName = String(name || '').trim() || '目的地';
  const validCode = typeof rawCode === 'string' && /^\d{6}$/.test(rawCode.trim()) ? rawCode.trim() : '';
  const validProv = typeof rawProvinceCode === 'string' && /^\d{6}$/.test(rawProvinceCode.trim()) ? rawProvinceCode.trim() : '';
  if (validCode) {
    return { code: validCode, provinceCode: validProv || `${validCode.slice(0, 2)}0000`, name: cleanName };
  }
  const matched = MOBILE_CITY_ADCODES.find(([key]) => cleanName.includes(key) || key.includes(cleanName.replace(/[市省州区县]$/, '')));
  if (matched) {
    return { code: matched[1], provinceCode: matched[2], name: cleanName };
  }
  return { code: '110100', provinceCode: '110000', name: cleanName };
}

function mobileClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function parseMobileMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const raw = value.normalize('NFKC').replace(/：/g, ':').trim();
  const match = raw.match(/(\d{1,2})\s*(?::|点|时)\s*(半|\d{1,2})?/) ?? raw.match(/^(\d{1,2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2] === '半' ? 30 : Number(match[2] ?? 0);
  return h <= 24 && m < 60 ? Math.min(h * 60 + m, 23 * 60 + 59) : null;
}

function periodFromMinutes(minutes: number): PlannerPeriod {
  if (minutes < 11 * 60) return 'morning';
  if (minutes < 13 * 60 + 30) return 'noon';
  if (minutes < 17 * 60 + 30) return 'afternoon';
  return 'evening';
}

function normalizeMobileKind(value: unknown): PlannerActivity['kind'] {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'food' || /meal|dining|restaurant|餐饮|美食|用餐|吃饭/.test(raw)) return 'food';
  if (raw === 'transport' || /transit|traffic|transfer|交通|换乘|出行/.test(raw)) return 'transport';
  if (raw === 'rest' || /free|break|hotel|休息|自由|入住/.test(raw)) return 'rest';
  return 'sight';
}

function normalizeMobilePeriod(value: unknown, startMinutes: number): PlannerPeriod {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'morning' || raw === 'noon' || raw === 'afternoon' || raw === 'evening') return raw;
  if (/早|上午/.test(raw)) return 'morning';
  if (/中|午/.test(raw)) return 'noon';
  if (/下午/.test(raw)) return 'afternoon';
  if (/晚|夜/.test(raw)) return 'evening';
  return periodFromMinutes(startMinutes);
}

function normalizeMobileMeal(value: unknown, kind: PlannerActivity['kind'], startMinutes: number): PlannerActivity['meal'] {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'breakfast' || raw === 'lunch' || raw === 'dinner' || raw === 'snack') return raw;
  if (/早/.test(raw)) return 'breakfast';
  if (/午/.test(raw)) return 'lunch';
  if (/晚/.test(raw)) return 'dinner';
  if (/小吃|夜宵|茶/.test(raw)) return 'snack';
  if (kind !== 'food') return null;
  if (startMinutes < 10 * 60 + 30) return 'breakfast';
  if (startMinutes < 14 * 60 + 30) return 'lunch';
  if (startMinutes >= 17 * 60 && startMinutes <= 21 * 60) return 'dinner';
  return 'snack';
}

function normalizeMobileCosts(
  rawCosts: unknown,
  prefix: string,
  usedCostIds: Set<string>,
  defaultCategory: PlannerCost['category'],
  fallbackCents?: unknown,
  fallbackLabel?: string,
): PlannerCost[] {
  const list = Array.isArray(rawCosts) ? rawCosts : [];
  const validCategories = new Set<PlannerCost['category']>(['transport', 'lodging', 'tickets', 'food', 'other']);
  const validUnits = new Set<PlannerCost['unit']>(['ticket', 'person', 'room', 'vehicle', 'group']);
  const out: PlannerCost[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `${prefix}-${i + 1}`;
    while (usedCostIds.has(id)) id = `${prefix}-${i + 1}-${usedCostIds.size + 1}`;
    usedCostIds.add(id);
    const cat = validCategories.has(item.category as PlannerCost['category'])
      ? (item.category as PlannerCost['category'])
      : defaultCategory;
    const unit = validUnits.has(item.unit as PlannerCost['unit'])
      ? (item.unit as PlannerCost['unit'])
      : (cat === 'tickets' ? 'ticket' : cat === 'lodging' ? 'room' : cat === 'food' ? 'person' : 'group');
    const rawPrice = item.unitPriceCents;
    const unitPriceCents =
      typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice >= 0
        ? Math.round(rawPrice)
        : null;
    const qty = typeof item.quantity === 'number' && Number.isSafeInteger(item.quantity) && item.quantity >= 1 ? item.quantity : 1;
    const occ = typeof item.occurrences === 'number' && Number.isSafeInteger(item.occurrences) && item.occurrences >= 1 ? item.occurrences : 1;
    out.push({
      id,
      label: String(item.label ?? fallbackLabel ?? '预估费用').trim() || '预估费用',
      category: cat,
      unit,
      unitPriceCents,
      studentPriceCents: typeof item.studentPriceCents === 'number' && Number.isFinite(item.studentPriceCents) && item.studentPriceCents >= 0 ? Math.round(item.studentPriceCents) : null,
      seniorPriceCents: typeof item.seniorPriceCents === 'number' && Number.isFinite(item.seniorPriceCents) && item.seniorPriceCents >= 0 ? Math.round(item.seniorPriceCents) : null,
      childPriceCents: typeof item.childPriceCents === 'number' && Number.isFinite(item.childPriceCents) && item.childPriceCents >= 0 ? Math.round(item.childPriceCents) : null,
      quantity: qty,
      occurrences: occ,
      status: unitPriceCents === null ? 'unknown' : 'estimate',
      qualification: String(item.qualification ?? '').trim(),
      sourceIds: [],
      includedIn: null,
    });
  }
  if (!out.length && typeof fallbackCents === 'number' && Number.isFinite(fallbackCents) && fallbackCents > 0) {
    let id = `${prefix}-1`;
    while (usedCostIds.has(id)) id = `${prefix}-${usedCostIds.size + 1}`;
    usedCostIds.add(id);
    out.push({
      id,
      label: fallbackLabel || '预估费用',
      category: defaultCategory,
      unit: defaultCategory === 'tickets' ? 'ticket' : defaultCategory === 'lodging' ? 'room' : 'person',
      unitPriceCents: Math.round(fallbackCents),
      studentPriceCents: null,
      seniorPriceCents: null,
      childPriceCents: null,
      quantity: 1,
      occurrences: 1,
      status: 'estimate',
      qualification: '',
      sourceIds: [],
      includedIn: null,
    });
  }
  return out;
}

function normalizeMobileRequest(rawReq: unknown): PlannerRequest {
  const base = freshPlannerRequest();
  const src = rawReq && typeof rawReq === 'object' ? (rawReq as Partial<PlannerRequest>) : {};
  const merged: PlannerRequest = {
    ...base,
    destination: typeof src.destination === 'string' ? src.destination : base.destination,
    base: typeof src.base === 'string' ? src.base : base.base,
    people: typeof src.people === 'number' && Number.isSafeInteger(src.people) && src.people >= 1 ? src.people : base.people,
    students: typeof src.students === 'number' && Number.isInteger(src.students) && src.students >= 0 ? src.students : 0,
    seniors: typeof src.seniors === 'number' && Number.isInteger(src.seniors) && src.seniors >= 0 ? src.seniors : 0,
    children: typeof src.children === 'number' && Number.isInteger(src.children) && src.children >= 0 ? src.children : 0,
    travelersText: typeof src.travelersText === 'string' ? src.travelersText : '',
    startDate: typeof src.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.startDate) ? src.startDate : base.startDate,
    days: typeof src.days === 'number' && Number.isSafeInteger(src.days) && src.days >= 1 ? src.days : null,
    endDate: typeof src.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.endDate) ? src.endDate : '',
    budgetCents: typeof src.budgetCents === 'number' && Number.isSafeInteger(src.budgetCents) && src.budgetCents >= 0 ? src.budgetCents : null,
    pace: typeof src.pace === 'string' && src.pace.trim() ? src.pace : base.pace,
    transport: plannerLocalTransport(typeof src.transport === 'string' ? src.transport : base.transport),
    luggageMode: src.luggageMode === 'backpack' ? 'backpack' : 'suitcase',
    foodMode: Boolean(src.foodMode),
    skipBreakfast: Boolean(src.skipBreakfast),
    dietary: typeof src.dietary === 'string' ? src.dietary : '',
    lodgingLevel: typeof src.lodgingLevel === 'string' && src.lodgingLevel.trim() ? src.lodgingLevel : base.lodgingLevel,
    rooms: typeof src.rooms === 'number' && Number.isSafeInteger(src.rooms) && src.rooms >= 1 ? src.rooms : null,
    notes: typeof src.notes === 'string' ? src.notes : '',
  };
  if (merged.students + (merged.seniors ?? 0) + (merged.children ?? 0) > merged.people) {
    merged.students = 0;
    merged.seniors = 0;
    merged.children = 0;
  }
  const synced = merged.endDate
    ? updatePlannerDates(merged, { endDate: merged.endDate })
    : updatePlannerDates(merged, { days: merged.days ?? 3 });
  if (!synced.days || synced.days < 1) {
    return updatePlannerDates(synced, { days: 3 });
  }
  return synced;
}

function normalizeMobilePlanContent(raw: Record<string, unknown>, rawRequest: unknown): PlannerContent {
  const req = normalizeMobileRequest(rawRequest);
  const expectedDays = req.endDate ? plannerDayCount(req.startDate, req.endDate) : (req.days ?? 3);
  const rawCities = Array.isArray(raw.cities) ? raw.cities : [];
  const cities: JourneyCity[] = rawCities
    .map((item) => {
      if (typeof item === 'string') return lookupMobileCity(item);
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return lookupMobileCity(String(obj.name ?? obj.city ?? ''), obj.code, obj.provinceCode);
    })
    .filter((c): c is JourneyCity => Boolean(c));
  if (!cities.length) {
    cities.push(lookupMobileCity(req.destination || String(raw.destination ?? '') || '北京'));
  }
  const primaryCity = cities[0].name;

  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  const usedActIds = new Set<string>();
  const usedCostIds = new Set<string>();
  const days: PlannerDay[] = [];

  for (let d = 0; d < expectedDays; d += 1) {
    const srcDay = (rawDays[d] && typeof rawDays[d] === 'object' ? rawDays[d] : {}) as Record<string, unknown>;
    const date = addPlannerDays(req.startDate, d);
    const dayCity = String(srcDay.city ?? primaryCity).trim() || primaryCity;
    const rawActs = Array.isArray(srcDay.activities)
      ? srcDay.activities
      : Array.isArray(srcDay.items)
        ? srcDay.items
        : [];
    const activities: PlannerActivity[] = [];
    let cursor = 9 * 60;

    for (let i = 0; i < rawActs.length; i += 1) {
      const a = rawActs[i] as Record<string, unknown> | null;
      if (!a || typeof a !== 'object') continue;
      let id = typeof a.id === 'string' && a.id.trim() ? a.id.trim() : `d${d + 1}-a${i + 1}`;
      while (usedActIds.has(id)) id = `d${d + 1}-a${i + 1}-${usedActIds.size + 1}`;
      usedActIds.add(id);

      const kind = normalizeMobileKind(a.kind);
      const parsedStart = parseMobileMinutes(a.startTime) ?? parseMobileMinutes(a.time) ?? cursor;
      const startMin = Math.min(22 * 60 + 30, Math.max(6 * 60, parsedStart));
      const dur = typeof a.durationMinutes === 'number' && a.durationMinutes > 0 ? Math.min(360, Math.round(a.durationMinutes)) : 90;
      const parsedEnd = parseMobileMinutes(a.endTime);
      const endMin = parsedEnd !== null && parsedEnd > startMin
        ? Math.min(23 * 60 + 55, parsedEnd)
        : Math.min(23 * 60 + 55, startMin + Math.max(30, dur));
      cursor = Math.min(22 * 60, endMin + 30);

      let meal = normalizeMobileMeal(a.meal, kind, startMin);
      if (req.skipBreakfast && meal === 'breakfast') meal = null;

      const defaultCat: PlannerCost['category'] =
        kind === 'food' ? 'food' : kind === 'transport' ? 'transport' : kind === 'sight' ? 'tickets' : 'other';
      const title = String(a.title ?? a.name ?? `${dayCity}行程安排`).trim() || `${dayCity}行程安排`;
      const costs = normalizeMobileCosts(
        a.costs,
        `cost-${d + 1}-${i + 1}`,
        usedCostIds,
        defaultCat,
        a.estimatedCostCents,
        title,
      );

      const rawDistanceKm =
        kind === 'transport' && typeof a.distanceKm === 'number' && Number.isFinite(a.distanceKm) && a.distanceKm > 0
          ? Math.round(a.distanceKm * 100) / 100
          : undefined;
      const rawTransferOpts =
        kind === 'transport' && Array.isArray(a.transferOptions)
          ? normalizeSingleTransferOptions(a.transferOptions, isSelfDriveTransport(req.transport))
          : undefined;

      activities.push({
        id,
        kind,
        period: normalizeMobilePeriod(a.period, startMin),
        startTime: mobileClock(startMin),
        endTime: mobileClock(endMin),
        title,
        city: String(a.city ?? dayCity).trim() || dayCity,
        location: String(a.location ?? title).trim() || title,
        description: String(a.description ?? a.detail ?? a.tips ?? '').trim(),
        transportMode: kind === 'transport' ? (String(a.transportMode ?? req.transport).trim() || '公共交通') : '',
        ...(rawDistanceKm !== undefined ? { distanceKm: rawDistanceKm } : {}),
        ...(rawTransferOpts?.length ? { transferOptions: rawTransferOpts } : {}),
        meal,
        locked: false,
        photo: null,
        sourceIds: [],
        costs,
        fromActivityId: null,
        toActivityId: null,
      });
    }

    if (!activities.length) {
      const id = `d${d + 1}-a1`;
      usedActIds.add(id);
      activities.push({
        id,
        kind: 'sight',
        period: 'morning',
        startTime: '09:30',
        endTime: '12:00',
        title: `${dayCity}核心地标漫游`,
        city: dayCity,
        location: `${dayCity}市区`,
        description: '自由探索当地代表性街区与风物。',
        transportMode: '',
        meal: null,
        locked: false,
        photo: null,
        sourceIds: [],
        costs: [],
        fromActivityId: null,
        toActivityId: null,
      });
    }

    const isLastDay = d === expectedDays - 1;
    let lodging: PlannerDay['lodging'] = null;
    if (!isLastDay) {
      const rawLodging = srcDay.lodging && typeof srcDay.lodging === 'object'
        ? (srcDay.lodging as Record<string, unknown>)
        : null;
      const area = String(rawLodging?.area ?? srcDay.stayArea ?? `${dayCity}市中心商圈`).trim() || `${dayCity}市中心商圈`;
      const lodgingCity = String(rawLodging?.city ?? dayCity).trim() || dayCity;
      lodging = {
        city: lodgingCity,
        area,
        searchKeyword: String(rawLodging?.searchKeyword ?? `${lodgingCity} ${area} 酒店`).trim(),
        reason: String(rawLodging?.reason ?? '交通便利，方便次日游览与夜间觅食。').trim(),
        costs: normalizeMobileCosts(rawLodging?.costs, `lodging-${d + 1}`, usedCostIds, 'lodging', undefined, `${lodgingCity}住宿`),
        sourceIds: [],
      };
    }

    days.push({
      date,
      title: String(srcDay.title ?? `第 ${d + 1} 天 · ${dayCity}`).trim() || `第 ${d + 1} 天 · ${dayCity}`,
      weather: String(srcDay.weather ?? '请出发前关注当地实时天气').trim(),
      activities,
      lodging,
    });
  }

  const rawAlts = Array.isArray(raw.alternatives) ? raw.alternatives : [];
  const alternatives = rawAlts
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      title: String(item.title ?? item.name ?? '').trim(),
      city: String(item.city ?? primaryCity).trim() || primaryCity,
      reason: String(item.reason ?? item.description ?? '备选游览去处').trim(),
      rainyDay: Boolean(item.rainyDay),
    }))
    .filter((item) => Boolean(item.title));

  const rawUnvisited = Array.isArray(raw.unvisitedHighlights) ? raw.unvisitedHighlights : [];
  const unvisitedHighlights = rawUnvisited
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      title: String(item.title ?? item.name ?? '').trim(),
      city: String(item.city ?? primaryCity).trim() || primaryCity,
      grade: typeof item.grade === 'string' ? item.grade.trim() : '',
      feature: String(item.feature ?? item.reason ?? item.description ?? '').trim(),
      location: String(item.location ?? item.address ?? item.title ?? '').trim(),
    }))
    .filter((item) => Boolean(item.title))
    .slice(0, 8);

  const toStringList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((item) => String(item ?? '').trim()).filter(Boolean) : [];

  const content: PlannerContent = {
    title: String(raw.title ?? `${req.destination || primaryCity}${expectedDays}日游`).trim() || `${primaryCity}${expectedDays}日游`,
    summary: String(raw.summary ?? `围绕${primaryCity}规划的 ${expectedDays} 天行程。`).trim(),
    request: req,
    cities,
    constraints: toStringList(raw.constraints),
    warnings: toStringList(raw.warnings ?? raw.tips),
    days,
    alternatives,
    ...(unvisitedHighlights.length ? { unvisitedHighlights } : {}),
    sources: [],
  };

  let filled: PlannerContent = content;
  try {
    filled = plannerFillEstimates(content);
  } catch {
    filled = content;
  }
  validatePlannerContent(filled);
  return filled;
}

function normalizeMobileRecommendations(raw: Record<string, unknown>): {
  recommendations: DestinationRecommendation[];
  sources: PlannerSource[];
} {
  const list = Array.isArray(raw.recommendations) ? raw.recommendations : [];
  const recommendations: DestinationRecommendation[] = [];
  for (const entry of list.slice(0, 6)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const destination = String(item.destination ?? item.city ?? item.title ?? '').trim();
    const title = String(item.title ?? item.city ?? item.destination ?? '').trim();
    if (!title && !destination) continue;
    const highlights = Array.isArray(item.highlights)
      ? item.highlights.map((h) => String(h ?? '').trim()).filter(Boolean).join('、')
      : '';
    const baseReason = String(item.reason ?? item.summary ?? '').trim();
    const reason = [baseReason, highlights ? `亮点：${highlights}` : ''].filter(Boolean).join(' ') || '当季景色与体验俱佳，适合按当前节奏出行。';
    const season = String(item.season ?? item.bestSeason ?? '四季皆宜').trim();
    const rawDays = item.suggestedDays ?? item.days;
    const suggestedDays =
      typeof rawDays === 'number' && rawDays > 0
        ? `建议 ${rawDays} 天`
        : String(rawDays ?? '建议 3~4 天').trim() || '建议 3~4 天';
    const access = String(item.access ?? item.budgetHint ?? '高铁 / 航班直达').trim();
    recommendations.push({
      title: title || destination,
      destination: destination || title,
      reason,
      season,
      suggestedDays,
      access,
      photo: null,
      sourceIds: [],
    });
  }
  if (!recommendations.length) {
    throw new Error('未能生成有效的目的地推荐，请重试');
  }
  return { recommendations, sources: [] };
}

function normalizeMobileDurations(raw: Record<string, unknown>): {
  options: Array<{ days: number; title: string; reason: string }>;
  sources: PlannerSource[];
} {
  const list = Array.isArray(raw.options) ? raw.options : [];
  const options = list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const days = Math.round(Number(item.days));
      const title = String(item.title ?? item.label ?? `${days} 日游`).trim();
      const reason = String(item.reason ?? item.summary ?? '节奏适中，覆盖核心景点与当地美食。').trim();
      return { days, title, reason };
    })
    .filter((item) => Number.isInteger(item.days) && item.days >= 1 && Boolean(item.title))
    .slice(0, 3);
  if (!options.length) {
    throw new Error('建议时长无效，请重试');
  }
  return { options, sources: [] };
}

function normalizeMobilePacking(raw: Record<string, unknown>): PackingList {
  const validCategories = new Set<PackingCategory>(['documents', 'clothing', 'medicine', 'electronics', 'bookings', 'other']);
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set<string>();
  const items: PackingItem[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const row = rawItems[i] as Record<string, unknown> | null;
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name ?? row.title ?? '').trim().slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const cat = validCategories.has(row.category as PackingCategory) ? (row.category as PackingCategory) : 'other';
    const note = String(row.note ?? '').trim().slice(0, 80);
    items.push({
      id: `pack-${Date.now()}-${i + 1}`,
      category: cat,
      name,
      ...(note ? { note } : {}),
      checked: false,
    });
  }
  if (!items.length) throw new Error('未能生成有效的行前清单，请重试');
  return { items, updatedAt: new Date().toISOString(), generatedByAi: true };
}

function normalizeMobileTickets(
  raw: Record<string, unknown>,
  plan: AiTravelPlan | undefined,
): NonNullable<AiTravelPlan['ticketPlan']> {
  const days = Array.isArray(plan?.content?.days) ? plan.content.days : [];
  const sights = days.flatMap((day) =>
    (Array.isArray(day.activities) ? day.activities : [])
      .filter((item) => item.kind === 'sight' && !item.bookingId && !item.bookingTiming?.deferred)
      .map((item) => ({ activityId: item.id, title: item.title, travelDate: day.date })),
  );
  const rows = Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : [];
  const items = sights.map((sight) => {
    const row = rows.find((r) => r && r.activityId === sight.activityId) ?? {};
    const saleDate = typeof row.saleDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.saleDate) ? row.saleDate : '';
    const saleTime = typeof row.saleTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.saleTime) ? row.saleTime : '';
    const difficulty = typeof row.difficulty === 'string' && ['难', '中', '易', '待核实'].includes(row.difficulty)
      ? row.difficulty
      : '待核实';
    return {
      activityId: sight.activityId,
      title: sight.title,
      travelDate: sight.travelDate,
      ...(typeof row.bookingRequired === 'boolean' ? { bookingRequired: row.bookingRequired } : {}),
      saleDate,
      saleTime,
      difficulty,
      platform: String(row.platform ?? '官方公众号 / 小程序（请核实）').trim() || '官方预约渠道待核实',
      note: String(row.note ?? '手机直连模式未联网核验，请以景区官方公告为准。').trim(),
      sources: [] as Array<{ title: string; url: string }>,
    };
  });
  return {
    signature: '',
    checkedAt: new Date().toISOString(),
    networkAvailable: false,
    items,
  };
}

function normalizeSingleTransferOptions(
  rawOpts: unknown[],
  selfDrive: boolean,
): PlannerTransferOption[] {
  const validModes = new Set<PlannerTransferModeKind>(['walk', 'subway', 'bus', 'taxi', 'drive', 'train', 'flight', 'other']);
  const opts: PlannerTransferOption[] = [];
  for (const rawOpt of rawOpts.slice(0, selfDrive ? 1 : 4)) {
    if (!rawOpt || typeof rawOpt !== 'object') continue;
    const o = rawOpt as Record<string, unknown>;
    const mode: PlannerTransferModeKind = selfDrive
      ? 'drive'
      : validModes.has(o.mode as PlannerTransferModeKind)
        ? (o.mode as PlannerTransferModeKind)
        : 'other';
    const opt: PlannerTransferOption = {
      mode,
      ...(typeof o.recommended === 'boolean' ? { recommended: o.recommended } : {}),
      ...(typeof o.line === 'string' && o.line.trim() ? { line: o.line.trim() } : {}),
      ...(typeof o.fromStation === 'string' && o.fromStation.trim() ? { fromStation: o.fromStation.trim() } : {}),
      ...(typeof o.toStation === 'string' && o.toStation.trim() ? { toStation: o.toStation.trim() } : {}),
      ...(typeof o.transferNote === 'string' && o.transferNote.trim() ? { transferNote: o.transferNote.trim() } : {}),
      ...(typeof o.durationMinutes === 'number' && Number.isFinite(o.durationMinutes) && o.durationMinutes > 0
        ? { durationMinutes: Math.round(o.durationMinutes) }
        : {}),
      ...(typeof o.distanceKm === 'number' && Number.isFinite(o.distanceKm) && o.distanceKm > 0
        ? { distanceKm: Math.round(o.distanceKm * 100) / 100 }
        : {}),
      ...(typeof o.costCents === 'number' && Number.isFinite(o.costCents) && o.costCents >= 0
        ? { costCents: Math.round(o.costCents) }
        : {}),
      ...(o.costUnit === 'person' || o.costUnit === 'vehicle' ? { costUnit: o.costUnit } : {}),
      ...(typeof o.carpoolCostCents === 'number' && Number.isFinite(o.carpoolCostCents) && o.carpoolCostCents >= 0
        ? { carpoolCostCents: Math.round(o.carpoolCostCents) }
        : {}),
      ...(typeof o.carpoolNote === 'string' && o.carpoolNote.trim() ? { carpoolNote: o.carpoolNote.trim() } : {}),
    };
    opts.push(opt);
  }
  return opts;
}

function normalizeMobileTransfers(
  raw: Record<string, unknown>,
  allowedKeys: Set<string>,
  selfDrive: boolean,
): { legs: Record<string, PlannerTransferOption[]> } {
  const items = Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : [];
  const legs: Record<string, PlannerTransferOption[]> = {};
  for (const item of items) {
    if (!item || typeof item.key !== 'string' || !allowedKeys.has(item.key)) continue;
    const rawOpts = Array.isArray(item.transferOptions) ? item.transferOptions : [];
    const opts = normalizeSingleTransferOptions(rawOpts, selfDrive);
    if (opts.length) legs[item.key] = opts;
  }
  return { legs };
}

/** 通用公开 GET JSON 请求：原生 APK 走 NativeAiBridge，浏览器/PWA 直接 fetch（支持 CORS 的公开 API）。 */
async function fetchPublicJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const bridge = getNativeBridge();
    if (bridge) {
      const resp = await bridge.httpRequest({
        url,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ZhouyouMap/1.0 (https://zhouyou.online)',
        },
        timeoutMs,
      });
      if (resp.status >= 200 && resp.status < 300) {
        return JSON.parse(resp.body) as T;
      }
      return null;
    }
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/** 通过维基百科 / Wikimedia Commons 公开 API 搜索真实景点/城市实景图（免 Key、支持浏览器 CORS 与安卓原生）。 */
async function searchMobilePlacePhoto(
  city: string,
  title: string,
): Promise<{ url: string; sourceUrl: string; attribution: string } | null> {
  const cleanTitle = title.replace(/[·•｜|].*$/, '').replace(/（.*?）|\(.*?\)/g, '').trim();
  const shortTitle = cleanTitle
    .replace(/(?:文化旅游区|风景名胜区|旅游度假区|历史文化街区|生态旅游区|森林公园|地质公园|旅游区|风景区|景区)$/g, '')
    .trim();
  const cleanCity = city.replace(/市$/, '').trim();
  const queries = [...new Set([
    cleanTitle,
    shortTitle && shortTitle.length >= 2 ? shortTitle : '',
    cleanCity && shortTitle && !shortTitle.includes(cleanCity) ? `${cleanCity} ${shortTitle}` : '',
    cleanCity && cleanTitle && !cleanTitle.includes(cleanCity) ? `${cleanCity} ${cleanTitle}` : '',
    cleanCity,
  ].filter(Boolean))];

  const isBadImage = (url: string) =>
    /\.(svg|pdf|tif|tiff|ogv|webm)(?:$|\?)/i.test(url) ||
    /map|locator|flag|coat_of_arms|logo|icon|symbol|emblem|blank/i.test(url);

  for (const q of queries) {
    const wikiUrl =
      `https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
      '&gsrlimit=5&prop=pageimages|info&piprop=thumbnail|original&pithumbsize=960&inprop=url&format=json&origin=*';
    const data = await fetchPublicJson<{
      query?: {
        pages?: Record<string, {
          index?: number;
          title?: string;
          fullurl?: string;
          thumbnail?: { source?: string; width?: number; height?: number };
          original?: { source?: string };
        }>;
      };
    }>(wikiUrl, 7000);
    const pages = Object.values(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    for (const p of pages) {
      const img = p.thumbnail?.source || p.original?.source || '';
      if (!img || !img.startsWith('https://') || isBadImage(img)) continue;
      if (p.thumbnail?.width && p.thumbnail.width < 240) continue;
      return {
        url: img,
        sourceUrl: p.fullurl || `https://zh.wikipedia.org/wiki/${encodeURIComponent(p.title || q)}`,
        attribution: `维基百科 · ${p.title || q}`,
      };
    }
  }

  // 兜底：Wikimedia Commons 实景图搜索
  for (const q of queries.slice(0, 2)) {
    const commonsUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}` +
      '&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json&origin=*';
    const data = await fetchPublicJson<{
      query?: {
        pages?: Record<string, {
          title?: string;
          imageinfo?: Array<{ thumburl?: string; url?: string; descriptionurl?: string }>;
        }>;
      };
    }>(commonsUrl, 7000);
    for (const p of Object.values(data?.query?.pages ?? {})) {
      const info = p.imageinfo?.[0];
      const img = info?.thumburl || info?.url || '';
      if (!img || !img.startsWith('https://') || isBadImage(img)) continue;
      return {
        url: img,
        sourceUrl: info?.descriptionurl || img,
        attribution: 'Wikimedia Commons 实景图',
      };
    }
  }
  return null;
}

/** 通过 Photon / OpenStreetMap Nominatim 公开地理编码接口获取景点 WGS84 坐标。 */
async function locateSingleMobilePlace(place: { key: string; name: string; city?: string }): Promise<{
  key: string;
  status: 'located' | 'unresolved';
  latitude?: number;
  longitude?: number;
  label?: string;
  source?: string;
  sourceUrl?: string;
  precision?: 'place' | 'area';
  coordinateSystem?: string;
  reason?: string;
  candidates?: Array<{ latitude: number; longitude: number; label: string; source?: string; precision?: 'area' | 'place' }>;
}> {
  const name = String(place.name || '').trim();
  const city = String(place.city || '').trim();
  // 处理 "云南保山·腾冲" / "保山·腾冲" 这类复合地名，拆出最具体的区县/市名
  const cityParts = city
    .split(/[·•・\s/,，]+/)
    .map((s) => s.replace(/(?:市|自治州|地区|县|区)$/, '').trim())
    .filter(Boolean);
  const specificCity = cityParts[cityParts.length - 1] || city.replace(/(?:市|自治州|地区)$/, '').trim();
  // 去掉括号内的冗长说明（如 "和顺古镇景区（和顺图书馆、弯楼子民居博物馆…）" -> "和顺古镇景区"）
  const baseName = name.replace(/（[^）]*）|\([^)]*\)/g, '').replace(/[·•・]/g, ' ').replace(/市区$/g, '').trim();
  const shortScenic = baseName.replace(/(?:风景名胜区|风景区|旅游区|景区|公园|博物馆|纪念馆)$/, '').trim();
  const looksChinese = /[\u4e00-\u9fff]/.test(`${city}${name}`);
  const inChina = (lat: number, lng: number) => lat >= 17 && lat <= 55 && lng >= 72 && lng <= 136;

  const scenicQueries = [...new Set([
    specificCity && baseName && !baseName.includes(specificCity) ? `${specificCity} ${baseName}` : baseName,
    baseName,
    specificCity && shortScenic && shortScenic.length >= 2 && !shortScenic.includes(specificCity)
      ? `${specificCity} ${shortScenic}`
      : shortScenic.length >= 2 ? shortScenic : '',
  ].filter(Boolean))];

  // 0) 优先查中文维基百科精确景点坐标（国内知名景区覆盖率极高，直接返回 WGS84）
  for (const q of scenicQueries.slice(0, 2)) {
    const wikiCoordUrl =
      `https://zh.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
      '&gsrlimit=5&prop=coordinates|info&inprop=url&format=json&origin=*';
    const wiki = await fetchPublicJson<{
      query?: {
        pages?: Record<string, {
          index?: number;
          title?: string;
          fullurl?: string;
          coordinates?: Array<{ lat?: number; lon?: number }>;
        }>;
      };
    }>(wikiCoordUrl, 5500);
    const wikiPages = Object.values(wiki?.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    for (const p of wikiPages) {
      const c = p.coordinates?.[0];
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const lat = Number(c.lat);
      const lng = Number(c.lon);
      if (looksChinese && !inChina(lat, lng)) continue;
      // 避免匹配到毫不相干词条：标题需与景点名或城市有一定重叠
      const title = String(p.title || '');
      if (shortScenic.length >= 2 && !title.includes(shortScenic.slice(0, 2)) && specificCity && !title.includes(specificCity)) {
        continue;
      }
      return {
        key: place.key,
        status: 'located',
        latitude: lat,
        longitude: lng,
        label: title || baseName,
        source: '维基百科坐标',
        sourceUrl: p.fullurl || `https://zh.wikipedia.org/wiki/${encodeURIComponent(title || q)}`,
        precision: 'place',
        coordinateSystem: 'WGS84',
      };
    }
  }

  const queries = [...new Set([
    ...scenicQueries,
    specificCity && baseName ? `${baseName} ${specificCity}` : '',
    specificCity,
    cityParts[0] && cityParts[0] !== specificCity ? cityParts[0] : '',
  ].filter(Boolean))];

  for (let qi = 0; qi < queries.length; qi += 1) {
    const q = queries[qi];
    const isCityFallback = qi === queries.length - 1 && queries.length > 1 && (q === specificCity || q === city || q === cityParts[0]);

    // 1) Komoot Photon（支持 CORS、响应快、返回 WGS84）
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`;
    const photon = await fetchPublicJson<{
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { name?: string; city?: string; state?: string; country?: string };
      }>;
    }>(photonUrl, 6000);
    const photonHits = (photon?.features ?? [])
      .map((f) => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
        const [lng, lat] = coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (looksChinese && !inChina(lat, lng)) return null;
        const p = f.properties ?? {};
        const label = [p.name, p.city, p.state].filter(Boolean).join(' · ') || q;
        return { latitude: lat, longitude: lng, label, source: 'OpenStreetMap', precision: (isCityFallback ? 'area' : 'place') as 'area' | 'place' };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (photonHits.length) {
      const best = photonHits[0];
      return {
        key: place.key,
        status: 'located',
        latitude: best.latitude,
        longitude: best.longitude,
        label: best.label,
        source: best.source,
        sourceUrl: `https://www.openstreetmap.org/?mlat=${best.latitude}&mlon=${best.longitude}#map=15/${best.latitude}/${best.longitude}`,
        precision: best.precision,
        coordinateSystem: 'WGS84',
        ...(photonHits.length > 1 ? { candidates: photonHits.slice(0, 4) } : {}),
      };
    }

    // 2) OpenStreetMap Nominatim 兜底
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=4&accept-language=zh-CN`;
    const nom = await fetchPublicJson<Array<{ lat?: string; lon?: string; display_name?: string }>>(nomUrl, 6500);
    const nomHits = (Array.isArray(nom) ? nom : [])
      .map((item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (looksChinese && !inChina(lat, lng)) return null;
        return {
          latitude: lat,
          longitude: lng,
          label: String(item.display_name || q).split(',').slice(0, 3).join(' · '),
          source: 'OpenStreetMap',
          precision: (isCityFallback ? 'area' : 'place') as 'area' | 'place',
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (nomHits.length) {
      const best = nomHits[0];
      return {
        key: place.key,
        status: 'located',
        latitude: best.latitude,
        longitude: best.longitude,
        label: best.label,
        source: best.source,
        sourceUrl: `https://www.openstreetmap.org/?mlat=${best.latitude}&mlon=${best.longitude}#map=15/${best.latitude}/${best.longitude}`,
        precision: best.precision,
        coordinateSystem: 'WGS84',
        ...(nomHits.length > 1 ? { candidates: nomHits.slice(0, 4) } : {}),
      };
    }
  }

  return {
    key: place.key,
    status: 'unresolved',
    reason: '未检索到精确坐标，可点击地图手动标点',
  };
}

  if (endpoint === 'generate') {
    onProgress('规划行程中…');
    const req = normalizeMobileRequest(payload.request);
    const expectedDays = req.endDate ? plannerDayCount(req.startDate, req.endDate) : (req.days ?? 3);
    const selfDrive = isSelfDriveTransport(req.transport);
    const transitRule = selfDrive
      ? '市内交通卡填 1 条自驾项：transferOptions:[{"mode":"drive","recommended":true,"distanceKm":4.2,"durationMinutes":14}]，transportMode写"自驾"。'
      : '相邻景点间可写简明交通卡（kind:"transport"），填 transportMode 与 distanceKm，主推荐写 1~2 条 transferOptions（详细备选方案会由后续交通接口自动补全）。';
    const sys = [
      '你是周游地图专业中文旅行规划师。请严格返回紧凑合法 JSON 对象，不要输出任何额外说明或注释。',
      `必须严格按以下结构返回，共 ${expectedDays} 天（从 ${req.startDate} 起连续每一天，每天 3~5 个核心活动，简洁实用勿冗长）：`,
      '{"title":"行程标题","summary":"行程亮点概要","cities":[{"name":"城市名"}],"constraints":["约束说明"],"warnings":["实用提醒"],"days":[{"date":"YYYY-MM-DD","title":"当天主题","weather":"当季天气参考","activities":[{"id":"d1-a1","kind":"sight|food|transport|rest","period":"morning|noon|afternoon|evening","startTime":"09:00","endTime":"11:30","title":"活动名","city":"城市","location":"具体地点","description":"国家5A级景区 · 简明点出核心特色（如民国时期建筑群），25~50字","transportMode":"","meal":null,"costs":[{"id":"c1","label":"门票","category":"tickets","unit":"ticket","unitPriceCents":6000,"quantity":1,"occurrences":1}]}],"lodging":{"city":"城市","area":"推荐住宿片区","searchKeyword":"酒店搜索词","reason":"选址理由","costs":[{"id":"l1","label":"住宿","category":"lodging","unit":"room","unitPriceCents":35000,"quantity":1,"occurrences":1}]}}],"alternatives":[{"title":"备选景点","city":"城市","reason":"推荐理由","rainyDay":true}],"unvisitedHighlights":[{"title":"未排入的热门景点名","city":"城市","grade":"5A或4A或空串","feature":"15字内一句话特色","location":"所在区或地址"}]}',
      '景点简介要求：每个 sight 活动的 description 必须简明写出特色（如历史年代/建筑/自然看点），若是国家4A或5A级景区须写明（如“国家5A级景区 · ...”），不要太长；unvisitedHighlights 列出 4~6 个目的地热门但本次未去的景点。',
      transitRule,
      '注意：非交通卡省略 distanceKm 与 transferOptions；最后一天 lodging 必须为 null；所有金额为人民币整数分（如 60 元填 6000）；kind 仅取 sight/food/transport/rest；period 仅取 morning/noon/afternoon/evening。',
    ].join('\n');
    const res = await callMobileModel(sys, `旅行需求：\n${JSON.stringify(req, null, 2)}`, { maxTokens: 8000 });
    onProgress('整理路线与预算…');
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    const content = normalizeMobilePlanContent(raw, req);
    return { content } as unknown as T;
  }

  if (endpoint === 'chat') {
    onProgress('AI 思考中…');
    const baseVersion = Number(payload.baseVersion ?? (payload.plan as AiTravelPlan | undefined)?.version ?? 1);
    const scopeId = typeof payload.scopeId === 'string' ? payload.scopeId : null;
    if (payload.activityGuide === true) {
      const sys = '你是周游地图专业旅行攻略助手。请直接输出清晰、实用、分段的中文攻略正文，使用【短标题】分段，不要输出 JSON，不要使用 ** 星号或 Markdown 井号。';
      const res = await callMobileModel(sys, String(payload.message ?? ''), { maxTokens: 3000 });
      return { action: 'answer', answer: res.text.trim(), baseVersion, scopeId } as unknown as T;
    }
    const plan = payload.plan as AiTravelPlan | undefined;
    const sys = [
      '你是周游地图 AI 旅行助手。请严格返回 JSON 对象，不要输出其他文本；回答正文使用简洁中文分段，不要使用 ** 星号：',
      '- 若是咨询问答或方案建议，返回：{"action":"answer","answer":"你的清晰中文回答"}',
      '- 仅当用户明确要求直接修改行程时，返回：{"action":"revision","summary":"一句话改动说明","content":{修改后的完整行程content对象}}',
    ].join('\n');
    const userMsg = `当前行程概要：${JSON.stringify(plan?.content ?? {})}\n用户消息：${String(payload.message ?? '')}`;
    const res = await callMobileModel(sys, userMsg, { maxTokens: 4500 });
    try {
      const parsed = extractJsonObject<{
        action?: string;
        answer?: string;
        reply?: string;
        summary?: string;
        content?: Record<string, unknown>;
      }>(res.text);
      if (parsed.action === 'revision' && parsed.content && plan?.content?.request) {
        try {
          const normalized = normalizeMobilePlanContent(parsed.content, plan.content.request);
          return {
            action: 'revision',
            summary: String(parsed.summary || '已按要求调整行程'),
            content: normalized,
            baseVersion,
            scopeId,
          } as unknown as T;
        } catch {
          // 修订内容未通过结构校验时，退回普通文字回答，不丢原行程
        }
      }
      return {
        action: 'answer',
        answer: String(parsed.answer ?? parsed.reply ?? parsed.summary ?? res.text).trim() || '已完成回复',
        baseVersion,
        scopeId,
      } as unknown as T;
    } catch {
      return { action: 'answer', answer: res.text.trim() || '已完成回复', baseVersion, scopeId } as unknown as T;
    }
  }

  if (endpoint === 'recommendations') {
    onProgress('挑选目的地…');
    const sys = [
      '你是中文旅行推荐专家。请严格返回合法 JSON 对象，推荐 4 到 6 个目的地：',
      '{"recommendations":[{"title":"地点名称","destination":"城市或可规划目的地","reason":"推荐理由（50~100字）","season":"当季看点与气候","suggestedDays":"建议 3~4 天","access":"结合出发地的交通方式"}]}',
    ].join('\n');
    const res = await callMobileModel(sys, `出行条件：\n${JSON.stringify(payload.request ?? payload)}`, { maxTokens: 3000 });
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    const normalized = normalizeMobileRecommendations(raw);
    onProgress('搜索图片…');
    await Promise.all(
      normalized.recommendations.map(async (item) => {
        try {
          const found = await searchMobilePlacePhoto(item.destination, item.title);
          if (found) item.photo = found;
        } catch {
          // 单张搜图失败不影响推荐展示
        }
      }),
    );
    return normalized as unknown as T;
  }

  if (endpoint === 'duration') {
    onProgress('评估游玩天数…');
    const sys = '你是中文旅行规划师。请严格返回 JSON：{"options":[{"days":3,"title":"紧凑精华","reason":"时长理由和大致路线"},{"days":5,"title":"舒适深度","reason":"时长理由和大致路线"}]}，给出 2 到 3 种建议天数。';
    const res = await callMobileModel(sys, `出行条件：\n${JSON.stringify(payload.request ?? payload)}`, { maxTokens: 1500 });
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    return normalizeMobileDurations(raw) as unknown as T;
  }

  if (endpoint === 'tickets') {
    onProgress('查询预约规则…');
    const plan = payload.plan as AiTravelPlan | undefined;
    const days = Array.isArray(plan?.content?.days) ? plan.content.days : [];
    const sights = days.flatMap((day) =>
      (Array.isArray(day.activities) ? day.activities : [])
        .filter((item) => item.kind === 'sight' && !item.bookingId && !item.bookingTiming?.deferred)
        .map((item) => ({ activityId: item.id, title: item.title, city: item.city, travelDate: day.date })),
    );
    if (!sights.length) {
      return { signature: '', checkedAt: new Date().toISOString(), networkAvailable: false, items: [] } as unknown as T;
    }
    const sys = '你是旅行预约助手。请严格返回 JSON：{"items":[{"activityId":"原活动ID","bookingRequired":false,"saleDate":"","saleTime":"","difficulty":"易","platform":"官方公众号/小程序","note":"预约提示"}]}。注意：免费开放街区、公园、广场、桥梁、外观地标等无需抢票的景点务必设 bookingRequired:false；仅确需提前购票或限流预约的收费/热门场馆设 bookingRequired:true。';
    const res = await callMobileModel(sys, `景点列表：${JSON.stringify(sights)}`, { maxTokens: 2500 });
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    return normalizeMobileTickets(raw, plan) as unknown as T;
  }

  if (endpoint === 'packing') {
    onProgress('生成行前清单…');
    const plan = payload.plan as AiTravelPlan | undefined;
    const sys = '你是旅行行前顾问。请严格返回 JSON：{"items":[{"category":"documents|clothing|medicine|electronics|bookings|other","name":"具体物品","note":"简短原因（20字内）"}]}，给出 14~24 项实用清单。';
    const res = await callMobileModel(
      sys,
      `行程信息：${JSON.stringify({ title: plan?.content?.title, cities: plan?.content?.cities?.map((c) => c.name), request: plan?.content?.request })}`,
      { maxTokens: 2500 },
    );
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    return normalizeMobilePacking(raw) as unknown as T;
  }

  if (endpoint === 'transfers') {
    onProgress('计算交通方案…');
    const rawLegs = Array.isArray(payload.legs) ? (payload.legs as Array<Record<string, unknown>>) : [];
    const cleanLegs = rawLegs.filter((leg) => leg && typeof leg.key === 'string' && leg.key.trim()).slice(0, 40);
    if (!cleanLegs.length) return { legs: {} } as unknown as T;
    const selfDrive = isSelfDriveTransport(String(payload.transport ?? ''));
    const people = Number.isSafeInteger(payload.people) && Number(payload.people) > 0 ? Number(payload.people) : 2;
    const rule = selfDrive
      ? '自驾/租车模式：每条路段只返回 1 条 drive 方案，填 distanceKm 与 durationMinutes。示例：{"mode":"drive","recommended":true,"distanceKm":4.2,"durationMinutes":14}'
      : `公共交通/非自驾模式（同行 ${people} 人，偏好：${String(payload.transport ?? '公共交通')}）：每条路段给出 2~4 种实用方案（主推荐标 recommended:true）：
1. 步行（≤2km）：{"mode":"walk","distanceKm":0.85,"durationMinutes":12}
2. 地铁：具体线路 line、fromStation、toStation、transferNote（换乘/步行）、durationMinutes、costCents（整数分）、costUnit:"person"
3. 公交：具体几路公交 line、fromStation、toStation、transferNote、durationMinutes、costCents、costUnit:"person"
4. 打车：durationMinutes、distanceKm、costCents、costUnit:"vehicle"；较远路段（≥12km）附 carpoolCostCents 与 carpoolNote`;
    const sys = '你是熟悉中国城市交通的旅行规划师。请严格返回合法 JSON 对象：{"items":[{"key":"原key","transferOptions":[...]}]}。';
    const res = await callMobileModel(sys, `${rule}\n路段：${JSON.stringify(cleanLegs)}`, { maxTokens: 3500 });
    const raw = extractJsonObject<Record<string, unknown>>(res.text);
    return normalizeMobileTransfers(raw, new Set(cleanLegs.map((l) => String(l.key))), selfDrive) as unknown as T;
  }

  if (endpoint === 'photo') {
    onProgress('搜索图片…');
    const title = String(payload.title ?? '').trim();
    const city = String(payload.city ?? '').trim();
    const photo = await searchMobilePlacePhoto(city, title);
    return {
      photo,
      queryLabel: [city, title].filter(Boolean).join(' '),
      ...(photo ? {} : { message: '暂未找到该地点公开实景图，可点击下方去小红书查看' }),
    } as unknown as T;
  }

  if (endpoint === 'map') {
    onProgress('定位景点中…');
    const places = Array.isArray(payload.places)
      ? (payload.places as Array<{ key?: string; name?: string; city?: string }>)
      : [];
    const positions = [];
    for (const p of places) {
      positions.push(
        await locateSingleMobilePlace({
          key: String(p?.key ?? ''),
          name: String(p?.name ?? ''),
          city: String(p?.city ?? ''),
        }),
      );
    }
    return {
      positions,
      notice: '',
      tileUrl: '',
    } as unknown as T;
  }

  throw new Error(`手机端暂不支持该接口（${endpoint}），如需离线 OCR / 小红书解析请连接电脑端服务。`);
}
