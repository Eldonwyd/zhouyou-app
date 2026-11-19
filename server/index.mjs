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
import { createWebSearch, SEARCH_KIND } from './web-search.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read the ignored server environment; credentials never enter public config. */
export async function readServerKey(name = 'DEEPSEEK_API_KEY') {
  if (!/^[A-Z_]+$/.test(name)) throw new Error('服务配置名称无效');
  if (process.env[name]) return process.env[name];
  try {
    const env = await readFile(path.join(webRoot, '.env.local'), 'utf8');
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
  // AI 服务可保存多套（每个服务商一套 Key/模型/地址），页面里随时切换。
  // 旧配置兼容：AI_API_KEY/AI_MODEL/AI_BASE_URL 属于 AI_PROVIDER；DEEPSEEK_API_KEY 属于 DeepSeek。
  const envName = (prefix, provider) => `${prefix}_${provider.toUpperCase()}`;
  const envProvider = await readServerKey('AI_PROVIDER');
  let activeProvider = AI_PROVIDERS[envProvider] ? envProvider : 'deepseek';
  const profiles = {};
  for (const provider of Object.keys(AI_PROVIDERS)) {
    const profile = {
      provider,
      apiKey: await readServerKey(envName('AI_KEY', provider)),
      model: await readServerKey(envName('AI_MODEL', provider)),
      baseUrl: await readServerKey(envName('AI_BASE_URL', provider)),
    };
    if (provider === activeProvider && !profile.apiKey) {
      profile.apiKey = await readServerKey('AI_API_KEY');
      profile.model ||= await readServerKey('AI_MODEL');
      profile.baseUrl ||= await readServerKey('AI_BASE_URL');
    }
    if (provider === 'deepseek' && !profile.apiKey) profile.apiKey = apiKey;
    if (profile.apiKey) profiles[provider] = profile;
  }
  const aiConfig = () => profiles[activeProvider] ?? { provider: activeProvider, apiKey: '', model: '', baseUrl: '' };
  /** 联网检索：优先用当前服务商自己的搜索；当前服务商没有（如 Kimi）时借用已保存的、能联网的服务商。 */
  const searchOrder = ['direct', 'citation'];
  const pickSearch = () => {
    if (options.webSearch) return options.webSearch;
    const own = createWebSearch(aiConfig());
    if (own.available) return own;
    for (const kind of searchOrder)
      for (const profile of Object.values(profiles))
        if (SEARCH_KIND[profile.provider] === kind) return createWebSearch(profile);
    return own;
  };
  let ai = createAiClient(aiConfig());
  let web = pickSearch();
  /** 图片识别模型：优先用当前服务商；当前为纯文本模型（如 DeepSeek）时自动借用其他已保存的多模态服务商。 */
  const pickVisionAi = () => {
    if (ai.configured && ai.vision) return ai;
    for (const profile of Object.values(profiles)) {
      const candidate = createAiClient(profile);
      if (candidate.configured && candidate.vision) return candidate;
    }
    return ai;
  };
  const makePlanner = () => options.service ?? createPlannerService({ apiKey, ai, visionAi: pickVisionAi(), localOcr, webSearch: web, photoStore, imageSearchKey, xhsBridge, photoInspector });
  let planner = makePlanner();
  const activate = (provider) => {
    activeProvider = provider;
    ai = createAiClient(aiConfig());
    web = pickSearch();
    planner = makePlanner();
  };
  const searchState = () => ({
    searchAvailable: web.available,
    searchLabel: !web.available ? '' : web.provider === activeProvider ? `${web.label} 联网` : `借用 ${web.label} 联网`,
  });
  const savedList = () => Object.values(profiles).map((profile) => {
    const client = createAiClient(profile);
    return { id: profile.provider, label: AI_PROVIDERS[profile.provider].label, model: client.model, search: SEARCH_KIND[profile.provider] };
  });
  const aiState = () => ({
    provider: activeProvider, model: ai.model, baseUrl: ai.baseUrl, label: ai.label,
    keyConfigured: Boolean(aiConfig().apiKey), configured: ai.configured, ...searchState(),
    saved: savedList(), providers: publicProviderList(),
  });
  /** 页面提交的配置：Key 留空表示沿用该服务商已保存的 Key（不回传密钥内容）。 */
  const readAiInput = (body) => {
    const provider = String(body.provider ?? '');
    if (!AI_PROVIDERS[provider]) throw new Error('请选择支持的 AI 服务商');
    const inputKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '';
    if (inputKey && !/^[\x21-\x7e]{8,500}$/.test(inputKey)) throw new Error('API Key 格式无效');
    if (model && !/^[\w.:/@-]{1,120}$/.test(model)) throw new Error('模型名称格式无效');
    if (baseUrl && !/^https?:\/\/[^\s"'`]+$/.test(baseUrl)) throw new Error('接口地址需以 http:// 或 https:// 开头');
    if (provider === 'custom' && !baseUrl) throw new Error('自定义接口需要填写接口地址');
    const apiKeyValue = inputKey || profiles[provider]?.apiKey || '';
    if (!apiKeyValue) throw new Error('请填写 API Key');
    return { provider, apiKey: apiKeyValue, model, baseUrl };
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
    const sendJson = (status, value) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/planner/health' && request.method === 'GET')
        return sendJson(200, { configured: ai.configured, model: ai.label, provider: activeProvider, ...searchState(), saved: savedList() });
      // 图片只按已保存的内容编号读取，绝不提供任意 URL 的开放代理。
      if (url.pathname.startsWith('/api/planner/photo-file/')) {
        if (request.method !== 'GET') return sendJson(405, { error: '请使用 GET' });
        const id = url.pathname.split('/').at(-1);
        if (!validPlannerPhotoId(id)) return sendJson(400, { error: '本地照片编号无效' });
        try {
          const bytes = await photoStore.read(id);
          response.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length,
            'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
          response.end(bytes);
        } catch { sendJson(404, { error: '本地照片不存在，请重新查找' }); }
        return;
      }
      if (url.pathname.startsWith('/api/planner/')) {
        if (request.method !== 'POST') return sendJson(405, { error: '请使用 POST' });
        if (!request.headers['content-type']?.startsWith('application/json'))
          return sendJson(415, { error: '请求必须为 JSON' });
        const route = url.pathname.split('/').at(-1);
        if (!['generate', 'recommendations', 'duration', 'chat', 'tickets', 'packing', 'transfers', 'booking-parse', 'booking-lookup', 'xhs-parse', 'photo', 'map', 'photo-settings', 'xhs-status', 'xhs-qrcode', 'ai-settings', 'ai-switch', 'ai-test'].includes(route))
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
          if (body.save !== true) return sendJson(200, aiState());
          let next;
          try { next = readAiInput(body); } catch (error) { return sendJson(400, { error: error.message }); }
          await (options.writeAiSettings ?? writeAiSettings)({
            AI_PROVIDER: next.provider,
            [envName('AI_KEY', next.provider)]: next.apiKey,
            [envName('AI_MODEL', next.provider)]: next.model,
            [envName('AI_BASE_URL', next.provider)]: next.baseUrl,
          });
          profiles[next.provider] = next;
          activate(next.provider);
          return sendJson(200, aiState());
        }
        if (route === 'ai-switch') {
          const provider = String(body.provider ?? '');
          if (!profiles[provider]) return sendJson(400, { error: '该服务商还没有保存配置，请先填写 API Key' });
          await (options.writeAiSettings ?? writeAiSettings)({ AI_PROVIDER: provider });
          activate(provider);
          return sendJson(200, aiState());
        }
        if (route === 'ai-test') {
          let next;
          try { next = readAiInput(body); } catch (error) { return sendJson(400, { error: error.message }); }
          const client = createAiClient(next);
          const started = Date.now();
          try {
            const answer = await client.chat({ messages: [{ role: 'user', content: '连接测试：只返回 json {"ok":true}' }], maxTokens: 1024, json: true, signal: controller.signal, timeout: 30000 });
            return sendJson(200, { ok: Boolean(answer.text.trim()), label: client.label, seconds: Math.round((Date.now() - started) / 100) / 10 });
          } catch (error) {
            return sendJson(200, { ok: false, label: client.label, error: error.message });
          }
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
          const queryLabel = `${plannerPhotoCityName(body.city)} · ${plannerPhotoPlaceName(body.title)}`;
          // 新网页主动选择流式进度；保留 JSON 响应兼容已有脚本和调用方。
          const streaming = body.stream === true;
          const emitPhoto = (event) => {
            if (streaming && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
          };
          if (streaming) {
            response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
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
      const distRoot = path.join(webRoot, 'dist');
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
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
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
  const port = production ? 4173 : 8787;
  server.listen(port, '0.0.0.0', () =>
    process.stdout.write(`旅行服务：http://127.0.0.1:${port}（其他设备用本机 IP 访问）\n`),
  );
  server.on('error', (error) => {
    process.stderr.write(`服务启动失败：${error.code}\n`);
    process.exitCode = 1;
  });
}
