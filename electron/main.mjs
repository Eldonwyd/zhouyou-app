import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_PORT = 14173;
const REPO_URL = 'https://github.com/Eldonwyd/zhouyou-app';
const RELEASES_URL = `${REPO_URL}/releases?q=desktop`;

let mainWindow = null;
let server = null;
let activePort = DEFAULT_PORT;
let lanSharing = false;
let activeUpdateController = null;

function isTrustedUpdateUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'github.com') return u.pathname.toLowerCase().startsWith('/eldonwyd/zhouyou-app/');
    if (host === 'zhouyou.online' || host === 'www.zhouyou.online') return true;
    return (
      host === 'objects.githubusercontent.com' ||
      host === 'release-assets.githubusercontent.com' ||
      host === 'github-releases.githubusercontent.com'
    );
  } catch {
    return false;
  }
}

function sendUpdateProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('zhouyou:update-progress', payload);
  }
}

function setupUpdateIpc() {
  ipcMain.on('zhouyou:get-app-version', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.handle('zhouyou:cancel-update', () => {
    activeUpdateController?.abort();
    activeUpdateController = null;
  });

  ipcMain.handle('zhouyou:download-update', async (_event, payload) => {
    const url = String(payload?.url || '');
    if (!isTrustedUpdateUrl(url)) {
      return { ok: false, error: '无效的更新包下载地址' };
    }
    // 统一交由系统默认浏览器安全下载新版安装包，避免桌面端自下载执行 .exe 触发杀毒软件误报。
    await shell.openExternal(url);
    return { ok: true, fallbackOpened: true };
  });
}

function getPrefsPath() {
  return path.join(app.getPath('userData'), 'desktop-prefs.json');
}

async function loadPrefs() {
  try {
    const raw = await readFile(getPrefsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    lanSharing = Boolean(parsed?.lanSharing);
  } catch {
    lanSharing = false;
  }
}

async function savePrefs() {
  const file = getPrefsPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ lanSharing }, null, 2), 'utf8');
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const result = [];
  for (const entries of Object.values(nets)) {
    for (const info of entries ?? []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return result;
}

function listenServer(httpServer, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, host);
  });
}

async function startEmbeddedServer() {
  const userDataDir = app.getPath('userData');
  const distDir = path.join(projectRoot, 'dist');
  const appRoot = app.isPackaged ? process.resourcesPath : projectRoot;

  process.env.ZHOUYOU_DATA_DIR = userDataDir;
  process.env.ZHOUYOU_DIST_DIR = distDir;
  process.env.ZHOUYOU_APP_ROOT = appRoot;

  const { createPlannerServer } = await import('../dist-electron/server.mjs');
  const httpServer = await createPlannerServer({ production: true, distRoot: distDir });
  const host = lanSharing ? '0.0.0.0' : '127.0.0.1';

  // 优先使用固定端口 14173，确保 IndexedDB 在应用重启/升级后保持同一 origin 不丢失数据。
  try {
    activePort = await listenServer(httpServer, DEFAULT_PORT, host);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      activePort = await listenServer(httpServer, 0, host);
    } else {
      throw error;
    }
  }
  server = httpServer;
}

async function restartServerForLanToggle() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await startEmbeddedServer();
  buildAppMenu();
  if (lanSharing) {
    const ips = getLanAddresses();
    const urls = ips.length
      ? ips.map((ip) => `http://${ip}:${activePort}`).join('\n')
      : `http://<本机局域网IP>:${activePort}`;
    await dialog.showMessageBox(mainWindow ?? undefined, {
      type: 'info',
      title: '已开启局域网手机共享',
      message: '手机端现可连接到本机 AI 服务',
      detail: `请在手机 App 的「个人中心 → 远程 / 局域网 AI 服务」中填写以下地址之一（需在同一 Wi-Fi 下）：\n\n${urls}`,
      buttons: ['知道了'],
    });
  } else {
    await dialog.showMessageBox(mainWindow ?? undefined, {
      type: 'info',
      title: '已关闭局域网共享',
      message: 'AI 服务已恢复为仅本机访问（127.0.0.1）',
      buttons: ['好的'],
    });
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: '周游地图',
          submenu: [
            { role: 'about', label: '关于周游地图' },
            { type: 'separator' },
            { role: 'hide', label: '隐藏周游地图' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '显示全部' },
            { type: 'separator' },
            { role: 'quit', label: '退出周游地图' },
          ],
        }]
      : []),
    {
      label: '应用',
      submenu: [
        {
          label: '打开本地数据目录',
          click: () => void shell.openPath(app.getPath('userData')),
        },
        {
          label: '允许局域网手机连接 AI 服务',
          type: 'checkbox',
          checked: lanSharing,
          click: async (item) => {
            lanSharing = item.checked;
            await savePrefs();
            await restartServerForLanToggle();
          },
        },
        {
          label: '查看手机连接地址',
          click: () => {
            const ips = getLanAddresses();
            const list = ips.length
              ? ips.map((ip) => `http://${ip}:${activePort}`).join('\n')
              : '未检测到可用局域网 IP';
            void dialog.showMessageBox(mainWindow ?? undefined, {
              type: 'info',
              title: '手机连接地址',
              message: lanSharing ? '当前已开启局域网共享' : '当前仅允许本机访问（请先勾选“允许局域网手机连接 AI 服务”）',
              detail: `局域网访问地址：\n${list}\n\n数据目录：${app.getPath('userData')}`,
              buttons: ['确定'],
            });
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
              mainWindow.webContents.send('zhouyou:open-updater');
            } else {
              void shell.openExternal(RELEASES_URL);
            }
          },
        },
        {
          label: '访问 GitHub 仓库',
          click: () => void shell.openExternal(REPO_URL),
        },
        {
          label: '反馈问题与建议',
          click: () => void shell.openExternal(`${REPO_URL}/issues`),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const iconPath = path.join(__dirname, 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 390,
    minHeight: 640,
    title: '周游地图 · Zhouyou Map',
    backgroundColor: '#fff8f1',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const localOrigin = `http://127.0.0.1:${activePort}`;
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(localOrigin)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(localOrigin) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(localOrigin);
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setName('周游地图');
    setupUpdateIpc();
    await loadPrefs();
    await startEmbeddedServer();
    buildAppMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    dialog.showErrorBox('周游地图启动失败', error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    server?.close();
  });
}
