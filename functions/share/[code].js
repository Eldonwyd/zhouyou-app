import { getDb } from '../../cloud-lib/cloud.js';
import { trackDailyMetric } from '../../cloud-lib/admin-telemetry.js';

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 微信/QQ 精美行程分享预览页：https://zhouyou.online/share/:code
 * - 免登录直接预览行程亮点；
 * - 已安装 App 尝试拉起 zhouyou://share/:code；
 * - 微信/QQ 内置浏览器受限时提供「一键复制周游口令」+「下载周游地图 App」+「网页版直接接收」三保险。
 */
export async function onRequestGet(context) {
  const code = String(context.params?.code || '').trim().toUpperCase();
  const origin = new URL(context.request.url).origin;

  let share = null;
  let errorText = '';
  try {
    const db = getDb(context);
    const row = await db.prepare('SELECT * FROM plan_shares WHERE code = ?').bind(code).first();
    if (!row) {
      errorText = '未找到这份行程分享，可能链接有误或已被删除。';
    } else if (Date.parse(row.expires_at) <= Date.now()) {
      errorText = '这份行程分享链接已过期，请让好友重新发送一份。';
    } else {
      share = row;
      trackDailyMetric(context, 'share_view', row.mode || 'copy', 1, 0);
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : '服务暂不可用，请稍后重试。';
  }

  const summary = share ? (() => { try { return JSON.parse(share.summary_json || '{}'); } catch { return {}; } })() : {};
  const title = share ? share.title : '周游地图 · 行程分享';
  const modeLabel = share?.mode === 'collab' ? '邀请你加入行程群 · 共同编辑' : '给你分享了一份旅行攻略';
  const zhouyouToken = share
    ? `【周游地图】${share.sender_nickname}${share.mode === 'collab' ? '邀请你一起同行' : '分享了攻略'}《${share.title}》，复制本段文字打开周游地图即可接收 #ZY:${code}#`
    : '';
  const deepLink = `zhouyou://share/${encodeURIComponent(code)}`;
  const webOpenLink = `${origin}/?share=${encodeURIComponent(code)}`;
  const downloadLink = `${origin}/download.html`;

  const highlightsHtml = (summary.highlights || [])
    .map((day) => `
      <div class="day-card">
        <div class="day-head">
          <span class="day-badge">Day ${escapeHtml(day.day)}</span>
          <strong>${escapeHtml(day.theme || '行程安排')}</strong>
          ${day.date ? `<small>${escapeHtml(day.date)}</small>` : ''}
        </div>
        ${Array.isArray(day.stops) && day.stops.length
          ? `<div class="stops">${day.stops.map((s) => `<span class="stop-pill">${escapeHtml(s)}</span>`).join('')}</div>`
          : ''}
      </div>
    `)
    .join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(title)} · 周游地图</title>
  <style>
    :root { --bg: #fff8f2; --card: #ffffff; --ink: #3c2e2a; --muted: #8a7670; --accent: #eb6b56; --accent-soft: #ffe8cf; --line: #eeddd0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif; background: linear-gradient(180deg, #fff1e6 0%, var(--bg) 42%); color: var(--ink); min-height: 100vh; padding: 20px 16px 40px; }
    .wrap { max-width: 540px; margin: 0 auto; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font-weight: 700; color: var(--ink); }
    .brand-dot { width: 32px; height: 32px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center; font-size: 16px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 22px 20px; box-shadow: 0 12px 32px rgba(96, 56, 40, 0.08); }
    .pill { display: inline-block; padding: 4px 12px; border-radius: 999px; background: var(--accent-soft); color: #b54532; font-size: 12px; font-weight: 600; margin-bottom: 10px; }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.35; }
    .meta { color: var(--muted); font-size: 14px; margin-bottom: 18px; display: flex; flex-wrap: wrap; gap: 10px; }
    .day-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; background: #fffdfb; }
    .day-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .day-badge { background: #e8f5ec; color: #2f7a4d; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 8px; }
    .day-head small { color: var(--muted); margin-left: auto; }
    .stops { display: flex; flex-wrap: wrap; gap: 6px; }
    .stop-pill { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: #f8efe8; color: #5f4c45; }
    .actions { display: grid; gap: 10px; margin-top: 20px; }
    .btn { display: block; width: 100%; text-align: center; text-decoration: none; border: none; border-radius: 14px; padding: 13px 16px; font-size: 15px; font-weight: 700; cursor: pointer; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-secondary { background: #fff2e8; color: #b54532; border: 1px solid #f2cbb8; }
    .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 600; }
    .token-box { margin-top: 14px; padding: 12px; border-radius: 12px; background: #faf4ee; border: 1px dashed #dfc6b5; font-size: 13px; color: #6a554c; word-break: break-all; }
    .wx-tip { display: none; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: #fff7db; color: #7a5700; font-size: 13px; line-height: 1.5; }
    .err { text-align: center; padding: 28px 12px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="brand-dot">周</div>
      <span>周游地图 · 同行旅伴</span>
    </div>
    <div class="card">
      ${errorText ? `
        <div class="err">
          <h2>暂无法打开这份分享</h2>
          <p>${escapeHtml(errorText)}</p>
          <div class="actions">
            <a class="btn btn-primary" href="${escapeHtml(origin)}">打开周游地图</a>
            <a class="btn btn-secondary" href="${escapeHtml(downloadLink)}">下载周游地图 App</a>
          </div>
        </div>
      ` : `
        <span class="pill">${escapeHtml(share.sender_nickname)} · ${escapeHtml(modeLabel)}</span>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          ${summary.destination ? `<span>📍 ${escapeHtml(summary.destination)}</span>` : ''}
          ${summary.daysCount ? `<span>🗓 ${escapeHtml(summary.daysCount)} 天行程</span>` : ''}
          ${summary.startDate ? `<span>📅 ${escapeHtml(summary.startDate)}${summary.endDate ? ` ~ ${escapeHtml(summary.endDate)}` : ''}</span>` : ''}
        </div>
        ${highlightsHtml || '<p style="color:#8a7670;font-size:14px;">打开周游地图即可查看完整每日行程、预算与地图路线。</p>'}
        <div id="wx-tip" class="wx-tip">
          检测到你在微信 / QQ 内打开：系统可能拦截直接唤起 App。你可以点击下方<strong>「复制周游口令」</strong>后打开周游地图自动接收，或点击右上角「···」选择在默认浏览器打开。
        </div>
        <div class="actions">
          <button id="open-app-btn" type="button" class="btn btn-primary">在周游地图 App 中打开</button>
          <button id="copy-token-btn" type="button" class="btn btn-secondary">复制周游口令（打开 App 自动识别）</button>
          <a class="btn btn-ghost" href="${escapeHtml(webOpenLink)}">直接用网页版接收</a>
          <a class="btn btn-ghost" href="${escapeHtml(downloadLink)}">还没安装？前往下载周游地图</a>
        </div>
        <div class="token-box" id="token-text">${escapeHtml(zhouyouToken)}</div>
      `}
    </div>
  </div>
  ${errorText ? '' : `
  <script>
    (function () {
      var ua = navigator.userAgent || '';
      var isInAppBrowser = /MicroMessenger|QQ\\/|Weibo/i.test(ua);
      if (isInAppBrowser) {
        var tip = document.getElementById('wx-tip');
        if (tip) tip.style.display = 'block';
      }
      var openBtn = document.getElementById('open-app-btn');
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          if (isInAppBrowser) {
            copyToken(true);
            return;
          }
          var start = Date.now();
          window.location.href = ${JSON.stringify(deepLink)};
          setTimeout(function () {
            if (!document.hidden && Date.now() - start < 2600) {
              window.location.href = ${JSON.stringify(downloadLink)};
            }
          }, 1600);
        });
      }
      function copyToken(fromOpen) {
        var text = ${JSON.stringify(zhouyouToken)};
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            alert(fromOpen ? '已为你复制周游口令！现在切换打开「周游地图 App」即可自动弹窗接收。' : '已复制周游口令，打开周游地图 App 即可自动识别接收！');
          }).catch(function () { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
      }
      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); alert('已复制周游口令，打开周游地图 App 即可自动识别！'); } catch (e) {}
        document.body.removeChild(ta);
      }
      var copyBtn = document.getElementById('copy-token-btn');
      if (copyBtn) copyBtn.addEventListener('click', function () { copyToken(false); });
    })();
  </script>
  `}
</body>
</html>`;

  return new Response(html, {
    status: share ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
