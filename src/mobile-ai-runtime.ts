import { Capacitor, registerPlugin } from '@capacitor/core';
import { jsonrepair } from 'jsonrepair';
import { getPlannerApiOrigin } from './api-base';
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
  const host = (window.location.hostname || '').toLowerCase();
  return host.endsWith('.github.io') || host === 'zhouyou.online' || host.endsWith('.zhouyou.online') || host.endsWith('.pages.dev');
}

/** 原生手机端或静态托管 PWA（未指向外部远程服务器时）启用本机直连 AI 运行时。 */
export function isMobileNativeAiActive(): boolean {
  if (getPlannerApiOrigin()) return false;
  return Boolean(getNativeBridge() || isStaticHostedWebPwa());
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
  const resp = await fetch(options.url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
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
      { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
    ],
  },
  claude: {
    name: 'Claude',
    defaultModel: 'claude-sonnet-5-5',
    manageUrl: 'https://claude.ai/settings/usage',
    loginKind: 'oauth_browser',
    vision: true,
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', vision: true, reasoning: true, thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
    ],
  },
  kimi: {
    name: 'Kimi Code',
    defaultModel: 'k3.1-pro-highspeed',
    manageUrl: 'https://www.kimi.com/code/console',
    loginKind: 'device_code',
    vision: true,
    models: [
      { id: 'k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'k3.1-pro', name: 'Kimi K3.1 Pro', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'k3', name: 'Kimi K3', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
    ],
  },
  gemini: {
    name: 'Gemini',
    defaultModel: 'gemini-4-neon',
    manageUrl: 'https://aistudio.google.com/apikey',
    loginKind: 'gemini_cli',
    vision: false,
    models: [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh'], latest: true },
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
      { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', vision: false, reasoning: true, thinkingLevels: ['off', 'low', 'high', 'max'], latest: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vision: false, reasoning: true, thinkingLevels: ['off', 'high', 'max'], latest: true },
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
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh'], latest: true },
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
      { id: 'qwen4-max-preview', name: 'Qwen4 Max Preview', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'xhigh'], latest: true },
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'xhigh'], latest: false },
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'xhigh'], latest: false },
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-highspeed',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed', vision: false, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'glm-5.3', name: 'GLM-5.3', vision: false, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3.1-pro-highspeed',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      { id: 'kimi-k3', name: 'Kimi K3', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
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

function loadStore(): MobileAiStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { activeProvider: '', subCreds: {}, subModels: {}, subThinking: {}, apiConfigs: {} };
    const parsed = JSON.parse(raw) as Partial<MobileAiStore>;
    return {
      activeProvider: typeof parsed.activeProvider === 'string' ? parsed.activeProvider : '',
      subCreds: parsed.subCreds && typeof parsed.subCreds === 'object' ? parsed.subCreds : {},
      subModels: parsed.subModels && typeof parsed.subModels === 'object' ? parsed.subModels : {},
      subThinking: parsed.subThinking && typeof parsed.subThinking === 'object' ? parsed.subThinking : {},
      apiConfigs: parsed.apiConfigs && typeof parsed.apiConfigs === 'object' ? parsed.apiConfigs : {},
    };
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

async function generatePkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
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
  const bridge = getNativeBridge();
  if (!bridge) throw new Error('原生网络插件未就绪');
  const resp = await bridge.httpRequest({
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
  const bridge = getNativeBridge();
  if (!bridge) throw new Error('原生网络插件未就绪');
  const resp = await bridge.httpRequest({
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

  const bridge = getNativeBridge();
  if (!bridge) return cred;
  try {
    if (key === 'chatgpt') {
      const resp = await bridge.httpRequest({
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
      const resp = await bridge.httpRequest({
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
      const resp = await bridge.httpRequest({
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
    throw new Error('手机端不支持电脑命令行 Gemini CLI；请在下方「API Key」中填写 Google AI Studio 免费 API Key，即可直接用 Gemini 4 Neon。');
  }
  const bridge = getNativeBridge();
  if (!bridge) {
    throw new Error('当前打开的是网页 PWA 版，受浏览器安全限制无法直接登录订阅。请下载安装 Android APK 客户端（免电脑直接登录 ChatGPT / Claude / Kimi 订阅），或直接在下方「API Key」填写 DeepSeek / Gemini / OpenAI 等密钥使用。');
  }

  await cleanupLoginSession(key);

  if (key === 'chatgpt' && method === 'device_code') {
    const resp = await bridge.httpRequest({
      url: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
      timeoutMs: 25000,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`ChatGPT 设备码申请失败（HTTP ${resp.status}），请改用浏览器直接登录`);
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
      instructions: `请在浏览器打开页面并输入设备码 ${json.user_code}，确认后会自动保存登录状态。`,
    };
    loginSessions.set('chatgpt', session);
    void bridge.openExternalUrl({ url: authUrl }).catch(() => {});

    const intervalMs = Math.max(3000, (Number(json.interval) || 5) * 1000);
    const deadline = Date.now() + 15 * 60 * 1000;
    void (async () => {
      while (!session.cancelled && session.state === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (session.cancelled || session.state !== 'pending') break;
        try {
          const poll = await bridge.httpRequest({
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
    const resp = await bridge.httpRequest({
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
    void bridge.openExternalUrl({ url: authUrl }).catch(() => {});

    // 后台轮询 Kimi 设备码
    const intervalMs = Math.max(3000, (Number(json.interval) || 5) * 1000);
    const deadline = Date.now() + Math.min(900, Number(json.expires_in) || 600) * 1000;
    void (async () => {
      while (!session.cancelled && session.state === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        if (session.cancelled || session.state !== 'pending') break;
        try {
          const poll = await bridge.httpRequest({
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

  // ChatGPT / Claude OAuth PKCE
  const { verifier, challenge, state } = await generatePkce();
  const isChatGpt = key === 'chatgpt';
  const port = isChatGpt ? 1455 : 53692;
  const callbackPath = isChatGpt ? '/auth/callback' : '/callback';
  const redirectUri = isChatGpt ? CHATGPT_REDIRECT_URI : CLAUDE_REDIRECT_URI;

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

  const session: ActiveLoginSession = {
    key,
    state: 'pending',
    authUrl,
    verifier,
    oauthState: state,
    redirectUri,
    instructions: '已在手机浏览器打开登录页，完成授权后会自动跳回本机并保存；如浏览器未自动跳转，也可复制回调网址粘贴到下方完成登录。',
  };
  loginSessions.set(key, session);

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

  await bridge.openExternalUrl({ url: authUrl });

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

  const bridge = getNativeBridge();
  if (!bridge) {
    return { status: 'info', title: '已登录', note: '已保存本机登录状态', manageUrl: spec.manageUrl };
  }

  try {
    const cred = await ensureFreshSubCred(key);
    if (key === 'chatgpt') {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${cred.access}`,
        Accept: 'application/json',
        'User-Agent': 'codex_cli_rs/0.38.0',
      };
      if (cred.accountId) headers['chatgpt-account-id'] = cred.accountId;
      const resp = await bridge.httpRequest({
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
      const resp = await bridge.httpRequest({
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
      const resp = await bridge.httpRequest({
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
    const modelMeta = meta?.models.find((m: ModelCatalogItem) => m.id === cfg.model);
    saved.push({
      id: provId,
      label: meta?.label || provId,
      model: cfg.model || meta?.model || '',
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
  const activeModel = activeSub?.model || activeApiCfg?.model || activeApiMeta?.model || 'deepseek-flash';
  const activeModelsList: ModelCatalogItem[] = activeSub?.models || activeApiMeta?.models || [];
  const activeModelMeta = activeModelsList.find((m: ModelCatalogItem) => m.id === activeModel);

  return {
    configured,
    provider: activeProvider,
    authMode: isSub ? 'subscription' : 'api',
    label: activeItem?.label || activeApiMeta?.label || '',
    model: activeModelMeta?.name || activeModel,
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

async function callMobileModel(
  systemPrompt: string,
  userPrompt: string,
  { maxTokens = 4096, timeoutMs = 120000 }: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; latencyMs: number; model: string; provider: string }> {
  const status = buildMobileAiStatus();
  if (!status.configured) throw new Error('请先在 AI 设置中登录订阅账号或填入 API Key');

  const store = loadStore();
  const provider = status.provider;
  const modelId = status.modelId || status.model;
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
      if (!cfg?.apiKey) throw new Error('请先填写 Anthropic API Key');
      url = `${(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;
      headers['x-api-key'] = cfg.apiKey;
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
      throw new Error(`${status.label || provider} 鉴权失败（HTTP ${resp.status}），请检查登录状态或 API Key`);
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
    if (!cfg?.apiKey) throw new Error(`请先填写 ${meta?.label || provider} 的 API Key`);
    const base = (cfg.baseUrl || meta?.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('请填写有效的接口地址（Base URL）');
    const url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
    const resp = await transportHttpRequest({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
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
    label: status.label || provider,
    authMode: status.authMode,
    model: modelId,
    inputTokens,
    outputTokens,
  });

  return { text: text.trim(), latencyMs: Date.now() - startedAt, model: modelId || '', provider };
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
          model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : (prev?.model || meta?.model || ''),
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
        if (typeof payload.model === 'string' && payload.model.trim()) store.subModels[key] = payload.model.trim();
        if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.subThinking[key] = payload.thinking.trim();
        saveStore(store);
      }
    } else if (store.apiConfigs[prov]?.apiKey) {
      store.activeProvider = prov;
      if (typeof payload.model === 'string' && payload.model.trim()) store.apiConfigs[prov].model = payload.model.trim();
      if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.apiConfigs[prov].thinking = payload.thinking.trim();
      saveStore(store);
    }
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-test') {
    const res = await callMobileModel('你是一个连通性测试助手。', '请只回复：连接正常', { maxTokens: 32, timeoutMs: 25000 });
    return {
      ok: true,
      reply: res.text || '连接正常',
      latencyMs: res.latencyMs,
      model: res.model,
    } as unknown as T;
  }

  if (endpoint === 'ai-models-refresh') {
    return buildMobileAiStatus() as unknown as T;
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
    if (typeof payload.model === 'string' && payload.model.trim()) store.subModels[key] = payload.model.trim();
    if (typeof payload.thinking === 'string' && payload.thinking.trim()) store.subThinking[key] = payload.thinking.trim();
    saveStore(store);
    return buildMobileAiStatus() as unknown as T;
  }

  if (endpoint === 'ai-sub-quota') {
    const key = String(payload.provider || '').replace(/^sub:/, '');
    const quota = await fetchMobileSubscriptionQuota(key, Boolean(payload.force));
    return { quota } as unknown as T;
  }

  if (endpoint === 'generate') {
    onProgress('手机直连 AI 正在为你规划完整行程…');
    const req = (payload.request ?? {}) as Record<string, unknown>;
    const sys = [
      '你是周游地图专业中文旅行规划师。请严格返回合法 JSON 对象，不要输出任何额外说明。',
      'JSON 结构必须包含：title(字符串), summary(字符串), destination(字符串), cities([{name,province,nights}]), days([{dayIndex,date,city,title,stayArea,summary,items:[{id,period,time,kind,title,location,detail,durationMinutes,estimatedCostCents,tips}]}]), budget({totalCents,perPersonCents,breakdown:[{category,amountCents,note}]}), tips(字符串数组), packingTips(字符串数组)。',
      'period 仅取 morning/noon/afternoon/evening；kind 仅取 sight/food/transit/hotel/rest/activity；金额单位为人民币分（整数）。',
    ].join('\n');
    const res = await callMobileModel(sys, `旅行需求：\n${JSON.stringify(req, null, 2)}`, { maxTokens: 6000 });
    onProgress('正在整理每日路线与预算…');
    const plan = extractJsonObject<Record<string, unknown>>(res.text);
    return { plan, model: res.model } as unknown as T;
  }

  if (endpoint === 'chat') {
    onProgress('手机直连 AI 正在思考回复…');
    const sys = '你是周游地图 AI 旅行助手。请用清晰简洁的中文回答用户问题或给出行程调整建议。如果用户明确要求修改行程，请返回 JSON {"reply":"说明","plan":{修改后的完整plan}}；否则直接返回 JSON {"reply":"你的回答"}。';
    const res = await callMobileModel(sys, JSON.stringify(payload), { maxTokens: 4500 });
    try {
      const parsed = extractJsonObject<{ reply?: string; plan?: unknown }>(res.text);
      return { reply: parsed.reply || res.text, plan: parsed.plan } as unknown as T;
    } catch {
      return { reply: res.text } as unknown as T;
    }
  }

  if (endpoint === 'recommendations') {
    onProgress('手机直连 AI 正在为你精选目的地…');
    const sys = '你是中文旅行推荐专家。请严格返回 JSON：{"recommendations":[{"city":"城市名","province":"省份","days":3,"bestSeason":"最佳季节","budgetHint":"预算参考","reason":"推荐理由","highlights":["亮点1","亮点2","亮点3"]}]}，推荐 4 到 6 个城市。';
    const res = await callMobileModel(sys, JSON.stringify(payload), { maxTokens: 3000 });
    return extractJsonObject<T>(res.text);
  }

  if (endpoint === 'duration') {
    onProgress('正在评估建议游玩天数…');
    const sys = '请严格返回 JSON：{"options":[{"days":3,"label":"紧凑精华","summary":"简短说明"},{"days":5,"label":"舒适深度","summary":"简短说明"}]}。';
    const res = await callMobileModel(sys, JSON.stringify(payload), { maxTokens: 1500 });
    return extractJsonObject<T>(res.text);
  }

  if (endpoint === 'tickets' || endpoint === 'packing' || endpoint === 'transfers') {
    onProgress('手机直连 AI 正在整理清单…');
    const sys = `你是旅行助手，请针对 ${endpoint} 任务严格返回 JSON 对象。`;
    const res = await callMobileModel(sys, JSON.stringify(payload), { maxTokens: 3000 });
    return extractJsonObject<T>(res.text);
  }

  throw new Error(`手机端暂不支持该接口（${endpoint}），如需离线 OCR / 小红书解析请连接电脑端服务。`);
}
