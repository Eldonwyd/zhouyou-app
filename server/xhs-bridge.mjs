import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicWebUrl } from '../src/planner-domain.ts';
import { extractXhsUrlFromText } from '../src/planner-xhs.ts';
import { waitForPlannerOperation } from './planner-abort.mjs';

const clipText = (value, limit) => String(value ?? '').slice(0, limit);
const XHS_SETUP_MESSAGE = '尚未安装本地小红书连接工具，请在 web 目录运行 npm run setup:xhs。';

const isAllowedXhsHost = (hostname) => {
  const host = String(hostname ?? '').toLowerCase();
  return (
    host === 'xhslink.com' ||
    host.endsWith('.xhslink.com') ||
    host === 'xhslink.cn' ||
    host === 'xiaohongshu.com' ||
    host.endsWith('.xiaohongshu.com')
  );
};

/** 从小红书网页链接中解析笔记 ID 与访问令牌（仅公开 URL 参数，不含凭据）。 */
export function parseXhsFeedRef(rawUrl) {
  try {
    const url = new URL(String(rawUrl ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!isAllowedXhsHost(url.hostname)) return null;
    const match =
      url.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{16,32})(?:\/|$)/i) ??
      url.pathname.match(/\/user\/profile\/[^/]+\/([a-f\d]{16,32})(?:\/|$)/i);
    if (!match) return null;
    const id = match[1];
    const xsecToken = url.searchParams.get('xsec_token') ?? '';
    const canonicalUrl = `https://www.xiaohongshu.com/explore/${id}${xsecToken ? `?${new URLSearchParams({ xsec_token: xsecToken, xsec_source: url.searchParams.get('xsec_source') || 'pc_share' })}` : ''}`;
    return { id, xsecToken, canonicalUrl };
  } catch {
    return null;
  }
}

/** 每次跳转都校验短链或笔记的域名和地址，避免请求站外服务或内网地址。 */
async function resolveXhsUrl(rawUrl, fetchImpl, signal) {
  let current = String(rawUrl ?? '').trim();
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return '';
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    if (!isAllowedXhsHost(parsed.hostname)) return '';
    if (parsed.port && !['80', '443'].includes(parsed.port)) return '';
    if (parseXhsFeedRef(parsed.href)?.xsecToken) return parsed.href;
    if (fetchImpl === fetch) {
      try {
        const records = await lookup(parsed.hostname, { all: true });
        if (
          records.some(({ address: ip }) =>
            isIP(ip) === 6
              ? !/^[23][\da-f]{0,3}:/i.test(ip)
              : !isPublicWebUrl(`https://${ip}/`) || Number(ip.split('.')[0]) >= 224,
          )
        )
          return '';
      } catch {
        return parsed.href;
      }
    }
    let response;
    try {
      response = await fetchImpl(parsed.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return parsed.href;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return parsed.href;
      try {
        current = new URL(location, parsed.href).href;
      } catch {
        return parsed.href;
      }
      continue;
    }
    return parsed.href;
  }
  return current;
}

/** 笔记链接来自实际搜索结果；站点访问参数用于打开原文，不是本地鉴权凭据。 */
function noteUrl(feed) {
  const url = new URL(`https://www.xiaohongshu.com/explore/${feed.id}`);
  url.search = new URLSearchParams({ xsec_token: feed.xsecToken, xsec_source: 'pc_search' });
  return url.href;
}

/** 站内详情常返回 HTTP 图片地址；仅对小红书图片 CDN 升级为 HTTPS。
 * 保留原始路径和签名参数，不放开其他来源、凭据地址或非标准端口。
 */
export function secureImageUrl(value) {
  try {
    const url = new URL(value);
    if (!(url.hostname === 'xhscdn.com' || url.hostname.endsWith('.xhscdn.com'))) return null;
    if (url.protocol === 'http:' && !url.port) url.protocol = 'https:';
    return isPublicWebUrl(url.href) && (!url.port || url.port === '443') ? url.href : null;
  } catch { return null; }
}

/** 允许常见的多城自然语言输入，月份只影响检索顺序，不作地点筛选条件。 */
function matchesDestination(note, destination) {
  const names = destination.split(/[、，,；;→/\s]+|然后|之后|接着|后去|再去|到/)
    .map((name) => name.replace(/(?:\d+|[一二三四五六七八九十两]+)天.*$/, '')
      .replace(/(?:自治州|地区|省|市)$/, '').trim())
    .filter(Boolean);
  if (!names.length || /^(?:中国|全国)(?:当季旅游目的地)?$/.test(destination)) return true;
  const evidence = `${note.title ?? ''} ${note.desc ?? ''}`.replace(/\s/g, '');
  return names.some((name) => evidence.includes(name));
}

/** 仅支持本机服务，方法固定为只读搜索/详情及用户主动发起的扫码登录。
 * 攻略、游客评论及图片共用同一登录会话，最多 2 个请求同时进行；不提供发布、评论或点赞操作。
 */
export function createXhsBridge({ baseUrl = '', token = '', fetchImpl = fetch, maxParallel = 2, ensureRunning = null } = {}) {
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/') throw new Error('小红书服务必须使用本机地址');
  }
  const send = (route, body, signal) => fetchImpl(new URL(route, baseUrl), {
    method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  const request = async (route, body, signal) => {
    if (!baseUrl) throw new Error(XHS_SETUP_MESSAGE);
    const connectionError = (error) => new Error(error?.name === 'TimeoutError'
      ? '等待小红书响应超时，请重试。'
      : '暂时无法连接本地小红书工具，请重试。');
    let response;
    try { response = await send(route, body, signal); } catch (error) {
      signal.throwIfAborted();
      // 工具已经接收的慢请求不重复提交，避免另一轮浏览器加载阻塞用户扫码。
      if (error?.name === 'TimeoutError') throw connectionError(error);
      // 本地工具掉线（进程退出、电脑休眠后等）：自动重新拉起后重试一次。
      let recovered = false;
      try { recovered = await ensureRunning?.(); } catch { /* 恢复失败时仍返回统一的连接错误。 */ }
      signal.throwIfAborted();
      if (!recovered) throw connectionError(error);
      try { response = await send(route, body, signal); } catch (retryError) {
        signal.throwIfAborted();
        throw connectionError(retryError);
      }
    }
    if (!response.ok) throw new Error(response.status === 401 ? '本地小红书工具鉴权失败，请重新配置' : '本地小红书服务暂时不可用');
    const result = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!result?.success || !result.data) throw new Error('小红书未返回有效结果，请检查登录或验证状态');
    return result.data;
  };
  // 实测本地工具可并发：同时 2 个搜索总耗时约 15 秒，一个接一个约 25 秒。
  // 限制为最多 2 个同时进行，兼顾速度与站点风控；超出的请求排队。
  let active = 0;
  const waiting = [];
  const startNext = () => { while (active < maxParallel && waiting.length) waiting.shift()(); };
  const limited = (operation, signal) => {
    // 取消排队后立即返回；轮到它时再次检查，避免过期请求继续打开笔记。
    signal.throwIfAborted();
    const task = new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) { waiting.splice(index, 1); reject(signal.reason); }
      };
      function start() {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) { reject(signal.reason); startNext(); return; }
        active++;
        Promise.resolve().then(operation).then(resolve, reject).finally(() => { active--; startNext(); });
      }
      if (active < maxParallel) start();
      else { waiting.push(start); signal.addEventListener('abort', onAbort, { once: true }); }
    });
    return waitForPlannerOperation(task, signal);
  };
  const detailCache = new Map();
  let loginCache;

  /** 只缓存成功读取的公开笔记详情，减少攻略与配图重复访问同一页面。 */
  async function readDetail(feed, signal) {
    const cached = detailCache.get(feed.id);
    if (cached && Date.now() - cached.time < 600000) return cached.detail;
    const result = await request('/api/v1/feeds/detail', {
      feed_id: feed.id, xsec_token: feed.xsecToken, load_all_comments: false,
    }, signal);
    const detail = result.data ?? result;
    if (detail.note) {
      detailCache.set(feed.id, { detail, time: Date.now() });
      if (detailCache.size > 40) detailCache.delete(detailCache.keys().next().value);
    }
    return detail;
  }

  const validFeed = (feed) => /^[a-f\d]{16,32}$/i.test(feed.id)
    && typeof feed.xsecToken === 'string' && Boolean(feed.xsecToken);

  /** 登录检查会启动浏览器。短暂复用结果，避免每张照片都重复启动检查页面。 */
  async function requireLogin(signal) {
    signal.throwIfAborted();
    if (loginCache?.loggedIn && Date.now() - loginCache.time < 60000) return;
    const data = await request('/api/v1/login/status', null, signal);
    loginCache = { loggedIn: Boolean(data.is_logged_in), time: Date.now() };
    if (!loginCache.loggedIn) throw new Error('小红书尚未登录，请先扫码登录；当前继续使用其他来源');
  }

  return {
    configured: Boolean(baseUrl),
    /** fresh=false 时 2 分钟内确认过“已登录”直接返回，不再开浏览器等约 10 秒；扫码轮询用 fresh=true。 */
    async status(signal, { fresh = false } = {}) {
      if (!baseUrl) return { configured: false, connected: false, loggedIn: false, message: XHS_SETUP_MESSAGE };
      if (!fresh && loginCache?.loggedIn && Date.now() - loginCache.time < 120000)
        return { configured: true, connected: true, loggedIn: true, message: '小红书已登录' };
      try {
        const data = await request('/api/v1/login/status', null, signal);
        loginCache = { loggedIn: Boolean(data.is_logged_in), time: Date.now() };
        return { configured: true, connected: true, loggedIn: loginCache.loggedIn, message: data.is_logged_in ? '小红书已登录' : '本地工具已连接，尚未登录，请获取二维码扫码' };
      } catch (error) {
        if (signal.aborted) throw error;
        loginCache = null;
        return { configured: true, connected: false, loggedIn: false, message: `${error.message} 可以直接获取登录二维码。` };
      }
    },
    async qrcode(signal) {
      const data = await request('/api/v1/login/qrcode', null, signal);
      // 直接扫码入口也可能发现已有会话，后续检查可复用这次确认结果。
      loginCache = { loggedIn: Boolean(data.is_logged_in), time: Date.now() };
      if (loginCache.loggedIn) return { loggedIn: true };
      const image = String(data.img ?? '');
      if (image.length > 2000000 || !/^data:image\/(?:png|jpeg);base64,[a-z\d+/=]+$/i.test(image)) throw new Error('小红书登录二维码无效，请重试');
      return { loggedIn: false, image, timeout: data.timeout };
    },

    /** 读取少量相关笔记和页面已显示的评论；不加载全部评论，也不据此推断总体评分。
     * 优先带月份检索，结果不足再去掉月份；一篇笔记打不开不阻断下一篇。
     */
    /** topic：针对某个不确定问题定向搜索（如“玉龙雪山 冬季 是否开放”），最多读 2 篇，不再按月份重搜。 */
    async travelEvidence({ destination = '', month = '', topic = null }, signal) {
      return limited(async () => {
        await requireLogin(signal);
        const place = clipText(destination.trim() || '全国旅游', 70);
        const notes = [];
        const seen = new Set();
        const wanted = topic ? 2 : 3;
        const keywords = topic
          ? [`${place} ${clipText(topic, 40)}`]
          : (month ? [month, ''] : ['']).map((suffix) => `${place} ${suffix} 旅游攻略 游玩体验`);
        for (const keyword of keywords) {
          signal.throwIfAborted();
          const result = await request('/api/v1/feeds/search', {
            keyword: keyword.replace(/\s+/g, ' ').trim(),
            filters: { note_type: '图文' },
          }, signal);
          for (const feed of (result.feeds ?? []).filter(validFeed).slice(0, 5)) {
            if (seen.has(feed.id)) continue;
            seen.add(feed.id);
            let detail;
            try { detail = await readDetail(feed, signal); }
            catch (error) { if (signal.aborted) throw error; continue; }
            const note = detail.note;
            if (!note || !matchesDestination(note, destination)) continue;
            const description = clipText(note.desc, 4000).trim();
            if (!description) continue; // 不能把仅有标题的搜索卡片包装成已读取攻略。
            const comments = (detail.comments?.list ?? []).slice(0, 8)
              .map((comment) => clipText(comment.content, 200).trim()).filter(Boolean);
            const timestamp = Number(note.time);
            const publishedAt = timestamp > 0 ? new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp) : null;
            const date = publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt.toISOString() : null;
            notes.push({
              title: `小红书攻略与游玩评价 · ${clipText(note.title || feed.noteCard?.displayTitle || place, 160)}`,
              url: noteUrl(feed), date,
              content: `来源：小红书个人游玩经验，非官方信息。作者：${clipText(note.user?.nickname ?? note.user?.nickName ?? '作者见原文', 80)}。${date ? `笔记发布时间：${date}。` : '发布时间未取得。'}\n笔记正文：${description}\n${comments.length ? `当前页面游客评论摘录（非全部评价，不代表总体口碑）：\n${comments.join('\n')}` : '当前未读取到游客评论，不能声称已查看评论或取得总体评分。'}`,
            });
            if (notes.length >= wanted) return notes;
          }
        }
        return notes;
      }, signal);
    },
    /** 查一张参考图。只有“搜索”和“读详情”占用小红书工具名额；AI 选择、封面下载和本地检查不占。
     * useCovers：本地检查可用时先试封面（检查无字、非拼图、非人像才用），省掉约 15 秒的读详情；
     * 封面都不合格再读笔记详情，取正文第 2 张起的图（同样经过检查）。
     */
    async firstPhoto(city, place, signal, accept, progress = () => {}, chooseCandidates = async (items) => items.map((item) => item.id), { useCovers = false } = {}) {
      progress('正在等待小红书检索会话');
      const result = await limited(async () => {
        // 搜索接口本身会验证会话；未知/已登录时直接搜索，省掉单独打开登录页。
        // 若网页刚确认未登录，仍先检查，避免把未登录状态包装成无搜索结果。
        if (loginCache?.loggedIn === false) {
          progress('正在检查小红书登录状态');
          await requireLogin(signal);
        }
        signal.throwIfAborted();
        progress('正在搜索小红书地点照片');
        // 只搜城市和景点，避免额外词缩小结果；风景偏好与出行日期都交给 AI 选图。
        return request('/api/v1/feeds/search', {
          keyword: `${city} ${place}`.trim(), filters: { note_type: '图文' },
        }, signal);
      }, signal);
      const candidates = new Map((result.feeds ?? []).filter(validFeed).slice(0, 20).map((feed) => [feed.id, feed]));
      const selectedIds = await chooseCandidates([...candidates.values()].map((feed) => ({
        id: feed.id, title: clipText(feed.noteCard?.displayTitle, 300),
        description: clipText(feed.noteCard?.desc, 1000),
      })));
      // 只允许模型选择搜索真实返回的编号；不接受模型提供的网址或手写相似度打分。
      const ranked = [...new Set(selectedIds)].map((id) => candidates.get(id)).filter(Boolean);
      if (useCovers) {
        for (const [index, feed] of ranked.slice(0, 4).entries()) {
          signal.throwIfAborted();
          const card = feed.noteCard ?? {};
          const address = [card.cover?.urlDefault, card.cover?.urlPre, card.cover?.url].map(secureImageUrl).find(Boolean);
          if (!address) continue;
          progress(`正在检查小红书封面（${index + 1}/${Math.min(4, ranked.length)}）`);
          const saved = await accept({ url: address, sourceUrl: noteUrl(feed),
            attribution: `小红书参考图 · ${card.user?.nickname ?? card.user?.nickName ?? '作者见原文'} · ${card.displayTitle || place}` });
          if (saved) return saved;
        }
      }
      // 封面不可用：先读 AI 推荐的第一篇；它没有合格的正文图才读第二篇。
      for (const feed of ranked.slice(0, 2)) {
        signal.throwIfAborted();
        progress('正在读取小红书笔记实拍图');
        let detail;
        try { detail = await limited(() => readDetail(feed, signal), signal); }
        catch (error) { if (signal.aborted) throw error; continue; }
        const note = detail.note;
        if (!note) continue;
        // 正文第 1 张即封面，跳过；检查可用时多试一张，因为有些会被判为带字或人像。
        for (const image of (note.imageList ?? []).slice(1)
          .filter((item) => secureImageUrl(item.urlDefault) || secureImageUrl(item.urlPre)).slice(0, useCovers ? 3 : 2)) {
          // 空默认地址仍尝试预览图，保留原有签名、CDN 和安全地址校验。
          const address = [image.urlDefault, image.urlPre].map(secureImageUrl).find(Boolean);
          signal.throwIfAborted();
          progress('正在检查小红书正文图片');
          const saved = await accept({ url: address, sourceUrl: noteUrl(feed),
            attribution: `小红书参考图 · ${note.user?.nickname ?? note.user?.nickName ?? '作者见原文'} · ${note.title || place}` });
          if (saved) return saved;
        }
      }
      return null;
    },

    /** 根据用户粘贴的小红书分享口令或笔记链接读取单篇公开笔记正文、评论与安全图片地址。 */
    async readNoteByUrl(rawInput, signal) {
      const extracted = extractXhsUrlFromText(rawInput);
      if (!extracted) throw new Error('未识别到小红书链接，请粘贴完整链接、分享口令或直接上传截图');
      const resolvedUrl = await resolveXhsUrl(extracted, fetchImpl, signal);
      const ref = parseXhsFeedRef(resolvedUrl) ?? parseXhsFeedRef(extracted);
      if (!ref) throw new Error('未能从该小红书链接解析出笔记编号，可能是短链已失效或受站点限制，请改为截图粘贴');
      if (!ref.xsecToken) {
        throw new Error('该小红书链接缺少访问令牌（xsec_token），请从小红书 App「分享 → 复制链接」获取完整口令，或直接截图后 Ctrl+V 粘贴');
      }
      if (!baseUrl) {
        throw new Error('尚未配置本地小红书连接工具，无法自动读取链接内容；请先在右上角连接小红书，或直接上传/粘贴笔记截图与正文');
      }
      return limited(async () => {
        await requireLogin(signal);
        const detail = await readDetail({ id: ref.id, xsecToken: ref.xsecToken }, signal);
        const note = detail?.note;
        if (!note) throw new Error('小红书未返回该笔记内容，请确认笔记未删除，或直接截图后粘贴');
        const title = clipText(note.title || '', 160).trim();
        const desc = clipText(note.desc || '', 6000).trim();
        const author = clipText(note.user?.nickname ?? note.user?.nickName ?? '', 80).trim();
        const comments = (detail.comments?.list ?? [])
          .slice(0, 12)
          .map((item) => clipText(item?.content, 240).trim())
          .filter(Boolean);
        const images = (note.imageList ?? [])
          .map((item) => [item?.urlDefault, item?.urlPre, item?.url].map(secureImageUrl).find(Boolean))
          .filter(Boolean)
          .slice(0, 9);
        const timestamp = Number(note.time);
        const published = timestamp > 0 ? new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp) : null;
        const publishedAt = published && Number.isFinite(published.getTime()) ? published.toISOString() : undefined;
        return {
          id: ref.id,
          url: ref.canonicalUrl,
          title,
          desc,
          author,
          publishedAt,
          comments,
          images,
        };
      }, signal);
    },
  };
}
