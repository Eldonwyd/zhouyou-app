import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** 本地配图检查：图上有没有文字、是不是拼图、是不是人像。全部在本机运行，不需要任何 Key。
 * 模型首次使用时从 ModelScope 下载并按 SHA-256 校验，之后离线可用：
 * - 文字：PP-OCRv5 移动端文字检测（Apache-2.0），只判断有无文字区域，不识别内容。
 * - 人物：RT-DETR r18 COCO（Apache-2.0），只看“人”这一类。用 fp32 版：CPU 上约 0.3 秒，
 *   int8 量化版反而要 4～8 秒。
 * - 拼图：纯像素计算，找贯穿整幅图的直线分隔。
 */
const MODELS = {
  text: {
    file: 'text-det-ppocrv5-mobile.onnx',
    url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx',
    sha256: '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae',
  },
  person: {
    file: 'person-det-rtdetr-r18.onnx',
    url: 'https://www.modelscope.cn/models/onnx-community/rtdetr_r18vd_coco_o365/resolve/master/onnx/model.onnx',
    sha256: '6c74a62251534f427294342508a162a7cd142418b4dd6222d0d0198851724bfa',
  },
};
const defaultDirectory = fileURLToPath(new URL('../.models/', import.meta.url));

// 判定门槛由真实小红书封面与正文图标定，见 PLAN.md 第 19 节。
export const INSPECT_LIMITS = {
  textArea: 0.006, // 文字区域占画面比例超过此值视为“带字”（样本：无字 ≤ 0.0066，有字 ≥ 0.011）
  textBlock: 0.004, // 单个最大文字块占比超过此值也视为“带字”（大标题）
  personArea: 0.05, // 单人框占画面比例超过此值视为人像
  personHeight: 0.4, // 单人框高度超过画面此比例视为人像
  peopleArea: 0.12, // 所有人框面积合计超过此值视为合照/人多
  personScore: 0.5,
  seamStep: 0.95, // 硬接缝：一行/列中 1 像素突变占比
  seamGrid: 0.8, // 正中断开：见 collageMetrics
};

async function loadModel(directory, spec, fetchImpl) {
  const filename = path.join(directory, spec.file);
  const verify = (bytes) => createHash('sha256').update(bytes).digest('hex') === spec.sha256;
  try {
    const bytes = await readFile(filename);
    if (verify(bytes)) return bytes;
  } catch { /* 首次使用：下载 */ }
  const response = await fetchImpl(spec.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('图片检查模型下载失败');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!verify(bytes)) throw new Error('图片检查模型校验失败');
  await mkdir(directory, { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
  return bytes;
}

/** 文字检测：按 PaddleOCR 预处理（BGR、ImageNet 均值方差、边长为 32 的倍数），
 * 输出概率图；统计文字像素占比和最大连通文字块占比。
 */
async function textMetrics(ort, session, input) {
  const { data, info } = await sharp(input).removeAlpha()
    .resize({ width: 640, height: 640, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const width = Math.max(32, Math.round(info.width / 32) * 32), height = Math.max(32, Math.round(info.height / 32) * 32);
  const { data: pixels } = await sharp(data, { raw: info }).resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const mean = [0.406, 0.456, 0.485], std = [0.225, 0.224, 0.229]; // BGR 顺序
  const tensor = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) tensor[c * width * height + i] = (pixels[i * 3 + (2 - c)] / 255 - mean[c]) / std[c];
  }
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, height, width]) });
  const map = output[session.outputNames[0]].data;
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (map[i] > 0.3) { mask[i] = 1; count++; }
  // 最大连通块（4 邻接）：大标题会形成大块，零散招牌小字不会。
  let largest = 0;
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let size = 0;
    mask[start] = 2; stack.push(start);
    while (stack.length) {
      const index = stack.pop(); size++;
      const x = index % width, y = (index - x) / width;
      for (const next of [x > 0 && index - 1, x < width - 1 && index + 1, y > 0 && index - width, y < height - 1 && index + width]) {
        if (next !== false && mask[next] === 1) { mask[next] = 2; stack.push(next); }
      }
    }
    largest = Math.max(largest, size);
  }
  return { textArea: count / mask.length, textBlock: largest / mask.length };
}

/** 人物检测：RT-DETR 输出 300 个候选框，取“人”类分数高的框，统计最大单人面积/高度与合计面积。 */
async function personMetrics(ort, session, input) {
  const size = 640;
  const { data } = await sharp(input).removeAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const tensor = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) tensor[c * size * size + i] = data[i * 3 + c] / 255;
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size, size]) });
  const logits = output.logits.data, boxes = output.pred_boxes.data;
  const classes = output.logits.dims[2];
  let maxArea = 0, maxHeight = 0, totalArea = 0, count = 0;
  for (let q = 0; q < output.logits.dims[1]; q++) {
    const score = 1 / (1 + Math.exp(-logits[q * classes])); // 第 0 类为 person
    if (score < INSPECT_LIMITS.personScore) continue;
    const w = boxes[q * 4 + 2], h = boxes[q * 4 + 3];
    count++; totalArea += w * h;
    maxArea = Math.max(maxArea, w * h); maxHeight = Math.max(maxHeight, h);
  }
  return { people: count, personArea: maxArea, personHeight: maxHeight, peopleArea: totalArea };
}

/** 拼图检测（纯像素计算，约 0.1 秒）。三条规则任一命中即判为拼图：
 * 1. 留白缝：两条贴近的贯穿强边缘之间夹着颜色均匀的几行（白边/色块分隔）。
 * 2. 硬接缝：某一行/列几乎全宽都是 1 像素宽的突变（自然照片的边缘会过渡几个像素）。
 * 3. 正中断开：等分宫格拼图的接缝在正中，横竖两个方向都大面积断开；
 *    地平线、树干通常只在一个方向，不会同时满足。
 */
async function collageMetrics(input) {
  const grey = async (size) => {
    const pipeline = sharp(input).greyscale();
    const { data, info } = await (size ? pipeline.resize({ width: size, height: size, fit: 'inside' }) : pipeline).raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  };
  const both = (image, scan) => Math.max(scan(image.h, image.w, (j, i) => image.data[i * image.w + j]),
    scan(image.w, image.h, (j, i) => image.data[j * image.w + i]));
  const gutter = (len, span, get) => {
    const edge = new Float32Array(len), std = new Float32Array(len);
    for (let i = 1; i < len - 1; i++) {
      let strong = 0, sum = 0, sq = 0;
      for (let j = 0; j < span; j++) {
        if (Math.abs(get(j, i + 1) - get(j, i - 1)) > 28) strong++;
        const v = get(j, i); sum += v; sq += v * v;
      }
      edge[i] = strong / span; const m = sum / span; std[i] = Math.sqrt(Math.max(0, sq / span - m * m));
    }
    for (let i = Math.round(len * 0.08); i < len * 0.92; i++) {
      if (edge[i] < 0.8) continue;
      for (let k = i + 2; k <= Math.min(len - 2, i + 12); k++) {
        if (edge[k] < 0.8) continue;
        let uniform = true;
        for (let m = i + 1; m < k; m++) if (std[m] > 14 && edge[m] < 0.8) { uniform = false; break; }
        if (uniform) return 1;
        break;
      }
    }
    return 0;
  };
  const step = (len, span, get) => {
    let best = 0;
    for (let i = Math.round(len * 0.08); i < len * 0.92 - 2; i++) {
      let hits = 0;
      for (let j = 0; j < span; j++) {
        const g0 = Math.abs(get(j, i + 1) - get(j, i));
        if (g0 < 14) continue;
        const near = Math.max(Math.abs(get(j, i) - get(j, i - 1)), Math.abs(get(j, i + 2) - get(j, i + 1)));
        if (g0 > 2.5 * near) hits++;
      }
      best = Math.max(best, hits / span);
    }
    return best;
  };
  const middle = (len, span, get) => {
    let best = 0;
    for (let i = Math.round(len * 0.47); i <= Math.round(len * 0.53); i++) {
      let hits = 0;
      for (let j = 0; j < span; j++) {
        const above = (get(j, i - 1) + get(j, i - 2) + get(j, i - 3)) / 3, below = (get(j, i + 1) + get(j, i + 2) + get(j, i + 3)) / 3;
        if (Math.abs(above - below) > 22) hits++;
      }
      best = Math.max(best, hits / span);
    }
    return best;
  };
  const [small, full, medium] = await Promise.all([grey(320), grey(0), grey(480)]);
  const midRow = middle(medium.h, medium.w, (j, i) => medium.data[i * medium.w + j]);
  const midCol = middle(medium.w, medium.h, (j, i) => medium.data[j * medium.w + i]);
  return {
    seamGutter: both(small, gutter),
    seamStep: both(full, step),
    seamGrid: Math.max(Math.min(midRow, midCol / 0.5), Math.min(midCol, midRow / 0.5)), // 一向 > 0.8 且另一向 > 0.4 时 > 0.8
  };
}

export function createPhotoInspector({ directory = defaultDirectory, fetchImpl = fetch } = {}) {
  let ready;
  const load = () => {
    ready ??= (async () => {
      const ort = await import('onnxruntime-node');
      const options = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 4 };
      const [text, person] = await Promise.all([
        loadModel(directory, MODELS.text, fetchImpl).then((bytes) => ort.InferenceSession.create(bytes, options)),
        loadModel(directory, MODELS.person, fetchImpl).then((bytes) => ort.InferenceSession.create(bytes, options)),
      ]);
      return { ort, text, person };
    })().catch((error) => { ready = undefined; throw error; });
    return ready;
  };
  // 推理串行进行，避免多张图同时占满 CPU。
  let chain = Promise.resolve();
  async function measure(input) {
    const { ort, text, person } = await load();
    const run = async () => ({ ...(await textMetrics(ort, text, input)), ...(await personMetrics(ort, person, input)), ...(await collageMetrics(input)) });
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }
  return {
    measure,
    /** 返回 null 表示可用；否则返回不可用的原因。 */
    async check(input) {
      const m = await measure(input);
      const L = INSPECT_LIMITS;
      if (m.textArea > L.textArea || m.textBlock > L.textBlock) return '图上有文字';
      if (m.seamGutter || m.seamStep > L.seamStep || m.seamGrid > L.seamGrid) return '疑似拼图';
      if (m.personArea > L.personArea || m.personHeight > L.personHeight || m.peopleArea > L.peopleArea) return '以人物为主';
      return null;
    },
    warm: () => load().then(() => true),
  };
}
