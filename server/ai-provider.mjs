import Anthropic from '@anthropic-ai/sdk';

/** 支持的 AI 服务商。除 Anthropic 走官方 SDK 外，其余都用各自的 OpenAI 兼容接口。
 * 默认模型只是建议值，各家更新很快，可在“配置 AI”里改成官网当前的模型名。
 * json：接口是否支持 response_format=json_object；不支持时靠提示词与本地 jsonrepair。
 */
export const AI_PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', json: true, vision: false, maxTokens: 26000, extra: { thinking: { type: 'disabled' } }, keyUrl: 'https://platform.deepseek.com/api_keys' },
  anthropic: { label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', json: false, vision: true, maxTokens: 64000, keyUrl: 'https://platform.claude.com/settings/keys' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', json: true, vision: true, maxTokens: 16000, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', json: true, vision: true, maxTokens: 32000, keyUrl: 'https://aistudio.google.com/apikey' },
  qwen: { label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', json: true, vision: true, maxTokens: 16000, keyUrl: 'https://bailian.console.aliyun.com/' },
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', json: true, vision: true, maxTokens: 16000, keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  moonshot: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview', json: true, vision: true, maxTokens: 16000, keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  doubao: { label: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615', json: true, vision: true, maxTokens: 16000, keyUrl: 'https://console.volcengine.com/ark' },
  custom: { label: '其他 OpenAI 兼容接口', baseUrl: '', model: '', json: false, vision: true, maxTokens: 16000, keyUrl: '' },
};

export function publicProviderList() {
  return Object.entries(AI_PROVIDERS).map(([id, item]) => ({ id, label: item.label, baseUrl: item.baseUrl, model: item.model, keyUrl: item.keyUrl }));
}

class AiError extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.retryable = retryable; }
}

/** 创建对话客户端：chat() 返回模型的文本输出；截断、拒答、鉴权等错误转为中文提示。 */
export function createAiClient({ provider = 'deepseek', apiKey = '', model = '', baseUrl = '' } = {}, fetchImpl = fetch) {
  const spec = AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
  const resolvedModel = model || spec.model;
  const resolvedBase = (baseUrl || spec.baseUrl).replace(/\/+$/, '');
  const configured = Boolean(apiKey && resolvedModel && resolvedBase);
  const label = `${spec.label}${resolvedModel ? ` · ${resolvedModel}` : ''}`;
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

  async function chatAnthropic({ system, messages, maxTokens, signal }) {
    try {
      // 长输出用流式请求避免超时；默认开启服务端拒答兜底（policy decline 时自动换模型继续）。
      const stream = anthropic.beta.messages.stream({
        model: resolvedModel,
        max_tokens: Math.min(maxTokens ?? spec.maxTokens, spec.maxTokens),
        system,
        messages: toAnthropicMessages(messages),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new AiError('AI 拒绝了这次请求，请换个说法重试');
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      return { text, truncated: message.stop_reason === 'max_tokens' };
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

  async function chatCompatible({ system, messages, maxTokens, json, signal, timeout }) {
    const body = {
      model: resolvedModel,
      max_tokens: Math.min(maxTokens ?? spec.maxTokens, spec.maxTokens),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...toCompatibleMessages(messages)],
      ...(json && spec.json ? { response_format: { type: 'json_object' } } : {}),
      ...(spec.extra ?? {}),
    };
    let response;
    try {
      response = await fetchImpl(`${resolvedBase}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean)),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AiError(`无法连接 ${spec.label}，请检查网络或接口地址`, { retryable: true });
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
    return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' };
  }

  return {
    provider, model: resolvedModel, baseUrl: resolvedBase, label, configured, vision: spec.vision !== false,
    /** messages 只含 user/assistant；system 单独传入。 */
    async chat({ system = '', messages, maxTokens, json = true, signal, timeout = 180000 }) {
      if (!configured) throw new AiError('尚未配置 AI 服务，请点“配置 AI”填写 API Key');
      return provider === 'anthropic'
        ? chatAnthropic({ system, messages, maxTokens, signal })
        : chatCompatible({ system, messages, maxTokens, json, signal, timeout });
    },
  };
}
