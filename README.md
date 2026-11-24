<div align="center">

<img src="https://eldonwyd.github.io/zhouyou-app/icons/icon-512.png" alt="周游地图 Zhouyou Map Logo" width="124" height="124" />

# 周游地图 · Zhouyou Map

**点亮中国旅行足迹 · AI 一键规划行程 · 珍藏每次旅途的照片手账回忆**

<p>
  <a href="README.md"><b>简体中文</b></a>
  &nbsp;·&nbsp;
  <a href="docs/README_EN.md">English</a>
</p>

<p>
  <a href="https://github.com/Eldonwyd/zhouyou-app/releases">
    <img src="https://img.shields.io/github/v/release/Eldonwyd/zhouyou-app?style=flat-square&logo=github&color=ef6351&label=Release" alt="Latest Release" />
  </a>
  <a href="https://github.com/Eldonwyd/zhouyou-app/releases">
    <img src="https://img.shields.io/github/downloads/Eldonwyd/zhouyou-app/total?style=flat-square&logo=icloud&color=1d6478&label=Downloads" alt="Total Downloads" />
  </a>
  <a href="https://github.com/Eldonwyd/zhouyou-app/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/Eldonwyd/zhouyou-app/ci.yml?branch=main&style=flat-square&logo=githubactions&label=CI" alt="CI Status" />
  </a>
  <a href="https://github.com/Eldonwyd/zhouyou-app/stargazers">
    <img src="https://img.shields.io/github/stars/Eldonwyd/zhouyou-app?style=flat-square&logo=github&color=f4a236" alt="GitHub Stars" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-2da44e?style=flat-square" alt="MIT License" />
  </a>
</p>

<p>
  <img src="https://img.shields.io/badge/Desktop-Windows%20%7C%20macOS%20%7C%20Linux-2c3e50?style=flat-square&logo=electron&logoColor=9feaf9" alt="Desktop Platforms" />
  <img src="https://img.shields.io/badge/Mobile-Android%20%7C%20iOS-0f62fe?style=flat-square&logo=capacitor&logoColor=white" alt="Mobile Platforms" />
  <img src="https://img.shields.io/badge/Web-PWA%20离线可用-1d6478?style=flat-square&logo=googlechrome&logoColor=white" alt="Web PWA" />
</p>

<p>
  <a href="#-电脑版下载"><b>💻 电脑版下载</b></a>
  &nbsp;·&nbsp;
  <a href="#-手机版下载"><b>📱 手机版下载</b></a>
  &nbsp;·&nbsp;
  <a href="https://eldonwyd.github.io/zhouyou-app/"><b>✨ 在线网页版 (PWA)</b></a>
  &nbsp;·&nbsp;
  <a href="#-界面预览"><b>🖼️ 界面预览</b></a>
  &nbsp;·&nbsp;
  <a href="#-核心亮点"><b>🧭 核心亮点</b></a>
  &nbsp;·&nbsp;
  <a href="#-开发者快速开始"><b>🛠️ 本地开发</b></a>
</p>

<br />

<!-- 根据 GitHub 深浅色主题自动切换中国足迹地图主图 -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-map-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-map-light.png" />
  <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-map-light.png" alt="周游地图 · 中国旅行足迹地图主界面" width="100%" />
</picture>

</div>

---

## 🌟 核心亮点

**周游地图** 是一款专为旅行爱好者打造的**本地隐私优先、全平台独立运行**的个人旅行小册子，围绕旅行前、中、后的真实体验打磨三大核心能力：

### 🗺️ 1. 地图足迹记录 —— 点亮你走过的每一座城
- **全国 34 省 × 370+ 城市边界**：支持省级缩放下钻与智能标签避让，点击即可点亮 **「已去过」** 或标记 **「计划前往」**，实时统计探索百分比与足迹总览。
- **离线地图随时看**：支持按省份一键缓存离线边界数据，乘飞机、坐高铁或无网环境下依旧流畅浏览。

### 🤖 2. AI 一键规划 —— 从想法到完整路书一步到位
- **智能生成全套方案**：只需输入目的地、日期/天数、同行人群（成人/学生/老人/儿童独立票价）与预算，AI 一键规划每日顺路行程、景点图文、站间交通接驳、住宿建议与预算拆解。
- **随问随改、贴心实用**：支持对话微调局部行程、锁定满意景点、查看交互式路线地图、生成出发日历提醒、AI 行李清单、本地离线 **PP-OCRv5** 识别高铁/机票/酒店截图，以及导出**单文件离线 HTML 路书**。
- **多模型自由切换**：原生支持 DeepSeek、OpenAI、Claude、Gemini、通义千问、智谱、Kimi 及主流订阅账号，密钥仅保存在本机。

### 📸 3. 照片手账记录 —— 把每次旅行珍藏成册，随时回味
- **每次旅行都有专属故事页**：按「某次旅行」或「某座城市」归档原图照片、视频、文字便签与现场语音评语，自动读取照片拍摄时间线并校验 GPS 归属城市。
- **城市明信片与高光时刻**：每座点亮的城市自动配备专属地标明信片封面，可标记「高光时刻」、撰写多段旅途感悟，把散落在相册里的回忆整理成一本随时可翻阅的温暖手账。

### ✨ 还有更多让旅途更顺手的小细节
- **💰 每日账本与 AA 分账**：按三餐/交通/门票/住宿/其他逐日记账，支持多人出行整数分精确 AA 结算。
- **🏆 8 阶旅人成长路线与纪念章**：记录从「新手小旅人」到「传奇环游家」的成长轨迹，支持手作纪念章与一键导出成就海报。
- **🎨 5 套高颜值皮肤 × 深浅色模式**：内置糖果贴纸、纯白极简、纸感手账、海风海岸、暖日手账五种风格，支持浅色 / 深色 / 跟随系统。
- **🔒 数据完全属于你**：无广告、无强制登录，全部记录与原图保存在本机 IndexedDB，支持 **ZIP v3 一键全量备份与跨设备无损恢复**。

---

## 🖼️ 界面预览

<table>
  <tr>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-planner.png" alt="AI 一键规划行程" />
      <br /><sub><b>🤖 AI 一键行程规划</b> · 每日路线、实景配图、预算拆解与出发提醒</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-journal.png" alt="旅行手账与城市明信片" />
      <br /><sub><b>📔 旅行手账全景</b> · 旅程小册、城市明信片集与最近便签</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-journal-detail.png" alt="照片手账与语音回忆" />
      <br /><sub><b>📸 照片与语音手账页</b> · 按时间轴珍藏照片、文字感悟与语音评语</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-achievements.png" alt="旅途成就与成长路线" />
      <br /><sub><b>🏆 旅途成就与八阶成长路线</b> · 里程碑进度、手作纪念章与海报</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-map-light.png" alt="中国足迹地图浅色模式" />
      <br /><sub><b>🗺️ 中国旅行足迹地图（浅色）</b> · 34 省市边界点亮与探索统计</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/desktop-map-dark.png" alt="中国足迹地图深色模式" />
      <br /><sub><b>🌙 护眼深色模式</b> · 5 套视觉主题与深浅色自由切换</sub>
    </td>
  </tr>
</table>

<div align="center">
  <h4>📱 手机端原生适配（Android / iOS / Safari PWA）</h4>
  <p>
    <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/mobile-map.png" alt="手机端中国足迹地图" width="245" />
    &nbsp;&nbsp;&nbsp;&nbsp;
    <img src="https://eldonwyd.github.io/zhouyou-app/screenshots/mobile-journal.png" alt="手机端照片手账" width="245" />
  </p>
</div>

---

## 📥 下载与安装（电脑版与手机版独立下载）

电脑桌面版与手机移动版均为**完全独立的客户端**，拥有各自独立的下载专区与 GitHub Release 发布通道，按需选择对应入口即可：

### 💻 电脑版下载

> 🔗 **电脑版独立下载页**：[https://eldonwyd.github.io/zhouyou-app/download-desktop.html](https://eldonwyd.github.io/zhouyou-app/download-desktop.html)  
> 📦 **电脑版 GitHub Releases**：[https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v](https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v)

内置完整本地 AI 行程规划与离线 OCR 引擎，**无需安装 Node.js**，双击即用：

| 操作系统 | 适用设备 | 安装包格式 | 独立下载入口 |
| :--- | :--- | :--- | :---: |
| **Windows** | Windows 10 / 11 (x64) | 安装版 `.exe` / 绿色便携版 `.exe` | [![Download Windows](https://img.shields.io/badge/Windows-.exe%20安装版%20%2F%20便携版-0078D4?style=flat-square&logo=windows11&logoColor=white)](https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v) |
| **macOS** | Apple Silicon (M1–M4) & Intel | `.dmg` 镜像 | [![Download macOS](https://img.shields.io/badge/macOS-.dmg%20arm64%20%2F%20x64-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v) |
| **Linux** | Ubuntu / Debian / 通用发行版 (x64) | `.AppImage` / `.deb` | [![Download Linux](https://img.shields.io/badge/Linux-.AppImage%20%2F%20.deb-E95420?style=flat-square&logo=linux&logoColor=white)](https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v) |

---

### 📱 手机版下载

> 🔗 **手机版独立下载页**：[https://eldonwyd.github.io/zhouyou-app/download-mobile.html](https://eldonwyd.github.io/zhouyou-app/download-mobile.html)  
> 📦 **手机版 GitHub Releases**：[https://github.com/Eldonwyd/zhouyou-app/releases?q=mobile-v](https://github.com/Eldonwyd/zhouyou-app/releases?q=mobile-v)

独立安装与离线使用中国足迹地图、照片/视频/语音旅行手账、每日账本、旅途成就与 ZIP 备份：

| 平台 | 适用设备 | 安装方式 | 独立下载入口 |
| :--- | :--- | :--- | :---: |
| **Android (安卓)** | Android 8.0+ 手机 / 平板 | 直接安装 `.apk` | [![Download Android](https://img.shields.io/badge/Android-.apk%20直装包-3DDC84?style=flat-square&logo=android&logoColor=white)](https://github.com/Eldonwyd/zhouyou-app/releases?q=mobile-v) |
| **iOS (苹果手机)** | iPhone / iPad | `.ipa` 自签（AltStore / SideStore / TrollStore / Sideloadly） | [![Download iOS](https://img.shields.io/badge/iOS-.ipa%20自签客户端-000000?style=flat-square&logo=ios&logoColor=white)](https://github.com/Eldonwyd/zhouyou-app/releases?q=mobile-v) |
| **iOS / 手机免安装** | Safari / Chrome 浏览器 | PWA「添加到主屏幕」（免自签、永不掉签） | [![Open Web PWA](https://img.shields.io/badge/Web%20PWA-立即打开体验-ef6351?style=flat-square&logo=safari&logoColor=white)](https://eldonwyd.github.io/zhouyou-app/) |

<details>
<summary><b>📖 展开查看各系统安装贴士（Windows / macOS / Linux / Android / iOS）</b></summary>

- **Windows SmartScreen 提示**：点击 **「更多信息」→「仍要运行」** 即可。
- **macOS 提示“已损坏”或“无法验证开发者”**：拖入应用程序文件夹后，在终端执行：
  ```bash
  xattr -cr "/Applications/Zhouyou Map.app"
  ```
- **Linux AppImage / DEB**：
  ```bash
  chmod +x Zhouyou-Map-*-linux-*.AppImage && ./Zhouyou-Map-*-linux-*.AppImage
  # 或 Ubuntu / Debian：
  sudo apt install ./Zhouyou-Map-*-linux-*.deb
  ```
- **iPhone 免自签快捷安装（推荐）**：用自带 **Safari** 打开 [在线网页版](https://eldonwyd.github.io/zhouyou-app/) → 点击底部分享按钮 → **「添加到主屏幕」** 即可全屏离线使用。
- **可选：手机端连接电脑 AI 服务**：在电脑桌面版顶部菜单「应用」勾选「允许局域网手机连接 AI 服务」，并将局域网地址填入手机端「个人中心 → 远程 / 局域网 AI 服务」即可互联。

详细图文说明请参阅 [全平台安装与使用指南 (docs/DOWNLOAD.md)](docs/DOWNLOAD.md)。

</details>

---

## 🤖 支持的 AI 服务商与本地能力

| 类别 | 支持项 | 说明 |
| :--- | :--- | :--- |
| **API 密钥接入** | DeepSeek · OpenAI · Claude · Gemini · 通义千问 (Qwen) · 智谱 GLM · Kimi · 自定义兼容接口 | 按服务商独立保存密钥、模型与思考档位，自动适配联网检索 |
| **订阅账号登录** | ChatGPT · Claude · Kimi Code · Gemini CLI | 支持 OAuth 授权登录与动态拉取最新模型目录 |
| **本地离线 AI** | PP-OCRv5 Mobile (ONNX) · RT-DETR r18 (ONNX) | 本机离线识别票据截图与配图质检，截图不上传第三方 OCR |

---

## 📁 目录结构

```text
zhouyou-app/
├── .github/          # CI/CD 自动构建发布工作流、Issue/PR 模板、贡献与安全规范
├── data/places/      # 离线补充地点数据包
├── docs/             # 英文文档、更新日志、安装指南与界面预览图
├── electron/         # 桌面端主进程、预加载脚本、打包配置与品牌图标资源
├── public/           # 中国省市 GeoJSON 地图、PWA Manifest、离线 SW 与独立下载页
├── scripts/          # 构建打包脚本、移动端原生配置脚本与端到端测试
├── server/           # 本地 Node.js AI 行程规划、联网检索与 ONNX OCR 服务
└── src/              # React 19 + TypeScript 前端核心（地图 / AI 规划 / 照片手账 / 成就）
```

---

## 🛠️ 开发者快速开始

需要 **Node.js 22+**（推荐 Node.js 24 LTS）：

```bash
git clone https://github.com/Eldonwyd/zhouyou-app.git
cd zhouyou-app
npm install
npm run dev
```

常用打包与发版命令：

```bash
npm run desktop:dev     # 本地运行 Electron 桌面端
npm run desktop:win     # 打包 Windows (.exe 安装版 & 便携版)
npm run desktop:mac     # 打包 macOS (.dmg arm64 & x64)
npm run desktop:linux   # 打包 Linux (.AppImage & .deb)
npm run mobile:android  # 生成并同步 Android Capacitor 工程
npm run mobile:ios      # 生成并同步 iOS Capacitor 工程

# 触发 GitHub Actions 独立发布电脑版或手机版：
git tag desktop-v1.0.0 && git push origin desktop-v1.0.0
git tag mobile-v1.0.0  && git push origin mobile-v1.0.0
```

---

## 🤝 参与贡献与更新日志

- 欢迎提交 Issue 或 Pull Request！贡献前请阅读 [贡献指南 (.github/CONTRIBUTING.md)](.github/CONTRIBUTING.md) 与 [安全策略 (.github/SECURITY.md)](.github/SECURITY.md)。
- 版本变更记录见 [更新日志 (docs/CHANGELOG.md)](docs/CHANGELOG.md)。

## 📈 Star History

如果周游地图帮你点亮了地图、记录了珍贵的旅途回忆，欢迎点亮右上角 **⭐ Star** 支持！

<a href="https://star-history.com/#Eldonwyd/zhouyou-app&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Eldonwyd/zhouyou-app&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Eldonwyd/zhouyou-app&type=Date&theme=light" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Eldonwyd/zhouyou-app&type=Date&theme=light" width="100%" />
  </picture>
</a>

---

## 📄 开源协议与数据说明

- 本项目基于 **[MIT License](LICENSE)** 开源。
- 地图边界文件位于 `public/maps/`（包含全国 34 个省级行政区边界），二次分发地理数据时请遵守 DataV 原始条款及适用合规要求。
- 在线路线地图瓦片默认使用 [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)，可通过 `PLANNER_MAP_TILE_URL` 替换。
