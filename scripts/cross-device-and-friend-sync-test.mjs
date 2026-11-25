import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

import { onRequest as authHandler } from '../functions/api/auth/[[path]].js';
import { onRequest as syncHandler } from '../functions/api/sync/[[path]].js';
import { onRequest as socialHandler } from '../functions/api/social/[[path]].js';
import { onRequest as groupsHandler } from '../functions/api/groups/[[path]].js';
import { onRequest as shareHandler } from '../functions/api/share/[[path]].js';
import { onRequest as chatHandler } from '../functions/api/chat/[[path]].js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const distDir = path.join(webRoot, 'dist');
const migrationSql = readFileSync(path.join(webRoot, 'migrations/0001_cloud_social.sql'), 'utf8');

function createMockD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migrationSql);
  let sessionTouchWrites = 0;

  function makePrepared(sql) {
    const stmt = sqlite.prepare(sql);
    const wrap = (args = []) => ({
      __runSync() {
        if (/UPDATE\s+user_sessions\s+SET\s+last_seen_at/i.test(sql)) {
          sessionTouchWrites += 1;
        }
        stmt.run(...args);
        return { success: true };
      },
      async first() {
        const row = stmt.get(...args);
        return row ?? null;
      },
      async all() {
        return { results: stmt.all(...args) };
      },
      async run() {
        return this.__runSync();
      },
    });

    return {
      bind(...args) {
        return wrap(args);
      },
      ...wrap([]),
    };
  }

  return {
    getSessionTouchWrites: () => sessionTouchWrites,
    prepare: makePrepared,
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of stmts) {
          results.push(s.__runSync());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function buildValidAiPlan(id, title, updatedAt, version = 1) {
  return {
    id,
    version,
    createdAt: '2026-11-25T08:00:00.000Z',
    updatedAt,
    linkedTripId: null,
    linkedSnapshot: null,
    history: [],
    mapPositions: {},
    hotels: [],
    wishlist: [],
    content: {
      title,
      summary: `${title} 行程概览`,
      request: {
        destination: '成都',
        base: '上海',
        startDate: '2026-12-10',
        endDate: '2026-12-10',
        days: 1,
        people: 2,
        students: 0,
        seniors: 0,
        children: 0,
        travelersText: '',
        rooms: 1,
        budgetCents: 300000,
        pace: '均衡',
        transport: '公共交通',
        luggageMode: 'suitcase',
        dietary: '',
        lodgingLevel: '舒适经济',
        notes: '美食慢游',
        skipBreakfast: false,
        foodMode: true,
        references: [],
      },
      cities: [{ code: '510100', name: '成都市', provinceCode: '510000' }],
      constraints: [],
      warnings: [],
      days: [
        {
          date: '2026-12-10',
          title: '宽窄巷子与锦里',
          weather: '多云 10~16℃',
          activities: [
            {
              id: 'act-1',
              title: '宽窄巷子漫步',
              kind: 'sight',
              startTime: '09:30',
              endTime: '11:30',
              period: 'morning',
              city: '成都市',
              location: '宽窄巷子',
              description: '喝盖碗茶，逛老街',
              transportMode: '',
              meal: null,
              locked: false,
              photo: null,
              sourceIds: [],
              costs: [],
              fromActivityId: null,
              toActivityId: null,
            },
          ],
          lodging: null,
        },
      ],
      sources: [],
    },
  };
}

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function startLocalCloudServer(db) {
  const handlers = {
    auth: authHandler,
    sync: syncHandler,
    social: socialHandler,
    groups: groupsHandler,
    share: shareHandler,
    chat: chatHandler,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
        const group = parts[0];
        const handler = handlers[group];
        if (!handler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'not found' }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuf = chunks.length ? Buffer.concat(chunks) : undefined;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(', '));
        }
        const webReq = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyBuf,
        });
        const waitUntilTasks = [];
        const webRes = await handler({
          request: webReq,
          env: { DB: db },
          params: { path: parts.slice(1) },
          waitUntil: (p) => waitUntilTasks.push(p),
        });
        if (waitUntilTasks.length) await Promise.allSettled(waitUntilTasks);
        const outHeaders = {};
        webRes.headers.forEach((v, k) => {
          outHeaders[k] = v;
        });
        res.writeHead(webRes.status, outHeaders);
        const arrBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrBuf));
        return;
      }

      // 静态资源（dist/）
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      let filePath = path.join(distDir, rel);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function apiJson(origin, method, pathname, { token = '', body = undefined } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: resp.status, json, text, headers: resp.headers };
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function readIdbStore(page, storeName) {
  return page.evaluate(async (name) => {
    const dbs = await new Promise((resolve, reject) => {
      const req = indexedDB.open('travel-footprints');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const list = await new Promise((resolve, reject) => {
      const tx = dbs.transaction(name, 'readonly');
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbs.close();
    return list;
  }, storeName);
}

async function putIdbRecord(page, storeName, record) {
  return page.evaluate(async ({ name, rec }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('travel-footprints');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { name: storeName, rec: record });
}

async function run() {
  assert.ok(existsSync(path.join(distDir, 'index.html')), '请先执行 npm run build 生成 dist/');
  const db = createMockD1();
  const { server, origin } = await startLocalCloudServer(db);
  let browser = null;

  try {
    console.log(`🚀 本地云端联调服务已启动：${origin}`);

    // =========================================================================
    // Part 1: 后端 API 层验证（同账号多设备会话 + D1 节流 + 聊天增量 + 图片外置 + 好友传计划）
    // =========================================================================
    const regA = await apiJson(origin, 'POST', '/api/auth/register', {
      body: {
        phone: '13900139001',
        password: 'password123',
        nickname: '跨端测试君',
        securityQuestion: '你最喜欢的旅行城市是？',
        securityAnswer: '成都',
        platform: 'desktop',
        deviceName: '周游桌面端',
      },
    });
    assert.equal(regA.status, 201, regA.text);
    const desktopTokenA = regA.json.token;
    const userA = regA.json.user;

    const loginMobileA = await apiJson(origin, 'POST', '/api/auth/login', {
      body: {
        identifier: '13900139001',
        password: 'password123',
        platform: 'mobile',
        deviceName: '周游 Android 端',
      },
    });
    assert.equal(loginMobileA.status, 200, loginMobileA.text);
    const mobileTokenA = loginMobileA.json.token;

    // 连续 5 次轻量版本号查询，验证 requireAuth 节流不会每次都写 user_sessions
    const writesBefore = db.getSessionTouchWrites();
    for (let i = 0; i < 5; i += 1) {
      const v = await apiJson(origin, 'GET', '/api/sync/version', { token: mobileTokenA });
      assert.equal(v.status, 200);
    }
    assert.equal(db.getSessionTouchWrites() - writesBefore, 0, '5 分钟内频繁轮询不应重复写 user_sessions');

    // 注册好友 B 并与 A 成为好友
    const regB = await apiJson(origin, 'POST', '/api/auth/register', {
      body: {
        email: 'friend-b@example.com',
        password: 'password123',
        nickname: '好友小云',
        securityQuestion: '你的第一所小学名称是？',
        securityAnswer: '向阳小学',
        platform: 'mobile',
        deviceName: '好友手机端',
      },
    });
    assert.equal(regB.status, 201, regB.text);
    const tokenB = regB.json.token;
    const userB = regB.json.user;

    const frReq = await apiJson(origin, 'POST', '/api/social/friends/request', {
      token: desktopTokenA,
      body: { friendCode: userB.friendCode },
    });
    assert.ok(frReq.status === 200 || frReq.status === 201, frReq.text);

    const ovB = await apiJson(origin, 'GET', '/api/social/overview', { token: tokenB });
    const friendshipId = ovB.json.pendingFriendRequests[0].friendshipId;
    const frAccept = await apiJson(origin, 'POST', '/api/social/friends/respond', {
      token: tokenB,
      body: { friendshipId, decision: 'accept' },
    });
    assert.equal(frAccept.status, 200);

    // 好友 A 给 B 发送：普通文字消息 x2 + 图片消息 + 旅行攻略卡片
    const msg1 = await apiJson(origin, 'POST', `/api/chat/dm/${userB.id}`, {
      token: desktopTokenA,
      body: { msgType: 'text', textContent: '我做好成都攻略了，马上发给你' },
    });
    assert.equal(msg1.status, 200);

    const msg2 = await apiJson(origin, 'POST', `/api/chat/dm/${userB.id}`, {
      token: desktopTokenA,
      body: { msgType: 'text', textContent: '你看下行程安排合适不？' },
    });
    assert.equal(msg2.status, 200);

    // 验证普通私聊消息已写入通知且自动合并为 1 条未读（不刷屏）
    const notifB = await apiJson(origin, 'GET', '/api/social/notifications', { token: tokenB });
    const chatNotifs = notifB.json.notifications.filter((n) => n.type === 'chat_message' && !n.readAt);
    assert.equal(chatNotifs.length, 1, '连续私聊消息应合并为 1 条未读提醒');
    assert.equal(chatNotifs[0].body, '你看下行程安排合适不？');

    // 发送一张 1x1 PNG 图片消息，验证图片自动外置到 /api/chat/image/:id，不再在消息列表里存 Base64
    const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRX0AAAAASUVORK5CYII=';
    const imgMsg = await apiJson(origin, 'POST', `/api/chat/dm/${userB.id}`, {
      token: desktopTokenA,
      body: { msgType: 'image', textContent: '[图片]', payload: { dataUrl: tinyPngDataUrl } },
    });
    assert.equal(imgMsg.status, 200, imgMsg.text);
    assert.equal(imgMsg.json.message.payload.dataUrl, undefined, '图片消息不应再保留 Base64 dataUrl');
    assert.match(imgMsg.json.message.payload.imageUrl, /^\/api\/chat\/image\/cimg_/, '应生成外置图片 URL');

    const imgFetch = await fetch(`${origin}${imgMsg.json.message.payload.imageUrl}`);
    assert.equal(imgFetch.status, 200);
    assert.equal(imgFetch.headers.get('content-type'), 'image/png');
    assert.match(imgFetch.headers.get('cache-control') || '', /immutable/);

    // 好友 B 首次全量拉取聊天，拿到游标 after
    const fullChatB = await apiJson(origin, 'GET', `/api/chat/dm/${userA.id}`, { token: tokenB });
    assert.equal(fullChatB.status, 200);
    assert.equal(fullChatB.json.messages.length, 3);
    const lastCreatedAt = fullChatB.json.messages[fullChatB.json.messages.length - 1].createdAt;

    // 好友 A 创建攻略分享并直接通过聊天发送给 B
    const sharedPlan = buildValidAiPlan('plan_friend_direct_1', '好友直传·成都3日美食游', new Date().toISOString(), 1);
    const shareCreate = await apiJson(origin, 'POST', '/api/share/create', {
      token: desktopTokenA,
      body: {
        planId: sharedPlan.id,
        mode: 'copy',
        recipientUserId: userB.id,
        planPayload: sharedPlan,
      },
    });
    assert.equal(shareCreate.status, 201, shareCreate.text);
    const shareCode = shareCreate.json.code;

    // 等 2ms 确保时间戳严格递增
    await new Promise((r) => setTimeout(r, 5));
    const planCardMsg = await apiJson(origin, 'POST', `/api/chat/dm/${userB.id}`, {
      token: desktopTokenA,
      body: {
        msgType: 'plan',
        textContent: `分享了攻略「${sharedPlan.content.title}」`,
        payload: {
          planId: sharedPlan.id,
          shareCode,
          title: sharedPlan.content.title,
          destination: '成都',
          daysCount: 3,
          mode: 'copy',
        },
      },
    });
    assert.equal(planCardMsg.status, 200);

    // 好友 B 使用 ?after= 增量拉取聊天：应只返回刚发的那 1 条攻略卡片消息！
    const t0 = Date.now();
    const incChatB = await apiJson(
      origin,
      'GET',
      `/api/chat/dm/${userA.id}?after=${encodeURIComponent(lastCreatedAt)}`,
      { token: tokenB },
    );
    const incMs = Date.now() - t0;
    assert.equal(incChatB.status, 200);
    assert.equal(incChatB.json.incremental, true);
    assert.equal(incChatB.json.messages.length, 1, '增量拉取应只返回新增的 1 条攻略卡片消息');
    assert.equal(incChatB.json.messages[0].msgType, 'plan');
    assert.equal(incChatB.json.messages[0].payload.shareCode, shareCode);
    console.log(`✅ Part 1 通过：D1 节流写库 + 聊天图片外置 + 普通消息通知合并 + 增量聊天拉取 (${incMs}ms)`);

    // =========================================================================
    // Part 2: Playwright 真实前端双端测试（电脑端 + 手机端同账号同步 & 好友 B 接收计划）
    // =========================================================================
    const executablePath = findBrowserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });

    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const friendCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });

    const setupClient = async (ctx, token, user) => {
      await ctx.addInitScript(({ cloudOrigin, tok, u }) => {
        localStorage.setItem('zhouyou-cloud-origin', cloudOrigin);
        localStorage.setItem('zhouyou-cloud-token', tok);
        localStorage.setItem('zhouyou-cloud-user', JSON.stringify(u));
        sessionStorage.setItem('zhouyou-auth-dismissed', '1');
      }, { cloudOrigin: origin, tok: token, u: user });
      const page = await ctx.newPage();
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.waitForSelector('.cloud-pill-btn', { state: 'attached', timeout: 15000 });
      return page;
    };

    const triggerSync = async (page) => {
      await page.evaluate(() => {
        const btn = document.querySelector('.cloud-pill-btn');
        if (btn instanceof HTMLButtonElement) btn.click();
      });
    };

    const desktopPage = await setupClient(desktopCtx, desktopTokenA, userA);
    const mobilePage = await setupClient(mobileCtx, mobileTokenA, userA);

    // 2.1 电脑端写入本地足迹 + 日记 + AI 攻略，标记脏队列并触发同步上传
    const planV1 = buildValidAiPlan('plan_cross_device_1', '电脑端创建的成都计划 v1', new Date().toISOString(), 1);
    await putIdbRecord(desktopPage, 'marks', {
      id: '510100',
      name: '成都市',
      provinceCode: '510000',
      visited: true,
      planned: false,
      updatedAt: new Date().toISOString(),
    });
    await putIdbRecord(desktopPage, 'aiPlans', planV1);
    await desktopPage.evaluate((planId) => {
      const now = new Date().toISOString();
      localStorage.setItem('zhouyou-cloud-dirty-records', JSON.stringify({
        'marks:510100': { store: 'marks', id: '510100', updatedAt: now },
        [`aiPlans:${planId}`]: { store: 'aiPlans', id: planId, updatedAt: now },
      }));
    }, planV1.id);

    await triggerSync(desktopPage);
    await desktopPage.waitForFunction(() => !localStorage.getItem('zhouyou-cloud-dirty-records'), { timeout: 10000 });

    // 2.2 手机端点击云同步，验证收到电脑端的地图点亮和 AI 攻略 v1
    await triggerSync(mobilePage);
    await mobilePage.waitForFunction(async (planId) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('travel-footprints');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const plan = await new Promise((resolve) => {
        const tx = db.transaction('aiPlans', 'readonly');
        const req = tx.objectStore('aiPlans').get(planId);
        req.onsuccess = () => resolve(req.result || null);
      });
      db.close();
      return Boolean(plan && plan.content?.title === '电脑端创建的成都计划 v1');
    }, planV1.id, { timeout: 10000 });

    const mobileMarks = await readIdbStore(mobilePage, 'marks');
    assert.ok(mobileMarks.some((m) => m.id === '510100' && m.visited), '手机端应收到电脑端同步的点亮城市');
    console.log('✅ Part 2.1 通过：电脑端 -> 云端 -> 手机端（地图足迹 + AI 攻略）实时同步成功');

    // 2.1b 回归：AI 攻略把总占用撑过 3MB 后，手机端点亮城市仍能增量同步到电脑端
    db.prepare('UPDATE ai_plans SET byte_size = ? WHERE id = ?').bind(5 * 1024 * 1024, planV1.id).__runSync();
    await putIdbRecord(mobilePage, 'marks', {
      id: '440300',
      name: '深圳市',
      provinceCode: '440000',
      visited: true,
      planned: false,
      updatedAt: new Date().toISOString(),
    });
    await mobilePage.evaluate(() => {
      localStorage.setItem('zhouyou-cloud-dirty-records', JSON.stringify({
        'marks:440300': { store: 'marks', id: '440300', updatedAt: new Date().toISOString() },
      }));
    });
    await triggerSync(mobilePage);
    await mobilePage.waitForFunction(() => !localStorage.getItem('zhouyou-cloud-dirty-records'), { timeout: 10000 });
    await triggerSync(desktopPage);
    await desktopPage.waitForFunction(async () => {
      const idb = await new Promise((resolve, reject) => {
        const req = indexedDB.open('travel-footprints');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const mark = await new Promise((resolve) => {
        const req = idb.transaction('marks', 'readonly').objectStore('marks').get('440300');
        req.onsuccess = () => resolve(req.result || null);
      });
      idb.close();
      return Boolean(mark && mark.visited);
    }, null, { timeout: 10000 });
    console.log('✅ Part 2.1b 通过：攻略占用超过 3MB 时，手机点亮城市仍能同步到电脑端');

    // 2.3 关键回归测试：手机端修改同一份已有攻略（即使模拟手机时间慢 2 分钟！），推送上云；
    //     电脑端在本地已有旧版攻略的情况下同步，必须无冲突报错并成功覆盖更新！
    const skewedPastIso = new Date(Date.now() - 120 * 1000).toISOString();
    const planV2 = buildValidAiPlan(planV1.id, '手机端修改后的成都计划 v2', skewedPastIso, 2);
    await putIdbRecord(mobilePage, 'aiPlans', planV2);
    await mobilePage.evaluate((planId) => {
      const dirtyNow = new Date().toISOString();
      localStorage.setItem('zhouyou-cloud-dirty-records', JSON.stringify({
        [`aiPlans:${planId}`]: { store: 'aiPlans', id: planId, updatedAt: dirtyNow },
      }));
    }, planV1.id);

    await triggerSync(mobilePage);
    await mobilePage.waitForFunction(() => !localStorage.getItem('zhouyou-cloud-dirty-records'), { timeout: 10000 });

    // 电脑端拉取更新（此前这里会触发 saveAiPlan(cp.payload, null) 抛异常崩溃！）
    await triggerSync(desktopPage);
    await desktopPage.waitForFunction(async (planId) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('travel-footprints');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const plan = await new Promise((resolve) => {
        const tx = db.transaction('aiPlans', 'readonly');
        const req = tx.objectStore('aiPlans').get(planId);
        req.onsuccess = () => resolve(req.result || null);
      });
      db.close();
      return Boolean(plan && plan.content?.title === '手机端修改后的成都计划 v2');
    }, planV1.id, { timeout: 10000 });

    const desktopToast = await desktopPage.locator('.toast').textContent().catch(() => '');
    assert.ok(!desktopToast.includes('计划已在其他操作中更新'), `电脑端同步不应报冲突错：${desktopToast}`);
    console.log('✅ Part 2.2 通过：手机端修改已有攻略（含时钟偏差）-> 云端 -> 电脑端无缝覆写更新，零报错');

    // 2.4 好友 B 浏览器打开好友 A 传来的分享码链接并接收计划（验证真实前端接收 + 落盘 + 云同步）
    const friendPage = await setupClient(friendCtx, tokenB, userB);
    await friendPage.goto(`${origin}/?share=${shareCode}`, { waitUntil: 'networkidle' });
    const acceptBtn = friendPage.locator('button', { hasText: /保存到我的行程|接收|加入/ }).first();
    await acceptBtn.waitFor({ state: 'visible', timeout: 10000 });
    await acceptBtn.click();

    await friendPage.waitForFunction(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('travel-footprints');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const list = await new Promise((resolve) => {
        const tx = db.transaction('aiPlans', 'readonly');
        const req = tx.objectStore('aiPlans').getAll();
        req.onsuccess = () => resolve(req.result || []);
      });
      db.close();
      return list.some((p) => p.content?.title === '好友直传·成都3日美食游');
    }, { timeout: 10000 });

    // 好友 B 接收后再触发一次云同步，验证不报任何冲突错
    await triggerSync(friendPage);
    await friendPage.waitForFunction(() => !localStorage.getItem('zhouyou-cloud-dirty-records'), { timeout: 10000 });
    console.log('✅ Part 2.3 通过：好友直接传输旅行计划 -> 对方接收落盘并同步云端全链路成功');

    console.log('\n🎉 全部跨端同步与好友传输端到端测试通过！');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('❌ cross-device-and-friend-sync-test failed:', err);
  process.exit(1);
});
