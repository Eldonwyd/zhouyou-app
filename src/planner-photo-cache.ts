import { plannerApiUrl } from './api-base';
import { getPlannerPhotoBlob, savePlannerPhotoBlob } from './db';

/** 下载已经在服务端通过验证的照片到浏览器本地；取消或保存失败不得假称成功。 */
export async function cachePlannerResponsePhotos<T>(result: T, signal: AbortSignal): Promise<T> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.assetId === 'string' && /^[a-f\d]{64}$/.test(record.assetId)) ids.add(record.assetId);
    Object.values(record).forEach(visit);
  };
  visit(result);
  for (const id of ids) {
    signal.throwIfAborted();
    if (await getPlannerPhotoBlob(id)) continue;
    const response = await fetch(plannerApiUrl(`photo-file/${id}`), { signal });
    if (!response.ok) throw new Error('行程照片未能下载到本地，请重试');
    const blob = await response.blob();
    // 浏览器再次实际解码，避免服务器缓存文件损坏后仍保存成功。
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    signal.throwIfAborted();
    await savePlannerPhotoBlob(id, blob);
  }
  return result;
}
