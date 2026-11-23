import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';
import { isPublicWebUrl } from '../src/planner-domain.ts';
import { getDataPath } from './runtime-paths.mjs';

export const validPlannerPhotoId = (id) => typeof id === 'string' && /^[a-f\d]{64}$/.test(id);

/** 所有图片下载逐跳检查地址，拒绝内网/本机/凭据 URL；不向图片站发送搜索密钥。 */
export async function fetchPlannerPhotoBytes(address, signal, fetchImpl = fetch) {
  const limit = 8 * 1024 * 1024;
  for (let redirect = 0; redirect < 4; redirect++) {
    signal.throwIfAborted();
    if (!isPublicWebUrl(address)) throw new Error('图片地址不受支持');
    const url = new URL(address);
    if (url.port && url.port !== '443') throw new Error('图片端口不受支持');
    if (fetchImpl === fetch) {
      const records = await lookup(url.hostname, { all: true });
      if (!records.length || records.some(({ address: ip }) => isIP(ip) === 6
        ? !/^[23][\da-f]{0,3}:/i.test(ip)
        : !isPublicWebUrl(`https://${ip}/`) || Number(ip.split('.')[0]) >= 224)) throw new Error('图片地址不能指向本地网络');
    }
    signal.throwIfAborted(); // DNS 解析期间可能已取消；此时不再发出下载请求。
    const response = await fetchImpl(address, {
      redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      headers: { 'User-Agent': 'TravelFootprints/1.0 (local itinerary photos)', Accept: 'image/webp,image/jpeg,image/png' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) throw new Error('图片重定向无效');
      address = new URL(next, address).href;
      continue;
    }
    const type = response.headers.get('content-type')?.split(';')[0].toLowerCase();
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type) || !response.body) {
      await response.body?.cancel();
      throw new Error('图片无法下载或返回的不是照片');
    }
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('图片过大'); }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('图片过大');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    // 完整解码而非只检查响应头，拒绝损坏图片、SVG、跟踪像素和解压炸弹。
    const input = Buffer.concat(chunks);
    const metadata = await sharp(input, { limitInputPixels: 24000000, failOn: 'warning' }).metadata();
    if (metadata.width < 160 || metadata.height < 100) throw new Error('图片尺寸不足');
    return sharp(input, { limitInputPixels: 24000000, failOn: 'warning' }).rotate()
      .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  }
  throw new Error('图片重定向过多');
}

/** 磁盘缓存只存已验证图片及可读来源；文件名由内容散列生成，重启服务后仍可复用。 */
export function createPlannerPhotoStore({ directory = getDataPath('.planner-photos'), fetchImpl = fetch } = {}) {
  const keyFor = (query) => createHash('sha256').update(query).digest('hex');
  const atomicWrite = async (filename, bytes) => {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, filename);
  };
  return {
    async get(query) {
      try {
        const photo = JSON.parse(await readFile(path.join(directory, `${keyFor(query)}.json`), 'utf8'));
        if (!validPlannerPhotoId(photo.assetId) || !isPublicWebUrl(photo.url) || !isPublicWebUrl(photo.sourceUrl)) return null;
        await readFile(path.join(directory, `${photo.assetId}.webp`));
        return photo;
      } catch { return null; }
    },
    /** inspect 可选：返回不可用原因（如“图上有文字”）时放弃保存，由调用方换下一张。 */
    async save(query, photo, signal, inspect) {
      const bytes = await fetchPlannerPhotoBytes(photo.url, signal, fetchImpl);
      signal.throwIfAborted();
      const rejected = inspect ? await inspect(bytes) : null;
      signal.throwIfAborted();
      if (rejected) throw Object.assign(new Error(rejected), { code: 'PHOTO_REJECTED' });
      const assetId = createHash('sha256').update(bytes).digest('hex');
      const saved = { ...photo, assetId, storedAt: new Date().toISOString() };
      await mkdir(directory, { recursive: true });
      await atomicWrite(path.join(directory, `${assetId}.webp`), bytes);
      await atomicWrite(path.join(directory, `${keyFor(query)}.json`), JSON.stringify(saved));
      return saved;
    },
    async read(assetId) {
      if (!validPlannerPhotoId(assetId)) throw new Error('本地图片编号无效');
      return readFile(path.join(directory, `${assetId}.webp`));
    },
  };
}
