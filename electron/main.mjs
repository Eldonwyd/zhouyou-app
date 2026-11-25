import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyHotUpdate,
  downloadFullInstaller,
  isTrustedUpdateUrl,
  readRuntimeMeta,
  resolveActiveDist,
} from './hot-update.mjs';

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
let runtimeState = {
  distDir: path.join(projectRoot, 'dist'),
  effectiveVersion: app.getVersion(),
  shellVersion: app.getVersion(),
  hotUpdateVersion: '',
  nativeCompat: '',
};

async function initRuntimeState() {
  const defaultDistDir = path.join(projectRoot, 'dist');
  const meta = await readRuntimeMeta(projectRoot, app.getVersion());
  runtimeState = await resolveActiveDist({
    userDataDir: app.getPath('userData'),
    defaultDistDir,
    shellVersion: app.getVersion() || meta.shellVersion,
    nativeCompat: meta.nativeCompat,
  });
}

function getPublicRuntimeInfo() {
  return {
    version: runtimeState.effectiveVersion,
    shellVersion: runtimeState.shellVersion,
    nativeCompat: runtimeState.nativeCompat,
    hotUpdateVersion: runtimeState.hotUpdateVersion,
  };
}

function sendUpdateProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('zhouyou:update-progress', payload);
  }
}

function collectTrustedUrls(primaryUrl, fallbackUrls) {
  const list = [primaryUrl, ...(Array.isArray(fallbackUrls) ? fallbackUrls : [])]
    .map((u) => String(u || '').trim())
    .filter((u) => u && isTrustedUpdateUrl(u));
  return [...new Set(list)];
}

function setupUpdateIpc() {
  ipcMain.on('zhouyou:get-app-version', (event) => {
    event.returnValue = runtimeState.effectiveVersion;
  });

  ipcMain.on('zhouyou:get-runtime-info', (event) => {
    event.returnValue = getPublicRuntimeInfo();
  });

  ipcMain.handle('zhouyou:get-runtime-info-async', () => getPublicRuntimeInfo());

  ipcMain.handle('zhouyou:cancel-update', () => {
    activeUpdateController?.abort();
    activeUpdateController = null;
  });

  // 方案 B：应用内极速热更新（仅下载几 MB 前端资源包，SHA-256 校验通过后无缝切换 dist 目录并重载窗口）
  ipcMain.handle('zhouyou:apply-hot-update', async (_event, payload) => {
    const urls = collectTrustedUrls(payload?.url, payload?.fallbackUrls);
    if (!urls.length) {
      return { ok: false, error: '无效的热更新包下载地址' };
    }
    const targetCompat = String(payload?.nativeCompat || '').trim();
    if (!runtimeState.nativeCompat || targetCompat !== runtimeState.nativeCompat) {
      return { ok: false, error: '当前版本包含底层升级，需下载完整安装包更新' };
    }

    activeUpdateController?.abort();
    const controller = new AbortController();
    activeUpdateController = controller;

    try {
      const result = await applyHotUpdate({
        userDataDir: app.getPath('userData'),
        urls,
        version: payload?.version,
        nativeCompat: runtimeState.nativeCompat,
        expectedSha256: payload?.sha256,
        signal: controller.signal,
        onProgress: (p) => sendUpdateProgress(p),
      });

      runtimeState = {
        ...runtimeState,
        distDir: result.distDir,
        effectiveVersion: result.version,
        hotUpdateVersion: result.version,
      };
      process.env.ZHOUYOU_DIST_DIR = runtimeState.distDir;

      await session.defaultSession.clearCache().catch(() => {});
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          void mainWindow.loadURL(`http://127.0.0.1:${activePort}`);
        }
      }, 280);

      return { ok: true, mode: 'hot', version: result.version };
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        return { ok: false, cancelled: true };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (activeUpdateController === controller) activeUpdateController = null;
    }
  });

  // 方案 A：底层大改动时应用内直接下载完整安装包（不经过 Edge 浏览器，带 SHA-256 校验并拉起安装）
  ipcMain.handle('zhouyou:download-update', async (_event, payload) => {
    const urls = collectTrustedUrls(payload?.url, payload?.fallbackUrls);
    if (!urls.length) {
      return { ok: false, error: '无效的更新包下载地址' };
    }
    if (payload?.openInBrowser) {
      await shell.openExternal(urls[0]);
      return { ok: true, fallbackOpened: true };
    }

    const sha256Urls = collectTrustedUrls(payload?.sha256Url, payload?.sha256FallbackUrls);
    activeUpdateController?.abort();
    const controller = new AbortController();
    activeUpdateController = controller;

    try {
      const result = await downloadFullInstaller({
        tempDir: os.tmpdir(),
        urls,
        fileName: payload?.fileName || 'Zhouyou-Map-setup.exe',
        sha256Urls,
        signal: controller.signal,
        onProgress: (p) => sendUpdateProgress(p),
      });

      sendUpdateProgress({
        state: 'installing',
        percent: 100,
        receivedBytes: result.receivedBytes,
        totalBytes: result.totalBytes,
        filePath: result.filePath,
      });

      if (process.platform === 'win32' && /\.exe$/i.test(result.filePath)) {
        const child = spawn(result.filePath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
        setTimeout(() => app.quit(), 600);
      } else if (process.platform === 'linux' && /\.AppImage$/i.test(result.filePath)) {
        await chmod(result.filePath, 0o755).catch(() => {});
        shell.showItemInFolder(result.filePath);
      } else {
        const openErr = await shell.openPath(result.filePath);
        if (openErr) shell.showItemInFolder(result.filePath);
      }

      return { ok: true, mode: 'full', filePath: result.filePath, verified: result.verified };
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        return { ok: false, cancelled: true };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (activeUpdateController === controller) activeUpdateController = null;
    }
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
  const distDir = runtimeState.distDir;
  const appRoot = app.isPackaged ? process.resourcesPath : projectRoot;

  process.env.ZHOUYOU_DATA_DIR = userDataDir;
  process.env.ZHOUYOU_DIST_DIR = distDir;
  process.env.ZHOUYOU_APP_ROOT = appRoot;

  const { createPlannerServer } = await import('../dist-electron/server.mjs');
  // 不传入写死的 distRoot，由 server 动态读取 process.env.ZHOUYOU_DIST_DIR，从而支持热更新毫秒级无缝切换前端目录。
  const httpServer = await createPlannerServer({ production: true });
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
  if (!isMac) {
    // Windows / Linux 隐藏窗口顶部原生菜单栏（应用 / 编辑 / 视图 / 帮助），保持无冗余标题区。
    Menu.setApplicationMenu(null);
    return;
  }
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
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
  }

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
  let pendingDeepLink = process.argv.find((arg) => /^zhouyou:\/\//i.test(arg)) || '';

  const dispatchDeepLink = (url) => {
    if (!url || !/^zhouyou:\/\//i.test(url)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('zhouyou:deep-link', url);
    } else {
      pendingDeepLink = url;
    }
  };

  app.on('second-instance', (_event, argv) => {
    const deepUrl = (argv || []).find((arg) => /^zhouyou:\/\//i.test(arg));
    if (deepUrl) dispatchDeepLink(deepUrl);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatchDeepLink(url);
  });

  app.whenReady().then(async () => {
    app.setName('周游地图');
    try { app.setAsDefaultProtocolClient('zhouyou'); } catch { /* ignore */ }
    await initRuntimeState();
    setupUpdateIpc();
    await loadPrefs();
    await startEmbeddedServer();
    buildAppMenu();
    createWindow();
    if (pendingDeepLink && mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        dispatchDeepLink(pendingDeepLink);
        pendingDeepLink = '';
      });
    }

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
