import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVELS,
  fetchRemoteModelIds,
  getProviderModelCatalog,
  normalizeThinkingLevel,
  pickDefaultModel,
  resolveEffectiveThinkingLevel,
  resolveModelMeta,
} from './ai-catalog.mjs';

import { getDataPath } from './runtime-paths.mjs';

const execFileAsync = promisify(execFile);

/** 订阅厂商定义：不写死模型名，默认模型与可选列表全部动态来自最新目录 + 官方接口实时拉取。 */
export const SUBSCRIPTION_SPECS = [
  {
    id: 'sub:chatgpt',
    key: 'chatgpt',
    name: 'ChatGPT',
    piProvider: 'openai',
    loginKind: 'oauth_browser',
    manageUrl: 'https://chatgpt.com/#settings/Usage',
    searchKind: 'citation',
    vision: true,
  },
  {
    id: 'sub:claude',
    key: 'claude',
    name: 'Claude',
    piProvider: 'anthropic',
    loginKind: 'oauth_browser',
    manageUrl: 'https://claude.ai/settings/usage',
    searchKind: 'none',
    vision: true,
  },
  {
    id: 'sub:kimi',
    key: 'kimi',
    name: 'Kimi Code',
    piProvider: 'kimi-coding',
    loginKind: 'device_code',
    manageUrl: 'https://www.kimi.com/code',
    searchKind: 'none',
    vision: true,
  },
  {
    id: 'sub:gemini',
    key: 'gemini',
    name: 'Gemini',
    piProvider: 'google',
    loginKind: 'gemini_cli',
    manageUrl: 'https://gemini.google.com/',
    searchKind: 'none',
    vision: false,
  },
];

export const SUBSCRIPTION_BY_ID = Object.fromEntries(SUBSCRIPTION_SPECS.map((spec) => [spec.id, spec]));
export const SUBSCRIPTION_BY_KEY = Object.fromEntries(SUBSCRIPTION_SPECS.map((spec) => [spec.key, spec]));

export function isSubscriptionProvider(id) {
  return Boolean(SUBSCRIPTION_BY_ID[id]);
}

class SubscriptionAiError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

function emptyStoreData() {
  return {
    deviceId: randomUUID(),
    credentials: {},
    models: {},
    thinking: {},
    discoveredModels: {},
    geminiConnected: false,
  };
}

/** 原子写入的本地凭据与动态模型缓存存储，满足 @earendil-works/pi-ai CredentialStore 契约并按 provider 串行锁。 */
function createFileStore(filePath) {
  let writeQueue = Promise.resolve();
  const providerQueues = new Map();
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = {
        deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : randomUUID(),
        credentials: parsed.credentials && typeof parsed.credentials === 'object' ? parsed.credentials : {},
        models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {},
        thinking: parsed.thinking && typeof parsed.thinking === 'object' ? parsed.thinking : {},
        discoveredModels: parsed.discoveredModels && typeof parsed.discoveredModels === 'object' ? parsed.discoveredModels : {},
        geminiConnected: Boolean(parsed.geminiConnected),
      };
    } catch {
      cache = emptyStoreData();
    }
    return cache;
  }

  function persist(data) {
    const task = writeQueue.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, filePath);
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  function serialize(providerId, fn) {
    const previous = providerQueues.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    providerQueues.set(providerId, tail);
    void tail.finally(() => {
      if (providerQueues.get(providerId) === tail) providerQueues.delete(providerId);
    });
    return next;
  }

  const credentialStore = {
    async read(providerId) {
      const data = await load();
      const entry = data.credentials[providerId];
      return entry ? structuredClone(entry) : undefined;
    },
    async list() {
      const data = await load();
      return Object.entries(data.credentials)
        .filter(([, value]) => value && typeof value.type === 'string')
        .map(([providerId, value]) => ({ providerId, type: value.type }));
    },
    modify(providerId, fn) {
      return serialize(providerId, async () => {
        const data = await load();
        const current = data.credentials[providerId] ? structuredClone(data.credentials[providerId]) : undefined;
        const updated = await fn(current);
        if (updated !== undefined) {
          data.credentials[providerId] = structuredClone(updated);
          await persist(data);
        }
        return data.credentials[providerId] ? structuredClone(data.credentials[providerId]) : undefined;
      });
    },
    delete(providerId) {
      return serialize(providerId, async () => {
        const data = await load();
        if (providerId in data.credentials) {
          delete data.credentials[providerId];
          await persist(data);
        }
      });
    },
  };

  return {
    credentialStore,
    async init() {
      return load();
    },
    getDeviceIdSync() {
      if (!cache) cache = emptyStoreData();
      return cache.deviceId;
    },
    async ensureDeviceId() {
      const data = await load();
      if (!data.deviceId) {
        data.deviceId = randomUUID();
        await persist(data);
      }
      return data.deviceId;
    },
    async getModel(key, fallback) {
      const data = await load();
      return data.models[key] || fallback;
    },
    async setModel(key, model) {
      return serialize(`__model__${key}`, async () => {
        const data = await load();
        data.models[key] = model;
        await persist(data);
      });
    },
    async getThinking(key) {
      const data = await load();
      const stored = data.thinking[key];
      return normalizeThinkingLevel(stored);
    },
    async setThinking(key, level) {
      return serialize(`__thinking__${key}`, async () => {
        const data = await load();
        data.thinking[key] = level;
        await persist(data);
      });
    },
    async getDiscovered(providerId) {
      const data = await load();
      const entry = data.discoveredModels[providerId];
      return entry && Array.isArray(entry.ids) ? entry : { ids: [], fetchedAt: 0 };
    },
    async getAllDiscoveredIds() {
      const data = await load();
      const map = {};
      for (const [id, entry] of Object.entries(data.discoveredModels)) {
        if (entry && Array.isArray(entry.ids)) map[id] = entry.ids;
      }
      return map;
    },
    async setDiscovered(providerId, ids) {
      return serialize(`__discovered__${providerId}`, async () => {
        const data = await load();
        data.discoveredModels[providerId] = { ids: [...new Set(ids)], fetchedAt: Date.now() };
        await persist(data);
      });
    },
    async getGeminiConnected() {
      const data = await load();
      return Boolean(data.geminiConnected);
    },
    async setGeminiConnected(connected) {
      return serialize('__gemini__', async () => {
        const data = await load();
        data.geminiConnected = Boolean(connected);
        await persist(data);
      });
    },
  };
}

/** 探测本机官方 Gemini CLI 安装与 Google 账号登录态（只读是否存在与邮箱展示，不读取或回传令牌）。 */
async function probeGeminiCli() {
  const candidates = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'npm', 'gemini.cmd'));
      candidates.push(path.join(process.env.APPDATA, 'npm', 'gemini.ps1'));
    }
    try {
      const { stdout } = await execFileAsync('where.exe', ['gemini'], { timeout: 4000, windowsHide: true });
      for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) candidates.unshift(line);
    } catch {
      // not on PATH
    }
  } else {
    try {
      const { stdout } = await execFileAsync('which', ['gemini'], { timeout: 4000 });
      const found = stdout.trim().split('\n')[0];
      if (found) candidates.push(found);
    } catch {
      // not on PATH
    }
  }

  let binary = '';
  for (const candidate of candidates) {
    try {
      await access(candidate);
      binary = candidate;
      break;
    } catch {
      // try next
    }
  }

  const geminiDir = path.join(os.homedir(), '.gemini');
  let loggedIn = false;
  let accountEmail = '';
  try {
    const accountsRaw = await readFile(path.join(geminiDir, 'google_accounts.json'), 'utf8');
    const parsed = JSON.parse(accountsRaw);
    if (typeof parsed?.active === 'string' && parsed.active.trim()) {
      accountEmail = parsed.active.trim();
      loggedIn = true;
    }
  } catch {
    // ignore
  }
  if (!loggedIn) {
    try {
      const raw = await readFile(path.join(geminiDir, 'oauth_creds.json'), 'utf8');
      const parsed = JSON.parse(raw);
      loggedIn = Boolean(parsed && (parsed.access_token || parsed.refresh_token));
    } catch {
      // ignore
    }
  }

  return { installed: Boolean(binary), binary, loggedIn, accountEmail };
}

function formatAuthError(spec, error) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/cancelled|aborted/i.test(raw)) return '已取消授权登录';
  if (/EADDRINUSE|Port \d+ is in use/i.test(raw)) {
    return `${spec.name} 本地回调端口被占用，请关闭其他正在登录的终端或应用后重试`;
  }
  if (/expired/i.test(raw)) return `${spec.name} 授权已过期，请重新发起连接`;
  if (/access_denied|denied/i.test(raw)) return `已拒绝 ${spec.name} 授权请求`;
  if (/state mismatch/i.test(raw)) return '授权回调校验失败，请重新发起连接';
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network/i.test(raw)) {
    return `无法连接到 ${spec.name} 授权服务，请检查网络或代理设置`;
  }
  return `${spec.name} 连接失败：${raw.slice(0, 180) || '请稍后重试'}`;
}

function formatChatError(spec, rawMessage) {
  const text = String(rawMessage ?? '').trim();
  const snippet = text.replace(/\s+/g, ' ').slice(0, 180);
  if (/401|403|unauthorized|invalid_grant|token refresh|not configured|re-login|reconnect/i.test(text)) {
    return `${spec.name} 订阅授权已失效，请在“配置 AI”中重新连接`;
  }
  if (/404|model.*not found|does not exist/i.test(text)) {
    return `${spec.name} 当前账号暂不支持所选模型，请换一个模型再试`;
  }
  if (/429|rate.?limit|quota|usage.?limit|insufficient|credit/i.test(text)) {
    return `${spec.name} 订阅请求过于频繁或额度不足，请稍后重试`;
  }
  if (/TimeoutError|timed?\s*out|aborted due to timeout|ETIMEDOUT/i.test(text)) {
    return `${spec.name} 思考响应超时（可切回「轻度（推荐）」或稍后重试）${snippet ? `：${snippet}` : ''}`;
  }
  if (/websocket|ws\s+closed|socket\s+closed/i.test(text)) {
    return `${spec.name} 实时连接中途断开（长思考时代理可能中断长连接，请重试或切回「轻度（推荐）」）${snippet ? `：${snippet}` : ''}`;
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|ECONNREFUSED|network/i.test(text)) {
    return `无法连接 ${spec.name} 服务，请检查网络或代理后重试${snippet ? `（${snippet}）` : ''}`;
  }
  return `${spec.name} 调用失败：${snippet || '请稍后重试'}`;
}

/**
 * 创建订阅管理器：统一管理 ChatGPT / Claude / Kimi Code / Gemini 订阅连接、
 * 动态最新模型发现、思考档位调节、额度读取与高速对话执行。
 */
export async function createSubscriptionManager(options = {}) {
  const authFile = options.authFile ?? getDataPath('.ai-auth.json');
  const fetchImpl = options.fetchImpl ?? fetch;
  const geminiProbe = options.probeGeminiCli ?? probeGeminiCli;
  const store = createFileStore(authFile);
  await store.init();

  const models = createModels({
    credentials: store.credentialStore,
  });
  models.setProvider(openaiProvider());
  models.setProvider(openaiCodexProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(kimiCodingProvider());
  models.setProvider(googleProvider());

  const loginSessions = new Map();
  const quotaCache = new Map();
  let geminiInstallState = { running: false, output: '', error: '' };

  function resolveSpec(idOrKey) {
    return SUBSCRIPTION_BY_ID[idOrKey] ?? SUBSCRIPTION_BY_KEY[idOrKey] ?? null;
  }

  /** ChatGPT 订阅支持 openai-codex（Plus/Pro 标准 OAuth & 设备码，默认）与 openai（Sign in with ChatGPT）。 */
  async function resolveActivePiProvider(spec) {
    if (spec.key !== 'chatgpt') return spec.piProvider;
    const codexCred = await store.credentialStore.read('openai-codex');
    if (codexCred?.type === 'oauth' && codexCred.access) return 'openai-codex';
    const siwcCred = await store.credentialStore.read('openai');
    if (siwcCred?.type === 'oauth' && siwcCred.access) return 'openai';
    return 'openai-codex';
  }

  async function listCatalogForSpec(spec) {
    const discovered = await store.getDiscovered(spec.id);
    return {
      models: getProviderModelCatalog(spec.id, discovered.ids),
      defaultModel: pickDefaultModel(spec.id, discovered.ids),
      modelsUpdatedAt: discovered.fetchedAt || 0,
    };
  }

  async function isConnected(spec) {
    if (spec.key === 'gemini') {
      const enabled = await store.getGeminiConnected();
      if (!enabled) return false;
      const probe = await geminiProbe();
      return probe.installed && probe.loggedIn;
    }
    const activePi = await resolveActivePiProvider(spec);
    const cred = await store.credentialStore.read(activePi);
    return cred?.type === 'oauth' && Boolean(cred.access);
  }

  function defaultQuota(spec, extra = {}) {
    if (spec.key === 'chatgpt') {
      return {
        status: 'unavailable',
        title: '本应用额度',
        note: 'OpenAI 暂未提供本应用剩余额度的查询接口，请在 ChatGPT 用量设置中查看',
        manageUrl: spec.manageUrl,
      };
    }
    if (spec.key === 'claude') {
      return {
        status: 'unavailable',
        title: '7 天额度',
        note: '点击刷新查看 Claude 周额度，或在 Claude 用量设置中查看',
        manageUrl: spec.manageUrl,
      };
    }
    if (spec.key === 'kimi') {
      return {
        status: 'info',
        title: '订阅状态',
        note: '已连接 Kimi Code 订阅，可在 Kimi 控制台查看用量',
        manageUrl: spec.manageUrl,
      };
    }
    return {
      status: 'info',
      title: 'Google 账号订阅',
      note: extra.accountEmail
        ? `已通过本机 Gemini CLI 登录 ${extra.accountEmail}`
        : '通过本机 Gemini CLI 使用 Google 账号 / AI Pro 订阅额度',
      manageUrl: spec.manageUrl,
    };
  }

  async function fetchQuota(idOrKey, { force = false } = {}) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    if (!(await isConnected(spec))) {
      return { status: 'disconnected', title: '', note: '未连接', manageUrl: spec.manageUrl };
    }
    if (spec.key === 'gemini') {
      const probe = await geminiProbe();
      return defaultQuota(spec, { accountEmail: probe.accountEmail });
    }
    if (spec.key !== 'claude') return defaultQuota(spec);

    const cached = quotaCache.get('claude');
    if (!force && cached && Date.now() - cached.fetchedAt < 60_000) return cached.value;

    try {
      const resolved = await models.getAuth('anthropic');
      const token = resolved?.auth?.apiKey;
      if (!token) return defaultQuota(spec);
      const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const value = {
          status: 'unavailable',
          title: '7 天额度',
          note: '暂无法获取 Claude 剩余额度，请在 Claude 用量设置中查看',
          manageUrl: spec.manageUrl,
        };
        quotaCache.set('claude', { fetchedAt: Date.now(), value });
        return value;
      }
      const data = await response.json();
      const sevenDay = data?.seven_day;
      const fiveHour = data?.five_hour;
      if (typeof sevenDay?.utilization === 'number') {
        const remaining = Math.max(0, Math.min(100, Math.round(100 - sevenDay.utilization)));
        const fiveHourRemaining =
          typeof fiveHour?.utilization === 'number'
            ? Math.max(0, Math.min(100, Math.round(100 - fiveHour.utilization)))
            : undefined;
        const value = {
          status: 'ok',
          title: '7 天剩余额度',
          remainingPercent: remaining,
          resetsAt: typeof sevenDay.resets_at === 'string' ? sevenDay.resets_at : undefined,
          fiveHourRemainingPercent: fiveHourRemaining,
          fiveHourResetsAt: typeof fiveHour?.resets_at === 'string' ? fiveHour.resets_at : undefined,
          manageUrl: spec.manageUrl,
        };
        quotaCache.set('claude', { fetchedAt: Date.now(), value });
        return value;
      }
    } catch {
      // fall through
    }
    const fallback = {
      status: 'unavailable',
      title: '7 天额度',
      note: '暂无法获取 Claude 剩余额度，请在 Claude 用量设置中查看',
      manageUrl: spec.manageUrl,
    };
    quotaCache.set('claude', { fetchedAt: Date.now(), value: fallback });
    return fallback;
  }

  /** 向远端官方接口实时拉取最新模型列表并缓存到本地，随厂商发布自动更新。 */
  async function refreshRemoteModels(providerId, { token = '', baseUrl = '', isOAuth = false, signal } = {}) {
    let resolvedToken = token;
    let oauthFlag = isOAuth;
    const spec = resolveSpec(providerId);
    if (spec) {
      if (spec.key === 'gemini') {
        // Gemini CLI 无直接列出模型 API，沿用随 pi-ai 更新的最新 Gemini 目录
        const discovered = await store.getDiscovered(spec.id);
        return { count: 0, models: getProviderModelCatalog(spec.id, discovered.ids) };
      }
      if (!resolvedToken) {
        resolvedToken = await getAccessToken(spec.key);
        oauthFlag = true;
      }
    }
    const ids = await fetchRemoteModelIds({
      providerId: spec ? spec.id : providerId,
      baseUrl,
      token: resolvedToken,
      isOAuth: oauthFlag,
      fetchImpl,
      signal,
    });
    const key = spec ? spec.id : providerId;
    if (ids.length > 0) {
      await store.setDiscovered(key, ids);
    }
    const finalDiscovered = await store.getDiscovered(key);
    return {
      count: ids.length,
      models: getProviderModelCatalog(key, finalDiscovered.ids),
    };
  }

  function publicSession(session) {
    if (!session) return null;
    return {
      id: session.id,
      provider: session.providerId,
      key: session.key,
      status: session.status,
      authUrl: session.authUrl || '',
      verificationUri: session.verificationUri || '',
      userCode: session.userCode || '',
      instructions: session.instructions || '',
      progress: session.progress || '',
      canPasteCode: Boolean(session.canPasteCode),
      error: session.error || '',
      cliInstalled: session.cliInstalled,
      cliLoggedIn: session.cliLoggedIn,
      accountEmail: session.accountEmail || '',
    };
  }

  async function cancelLogin(idOrKey) {
    const spec = resolveSpec(idOrKey);
    if (!spec) return;
    const existing = loginSessions.get(spec.key);
    if (!existing) return;
    existing.status = 'cancelled';
    if (existing.timeoutTimer) {
      clearTimeout(existing.timeoutTimer);
      existing.timeoutTimer = null;
    }
    existing.controller?.abort();
    existing.rejectManual?.(new Error('Login cancelled'));
    loginSessions.delete(spec.key);
    // 等待旧 OAuth 回调端口（如 1455 / 53692）真正 close 完成，避免紧接着重启登录时撞 EADDRINUSE。
    if (existing.donePromise) {
      await Promise.race([existing.donePromise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  async function startLogin(idOrKey, { onConnected, force = true, method = '' } = {}) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');

    // 若明确要求复用（force=false）且同服务商已有等待中的授权会话，直接复用。
    const existing = loginSessions.get(spec.key);
    if (!force && existing && ['pending', 'awaiting_auth', 'awaiting_device', 'exchanging'].includes(existing.status)) {
      return publicSession(existing);
    }
    await cancelLogin(spec.key);

    if (spec.key === 'gemini') {
      const probe = await geminiProbe();
      if (probe.installed && probe.loggedIn) {
        await store.setGeminiConnected(true);
        await onConnected?.(spec.id);
        return {
          id: randomUUID(),
          provider: spec.id,
          key: spec.key,
          status: 'connected',
          cliInstalled: true,
          cliLoggedIn: true,
          accountEmail: probe.accountEmail,
        };
      }
      return {
        id: randomUUID(),
        provider: spec.id,
        key: spec.key,
        status: probe.installed ? 'gemini_needs_auth' : 'gemini_needs_install',
        cliInstalled: probe.installed,
        cliLoggedIn: probe.loggedIn,
        accountEmail: probe.accountEmail,
        instructions: probe.installed
          ? '本机已安装 Gemini CLI，请在终端完成 Google 账号登录后点击“检测连接”。'
          : '连接 Gemini 订阅需要本机官方 Gemini CLI（@google/gemini-cli），可一键安装或改用 Gemini API Key。',
      };
    }

    // ChatGPT 默认走最稳定的 openai-codex（支持浏览器 OAuth 与免回调设备码），也支持显式选 siwc。
    const chatgptMethod =
      spec.key === 'chatgpt'
        ? (['codex_browser', 'codex_device', 'siwc'].includes(method) ? method : 'codex_browser')
        : '';
    const targetPiProvider =
      spec.key === 'chatgpt'
        ? (chatgptMethod === 'siwc' ? 'openai' : 'openai-codex')
        : spec.piProvider;

    await store.ensureDeviceId();
    const controller = new AbortController();
    const session = {
      id: randomUUID(),
      providerId: spec.id,
      key: spec.key,
      method: chatgptMethod || 'default',
      status: 'pending',
      authUrl: '',
      verificationUri: '',
      userCode: '',
      instructions: '',
      progress: '正在准备授权链接…',
      canPasteCode: false,
      error: '',
      controller,
      resolveManual: null,
      rejectManual: null,
      donePromise: null,
      timeoutTimer: null,
    };
    // 5 分钟无人完成授权自动超时释放回调端口，避免端口被挂起占用。
    session.timeoutTimer = setTimeout(() => {
      if (loginSessions.get(spec.key) === session && !['connected', 'error', 'cancelled'].includes(session.status)) {
        session.status = 'error';
        session.error = `${spec.name} 授权超时，已释放本地端口，请重新点击连接`;
        controller.abort();
        session.rejectManual?.(new Error('Login timed out'));
        loginSessions.delete(spec.key);
      }
    }, 5 * 60 * 1000);
    loginSessions.set(spec.key, session);

    let settleReady;
    const readyPromise = new Promise((resolve) => {
      let settled = false;
      settleReady = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
    });

    const interaction = {
      signal: controller.signal,
      notify(event) {
        if (event.type === 'auth_url') {
          session.authUrl = event.url;
          session.instructions =
            spec.key === 'chatgpt'
              ? '请在打开的浏览器中登录 ChatGPT 完成授权；应用会自动接收本地回调。如浏览器提示异常，可点下方“改用设备码登录”。'
              : '请在打开的浏览器中登录 Claude 完成授权；应用会自动接收本地回调。';
          session.status = 'awaiting_auth';
          session.progress = '等待浏览器完成授权…';
          settleReady();
        } else if (event.type === 'device_code') {
          session.verificationUri = event.verificationUri;
          session.userCode = event.userCode;
          session.instructions =
            spec.key === 'chatgpt'
              ? '请打开下方 OpenAI 设备验证页并输入验证码（不占用本地回调端口，最稳定）。'
              : '请在浏览器中确认下方设备验证码以连接 Kimi Code 订阅。';
          session.status = 'awaiting_device';
          session.progress = `等待在 ${spec.name} 页面确认设备验证码…`;
          settleReady();
        } else if (event.type === 'progress') {
          session.status = 'exchanging';
          session.progress = '正在换取访问凭据并保存…';
        }
      },
      prompt(promptRequest) {
        if (promptRequest.type === 'select') {
          if (chatgptMethod === 'codex_device') {
            const devOption = promptRequest.options.find((opt) => opt.id === 'device_code');
            return Promise.resolve(devOption?.id ?? 'device_code');
          }
          const browserOption = promptRequest.options.find((opt) => opt.id === 'browser');
          return Promise.resolve(browserOption?.id ?? promptRequest.options[0]?.id ?? 'browser');
        }
        if (promptRequest.type === 'manual_code') {
          session.canPasteCode = true;
          return new Promise((resolve, reject) => {
            session.resolveManual = resolve;
            session.rejectManual = reject;
            const onAbort = () => {
              session.canPasteCode = false;
              session.resolveManual = null;
              session.rejectManual = null;
              reject(new Error('Manual input aborted'));
            };
            if (promptRequest.signal?.aborted) {
              onAbort();
              return;
            }
            promptRequest.signal?.addEventListener('abort', onAbort, { once: true });
          });
        }
        return Promise.reject(new Error(`不支持的交互步骤：${promptRequest.type}`));
      },
    };

    const loginPromise = models
      .login(targetPiProvider, 'oauth', interaction, {
        getDeviceId: () => store.getDeviceIdSync(),
        agentName: 'Zhouyou',
      })
      .then(async () => {
        if (session.timeoutTimer) {
          clearTimeout(session.timeoutTimer);
          session.timeoutTimer = null;
        }
        if (loginSessions.get(spec.key) !== session) return;
        // 清理 ChatGPT 另一种旧通道凭据，确保只有一个有效通道。
        if (spec.key === 'chatgpt') {
          const other = targetPiProvider === 'openai-codex' ? 'openai' : 'openai-codex';
          await store.credentialStore.delete(other).catch(() => {});
        }
        session.status = 'connected';
        session.canPasteCode = false;
        session.progress = `已成功连接 ${spec.name}`;
        quotaCache.delete(spec.key);
        if (targetPiProvider !== 'openai-codex') {
          void refreshRemoteModels(spec.id).catch(() => {});
        }
        await onConnected?.(spec.id);
        settleReady();
      })
      .catch((error) => {
        if (session.timeoutTimer) {
          clearTimeout(session.timeoutTimer);
          session.timeoutTimer = null;
        }
        if (loginSessions.get(spec.key) !== session) return;
        if (session.status === 'cancelled' || controller.signal.aborted) {
          if (session.status !== 'error') session.status = 'cancelled';
        } else {
          session.status = 'error';
          session.error = formatAuthError(spec, error);
        }
        session.canPasteCode = false;
        settleReady();
      });
    session.donePromise = loginPromise;

    await Promise.race([
      readyPromise,
      loginPromise,
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);

    return publicSession(session);
  }

  function submitManualCode(idOrKey, code) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    const session = loginSessions.get(spec.key);
    if (!session || !session.resolveManual) {
      throw new Error('当前没有等待中的授权会话，请重新发起连接');
    }
    const trimmed = String(code ?? '').trim();
    if (!trimmed) throw new Error('请粘贴完整的回调地址或授权码');
    const resolve = session.resolveManual;
    session.resolveManual = null;
    session.rejectManual = null;
    session.canPasteCode = false;
    session.status = 'exchanging';
    session.progress = '正在校验授权码…';
    resolve(trimmed);
    return publicSession(session);
  }

  async function getLoginStatus(idOrKey, { onConnected } = {}) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    if (spec.key === 'gemini') {
      const probe = await geminiProbe();
      if (probe.installed && probe.loggedIn) {
        const already = await store.getGeminiConnected();
        if (!already) {
          await store.setGeminiConnected(true);
          await onConnected?.(spec.id);
        }
        return {
          provider: spec.id,
          key: spec.key,
          status: 'connected',
          cliInstalled: true,
          cliLoggedIn: true,
          accountEmail: probe.accountEmail,
          installRunning: geminiInstallState.running,
          installError: geminiInstallState.error,
        };
      }
      return {
        provider: spec.id,
        key: spec.key,
        status: probe.installed ? 'gemini_needs_auth' : 'gemini_needs_install',
        cliInstalled: probe.installed,
        cliLoggedIn: probe.loggedIn,
        accountEmail: probe.accountEmail,
        installRunning: geminiInstallState.running,
        installError: geminiInstallState.error,
      };
    }
    const session = loginSessions.get(spec.key);
    if (session) return publicSession(session);
    const connected = await isConnected(spec);
    return {
      provider: spec.id,
      key: spec.key,
      status: connected ? 'connected' : 'idle',
    };
  }

  async function launchGeminiAuthTerminal() {
    const probe = await geminiProbe();
    if (!probe.installed) {
      throw new Error('尚未检测到本机 Gemini CLI，请先安装 @google/gemini-cli');
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', 'gemini'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('osascript', ['-e', 'tell application "Terminal" to do script "gemini"'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else {
      throw new Error('请在本机终端运行 `gemini` 完成 Google 账号登录后再点击检测');
    }
    return { launched: true };
  }

  async function installGeminiCli() {
    if (geminiInstallState.running) return { running: true };
    geminiInstallState = { running: true, output: '', error: '' };
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmBin, ['install', '-g', '@google/gemini-cli'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      geminiInstallState = { running: false, output: '', error: error.message };
    });
    child.on('close', (code) => {
      geminiInstallState = {
        running: false,
        output: code === 0 ? 'installed' : '',
        error: code === 0 ? '' : stderr.trim().slice(-240) || `安装退出码 ${code}`,
      };
    });
    return { running: true };
  }

  async function logout(idOrKey) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    await cancelLogin(spec.key);
    quotaCache.delete(spec.key);
    if (spec.key === 'gemini') {
      await store.setGeminiConnected(false);
    } else if (spec.key === 'chatgpt') {
      await models.logout('openai-codex');
      await models.logout('openai');
    } else {
      await models.logout(spec.piProvider);
    }
  }

  async function setModel(idOrKey, modelId) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    const trimmed = String(modelId ?? '').trim();
    if (!trimmed || !/^[\w.:/@-]{1,120}$/.test(trimmed)) {
      throw new Error('模型名称格式无效');
    }
    await store.setModel(spec.key, trimmed);
    return trimmed;
  }

  async function setThinking(idOrKey, level) {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    const raw = String(level ?? '').trim();
    if (!THINKING_LEVELS.includes(raw) && raw !== 'xhigh' && raw !== 'max') {
      throw new Error('思考档位无效');
    }
    const normalized = normalizeThinkingLevel(raw);
    await store.setThinking(spec.key, normalized);
    return normalized;
  }

  async function getSelectedModel(idOrKey) {
    const spec = resolveSpec(idOrKey);
    if (!spec) return '';
    const { defaultModel } = await listCatalogForSpec(spec);
    return store.getModel(spec.key, defaultModel);
  }

  async function getSelectedThinking(idOrKey) {
    const spec = resolveSpec(idOrKey);
    if (!spec) return DEFAULT_THINKING_LEVEL;
    return store.getThinking(spec.key);
  }

  async function getAccessToken(idOrKey) {
    const spec = resolveSpec(idOrKey);
    if (!spec || spec.key === 'gemini') return '';
    try {
      const activePi = await resolveActivePiProvider(spec);
      const resolved = await models.getAuth(activePi);
      return resolved?.auth?.apiKey ?? '';
    } catch {
      return '';
    }
  }

  async function isChatGptDirectApi() {
    const cred = await store.credentialStore.read('openai');
    return cred?.type === 'oauth' && Boolean(cred.access);
  }

  async function getAllDiscoveredModels() {
    return store.getAllDiscoveredIds();
  }

  async function listSubscriptions(activeProviderId) {
    const probe = await geminiProbe();
    const list = [];
    for (const spec of SUBSCRIPTION_SPECS) {
      const connected =
        spec.key === 'gemini'
          ? (await store.getGeminiConnected()) && probe.installed && probe.loggedIn
          : await isConnected(spec);
      const { models: catalog, defaultModel, modelsUpdatedAt } = await listCatalogForSpec(spec);
      const model = await store.getModel(spec.key, defaultModel);
      const thinking = await store.getThinking(spec.key);
      const meta = resolveModelMeta(spec.id, model, catalog.filter((m) => m.remote).map((m) => m.id));
      const effectiveThinking = resolveEffectiveThinkingLevel(spec.id, model, thinking);
      const cachedQuota = spec.key === 'claude' ? quotaCache.get('claude')?.value : undefined;
      const quota = connected
        ? cachedQuota ?? defaultQuota(spec, { accountEmail: probe.accountEmail })
        : null;
      const activeSession = loginSessions.get(spec.key);
      const pendingSession =
        activeSession && ['pending', 'awaiting_auth', 'awaiting_device', 'exchanging'].includes(activeSession.status)
          ? publicSession(activeSession)
          : null;
      list.push({
        id: spec.id,
        key: spec.key,
        name: spec.name,
        loginKind: spec.loginKind,
        connected,
        active: activeProviderId === spec.id,
        model,
        defaultModel,
        thinking: effectiveThinking,
        thinkingLevels: meta.thinkingLevels,
        vision: meta.vision,
        models: catalog,
        modelsUpdatedAt,
        manageUrl: spec.manageUrl,
        search: spec.searchKind,
        quota,
        pendingSession,
        ...(spec.key === 'gemini'
          ? {
              cliInstalled: probe.installed,
              cliLoggedIn: probe.loggedIn,
              accountEmail: probe.accountEmail,
              installRunning: geminiInstallState.running,
              installError: geminiInstallState.error,
            }
          : {}),
      });
    }
    return list;
  }

  function toPiMessages(messages, targetModel) {
    const now = Date.now();
    return messages.map((msg, index) => {
      if (msg.role === 'assistant') {
        const text =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('')
              : '';
        return {
          role: 'assistant',
          content: [{ type: 'text', text }],
          api: targetModel.api,
          provider: targetModel.provider,
          model: targetModel.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: now + index,
        };
      }
      if (!Array.isArray(msg.content)) {
        return { role: 'user', content: String(msg.content ?? ''), timestamp: now + index };
      }
      return {
        role: 'user',
        content: msg.content.map((part) =>
          part.type === 'image'
            ? { type: 'image', mimeType: part.mimeType, data: part.data }
            : { type: 'text', text: String(part.text ?? '') },
        ),
        timestamp: now + index,
      };
    });
  }

  async function runGeminiCli({ modelId, system, messages, signal, timeout }) {
    const probe = await geminiProbe();
    if (!probe.installed || !probe.loggedIn) {
      throw new SubscriptionAiError('Gemini CLI 尚未安装或未登录 Google 账号，请在“配置 AI”中连接');
    }
    const transcript = [];
    if (system) transcript.push(`[系统指令]\n${system}`);
    for (const msg of messages) {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
            : '';
      transcript.push(`${msg.role === 'assistant' ? '[助手]' : '[用户]'}\n${text}`);
    }
    const combinedPrompt = transcript.join('\n\n');
    const args = ['-m', modelId, '--output-format', 'json'];

    return new Promise((resolve, reject) => {
      const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(probe.binary);
      const isPs1 = process.platform === 'win32' && /\.ps1$/i.test(probe.binary);
      let child;
      if (isCmd) {
        child = spawn('cmd.exe', ['/d', '/s', '/c', probe.binary, ...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } else if (isPs1) {
        child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe.binary, ...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } else {
        child = spawn(probe.binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      }

      let stdout = '';
      let stderr = '';
      let finished = false;
      const done = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn(value);
      };
      const onAbort = () => {
        try { child.kill(); } catch { /* ignore */ }
        done(reject, signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        done(reject, new SubscriptionAiError('Gemini CLI 响应超时，请稍后重试', { retryable: true }));
      }, timeout);
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => {
        done(reject, new SubscriptionAiError(`无法启动 Gemini CLI：${error.message}`));
      });
      child.on('close', (code) => {
        if (code !== 0) {
          done(
            reject,
            new SubscriptionAiError(formatChatError(SUBSCRIPTION_BY_KEY.gemini, stderr || stdout || `退出码 ${code}`), {
              retryable: /429|timeout|network/i.test(stderr),
            }),
          );
          return;
        }
        const trimmed = stdout.trim();
        try {
          const jsonStart = trimmed.indexOf('{');
          const parsed = JSON.parse(jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed);
          if (typeof parsed?.response === 'string') {
            done(resolve, { text: parsed.response, truncated: false });
            return;
          }
        } catch {
          // fall back to plain text output
        }
        done(resolve, { text: trimmed, truncated: false });
      });

      child.stdin?.end(combinedPrompt, 'utf8');
    });
  }

  async function createClient(idOrKey, overrideModel = '', overrideThinking = '') {
    const spec = resolveSpec(idOrKey);
    if (!spec) throw new Error('不支持的订阅服务商');
    const connected = await isConnected(spec);
    const { defaultModel } = await listCatalogForSpec(spec);
    const modelId = overrideModel || (await store.getModel(spec.key, defaultModel));
    const configuredThinking = overrideThinking || (await store.getThinking(spec.key));
    const discovered = await store.getDiscovered(spec.id);
    const meta = resolveModelMeta(spec.id, modelId, discovered.ids);
    const effectiveDefaultThinking = resolveEffectiveThinkingLevel(spec.id, modelId, configuredThinking);
    const label = `${spec.name} · ${modelId}`;

    let piModel = null;
    if (spec.key !== 'gemini') {
      const activePi = await resolveActivePiProvider(spec);
      piModel = models.getModel(activePi, modelId);
      if (!piModel) {
        const fallbackModel = models.getModel(activePi, defaultModel) ?? models.getModels(activePi)[0];
        if (fallbackModel) {
          piModel = {
            ...fallbackModel,
            id: modelId,
            name: modelId,
            input: meta.vision ? ['text', 'image'] : ['text'],
          };
        }
      }
    }

    return {
      provider: spec.id,
      model: modelId,
      baseUrl: piModel?.baseUrl ?? '',
      label,
      configured: connected,
      vision: meta.vision,
      thinking: effectiveDefaultThinking,
      thinkingLevels: meta.thinkingLevels,
      authMode: 'subscription',
      async chat({ system = '', messages, maxTokens, signal, timeout = 180000, fast = false, thinking }) {
        if (!connected) {
          throw new SubscriptionAiError(`尚未连接 ${spec.name} 订阅，请点“配置 AI”完成授权`);
        }
        const reasoningLevel = resolveEffectiveThinkingLevel(spec.id, modelId, thinking || configuredThinking, { fast });
        if (spec.key === 'gemini') {
          const out = await runGeminiCli({ modelId, system, messages, signal, timeout });
          return { ...out, thinkingUsed: reasoningLevel };
        }
        if (!piModel) {
          throw new SubscriptionAiError(`${spec.name} 模型配置无效，请在“配置 AI”中重新选择模型`);
        }
        const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean));
        const context = {
          systemPrompt: system || undefined,
          messages: toPiMessages(messages, piModel),
        };
        let result;
        try {
          result = await models.completeSimple(piModel, context, {
            maxTokens: Math.min(maxTokens ?? piModel.maxTokens ?? 16000, piModel.maxTokens ?? 32000),
            reasoning: reasoningLevel === 'off' ? undefined : reasoningLevel,
            ...(piModel.api === 'openai-codex-responses' ? { transport: 'sse' } : {}),
            signal: combinedSignal,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          const baseMsg = error instanceof Error ? error.message : String(error);
          const raw = error instanceof Error && error.name === 'TimeoutError' && !/timeout/i.test(baseMsg)
            ? `TimeoutError: ${baseMsg}`
            : baseMsg;
          throw new SubscriptionAiError(formatChatError(spec, raw), {
            retryable: /429|5\d\d|network|timeout|fetch failed|websocket/i.test(raw),
          });
        }
        if (result.stopReason === 'aborted' && signal?.aborted) {
          throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }
        if (result.stopReason === 'error') {
          const errText = result.errorMessage || '服务返回错误';
          throw new SubscriptionAiError(formatChatError(spec, errText), {
            retryable: /429|5\d\d|rate|overloaded|timeout|network/i.test(errText),
          });
        }
        const text = (result.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
        return { text, truncated: result.stopReason === 'length', thinkingUsed: reasoningLevel };
      },
    };
  }

  return {
    listSubscriptions,
    isConnected: async (idOrKey) => {
      const spec = resolveSpec(idOrKey);
      return spec ? isConnected(spec) : false;
    },
    startLogin,
    getLoginStatus,
    submitManualCode,
    cancelLogin,
    logout,
    setModel,
    setThinking,
    getSelectedModel,
    getSelectedThinking,
    getAccessToken,
    isChatGptDirectApi,
    getAllDiscoveredModels,
    refreshRemoteModels,
    fetchQuota,
    createClient,
    launchGeminiAuthTerminal,
    installGeminiCli,
    _store: store,
    _models: models,
  };
}
