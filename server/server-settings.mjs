import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { getDataPath } from './runtime-paths.mjs';

const getEnvironmentFile = () => getDataPath('.env.local');
let pendingWrite = Promise.resolve();

/** 只修改允许的配置项，保留其他已有密钥；写入使用临时文件 + 重命名，不回传密钥内容。 */
function writeSettings(values, allowed, invalidMessage) {
  for (const [name, value] of Object.entries(values)) {
    if (!(typeof allowed === 'function' ? allowed(name) : allowed.has(name)) || typeof value !== 'string' || /[\r\n"'`\s]/.test(value) || value.length > 1000) throw new Error(invalidMessage);
  }
  const operation = pendingWrite.then(async () => {
    const environmentFile = getEnvironmentFile();
    await mkdir(path.dirname(environmentFile), { recursive: true });
    let content = await readFile(environmentFile, 'utf8').catch(() => '');
    for (const [name, value] of Object.entries(values)) {
      const pattern = new RegExp(`^${name}\\s*=.*$`, 'm');
      content = pattern.test(content) ? content.replace(pattern, () => `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
    }
    const temporary = `${environmentFile}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, environmentFile);
  });
  pendingWrite = operation.catch(() => {});
  return operation;
}

export function writePhotoSettings(values) {
  return writeSettings(values, new Set(['BRAVE_IMAGE_SEARCH_KEY', 'XHS_BRIDGE_URL', 'XHS_BRIDGE_TOKEN']), '图片服务配置格式无效');
}

/** AI 服务配置：当前服务商，以及每个服务商各自的 API Key、模型、接口地址、思考档位（如 AI_KEY_DEEPSEEK）。 */
export function writeAiSettings(values) {
  return writeSettings(values, (name) => /^AI_(PROVIDER|(KEY|MODEL|BASE_URL|THINKING)_[A-Z]+)$/.test(name), 'AI 配置格式无效');
}
