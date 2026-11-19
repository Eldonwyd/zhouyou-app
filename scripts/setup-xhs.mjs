import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readServerKey } from '../server/index.mjs';
import { writePhotoSettings } from '../server/server-settings.mjs';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(webRoot, '.xhs-local');
const binary = path.join(runtime, 'xiaohongshu-mcp-windows-amd64.exe');
const expectedHash = '19e8b13418bb6e618951fcc0e8296abaab69688fbdc0a1320b68491d2292885e';

/** 只下载已审阅版本，校验发布方提供的 SHA-256；登录凭据仅存本地忽略目录。 */
export async function startXhs({ install = false } = {}) {
  if (process.platform !== 'win32') throw new Error('此安装脚本面向当前 Windows 电脑');
  let bytes = await readFile(binary).catch(() => null);
  if (!bytes && !install) return;
  if (!bytes) {
    // 使用同一 GitHub Release 的资产 API，避开部分网络对发布页面下载路径的 502。
    const response = await fetch(`https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases/assets/732370098?download=1&request=${Date.now()}`, {
      headers: { 'User-Agent': 'TravelFootprintsSetup', Accept: 'application/octet-stream', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`下载小红书本地工具失败（${response.status}）`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('小红书工具文件校验失败，未运行');
    await mkdir(runtime, { recursive: true });
    await writeFile(binary, bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('本地小红书工具校验失败，未运行');
  const token = await readServerKey('XHS_BRIDGE_TOKEN') || randomBytes(32).toString('hex');
  await writePhotoSettings({ XHS_BRIDGE_URL: 'http://127.0.0.1:18060', XHS_BRIDGE_TOKEN: token });
  try {
    const existing = await fetch('http://127.0.0.1:18060/health', { signal: AbortSignal.timeout(1000) });
    if (existing.ok) return { started: false, running: true };
  } catch { /* 未运行时才启动，不终止未知进程或占用已有端口。 */ }
  const log = await open(path.join(runtime, 'service.log'), 'a');
  const child = spawn(binary, ['-port=127.0.0.1:18060', '-headless=true'], {
    cwd: runtime, windowsHide: true, detached: true, stdio: ['ignore', log.fd, log.fd],
    env: { ...process.env, AUTH_TOKEN: token, COOKIES_PATH: path.join(runtime, 'cookies.json') },
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  await log.close();
  return { started: true, pid: child.pid };
}

const XHS_HEALTH_URL = 'http://127.0.0.1:18060/health';

/** 本地工具 HTTP 服务是否已响应。 */
export async function xhsHealthy(timeoutMs = 1500) {
  try {
    return (await fetch(XHS_HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

let ensuring = null;
/** 确保已安装的本地工具在运行：未运行则启动并等待其 HTTP 服务就绪。
 * 并发调用共用同一次启动，避免重复拉起进程；未安装时不下载，直接返回 false。
 */
export function ensureXhs({ waitMs = 20000 } = {}) {
  ensuring ??= (async () => {
    try {
      if (await xhsHealthy()) return true;
      const result = await startXhs();
      if (!result) return false;
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        if (await xhsHealthy()) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    } catch {
      return false;
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

let keepAliveTimer = null;
/** 后台守护：定期检查本地小红书工具，掉线后自动重新拉起（登录 Cookie 保存在本地文件，重启不需要重新扫码）。 */
export function keepXhsAlive(intervalMs = 30000) {
  if (keepAliveTimer || process.platform !== 'win32') return;
  keepAliveTimer = setInterval(() => { void ensureXhs(); }, intervalMs);
  keepAliveTimer.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await startXhs({ install: process.argv.includes('--install') });
  console.log(JSON.stringify({ ...result, message: '本地小红书工具已启动，首次启动需要准备浏览器；随后在网页图片来源设置中扫码登录。' }));
}
