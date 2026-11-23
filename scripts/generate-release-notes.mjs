import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = process.argv[2] || '1.0.0';
const filesDir = process.argv[3] || 'release-files';
const outFile = process.argv[4] || 'release-notes.md';
const kind = process.argv[5] || 'all'; // 'desktop' | 'mobile' | 'all'

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

let heading = `## 🎉 周游地图 Zhouyou Map v${version}`;
let intro = '全平台客户端已自动构建完成。';
let tips = '';

if (kind === 'desktop') {
  heading = `## 💻 周游地图 电脑桌面版 v${version}`;
  intro = '电脑桌面版独立安装包已自动构建完成，内置完整本地 AI 行程规划与离线 OCR 引擎，支持 **Windows / macOS / Linux**，无需安装 Node.js 开箱即用。';
  tips = `> 🌐 **电脑版专属下载页**：[https://eldonwyd.github.io/zhouyou-app/download.html#desktop](https://eldonwyd.github.io/zhouyou-app/download.html#desktop)
> 📱 需要手机版？请前往 [手机版独立下载区](https://eldonwyd.github.io/zhouyou-app/download.html#mobile)

### 🛠️ 电脑端安装提示
- **Windows**：若弹出 SmartScreen 安全提示，点击「更多信息」→「仍要运行」。
- **macOS**：首次打开如提示“已损坏”或“无法验证开发者”，在终端运行：\`xattr -cr "/Applications/Zhouyou Map.app"\`。
- **Linux**：AppImage 需赋予执行权限：\`chmod +x Zhouyou-Map-*.AppImage && ./Zhouyou-Map-*.AppImage\`；Debian/Ubuntu 可执行 \`sudo apt install ./Zhouyou-Map-*.deb\`。`;
} else if (kind === 'mobile') {
  heading = `## 📱 周游地图 手机移动版 v${version}`;
  intro = '手机移动版独立安装包已自动构建完成，支持 **Android (`.apk`)** 与 **iOS (`.ipa`)**，完全独立安装、离线记录中国足迹地图、旅行手账、照片/语音与每日账本。';
  tips = `> 🌐 **手机版专属下载页**：[https://eldonwyd.github.io/zhouyou-app/download.html#mobile](https://eldonwyd.github.io/zhouyou-app/download.html#mobile)
> 💡 **iPhone 免自签快捷安装**：用 Safari 打开 [https://eldonwyd.github.io/zhouyou-app/](https://eldonwyd.github.io/zhouyou-app/) → 点击底部分享按钮 → **「添加到主屏幕」**即可独立离线使用！
> 💻 需要电脑版？请前往 [电脑版独立下载区](https://eldonwyd.github.io/zhouyou-app/download.html#desktop)

### 🛠️ 手机端安装提示
- **Android (安卓)**：下载 \`.apk\` 后直接点击安装（若系统提示未知来源应用，允许安装即可）。
- **iOS (苹果手机)**：通过 AltStore / SideStore / TrollStore / Sideloadly 安装 \`.ipa\`，或使用上方 Safari PWA 一键添加到主屏幕。`;
} else {
  tips = `> 🌐 **独立下载中心**：[电脑版下载](https://eldonwyd.github.io/zhouyou-app/download.html#desktop) · [手机版下载](https://eldonwyd.github.io/zhouyou-app/download.html#mobile)`;
}

const markdown = `${heading}

${intro}

### 📦 下载列表

| 平台 | 适用设备 | 安装包文件名 | 大小 |
| :--- | :--- | :--- | :---: |
${tableLines}

${tips}

完整校验值见附件 \`SHA256SUMS.txt\`。
`;

await writeFile(outFile, markdown, 'utf8');
process.stdout.write(`Wrote ${kind} release notes (${rows.length} files) to ${outFile}\n`);
