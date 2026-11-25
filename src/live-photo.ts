import type { TravelMedia } from './types';

export interface MotionPhotoTrack {
  offset: number;
  length: number;
  mimeType: string;
}

const VALID_VIDEO_BRANDS = new Set([
  'mp41', 'mp42', 'isom', 'iso2', 'iso5', 'iso6', 'avc1',
  'qt  ', 'M4V ', 'M4A ', '3gp4', '3gp5', '3gp6', '3g2a', 'f4v ', 'dash',
]);

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.byteLength, start + length);
  for (let i = start; i < end; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) return 0;
  return (
    ((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  );
}

function isMp4BoxAt(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + 12 > bytes.byteLength) return false;
  const boxSize = readUint32BE(bytes, offset);
  if (boxSize < 16 || boxSize > 128 || offset + boxSize > bytes.byteLength) return false;
  if (
    bytes[offset + 4] !== 0x66 // f
    || bytes[offset + 5] !== 0x74 // t
    || bytes[offset + 6] !== 0x79 // y
    || bytes[offset + 7] !== 0x70 // p
  ) {
    return false;
  }
  const brand = readAscii(bytes, offset + 8, 4);
  return VALID_VIDEO_BRANDS.has(brand);
}

function findSequence(bytes: Uint8Array, pattern: Uint8Array, start = 0, end = bytes.byteLength): number {
  const limit = Math.min(end, bytes.byteLength) - pattern.byteLength;
  for (let i = Math.max(0, start); i <= limit; i += 1) {
    let matched = true;
    for (let j = 0; j < pattern.byteLength; j += 1) {
      if (bytes[i + j] !== pattern[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/**
 * Detect embedded MP4/MOV video inside an Android Motion Photo (Google Pixel,
 * Xiaomi HyperOS, Huawei HarmonyOS, OPPO ColorOS, vivo OriginOS, Samsung).
 * Works directly on raw lossless bytes without re-encoding or mutating the image.
 */
export function detectMotionPhoto(bytes: Uint8Array): MotionPhotoTrack | null {
  if (bytes.byteLength < 128) return null;
  // Must look like a JPEG (FF D8) or HEIF/MP4 container; skip plain videos.
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isJpeg) return null;

  // 1. Inspect XMP header (usually within the first 128 KB).
  const headerSlice = bytes.subarray(0, Math.min(bytes.byteLength, 131072));
  let headerText = '';
  try {
    headerText = new TextDecoder('latin1').decode(headerSlice);
  } catch {
    headerText = '';
  }

  if (headerText) {
    // 1a. Google Motion Photo v2 (Container:Directory with Item:Mime="video/..." + Item:Length="...")
    const v2Regex = /Item:Mime=["'](video\/[a-z0-9.+-]+)["'][^>]*?Item:Length=["'](\d+)["']|Item:Length=["'](\d+)["'][^>]*?Item:Mime=["'](video\/[a-z0-9.+-]+)["']/i;
    const v2Match = headerText.match(v2Regex);
    if (v2Match) {
      const mimeType = v2Match[1] || v2Match[4] || 'video/mp4';
      const length = Number(v2Match[2] || v2Match[3] || 0);
      if (Number.isFinite(length) && length >= 1024 && length < bytes.byteLength) {
        const offset = bytes.byteLength - length;
        if (isMp4BoxAt(bytes, offset)) {
          return { offset, length, mimeType };
        }
      }
    }

    // 1b. Google MicroVideo v1 (GCamera:MicroVideoOffset="...")
    const v1Match = headerText.match(/MicroVideoOffset=["'](\d+)["']/i);
    if (v1Match) {
      const length = Number(v1Match[1]);
      if (Number.isFinite(length) && length >= 1024 && length < bytes.byteLength) {
        const offset = bytes.byteLength - length;
        if (isMp4BoxAt(bytes, offset)) {
          return { offset, length, mimeType: 'video/mp4' };
        }
      }
    }
  }

  // 2. Samsung MotionPhoto_Data marker.
  const samsungMarker = new TextEncoder().encode('MotionPhoto_Data');
  const samsungIdx = findSequence(bytes, samsungMarker, 16);
  if (samsungIdx !== -1) {
    const offset = samsungIdx + samsungMarker.byteLength;
    if (isMp4BoxAt(bytes, offset)) {
      return { offset, length: bytes.byteLength - offset, mimeType: 'video/mp4' };
    }
  }

  // 3. Generic fallback for OEM Motion Photos (Huawei / Xiaomi / Honor / OPPO / vivo):
  // scan for an ISO BMFF `ftyp` video box appended after the JPEG body.
  const ftypMarker = new Uint8Array([0x66, 0x74, 0x79, 0x70]); // "ftyp"
  let cursor = 64;
  while (cursor < bytes.byteLength - 16) {
    const found = findSequence(bytes, ftypMarker, cursor);
    if (found === -1) break;
    const boxStart = found - 4;
    if (boxStart >= 64 && isMp4BoxAt(bytes, boxStart)) {
      const length = bytes.byteLength - boxStart;
      if (length >= 1024) {
        const brand = readAscii(bytes, boxStart + 8, 4);
        const mimeType = brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
        return { offset: boxStart, length, mimeType };
      }
    }
    cursor = found + 4;
  }

  return null;
}

function fileStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
}

function isPhotoCandidate(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name);
}

function isCompanionVideoCandidate(file: File): boolean {
  const isMovOrMp4 = file.type === 'video/quicktime'
    || file.type === 'video/mp4'
    || /\.(mov|mp4|m4v)$/i.test(file.name);
  // iOS Live Photo companion clips are short (typically 1-15 MB); cap at 30 MB so full movies stay separate.
  return isMovOrMp4 && file.size > 0 && file.size <= 30 * 1024 * 1024;
}

/**
 * Pair iOS Live Photo uploads when a photo and a companion short MOV/MP4 video
 * share the exact same filename stem (e.g. IMG_1234.HEIC + IMG_1234.MOV).
 */
export function pairLivePhotoItems<T extends { file: File }>(
  items: T[],
): Array<{ item: T; companionVideoFile?: File }> {
  const photosByStem = new Map<string, T>();
  for (const item of items) {
    if (isPhotoCandidate(item.file)) {
      const stem = fileStem(item.file.name);
      if (stem && !photosByStem.has(stem)) photosByStem.set(stem, item);
    }
  }

  const companionByPhoto = new Map<T, File>();
  const consumedVideos = new Set<T>();

  for (const item of items) {
    if (!isCompanionVideoCandidate(item.file)) continue;
    const stem = fileStem(item.file.name);
    const matchedPhoto = photosByStem.get(stem);
    if (matchedPhoto && matchedPhoto !== item && !companionByPhoto.has(matchedPhoto)) {
      companionByPhoto.set(matchedPhoto, item.file);
      consumedVideos.add(item);
    }
  }

  const result: Array<{ item: T; companionVideoFile?: File }> = [];
  for (const item of items) {
    if (consumedVideos.has(item)) continue;
    result.push({ item, companionVideoFile: companionByPhoto.get(item) });
  }
  return result;
}

export function isLivePhotoMedia(item: TravelMedia): boolean {
  return Boolean(
    item.liveVideoId
    || (typeof item.liveVideoOffset === 'number' && typeof item.liveVideoLength === 'number' && item.liveVideoLength > 0),
  );
}

export function isAnimatedImageMedia(item: TravelMedia): boolean {
  return item.mimeType === 'image/gif' || /\.gif$/i.test(item.fileName);
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
