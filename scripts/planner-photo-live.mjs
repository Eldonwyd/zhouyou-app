import { readServerKey } from '../server/index.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

/** 真实搜图诊断只打印阶段、状态和数量，不输出密钥、Cookie 或完整笔记内容。 */
const title = process.argv[2] || '束河古镇';
const city = process.argv[3] || '丽江市';
const tracedFetch = async (address, options = {}) => {
  const url = new URL(address);
  const start = Date.now();
  try {
    const response = await fetch(address, options);
    const record = { host: url.hostname, path: url.pathname, status: response.status, milliseconds: Date.now() - start };
    if (url.pathname.includes('/tools/search')) {
      const result = await response.clone().json().catch(() => null);
      record.query = JSON.parse(options.body).query;
      record.fields = Object.keys(result ?? {});
      record.results = (result?.results ?? []).map((item) => ({
        title: item.title,
        host: (() => { try { return new URL(item.url).hostname; } catch { return ''; } })(),
        contentLength: String(item.content ?? '').length,
        hasImageMarkdown: /!\[[^\]]*\]\(/.test(item.content ?? ''),
      }));
    }
    if (url.hostname.includes('wikipedia')) {
      const result = await response.clone().json().catch(() => null);
      record.pages = Object.values(result?.query?.pages ?? {}).map((item) => ({ title: item.title, hasThumbnail: Boolean(item.thumbnail?.source) }));
    }
    if (url.hostname.endsWith('xiaohongshu.com')) {
      const html = await response.clone().text();
      record.pageHasPlace = html.includes(title);
      record.pageHasImageMeta = /(?:og:image|twitter:image)/i.test(html);
      record.pageHasLoginPrompt = /登录后|扫码登录|安全验证|访问频繁/.test(html);
      record.pageLength = html.length;
    }
    console.log(JSON.stringify(record));
    return response;
  } catch (error) {
    console.log(JSON.stringify({ host: url.hostname, path: url.pathname, milliseconds: Date.now() - start, error: error.name, code: error.cause?.code ?? '' }));
    throw error;
  }
};
const apiKey = await readServerKey();
console.log(JSON.stringify({ configured: Boolean(apiKey), title, city }));
const service = createPlannerService({ apiKey, fetchImpl: tracedFetch });
const photo = await service.photoFor(title, city, AbortSignal.timeout(90000), true,
  (message) => console.log(JSON.stringify({ diagnostic: message })), { date: process.env.PHOTO_TEST_DATE || '2026-09-15' });
console.log(JSON.stringify({ found: Boolean(photo), sourceHost: photo ? new URL(photo.sourceUrl).hostname : null }));
if (photo) {
  const response = await fetch(photo.url, { signal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ imageStatus: response.status, type: response.headers.get('content-type') }));
  if (process.argv.includes('--save') && response.ok && response.headers.get('content-type')?.startsWith('image/')) {
    const directory = new URL('../.openai/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('planner-photo-live.jpg', directory), Buffer.from(await response.arrayBuffer()));
    await writeFile(new URL('planner-photo-live-source.json', directory), JSON.stringify({ title, city, photo }, null, 2));
    console.log(JSON.stringify({ saved: '.openai/planner-photo-live.jpg' }));
  } else await response.body?.cancel();
}
