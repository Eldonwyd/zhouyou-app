import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { createSubscriptionManager } from '../server/ai-subscriptions.mjs';
import { createPlannerServer } from '../server/index.mjs';
import { createPlannerService } from '../server/planner-service.mjs';

const tempAuthFile = path.join(os.tmpdir(), `zhouyou-ai-sub-test-${Date.now()}.json`);
const writtenEnv = {};

try {
  let geminiProbeState = { installed: true, binary: 'gemini', loggedIn: true, accountEmail: 'traveler@gmail.com' };
  const manager = await createSubscriptionManager({
    authFile: tempAuthFile,
    probeGeminiCli: async () => geminiProbeState,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('api.anthropic.com/api/oauth/usage')) {
        return Response.json({
          five_hour: { utilization: 20, resets_at: '2026-11-24T01:00:00Z' },
          seven_day: { utilization: 32, resets_at: '2026-11-30T00:00:00Z' },
        });
      }
      if (target.includes('api.openai.com/v1/models')) {
        return Response.json({
          data: [{ id: 'gpt-7.0-nova' }, { id: 'gpt-6.2-sol' }, { id: 'text-embedding-3-large' }],
        });
      }
      if (target.includes('api.anthropic.com/v1/models')) {
        return Response.json({
          data: [{ id: 'claude-fable-6-0' }, { id: 'claude-opus-5-5' }],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });

  // 1. 最新模型自动排在最前面（GPT-6.2、Claude Opus 5.5 / Sonnet 5.5 / Fable 5.2、Kimi K3.1、Gemini 4 Neon）。
  const initial = await manager.listSubscriptions('');
  assert.deepEqual(initial.map((item) => item.id), ['sub:chatgpt', 'sub:claude', 'sub:kimi', 'sub:gemini']);
  const chatgpt = initial.find((item) => item.key === 'chatgpt');
  const claude = initial.find((item) => item.key === 'claude');
  const kimi = initial.find((item) => item.key === 'kimi');
  const gemini = initial.find((item) => item.key === 'gemini');
  assert.equal(chatgpt.defaultModel, 'gpt-6.2-sol');
  assert.ok(chatgpt.models.slice(0, 3).some((m) => m.id === 'gpt-6.2-sol'));
  assert.ok(claude.models.slice(0, 5).some((m) => m.id === 'claude-opus-5-5'));
  assert.ok(claude.models.slice(0, 5).some((m) => m.id === 'claude-fable-5-2'));
  assert.equal(kimi.defaultModel, 'k3.1-pro-highspeed');
  assert.equal(gemini.defaultModel, 'gemini-4-neon');

  // 2. 注入模拟 OAuth 凭据。
  await manager._store.credentialStore.modify('openai', async () => ({
    type: 'oauth',
    access: 'mock-chatgpt-token',
    refresh: 'mock-chatgpt-refresh',
    expires: Date.now() + 3600_000,
    clientId: 'mock-client',
    scopes: ['chatgpt.tokens.use.direct'],
  }));
  await manager._store.credentialStore.modify('anthropic', async () => ({
    type: 'oauth',
    access: 'sk-ant-oat-mock-token',
    refresh: 'mock-claude-refresh',
    expires: Date.now() + 3600_000,
  }));
  await manager._store.credentialStore.modify('kimi-coding', async () => ({
    type: 'oauth',
    access: 'mock-kimi-token',
    refresh: 'mock-kimi-refresh',
    expires: Date.now() + 3600_000,
  }));

  const server = await createPlannerServer({
    apiKey: 'sk-test-deepseek-key-123456',
    subscriptions: manager,
    writeAiSettings: async (values) => {
      Object.assign(writtenEnv, values);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body = {}) => {
      const res = await fetch(`${origin}/api/planner/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, data: await res.json() };
    };

    // 3. 动态拉取远端新模型（不写死）：模拟厂商发布了 gpt-7.0-nova 与 claude-fable-6-0，刷新后立即排第一位且过滤掉 embedding。
    const refreshedOpenAI = await post('ai-models-refresh', { provider: 'sub:chatgpt' });
    assert.equal(refreshedOpenAI.status, 200);
    assert.equal(refreshedOpenAI.data.count, 3);
    const updatedChatgpt = refreshedOpenAI.data.state.subscriptions.find((s) => s.id === 'sub:chatgpt');
    assert.equal(updatedChatgpt.models[0].id, 'gpt-7.0-nova');
    assert.equal(updatedChatgpt.models.some((m) => m.id.includes('embedding')), false);

    const refreshedClaude = await post('ai-models-refresh', { provider: 'sub:claude' });
    const updatedClaude = refreshedClaude.data.state.subscriptions.find((s) => s.id === 'sub:claude');
    assert.equal(updatedClaude.models[0].id, 'claude-fable-6-0');

    // 4. 切换模型与思考档位（并验证自动裁剪到模型支持范围）。
    const switched = await post('ai-switch', { provider: 'sub:claude', model: 'claude-opus-5-5', thinking: 'high' });
    assert.equal(switched.status, 200);
    assert.equal(switched.data.provider, 'sub:claude');
    assert.equal(switched.data.model, 'claude-opus-5-5');
    assert.equal(switched.data.thinking, 'high');
    assert.ok(switched.data.thinkingLevels.includes('xhigh'));

    // 切到 claude-fable-5-2 并设极轻思考档位
    const fable = await post('ai-sub-model', {
      provider: 'sub:claude',
      model: 'claude-fable-5-2',
      thinking: 'minimal',
      activate: true,
    });
    assert.equal(fable.status, 200);
    assert.equal(fable.data.model, 'claude-fable-5-2');
    assert.equal(fable.data.thinking, 'minimal');

    // 5. Gemini CLI 一键连接 + 额度查询验证。
    const geminiLogin = await post('ai-sub-login', { provider: 'sub:gemini' });
    assert.equal(geminiLogin.data.session.status, 'connected');
    assert.equal(geminiLogin.data.state.provider, 'sub:gemini');
    assert.equal(geminiLogin.data.state.vision, false);

    const chatgptQuota = await post('ai-sub-quota', { provider: 'sub:chatgpt' });
    assert.equal(chatgptQuota.data.quota.status, 'unavailable');
    assert.match(chatgptQuota.data.quota.note, /OpenAI 暂未提供本应用剩余额度的查询接口/);

    const claudeQuota = await post('ai-sub-quota', { provider: 'sub:claude', force: true });
    assert.equal(claudeQuota.data.quota.status, 'ok');
    assert.equal(claudeQuota.data.quota.remainingPercent, 68);

    // 6. Kimi Code 切换模型 + 借用 DeepSeek 联网 + 断开自动回退。
    const kimiModel = await post('ai-sub-model', {
      provider: 'sub:kimi',
      model: 'k3.1-pro-highspeed',
      thinking: 'low',
      activate: true,
    });
    assert.equal(kimiModel.status, 200);
    assert.equal(kimiModel.data.searchAvailable, true);
    assert.match(kimiModel.data.searchLabel, /借用 DeepSeek/);

    const afterLogout = await post('ai-sub-logout', { provider: 'sub:kimi' });
    assert.equal(afterLogout.status, 200);
    assert.notEqual(afterLogout.data.provider, 'sub:kimi');

    // 7. API 提供商也具备最新模型列表与思考档位持久化，health 接口同步返回当前模型目录。
    const backToApi = await post('ai-switch', { provider: 'deepseek', model: 'deepseek-flash', thinking: 'off' });
    assert.equal(backToApi.status, 200);
    assert.equal(backToApi.data.provider, 'deepseek');
    assert.equal(backToApi.data.thinking, 'off');
    assert.equal(writtenEnv.AI_THINKING_DEEPSEEK, 'off');
    const healthRes = await fetch(`${origin}/api/planner/health`);
    const health = await healthRes.json();
    assert.equal(health.modelId, 'deepseek-flash');
    assert.ok(Array.isArray(health.models) && health.models.some((m) => m.id === 'deepseek-flash'));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  // 8. 非看图模型兼容性验证：纯文本模型解析小红书截图时自动走本机 OCR，不再报错！
  let ocrCalls = 0;
  let receivedFastFlag = false;
  const textOnlyAi = {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    label: 'DeepSeek · deepseek-v4-pro',
    configured: true,
    vision: false,
    async chat(opts) {
      receivedFastFlag = Boolean(opts.fast);
      const userContent = opts.messages[0].content;
      assert.equal(typeof userContent, 'string', 'text-only model must never receive raw image blocks');
      assert.ok(userContent.includes('翠湖公园'), 'OCR extracted text must be passed to text-only model');
      return {
        text: JSON.stringify({
          title: '昆明半日漫游攻略',
          destinations: ['昆明'],
          suggestedDays: 1,
          styleTags: ['慢节奏'],
          routeOutline: ['D1：翠湖公园→文化巷'],
          tips: ['上午光线好'],
          places: [{ name: '翠湖公园', canonicalName: '翠湖公园', city: '昆明', kind: 'sight', dayHint: 1, note: '免费入园' }],
        }),
        truncated: false,
      };
    },
  };
  const service = createPlannerService({
    ai: textOnlyAi,
    visionAi: textOnlyAi,
    localOcr: {
      async recognize() {
        ocrCalls++;
        return { text: '昆明必去：翠湖公园看海鸥，中午去文化巷喝咖啡。' };
      },
    },
  });
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+V0wAAAAASUVORK5CYII=';
  const xhsResult = await service.parseXhs(
    { images: [`data:image/png;base64,${tinyPngBase64}`] },
    new AbortController().signal,
    () => {},
  );
  assert.equal(ocrCalls, 1, 'local OCR must run automatically for text-only model on XHS screenshots');
  assert.equal(receivedFastFlag, true, 'extraction call should use fast thinking path');
  assert.equal(xhsResult.reference.places[0].name, '翠湖公园');
  assert.ok(xhsResult.warnings.some((w) => w.includes('本机离线 OCR')));

  // 9. 运行时视觉拒收兜底：即使模型声称支持看图但接口拒收图片，parseBooking 也会自动降级到本机 OCR！
  let bookingOcrCalls = 0;
  const flakyVisionAi = {
    provider: 'custom',
    model: 'custom-text-model',
    label: '自定义模型',
    configured: true,
    vision: true,
    async chat(opts) {
      if (Array.isArray(opts.messages[0].content)) {
        throw new Error('This model does not support image_url multimodal inputs');
      }
      return {
        text: JSON.stringify({
          bookings: [{ kind: 'train', title: 'G1234 昆明→大理', code: 'G1234', date: '2026-12-01', startTime: '09:00', endTime: '11:00', fromLocation: '昆明站', toLocation: '大理站', city: '大理', amountYuan: 145 }],
        }),
        truncated: false,
      };
    },
  };
  const bookingService = createPlannerService({
    ai: flakyVisionAi,
    visionAi: flakyVisionAi,
    localOcr: {
      async recognize() {
        bookingOcrCalls++;
        return { text: 'G1234 2026-12-01 09:00 昆明站 -> 11:00 大理站 ¥145' };
      },
    },
  });
  const bookingResult = await bookingService.parseBooking(
    { imageDataUrl: `data:image/png;base64,${tinyPngBase64}` },
    new AbortController().signal,
    () => {},
  );
  assert.equal(bookingOcrCalls, 1, 'runtime vision rejection must seamlessly fall back to local OCR');
  assert.equal(bookingResult.bookings[0].code, 'G1234');

  process.stdout.write('Latest dynamic models, remote refresh, thinking levels, speed path & OCR non-vision fallback: OK\n');
} finally {
  await rm(tempAuthFile, { force: true }).catch(() => {});
}
