import { execFileSync } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = process.argv[2] || '1.0.0';
const filesDir = process.argv[3] || 'release-files';
const outFile = process.argv[4] || 'release-notes.md';
const kind = process.argv[5] || 'all'; // 'desktop' | 'mobile' | 'all'

const entries = (await readdir(filesDir))
  .filter((name) => name !== 'SHA256SUMS.txt' && name !== 'hot-update-manifest.json' && !/-hot-update\.zip$/i.test(name))
  .sort();

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

function cleanCommitSubject(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^merge\b/i.test(trimmed)) return '';
  if (/^chore\(release\):/i.test(trimmed)) return '';
  if (/^(?:chore|ci):\s*(?:bump version|递增版本号|trigger cloudflare)/i.test(trimmed)) return '';
  if (/^bump version/i.test(trimmed)) return '';

  const stripped = trimmed
    .replace(/^(?:feat|fix|style|perf|refactor|ui|docs|chore|ci|build)(?:\([^)]*\))?!?:\s*/i, '')
    .replace(/\s*\(v?\d+\.\d+\.\d+[^)]*\)\s*$/i, '')
    .trim();

  if (!stripped || /^递增版本号/.test(stripped)) return '';
  return stripped;
}

function collectChangelogItems() {
  const tagPrefix = kind === 'desktop' ? 'desktop-v' : kind === 'mobile' ? 'mobile-v' : '';
  const currentTag = tagPrefix ? `${tagPrefix}${version}` : `v${version}`;
  let prevTag = '';

  try {
    const pattern = tagPrefix ? `${tagPrefix}*` : 'v*';
    const tagsRaw = execFileSync('git', ['tag', '--list', pattern, '--sort=-v:refname'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tags = tagsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    prevTag = tags.find((t) => t !== currentTag) || '';
  } catch {
    prevTag = '';
  }

  let subjects = [];
  try {
    const range = prevTag ? `${prevTag}..HEAD` : '-n 8';
    const args = prevTag
      ? ['log', range, '--no-merges', '--format=%s']
      : ['log', '-n', '8', '--no-merges', '--format=%s'];
    const logRaw = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    subjects = logRaw.split(/\r?\n/).map(cleanCommitSubject).filter(Boolean);
  } catch {
    subjects = [];
  }

  // 若区间内只有发版 commit，回退读取最近 5 条非发版提交中最新的一条
  if (subjects.length === 0) {
    try {
      const logRaw = execFileSync('git', ['log', '-n', '10', '--no-merges', '--format=%s'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      subjects = logRaw.split(/\r?\n/).map(cleanCommitSubject).filter(Boolean).slice(0, 1);
    } catch {
      subjects = [];
    }
  }

  const unique = [];
  for (const item of subjects) {
    if (!unique.includes(item)) unique.push(item);
    if (unique.length >= 5) break;
  }
  return unique;
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

const changelogItems = collectChangelogItems();
const changelogBlock = changelogItems.length
  ? `### ✨ 更新内容\n\n${changelogItems.map((item) => `- ${item}`).join('\n')}`
  : `### ✨ 更新内容\n\n- 常规体验优化与问题修复`;

let heading = `## 🎉 周游地图 Zhouyou Map v${version}`;
let portalLink = `> 🌐 **官网下载中心**：[https://zhouyou.online/download.html](https://zhouyou.online/download.html)`;

if (kind === 'desktop') {
  heading = `## 💻 周游地图 电脑桌面版 v${version}`;
  portalLink = `> 🌐 **电脑版官网下载页**：[https://zhouyou.online/download.html#desktop](https://zhouyou.online/download.html#desktop)`;
} else if (kind === 'mobile') {
  heading = `## 📱 周游地图 手机移动版 v${version}`;
  portalLink = `> 🌐 **手机版官网下载页**：[https://zhouyou.online/download.html#mobile](https://zhouyou.online/download.html#mobile)`;
}

const markdown = `${heading}

${changelogBlock}

### 📦 下载列表

| 平台 | 适用设备 | 安装包文件名 | 大小 |
| :--- | :--- | :--- | :---: |
${tableLines}

${portalLink}

完整校验值见附件 \`SHA256SUMS.txt\`。
`;

await writeFile(outFile, markdown, 'utf8');
process.stdout.write(`Wrote ${kind} release notes (${rows.length} files, ${changelogItems.length} changes) to ${outFile}\n`);
