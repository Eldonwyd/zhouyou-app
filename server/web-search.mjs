import Anthropic from '@anthropic-ai/sdk';
import { AI_PROVIDERS } from './ai-provider.mjs';

/** 联网检索按服务商分三类：
 * - direct：有独立搜索接口，直接返回网址 + 正文（DeepSeek、智谱）。
 * - citation：搜索内置在对话里，只拿得到网址和标题（OpenAI、Gemini、Claude、通义千问），正文由本地抓取补齐。
 * - none：拿不到检索结果（Kimi、豆包、自定义接口），按模型知识规划。
 * 所有 search() 都返回 [{ url, title, content, summary, date }]，fetch() 返回 { content, url }。
 */
export const SEARCH_KIND = {
  deepseek: 'direct', zhipu: 'direct',
  openai: 'citation', gemini: 'citation', anthropic: 'citation', qwen: 'citation',
  moonshot: 'none', doubao: 'none', custom: 'none',
};

const SEARCH_PROMPT = (query) => `请联网搜索：${query}\n只需搜索，简要列出找到的网页即可。`;

/** 网页转纯文本：去掉脚本、样式和标签，合并空白。 */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function createWebSearch({ provider = 'deepseek', apiKey = '', model = '', baseUrl = '' } = {}, fetchImpl = fetch) {
  const spec = AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
  const kind = apiKey ? SEARCH_KIND[provider] ?? 'none' : 'none';
  const resolvedModel = model || spec.model;
  const base = (baseUrl || spec.baseUrl).replace(/\/+$/, '');
  const withTimeout = (signal, timeout) => AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean));

  async function postJson(url, body, headers, signal, timeout) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: withTimeout(signal, timeout),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      if (response.status === 401 || response.status === 403) throw new Error(`${spec.label} API Key 无效，联网检索不可用`);
      if (response.status === 402 || /余额|balance|insufficient/i.test(detail)) throw new Error(`${spec.label} 账户余额不足`);
      throw new Error(`${spec.label} 联网检索失败（HTTP ${response.status}）`);
    }
    return response.json();
  }

  /** 自己抓网页正文：跟随跳转（Gemini 返回的是跳转链接），返回最终网址与纯文本。 */
  async function readPage(url, signal, timeout = 15000) {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: withTimeout(signal, timeout),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TravelFootprints/1.0)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    });
    if (!response.ok) throw new Error(`网页读取失败（HTTP ${response.status}）`);
    const type = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const content = type.includes('html') ? htmlToText(text) : type.startsWith('text/') ? text : '';
    return { url: response.url || url, content: content.slice(0, 20000) };
  }

  // ---- 第一类：独立搜索接口 ----
  async function deepseekSearch(query, count, needContent, signal, timeout) {
    const result = await postJson(`https://api.deepseek.com/v1/tools/search`, { query, count, need_content: needContent },
      { Authorization: `Bearer ${apiKey}` }, signal, timeout);
    return result.results ?? [];
  }
  async function zhipuSearch(query, count, needContent, signal, timeout) {
    const result = await postJson(`${base.replace(/\/api\/paas\/v4$/, '')}/api/paas/v4/web_search`, {
      search_query: query, search_engine: 'search_std', count, ...(needContent ? { content_size: 'high' } : {}),
    }, { Authorization: `Bearer ${apiKey}` }, signal, timeout);
    return (result.search_result ?? []).map((item) => ({
      url: item.link, title: item.title, content: item.content ?? '', summary: item.content ?? '', date: item.publish_date ?? null,
    }));
  }

  // ---- 第二类：对话内置搜索，只取网址与标题 ----
  async function openaiSearch(query, signal, timeout) {
    const result = await postJson(`${base}/responses`, {
      model: resolvedModel, input: SEARCH_PROMPT(query), tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
    }, { Authorization: `Bearer ${apiKey}` }, signal, timeout);
    const found = [];
    for (const item of result.output ?? []) {
      if (item.type === 'web_search_call') for (const source of item.action?.sources ?? []) found.push({ url: source.url, title: source.title ?? '' });
      if (item.type === 'message') for (const part of item.content ?? []) for (const note of part.annotations ?? [])
        if (note.type === 'url_citation') found.push({ url: note.url, title: note.title ?? '' });
    }
    return found;
  }
  async function geminiSearch(query, signal, timeout) {
    const nativeBase = base.replace(/\/openai$/, '');
    const result = await postJson(`${nativeBase}/models/${encodeURIComponent(resolvedModel)}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: SEARCH_PROMPT(query) }] }],
      tools: [{ google_search: {} }],
    }, { 'x-goog-api-key': apiKey }, signal, timeout);
    return (result.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .filter((chunk) => chunk.web?.uri)
      .map((chunk) => ({ url: chunk.web.uri, title: chunk.web.title ?? '' }));
  }
  const anthropic = provider === 'anthropic' && apiKey
    ? new Anthropic({ apiKey, ...(baseUrl ? { baseURL: base } : {}), maxRetries: 1, fetch: fetchImpl })
    : null;
  async function claudeSearch(query, signal, timeout) {
    let message;
    try {
      message = await anthropic.messages.create({
        model: resolvedModel,
        max_tokens: 4096,
        output_config: { effort: 'low' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
        messages: [{ role: 'user', content: SEARCH_PROMPT(query) }],
      }, { signal: withTimeout(signal, timeout) });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof Anthropic.AuthenticationError) throw new Error('Claude API Key 无效，联网检索不可用');
      throw new Error(`Claude 联网检索失败（${error.status ?? '网络'}）`);
    }
    const found = [];
    for (const block of message.content) {
      // 正文是加密的（encrypted_content），只取网址、标题和发布时间。
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content))
        for (const item of block.content) if (item.type === 'web_search_result') found.push({ url: item.url, title: item.title ?? '', date: item.page_age ?? null });
    }
    return found;
  }
  async function qwenSearch(query, signal, timeout) {
    const nativeBase = base.replace(/\/compatible-mode\/v1$/, '');
    const result = await postJson(`${nativeBase}/api/v1/services/aigc/text-generation/generation`, {
      model: resolvedModel,
      input: { messages: [{ role: 'user', content: SEARCH_PROMPT(query) }] },
      parameters: { result_format: 'message', enable_search: true, search_options: { forced_search: true, enable_source: true } },
    }, { Authorization: `Bearer ${apiKey}` }, signal, timeout);
    return (result.output?.search_info?.search_results ?? []).map((item) => ({ url: item.url, title: item.title ?? item.site_name ?? '' }));
  }

  async function search(query, { count = 4, needContent = true, signal, timeout = 45000 } = {}) {
    if (kind === 'none') return [];
    if (provider === 'deepseek') return deepseekSearch(query, count, needContent, signal, timeout);
    if (provider === 'zhipu') return zhipuSearch(query, count, needContent, signal, timeout);
    const found = provider === 'openai' ? await openaiSearch(query, signal, timeout)
      : provider === 'gemini' ? await geminiSearch(query, signal, timeout)
        : provider === 'anthropic' ? await claudeSearch(query, signal, timeout)
          : await qwenSearch(query, signal, timeout);
    const unique = [...new Map(found.filter((item) => /^https?:\/\//.test(item.url ?? '')).map((item) => [item.url, item])).values()].slice(0, count);
    if (!needContent) return unique.map((item) => ({ ...item, content: '', summary: item.title }));
    // 只给了网址和标题：并行抓正文；读不到的保留标题，仍可作为可点开的来源。
    return Promise.all(unique.map(async (item) => {
      try {
        const page = await readPage(item.url, signal);
        return { ...item, url: page.url, content: page.content, summary: page.content.slice(0, 300) || item.title };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { ...item, content: '', summary: item.title };
      }
    }));
  }

  async function fetchPage(url, { signal, timeout = 25000 } = {}) {
    if (provider === 'deepseek' && kind !== 'none') {
      const page = await postJson('https://api.deepseek.com/v1/tools/fetch', { url }, { Authorization: `Bearer ${apiKey}` }, signal, timeout);
      return { url, content: page.content ?? page.markdown ?? '' };
    }
    return readPage(url, signal, timeout);
  }

  return { provider, kind, available: kind !== 'none', label: spec.label, search, fetch: fetchPage };
}
