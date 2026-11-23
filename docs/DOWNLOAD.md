# 📥 全平台安装与使用指南 · Download & Installation Guide

本指南详细介绍如何在 **Windows / macOS / Linux / Android / iOS / Web** 上下载、安装与配置 **周游地图（Zhouyou Map）**。

> 🚀 **独立下载入口**：
> - **💻 电脑桌面版独立下载页**：[https://eldonwyd.github.io/zhouyou-app/download-desktop.html](https://eldonwyd.github.io/zhouyou-app/download-desktop.html) · [GitHub 电脑版 Releases](https://github.com/Eldonwyd/zhouyou-app/releases?q=desktop-v)
> - **📱 手机移动版独立下载页**：[https://eldonwyd.github.io/zhouyou-app/download-mobile.html](https://eldonwyd.github.io/zhouyou-app/download-mobile.html) · [GitHub 手机版 Releases](https://github.com/Eldonwyd/zhouyou-app/releases?q=mobile-v)
> - **🌐 在线网页版 / iOS PWA**：[https://eldonwyd.github.io/zhouyou-app/](https://eldonwyd.github.io/zhouyou-app/)

---

## 💻 电脑桌面版（内置 AI 引擎与本地 OCR，无需安装 Node.js）

桌面端已将前端界面与本地 Node.js AI/OCR 服务打包在一起，双击即可使用全部功能（足迹地图、旅行手账、AI 行程规划、本地截图 OCR、离线导出、ZIP 备份）。

### 🪟 Windows (Windows 10 / 11, x64)

提供两种版本：
- **安装版**：`Zhouyou-Map-<version>-win-x64-setup.exe`（支持自定义安装目录，自动创建桌面和开始菜单快捷方式）
- **绿色便携版**：`Zhouyou-Map-<version>-win-x64-portable.exe`（免安装，双击直接运行）

**常见问题**：
- 如果 Windows Defender SmartScreen 弹出「Windows 已保护你的电脑」提示（开源免费软件未购买 EV 代码签名证书所致），请点击 **「更多信息」→「仍要运行」**。

---

### 🍎 macOS (Apple Silicon & Intel)

请根据你的 Mac 芯片选择对应安装包：
- **Apple Silicon (M1 / M2 / M3 / M4)**：`Zhouyou-Map-<version>-mac-arm64.dmg`
- **Intel 芯片**：`Zhouyou-Map-<version>-mac-x64.dmg`

**安装步骤**：
1. 双击 `.dmg` 文件，将 `Zhouyou Map.app` 拖入 `Applications`（应用程序）文件夹。
2. 由于本项目为免费开源应用，暂未购买苹果年度公证签名，首次打开如提示 **“已损坏，无法打开”** 或 **“无法验证开发者”**，请打开「终端（Terminal）」执行以下命令解除隔离属性：
   ```bash
   xattr -cr "/Applications/Zhouyou Map.app"
   ```
3. 执行后再次双击即可正常打开。

---

### 🐧 Linux (x64)

- **通用发行版（AppImage）**：
  ```bash
  chmod +x Zhouyou-Map-*-linux-*.AppImage
  ./Zhouyou-Map-*-linux-*.AppImage
  ```
  > 提示：Ubuntu 22.04+ 如运行 AppImage 报错缺少 `libfuse2`，可执行 `sudo apt install libfuse2`。
- **Debian / Ubuntu / Linux Mint（.deb）**：
  ```bash
  sudo apt install ./Zhouyou-Map-*-linux-*.deb
  ```

---

## 📱 手机移动端（Android & iOS）

手机端支持 **100% 离线使用**中国足迹地图、旅行手账（照片/视频/语音）、每日账本、成就海报与 ZIP 跨设备备份；同时支持通过局域网连接电脑桌面版启用完整 AI 行程规划！

### 🤖 Android 安卓版 (`.apk`)

1. 在 [Releases 页面](https://github.com/Eldonwyd/zhouyou-app/releases/latest) 下载 `Zhouyou-Map-<version>-android.apk`。
2. 点击文件安装（如系统提示「未知来源应用」，允许浏览器/文件管理器安装即可）。

### 🍎 iOS 苹果版（两种方式任选）

#### 方式一：Safari PWA 一键安装（免自签、永不掉签、最推荐）
1. 使用 iPhone / iPad 自带的 **Safari 浏览器**打开 [https://eldonwyd.github.io/zhouyou-app/](https://eldonwyd.github.io/zhouyou-app/)。
2. 点击底部工具栏的 **「分享」按钮（↑）**。
3. 向下滑动并点击 **「添加到主屏幕」** → **「添加」**。
4. 桌面将出现周游地图 App 图标，支持独立全屏运行与离线访问！

#### 方式二：原生 `.ipa` 客户端安装（AltStore / SideStore / TrollStore / Sideloadly）
1. 在 [Releases 页面](https://github.com/Eldonwyd/zhouyou-app/releases/latest) 下载 `Zhouyou-Map-<version>-ios-unsigned.ipa`。
2. 使用以下任意工具签发并安装到 iPhone / iPad：
   - **[TrollStore（巨魔商店）](https://github.com/opa334/TrollStore)**：直接分享导入 `.ipa` 永久安装。
   - **[AltStore](https://altstore.io/) / [SideStore](https://sidestore.io/)**：在设备内导入 `.ipa` 使用个人 Apple ID 签名安装。
   - **[Sideloadly](https://sideloadly.io/)**：电脑连接手机后拖入 `.ipa` 一键签名安装。

---

## 🔗 手机端如何开启 AI 行程规划？（桌面 + 手机局域网互联）

1. 在同一 Wi-Fi 下打开电脑端 **周游地图桌面版**。
2. 点击顶部菜单栏 **「应用」→ 勾选「允许局域网手机连接 AI 服务」**，记下弹窗中显示的局域网地址（例如 `http://192.168.1.100:14173`）。
3. 打开手机端 **周游地图** → 进入 **「个人中心」→「远程 / 局域网 AI 服务」**，粘贴该地址并点击 **「保存并检测」**。
4. 检测通过后，手机端即可直接调用电脑上的 DeepSeek / OpenAI / Claude / Gemini / 本地 OCR 等完整 AI 能力！

---

## ☁️ 跨设备同步旅行数据

周游地图采用隐私优先的本地存储策略，不强制注册账号或上传云端。跨设备迁移非常简单：

1. 在旧设备的 **「个人中心」→「数据导出与导入」** 点击 **「导出完整备份」** 生成 `.zip` 文件。
2. 通过 AirDrop、微信文件传输助手、网盘或数据线将 `.zip` 发送到新设备。
3. 在新设备的 **「个人中心」** 点击 **「导入备份」** 选择该文件，足迹、手账、照片、录音、AI 行程与账本即刻完整恢复！
