/**
 * 无状态、严格白名单的 AI 边缘转发代理（Cloudflare Pages Function）。
 * 用途：帮助手机/桌面 PWA 网页版绕过浏览器 CORS 限制，直接调用官方订阅 OAuth、额度查询与模型推理接口。
 * 安全约束：
 * - 仅允许 HTTPS 且目标 Host 必须在官方白名单内，杜绝 SSRF 与开放代理滥用；
 * - 仅允许来自本项目域名（zhouyou.online / eldonwyd.github.io / pages.dev / localhost）的跨域请求；
 * - 完全无状态，不记录日志、不缓存、不保存用户的任何 Token 或对话内容。
 */

const ALLOWED_HOSTS = new Set([
  'auth.openai.com',
  'chatgpt.com',
  'api.openai.com',
  'platform.claude.com',
  'api.anthropic.com',
  'auth.kimi.com',
  'api.kimi.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'dashscope.aliyuncs.com',
  'open.bigmodel.cn',
  'api.moonshot.cn',
  'ark.cn-beijing.volces.com',
]);

const ALLOWED_METHODS = new Set(['GET', 'POST']);

const ALLOWED_REQ_HEADERS = new Set([
  'authorization',
  'content-type',
  'accept',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'chatgpt-account-id',
  'originator',
  'user-agent',
]);

function resolveAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '*';
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'zhouyou.online'
      || host === 'www.zhouyou.online'
      || host.endsWith('.zhouyou.online')
      || host === 'eldonwyd.github.io'
      || host.endsWith('.pages.dev')
      || host === 'localhost'
      || host === '127.0.0.1'
    ) {
      return origin;
    }
  } catch {
    // invalid origin
  }
  return '';
}

function corsHeaders(request) {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function jsonResponse(request, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export async function onRequestOptions(context) {
  const allowed = resolveAllowedOrigin(context.request);
  if (!allowed) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
}

export async function onRequestGet(context) {
  return jsonResponse(context.request, 200, {
    ok: true,
    service: 'zhouyou-ai-proxy',
    hosts: [...ALLOWED_HOSTS],
  });
}

export async function onRequestPost(context) {
  const { request } = context;
  const origin = request.headers.get('Origin') || '';
  if (origin && !resolveAllowedOrigin(request)) {
    return jsonResponse(request, 403, { error: 'Origin not allowed' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, 400, { error: 'Invalid JSON request body' });
  }

  const rawUrl = typeof payload?.url === 'string' ? payload.url.trim() : '';
  const method = typeof payload?.method === 'string' ? payload.method.toUpperCase() : 'GET';
  if (!rawUrl || !ALLOWED_METHODS.has(method)) {
    return jsonResponse(request, 400, { error: 'Missing url or unsupported HTTP method' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return jsonResponse(request, 400, { error: 'Malformed target URL' });
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.port) {
    return jsonResponse(request, 403, { error: 'Only standard HTTPS targets are allowed' });
  }
  if (!ALLOWED_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    return jsonResponse(request, 403, { error: `Host not in allowlist: ${parsedUrl.hostname}` });
  }

  const forwardHeaders = new Headers();
  if (payload?.headers && typeof payload.headers === 'object') {
    for (const [k, v] of Object.entries(payload.headers)) {
      const lower = String(k).toLowerCase();
      if (ALLOWED_REQ_HEADERS.has(lower) && typeof v === 'string' && v.length <= 8192) {
        forwardHeaders.set(k, v);
      }
    }
  }
  if (!forwardHeaders.has('User-Agent')) {
    forwardHeaders.set('User-Agent', 'Zhouyou-Map/1.0');
  }

  const body = method === 'POST' && typeof payload?.body === 'string' ? payload.body : undefined;
  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(payload?.timeoutMs) || 90_000));

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      method,
      headers: forwardHeaders,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseBody = await upstream.text();
    const contentType = upstream.headers.get('content-type') || '';
    return jsonResponse(request, 200, {
      status: upstream.status,
      body: responseBody,
      headers: contentType ? { 'content-type': contentType } : {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed';
    return jsonResponse(request, 502, { error: message });
  }
}
