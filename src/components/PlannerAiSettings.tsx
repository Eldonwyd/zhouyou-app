import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlannerApiOrigin, setPlannerApiOrigin } from '../api-base';
import { plannerApi } from '../planner-api';

export interface ModelCatalogItem {
  id: string;
  name: string;
  vision: boolean;
  reasoning?: boolean;
  thinkingLevels?: string[];
  latest?: boolean;
  remote?: boolean;
}

interface ProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  models?: ModelCatalogItem[];
  keyUrl: string;
}

export interface SubscriptionQuota {
  status: 'ok' | 'unavailable' | 'info' | 'disconnected';
  title: string;
  note?: string;
  remainingPercent?: number;
  resetsAt?: string;
  fiveHourRemainingPercent?: number;
  fiveHourResetsAt?: string;
  manageUrl?: string;
}

export interface SubscriptionProfile {
  id: string;
  key: 'chatgpt' | 'claude' | 'kimi' | 'gemini';
  name: string;
  loginKind: 'oauth_browser' | 'device_code' | 'gemini_cli';
  connected: boolean;
  active: boolean;
  model: string;
  defaultModel: string;
  thinking: string;
  thinkingLevels: string[];
  vision: boolean;
  models: ModelCatalogItem[];
  modelsUpdatedAt?: number;
  manageUrl: string;
  search: 'direct' | 'citation' | 'none';
  quota: SubscriptionQuota | null;
  pendingSession?: LoginSession | null;
  cliInstalled?: boolean;
  cliLoggedIn?: boolean;
  accountEmail?: string;
  installRunning?: boolean;
  installError?: string;
}

export interface SavedAiProfile {
  id: string;
  label: string;
  model: string;
  thinking?: string;
  thinkingLevels?: string[];
  vision?: boolean;
  search: 'direct' | 'citation' | 'none';
  authMode?: 'subscription' | 'api';
}

/** 页面外部显示用的 AI 状态（来自 health 或保存/切换的返回）。 */
export interface AiStatus {
  configured: boolean;
  provider: string;
  authMode?: 'subscription' | 'api';
  label?: string;
  model?: string;
  modelId?: string;
  models?: ModelCatalogItem[];
  thinking?: string;
  thinkingLevels?: string[];
  vision?: boolean;
  searchAvailable: boolean;
  searchLabel: string;
  saved: SavedAiProfile[];
  subscriptions?: SubscriptionProfile[];
}

interface AiState extends AiStatus {
  model: string;
  baseUrl: string;
  label: string;
  keyConfigured: boolean;
  providers: ProviderOption[];
  subscriptions: SubscriptionProfile[];
}

interface SpeedResult {
  ok: boolean;
  seconds?: number;
  speedTier?: 'fast' | 'normal' | 'slow' | 'unknown';
  thinkingUsed?: string;
  label?: string;
  error?: string;
}

interface LoginSession {
  id?: string;
  provider: string;
  key: string;
  status:
    | 'idle'
    | 'pending'
    | 'awaiting_auth'
    | 'awaiting_device'
    | 'exchanging'
    | 'connected'
    | 'error'
    | 'cancelled'
    | 'gemini_needs_install'
    | 'gemini_needs_auth';
  authUrl?: string;
  verificationUri?: string;
  userCode?: string;
  instructions?: string;
  progress?: string;
  canPasteCode?: boolean;
  error?: string;
  cliInstalled?: boolean;
  cliLoggedIn?: boolean;
  accountEmail?: string;
  installRunning?: boolean;
  installError?: string;
}

const THINKING_LABEL: Record<string, string> = {
  off: '关闭',
  minimal: '极轻',
  low: '轻度',
  medium: '标准',
  high: '深度',
  xhigh: '超深',
  max: '极致',
};

const SEARCH_TEXT = { direct: '可联网', citation: '可联网', none: '不支持联网' } as const;

/** 手机端/静态端尚未连通 AI 后端时的兜底目录：完整保留与电脑版一致的 5 张卡片样式与交互结构。 */
const FALLBACK_OFFLINE_STATE: AiState = {
  configured: false,
  provider: 'deepseek',
  authMode: 'api',
  label: '',
  model: 'deepseek-flash',
  modelId: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  keyConfigured: false,
  thinking: 'low',
  thinkingLevels: ['off', 'low', 'high', 'max'],
  vision: false,
  searchAvailable: false,
  searchLabel: '',
  saved: [],
  subscriptions: [
    {
      id: 'sub:chatgpt',
      key: 'chatgpt',
      name: 'ChatGPT',
      loginKind: 'oauth_browser',
      connected: false,
      active: false,
      model: 'gpt-6.2-sol',
      defaultModel: 'gpt-6.2-sol',
      thinking: 'low',
      thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      vision: true,
      models: [
        { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      ],
      manageUrl: 'https://chatgpt.com/#settings/DataControls',
      search: 'direct',
      quota: null,
    },
    {
      id: 'sub:claude',
      key: 'claude',
      name: 'Claude',
      loginKind: 'oauth_browser',
      connected: false,
      active: false,
      model: 'claude-sonnet-5-5',
      defaultModel: 'claude-sonnet-5-5',
      thinking: 'low',
      thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      vision: true,
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', vision: true, reasoning: true, thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      ],
      manageUrl: 'https://claude.ai/settings/usage',
      search: 'direct',
      quota: null,
    },
    {
      id: 'sub:kimi',
      key: 'kimi',
      name: 'Kimi Code',
      loginKind: 'device_code',
      connected: false,
      active: false,
      model: 'k3.1-pro-highspeed',
      defaultModel: 'k3.1-pro-highspeed',
      thinking: 'low',
      thinkingLevels: ['low', 'high', 'max'],
      vision: true,
      models: [
        { id: 'k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
        { id: 'k3.1-pro', name: 'Kimi K3.1 Pro', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
        { id: 'k3', name: 'Kimi K3', vision: true, reasoning: true, thinkingLevels: ['low', 'high', 'max'], latest: true },
      ],
      manageUrl: 'https://www.kimi.com/code/console',
      search: 'none',
      quota: null,
    },
    {
      id: 'sub:gemini',
      key: 'gemini',
      name: 'Gemini',
      loginKind: 'gemini_cli',
      connected: false,
      active: false,
      model: 'gemini-4-neon',
      defaultModel: 'gemini-4-neon',
      thinking: 'low',
      thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
      vision: false,
      models: [
        { id: 'gemini-4-neon', name: 'Gemini 4 Neon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh'], latest: true },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh'], latest: true },
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vision: false, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: false },
      ],
      manageUrl: 'https://aistudio.google.com/',
      search: 'direct',
      quota: null,
      cliInstalled: false,
      cliLoggedIn: false,
    },
  ],
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      models: [
        { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', vision: false, reasoning: true, thinkingLevels: ['off', 'low', 'high', 'max'], latest: true },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vision: false, reasoning: true, thinkingLevels: ['off', 'high', 'max'], latest: true },
      ],
    },
    {
      id: 'anthropic',
      label: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5-5',
      keyUrl: 'https://platform.claude.com/settings/keys',
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', vision: true, reasoning: true, thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-6.2-sol',
      keyUrl: 'https://platform.openai.com/api-keys',
      models: [
        { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], latest: true },
        { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], latest: true },
      ],
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
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh'], latest: true },
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', vision: true, reasoning: true, thinkingLevels: ['low', 'medium', 'high'], latest: true },
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
  ],
};

/** 服务端返回的状态补齐默认值：旧版服务没有新字段时也能正常显示。 */
export function normalizeAiStatus<T extends Partial<AiStatus>>(value: T): T & AiStatus {
  const configured = Boolean(value.configured);
  const provider = value.provider ?? 'deepseek';
  const authMode = value.authMode ?? (provider.startsWith('sub:') ? 'subscription' : 'api');
  const rawLabel = value.label ?? value.model ?? '';
  const labelParts = rawLabel.split(' · ');
  const resolvedModelId =
    value.modelId ||
    (value.model && !value.model.includes(' · ') ? value.model : '') ||
    labelParts[1] ||
    '';
  const subModels = value.subscriptions?.find((item) => item.id === provider)?.models;
  const models = value.models?.length ? value.models : (subModels ?? []);
  const fallback = configured
    ? [{
        id: provider,
        label: (labelParts[0] || provider),
        model: resolvedModelId,
        search: 'direct' as const,
        authMode,
      }]
    : [];
  return {
    ...value,
    configured,
    provider,
    authMode,
    modelId: resolvedModelId,
    models,
    thinking: value.thinking ?? 'low',
    thinkingLevels: value.thinkingLevels ?? ['off', 'low', 'medium', 'high'],
    vision: value.vision !== false,
    searchAvailable: Boolean(value.searchAvailable),
    searchLabel: value.searchLabel ?? (value.searchAvailable ? '已联网' : ''),
    saved: value.saved ?? fallback,
    subscriptions: value.subscriptions ?? [],
  };
}

/** 切换到已保存的服务商或已连接的订阅（可顺带切换模型或思考档位）。 */
export function switchAiProvider(provider: string, options?: { model?: string; thinking?: string }) {
  return plannerApi<AiState>(
    'ai-switch',
    { provider, ...(options?.model ? { model: options.model } : {}), ...(options?.thinking ? { thinking: options.thinking } : {}) },
    AbortSignal.timeout(30000),
    () => {},
  ).then(normalizeAiStatus);
}

/** 各服务商与订阅的清晰矢量品牌图标（参考 NeoRead 视觉语言）。 */
export function AiProviderIcon({ kind, size = 38 }: { kind: string; size?: number }) {
  const normalized = kind.replace(/^sub:/, '');
  if (normalized === 'chatgpt' || normalized === 'openai') {
    return (
      <span className="neo-brand-icon is-chatgpt" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M20.2 9.9a4.6 4.6 0 0 0-.4-3.8 4.7 4.7 0 0 0-5-2.2A4.6 4.6 0 0 0 11.3 2a4.7 4.7 0 0 0-4.5 3.3 4.6 4.6 0 0 0-3.1 2.2 4.7 4.7 0 0 0 .6 5.5 4.6 4.6 0 0 0 .4 3.8 4.7 4.7 0 0 0 5 2.2 4.6 4.6 0 0 0 3.5 1.6 4.7 4.7 0 0 0 4.5-3.3 4.6 4.6 0 0 0 3.1-2.2 4.7 4.7 0 0 0-.6-5.2ZM13.2 19.3a3.5 3.5 0 0 1-2.3-.8l.1-.1 3.7-2.1a.6.6 0 0 0 .3-.5v-5.2l1.6.9v4.4a3.5 3.5 0 0 1-3.4 3.4Zm-7.4-3.1a3.5 3.5 0 0 1-.4-2.4l.1.1 3.7 2.1a.6.6 0 0 0 .6 0l4.5-2.6v1.8l-3.8 2.2a3.5 3.5 0 0 1-4.7-1.2Zm-1-8a3.5 3.5 0 0 1 1.8-1.5v4.4a.6.6 0 0 0 .3.5l4.5 2.6-1.6.9-3.8-2.2a3.5 3.5 0 0 1-1.2-4.7Zm12.8 3-4.5-2.6 1.6-.9 3.8 2.2a3.5 3.5 0 0 1-.5 6.3V11.8a.6.6 0 0 0-.4-.6Zm1.6-2.3-.1-.1-3.7-2.1a.6.6 0 0 0-.6 0L10.3 9.3V7.5l3.8-2.2a3.5 3.5 0 0 1 5.1 3.6Zm-9.9 3.2-1.6-.9V6.8a3.5 3.5 0 0 1 5.7-2.7l-.1.1-3.7 2.1a.6.6 0 0 0-.3.5v5.3Zm.9-1.9 2-1.2 2 1.2v2.3l-2 1.2-2-1.2v-2.3Z"
            fill="currentColor"
          />
        </svg>
      </span>
    );
  }
  if (normalized === 'claude' || normalized === 'anthropic') {
    return (
      <span className="neo-brand-icon is-claude" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3v7.2M12 13.8V21M3 12h7.2M13.8 12H21M5.6 5.6l5.1 5.1M13.3 13.3l5.1 5.1M18.4 5.6l-5.1 5.1M10.7 13.3l-5.1 5.1M8.2 3.8l2.9 6.6M12.9 13.6l2.9 6.6M3.8 15.8l6.6-2.9M13.6 11.1l6.6-2.9"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  if (normalized === 'kimi' || normalized === 'moonshot') {
    return (
      <span className="neo-brand-icon is-kimi" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7.5 6.5v11M15.8 6.5l-6.2 5.4 6.6 5.6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="17.2" cy="7.2" r="1.9" fill="#3b82f6" />
        </svg>
      </span>
    );
  }
  if (normalized === 'gemini') {
    return (
      <span className="neo-brand-icon is-gemini" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3.2c.6 4.7 4.1 8.2 8.8 8.8-4.7.6-8.2 4.1-8.8 8.8-.6-4.7-4.1-8.2-8.8-8.8 4.7-.6 8.2-4.1 8.8-8.8Z"
            fill="currentColor"
          />
        </svg>
      </span>
    );
  }
  if (normalized === 'deepseek') {
    return (
      <span className="neo-brand-icon is-deepseek" style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M4.5 14.2c1.2-3.7 4.4-6.2 8.3-6.2 3.1 0 5.5 1.6 6.7 4.1-.9.3-1.8.2-2.6-.2-.8 2.9-3.2 4.6-6.5 4.6-2.5 0-4.6-.9-5.9-2.3Z"
            fill="currentColor"
          />
          <circle cx="14.2" cy="11.3" r="1.1" fill="#fff" />
        </svg>
      </span>
    );
  }
  return (
    <span className="neo-brand-icon is-api" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="8.8" cy="15.2" r="3.6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M11.4 12.6 18.8 5.2M16.2 7.8l2 2M18.3 5.7l1.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8.3 18.7 4 20l1.3-4.3L16.5 4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={open ? 'neo-chevron is-open' : 'neo-chevron'}
    >
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={open ? 'ai-dock-caret is-open' : 'ai-dock-caret'}
    >
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM9 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5c.7 4.2 3.8 7.3 8 8-4.2.7-7.3 3.8-8 8-.7-4.2-3.8-7.3-8-8 4.2-.7 7.3-3.8 8-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CheckSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5.5 12.5 4.2 4.2 8.8-9.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckBadge() {
  return (
    <span className="neo-check-badge" title="当前使用中" aria-label="当前使用中">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="m8.2 12.3 2.5 2.5 5.3-5.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function SpeedPill({ result }: { result?: SpeedResult }) {
  if (!result) return null;
  if (!result.ok) {
    return <span className="neo-speed-pill is-slow">测速失败</span>;
  }
  const sec = result.seconds ?? 0;
  const tier = result.speedTier ?? (sec <= 4 ? 'fast' : sec <= 10 ? 'normal' : 'slow');
  const label = tier === 'fast' ? `⚡ ${sec}s · 快` : tier === 'normal' ? `⏱ ${sec}s · 适中` : `🐢 ${sec}s · 偏慢`;
  return <span className={`neo-speed-pill is-${tier}`}>{label}</span>;
}

function formatResetTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 思考档位分段选择器：按模型实际支持的档位动态渲染。 */
function ThinkingLevelSelector({
  value,
  levels,
  disabled,
  onChange,
}: {
  value: string;
  levels: string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const usable = levels.length ? levels : ['off'];
  if (usable.length <= 1) {
    return (
      <div className="neo-thinking-row">
        <span className="neo-thinking-caption">思考档位</span>
        <span className="neo-cap-pill">该模型为固定模式（{THINKING_LABEL[usable[0]] ?? usable[0]}）</span>
      </div>
    );
  }
  return (
    <div className="neo-thinking-block">
      <div className="neo-thinking-header">
        <span className="neo-thinking-caption">思考档位</span>
        <small className="muted">轻度/关闭速度更快，深度适合复杂多城规划</small>
      </div>
      <div className="neo-thinking-pills" role="radiogroup" aria-label="思考档位">
        {usable.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            disabled={disabled}
            className={value === level ? 'neo-thinking-pill active' : 'neo-thinking-pill'}
            onClick={() => onChange(level)}
          >
            {THINKING_LABEL[level] ?? level}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 页面顶部的 AI 控制坞：清爽呈现当前服务与状态，并支持直接切换模型、调节思考强度。 */
export function PlannerAiStatusBar({
  status,
  offline = false,
  onOpen,
  onChange,
}: {
  status: AiStatus | null;
  offline?: boolean;
  onOpen: () => void;
  onChange: (status: AiStatus) => void;
}) {
  const [openMenu, setOpenMenu] = useState<'provider' | 'model' | null>(null);
  const [switching, setSwitching] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [pendingThinking, setPendingThinking] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [fallbackCatalog, setFallbackCatalog] = useState<Record<string, ModelCatalogItem[]>>({});
  const [error, setError] = useState('');
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  // 服务状态变化时清除乐观高亮
  useEffect(() => {
    setPendingThinking(null);
    setPendingModel(null);
  }, [status?.provider, status?.modelId, status?.thinking]);

  // 兼容未重启的旧后端进程：若 health 尚未返回 models 目录，静默补拉一次以立即支持内联模型切换
  const activeProviderId = status?.provider ?? '';
  const hasInlineModels = Boolean(
    status?.models?.length ||
    status?.subscriptions?.find((item) => item.id === activeProviderId)?.models?.length ||
    fallbackCatalog[activeProviderId]?.length,
  );
  useEffect(() => {
    if (!status?.configured || !activeProviderId || hasInlineModels) return;
    let alive = true;
    void plannerApi<AiState>('ai-settings', {}, AbortSignal.timeout(10000), () => {})
      .then((full) => {
        if (!alive) return;
        const sub = full.subscriptions?.find((item) => item.id === activeProviderId);
        const prov = full.providers?.find((item) => item.id === activeProviderId);
        const list = sub?.models ?? prov?.models ?? [];
        if (list.length) {
          setFallbackCatalog((prev) => ({ ...prev, [activeProviderId]: list }));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [status?.configured, activeProviderId, hasInlineModels]);

  if (!status || !status.configured) {
    const title = !status && offline ? 'AI 登录与设置' : 'AI 尚未配置';
    const subtitle = 'ChatGPT / Claude / Kimi / Gemini';
    return (
      <div className="planner-ai-status is-unconfigured" role="status">
        <div className="ai-dock-brand">
          <span className="planner-ai-avatar">
            <AiProviderIcon kind="api" size={32} />
            <span className="planner-ai-status-dot is-idle" aria-hidden="true" />
          </span>
          <div className="ai-dock-identity">
            <div className="ai-dock-title-row">
              <strong>{title}</strong>
              <span className="ai-dock-auth-tag">订阅 / API</span>
            </div>
            <div className="ai-dock-subline">
              <span>{subtitle}</span>
            </div>
          </div>
        </div>
        <button className="ai-dock-settings-btn primary" type="button" onClick={onOpen}>
          <span>{!status && offline ? '登录配置' : '配置 AI'}</span>
          <ChevronIcon />
        </button>
      </div>
    );
  }

  const parts = (status.label ?? status.model ?? '').split(' · ');
  const providerName = parts[0] || status.provider;
  const activeModelId = pendingModel ?? (status.modelId || parts[1] || '');
  const isSubscription = status.authMode === 'subscription' || status.provider.startsWith('sub:');
  const activeSub = status.subscriptions?.find((item) => item.id === status.provider);
  const thinkingLevels = status.thinkingLevels ?? ['off'];
  const currentThinking = pendingThinking ?? (status.thinking ?? 'low');

  const rawCatalog = status.models?.length
    ? status.models
    : (activeSub?.models?.length ? activeSub.models : (fallbackCatalog[status.provider] ?? []));
  const catalogList: ModelCatalogItem[] =
    activeModelId && !rawCatalog.some((item) => item.id === activeModelId)
      ? [
          {
            id: activeModelId,
            name: activeModelId,
            vision: status.vision !== false,
            thinkingLevels,
          },
          ...rawCatalog,
        ]
      : rawCatalog;

  const activeModelMeta = catalogList.find((item) => item.id === activeModelId);
  const activeModelDisplay = activeModelMeta?.name || activeModelId || '选择模型';
  const canRefreshModels = status.provider !== 'sub:gemini';

  async function ensureModelCatalogLoaded() {
    if (rawCatalog.length > 0) return;
    try {
      const full = await plannerApi<AiState>('ai-settings', {}, AbortSignal.timeout(10000), () => {});
      const sub = full.subscriptions?.find((item) => item.id === status!.provider);
      const prov = full.providers?.find((item) => item.id === status!.provider);
      const list = sub?.models ?? prov?.models ?? [];
      if (list.length) {
        setFallbackCatalog((prev) => ({ ...prev, [status!.provider]: list }));
      }
    } catch {
      // 忽略兜底拉取失败，仍可打开完整设置
    }
  }

  async function selectProvider(nextProvider: string) {
    setOpenMenu(null);
    if (nextProvider === status!.provider || switching) return;
    setSwitching(true);
    setError('');
    try {
      onChange(await switchAiProvider(nextProvider));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换服务商失败');
    } finally {
      setSwitching(false);
    }
  }

  async function selectModel(nextModelId: string) {
    setOpenMenu(null);
    if (!nextModelId || nextModelId === (status!.modelId || parts[1]) || switching) return;
    setPendingModel(nextModelId);
    setSwitching(true);
    setError('');
    try {
      onChange(await switchAiProvider(status!.provider, { model: nextModelId }));
    } catch (reason) {
      setPendingModel(null);
      setError(reason instanceof Error ? reason.message : '切换模型失败');
    } finally {
      setSwitching(false);
    }
  }

  async function selectThinking(nextLevel: string) {
    if (nextLevel === (status!.thinking ?? 'low') || switching) return;
    setPendingThinking(nextLevel);
    setSwitching(true);
    setError('');
    try {
      onChange(await switchAiProvider(status!.provider, { thinking: nextLevel }));
    } catch (reason) {
      setPendingThinking(null);
      setError(reason instanceof Error ? reason.message : '切换思考强度失败');
    } finally {
      setSwitching(false);
    }
  }

  async function refreshModelsInline() {
    if (refreshingModels || switching) return;
    setRefreshingModels(true);
    setError('');
    try {
      const res = await plannerApi<{ count: number; state: AiState }>(
        'ai-models-refresh',
        { provider: status!.provider },
        AbortSignal.timeout(15000),
        () => {},
      );
      onChange(normalizeAiStatus(res.state));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同步模型列表失败');
    } finally {
      setRefreshingModels(false);
    }
  }

  return (
    <div ref={barRef} className={`planner-ai-status${switching ? ' is-busy' : ''}`} role="region" aria-label="AI 模型与思考控制栏">
      <div className="ai-dock-row">
        {/* 左侧：品牌标识 + 安静的运行状态行 */}
        <div className="ai-dock-brand">
          <span className="planner-ai-avatar">
            <AiProviderIcon kind={status.provider} size={32} />
            <span className="planner-ai-status-dot" aria-hidden="true" />
          </span>
          <div className="ai-dock-identity">
            <div className="ai-dock-title-row">
              {status.saved.length > 1 ? (
                <div className="ai-dock-dropdown-wrap">
                  <button
                    type="button"
                    className={`ai-dock-provider-btn${openMenu === 'provider' ? ' is-open' : ''}`}
                    aria-haspopup="listbox"
                    aria-expanded={openMenu === 'provider'}
                    disabled={switching}
                    onClick={() => setOpenMenu(openMenu === 'provider' ? null : 'provider')}
                    title="切换已保存的 AI 服务商"
                  >
                    <strong>{providerName}</strong>
                    <ChevronDownIcon open={openMenu === 'provider'} />
                  </button>
                  {openMenu === 'provider' && (
                    <div className="ai-dock-popover is-providers" role="listbox" aria-label="切换 AI 服务商">
                      <div className="ai-dock-popover-head">
                        <span>已配置服务</span>
                      </div>
                      <div className="ai-dock-popover-list">
                        {status.saved.map((item) => {
                          const active = item.id === status.provider;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={`ai-dock-option${active ? ' is-selected' : ''}`}
                              onClick={() => void selectProvider(item.id)}
                            >
                              <AiProviderIcon kind={item.id} size={22} />
                              <span className="ai-dock-option-main">
                                <span className="ai-dock-option-name">{item.label}</span>
                                {item.model && <span className="ai-dock-option-sub">{item.model}</span>}
                              </span>
                              <span className="ai-dock-option-end">
                                <span className="ai-dock-mini-tag">{item.authMode === 'subscription' ? '订阅' : 'API'}</span>
                                {active && <span className="ai-dock-option-check"><CheckSmallIcon /></span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="ai-dock-popover-foot">
                        <button
                          type="button"
                          className="ai-dock-foot-btn"
                          onClick={() => {
                            setOpenMenu(null);
                            onOpen();
                          }}
                        >
                          管理订阅与 API 服务…
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <strong>{providerName}</strong>
              )}
              <span className={isSubscription ? 'ai-dock-auth-tag is-sub' : 'ai-dock-auth-tag'}>
                {isSubscription ? '订阅' : 'API'}
              </span>
            </div>
            <div className="ai-dock-subline">
              <span className={status.searchAvailable ? 'ai-dock-net is-on' : 'ai-dock-net'}>
                <i className="ai-dock-net-dot" aria-hidden="true" />
                {status.searchAvailable ? status.searchLabel : '未联网'}
              </span>
              {status.vision === false && (
                <>
                  <span className="ai-dock-sep" aria-hidden="true">·</span>
                  <span className="ai-dock-meta-item" title="纯文本模型，上传截图时自动使用本机离线 OCR 或借用多模态模型">
                    OCR 识图
                  </span>
                </>
              )}
              {activeSub?.quota?.status === 'ok' && typeof activeSub.quota.remainingPercent === 'number' && (
                <>
                  <span className="ai-dock-sep" aria-hidden="true">·</span>
                  <span className="ai-dock-meta-item">7天余 {activeSub.quota.remainingPercent}%</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：直接可调的模型选择器 + 思考强度分段控件 + 设置入口 */}
        <div className="ai-dock-controls">
          {/* 1. 模型选择器 */}
          <div className="ai-dock-dropdown-wrap is-model-wrap">
            <button
              type="button"
              className={`ai-dock-model-trigger${openMenu === 'model' ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={openMenu === 'model'}
              aria-label="切换模型"
              disabled={switching}
              onClick={() => {
                const next = openMenu === 'model' ? null : 'model';
                setOpenMenu(next);
                if (next === 'model') void ensureModelCatalogLoaded();
              }}
              title={`当前模型：${activeModelId || activeModelDisplay}（点击切换）`}
            >
              <span className="ai-dock-field-label">模型</span>
              <span className="ai-dock-model-value">{activeModelDisplay}</span>
              <ChevronDownIcon open={openMenu === 'model'} />
            </button>
            {openMenu === 'model' && (
              <div className="ai-dock-popover is-models" role="listbox" aria-label="选择模型">
                <div className="ai-dock-popover-head">
                  <span>{providerName} 模型</span>
                  {canRefreshModels && (
                    <button
                      type="button"
                      className="ai-dock-refresh-link"
                      disabled={refreshingModels || switching}
                      onClick={() => void refreshModelsInline()}
                    >
                      {refreshingModels ? '同步中…' : '↻ 刷新'}
                    </button>
                  )}
                </div>
                <div className="ai-dock-popover-list">
                  {catalogList.length > 0 ? (
                    catalogList.map((item) => {
                      const selected = item.id === activeModelId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`ai-dock-option${selected ? ' is-selected' : ''}`}
                          onClick={() => void selectModel(item.id)}
                        >
                          <span className="ai-dock-option-main">
                            <span className="ai-dock-option-name">
                              {item.name}
                              {item.latest && <em className="ai-dock-latest-badge">新</em>}
                            </span>
                            {item.name !== item.id && <span className="ai-dock-option-sub">{item.id}</span>}
                          </span>
                          <span className="ai-dock-option-end">
                            {!item.vision && <span className="ai-dock-mini-tag">OCR</span>}
                            {selected && <span className="ai-dock-option-check"><CheckSmallIcon /></span>}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="ai-dock-popover-empty">当前服务商未提供预设列表，可在设置中自定义模型名</div>
                  )}
                </div>
                <div className="ai-dock-popover-foot">
                  <button
                    type="button"
                    className="ai-dock-foot-btn"
                    onClick={() => {
                      setOpenMenu(null);
                      onOpen();
                    }}
                  >
                    自定义模型 / 切换服务商…
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. 思考强度分段控制器 */}
          {thinkingLevels.length > 1 ? (
            <div className="ai-dock-thinking" title="调节思考强度：关闭/轻度响应更快，深度/极致适合复杂规划">
              <span className="ai-dock-thinking-label">
                <SparkIcon />
                <span>思考</span>
              </span>
              <div className="ai-dock-seg-track" role="radiogroup" aria-label="思考强度">
                {thinkingLevels.map((level) => {
                  const active = currentThinking === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={switching}
                      className={active ? 'ai-dock-seg-btn is-active' : 'ai-dock-seg-btn'}
                      onClick={() => void selectThinking(level)}
                    >
                      {THINKING_LABEL[level] ?? level}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="ai-dock-thinking is-fixed" title="当前模型为固定思考模式">
              <span className="ai-dock-thinking-label">
                <SparkIcon />
                <span>思考 · {THINKING_LABEL[thinkingLevels[0]] ?? thinkingLevels[0]}</span>
              </span>
            </div>
          )}

          {/* 3. 服务与订阅管理入口 */}
          <button
            className="ai-dock-settings-btn"
            type="button"
            onClick={onOpen}
            title="管理订阅、API Key、测速与自定义模型"
          >
            <SlidersIcon />
            <span>{status.saved.length > 1 ? '管理' : '切换 / 订阅'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="ai-dock-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="关闭提示">×</button>
        </div>
      )}
    </div>
  );
}

/**
 * NeoRead 风格 AI 服务与订阅配置弹窗：
 * - 动态拉取并按最新版本优先排序（GPT-6.2 / Opus 5.5 / Sonnet 5.5 / Fable 5.2 / K3.1 / Gemini 4 Neon 等）
 * - 支持思考档位调节（关闭 / 极轻 / 轻度 / 标准 / 深度 / 超深 / 极致）
 * - 清晰标注看图能力（纯文本模型自动兼容本地 OCR 识图）
 * - 内置单模型测速与全部已连接模型一键测速
 */
export default function PlannerAiSettings({
  initialOffline = false,
  onClose,
  onSaved,
}: {
  initialOffline?: boolean;
  onClose: () => void;
  onSaved: (status: AiStatus) => void;
}) {
  const [state, setState] = useState<AiState | null>(() => (initialOffline ? FALLBACK_OFFLINE_STATE : null));
  const [expandedCard, setExpandedCard] = useState<string>('');
  const [sessions, setSessions] = useState<Record<string, LoginSession>>({});
  const [manualCodes, setManualCodes] = useState<Record<string, string>>({});
  const [showPasteBox, setShowPasteBox] = useState<Record<string, boolean>>({});
  const [customSubModel, setCustomSubModel] = useState<Record<string, string>>({});
  const [editingCustomSubModel, setEditingCustomSubModel] = useState<Record<string, boolean>>({});
  const [cardNotice, setCardNotice] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [speedResults, setSpeedResults] = useState<Record<string, SpeedResult>>({});
  const [busyKey, setBusyKey] = useState('');

  // API 面板表单状态
  const [apiProvider, setApiProvider] = useState('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiThinking, setApiThinking] = useState('low');
  const [apiMessage, setApiMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [backendOffline, setBackendOffline] = useState(initialOffline);
  const [remoteOrigin, setRemoteOrigin] = useState(() => getPlannerApiOrigin());
  const [showRemoteBox, setShowRemoteBox] = useState(initialOffline);
  const [remoteNotice, setRemoteNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const pollTimers = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);
  const request = <T,>(endpoint: string, body: unknown, timeoutMs = 60000) =>
    plannerApi<T>(endpoint, body, AbortSignal.timeout(timeoutMs), () => {});

  const stopPolling = (key: string) => {
    const timer = pollTimers.current.get(key);
    if (timer !== undefined) {
      window.clearInterval(timer);
      pollTimers.current.delete(key);
    }
  };

  const loadSettings = useCallback(async (notifyParentOnSuccess = false) => {
    try {
      const current = normalizeAiStatus(await request<AiState>('ai-settings', {}, 12000));
      if (!mountedRef.current) return false;
      setBackendOffline(false);
      setGlobalError('');
      setState(current);
      const initialApiProvider = current.provider.startsWith('sub:')
        ? (current.saved.find((item) => item.authMode === 'api')?.id ?? 'deepseek')
        : current.provider;
      const spec = current.providers.find((item) => item.id === initialApiProvider);
      const savedApi = current.saved.find((item) => item.id === initialApiProvider);
      setApiProvider(initialApiProvider);
      setApiModel(
        initialApiProvider === current.provider ? current.model : (savedApi?.model ?? spec?.model ?? ''),
      );
      setApiBaseUrl(initialApiProvider === current.provider ? current.baseUrl : (spec?.baseUrl ?? ''));
      setApiThinking(
        initialApiProvider === current.provider ? (current.thinking ?? 'low') : (savedApi?.thinking ?? 'low'),
      );
      const restoredSessions: Record<string, LoginSession> = {};
      for (const sub of current.subscriptions) {
        if (sub.pendingSession) {
          restoredSessions[sub.key] = sub.pendingSession;
          startPollingLogin(sub);
        }
      }
      if (Object.keys(restoredSessions).length > 0) {
        setSessions(restoredSessions);
        const firstPending = current.subscriptions.find((sub) => sub.pendingSession);
        if (firstPending) setExpandedCard(firstPending.id);
      }
      if (current.subscriptions.some((sub) => sub.key === 'claude' && sub.connected)) {
        void refreshQuota('sub:claude', false);
      }
      if (notifyParentOnSuccess) onSaved(current);
      return true;
    } catch {
      if (!mountedRef.current) return false;
      setBackendOffline(true);
      setShowRemoteBox(true);
      setState((prev) => prev ?? FALLBACK_OFFLINE_STATE);
      setApiProvider((prev) => prev || 'deepseek');
      setApiModel((prev) => prev || 'deepseek-flash');
      setApiBaseUrl((prev) => prev || 'https://api.deepseek.com');
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadSettings(false);
    return () => {
      mountedRef.current = false;
      for (const timer of pollTimers.current.values()) window.clearInterval(timer);
      pollTimers.current.clear();
    };
  }, [loadSettings]);

  async function connectRemoteOrigin(nextOrigin: string) {
    setBusyKey('remote:connect');
    setRemoteNotice(null);
    try {
      const saved = setPlannerApiOrigin(nextOrigin);
      setRemoteOrigin(saved);
      const ok = await loadSettings(true);
      if (ok) {
        setShowRemoteBox(false);
        setRemoteNotice({ ok: true, text: saved ? `已连通 AI 服务：${saved}` : '已连通本地 AI 服务' });
      } else {
        setRemoteNotice({
          ok: false,
          text: saved
            ? `已保存地址 ${saved}，但暂未连通。请确认电脑端已启动且手机与电脑在同一局域网（或公网地址可访问）。`
            : '当前设备未运行本地 AI 服务端，请填写电脑端或自建服务器地址。',
        });
      }
    } catch (error) {
      setRemoteNotice({ ok: false, text: error instanceof Error ? error.message : '服务地址格式无效' });
    } finally {
      setBusyKey('');
    }
  }

  function applyState(next: AiState) {
    const normalized = normalizeAiStatus(next);
    setState(normalized);
    onSaved(normalized);
    return normalized;
  }

  async function refreshQuota(subId: string, force: boolean) {
    try {
      const { quota } = await request<{ quota: SubscriptionQuota }>('ai-sub-quota', { provider: subId, force }, 15000);
      setState((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((item) =>
                item.id === subId ? { ...item, quota } : item,
              ),
            }
          : prev,
      );
    } catch {
      // ignore
    }
  }

  async function refreshModelsFor(providerId: string, noticeKey?: string, extraBody: Record<string, string> = {}) {
    setBusyKey(`refresh:${providerId}`);
    try {
      const res = await request<{ count: number; state: AiState }>(
        'ai-models-refresh',
        { provider: providerId, ...extraBody },
        15000,
      );
      applyState(res.state);
      const text =
        res.count > 0
          ? `已从官方接口同步最新模型（共 ${res.count} 项），最新版本已排在顶部`
          : '当前使用内置最新模型目录（未发现更多远端新增项或尚未连接）';
      if (noticeKey) setCardNotice((prev) => ({ ...prev, [noticeKey]: { ok: true, text } }));
      else setApiMessage({ ok: true, text });
    } catch (error) {
      const text = error instanceof Error ? error.message : '拉取最新模型失败';
      if (noticeKey) setCardNotice((prev) => ({ ...prev, [noticeKey]: { ok: false, text } }));
      else setApiMessage({ ok: false, text });
    } finally {
      setBusyKey('');
    }
  }

  function startPollingLogin(sub: SubscriptionProfile) {
    stopPolling(sub.key);
    const intervalMs = sub.loginKind === 'device_code' ? 2000 : 1500;
    const timer = window.setInterval(async () => {
      try {
        const res = await request<{ session: LoginSession; state: AiState }>('ai-sub-status', { provider: sub.id }, 15000);
        setSessions((prev) => ({ ...prev, [sub.key]: res.session }));
        if (res.session.status === 'connected') {
          stopPolling(sub.key);
          applyState(res.state);
          setCardNotice((prev) => ({
            ...prev,
            [sub.key]: { ok: true, text: `已连接 ${sub.name} 并自动启用` },
          }));
          if (sub.key === 'claude') void refreshQuota('sub:claude', true);
        } else if (res.session.status === 'error' || res.session.status === 'cancelled') {
          stopPolling(sub.key);
        } else if (sub.key === 'gemini' && !res.session.installRunning && res.session.cliInstalled && res.session.status === 'gemini_needs_auth') {
          setState(normalizeAiStatus(res.state));
        }
      } catch {
        // ignore transient poll error
      }
    }, intervalMs);
    pollTimers.current.set(sub.key, timer);
  }

  async function beginSubscriptionConnect(sub: SubscriptionProfile, method = '') {
    setExpandedCard(sub.id);
    if (backendOffline) {
      setShowRemoteBox(true);
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: '请先在上方填写电脑端或自建 AI 服务地址并点击「连接并刷新」，连通后即可发起授权登录。' },
      }));
      return;
    }
    setBusyKey(`connect:${sub.key}`);
    setCardNotice((prev) => {
      const next = { ...prev };
      delete next[sub.key];
      return next;
    });
    // 在点击事件同步阶段预先打开空白页，避免 await 接口返回后被浏览器弹窗拦截器静默挡住。
    const wantsBrowserTab = sub.loginKind === 'oauth_browser' || sub.loginKind === 'device_code';
    const popup = wantsBrowserTab ? window.open('about:blank', '_blank') : null;
    try {
      const res = await request<{ session: LoginSession; state: AiState }>(
        'ai-sub-login',
        { provider: sub.id, force: true, ...(method ? { method } : {}) },
        30000,
      );
      setSessions((prev) => ({ ...prev, [sub.key]: res.session }));
      if (res.session.status === 'connected') {
        popup?.close();
        applyState(res.state);
        setCardNotice((prev) => ({
          ...prev,
          [sub.key]: { ok: true, text: `已连接 ${sub.name} 并自动启用` },
        }));
        if (sub.key === 'claude') void refreshQuota('sub:claude', true);
        return;
      }
      const openUrl = res.session.authUrl || res.session.verificationUri;
      if (openUrl) {
        if (popup && !popup.closed) {
          popup.location.href = openUrl;
        } else {
          window.open(openUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        popup?.close();
      }
      if (['awaiting_auth', 'awaiting_device', 'exchanging', 'pending'].includes(res.session.status)) {
        startPollingLogin(sub);
      }
    } catch (error) {
      popup?.close();
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: error instanceof Error ? error.message : '发起授权失败，请重试' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  async function cancelSubscriptionConnect(sub: SubscriptionProfile) {
    stopPolling(sub.key);
    setSessions((prev) => {
      const next = { ...prev };
      delete next[sub.key];
      return next;
    });
    try {
      await request('ai-sub-cancel', { provider: sub.id }, 10000);
    } catch {
      // ignore
    }
  }

  async function submitManualAuthCode(sub: SubscriptionProfile) {
    const code = (manualCodes[sub.key] ?? '').trim();
    if (!code) return;
    setBusyKey(`code:${sub.key}`);
    try {
      const res = await request<{ session: LoginSession }>('ai-sub-code', { provider: sub.id, code }, 20000);
      setSessions((prev) => ({ ...prev, [sub.key]: res.session }));
      setManualCodes((prev) => ({ ...prev, [sub.key]: '' }));
      startPollingLogin(sub);
    } catch (error) {
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: error instanceof Error ? error.message : '提交授权码失败' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  async function launchGeminiAuth(sub: SubscriptionProfile) {
    setBusyKey('gemini-auth');
    try {
      await request('ai-sub-gemini-auth', {}, 15000);
      setCardNotice((prev) => ({
        ...prev,
        gemini: { ok: true, text: '已打开本地终端运行 gemini，完成 Google 账号登录后将自动检测连接。' },
      }));
      startPollingLogin(sub);
    } catch (error) {
      setCardNotice((prev) => ({
        ...prev,
        gemini: { ok: false, text: error instanceof Error ? error.message : '无法打开终端，请手动运行 gemini 完成登录' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  async function installGeminiCli(sub: SubscriptionProfile) {
    setBusyKey('gemini-install');
    try {
      await request('ai-sub-gemini-install', {}, 15000);
      setCardNotice((prev) => ({
        ...prev,
        gemini: { ok: true, text: '正在后台安装官方 @google/gemini-cli，请稍候约 30 秒…' },
      }));
      startPollingLogin(sub);
    } catch (error) {
      setCardNotice((prev) => ({
        ...prev,
        gemini: { ok: false, text: error instanceof Error ? error.message : '安装启动失败' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  async function updateSubscriptionConfig(
    sub: SubscriptionProfile,
    patch: { model?: string; thinking?: string; activate?: boolean },
  ) {
    if (backendOffline) {
      setShowRemoteBox(true);
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: '请先在上方连接电脑端或自建 AI 服务地址，连通后即可保存模型与思考档位。' },
      }));
      return;
    }
    setBusyKey(`model:${sub.key}`);
    setCardNotice((prev) => {
      const next = { ...prev };
      delete next[sub.key];
      return next;
    });
    try {
      const updated = await request<AiState>('ai-sub-model', {
        provider: sub.id,
        ...(patch.model ? { model: patch.model.trim() } : {}),
        ...(patch.thinking ? { thinking: patch.thinking } : {}),
        activate: patch.activate || sub.active,
      });
      applyState(updated);
      if (patch.model) setEditingCustomSubModel((prev) => ({ ...prev, [sub.key]: false }));
      const desc = patch.model
        ? `已切换模型为 ${patch.model.trim()}`
        : `思考档位已设为「${THINKING_LABEL[patch.thinking ?? ''] ?? patch.thinking}」`;
      setCardNotice((prev) => ({ ...prev, [sub.key]: { ok: true, text: desc } }));
    } catch (error) {
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: error instanceof Error ? error.message : '保存设置失败' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  async function activateProvider(providerId: string, noticeKey?: string) {
    setBusyKey(`use:${providerId}`);
    try {
      const next = await switchAiProvider(providerId);
      setState(next);
      onSaved(next);
      if (noticeKey) {
        setCardNotice((prev) => ({ ...prev, [noticeKey]: { ok: true, text: `已启用：${next.label}` } }));
      } else {
        setApiMessage({ ok: true, text: `已切换到：${next.label}` });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : '切换失败，请重试';
      if (noticeKey) setCardNotice((prev) => ({ ...prev, [noticeKey]: { ok: false, text } }));
      else setApiMessage({ ok: false, text });
    } finally {
      setBusyKey('');
    }
  }

  async function testSubscription(sub: SubscriptionProfile) {
    setBusyKey(`test:${sub.key}`);
    setCardNotice((prev) => {
      const next = { ...prev };
      delete next[sub.key];
      return next;
    });
    try {
      const result = await request<SpeedResult>('ai-test', {
        provider: sub.id,
        model: sub.model,
        thinking: sub.thinking,
      });
      setSpeedResults((prev) => ({ ...prev, [sub.id]: result }));
      const speedAdvice =
        result.ok && result.speedTier === 'slow'
          ? '（偏慢，建议调低思考档位或改选高速/Flash 模型）'
          : '';
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: result.ok
          ? {
              ok: true,
              text: `连接成功：${result.label} · 耗时 ${result.seconds} 秒（思考：${THINKING_LABEL[result.thinkingUsed ?? sub.thinking] ?? sub.thinking}）${speedAdvice}`,
            }
          : { ok: false, text: result.error ?? '连接失败，请检查账号状态或换个模型' },
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : '连接失败';
      setSpeedResults((prev) => ({ ...prev, [sub.id]: { ok: false, error: text } }));
      setCardNotice((prev) => ({ ...prev, [sub.key]: { ok: false, text } }));
    } finally {
      setBusyKey('');
    }
  }

  /** 并行测速所有已连接订阅和已保存 API 配置，方便一眼对比响应速度。 */
  async function benchmarkAllConnected() {
    if (!state || !state.saved.length) return;
    setBusyKey('benchmark:all');
    try {
      await Promise.all(
        state.saved.map(async (item) => {
          try {
            const result = await request<SpeedResult>(
              'ai-test',
              { provider: item.id, model: item.model, thinking: item.thinking },
              45000,
            );
            setSpeedResults((prev) => ({ ...prev, [item.id]: result }));
          } catch (error) {
            setSpeedResults((prev) => ({
              ...prev,
              [item.id]: { ok: false, error: error instanceof Error ? error.message : '超时或失败' },
            }));
          }
        }),
      );
    } finally {
      setBusyKey('');
    }
  }

  async function disconnectSubscription(sub: SubscriptionProfile) {
    stopPolling(sub.key);
    setBusyKey(`logout:${sub.key}`);
    try {
      const updated = await request<AiState>('ai-sub-logout', { provider: sub.id });
      applyState(updated);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[sub.key];
        return next;
      });
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: true, text: `已断开 ${sub.name} 订阅连接` },
      }));
    } catch (error) {
      setCardNotice((prev) => ({
        ...prev,
        [sub.key]: { ok: false, text: error instanceof Error ? error.message : '断开失败' },
      }));
    } finally {
      setBusyKey('');
    }
  }

  // ---- API 面板状态 ----
  const apiSavedProfiles = (state?.saved ?? []).filter((item) => item.authMode !== 'subscription');
  const apiActiveProfile = state && !state.provider.startsWith('sub:') && state.configured
    ? apiSavedProfiles.find((item) => item.id === state.provider)
    : undefined;
  const apiOption = state?.providers.find((item) => item.id === apiProvider);
  const apiSavedCurrent = apiSavedProfiles.find((item) => item.id === apiProvider);
  const apiCatalog = apiOption?.models ?? [];
  const selectedApiModelMeta = apiCatalog.find((item) => item.id === apiModel) ?? apiCatalog[0];
  const apiThinkingLevels = selectedApiModelMeta?.thinkingLevels ?? ['off', 'low', 'medium', 'high'];
  const apiModelVision = selectedApiModelMeta ? selectedApiModelMeta.vision : apiProvider !== 'deepseek';
  const apiKeyHint = apiSavedCurrent ? '已保存，留空则继续使用' : '粘贴该服务商的 API Key';

  function chooseApiProvider(id: string) {
    const next = state?.providers.find((item) => item.id === id);
    const saved = apiSavedProfiles.find((item) => item.id === id);
    setApiProvider(id);
    setApiModel(id === state?.provider ? state.model : (saved?.model ?? next?.model ?? ''));
    setApiBaseUrl(id === state?.provider ? state.baseUrl : (next?.baseUrl ?? ''));
    setApiThinking(id === state?.provider ? (state.thinking ?? 'low') : (saved?.thinking ?? 'low'));
    setApiKey('');
    setApiMessage(null);
  }

  const apiPayload = () => ({
    provider: apiProvider,
    apiKey: apiKey.trim(),
    model: apiModel.trim(),
    baseUrl: apiBaseUrl.trim(),
    thinking: apiThinking,
  });

  async function testApi() {
    if (backendOffline) {
      setShowRemoteBox(true);
      setApiMessage({ ok: false, text: '请先在上方连接电脑端或自建 AI 服务地址，连通后即可测试并保存 API Key。' });
      return;
    }
    setBusyKey('api:test');
    setApiMessage(null);
    try {
      const result = await request<SpeedResult>('ai-test', apiPayload());
      setSpeedResults((prev) => ({ ...prev, [apiProvider]: result }));
      const speedAdvice =
        result.ok && result.speedTier === 'slow'
          ? '（偏慢，建议调低思考档位或换高速模型）'
          : '';
      setApiMessage(
        result.ok
          ? {
              ok: true,
              text: `连接成功：${result.label} · 耗时 ${result.seconds} 秒（思考：${THINKING_LABEL[result.thinkingUsed ?? apiThinking] ?? apiThinking}）${speedAdvice}`,
            }
          : { ok: false, text: result.error ?? '连接失败，请检查配置' },
      );
    } catch (error) {
      setApiMessage({ ok: false, text: error instanceof Error ? error.message : '连接失败，请检查配置' });
    } finally {
      setBusyKey('');
    }
  }

  async function saveApi() {
    if (backendOffline) {
      setShowRemoteBox(true);
      setApiMessage({ ok: false, text: '请先在上方连接电脑端或自建 AI 服务地址，连通后即可保存并启用 API。' });
      return;
    }
    setBusyKey('api:save');
    setApiMessage(null);
    try {
      const saved = await request<AiState>('ai-settings', { ...apiPayload(), save: true });
      applyState(saved);
      setApiKey('');
      setApiMessage({ ok: true, text: `已保存并启用：${saved.label}` });
    } catch (error) {
      setApiMessage({ ok: false, text: error instanceof Error ? error.message : '保存失败，请重试' });
    } finally {
      setBusyKey('');
    }
  }

  function jumpToGeminiApi() {
    setExpandedCard('api');
    chooseApiProvider('gemini');
  }

  const subscriptions = state?.subscriptions ?? [];
  const apiExpanded = expandedCard === 'api';

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyKey) onClose();
      }}
    >
      <section className="dialog planner-ai-settings neo-ai-dialog" role="dialog" aria-modal="true" aria-label="配置 AI">
        <div className="card-heading neo-ai-header">
          <div>
            <h2>AI 服务与订阅</h2>
            <p className="muted neo-ai-current">
              {state
                ? state.configured
                  ? `当前使用：${state.label} · 思考${THINKING_LABEL[state.thinking ?? 'low'] ?? state.thinking}${state.searchAvailable ? ` · ${state.searchLabel}` : ' · 未联网'}`
                  : '优先展示最新模型，支持订阅授权、自定义 API、思考档位与本地 OCR 识图兼容'
                : '正在读取配置…'}
            </p>
          </div>
          <div className="neo-header-tools">
            {state && state.saved.length > 0 && (
              <button
                type="button"
                className="secondary neo-bench-btn"
                disabled={Boolean(busyKey)}
                onClick={() => void benchmarkAllConnected()}
                title="测速所有已连接订阅与已保存 API"
              >
                {busyKey === 'benchmark:all' ? '测速中…' : '⚡ 一键测速'}
              </button>
            )}
            <button className="text-button neo-close-btn" type="button" onClick={onClose} aria-label="关闭">×</button>
          </div>
        </div>

        {globalError && <p role="alert" className="planner-error">{globalError}</p>}

        {(backendOffline || showRemoteBox) ? (
          <div className="neo-remote-bar" role="region" aria-label="AI 服务端地址">
            <div className="neo-remote-bar-head">
              <strong>{backendOffline ? '连接电脑端 / 自建 AI 服务' : '远程 AI 服务地址'}</strong>
              {!backendOffline && (
                <button type="button" className="text-button" onClick={() => setShowRemoteBox(false)}>收起</button>
              )}
            </div>
            <p className="muted">
              手机版需连接桌面端或自建服务来执行订阅 OAuth 登录与 AI 规划（同一 Wi-Fi 下填电脑局域网地址）。
            </p>
            <div className="neo-remote-bar-row">
              <input
                type="url"
                value={remoteOrigin}
                placeholder="例如 http://192.168.1.100:14173"
                onChange={(event) => setRemoteOrigin(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                disabled={busyKey === 'remote:connect'}
                onClick={() => void connectRemoteOrigin(remoteOrigin)}
              >
                {busyKey === 'remote:connect' ? '连接中…' : '连接并刷新'}
              </button>
              {remoteOrigin && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busyKey === 'remote:connect'}
                  onClick={() => void connectRemoteOrigin('')}
                >
                  恢复默认
                </button>
              )}
            </div>
            {remoteNotice && (
              <p role="status" className={remoteNotice.ok ? 'planner-ai-ok' : 'planner-error'}>
                {remoteNotice.text}
              </p>
            )}
          </div>
        ) : remoteOrigin ? (
          <div className="neo-remote-pill-row">
            <span className="muted">已连服务端：{remoteOrigin}</span>
            <button type="button" className="text-button" onClick={() => setShowRemoteBox(true)}>修改地址</button>
          </div>
        ) : null}

        <div className="neo-provider-stack">
          {subscriptions.map((sub) => {
            const isExpanded = expandedCard === sub.id;
            const session = sessions[sub.key];
            const notice = cardNotice[sub.key];
            const speed = speedResults[sub.id];
            const isConnecting = Boolean(
              session && ['pending', 'awaiting_auth', 'awaiting_device', 'exchanging'].includes(session.status),
            );
            const hasModelInList = sub.models.some((item) => item.id === sub.model);

            return (
              <article
                key={sub.id}
                className={`neo-provider-card${sub.active ? ' is-active' : ''}${sub.connected ? ' is-connected' : ''}${isExpanded ? ' is-expanded' : ''}`}
              >
                  <div className="neo-provider-row" onClick={() => {
                    if (backendOffline) {
                      setExpandedCard(isExpanded ? '' : sub.id);
                    } else if (!sub.connected && !isExpanded && !isConnecting) {
                      void beginSubscriptionConnect(sub);
                    } else {
                      setExpandedCard(isExpanded ? '' : sub.id);
                    }
                  }}>
                  <div className="neo-provider-lead">
                    <AiProviderIcon kind={sub.key} size={40} />
                    <div className="neo-provider-title-group">
                      <div className="neo-provider-name-line">
                        <strong>{sub.name}</strong>
                        {!sub.connected ? (
                          <span className="neo-status-text is-muted">未连接</span>
                        ) : (
                          <>
                            <code className="neo-model-pill">{sub.model}</code>
                            {sub.thinkingLevels.length > 1 && (
                              <span className="neo-cap-pill">思考:{THINKING_LABEL[sub.thinking] ?? sub.thinking}</span>
                            )}
                            {!sub.vision && <span className="neo-cap-pill is-ocr">OCR识图</span>}
                            <SpeedPill result={speed} />
                          </>
                        )}
                      </div>
                      {sub.connected && sub.quota && (
                        <div className="neo-quota-summary">
                          {sub.quota.status === 'ok' && typeof sub.quota.remainingPercent === 'number' ? (
                            <>
                              <div className="neo-quota-head">
                                <span>{sub.quota.title}</span>
                                <strong>剩余 {sub.quota.remainingPercent}%</strong>
                              </div>
                              <div className="neo-quota-bar" aria-hidden="true">
                                <span style={{ width: `${sub.quota.remainingPercent}%` }} />
                              </div>
                              {sub.quota.resetsAt && (
                                <small>将于 {formatResetTime(sub.quota.resetsAt)} 重置</small>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="neo-quota-head">
                                <span>{sub.quota.title}</span>
                                <span className="neo-quota-dash">—</span>
                              </div>
                              {sub.quota.note && <small>{sub.quota.note}</small>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="neo-provider-side" onClick={(event) => event.stopPropagation()}>
                    <div className="neo-provider-top-badge">
                      {sub.active && <CheckBadge />}
                    </div>
                    <div className="neo-provider-actions">
                      <button
                        type="button"
                        className="neo-icon-btn"
                        title={`设置 ${sub.name} 模型与思考档位`}
                        aria-label={`编辑 ${sub.name}`}
                        onClick={() => setExpandedCard(isExpanded ? '' : sub.id)}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="neo-icon-btn"
                        title={sub.connected ? (isExpanded ? '收起' : '展开详情') : `连接 ${sub.name}`}
                        aria-label={sub.connected ? `展开 ${sub.name}` : `连接 ${sub.name}`}
                        onClick={() => {
                          if (!backendOffline && !sub.connected && !isExpanded && !isConnecting) {
                            void beginSubscriptionConnect(sub);
                          } else {
                            setExpandedCard(isExpanded ? '' : sub.id);
                          }
                        }}
                      >
                        <ChevronIcon open={isExpanded} />
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="neo-provider-drawer">
                    {/* 模型选择区 + 动态刷新 */}
                    <div className="neo-drawer-field">
                      <div className="neo-field-head">
                        <label htmlFor={`sub-model-${sub.key}`}>选择模型（最新优先）</label>
                        {sub.connected && sub.key !== 'gemini' && (
                          <button
                            type="button"
                            className="text-button neo-refresh-btn"
                            disabled={Boolean(busyKey)}
                            onClick={() => void refreshModelsFor(sub.id, sub.key)}
                          >
                            {busyKey === `refresh:${sub.id}` ? '同步中…' : '↻ 刷新最新模型'}
                          </button>
                        )}
                      </div>
                      <div className="neo-model-picker-row">
                        <select
                          id={`sub-model-${sub.key}`}
                          value={editingCustomSubModel[sub.key] ? '__custom__' : (hasModelInList ? sub.model : '__custom__')}
                          disabled={Boolean(busyKey)}
                          onChange={(event) => {
                            const val = event.target.value;
                            if (val === '__custom__') {
                              setEditingCustomSubModel((prev) => ({ ...prev, [sub.key]: true }));
                              setCustomSubModel((prev) => ({ ...prev, [sub.key]: sub.model }));
                            } else {
                              setEditingCustomSubModel((prev) => ({ ...prev, [sub.key]: false }));
                              void updateSubscriptionConfig(sub, { model: val });
                            }
                          }}
                        >
                          {sub.models.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.latest ? '★ ' : ''}
                              {item.name === item.id ? item.id : `${item.name} (${item.id})`}
                              {item.vision ? '' : ' · 纯文本(自动OCR)'}
                            </option>
                          ))}
                          <option value="__custom__">自定义模型名称…</option>
                        </select>
                      </div>
                      {(editingCustomSubModel[sub.key] || !hasModelInList) && (
                        <div className="neo-custom-model-row">
                          <input
                            value={customSubModel[sub.key] ?? sub.model}
                            placeholder={`输入模型名，例如 ${sub.defaultModel}`}
                            onChange={(event) =>
                              setCustomSubModel((prev) => ({ ...prev, [sub.key]: event.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="secondary"
                            disabled={Boolean(busyKey)}
                            onClick={() => void updateSubscriptionConfig(sub, { model: customSubModel[sub.key] ?? sub.model })}
                          >
                            应用模型
                          </button>
                        </div>
                      )}
                      <div className="neo-model-caps">
                        <span className={sub.vision ? 'neo-cap-pill is-ok' : 'neo-cap-pill is-ocr'}>
                          {sub.vision ? '支持直接看图' : '纯文本 · 上传截图自动转本机 OCR / 借用多模态模型'}
                        </span>
                      </div>
                    </div>

                    {/* 思考档位调节 */}
                    <ThinkingLevelSelector
                      value={sub.thinking}
                      levels={sub.thinkingLevels}
                      disabled={Boolean(busyKey)}
                      onChange={(nextLevel) => void updateSubscriptionConfig(sub, { thinking: nextLevel })}
                    />

                    {/* OAuth 授权中面板 */}
                    {isConnecting && session && (
                      <div className="neo-auth-flow-box">
                        <p className="neo-auth-flow-title">
                          <span className="neo-pulse-dot" aria-hidden="true" />
                          {session.progress || '正在等待浏览器完成授权…'}
                        </p>
                        {session.instructions && <small className="muted">{session.instructions}</small>}

                        {session.userCode && (
                          <div className="neo-device-code-box">
                            <span className="muted">设备验证码</span>
                            <div className="neo-device-code-row">
                              <code>{session.userCode}</code>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => void navigator.clipboard?.writeText(session.userCode || '')}
                              >
                                复制验证码
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="neo-drawer-actions">
                          {(session.authUrl || session.verificationUri) && (
                            <a
                              className="primary neo-link-btn"
                              href={session.authUrl || session.verificationUri}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              在浏览器中打开授权页
                            </a>
                          )}
                          {session.canPasteCode && (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setShowPasteBox((prev) => ({ ...prev, [sub.key]: !prev[sub.key] }))}
                            >
                              {showPasteBox[sub.key] ? '收起手动粘贴' : '手动粘贴回调地址'}
                            </button>
                          )}
                          {sub.key === 'chatgpt' && !session.userCode && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={Boolean(busyKey)}
                              onClick={() => void beginSubscriptionConnect(sub, 'codex_device')}
                            >
                              改用设备码登录（免回调）
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void cancelSubscriptionConnect(sub)}
                          >
                            取消授权
                          </button>
                        </div>

                        {session.canPasteCode && showPasteBox[sub.key] && (
                          <div className="neo-paste-code-row">
                            <input
                              value={manualCodes[sub.key] ?? ''}
                              placeholder="粘贴浏览器跳转后的完整地址或授权码"
                              onChange={(event) =>
                                setManualCodes((prev) => ({ ...prev, [sub.key]: event.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="primary"
                              disabled={busyKey === `code:${sub.key}`}
                              onClick={() => void submitManualAuthCode(sub)}
                            >
                              提交
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Gemini CLI 引导区 */}
                    {sub.key === 'gemini' && !sub.connected && (
                      <div className="neo-auth-flow-box">
                        <p className="neo-auth-flow-title">
                          {sub.cliInstalled
                            ? '已检测到本机官方 Gemini CLI，待完成 Google 账号登录'
                            : '使用 Google 账号 / Gemini 订阅需本机安装官方 Gemini CLI'}
                        </p>
                        <small className="muted">
                          {sub.cliInstalled
                            ? '点击下方按钮会打开终端运行 gemini，按提示选择“Sign in with Google”即可自动连接。'
                            : '安装 @google/gemini-cli 后即可使用 Google 账号额度，也可直接改用 Google AI Studio API Key。'}
                        </small>
                        {!sub.cliInstalled && (
                          <div className="neo-cmd-snippet">
                            <code>npm install -g @google/gemini-cli &amp;&amp; gemini</code>
                          </div>
                        )}
                        <div className="neo-drawer-actions">
                          {!sub.cliInstalled ? (
                            <button
                              type="button"
                              className="primary"
                              disabled={busyKey === 'gemini-install' || Boolean(sub.installRunning || session?.installRunning)}
                              onClick={() => void installGeminiCli(sub)}
                            >
                              {sub.installRunning || session?.installRunning ? '正在安装 Gemini CLI…' : '一键安装 Gemini CLI'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary"
                              disabled={busyKey === 'gemini-auth'}
                              onClick={() => void launchGeminiAuth(sub)}
                            >
                              打开终端登录 Google 账号
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary"
                            disabled={Boolean(busyKey)}
                            onClick={() => void beginSubscriptionConnect(sub)}
                          >
                            重新检测连接
                          </button>
                          <button type="button" className="text-button" onClick={jumpToGeminiApi}>
                            改用 Gemini API Key
                          </button>
                        </div>
                        {(sub.installError || session?.installError) && (
                          <p className="planner-error">{sub.installError || session?.installError}</p>
                        )}
                      </div>
                    )}

                    {session?.status === 'error' && session.error && (
                      <p role="alert" className="planner-error">{session.error}</p>
                    )}

                    {notice && (
                      <p role="status" className={notice.ok ? 'planner-ai-ok' : 'planner-error'}>
                        {notice.text}
                      </p>
                    )}

                    <div className="neo-drawer-actions">
                      {!sub.connected ? (
                        sub.key !== 'gemini' && !isConnecting && (
                          <>
                            <button
                              type="button"
                              className="primary"
                              disabled={Boolean(busyKey)}
                              onClick={() => void beginSubscriptionConnect(sub)}
                            >
                              {busyKey === `connect:${sub.key}` ? '正在发起授权…' : `连接 ${sub.name} 订阅`}
                            </button>
                            {sub.key === 'chatgpt' && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={Boolean(busyKey)}
                                onClick={() => void beginSubscriptionConnect(sub, 'codex_device')}
                              >
                                设备码登录（免回调）
                              </button>
                            )}
                          </>
                        )
                      ) : (
                        <>
                          {!sub.active && (
                            <button
                              type="button"
                              className="primary"
                              disabled={Boolean(busyKey)}
                              onClick={() => void activateProvider(sub.id, sub.key)}
                            >
                              {busyKey === `use:${sub.id}` ? '切换中…' : '设为当前使用'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary"
                            disabled={Boolean(busyKey)}
                            onClick={() => void testSubscription(sub)}
                          >
                            {busyKey === `test:${sub.key}` ? '测速中…' : '测试连接与速度'}
                          </button>
                          {sub.key === 'claude' && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={Boolean(busyKey)}
                              onClick={() => void refreshQuota('sub:claude', true)}
                            >
                              刷新额度
                            </button>
                          )}
                          <a className="text-button" href={sub.manageUrl} target="_blank" rel="noopener noreferrer">
                            查看用量
                          </a>
                          {sub.key !== 'gemini' && !isConnecting && (
                            <button
                              type="button"
                              className="text-button"
                              disabled={Boolean(busyKey)}
                              onClick={() => void beginSubscriptionConnect(sub)}
                            >
                              重新授权
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-button neo-danger-link"
                            disabled={Boolean(busyKey)}
                            onClick={() => void disconnectSubscription(sub)}
                          >
                            断开连接
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}

          {/* 第 5 张卡片：API */}
          <article
            className={`neo-provider-card is-api-card${apiActiveProfile ? ' is-active is-connected' : ''}${apiSavedProfiles.length === 0 && !apiExpanded ? ' is-dimmed' : ''}${apiExpanded ? ' is-expanded' : ''}`}
          >
            <div className="neo-provider-row" onClick={() => setExpandedCard(apiExpanded ? '' : 'api')}>
              <div className="neo-provider-lead">
                <AiProviderIcon kind="api" size={40} />
                <div className="neo-provider-title-group">
                  <div className="neo-provider-name-line">
                    <strong>API</strong>
                    {apiActiveProfile ? (
                      <>
                        <code className="neo-model-pill">
                          {apiActiveProfile.label} · {apiActiveProfile.model}
                        </code>
                        <SpeedPill result={speedResults[apiActiveProfile.id]} />
                      </>
                    ) : apiSavedProfiles.length > 0 ? (
                      <span className="neo-status-text">已保存 {apiSavedProfiles.length} 个接口</span>
                    ) : (
                      <span className="neo-status-text is-muted">未配置</span>
                    )}
                  </div>
                  {apiActiveProfile && (
                    <div className="neo-quota-summary">
                      <small>支持 DeepSeek、Claude、OpenAI、Gemini、千问、智谱等自定义 API，支持实时拉取最新模型与思考档位调节</small>
                    </div>
                  )}
                </div>
              </div>
              <div className="neo-provider-side" onClick={(event) => event.stopPropagation()}>
                <div className="neo-provider-top-badge">
                  {apiActiveProfile && <CheckBadge />}
                </div>
                <div className="neo-provider-actions">
                  <button
                    type="button"
                    className="neo-icon-btn"
                    title="配置 API 服务商"
                    aria-label="编辑 API"
                    onClick={() => setExpandedCard(apiExpanded ? '' : 'api')}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="neo-icon-btn"
                    title={apiExpanded ? '收起 API 设置' : '展开 API 设置'}
                    aria-label="展开 API"
                    onClick={() => setExpandedCard(apiExpanded ? '' : 'api')}
                  >
                    <ChevronIcon open={apiExpanded} />
                  </button>
                </div>
              </div>
            </div>

            {apiExpanded && (
              <div className="neo-provider-drawer">
                {apiSavedProfiles.length > 0 && (
                  <div className="planner-ai-saved">
                    <h3>已保存的 API 配置</h3>
                    {apiSavedProfiles.map((item) => (
                      <div
                        key={item.id}
                        className={item.id === state?.provider ? 'planner-ai-saved-row active' : 'planner-ai-saved-row'}
                      >
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {item.model} · 思考:{THINKING_LABEL[item.thinking ?? 'low'] ?? item.thinking} · {SEARCH_TEXT[item.search]}
                            {item.vision === false ? ' · OCR识图兼容' : ''}
                          </small>
                        </span>
                        <div className="neo-saved-row-end">
                          <SpeedPill result={speedResults[item.id]} />
                          {item.id === state?.provider ? (
                            <em>使用中</em>
                          ) : (
                            <button
                              className="secondary"
                              type="button"
                              disabled={Boolean(busyKey)}
                              onClick={() => void activateProvider(item.id)}
                            >
                              切换使用
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="planner-ai-subtitle">
                  {apiSavedProfiles.length ? '添加或修改 API 配置' : '选择 API 服务商'}
                </h3>
                <div className="planner-ai-providers" role="radiogroup" aria-label="AI 服务商">
                  {(state?.providers ?? []).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={apiProvider === item.id}
                      className={apiProvider === item.id ? 'active' : ''}
                      onClick={() => chooseApiProvider(item.id)}
                    >
                      {item.label}
                      {apiSavedProfiles.some((saved) => saved.id === item.id) && (
                        <span className="planner-ai-saved-mark"> ✓</span>
                      )}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveApi();
                  }}
                >
                  <label>
                    API Key
                    <input
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      placeholder={apiKeyHint}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                  </label>
                  {apiOption?.keyUrl && (
                    <a
                      className="planner-ai-keylink"
                      href={apiOption.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      去 {apiOption.label} 获取 API Key
                    </a>
                  )}
                  <div className="neo-drawer-field">
                    <div className="neo-field-head">
                      <label htmlFor="api-model-input">模型（最新优先，可随时拉取）</label>
                      {(apiSavedCurrent || apiKey.trim()) && (
                        <button
                          type="button"
                          className="text-button neo-refresh-btn"
                          disabled={Boolean(busyKey)}
                          onClick={() =>
                            void refreshModelsFor(apiProvider, undefined, {
                              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                              ...(apiBaseUrl.trim() ? { baseUrl: apiBaseUrl.trim() } : {}),
                            })
                          }
                        >
                          {busyKey === `refresh:${apiProvider}` ? '同步中…' : '↻ 拉取最新模型'}
                        </button>
                      )}
                    </div>
                    {apiCatalog.length > 0 && (
                      <div className="neo-api-model-chips" role="list" aria-label="常用最新模型">
                        {apiCatalog.slice(0, 10).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={apiModel === preset.id ? 'neo-model-chip active' : 'neo-model-chip'}
                            onClick={() => setApiModel(preset.id)}
                            title={preset.vision ? `${preset.name}（支持看图）` : `${preset.name}（纯文本，识图自动OCR）`}
                          >
                            {preset.latest ? '★ ' : ''}
                            {preset.id}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      id="api-model-input"
                      value={apiModel}
                      placeholder={apiOption?.model || '填写模型名称'}
                      onChange={(event) => setApiModel(event.target.value)}
                    />
                    <div className="neo-model-caps">
                      <span className={apiModelVision ? 'neo-cap-pill is-ok' : 'neo-cap-pill is-ocr'}>
                        {apiModelVision ? '支持直接看图' : '纯文本 · 上传截图自动转本机 OCR / 借用多模态模型'}
                      </span>
                    </div>
                  </div>

                  <ThinkingLevelSelector
                    value={apiThinking}
                    levels={apiThinkingLevels}
                    disabled={Boolean(busyKey)}
                    onChange={setApiThinking}
                  />

                  <label>
                    接口地址{apiProvider === 'custom' ? '' : '（一般不用改）'}
                    <input
                      value={apiBaseUrl}
                      placeholder={apiOption?.baseUrl || 'https://…/v1'}
                      onChange={(event) => setApiBaseUrl(event.target.value)}
                    />
                  </label>
                  <small className="muted">
                    Key 仅保存在本机服务端（.env.local），页面不会读回已保存的 Key。订阅与 API 配置均可同时保留并随时切换。
                    {apiProvider === 'moonshot' || apiProvider === 'doubao' || apiProvider === 'custom'
                      ? ' 该服务商不提供可读取的联网结果，规划时会自动借用其他已配置服务商的联网检索。'
                      : apiProvider === 'deepseek' || apiProvider === 'zhipu'
                        ? ' 联网检索使用该服务商的搜索接口。'
                        : ' 联网检索使用该服务商的搜索，网页正文由本机读取。'}
                  </small>
                  {apiMessage && (
                    <p role="status" className={apiMessage.ok ? 'planner-ai-ok' : 'planner-error'}>
                      {apiMessage.text}
                    </p>
                  )}
                  <div className="dialog-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={Boolean(busyKey) || !state}
                      onClick={() => void testApi()}
                    >
                      {busyKey === 'api:test' ? '测速中…' : '测试连接与速度'}
                    </button>
                    <button className="primary" type="submit" disabled={Boolean(busyKey) || !state}>
                      {busyKey === 'api:save' ? '保存中…' : '保存并启用'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
