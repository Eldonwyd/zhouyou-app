import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = process.argv[2] || '1.0.0';
const filesDir = process.argv[3] || 'release-files';
const outFile = process.argv[4] || 'release-notes.md';

const entries = (await readdir(filesDir)).filter((name) => name !== 'SHA256SUMS.txt').sort();

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function classify(name) {
  if (/win.*setup\.exe$/i.test(name)) return { order: 1, platform: 'Windows 安装版', device: 'Windows 10 / 11 (x64)' };
  if (/win.*portable\.exe$/i.test(name)) return { order: 2, platform: 'Windows 便携版', device: 'Windows 免安装绿色版 (x64)' };
  if (/mac.*arm64\.dmg$/i.test(name)) return { order: 3, platform: 'macOS (Apple Silicon)', device: 'M1 / M2 / M3 / M4 芯片 Mac' };
  if (/mac.*x64\.dmg$/i.test(name)) return { order: 4, platform: 'macOS (Intel)', device: 'Intel 芯片 Mac' };
  if (/\.AppImage$/i.test(name)) return { order: 5, platform: 'Linux (AppImage)', device: '通用 Linux 发行版 (x64)' };
  if (/\.deb$/i.test(name)) return { order: 6, platform: 'Linux (DEB)', device: 'Ubuntu / Debian / Linux Mint (x64)' };
  if (/\.apk$/i.test(name)) return { order: 7, platform: 'Android (安卓)', device: 'Android 8.0+ 手机 / 平板' };
  if (/\.ipa$/i.test(name)) return { order: 8, platform: 'iOS (苹果手机)', device: 'iPhone / iPad（支持 AltStore / SideStore / TrollStore / Sideloadly）' };
  return { order: 99, platform: '其他构建', device: '-' };
}

const rows = [];
for (const name of entries) {
  const info = await stat(path.join(filesDir, name));
  rows.push({ name, size: formatSize(info.size), ...classify(name) });
}
rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

const tableLines = rows.length
  ? rows.map((r) => `| **${r.platform}** | ${r.device} | \`${r.name}\` | ${r.size} |`).join('\n')
  : '| _暂无构建产物_ | - | - | - |';

const markdown = `## 🎉 周游地图 Zhouyou Map v${version}

全平台客户端已自动构建完成，包含 **电脑桌面版（Windows / macOS / Linux，内置完整 AI 规划与本地 OCR 服务，开箱即用）** 与 **手机移动端（Android / iOS）** 安装包！

### 📦 下载列表

| 平台 | 适用设备 | 安装包文件名 | 大小 |
| :--- | :--- | :--- | :---: |
${tableLines}

> 💡 **iPhone 免自签快捷安装**：也可以直接用 Safari 打开在线网页版 [https://eldonwyd.github.io/zhouyou-app/](https://eldonwyd.github.io/zhouyou-app/)，点击底部分享图标 → **「添加到主屏幕」**，即可获得独立全屏 App 体验并离线记录足迹与手账！
>
> 🌐 **交互式下载中心**：[https://eldonwyd.github.io/zhouyou-app/download.html](https://eldonwyd.github.io/zhouyou-app/download.html)

### 🛠️ 安装与使用提示

- **Windows**：若弹出 SmartScreen 安全提示，点击「更多信息」→「仍要运行」即可。
- **macOS**：首次打开若提示“已损坏”或“无法验证开发者”，请在终端运行：\`xattr -cr "/Applications/Zhouyou Map.app"\`。
- **Linux**：AppImage 需先赋予执行权限：\`chmod +x Zhouyou-Map-*.AppImage && ./Zhouyou-Map-*.AppImage\`；Ubuntu/Debian 可直接 \`sudo apt install ./Zhouyou-Map-*.deb\`。
- **Android**：下载 \`.apk\` 后直接点击安装（若系统提示未知来源应用，允许安装即可）。
- **iOS**：使用 AltStore / SideStore / TrollStore / Sideloadly 安装 \`.ipa\`，或直接使用 Safari PWA 添加到主屏幕。
- **手机端使用 AI 规划**：打开电脑桌面版 → 顶部菜单「应用」勾选 **「允许局域网手机连接 AI 服务」**，在手机端「个人中心 → 远程 / 局域网 AI 服务」填入电脑局域网地址即可互联！

完整校验值见附件 \`SHA256SUMS.txt\`。
`;

await writeFile(outFile, markdown, 'utf8');
process.stdout.write(`Wrote release notes (${rows.length} files) to ${outFile}\n`);
