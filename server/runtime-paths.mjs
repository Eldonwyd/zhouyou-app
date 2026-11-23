import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 应用只读根目录：开发/命令行下为 web/，Electron 桌面端下可指向打包资源目录。 */
export function getAppRoot() {
  return process.env.ZHOUYOU_APP_ROOT ? path.resolve(process.env.ZHOUYOU_APP_ROOT) : defaultWebRoot;
}

/** 可写用户数据目录：桌面打包版指向系统 userData，避免写入只读安装目录。 */
export function getDataDir() {
  return process.env.ZHOUYOU_DATA_DIR ? path.resolve(process.env.ZHOUYOU_DATA_DIR) : getAppRoot();
}

/** 前端构建产物目录。 */
export function getDistDir() {
  return process.env.ZHOUYOU_DIST_DIR ? path.resolve(process.env.ZHOUYOU_DIST_DIR) : path.join(getAppRoot(), 'dist');
}

export function getDataPath(...segments) {
  return path.join(getDataDir(), ...segments);
}

export function getAppPath(...segments) {
  return path.join(getAppRoot(), ...segments);
}
