import { plannerApiUrl } from './api-base';
import { cachePlannerResponsePhotos } from './planner-photo-cache';
import { readLanguage } from './i18n';
import { isWebTourMode } from './web-tour';
import {
  FREE_TRIAL_PROVIDER_ID,
  handleMobilePlannerApi,
  isDesktopFreeTrialEnabled,
  isMobileNativeAiActive,
  recordAiUsage,
  setDesktopFreeTrialEnabled,
} from './mobile-ai-runtime';

const USAGE_TRACKED_ENDPOINTS = new Set(['generate', 'chat', 'recommendations', 'duration', 'tickets', 'packing', 'transfers']);

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
  if (isMobileNativeAiActive()) {
    return handleMobilePlannerApi<T>(endpoint, body, signal, onProgress);
  }
  // 桌面端切换使用「周游免费体验 AI」时，走云端免费通道；切回本地其他模型时关闭免费标记
  if (endpoint === 'ai-switch' && body && typeof body === 'object') {
    const prov = String((body as Record<string, unknown>).provider || '');
    if (prov === FREE_TRIAL_PROVIDER_ID) {
      setDesktopFreeTrialEnabled(true);
      return handleMobilePlannerApi<T>(endpoint, body, signal, onProgress);
    }
    setDesktopFreeTrialEnabled(false);
  } else if (
    endpoint === 'ai-settings'
    && body
    && typeof body === 'object'
    && ('provider' in body || 'apiKey' in body)
  ) {
    // 仅在真正保存其他服务商 API Key 时关闭免费体验，读取 ai-settings({}) 不应清除状态
    setDesktopFreeTrialEnabled(false);
  }
  if (
    isDesktopFreeTrialEnabled()
    && (USAGE_TRACKED_ENDPOINTS.has(endpoint) || endpoint === 'ai-test' || endpoint === 'health')
  ) {
    return handleMobilePlannerApi<T>(endpoint, body, signal, onProgress);
  }
  const isReadingAiSettingsWithFreeTrial =
    isDesktopFreeTrialEnabled()
    && endpoint === 'ai-settings'
    && (!body || (typeof body === 'object' && !('provider' in body) && !('apiKey' in body)));
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
    if (isReadingAiSettingsWithFreeTrial) {
      return handleMobilePlannerApi<T>('health', {}, signal, onProgress);
    }
    throw new Error(readLanguage() === 'en'
      ? 'Cannot connect to AI server: on desktop restart the app; on mobile/web configure the server URL in Profile → Settings → Remote / LAN AI Server.'
      : '无法连接 AI 服务：桌面版请直接重启应用，手机版请在「个人中心 → 设置 → 远程 / 局域网 AI 服务」填写电脑/服务器地址');
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? `本地服务请求失败（${response.status}）`);
  }
  if (!response.headers.get('content-type')?.includes('ndjson')) {
    const data = await response.json() as T;
    if (isReadingAiSettingsWithFreeTrial && data && typeof data === 'object') {
      const freeStatus = await handleMobilePlannerApi<Record<string, unknown>>('health', {}, signal, onProgress);
      return {
        ...(data as Record<string, unknown>),
        configured: freeStatus.configured,
        provider: FREE_TRIAL_PROVIDER_ID,
        authMode: 'free',
        label: freeStatus.label,
        model: freeStatus.model,
        modelId: freeStatus.modelId,
        models: freeStatus.models,
      } as T;
    }
    if (USAGE_TRACKED_ENDPOINTS.has(endpoint)) {
      recordAiUsage({ provider: 'server', label: '本地 / 远程 AI 服务', authMode: 'api' });
    }
    return cachePlannerResponsePhotos(data, signal);
  }
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
  if (USAGE_TRACKED_ENDPOINTS.has(endpoint)) {
    recordAiUsage({ provider: 'server', label: '本地 / 远程 AI 服务', authMode: 'api' });
  }
  onProgress(endpoint === 'photo' ? '正在保存照片到本地' : '正在保存照片与行程到本地');
  return cachePlannerResponsePhotos(result, signal);
}
