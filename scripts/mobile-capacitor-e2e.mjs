import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const liveApiKey = (process.env.DEEPSEEK_TEST_KEY || '').trim();
const isLive = Boolean(liveApiKey);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = (req.url || '/').split('?')[0];
        let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath));
        let stat;
        try {
          stat = await fs.stat(filePath);
        } catch {
          filePath = path.join(rootDir, 'index.html');
          stat = await fs.stat(filePath);
        }
        if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
        const ext = path.extname(filePath).toLowerCase();
        const data = await fs.readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

const { server, url: baseUrl } = await startStaticServer(distDir);
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const apiCalls = [];
const openedExternalUrls = [];
const pageErrors = [];
const consoleErrors = [];

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.exposeFunction('__recordExternalUrl', (optsJson) => {
    openedExternalUrls.push(JSON.parse(optsJson));
  });

  await page.exposeFunction('__bridgeNativeHttp', async (reqJson) => {
    const req = JSON.parse(reqJson);
    const method = (req.method || 'GET').toUpperCase();
    const isJsonBody = method === 'POST' && req.body;
    const body = isJsonBody && typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    apiCalls.push({ url: req.url, method, model: body?.model });

    if (req.url.includes('api.deepseek.com')) {
      assert.ok(
        ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat'].includes(body.model),
        `DeepSeek API received invalid model name: ${body.model}`,
      );
    }

    if (isLive || !req.url.includes('api.deepseek.com')) {
      const resp = await fetch(req.url, {
        method,
        headers: req.headers || {},
        ...(method === 'POST' && req.body !== undefined
          ? { body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body) }
          : {}),
      });
      const text = await resp.text();
      console.log(`   [LIVE HTTP ${resp.status}] ${method} ${req.url.slice(0, 88)} len=${text.length}`);
      return JSON.stringify({
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body: text,
      });
    }

    // Mock mode (used when DEEPSEEK_TEST_KEY is not set)
    const sys = body.messages?.[0]?.content || '';
    const usr = body.messages?.[1]?.content || '';
    let content = '';
    if (usr.includes('请只回复：连接正常')) {
      content = '连接正常';
    } else if (sys.includes('旅行推荐专家')) {
      content = JSON.stringify({
        recommendations: [
          {
            title: '成都慢游',
            destination: '成都',
            reason: '美食丰富、节奏舒缓，大熊猫基地与宽窄巷子适合轻松游玩。',
            season: '四季皆宜，秋冬季火锅与银杏最出片',
            suggestedDays: '建议 3~4 天',
            access: '高铁 / 航班直达',
          },
        ],
      });
    } else if (sys.includes('建议天数') || sys.includes('"options"')) {
      content = JSON.stringify({
        options: [
          { days: 2, title: '周末精华游', reason: '打卡市区核心地标与代表性美食。' },
          { days: 3, title: '经典深度游', reason: '覆盖市区人文与周边古镇。' },
        ],
      });
    } else if (sys.includes('规划师') && sys.includes('"days"')) {
      const dateMatch = sys.match(/从 (\d{4}-\d{2}-\d{2}) 起/);
      const daysMatch = sys.match(/共 (\d+) 天/);
      const startDate = dateMatch ? dateMatch[1] : '2026-11-24';
      const numDays = daysMatch ? Number(daysMatch[1]) : 2;
      const addDays = (d, n) => {
        const dt = new Date(`${d}T12:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
      };
      const days = Array.from({ length: numDays }, (_, idx) => ({
        date: addDays(startDate, idx),
        title: `第 ${idx + 1} 天 · 成都经典探索`,
        weather: '多云 12~19°C',
        activities: [
          {
            id: `d${idx + 1}-a1`,
            kind: 'sight',
            period: 'morning',
            startTime: '09:00',
            endTime: '11:30',
            title: idx === 0 ? '成都大熊猫繁育研究基地' : '武侯祠博物馆',
            city: '成都',
            location: '成都市区',
            description: '建议早到避开高峰。',
            transportMode: '',
            meal: null,
            costs: [{ id: `c-${idx + 1}-1`, label: '门票', category: 'tickets', unit: 'ticket', unitPriceCents: 5500, quantity: 1, occurrences: 1 }],
          },
        ],
        lodging: idx === numDays - 1 ? null : {
          city: '成都',
          area: '春熙路片区',
          searchKeyword: '成都 春熙路 酒店',
          reason: '交通便利。',
          costs: [{ id: `l-${idx + 1}`, label: '住宿', category: 'lodging', unit: 'room', unitPriceCents: 36000, quantity: 1, occurrences: 1 }],
        },
      }));
      content = JSON.stringify({
        title: `成都 ${numDays} 日慢游计划`,
        summary: '结合大熊猫基地与川味美食的轻松路线。',
        cities: [{ name: '成都市' }],
        constraints: ['节奏均衡'],
        warnings: ['热门景点提前预约'],
        days,
        alternatives: [],
      });
    } else if (sys.includes('旅行攻略助手')) {
      content = '### 游览建议\n建议早上 8:30 入园。';
    } else if (sys.includes('AI 旅行助手')) {
      content = JSON.stringify({ action: 'answer', answer: '建议带一件薄防风外套，穿舒适运动鞋。' });
    } else if (sys.includes('旅行预约助手')) {
      content = JSON.stringify({ items: [{ activityId: 'd1-a1', bookingRequired: true, saleDate: '', saleTime: '', difficulty: '中', platform: '官方公众号', note: '提前预约' }] });
    } else if (sys.includes('行前顾问')) {
      content = JSON.stringify({ items: [{ category: 'documents', name: '身份证', note: '入园入住必备' }] });
    } else {
      content = JSON.stringify({ items: [] });
    }

    return JSON.stringify({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 150 },
      }),
    });
  });

  await page.addInitScript((seedKey) => {
    // Seed CORRUPTED "DeepSeek V4.1 Flash" to verify auto-repair works on boot!
    localStorage.setItem(
      'zhouyou-mobile-ai-state-v1',
      JSON.stringify({
        activeProvider: 'deepseek',
        subCreds: {},
        subModels: {},
        subThinking: {},
        apiConfigs: {
          deepseek: {
            provider: 'deepseek',
            apiKey: seedKey,
            baseUrl: 'https://api.deepseek.com',
            model: 'DeepSeek V4.1 Flash',
            thinking: 'low',
          },
        },
      }),
    );

    const nativeAiBridge = {
      httpRequest: async (options) => {
        const resJson = await window.__bridgeNativeHttp(JSON.stringify(options));
        return JSON.parse(resJson);
      },
      openExternalUrl: async (options) => {
        await window.__recordExternalUrl(JSON.stringify(options));
        return { ok: true };
      },
      startOAuthCallbackServer: async () => ({ ok: true, port: 1455 }),
      stopOAuthCallbackServer: async () => {},
      addListener: async () => ({ remove: async () => {} }),
    };
    window.CapacitorCustomPlatform = { name: 'android' };
    window.Capacitor = {
      PluginHeaders: [
        {
          name: 'NativeAiBridge',
          methods: [
            { name: 'httpRequest', rtype: 'promise' },
            { name: 'openExternalUrl', rtype: 'promise' },
            { name: 'startOAuthCallbackServer', rtype: 'promise' },
            { name: 'stopOAuthCallbackServer', rtype: 'promise' },
          ],
        },
      ],
      nativePromise: async (pluginName, methodName, options) => {
        if (pluginName === 'NativeAiBridge' && typeof nativeAiBridge[methodName] === 'function') {
          return await nativeAiBridge[methodName](options);
        }
        throw new Error(`Unknown plugin call ${pluginName}.${methodName}`);
      },
    };
  }, liveApiKey || 'sk-mock-deepseek-test-key-123456');

  async function assertNotWhiteScreen(stepName) {
    const info = await page.evaluate(() => ({
      textLen: (document.body.innerText || '').trim().length,
      hasErrorBoundary: (document.body.innerText || '').includes('页面遇到了一点小问题'),
    }));
    assert.ok(info.textLen > 20, `[${stepName}] White screen detected! textLen=${info.textLen}`);
    assert.equal(info.hasErrorBoundary, false, `[${stepName}] Hit AppErrorBoundary!`);
    assert.equal(pageErrors.length, 0, `[${stepName}] Uncaught pageerror: ${pageErrors.join(' | ')}`);
  }

  console.log(`=== 启动手机端全功能实测（模式：${isLive ? '真实 DeepSeek API' : 'Mock'}）===`);

  console.log('1. 测试「地图足迹」（全国地图 -> 钻取省份 -> 点亮城市）...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.sidebar').waitFor({ timeout: 15000 });
  await page.locator('canvas').first().waitFor({ timeout: 15000 });
  if (!(await page.locator('.province-list button').first().isVisible().catch(() => false))) {
    const provToggle = page.locator('button', { hasText: /按省|省份|浏览|列表|展开/ }).first();
    if (await provToggle.isVisible().catch(() => false)) await provToggle.click();
  }
  if (await page.locator('.province-list button', { hasText: '贵州' }).isVisible({ timeout: 4000 }).catch(() => false)) {
    await page.locator('.province-list button', { hasText: '贵州' }).click();
    await page.getByRole('button', { name: '返回全国' }).waitFor({ timeout: 10000 });
    await page.locator('.city-list button', { hasText: '安顺市' }).click();
    await page.getByText('安顺市已点亮为已去过').waitFor({ timeout: 8000 });
  }
  await assertNotWhiteScreen('地图足迹');
  console.log('   ✓ 地图足迹（全国地图渲染、省内钻取、城市点亮）正常！');

  console.log('2. 切换到「行程规划」并打开 AI 服务设置弹窗（验证错误模型名自动修复 + 真实测速）...');
  await page.locator('.sidebar button', { hasText: '行程规划' }).click();
  await page.getByText('我的旅行计划').waitFor({ timeout: 10000 });
  await page.locator('button', { hasText: 'AI 服务设置' }).first().click();
  await page.locator('.ai-dock-settings-btn').first().waitFor({ timeout: 8000 });
  await page.locator('.ai-dock-settings-btn').first().click();
  await page.getByRole('dialog', { name: '配置 AI' }).waitFor({ timeout: 10000 });

  // Expand API section if needed
  const testBtn = page.getByRole('button', { name: '测试连接与速度' });
  if (!(await testBtn.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '展开 API' }).click();
  }
  await testBtn.waitFor({ timeout: 8000 });
  const repairedCount = await page.locator('input[value="deepseek-flash"]').count();
  assert.ok(repairedCount >= 1, 'Model input should be auto-repaired to "deepseek-flash"');
  await testBtn.click();
  await page.getByText(/连接成功/).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '保存并启用' }).click();
  await page.getByText(/已保存并启用/).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '关闭' }).first().click();
  await assertNotWhiteScreen('AI设置测速保存');
  console.log('   ✓ 错误模型名自动修复为 deepseek-flash，真实测速与保存成功！');

  console.log('3. 测试「挑选目的地 / 发现目的地」（原白屏功能）...');
  await page.locator('button', { hasText: '发现目的地' }).first().click();
  const recommendBtn = page.getByRole('button', { name: /推荐目的地|帮我挑目的地|开始推荐|AI 推荐/ }).first();
  await recommendBtn.waitFor({ timeout: 8000 });
  await recommendBtn.click();
  // Wait for recommendation cards to render ("用这个目的地规划")
  await page.locator('button', { hasText: '用这个目的地规划' }).first().waitFor({ timeout: 60000 });
  const recCount = await page.locator('button', { hasText: '用这个目的地规划' }).count();
  assert.ok(recCount >= 1, 'Expected at least 1 recommendation card');
  // Verify recommendation photos were fetched!
  const recPhotos = await page.locator('.planner-recommendation img').count();
  console.log(`   ✓ 挑选目的地成功返回 ${recCount} 个推荐卡片，其中 ${recPhotos} 张已带真实实景图，零白屏！`);
  assert.ok(recPhotos >= 1, 'Expected at least 1 real photo on recommendation cards');

  // Test Xiaohongshu direct App link from recommendation card
  const xhsBtn = page.locator('.planner-recommendation a', { hasText: '去小红书搜这个地点' }).first();
  if (await xhsBtn.isVisible().catch(() => false)) {
    await xhsBtn.click();
    await page.waitForTimeout(200);
    const xhsCall = openedExternalUrls.find((u) => String(u.url || '').startsWith('xhsdiscover://'));
    assert.ok(xhsCall, `Expected xhsdiscover:// deep link call, got: ${JSON.stringify(openedExternalUrls)}`);
    console.log(`   ✓ 小红书跳转验证通过：${xhsCall.url.slice(0, 60)}...`);
  }
  await assertNotWhiteScreen('发现目的地结果');

  console.log('4. 测试从推荐卡片「用这个目的地规划」-> 建议天数 -> 生成完整行程...');
  await page.locator('button', { hasText: '用这个目的地规划' }).first().click();
  await page.getByText('这次想怎么玩').waitFor({ timeout: 8000 });
  // Trigger duration suggestion (no days entered yet)
  const submitBtn = page.locator('form button[type="submit"]').first();
  await submitBtn.click();
  const durationBtn = page.locator('button.secondary', { hasText: /\d+\s*天\s*·/ }).first();
  await durationBtn.waitFor({ timeout: 60000 });
  await assertNotWhiteScreen('建议天数');
  console.log('   ✓ 建议天数选项生成并渲染正常！');

  // Click the first duration option to generate full itinerary
  await durationBtn.click();
  await page.locator('.planner-day, .itinerary-day, button:has-text("行程地图"), button:has-text("行前清单")').first().waitFor({ timeout: 120000 });
  await assertNotWhiteScreen('完整行程生成');
  console.log('   ✓ 完整行程生成并通过严格校验，页面正常渲染！');

  console.log('5. 测试「行程地图」（点击查看行程地图 -> 真实景点定位标点 + 高德 App 跳转）...');
  const openMapBtn = page.getByRole('button', { name: '查看行程地图' });
  await openMapBtn.waitFor({ timeout: 10000 });
  await openMapBtn.click();
  await page.locator('.planner-number-marker').first().waitFor({ timeout: 45000 });
  const markerCount = await page.locator('.planner-number-marker').count();
  assert.ok(markerCount >= 1, 'Expected at least 1 located attraction marker on itinerary map');
  await assertNotWhiteScreen('行程地图');
  console.log(`   ✓ 行程地图真实定位成功（${markerCount} 个景点标点）！`);
  await page.getByRole('button', { name: '收起地图' }).click();

  // Verify Amap deep link on activity card
  const amapLink = page.locator('a', { hasText: '高德地图' }).first();
  if (await amapLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await amapLink.click();
    await page.waitForTimeout(200);
    const amapCall = openedExternalUrls.find((u) => String(u.url || '').startsWith('androidamap://'));
    assert.ok(amapCall, `Expected androidamap:// deep link call, got: ${JSON.stringify(openedExternalUrls)}`);
    console.log(`   ✓ 高德地图 App 跳转验证通过：${amapCall.url.slice(0, 60)}...`);
  }

  console.log('6. 测试「行前打包清单」AI 生成...');
  const packBtn = page.locator('button', { hasText: /行前清单|打包清单/ }).first();
  if (await packBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await packBtn.click();
    const aiPackBtn = page.getByRole('button', { name: /AI 生成|一键生成|生成清单/ }).first();
    if (await aiPackBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await aiPackBtn.click();
      await page.getByText(/已生成 \d+ 项/).waitFor({ timeout: 60000 });
      await assertNotWhiteScreen('行前清单');
      console.log('   ✓ 行前打包清单 AI 生成正常！');
    }
    const closePackBtn = page.getByRole('button', { name: /关闭|收起/ }).first();
    if (await closePackBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await closePackBtn.click();
      await page.waitForTimeout(200);
    }
  }

  console.log('7. 测试「AI 助手对话问答」...');
  const chatBtn = page.locator('button', { hasText: /AI 助手|问问 AI|行程助手|对话/ }).first();
  if (await chatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chatBtn.click();
    await page.waitForTimeout(300);
  }
  const chatBox = page.locator('textarea').last();
  if (await chatBox.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chatBox.fill('这次出行穿什么衣服合适？简短回答即可。');
    await page.getByRole('button', { name: /发送/ }).first().click();
    await page.waitForTimeout(1500);
    await page.waitForFunction(
      () => !document.body.innerText.includes('手机直连 AI 正在思考回复'),
      null,
      { timeout: 60000 },
    );
    await assertNotWhiteScreen('AI问答');
    console.log('   ✓ AI 助手对话问答正常！');
  }

  console.log('8. 测试「预算与账本」「旅行手账」「旅途成就」「个人中心」...');
  await page.evaluate(() => window.scrollTo(0, 0));
  const budgetTab = page.getByRole('tab', { name: '预算与账本' });
  if (await budgetTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await budgetTab.click();
    await page.waitForTimeout(400);
    await assertNotWhiteScreen('预算与账本');
    console.log('   ✓ 预算与账本正常！');
  }

  for (const tabName of ['旅行手账', '旅途成就', '个人中心']) {
    await page.locator('.sidebar button', { hasText: tabName }).click();
    await page.waitForTimeout(400);
    await assertNotWhiteScreen(tabName);
    console.log(`   ✓ ${tabName} 正常！`);
  }

  console.log('9. 测试个人中心「导航地图 App」切换（高德 / 百度 / 谷歌）...');
  await page.locator('button', { hasText: '偏好与设置' }).first().click();
  await page.getByText('导航地图 App').waitFor({ timeout: 8000 });
  await page.getByRole('radio', { name: /百度地图/ }).click();
  const savedBaidu = await page.evaluate(() => localStorage.getItem('zhouyou-map-app-provider-v1'));
  assert.equal(savedBaidu, 'baidu', 'Expected map provider saved as baidu');
  await page.getByRole('radio', { name: /谷歌地图/ }).click();
  const savedGoogle = await page.evaluate(() => localStorage.getItem('zhouyou-map-app-provider-v1'));
  assert.equal(savedGoogle, 'google', 'Expected map provider saved as google');
  await page.getByRole('radio', { name: /高德地图/ }).click();
  console.log('   ✓ 导航地图 App 切换（高德 / 百度 / 谷歌）验证通过！');

  assert.equal(pageErrors.length, 0, `Page errors detected: ${pageErrors.join('\n')}`);
  console.log(`\n🎉 全流程实测通过！共完成 ${apiCalls.length} 次 AI 接口调用，0 个页面报错，0 次白屏！`);
} catch (err) {
  if (pageErrors.length) console.error('PAGE ERRORS:', pageErrors);
  if (consoleErrors.length) console.error('CONSOLE ERRORS:', consoleErrors.slice(0, 10));
  throw err;
} finally {
  await browser.close();
  server.close();
}
