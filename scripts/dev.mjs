import { createServer } from 'vite';
import { startXhs } from './setup-xhs.mjs';

// 仅启动用户已经安装并授权过的工具；普通启动绝不下载第三方程序。
await startXhs().catch(() => process.stdout.write('本地小红书工具未能启动，可在图片来源设置查看状态。\n'));
// 规划 API 由 Vite 插件接入网页服务，网页与请求处理器随同一个进程启动和退出。
const vite = await createServer({
  configLoader: 'runner',
  server: { host: '0.0.0.0', strictPort: true },
});
await vite.listen();
vite.printUrls();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await vite.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
