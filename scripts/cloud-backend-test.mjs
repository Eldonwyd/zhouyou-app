import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { onRequest as authHandler } from '../functions/api/auth/[[path]].js';
import { onRequest as syncHandler } from '../functions/api/sync/[[path]].js';
import { onRequest as socialHandler } from '../functions/api/social/[[path]].js';
import { onRequest as groupsHandler } from '../functions/api/groups/[[path]].js';
import { onRequest as shareHandler } from '../functions/api/share/[[path]].js';
import { onRequestGet as sharePageHandler } from '../functions/share/[code].js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(path.resolve(__dirname, '../migrations/0001_cloud_social.sql'), 'utf8');

/** 将 Node 内置 SQLite 包装为与 Cloudflare D1 完全一致的异步接口，供本地全链路测试。 */
function createMockD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migrationSql);
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() {
              const row = stmt.get(...args);
              return row ?? null;
            },
            async all() {
              return { results: stmt.all(...args) };
            },
            async run() {
              stmt.run(...args);
              return { success: true };
            },
          };
        },
        async first() {
          const row = stmt.get();
          return row ?? null;
        },
        async all() {
          return { results: stmt.all() };
        },
        async run() {
          stmt.run();
          return { success: true };
        },
      };
    },
  };
}

const db = createMockD1();

async function callApi(handler, method, pathname, { token = '', body = undefined, params = {} } = {}) {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const req = new Request(`https://zhouyou.online${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handler({ request: req, env: { DB: db }, params });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

async function run() {
  // 1. 注册两个用户：A（手机号+密码），B（邮箱+密码），校验唯一昵称与密保找回密码
  const regA = await callApi(authHandler, 'POST', '/api/auth/register', {
    params: { path: ['register'] },
    body: {
      phone: '13800138001',
      password: 'password123',
      nickname: '山海小鹿',
      securityQuestion: '你最喜欢的旅行城市是？',
      securityAnswer: '成都',
    },
  });
  assert.equal(regA.status, 201, regA.text);
  assert.equal(regA.json.user.nickname, '山海小鹿');
  assert.match(regA.json.user.friendCode, /^ZY-[A-Z0-9]{6}$/);
  let tokenA = regA.json.token;

  // 重复昵称应被拒绝
  const dupNick = await callApi(authHandler, 'POST', '/api/auth/register', {
    params: { path: ['register'] },
    body: {
      email: 'b@example.com',
      password: 'password123',
      nickname: '山海小鹿',
      securityQuestion: '你最喜欢的旅行城市是？',
      securityAnswer: '厦门',
    },
  });
  assert.equal(dupNick.status, 409);

  const regB = await callApi(authHandler, 'POST', '/api/auth/register', {
    params: { path: ['register'] },
    body: {
      email: 'b@example.com',
      password: 'password123',
      nickname: '海风漫游',
      securityQuestion: '你的第一所小学名称是？',
      securityAnswer: '实验小学',
    },
  });
  assert.equal(regB.status, 201);
  const tokenB = regB.json.token;
  const userA = regA.json.user;
  const userB = regB.json.user;

  // 2. 忘记密码：查询密保问题 + 答对重置密码 + 用新密码重新登录
  const sq = await callApi(authHandler, 'POST', '/api/auth/security-question', {
    params: { path: ['security-question'] },
    body: { identifier: '13800138001' },
  });
  assert.equal(sq.status, 200);
  assert.equal(sq.json.question, '你最喜欢的旅行城市是？');

  const reset = await callApi(authHandler, 'POST', '/api/auth/reset-password', {
    params: { path: ['reset-password'] },
    body: { identifier: '13800138001', securityAnswer: ' 成都 ', newPassword: 'newpassword456' },
  });
  assert.equal(reset.status, 200);

  const loginA = await callApi(authHandler, 'POST', '/api/auth/login', {
    params: { path: ['login'] },
    body: { identifier: '13800138001', password: 'newpassword456' },
  });
  assert.equal(loginA.status, 200);
  tokenA = loginA.json.token;

  // 3. 全文本同步（地图点亮 + 文字手账 + AI 攻略）
  const pushA = await callApi(syncHandler, 'POST', '/api/sync/push', {
    token: tokenA,
    params: { path: ['push'] },
    body: {
      records: [
        { store: 'marks', id: '510100', payload: { id: '510100', name: '成都市', provinceCode: '510000', visited: true, planned: false, updatedAt: '2026-11-25T10:00:00Z' } },
        { store: 'entries', id: 'ent_1', payload: { id: 'ent_1', cityCode: '510100', note: '火锅太香了', date: '2026-11-24' } },
      ],
      aiPlans: [
        {
          id: 'plan_cd_1',
          payload: {
            id: 'plan_cd_1',
            title: '成都 3 日美食行',
            content: {
              request: { destination: '成都', startDate: '2026-12-01', endDate: '2026-12-03', people: 2 },
              days: [{ day: 1, date: '2026-12-01', theme: '宽窄巷子与火锅', activities: [{ id: 'act_1', title: '人民公园喝茶' }] }],
            },
          },
        },
      ],
    },
  });
  assert.equal(pushA.status, 200, pushA.text);
  assert.equal(pushA.json.acceptedPlanVersions.plan_cd_1, 1);

  await callApi(syncHandler, 'POST', '/api/sync/push', {
    token: tokenB,
    params: { path: ['push'] },
    body: {
      records: [
        { store: 'marks', id: '510100', payload: { id: '510100', name: '成都市', provinceCode: '510000', visited: true, planned: false, updatedAt: '2026-11-25T10:00:00Z' } },
        { store: 'marks', id: '350200', payload: { id: '350200', name: '厦门市', provinceCode: '350000', visited: true, planned: false, updatedAt: '2026-11-25T10:00:00Z' } },
      ],
    },
  });

  // 4. 搜昵称加好友 + 同意 + 绑定亲密关系 + 对比足迹地图
  const searchRes = await callApi(socialHandler, 'GET', '/api/social/search?q=%E6%B5%B7%E9%A3%8E', {
    token: tokenA,
    params: { path: ['search'] },
  });
  assert.equal(searchRes.json.users.length, 1);
  assert.equal(searchRes.json.users[0].id, userB.id);

  const reqFrd = await callApi(socialHandler, 'POST', '/api/social/friends/request', {
    token: tokenA,
    params: { path: ['friends', 'request'] },
    body: { targetUserId: userB.id },
  });
  assert.equal(reqFrd.status, 201);

  const ovB = await callApi(socialHandler, 'GET', '/api/social/overview', { token: tokenB, params: { path: ['overview'] } });
  assert.equal(ovB.json.pendingFriendRequests.length, 1);
  assert.ok(ovB.json.unreadCount >= 1);

  await callApi(socialHandler, 'POST', '/api/social/friends/respond', {
    token: tokenB,
    params: { path: ['friends', 'respond'] },
    body: { friendshipId: ovB.json.pendingFriendRequests[0].friendshipId, decision: 'accept' },
  });

  // 互看足迹地图：共同去过成都市 (1 城)
  const cmp = await callApi(socialHandler, 'GET', `/api/social/friends/${userB.id}/footprints`, {
    token: tokenA,
    params: { path: ['friends', userB.id, 'footprints'] },
  });
  assert.equal(cmp.status, 200);
  assert.equal(cmp.json.stats.sharedVisitedCount, 1);
  assert.equal(cmp.json.stats.sharedVisitedCities[0].name, '成都市');

  // B 将隐私设为「仅亲密关系可见」，此时 A 无法查看；绑定情侣亲密关系后可查看
  await callApi(authHandler, 'PATCH', '/api/auth/profile', {
    token: tokenB,
    params: { path: ['profile'] },
    body: { mapVisibility: 'intimate' },
  });
  const blockedCmp = await callApi(socialHandler, 'GET', `/api/social/friends/${userB.id}/footprints`, {
    token: tokenA,
    params: { path: ['friends', userB.id, 'footprints'] },
  });
  assert.equal(blockedCmp.status, 403);

  await callApi(socialHandler, 'POST', '/api/social/intimacy/request', {
    token: tokenA,
    params: { path: ['intimacy', 'request'] },
    body: { targetUserId: userB.id, relationType: 'couple', customLabel: '一起看世界', anniversaryDate: '2025-05-20' },
  });
  const ovB2 = await callApi(socialHandler, 'GET', '/api/social/overview', { token: tokenB, params: { path: ['overview'] } });
  await callApi(socialHandler, 'POST', '/api/social/intimacy/respond', {
    token: tokenB,
    params: { path: ['intimacy', 'respond'] },
    body: { bondId: ovB2.json.intimacyBonds[0].id, decision: 'accept' },
  });
  const allowedCmp = await callApi(socialHandler, 'GET', `/api/social/friends/${userB.id}/footprints`, {
    token: tokenA,
    params: { path: ['friends', userB.id, 'footprints'] },
  });
  assert.equal(allowedCmp.status, 200);

  // 5. 面对面 4 位数字建群 + 绑定攻略 + 投票批注 + 群 AA 记账 + 历史版本回退
  const f2fA = await callApi(groupsHandler, 'POST', '/api/groups/face-to-face', {
    token: tokenA,
    params: { path: ['face-to-face'] },
    body: { pinCode: '8866', groupName: '成都吃货小分队' },
  });
  assert.equal(f2fA.status, 200);
  const groupId = f2fA.json.group.id;

  const f2fB = await callApi(groupsHandler, 'POST', '/api/groups/face-to-face', {
    token: tokenB,
    params: { path: ['face-to-face'] },
    body: { pinCode: '8866' },
  });
  assert.equal(f2fB.status, 200);
  assert.equal(f2fB.json.group.id, groupId);
  assert.equal(f2fB.json.group.members.length, 2);

  await callApi(syncHandler, 'POST', '/api/sync/plans/plan_cd_1/bind-group', {
    token: tokenA,
    params: { path: ['plans', 'plan_cd_1', 'bind-group'] },
    body: { groupId },
  });

  // B 协同修改攻略 + 投票 + 批注
  const pushB = await callApi(syncHandler, 'POST', '/api/sync/push', {
    token: tokenB,
    params: { path: ['push'] },
    body: {
      aiPlans: [
        {
          id: 'plan_cd_1',
          baseVersion: 1,
          payload: {
            id: 'plan_cd_1',
            title: '成都 3 日美食行（B 加了熊猫基地）',
            content: {
              request: { destination: '成都', startDate: '2026-12-01', endDate: '2026-12-03', people: 2 },
              days: [{ day: 1, date: '2026-12-01', theme: '熊猫与火锅', activities: [{ id: 'act_1', title: '大熊猫繁育基地' }] }],
            },
          },
        },
      ],
    },
  });
  assert.equal(pushB.json.acceptedPlanVersions.plan_cd_1, 2);

  await callApi(syncHandler, 'POST', '/api/sync/plans/plan_cd_1/vote', {
    token: tokenB,
    params: { path: ['plans', 'plan_cd_1', 'vote'] },
    body: { itemKey: '1:act_1', vote: 'want' },
  });
  await callApi(syncHandler, 'POST', '/api/sync/plans/plan_cd_1/comment', {
    token: tokenB,
    params: { path: ['plans', 'plan_cd_1', 'comment'] },
    body: { itemKey: '1:act_1', content: '记得早起 8 点入园看花花！' },
  });
  const collab = await callApi(syncHandler, 'GET', '/api/sync/plans/plan_cd_1/collab', {
    token: tokenA,
    params: { path: ['plans', 'plan_cd_1', 'collab'] },
  });
  assert.equal(collab.json.votes.length, 1);
  assert.equal(collab.json.comments.length, 1);

  // 回退到 v1
  const revs = await callApi(syncHandler, 'GET', '/api/sync/plans/plan_cd_1/revisions', {
    token: tokenA,
    params: { path: ['plans', 'plan_cd_1', 'revisions'] },
  });
  const v1 = revs.json.revisions.find((r) => r.version === 1);
  const revertRes = await callApi(syncHandler, 'POST', '/api/sync/plans/plan_cd_1/revert', {
    token: tokenA,
    params: { path: ['plans', 'plan_cd_1', 'revert'] },
    body: { revisionId: v1.id },
  });
  assert.equal(revertRes.status, 200);
  assert.equal(revertRes.json.version, 3);
  assert.equal(revertRes.json.payload.title, '成都 3 日美食行');

  // 群 AA 记账
  const expRes = await callApi(groupsHandler, 'POST', `/api/groups/${groupId}/expenses`, {
    token: tokenA,
    params: { path: [groupId, 'expenses'] },
    body: {
      date: '2026-12-01',
      category: 'dinner',
      title: '老码头火锅',
      amountCents: 26800,
      payerUserId: userA.id,
      participantUserIds: [userA.id, userB.id],
    },
  });
  assert.equal(expRes.status, 200);

  // 6. 微信/QQ 分享链接 + 周游口令 + H5 预览页 + 接收副本
  const sh = await callApi(shareHandler, 'POST', '/api/share/create', {
    token: tokenA,
    params: { path: ['create'] },
    body: { planId: 'plan_cd_1', mode: 'copy' },
  });
  assert.equal(sh.status, 201);
  assert.match(sh.json.zhouyouToken, /#ZY:[A-Z0-9]{6}#/);

  const h5 = await callApi(sharePageHandler, 'GET', `/share/${sh.json.code}`, {
    params: { code: sh.json.code },
  });
  assert.equal(h5.status, 200);
  assert.ok(h5.text.includes('成都 3 日美食行'));
  assert.ok(h5.text.includes('zhouyou://share/'));

  const acceptCopy = await callApi(shareHandler, 'POST', `/api/share/${sh.json.code}/accept`, {
    token: tokenB,
    params: { path: [sh.json.code, 'accept'] },
  });
  assert.equal(acceptCopy.status, 200);
  assert.equal(acceptCopy.json.mode, 'copy');
  assert.notEqual(acceptCopy.json.planId, 'plan_cd_1');

  console.log('✅ cloud-backend-test passed: auth, security-question reset, sync, friends, intimacy, footprint privacy, face-to-face group, collab votes/comments, revisions revert, AA expenses, and H5 share all verified!');
}

run().catch((err) => {
  console.error('❌ cloud-backend-test failed:', err);
  process.exit(1);
});
