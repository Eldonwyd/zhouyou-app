import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_THINKING_LEVEL,
  getProviderModelCatalog,
  pickDefaultModel,
  resolveEffectiveThinkingLevel,
  resolveModelMeta,
} from './ai-catalog.mjs';

/** 支持的 AI API 服务商。默认模型和可选模型列表均来自 ai-catalog 动态目录 + 官方接口实时拉取，不写死过时模型。 */
export const AI_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
    json: true, vision: false, maxTokens: 26000,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  anthropic: {
    label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com',
    json: false, vision: true, maxTokens: 64000,
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  openai: {
    label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    json: true, vision: true, maxTokens: 16000,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    json: true, vision: true, maxTokens: 32000,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  qwen: {
    label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    json: true, vision: true, maxTokens: 16000,
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  zhipu: {
    label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    json: true, vision: true, maxTokens: 16000,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  moonshot: {
    label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1',
    json: true, vision: true, maxTokens: 16000,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  doubao: {
    label: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    json: true, vision: true, maxTokens: 16000,
    keyUrl: 'https://console.volcengine.com/ark',
  },
  custom: {
    label: '其他 OpenAI 兼容接口', baseUrl: '',
    json: false, vision: true, maxTokens: 16000,
    keyUrl: '',
  },
};

export function defaultApiModel(providerId, discoveredRemoteIds = []) {
  return pickDefaultModel(providerId, discoveredRemoteIds) || '';
}

export function publicProviderList(discoveredMap = {}) {
  return Object.entries(AI_PROVIDERS).map(([id, item]) => {
    const remoteIds = discoveredMap[id] ?? [];
    const catalog = getProviderModelCatalog(id, remoteIds);
    const defaultModel = pickDefaultModel(id, remoteIds);
    return {
      id,
      label: item.label,
      baseUrl: item.baseUrl,
      model: defaultModel,
      models: catalog,
      keyUrl: item.keyUrl,
    };
  });
}

class AiError extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.retryable = retryable; }
}

function mapAnthropicEffort(level) {
  if (level === 'off') return null;
  if (level === 'minimal' || level === 'low') return 'low';
  if (level === 'medium') return 'medium';
  if (level === 'max') return 'max';
  return 'high';
}

function mapCompatibleReasoningParams(provider, effectiveLevel) {
  if (provider === 'deepseek') {
    return { thinking: { type: effectiveLevel === 'off' ? 'disabled' : 'enabled' } };
  }
  if (provider === 'zhipu') {
    return { thinking: { type: effectiveLevel === 'off' ? 'disabled' : 'enabled' } };
  }
  if (provider === 'qwen') {
    return { enable_thinking: effectiveLevel !== 'off' };
  }
  if (effectiveLevel === 'off') {
    return provider === 'openai' || provider === 'gemini' ? { reasoning_effort: 'none' } : {};
  }
  if (provider === 'openai') {
    const effort = effectiveLevel === 'max' ? 'xhigh' : effectiveLevel;
    return { reasoning_effort: effort };
  }
  if (provider === 'gemini') {
    const effort = effectiveLevel === 'minimal' ? 'low' : effectiveLevel === 'xhigh' || effectiveLevel === 'max' ? 'high' : effectiveLevel;
    return { reasoning_effort: effort };
  }
  if (provider === 'moonshot' || provider === 'doubao') {
    const effort = effectiveLevel === 'minimal' ? 'low' : effectiveLevel === 'xhigh' || effectiveLevel === 'max' ? 'high' : effectiveLevel;
    return { reasoning_effort: effort };
  }
  return {};
}

/** 创建对话客户端：chat() 返回模型的文本输出；支持思考档位调节与快速通道，错误转为中文提示。 */
export function createAiClient(
  { provider = 'deepseek', apiKey = '', model = '', baseUrl = '', thinking = DEFAULT_THINKING_LEVEL, remoteModelIds = [] } = {},
  fetchImpl = fetch,
) {
  const spec = AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
  const resolvedModel = model || defaultApiModel(provider, remoteModelIds);
  const resolvedBase = (baseUrl || spec.baseUrl).replace(/\/+$/, '');
  const configured = Boolean(apiKey && resolvedModel && resolvedBase);
  const label = `${spec.label}${resolvedModel ? ` · ${resolvedModel}` : ''}`;
  const meta = resolveModelMeta(provider, resolvedModel, remoteModelIds);
  const effectiveDefaultThinking = resolveEffectiveThinkingLevel(provider, resolvedModel, thinking);
  const anthropic = provider === 'anthropic' && apiKey
    ? new Anthropic({ apiKey, ...(baseUrl ? { baseURL: resolvedBase } : {}), maxRetries: 1 })
    : null;

  function toAnthropicMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((part) => (
          part.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } }
            : part
        )),
      };
    });
  }

  function toCompatibleMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((part) => (
          part.type === 'image'
            ? { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
            : part
        )),
      };
    });
  }

  async function chatAnthropic({ system, messages, maxTokens, signal, thinkingLevel }) {
    const effort = mapAnthropicEffort(thinkingLevel);
    try {
      const stream = anthropic.beta.messages.stream({
        model: resolvedModel,
        max_tokens: Math.min(maxTokens ?? spec.maxTokens, spec.maxTokens),
        system,
        messages: toAnthropicMessages(messages),
        ...(effort ? { output_config: { effort } } : {}),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new AiError('AI 拒绝了这次请求，请换个说法重试');
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      return { text, truncated: message.stop_reason === 'max_tokens', thinkingUsed: thinkingLevel };
    } catch (error) {
      if (signal?.aborted || error instanceof AiError) throw error;
      if (error instanceof Anthropic.AuthenticationError) throw new AiError('Claude API Key 无效，请在“配置 AI”中检查');
      if (error instanceof Anthropic.PermissionDeniedError) throw new AiError('Claude API Key 没有该模型的访问权限');
      if (error instanceof Anthropic.NotFoundError) throw new AiError(`Claude 模型“${resolvedModel}”不存在，请检查模型名`);
      if (error instanceof Anthropic.RateLimitError) throw new AiError('Claude 请求过于频繁或额度不足，请稍后重试', { retryable: true });
      if (error instanceof Anthropic.BadRequestError) throw new AiError(`Claude 请求无效：${error.message}`.slice(0, 200));
      if (error instanceof Anthropic.APIError) throw new AiError(`Claude 服务暂时不可用（${error.status ?? '网络'}），请稍后重试`, { retryable: true });
      throw new AiError('无法连接 Claude 服务，请检查网络后重试', { retryable: true });
    }
  }

  async function postCompatible(body, signal, timeout) {
    try {
      return await fetchImpl(`${resolvedBase}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean)),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AiError(`无法连接 ${spec.label}，请检查网络或接口地址`, { retryable: true });
    }
  }

  async function chatCompatible({ system, messages, maxTokens, json, signal, timeout, thinkingLevel }) {
    const reasoningExtra = mapCompatibleReasoningParams(provider, thinkingLevel);
    const baseBody = {
      model: resolvedModel,
      max_tokens: Math.min(maxTokens ?? spec.maxTokens, spec.maxTokens),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...toCompatibleMessages(messages)],
      ...(json && spec.json ? { response_format: { type: 'json_object' } } : {}),
    };
    const bodyWithReasoning = { ...baseBody, ...reasoningExtra };
    let response = await postCompatible(bodyWithReasoning, signal, timeout);

    // 部分兼容接口或非思考模型不接受 reasoning_effort / thinking 参数时，自动去掉参数重试一次。
    if (response.status === 400 && Object.keys(reasoningExtra).length > 0) {
      const detail = await response.text().catch(() => '');
      if (/reasoning|thinking|unknown|unrecognized|unsupported|extra_forbidden|invalid/i.test(detail)) {
        response = await postCompatible(baseBody, signal, timeout);
      } else {
        throw new AiError(`${spec.label} 返回错误（400）${detail ? `：${detail.slice(0, 160)}` : ''}`);
      }
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      if (response.status === 401 || response.status === 403) throw new AiError(`${spec.label} API Key 无效或无权限，请在“配置 AI”中检查`);
      if (response.status === 404) throw new AiError(`${spec.label} 找不到模型“${resolvedModel}”或接口地址有误`);
      if (response.status === 402 || /余额|balance|quota|insufficient/i.test(detail)) throw new AiError(`${spec.label} 账户余额或额度不足`);
      if (response.status === 429) throw new AiError(`${spec.label} 请求过于频繁，请稍后重试`, { retryable: true });
      throw new AiError(`${spec.label} 返回错误（${response.status}）${detail ? `：${detail}` : ''}`, { retryable: response.status >= 500 });
    }
    const result = await response.json();
    const choice = result.choices?.[0];
    return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length', thinkingUsed: thinkingLevel };
  }

  return {
    provider,
    model: resolvedModel,
    baseUrl: resolvedBase,
    label,
    configured,
    vision: meta.vision,
    thinking: effectiveDefaultThinking,
    thinkingLevels: meta.thinkingLevels,
    authMode: 'api',
    /** messages 只含 user/assistant；system 单独传入。fast=true 时自动采用该模型最快思考档位。 */
    async chat({ system = '', messages, maxTokens, json = true, signal, timeout = 180000, fast = false, thinking: callThinking }) {
      if (!configured) throw new AiError('尚未配置 AI 服务，请点“配置 AI”填写 API Key');
      const thinkingLevel = resolveEffectiveThinkingLevel(provider, resolvedModel, callThinking || thinking, { fast });
      return provider === 'anthropic'
        ? chatAnthropic({ system, messages, maxTokens, signal, thinkingLevel })
        : chatCompatible({ system, messages, maxTokens, json, signal, timeout, thinkingLevel });
    },
  };
}
