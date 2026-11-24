import { readFileSync } from 'node:fs';
import { defineConfig, type Connect, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string };
const appVersion = String(pkg.version || '1.0.0');

/** 每个开发网页直接处理规划 API，避免依赖另一个开发进程占用的固定端口。 */
function plannerApiPlugin(): Plugin {
  return {
    name: 'planner-api',
    apply: 'serve',
    async configureServer(vite) {
      // 通过 Node 原生 import 加载使用 Sharp、ONNX 的后端，避免 Vite 打包原生依赖。
      const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<{
        createPlannerRequestHandler(): Promise<Connect.SimpleHandleFunction>;
      }>;
      const serverUrl = new URL('./server/index.mjs', import.meta.url).href;
      const { createPlannerRequestHandler } = await nativeImport(serverUrl);
      const handlePlannerRequest = await createPlannerRequestHandler();
      // 保留完整 URL 供后端路由匹配；其余请求由 Vite 处理。
      vite.middlewares.use((request, response, next) => {
        if (!request.originalUrl?.startsWith('/api/planner/')) return next();
        handlePlannerRequest(request, response);
      });
      vite.config.logger.info('AI 规划服务已随网页启动。');
    },
  };
}

// A relative base lets the static build work under a subdirectory as well as a domain root.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [plannerApiPlugin()],
  server: { host: '0.0.0.0' },
  build: { target: 'es2022' },
});
