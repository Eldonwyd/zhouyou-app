import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlannerService } from './planner-service.mjs';
import { createPlannerMapService } from './planner-map-service.mjs';
import { plannerDisplayText } from '../src/planner-display.ts';
import { createPlannerPhotoStore, validPlannerPhotoId } from './planner-photo-store.mjs';
import { plannerPhotoPlaceName, plannerPhotoCityName } from '../src/planner-photo.ts';
import { createXhsBridge } from './xhs-bridge.mjs';
import { createPhotoInspector } from './photo-inspector.mjs';
import { createLocalOcr } from './local-ocr.mjs';
import { writeAiSettings, writePhotoSettings } from './server-settings.mjs';
import { AI_PROVIDERS, createAiClient, publicProviderList } from './ai-provider.mjs';
import { createSubscriptionManager, isSubscriptionProvider } from './ai-subscriptions.mjs';
import { classifySpeedTier, DEFAULT_THINKING_LEVEL, getProviderModelCatalog, THINKING_LEVELS } from './ai-catalog.mjs';
import { createWebSearch, SEARCH_KIND } from './web-search.mjs';
import { getDataPath, getDistDir } from './runtime-paths.mjs';

/** Read the ignored server environment; credentials never enter public config. */
export async function readServerKey(name = 'DEEPSEEK_API_KEY') {
  if (!/^[A-Z_]+$/.test(name)) throw new Error('服务配置名称无效');
  if (process.env[name]) return process.env[name];
  try {
    const env = await readFile(getDataPath('.env.local'), 'utf8');
    return env.match(new RegExp(`^${name}\\s*=\\s*["']?([^\\s"'\\r\\n]+)`, 'm'))?.[1] ?? '';
  } catch {
    return '';
  }
}

/** 开发网页和生产服务共用请求处理器，保留相同的路由、进度流与取消行为。 */
export async function createPlannerRequestHandler(options = {}) {
  const apiKey = options.apiKey ?? (await readServerKey());
  const photoStore = options.photoStore ?? createPlannerPhotoStore();
  let imageSearchKey = await readServerKey('BRAVE_IMAGE_SEARCH_KEY');
  // 本地小红书工具掉线时自动重新拉起（仅限已安装的工具，不会下载）；动态导入避免与安装脚本循环依赖。
  const ensureXhsRunning = async () => (await import('../scripts/setup-xhs.mjs')).ensureXhs();
  const xhsBridge = options.xhsBridge ?? createXhsBridge({ baseUrl: await readServerKey('XHS_BRIDGE_URL'), token: await readServerKey('XHS_BRIDGE_TOKEN'), ensureRunning: ensureXhsRunning });
  if (!options.xhsBridge && xhsBridge.configured && !options.noXhsKeepAlive)
    void import('../scripts/setup-xhs.mjs').then((xhs) => { void xhs.ensureXhs(); xhs.keepXhsAlive(); }).catch(() => {});
  // 配图检查器与本地 OCR 全局共享：切换 AI 配置时不重复加载 ONNX 模型。
  const photoInspector = options.photoInspector ?? createPhotoInspector();
  const localOcr = options.localOcr ?? createLocalOcr();
  // AI 服务可保存多套（订阅账号 + 每个 API 服务商一套 Key/模型/地址），页面里随时切换。
  // 旧配置兼容：AI_API_KEY/AI_MODEL/AI_BASE_URL 属于 AI_PROVIDER；DEEPSEEK_API_KEY 属于 DeepSeek。
  const subscriptions = options.subscriptions ?? (await createSubscriptionManager({ authFile: options.authFile }));
  const envName = (prefix, provider) => `${prefix}_${provider.toUpperCase()}`;
  const envProvider = await readServerKey('AI_PROVIDER');
  const writeSettings = options.writeAiSettings ?? writeAiSettings;
  let activeProvider =
    AI_PROVIDERS[envProvider] || isSubscriptionProvider(envProvider) ? envProvider : 'deepseek';
  if (options.apiKey && isSubscriptionProvider(activeProvider) && !(await subscriptions.isConnected(activeProvider))) {
    activeProvider = 'deepseek';
  }
  const profiles = {};
  for (const provider of Object.keys(AI_PROVIDERS)) {
    const rawThinking = await readServerKey(envName('AI_THINKING', provider));
    const profile = {
      provider,
      apiKey: await readServerKey(envName('AI_KEY', provider)),
      model: await readServerKey(envName('AI_MODEL', provider)),
      baseUrl: await readServerKey(envName('AI_BASE_URL', provider)),
      thinking: THINKING_LEVELS.includes(rawThinking) ? rawThinking : DEFAULT_THINKING_LEVEL,
    };
    if (provider === activeProvider && !profile.apiKey) {
      profile.apiKey = await readServerKey('AI_API_KEY');
      profile.model ||= await readServerKey('AI_MODEL');
      profile.baseUrl ||= await readServerKey('AI_BASE_URL');
    }
    if (provider === 'deepseek' && !profile.apiKey) profile.apiKey = apiKey;
    if (profile.apiKey) profiles[provider] = profile;
  }
  const aiConfig = () => profiles[activeProvider] ?? { provider: activeProvider, apiKey: '', model: '', baseUrl: '', thinking: DEFAULT_THINKING_LEVEL };
  const buildClient = async (provider) => {
    if (isSubscriptionProvider(provider)) return subscriptions.createClient(provider);
    const discoveredMap = await subscriptions.getAllDiscoveredModels();
    const prof = profiles[provider] ?? { provider, apiKey: '', model: '', baseUrl: '', thinking: DEFAULT_THINKING_LEVEL };
    return createAiClient({ ...prof, remoteModelIds: discoveredMap[provider] ?? [] });
  };
  /** 联网检索：优先用当前服务商自己的搜索；当前服务商没有（如 Kimi/Claude 订阅）时借用已保存的、能联网的服务商。 */
  const searchOrder = ['direct', 'citation'];
  const pickSearch = async (currentAi) => {
    if (options.webSearch) return options.webSearch;
    if (activeProvider === 'sub:chatgpt' && currentAi.configured && (await subscriptions.isChatGptDirectApi?.())) {
      return createWebSearch({
        provider: 'sub:chatgpt',
        model: currentAi.model,
        getAccessToken: () => subscriptions.getAccessToken('chatgpt'),
      });
    }
    if (!isSubscriptionProvider(activeProvider)) {
      const own = createWebSearch(aiConfig());
      if (own.available) return own;
    }
    for (const kind of searchOrder)
      for (const profile of Object.values(profiles))
        if (SEARCH_KIND[profile.provider] === kind) return createWebSearch(profile);
    if ((await subscriptions.isConnected('chatgpt')) && (await subscriptions.isChatGptDirectApi?.())) {
      return createWebSearch({
        provider: 'sub:chatgpt',
        model: await subscriptions.getSelectedModel('chatgpt'),
        getAccessToken: () => subscriptions.getAccessToken('chatgpt'),
      });
    }
    return createWebSearch({ provider: 'custom' });
  };
  /** 图片识别模型：优先用当前服务商；当前为纯文本模型（如 DeepSeek）时自动借用其他已连接/已保存的多模态服务商。 */
  const pickVisionAi = async (currentAi) => {
    if (currentAi.configured && currentAi.vision) return currentAi;
    for (const subId of ['sub:chatgpt', 'sub:claude', 'sub:kimi']) {
      if (await subscriptions.isConnected(subId)) {
        const candidate = await subscriptions.createClient(subId);
        if (candidate.configured && candidate.vision) return candidate;
      }
    }
    for (const profile of Object.values(profiles)) {
      const candidate = createAiClient(profile);
      if (candidate.configured && candidate.vision) return candidate;
    }
    return currentAi;
  };
  let ai = await buildClient(activeProvider);
  let web = await pickSearch(ai);
  let visionAi = await pickVisionAi(ai);
  const makePlanner = () =>
    options.service ??
    createPlannerService({ apiKey, ai, visionAi, localOcr, webSearch: web, photoStore, imageSearchKey, xhsBridge, photoInspector });
  let planner = makePlanner();
  const activate = async (provider) => {
    activeProvider = provider;
    ai = await buildClient(provider);
    web = await pickSearch(ai);
    visionAi = await pickVisionAi(ai);
    planner = makePlanner();
  };
  const onSubscriptionConnected = async (subId) => {
    await writeSettings({ AI_PROVIDER: subId });
    await activate(subId);
  };
  const searchState = () => ({
    searchAvailable: web.available,
    searchLabel: !web.available ? '' : web.provider === activeProvider ? `${web.label} 联网` : `借用 ${web.label} 联网`,
  });
  const savedList = async (subList, discoveredMap) => {
    const subs = subList ?? (await subscriptions.listSubscriptions(activeProvider));
    const discovered = discoveredMap ?? (await subscriptions.getAllDiscoveredModels());
    const subEntries = subs
      .filter((item) => item.connected)
      .map((item) => ({
        id: item.id,
        label: item.name,
        model: item.model,
        thinking: item.thinking,
        thinkingLevels: item.thinkingLevels,
        vision: item.vision,
        search: item.search,
        authMode: 'subscription',
      }));
    const apiEntries = Object.values(profiles).map((profile) => {
      const client = createAiClient({ ...profile, remoteModelIds: discovered[profile.provider] ?? [] });
      return {
        id: profile.provider,
        label: AI_PROVIDERS[profile.provider].label,
        model: client.model,
        thinking: client.thinking,
        thinkingLevels: client.thinkingLevels,
        vision: client.vision,
        search: SEARCH_KIND[profile.provider],
        authMode: 'api',
      };
    });
    return [...subEntries, ...apiEntries];
  };
  const activeModelsFor = (subList, discoveredMap) => {
    if (isSubscriptionProvider(activeProvider)) {
      return subList.find((item) => item.id === activeProvider)?.models ?? [];
    }
    return getProviderModelCatalog(activeProvider, discoveredMap[activeProvider] ?? []);
  };
  const aiState = async () => {
    const subList = await subscriptions.listSubscriptions(activeProvider);
    const discoveredMap = await subscriptions.getAllDiscoveredModels();
    return {
      provider: activeProvider,
      authMode: isSubscriptionProvider(activeProvider) ? 'subscription' : 'api',
      model: ai.model,
      modelId: ai.model,
      models: activeModelsFor(subList, discoveredMap),
      baseUrl: ai.baseUrl,
      label: ai.label,
      thinking: ai.thinking ?? DEFAULT_THINKING_LEVEL,
      thinkingLevels: ai.thinkingLevels ?? ['off'],
      vision: ai.vision !== false,
      keyConfigured: isSubscriptionProvider(activeProvider) ? ai.configured : Boolean(aiConfig().apiKey),
      configured: ai.configured,
      ...searchState(),
      saved: await savedList(subList, discoveredMap),
      subscriptions: subList,
      providers: publicProviderList(discoveredMap),
    };
  };
  /** 页面提交的配置：Key 留空表示沿用该服务商已保存的 Key（不回传密钥内容）。 */
  const readAiInput = (body) => {
    const provider = String(body.provider ?? '');
    if (!AI_PROVIDERS[provider]) throw new Error('请选择支持的 AI 服务商');
    const inputKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '';
    const rawThinking = typeof body.thinking === 'string' ? body.thinking.trim() : '';
    const thinking = rawThinking
      ? (THINKING_LEVELS.includes(rawThinking) ? rawThinking : (() => { throw new Error('思考档位无效'); })())
      : (profiles[provider]?.thinking ?? DEFAULT_THINKING_LEVEL);
    if (inputKey && !/^[\x21-\x7e]{8,500}$/.test(inputKey)) throw new Error('API Key 格式无效');
    if (model && !/^[\w.:/@-]{1,120}$/.test(model)) throw new Error('模型名称格式无效');
    if (baseUrl && !/^https?:\/\/[^\s"'`]+$/.test(baseUrl)) throw new Error('接口地址需以 http:// 或 https:// 开头');
    if (provider === 'custom' && !baseUrl) throw new Error('自定义接口需要填写接口地址');
    const apiKeyValue = inputKey || profiles[provider]?.apiKey || '';
    if (!apiKeyValue) throw new Error('请填写 API Key');
    return { provider, apiKey: apiKeyValue, model, baseUrl, thinking };
  };
  // 后台预加载配图检查模型（首次会从 ModelScope 下载约 87MB），不阻塞服务启动。
  if (!options.service && xhsBridge.configured) void planner.warmPhotoInspector?.();
  const locatePlaces = options.mapService ?? createPlannerMapService({
    apiKey: options.amapApiKey ?? await readServerKey('AMAP_WEB_SERVICE_KEY'),
    tileUrl: await readServerKey('PLANNER_MAP_TILE_URL') || undefined,
    photonUrl: await readServerKey('PLANNER_GEOCODER_URL') || undefined,
    overpassUrl: await readServerKey('PLANNER_OVERPASS_URL') || undefined,
  });
  return async (request, response) => {
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    // 允许移动端 App（Capacitor）与局域网前端访问本机 AI 接口。
    const origin = request.headers.origin;
    const corsHeaders = origin && /^(capacitor:\/\/localhost|ionic:\/\/localhost|https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|[^/]+\.github\.io)(:\d+)?$)/i.test(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin',
        }
      : {};
    const sendJson = (status, value) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders,
      });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/planner/')) {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (url.pathname === '/api/planner/health' && request.method === 'GET') {
        const subList = await subscriptions.listSubscriptions(activeProvider);
        const discoveredMap = await subscriptions.getAllDiscoveredModels();
        return sendJson(200, {
          configured: ai.configured,
          model: ai.label,
          modelId: ai.model,
          models: activeModelsFor(subList, discoveredMap),
          label: ai.label,
          provider: activeProvider,
          authMode: isSubscriptionProvider(activeProvider) ? 'subscription' : 'api',
          thinking: ai.thinking ?? DEFAULT_THINKING_LEVEL,
          thinkingLevels: ai.thinkingLevels ?? ['off'],
          vision: ai.vision !== false,
          ...searchState(),
          saved: await savedList(subList, discoveredMap),
          subscriptions: subList,
        });
      }
      // 图片只按已保存的内容编号读取，绝不提供任意 URL 的开放代理。
      if (url.pathname.startsWith('/api/planner/photo-file/')) {
        if (request.method !== 'GET') return sendJson(405, { error: '请使用 GET' });
        const id = url.pathname.split('/').at(-1);
        if (!validPlannerPhotoId(id)) return sendJson(400, { error: '本地照片编号无效' });
        try {
          const bytes = await photoStore.read(id);
          response.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length,
            'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...corsHeaders });
          response.end(bytes);
        } catch { sendJson(404, { error: '本地照片不存在，请重新查找' }); }
        return;
      }
      if (url.pathname.startsWith('/api/planner/')) {
        if (request.method !== 'POST') return sendJson(405, { error: '请使用 POST' });
        if (!request.headers['content-type']?.startsWith('application/json'))
          return sendJson(415, { error: '请求必须为 JSON' });
        const route = url.pathname.split('/').at(-1);
        if (!['generate', 'recommendations', 'duration', 'chat', 'tickets', 'packing', 'transfers', 'booking-parse', 'booking-lookup', 'xhs-parse', 'photo', 'map', 'photo-settings', 'xhs-status', 'xhs-qrcode', 'ai-settings', 'ai-switch', 'ai-test', 'ai-models-refresh', 'ai-sub-login', 'ai-sub-status', 'ai-sub-code', 'ai-sub-cancel', 'ai-sub-logout', 'ai-sub-model', 'ai-sub-quota', 'ai-sub-gemini-auth', 'ai-sub-gemini-install'].includes(route))
          return sendJson(404, { error: '接口不存在' });
        const maxBodyBytes = route === 'xhs-parse' ? 20 * 1024 * 1024 : route === 'booking-parse' ? 8 * 1024 * 1024 : 3 * 1024 * 1024;
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > maxBodyBytes) return sendJson(413, { error: route === 'booking-parse' || route === 'xhs-parse' ? '截图内容过大，请减少张数或压缩后再试' : '计划内容过大' });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return sendJson(400, { error: 'JSON 格式无效' });
        }
        if (route === 'photo-settings') {
          if (body.imageSearchKey !== undefined) {
            if (typeof body.imageSearchKey !== 'string' || !/^[a-z\d_-]{10,500}$/i.test(body.imageSearchKey)) return sendJson(400, { error: '请输入有效的图片搜索 Key' });
            await (options.writePhotoSettings ?? writePhotoSettings)({ BRAVE_IMAGE_SEARCH_KEY: body.imageSearchKey });
            imageSearchKey = body.imageSearchKey;
            planner = makePlanner();
          }
          return sendJson(200, { imageSearchConfigured: Boolean(imageSearchKey), xhsConfigured: xhsBridge.configured });
        }
        if (route === 'ai-settings') {
          if (body.save !== true) return sendJson(200, await aiState());
          let next;
          try { next = readAiInput(body); } catch (error) { return sendJson(400, { error: error.message }); }
          await writeSettings({
            AI_PROVIDER: next.provider,
            [envName('AI_KEY', next.provider)]: next.apiKey,
            [envName('AI_MODEL', next.provider)]: next.model,
            [envName('AI_BASE_URL', next.provider)]: next.baseUrl,
            [envName('AI_THINKING', next.provider)]: next.thinking,
          });
          profiles[next.provider] = next;
          await activate(next.provider);
          // 保存 API Key 后后台尝试同步一次远端最新模型，不阻塞保存响应。
          void subscriptions
            .refreshRemoteModels(next.provider, {
              token: next.apiKey,
              baseUrl: next.baseUrl || AI_PROVIDERS[next.provider]?.baseUrl || '',
              isOAuth: false,
            })
            .catch(() => {});
          return sendJson(200, await aiState());
        }
        if (route === 'ai-switch') {
          const provider = String(body.provider ?? '');
          const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
          const requestedThinking = typeof body.thinking === 'string' ? body.thinking.trim() : '';
          if (requestedThinking && !THINKING_LEVELS.includes(requestedThinking)) {
            return sendJson(400, { error: '思考档位无效' });
          }
          if (isSubscriptionProvider(provider)) {
            if (!(await subscriptions.isConnected(provider)))
              return sendJson(400, { error: '该订阅尚未连接，请先完成登录授权' });
            if (requestedModel) {
              try { await subscriptions.setModel(provider, requestedModel); }
              catch (error) { return sendJson(400, { error: error.message }); }
            }
            if (requestedThinking) {
              try { await subscriptions.setThinking(provider, requestedThinking); }
              catch (error) { return sendJson(400, { error: error.message }); }
            }
            await writeSettings({ AI_PROVIDER: provider });
            await activate(provider);
            return sendJson(200, await aiState());
          }
          if (!profiles[provider]) return sendJson(400, { error: '该服务商还没有保存配置，请先填写 API Key' });
          const updates = { AI_PROVIDER: provider };
          if (requestedModel) {
            if (!/^[\w.:/@-]{1,120}$/.test(requestedModel)) return sendJson(400, { error: '模型名称格式无效' });
            profiles[provider] = { ...profiles[provider], model: requestedModel };
            updates[envName('AI_MODEL', provider)] = requestedModel;
          }
          if (requestedThinking) {
            profiles[provider] = { ...profiles[provider], thinking: requestedThinking };
            updates[envName('AI_THINKING', provider)] = requestedThinking;
          }
          await writeSettings(updates);
          await activate(provider);
          return sendJson(200, await aiState());
        }
        if (route === 'ai-test') {
          let client;
          const requestedThinking = typeof body.thinking === 'string' && THINKING_LEVELS.includes(body.thinking.trim())
            ? body.thinking.trim()
            : '';
          if (isSubscriptionProvider(String(body.provider ?? ''))) {
            const subId = String(body.provider);
            const testModel = typeof body.model === 'string' ? body.model.trim() : '';
            if (testModel && !/^[\w.:/@-]{1,120}$/.test(testModel)) return sendJson(400, { error: '模型名称格式无效' });
            client = await subscriptions.createClient(subId, testModel, requestedThinking);
            if (!client.configured) return sendJson(400, { error: '该订阅尚未连接，请先完成登录授权' });
          } else {
            let next;
            try { next = readAiInput(body); } catch (error) { return sendJson(400, { error: error.message }); }
            const discoveredMap = await subscriptions.getAllDiscoveredModels();
            client = createAiClient({ ...next, remoteModelIds: discoveredMap[next.provider] ?? [] });
          }
          const started = Date.now();
          try {
            // 测试连接与响应速度：默认按当前所选档位测真实速度（传 fast=true 时测极速档）。
            const answer = await client.chat({
              messages: [{ role: 'user', content: '连接与测速：只返回 json {"ok":true}' }],
              maxTokens: 512,
              json: true,
              fast: body.fast === true,
              thinking: requestedThinking || undefined,
              signal: controller.signal,
              timeout: 45000,
            });
            const seconds = Math.round((Date.now() - started) / 100) / 10;
            return sendJson(200, {
              ok: Boolean(answer.text.trim()),
              label: client.label,
              seconds,
              speedTier: classifySpeedTier(seconds),
              thinkingUsed: answer.thinkingUsed ?? client.thinking,
              vision: client.vision !== false,
            });
          } catch (error) {
            const seconds = Math.round((Date.now() - started) / 100) / 10;
            return sendJson(200, {
              ok: false,
              label: client.label,
              seconds,
              speedTier: classifySpeedTier(seconds),
              error: error.message,
            });
          }
        }
        if (route === 'ai-models-refresh') {
          const target = String(body.provider ?? '');
          if (isSubscriptionProvider(target)) {
            const refreshed = await subscriptions.refreshRemoteModels(target, { signal: controller.signal });
            return sendJson(200, { count: refreshed.count, state: await aiState() });
          }
          if (!AI_PROVIDERS[target]) return sendJson(400, { error: '不支持的服务商' });
          const prof = profiles[target];
          const inputKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
          const inputBase = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
          const token = inputKey || prof?.apiKey || '';
          const baseUrl = inputBase || prof?.baseUrl || AI_PROVIDERS[target].baseUrl || '';
          const refreshed = await subscriptions.refreshRemoteModels(target, {
            token,
            baseUrl,
            isOAuth: false,
            signal: controller.signal,
          });
          return sendJson(200, { count: refreshed.count, state: await aiState() });
        }
        if (route === 'ai-sub-login') {
          try {
            const session = await subscriptions.startLogin(String(body.provider ?? ''), {
              onConnected: onSubscriptionConnected,
              force: body.force !== false,
              method: typeof body.method === 'string' ? body.method : '',
            });
            return sendJson(200, { session, state: await aiState() });
          } catch (error) {
            return sendJson(400, { error: error.message });
          }
        }
        if (route === 'ai-sub-status') {
          try {
            const session = await subscriptions.getLoginStatus(String(body.provider ?? ''), { onConnected: onSubscriptionConnected });
            return sendJson(200, { session, state: await aiState() });
          } catch (error) {
            return sendJson(400, { error: error.message });
          }
        }
        if (route === 'ai-sub-code') {
          try {
            const session = subscriptions.submitManualCode(String(body.provider ?? ''), body.code);
            return sendJson(200, { session, state: await aiState() });
          } catch (error) {
            return sendJson(400, { error: error.message });
          }
        }
        if (route === 'ai-sub-cancel') {
          await subscriptions.cancelLogin(String(body.provider ?? ''));
          return sendJson(200, { ok: true });
        }
        if (route === 'ai-sub-logout') {
          const target = String(body.provider ?? '');
          try { await subscriptions.logout(target); }
          catch (error) { return sendJson(400, { error: error.message }); }
          if (activeProvider === target || activeProvider === `sub:${target}`) {
            const remainingSubs = (await subscriptions.listSubscriptions('')).find((item) => item.connected);
            const fallback = remainingSubs?.id ?? Object.keys(profiles)[0] ?? 'deepseek';
            await writeSettings({ AI_PROVIDER: fallback });
            await activate(fallback);
          }
          return sendJson(200, await aiState());
        }
        if (route === 'ai-sub-model') {
          const target = String(body.provider ?? '');
          if (typeof body.model === 'string' && body.model.trim()) {
            try { await subscriptions.setModel(target, body.model); }
            catch (error) { return sendJson(400, { error: error.message }); }
          }
          if (typeof body.thinking === 'string' && body.thinking.trim()) {
            try { await subscriptions.setThinking(target, body.thinking); }
            catch (error) { return sendJson(400, { error: error.message }); }
          }
          const normalized = target.startsWith('sub:') ? target : `sub:${target}`;
          if (body.activate === true && (await subscriptions.isConnected(normalized))) {
            await writeSettings({ AI_PROVIDER: normalized });
            await activate(normalized);
          } else if (activeProvider === normalized) {
            await activate(normalized);
          }
          return sendJson(200, await aiState());
        }
        if (route === 'ai-sub-quota') {
          try {
            const quota = await subscriptions.fetchQuota(String(body.provider ?? ''), { force: body.force === true });
            return sendJson(200, { quota });
          } catch (error) {
            return sendJson(400, { error: error.message });
          }
        }
        if (route === 'ai-sub-gemini-auth') {
          try { return sendJson(200, await subscriptions.launchGeminiAuthTerminal()); }
          catch (error) { return sendJson(400, { error: error.message }); }
        }
        if (route === 'ai-sub-gemini-install') {
          try { return sendJson(200, await subscriptions.installGeminiCli()); }
          catch (error) { return sendJson(400, { error: error.message }); }
        }
        if (route === 'xhs-status') return sendJson(200, await xhsBridge.status(controller.signal, { fresh: body.fresh === true }));
        if (route === 'xhs-qrcode') {
          try { return sendJson(200, await xhsBridge.qrcode(controller.signal)); }
          catch (error) { return sendJson(503, { error: error.message }); }
        }
        if (route === 'photo') {
          if (
            typeof body.title !== 'string' ||
            body.title.length > 150 ||
            typeof body.city !== 'string' || body.city.length > 150 ||
            (body.date !== undefined && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)))
          )
            return sendJson(400, { error: '图片查询无效' });
          const diagnostics = [];
          const photoCity = plannerPhotoCityName(body.city);
          const photoPlace = plannerPhotoPlaceName(body.title);
          const queryLabel = photoCity && photoPlace && !photoPlace.startsWith(photoCity)
            ? `${photoCity} · ${photoPlace}`
            : (photoPlace || photoCity);
          // 新网页主动选择流式进度；保留 JSON 响应兼容已有脚本和调用方。
          const streaming = body.stream === true;
          const emitPhoto = (event) => {
            if (streaming && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
          };
          if (streaming) {
            response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...corsHeaders });
            emitPhoto({ type: 'progress', stage: '正在查找小红书实拍照片' });
          }
          const heartbeat = streaming ? setInterval(() => emitPhoto({ type: 'heartbeat' }), 10000) : null;
          try {
            const photo = await planner.photoFor(body.title, body.city, controller.signal, true,
              (message) => { diagnostics.push(message); emitPhoto({ type: 'progress', stage: message }); },
              { date: body.date, onProgress: (stage) => emitPhoto({ type: 'progress', stage }) });
            const result = { photo, message: [...new Set(diagnostics)].join('；'), queryLabel };
            if (!streaming) return sendJson(200, result);
            emitPhoto({ type: 'result', result });
          } catch (error) {
            if (!streaming) throw error;
            if (!controller.signal.aborted) emitPhoto({ type: 'error', error: error.message || '图片查找失败，请重试' });
          } finally {
            if (heartbeat) clearInterval(heartbeat);
            if (streaming) response.end();
          }
          return;
        }
        // NDJSON reports real stages. Closing the response aborts upstream work.
        response.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...corsHeaders,
        });
        const emit = (event) => {
          if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`);
        };
        const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 15000);
        try {
          const handler = route === 'map'
            ? locatePlaces
            : route === 'booking-parse'
              ? planner.parseBooking
              : route === 'booking-lookup'
                ? planner.lookupBooking
                : route === 'xhs-parse'
                  ? planner.parseXhs
                  : planner[route];
          const result = await handler(body, controller.signal, (stage) =>
            emit({ type: 'progress', stage }),
          );
          emit({ type: 'result', result });
        } catch (error) {
          if (!controller.signal.aborted)
            emit({ type: 'error', error: plannerDisplayText(error.message || '规划请求失败，请重试') });
        } finally {
          clearInterval(heartbeat);
          response.end();
        }
        return;
      }
      if (!options.production || !['GET', 'HEAD'].includes(request.method))
        return sendJson(404, { error: '页面不存在' });
      const distRoot = options.distRoot ? path.resolve(options.distRoot) : getDistDir();
      const requestedPath = decodeURIComponent(url.pathname);
      let filename = path.resolve(
        distRoot,
        `.${requestedPath === '/' ? '/index.html' : requestedPath}`,
      );
      if (!filename.startsWith(`${distRoot}${path.sep}`))
        return sendJson(403, { error: '路径无效' });
      try {
        if (!(await stat(filename)).isFile()) filename = path.join(distRoot, 'index.html');
      } catch {
        if (path.extname(filename)) return sendJson(404, { error: '资源不存在' });
        filename = path.join(distRoot, 'index.html');
      }
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
      };
      response.writeHead(200, {
        'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream',
        'Cache-Control':
          filename.endsWith('sw.js') || filename.endsWith('index.html')
            ? 'no-cache'
            : 'public, max-age=3600',
      });
      response.end(request.method === 'HEAD' ? undefined : await readFile(filename));
    } catch {
      if (!response.headersSent) sendJson(500, { error: '本地服务处理失败，请重试' });
      else response.end();
    }
  };
}

export async function createPlannerServer(options = {}) {
  return http.createServer(await createPlannerRequestHandler(options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const production = process.argv.includes('--production');
  const server = await createPlannerServer({ production });
  const port = Number(process.env.ZHOUYOU_PORT) || (production ? 4173 : 8787);
  const host = process.env.ZHOUYOU_HOST || '0.0.0.0';
  server.listen(port, host, () =>
    process.stdout.write(`旅行服务：http://127.0.0.1:${port}（其他设备用本机 IP 访问）\n`),
  );
  server.on('error', (error) => {
    process.stderr.write(`服务启动失败：${error.code}\n`);
    process.exitCode = 1;
  });
}
