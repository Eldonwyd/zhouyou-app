import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * 本地离线中文/英文/数字 OCR（基于 PP-OCRv5 Mobile ONNX，Apache-2.0）。
 * 全部在本机运行，无需额外 API Key，截图不上传任何第三方识别服务；
 * 复用 photo-inspector 已下载的 text-det-ppocrv5-mobile.onnx，并按需下载 rec 模型（约 16MB）与字典（74KB）。
 */
const OCR_MODELS = {
  det: {
    file: 'text-det-ppocrv5-mobile.onnx',
    url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx',
    sha256: '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae',
  },
  rec: {
    file: 'text-rec-ppocrv5-mobile.onnx',
    url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx',
    sha256: '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5',
  },
  dict: {
    file: 'ppocrv5-dict.txt',
    url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/paddle/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile/ppocrv5_dict.txt',
    sha256: 'd1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b',
  },
};

const defaultDirectory = fileURLToPath(new URL('../.models/', import.meta.url));

async function ensureAsset(directory, spec, fetchImpl, onProgress) {
  const filename = path.join(directory, spec.file);
  const verify = (bytes) => createHash('sha256').update(bytes).digest('hex') === spec.sha256;
  try {
    const bytes = await readFile(filename);
    if (verify(bytes)) return bytes;
  } catch { /* 首次使用时下载 */ }
  onProgress?.(`正在下载本地文字识别模型（${spec.file}，仅首次需要）`);
  const response = await fetchImpl(spec.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`本地文字识别模型下载失败（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!verify(bytes)) throw new Error(`本地文字识别模型校验失败（${spec.file}）`);
  await mkdir(directory, { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, filename);
  return bytes;
}

/**
 * DBNet 文字区域检测：返回原图像素坐标下的文本框列表。
 * 对截图文字采用较大的最大边（960px），保证小字号车次与金额清晰可读。
 */
async function detectBoxes(ort, detSession, imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const origW = meta.width || 1;
  const origH = meta.height || 1;

  const { data: resized, info } = await sharp(imageBuffer)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = Math.max(32, Math.round(info.width / 32) * 32);
  const height = Math.max(32, Math.round(info.height / 32) * 32);
  const { data: pixels } = await sharp(resized, { raw: info })
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mean = [0.406, 0.456, 0.485];
  const std = [0.225, 0.224, 0.229];
  const tensor = new Float32Array(3 * width * height);
  const area = width * height;
  for (let i = 0; i < area; i++) {
    tensor[i] = (pixels[i * 3 + 2] / 255 - mean[0]) / std[0];
    tensor[area + i] = (pixels[i * 3 + 1] / 255 - mean[1]) / std[1];
    tensor[2 * area + i] = (pixels[i * 3] / 255 - mean[2]) / std[2];
  }

  const output = await detSession.run({
    [detSession.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, height, width]),
  });
  const map = output[detSession.outputNames[0]].data;

  const visited = new Uint8Array(area);
  const scaleX = origW / width;
  const scaleY = origH / height;
  const boxes = [];
  const stack = [];

  for (let start = 0; start < area; start++) {
    if (visited[start] || map[start] <= 0.3) continue;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let scoreSum = 0;
    let count = 0;

    visited[start] = 1;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      scoreSum += map[idx];
      count++;

      if (x > 0 && !visited[idx - 1] && map[idx - 1] > 0.3) { visited[idx - 1] = 1; stack.push(idx - 1); }
      if (x + 1 < width && !visited[idx + 1] && map[idx + 1] > 0.3) { visited[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && !visited[idx - width] && map[idx - width] > 0.3) { visited[idx - width] = 1; stack.push(idx - width); }
      if (y + 1 < height && !visited[idx + width] && map[idx + width] > 0.3) { visited[idx + width] = 1; stack.push(idx + width); }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (count < 10 || bw < 4 || bh < 3 || scoreSum / count < 0.45) continue;

    // DBNet 输出为收缩后的文本核，按行高比例向外扩展还原完整字框。
    const padY = Math.max(2, bh * 0.48);
    const padX = Math.max(3, bh * 0.55);
    const left = Math.max(0, Math.floor((minX - padX) * scaleX));
    const top = Math.max(0, Math.floor((minY - padY) * scaleY));
    const right = Math.min(origW, Math.ceil((maxX + 1 + padX) * scaleX));
    const bottom = Math.min(origH, Math.ceil((maxY + 1 + padY) * scaleY));
    if (right - left >= 6 && bottom - top >= 6) {
      boxes.push({ left, top, width: right - left, height: bottom - top });
    }
  }

  // 按视觉阅读顺序排序（先从上到下，同一行内从左到右）。
  boxes.sort((a, b) => a.top - b.top || a.left - b.left);
  return { boxes, origW, origH };
}

/** CTC 贪心解码单个文本条；PP-OCRv5 词典第 0 位为空白，末尾补充空格。 */
async function recognizeCrop(ort, recSession, dict, baseSharpBuffer, box) {
  const recH = 48;
  const targetW = Math.min(1600, Math.max(16, Math.round(box.width * (recH / Math.max(1, box.height)))));
  const { data: pixels } = await sharp(baseSharpBuffer)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .resize(targetW, recH, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const area = recH * targetW;
  const tensor = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    // BGR 顺序，归一化到 [-1, 1]
    tensor[i] = (pixels[i * 3 + 2] / 255 - 0.5) / 0.5;
    tensor[area + i] = (pixels[i * 3 + 1] / 255 - 0.5) / 0.5;
    tensor[2 * area + i] = (pixels[i * 3] / 255 - 0.5) / 0.5;
  }

  const output = await recSession.run({
    [recSession.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, recH, targetW]),
  });
  const outTensor = output[recSession.outputNames[0]];
  const [, steps, classes] = outTensor.dims;
  const logits = outTensor.data;

  let text = '';
  let prev = 0;
  let scoreSum = 0;
  let charCount = 0;

  for (let t = 0; t < steps; t++) {
    const offset = t * classes;
    let bestIdx = 0;
    let bestVal = logits[offset];
    for (let c = 1; c < classes; c++) {
      const val = logits[offset + c];
      if (val > bestVal) {
        bestVal = val;
        bestIdx = c;
      }
    }
    if (bestIdx !== 0 && bestIdx !== prev) {
      const ch = dict[bestIdx] ?? '';
      if (ch) {
        text += ch;
        scoreSum += bestVal;
        charCount++;
      }
    }
    prev = bestIdx;
  }

  return { text: text.trim(), score: charCount ? scoreSum / charCount : 0 };
}

/** 将同一水平行的多个文本框拼为一行，保留 12306/携程 截图的左右排版关系。 */
function groupIntoLines(items) {
  const rows = [];
  for (const item of items) {
    const centerY = item.top + item.height / 2;
    let placed = false;
    for (const row of rows) {
      const tolerance = Math.max(row.avgHeight, item.height) * 0.55;
      if (Math.abs(centerY - row.centerY) <= tolerance) {
        row.items.push(item);
        const total = row.items.length;
        row.centerY = (row.centerY * (total - 1) + centerY) / total;
        row.avgHeight = (row.avgHeight * (total - 1) + item.height) / total;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push({ centerY, avgHeight: item.height, items: [item] });
    }
  }
  rows.sort((a, b) => a.centerY - b.centerY);
  return rows
    .map((row) => row.items.sort((a, b) => a.left - b.left).map((i) => i.text).join('  '))
    .filter(Boolean);
}

export function createLocalOcr({ directory = defaultDirectory, fetchImpl = fetch } = {}) {
  let readyPromise = null;

  async function load(onProgress) {
    if (!readyPromise) {
      readyPromise = (async () => {
        const ort = await import('onnxruntime-node');
        const [detBytes, recBytes, dictBytes] = await Promise.all([
          ensureAsset(directory, OCR_MODELS.det, fetchImpl, onProgress),
          ensureAsset(directory, OCR_MODELS.rec, fetchImpl, onProgress),
          ensureAsset(directory, OCR_MODELS.dict, fetchImpl, onProgress),
        ]);
        const options = { executionProviders: ['cpu'], logSeverityLevel: 3 };
        const [detSession, recSession] = await Promise.all([
          ort.InferenceSession.create(detBytes, options),
          ort.InferenceSession.create(recBytes, options),
        ]);
        const rawLines = dictBytes.toString('utf8').replace(/\r\n/g, '\n').split('\n');
        // 移除末尾空行；索引 0 留给 CTC blank，索引 1..N 为字典字符，最后补充空格。
        while (rawLines.length && rawLines.at(-1) === '') rawLines.pop();
        const dict = ['', ...rawLines, ' '];
        return { ort, detSession, recSession, dict };
      })().catch((error) => {
        readyPromise = null;
        throw error;
      });
    }
    return readyPromise;
  }

  return {
    /**
     * 识别图片中的文字，返回按行排版的纯文本和行数组。
     * 仅在内存中处理 imageBuffer，绝不落盘。
     */
    async recognize(imageBuffer, onProgress) {
      const { ort, detSession, recSession, dict } = await load(onProgress);
      onProgress?.('正在本机离线识别截图文字');
      const { boxes } = await detectBoxes(ort, detSession, imageBuffer);
      if (!boxes.length) return { text: '', lines: [] };

      const normalizedPng = await sharp(imageBuffer)
        .flatten({ background: '#ffffff' })
        .removeAlpha()
        .png()
        .toBuffer();

      const recognized = [];
      for (const box of boxes.slice(0, 120)) {
        const res = await recognizeCrop(ort, recSession, dict, normalizedPng, box);
        if (res.text && res.score >= 0.45) {
          recognized.push({ ...box, text: res.text });
        }
      }
      const lines = groupIntoLines(recognized);
      return { text: lines.join('\n'), lines };
    },
  };
}
