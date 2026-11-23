import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { qwenTokenPlanCnProvider } from '@earendil-works/pi-ai/providers/qwen-token-plan-cn';
import { zaiProvider } from '@earendil-works/pi-ai/providers/zai';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_THINKING_LEVEL = 'low';

export const THINKING_LABELS = {
  off: '关闭',
  minimal: '极轻',
  low: '轻度',
  medium: '标准',
  high: '深度',
  xhigh: '超深',
  max: '极致',
};

const PI_PROVIDER_INSTANCES = {
  openai: openaiProvider(),
  anthropic: anthropicProvider(),
  'kimi-coding': kimiCodingProvider(),
  google: googleProvider(),
  deepseek: deepseekProvider(),
  'moonshotai-cn': moonshotaiCnProvider(),
  zai: zaiProvider(),
  'qwen-token-plan-cn': qwenTokenPlanCnProvider(),
};

/** 从我们的服务商 ID（含 sub:* 与 API）映射到 pi-ai 内置目录源。 */
const CATALOG_SOURCE = {
  'sub:chatgpt': { piId: 'openai' },
  'sub:claude': { piId: 'anthropic' },
  'sub:kimi': { piId: 'kimi-coding' },
  'sub:gemini': { piId: 'google' },
  openai: { piId: 'openai' },
  anthropic: { piId: 'anthropic' },
  gemini: { piId: 'google' },
  deepseek: { piId: 'deepseek' },
  moonshot: { piId: 'moonshotai-cn' },
  zhipu: { piId: 'zai' },
  qwen: { piId: 'qwen-token-plan-cn', filter: (m) => /^qwen/i.test(m.id) },
  doubao: { piId: null },
  custom: { piId: null },
};

const NON_CHAT_PATTERN =
  /(?:embed|embedding|whisper|tts|audio|realtime|transcribe|dall-e|image-gen|imagen|veo|moderation|babbage|davinci|sora|computer-use|robotics|live-|deep-research|classifier|gemma|daybreak|cyber)/i;

const DATED_SUFFIX_PATTERN = /-\d{4}-\d{2}-\d{2}$|-\d{8}$/;

/** 从任意模型 ID（及显示名）中动态解析版本号（用于永远把最新代模型排在前面，无需写死）。 */
export function parseModelVersion(id, name = '') {
  const lower = String(id ?? '').toLowerCase();
  // 处理 claude-opus-5-5 / claude-fable-5-2 / claude-sonnet-4-6
  const claudeMatch = lower.match(/claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?/);
  if (claudeMatch) return [Number(claudeMatch[1]), Number(claudeMatch[2] ?? 0)];
  // 处理 gpt-6.2-sol / gpt-5.5 / gpt-4.1
  const gptMatch = lower.match(/gpt-(\d+)(?:\.(\d+))?/);
  if (gptMatch) return [Number(gptMatch[1]), Number(gptMatch[2] ?? 0)];
  // 处理 o4-mini / o3 / o1
  const oMatch = lower.match(/^o(\d+)(?:\.(\d+))?/);
  if (oMatch) return [Number(oMatch[1]) + 0.5, Number(oMatch[2] ?? 0)];
  // 处理 gemini-4-neon / gemini-3.8-flash / gemini-2.5-pro
  const geminiMatch = lower.match(/gemini-(\d+)(?:\.(\d+))?/);
  if (geminiMatch) return [Number(geminiMatch[1]), Number(geminiMatch[2] ?? 0)];
  // 处理 k3.1-pro / kimi-k3.1-pro / kimi-k2.7
  const kimiMatch = lower.match(/(?:^|-)k(\d+)(?:\.(\d+))?/);
  if (kimiMatch) return [Number(kimiMatch[1]), Number(kimiMatch[2] ?? 0)];
  // 处理 qwen4-max / qwen3.8-flash / glm-5.3 / deepseek-v4.1 / doubao-seed-2-0
  const genericMatch = lower.match(/(?:qwen|glm-|deepseek-v|seed-)(\d+)(?:[.-](\d+))?/);
  if (genericMatch) return [Number(genericMatch[1]), Number(genericMatch[2] ?? 0)];
  // 若 ID 不带版本号但显示名带版本号（如 deepseek-flash -> DeepSeek V4.1 Flash），从显示名读取
  const nameMatch = String(name ?? '').toLowerCase().match(/v?(\d+)(?:\.(\d+))?/);
  if (nameMatch) return [Number(nameMatch[1]), Number(nameMatch[2] ?? 0)];
  if (lower.includes('latest') || lower === 'kimi-for-coding-highspeed' || lower === 'kimi-for-coding') {
    return [99, 0];
  }
  const anyNum = lower.match(/(\d+)(?:\.(\d+))?/);
  return anyNum ? [Number(anyNum[1]), Number(anyNum[2] ?? 0)] : [0, 0];
}

/** 同代模型内部的排序权重：最新旗舰与高速主力靠前。 */
function tierPriority(id) {
  const lower = String(id ?? '').toLowerCase();
  let score = 0;
  if (lower.includes('highspeed')) score += 18;
  if (lower.includes('neon')) score += 20;
  if (lower.includes('argon')) score += 16;
  if (lower.includes('hydrogen')) score += 14;
  if (lower.includes('carbon')) score += 12;
  if (lower.includes('sol')) score += 20;
  if (lower.includes('astra')) score += 18;
  if (lower.includes('terra')) score += 15;
  if (lower.includes('luna')) score += 13;
  if (lower.includes('opus')) score += 20;
  if (lower.includes('sonnet')) score += 19;
  if (lower.includes('fable')) score += 18;
  if (lower.includes('haiku')) score += 12;
  if (lower.includes('flash')) score += 16;
  if (lower.includes('pro')) score += 14;
  if (lower.includes('plus')) score += 12;
  if (lower.includes('max')) score += 10;
  if (lower.includes('mini')) score += 8;
  if (lower.includes('lite') || lower.includes('nano')) score += 5;
  if (lower.includes('preview')) score -= 2;
  if (lower.includes('latest') && !lower.includes('chat-latest')) score -= 60;
  if (DATED_SUFFIX_PATTERN.test(lower)) score -= 40;
  return score;
}

/** 速度偏好：用于为“默认推荐”选出既最新又响应迅速的主力模型。 */
function defaultSpeedBonus(id) {
  const lower = String(id ?? '').toLowerCase();
  let bonus = 0;
  if (lower.includes('highspeed') || lower.includes('flash') || lower.includes('sonnet') || lower.includes('sol') || lower.includes('neon')) bonus += 15;
  if (lower.includes('pro') && !lower.includes('highspeed') && !lower.includes('k3.1')) bonus -= 4;
  if (lower.includes('preview')) bonus -= 5;
  if (lower.includes('latest')) bonus -= 20;
  if (DATED_SUFFIX_PATTERN.test(lower)) bonus -= 30;
  return bonus;
}

function isUsefulChatModel(id, allIds) {
  if (!id || NON_CHAT_PATTERN.test(id)) return false;
  // 若存在不带日期后缀的同名别名，隐藏旧日期快照以保持下拉列表整洁。
  if (DATED_SUFFIX_PATTERN.test(id)) {
    const base = id.replace(DATED_SUFFIX_PATTERN, '');
    if (allIds.has(base)) return false;
  }
  return true;
}

export function sortModelsLatestFirst(entries) {
  return [...entries].sort((a, b) => {
    const [aMaj, aMin] = parseModelVersion(a.id, a.name);
    const [bMaj, bMin] = parseModelVersion(b.id, b.name);
    // 非版本号别名（如 gemini-flash-latest）不应压过明确的最新版本号
    const aNormMaj = aMaj === 99 ? 0 : aMaj;
    const bNormMaj = bMaj === 99 ? 0 : bMaj;
    if (aNormMaj !== bNormMaj) return bNormMaj - aNormMaj;
    if (aMin !== bMin) return bMin - aMin;
    const tierDiff = tierPriority(b.id) - tierPriority(a.id);
    if (tierDiff !== 0) return tierDiff;
    return a.id.localeCompare(b.id);
  });
}

function modelToEntry(model, overrides = {}) {
  const levels = getSupportedThinkingLevels(model);
  const vision =
    typeof overrides.vision === 'boolean'
      ? overrides.vision
      : Array.isArray(model.input)
        ? model.input.includes('image')
        : true;
  return {
    id: model.id,
    name: model.name || model.id,
    vision,
    reasoning: Boolean(model.reasoning),
    thinkingLevels: levels.length ? levels : ['off'],
    remote: Boolean(overrides.remote),
  };
}

/** 根据远端新模型 ID 推断最接近的同族能力（是否看图、支持的思考档位）。 */
function inferMetadataFromCatalog(remoteId, catalogEntries, fallbackVision = true) {
  const lower = remoteId.toLowerCase();
  const knownTextOnly = /(?:^o3-mini$|^gpt-4$|deepseek-v4-pro|deepseek-reasoner|deepseek-chat|glm-4\.7|glm-5(?:-turbo|\.2|\.3)?$|^glm-5\.3-highspeed$|qwen3\.7-max)/i.test(lower);
  const exact = catalogEntries.find((item) => item.id === remoteId);
  if (exact) return { ...exact, remote: true };
  // 匹配同家族前缀（如 gpt-6 / claude-opus / claude-fable / gemini-4 / k3）
  const familyPrefix = lower.split('-').slice(0, 2).join('-');
  const sibling = catalogEntries.find((item) => item.id.toLowerCase().startsWith(familyPrefix)) ?? catalogEntries[0];
  return {
    id: remoteId,
    name: remoteId,
    vision: knownTextOnly ? false : (sibling?.vision ?? fallbackVision),
    reasoning: sibling?.reasoning ?? true,
    thinkingLevels: sibling?.thinkingLevels ?? ['off', 'low', 'medium', 'high'],
    remote: true,
  };
}

/** 读取某个服务商（订阅或 API）的动态合并模型列表（实时发现模型 + pi-ai 内置最新目录，按最新版本降序）。 */
export function getProviderModelCatalog(providerId, remoteIds = []) {
  const src = CATALOG_SOURCE[providerId];
  const piProvider = src?.piId ? PI_PROVIDER_INSTANCES[src.piId] : null;
  const rawModels = piProvider ? piProvider.getModels().filter((m) => (src.filter ? src.filter(m) : true)) : [];
  const allIds = new Set([...rawModels.map((m) => m.id), ...remoteIds]);

  const baseEntries = rawModels
    .filter((m) => isUsefulChatModel(m.id, allIds))
    .map((m) => {
      // Gemini CLI 文本通道暂不直传图片，DeepSeek API 在未确认支持看图前保守标记 vision:false（识图自动走本地 OCR）
      const forceNoVision = providerId === 'sub:gemini' || providerId === 'deepseek';
      return modelToEntry(m, forceNoVision ? { vision: false } : {});
    });

  // 豆包内置最新兜底（pi-ai 暂未收录字节火山方舟目录，仍支持实时拉取与自定义）
  if (providerId === 'doubao' && baseEntries.length === 0) {
    baseEntries.push(
      { id: 'doubao-seed-2-0-pro', name: 'Doubao Seed 2.0 Pro', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], remote: false },
      { id: 'doubao-seed-1-6-250615', name: 'Doubao Seed 1.6', vision: true, reasoning: true, thinkingLevels: ['off', 'low', 'medium', 'high'], remote: false },
    );
  }

  const byId = new Map(baseEntries.map((item) => [item.id, item]));
  const fallbackVision = providerId !== 'sub:gemini' && providerId !== 'deepseek';
  for (const remoteId of remoteIds) {
    if (!isUsefulChatModel(remoteId, allIds)) continue;
    if (byId.has(remoteId)) {
      byId.set(remoteId, { ...byId.get(remoteId), remote: true });
    } else {
      byId.set(remoteId, inferMetadataFromCatalog(remoteId, baseEntries, fallbackVision));
    }
  }

  const sorted = sortModelsLatestFirst([...byId.values()]);
  // 标记最新一代（前 4 个非 legacy 模型）
  const topMajor = sorted.length ? parseModelVersion(sorted[0].id, sorted[0].name)[0] : 0;
  return sorted.map((item, idx) => ({
    ...item,
    latest: idx < 4 && (topMajor === 0 || parseModelVersion(item.id, item.name)[0] >= topMajor),
  }));
}

/** 自动为服务商选出最新且速度均衡的默认模型（绝不写死过时版本）。 */
export function pickDefaultModel(providerId, remoteIds = []) {
  const catalog = getProviderModelCatalog(providerId, remoteIds);
  if (!catalog.length) return '';
  const topVersion = parseModelVersion(catalog[0].id, catalog[0].name);
  const topGen = catalog.filter((item) => {
    const [maj, min] = parseModelVersion(item.id, item.name);
    return maj === topVersion[0] && min === topVersion[1];
  });
  const candidates = topGen.length ? topGen : catalog.slice(0, 4);
  candidates.sort((a, b) => defaultSpeedBonus(b.id) - defaultSpeedBonus(a.id));
  return candidates[0].id;
}

/** 查找指定模型的元信息（精确到单个模型是否支持看图、支持哪些思考档位）。 */
export function resolveModelMeta(providerId, modelId, remoteIds = []) {
  const catalog = getProviderModelCatalog(providerId, remoteIds);
  const exact = catalog.find((item) => item.id === modelId);
  if (exact) return exact;
  return inferMetadataFromCatalog(modelId || '', catalog, providerId !== 'sub:gemini' && providerId !== 'deepseek');
}

/** 将用户请求的思考档位按模型能力安全裁剪（fast=true 时强制选该模型最快的档位）。 */
export function resolveEffectiveThinkingLevel(providerId, modelId, requestedLevel = DEFAULT_THINKING_LEVEL, { fast = false } = {}) {
  const src = CATALOG_SOURCE[providerId];
  const piProvider = src?.piId ? PI_PROVIDER_INSTANCES[src.piId] : null;
  const piModel = piProvider?.getModels().find((m) => m.id === modelId);
  const target = fast ? 'off' : (THINKING_LEVELS.includes(requestedLevel) ? requestedLevel : DEFAULT_THINKING_LEVEL);

  if (piModel) {
    return clampThinkingLevel(piModel, target);
  }
  const meta = resolveModelMeta(providerId, modelId);
  const supported = meta.thinkingLevels?.length ? meta.thinkingLevels : ['off'];
  if (supported.includes(target)) return target;
  if (fast) return supported[0];
  const reqIdx = THINKING_LEVELS.indexOf(target);
  // 找最接近的可用档位
  let best = supported[0];
  let bestDist = Infinity;
  for (const level of supported) {
    const dist = Math.abs(THINKING_LEVELS.indexOf(level) - reqIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }
  return best;
}

/**
 * 实时向厂商官方接口拉取最新可用模型列表（OpenAI/兼容 `/models`、Anthropic `/v1/models`、Gemini `/models`）。
 * 拉取失败时优雅返回空数组，不影响本地 pi-ai 目录正常使用。
 */
export async function fetchRemoteModelIds({ providerId, baseUrl = '', token = '', isOAuth = false, fetchImpl = fetch, signal }) {
  if (!token) return [];
  const timeoutSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)].filter(Boolean));
  try {
    if (providerId === 'anthropic' || providerId === 'sub:claude') {
      const endpoint = `${(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/models?limit=100`;
      const headers = isOAuth
        ? {
            Authorization: `Bearer ${token}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-code/2.1.0',
          }
        : {
            'x-api-key': token,
            'anthropic-version': '2023-06-01',
          };
      const res = await fetchImpl(endpoint, { headers, signal: timeoutSignal });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []).map((item) => String(item.id ?? '').trim()).filter(Boolean);
    }

    if (providerId === 'gemini') {
      const nativeBase = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/openai\/?$/, '').replace(/\/+$/, '');
      const res = await fetchImpl(`${nativeBase}/models?pageSize=100`, {
        headers: { 'x-goog-api-key': token },
        signal: timeoutSignal,
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.models ?? [])
        .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
        .map((item) => String(item.name ?? '').replace(/^models\//, '').trim())
        .filter(Boolean);
    }

    // OpenAI / ChatGPT OAuth / Kimi Code / DeepSeek / Qwen / Zhipu / Moonshot / Doubao / Custom
    const cleanBase = (
      baseUrl ||
      (providerId === 'sub:chatgpt' || providerId === 'openai'
        ? 'https://api.openai.com/v1'
        : providerId === 'sub:kimi'
          ? 'https://api.kimi.com/coding/v1'
          : '')
    ).replace(/\/+$/, '');
    if (!cleanBase) return [];
    const res = await fetchImpl(`${cleanBase}/models`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: timeoutSignal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
    return list.map((item) => String(item.id ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function classifySpeedTier(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'unknown';
  if (seconds <= 4) return 'fast';
  if (seconds <= 10) return 'normal';
  return 'slow';
}
