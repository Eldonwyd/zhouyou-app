import { plannerApiUrl } from './api-base';
import { cachePlannerResponsePhotos } from './planner-photo-cache';
import { readLanguage } from './i18n';
import { isWebTourMode } from './web-tour';

/** Consume server progress without exposing the provider key to the browser. */
export async function plannerApi<T>(
  endpoint: string,
  body: unknown,
  signal: AbortSignal,
  onProgress: (stage: string) => void,
): Promise<T> {
  if (isWebTourMode()) {
    throw new Error(readLanguage() === 'en'
      ? 'AI planning is disabled in Online Web Tour mode. Please download the Desktop or Mobile client for full AI capabilities.'
      : '在线体验模式暂不支持 AI 调用，请下载电脑桌面版或手机客户端解锁完整 AI 规划与离线 OCR。');
  }
  const url = plannerApiUrl(endpoint);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(readLanguage() === 'en'
      ? 'Cannot connect to AI server: on desktop restart the app; on mobile/web configure the server URL in Profile → Settings → Remote / LAN AI Server.'
      : '无法连接 AI 服务：桌面版请直接重启应用，手机版请在「个人中心 → 设置 → 远程 / 局域网 AI 服务」填写电脑/服务器地址');
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? `本地服务请求失败（${response.status}）`);
  }
  if (!response.headers.get('content-type')?.includes('ndjson'))
    return cachePlannerResponsePhotos(await response.json() as T, signal);
  if (!response.body) throw new Error('浏览器不支持读取 AI 响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; stage?: string; error?: string; result?: T };
    if (event.type === 'progress') onProgress(event.stage ?? '正在规划…');
    if (event.type === 'error') throw new Error(event.error ?? '规划失败，请重试');
    if (event.type === 'result') result = event.result;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  if (result === undefined) throw new Error('AI 响应中断，原计划已保留，请重试');
  onProgress(endpoint === 'photo' ? '正在保存照片到本地' : '正在保存照片与行程到本地');
  return cachePlannerResponsePhotos(result, signal);
}
