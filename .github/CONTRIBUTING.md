# 贡献指南 · Contributing to Zhouyou Map

非常欢迎你为 **周游地图（Zhouyou Map）** 提交代码、修复问题、优化界面或完善文档！

## 🚀 本地开发环境

### 环境要求

- **Node.js** `>= 22.0.0`（推荐 Node.js 24 LTS）
- **npm** `>= 10`
- 如需打包移动端：Android Studio / JDK 21（Android）或 macOS + Xcode（iOS）

### 快速启动

```bash
git clone https://github.com/Eldonwyd/zhouyou-app.git
cd zhouyou-app
npm install

# 启动网页开发模式（前端 + 本地 AI 规划服务同端口运行）
npm run dev

# 启动桌面端 Electron 开发预览
npm run desktop:dev
```

## ✅ 提交前检查清单

在提交 Pull Request 前，请确保通过基础校验：

```bash
# TypeScript 类型检查
npm run check

# 地图边界数据校验
npm run test:maps

# 生产构建与 Electron 内置服务打包校验
npm run build
npm run build:electron-server
```

如需运行完整浏览器端到端测试（需要本机 Chrome 且先运行 `npm run dev`）：

```bash
npm run test:web
npm run test:mobile
npm run test:planner
```

## 🌿 分支与提交规范

1. 从 `main` 分支拉取特性分支（如 `feat/map-export` 或 `fix/ios-audio`）。
2. 提交信息建议简洁清晰，说明改动意图（如 `Add macOS universal build` / `Fix journal date sorting`）。
3. **严禁提交任何个人密钥、本地缓存或会话文件**：`.env.local`、`.ai-auth.json`、`.planner-photos/`、`.models/`、`.xhs-local/` 均已在 `.gitignore` 中排除。
4. 如改动了 UI 交互或布局，建议在 PR 中附上桌面端或移动端截图。

## 🐛 报告问题与功能建议

请使用仓库内置的 [Issue 模板](https://github.com/Eldonwyd/zhouyou-app/issues/new/choose)，并注明：

- 使用的平台与版本（Windows / macOS / Linux / Android / iOS / Web）
- 复现步骤与预期表现
- 如涉及 AI 规划，请说明当前配置的服务商名称（**切勿贴出 API Key**）

感谢每一位旅人与开发者的支持！✨
