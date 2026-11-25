import type { ReactNode } from 'react';
import type { AppLanguage } from '../i18n';

export interface AvatarPreset {
  id: string;
  label: string;
  labelEn: string;
  bg: string;
  accent: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'bear', label: '小熊旅人', labelEn: 'Bear', bg: '#fde8d7', accent: '#c98253' },
  { id: 'cat', label: '元气橘猫', labelEn: 'Orange Cat', bg: '#fff0cc', accent: '#e39142' },
  { id: 'bunny', label: '云朵小兔', labelEn: 'Cloud Bunny', bg: '#fce4ec', accent: '#d97396' },
  { id: 'fox', label: '森林小狐', labelEn: 'Forest Fox', bg: '#ffe6d5', accent: '#df6d43' },
  { id: 'camera', label: '微笑相机', labelEn: 'Camera', bg: '#dff2ec', accent: '#42907c' },
  { id: 'luggage', label: '快乐行李箱', labelEn: 'Suitcase', bg: '#e3effc', accent: '#4d82bd' },
  { id: 'balloon', label: '彩虹热气球', labelEn: 'Hot Air Balloon', bg: '#efe6fb', accent: '#8e66c7' },
  { id: 'sun', label: '元气太阳', labelEn: 'Sunshine', bg: '#fff3c4', accent: '#de9a2c' },
  { id: 'initial', label: '经典文字', labelEn: 'Initial', bg: '#eaf0e1', accent: '#526c48' },
];

export function isCustomAvatarUrl(avatarId?: string): boolean {
  if (!avatarId) return false;
  return /^(data:image\/(jpeg|jpg|png|webp|gif);base64,|https?:\/\/|blob:)/i.test(avatarId.trim());
}

/** 将上传或拍照的图片居中裁切为 256×256 正方形 JPEG dataURL（约 15-30KB），适合本地存储与云端同步。 */
export async function compressAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法读取该图片，请换一张重试'));
      el.src = objectUrl;
    });
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前环境不支持图片处理');
    const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = Math.max(0, ((img.naturalWidth || img.width) - minSide) / 2);
    const sy = Math.max(0, ((img.naturalHeight || img.height) - minSide) / 2);
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 65_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function TravelAvatar({
  avatarId,
  nickname,
  className = '',
}: {
  avatarId?: string;
  nickname: string;
  className?: string;
}) {
  if (isCustomAvatarUrl(avatarId)) {
    return (
      <span className={`travel-avatar travel-avatar-photo ${className}`} aria-hidden="true">
        <img src={avatarId} alt={nickname || '头像'} className="cute-avatar-img" />
      </span>
    );
  }

  const id = AVATAR_PRESETS.some((item) => item.id === avatarId) ? avatarId! : 'bear';
  const preset = AVATAR_PRESETS.find((item) => item.id === id) ?? AVATAR_PRESETS[0];
  const initial = (nickname.trim() || '旅')[0];

  const art: Record<string, ReactNode> = {
    bear: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#fde8d7" />
        <circle cx="22" cy="24" r="10" fill="#b97b4c" />
        <circle cx="22" cy="24" r="5.5" fill="#f3c5a2" />
        <circle cx="58" cy="24" r="10" fill="#b97b4c" />
        <circle cx="58" cy="24" r="5.5" fill="#f3c5a2" />
        <circle cx="40" cy="43" r="22" fill="#c98856" />
        <ellipse cx="40" cy="49" rx="11" ry="8.5" fill="#fae5d3" />
        <circle cx="31.5" cy="39" r="2.7" fill="#3a281d" />
        <circle cx="48.5" cy="39" r="2.7" fill="#3a281d" />
        <circle cx="32.4" cy="38" r="0.9" fill="#ffffff" />
        <circle cx="49.4" cy="38" r="0.9" fill="#ffffff" />
        <ellipse cx="26" cy="45" rx="4" ry="2.4" fill="#f29489" opacity="0.65" />
        <ellipse cx="54" cy="45" rx="4" ry="2.4" fill="#f29489" opacity="0.65" />
        <ellipse cx="40" cy="45.5" rx="3.4" ry="2.4" fill="#4a3122" />
        <path d="M36.5 50.5c1.5 1.8 5.5 1.8 7 0" fill="none" stroke="#4a3122" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M24 61c5 5 27 5 32 0" fill="none" stroke="#eb6b56" strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="52" cy="64" r="3" fill="#ffd97d" />
      </svg>
    ),
    cat: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#fff0cc" />
        <path d="M19 36 22 15l14 11Z" fill="#eea355" />
        <path d="M23 31 24.5 20l8 6.5Z" fill="#ffd1c4" />
        <path d="M61 36 58 15 44 26Z" fill="#eea355" />
        <path d="M57 31 55.5 20l-8 6.5Z" fill="#ffd1c4" />
        <ellipse cx="40" cy="45" rx="22" ry="19.5" fill="#f5b164" />
        <path d="M36 27v6M40 25.5v7.5M44 27v6" stroke="#d47b2c" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="31.5" cy="43" r="2.8" fill="#3a281d" />
        <circle cx="48.5" cy="43" r="2.8" fill="#3a281d" />
        <circle cx="32.4" cy="42" r="0.9" fill="#ffffff" />
        <circle cx="49.4" cy="42" r="0.9" fill="#ffffff" />
        <ellipse cx="25" cy="49" rx="4.2" ry="2.3" fill="#f48d85" opacity="0.65" />
        <ellipse cx="55" cy="49" rx="4.2" ry="2.3" fill="#f48d85" opacity="0.65" />
        <path d="M37.5 47.5h5L40 50Z" fill="#e66c5c" />
        <path d="M34.5 52c2 2.2 4.3 1.4 5.5-0.8 1.2 2.2 3.5 3 5.5 0.8" fill="none" stroke="#4a3122" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 45h7M15 50h7M57 45h7M58 50h7" stroke="#c97d38" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    bunny: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#fce4ec" />
        <ellipse cx="29" cy="23" rx="6.5" ry="16" transform="rotate(-10 29 23)" fill="#ffffff" stroke="#e9c8d4" strokeWidth="1.5" />
        <ellipse cx="29.5" cy="24" rx="3.2" ry="10.5" transform="rotate(-10 29.5 24)" fill="#f8b7cc" />
        <ellipse cx="51" cy="23" rx="6.5" ry="16" transform="rotate(10 51 23)" fill="#ffffff" stroke="#e9c8d4" strokeWidth="1.5" />
        <ellipse cx="50.5" cy="24" rx="3.2" ry="10.5" transform="rotate(10 50.5 24)" fill="#f8b7cc" />
        <ellipse cx="40" cy="48" rx="21.5" ry="18.5" fill="#ffffff" stroke="#e9c8d4" strokeWidth="1.5" />
        <circle cx="31.5" cy="46" r="2.7" fill="#443038" />
        <circle cx="48.5" cy="46" r="2.7" fill="#443038" />
        <circle cx="32.4" cy="45" r="0.9" fill="#ffffff" />
        <circle cx="49.4" cy="45" r="0.9" fill="#ffffff" />
        <ellipse cx="25.5" cy="51.5" rx="4.2" ry="2.4" fill="#f79bb7" opacity="0.7" />
        <ellipse cx="54.5" cy="51.5" rx="4.2" ry="2.4" fill="#f79bb7" opacity="0.7" />
        <ellipse cx="40" cy="50" rx="2.3" ry="1.6" fill="#eb7c9c" />
        <path d="M36.8 54c1.6 1.8 4.8 1.8 6.4 0" fill="none" stroke="#5d424c" strokeWidth="2" strokeLinecap="round" />
        <path d="M62 24l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6Z" fill="#ffd166" />
      </svg>
    ),
    fox: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#ffe6d5" />
        <path d="M18 39 20 14l16 14Z" fill="#e87443" />
        <path d="M22 33 23 20l9 8Z" fill="#fff3e8" />
        <path d="M62 39 60 14 44 28Z" fill="#e87443" />
        <path d="M58 33 57 20l-9 8Z" fill="#fff3e8" />
        <path d="M18 44c0-13 10-19 22-19s22 6 22 19c0 12-10 20-22 20S18 56 18 44Z" fill="#ef7e4c" />
        <path d="M19 46c6-3 13 0 21 7 8-7 15-10 21-7-1 11-10 18-21 18S20 57 19 46Z" fill="#fff7ef" />
        <circle cx="31" cy="42" r="2.7" fill="#3a251c" />
        <circle cx="49" cy="42" r="2.7" fill="#3a251c" />
        <circle cx="32" cy="41" r="0.9" fill="#ffffff" />
        <circle cx="50" cy="41" r="0.9" fill="#ffffff" />
        <ellipse cx="40" cy="51.5" rx="3.4" ry="2.4" fill="#3a251c" />
        <path d="M36.5 56c1.8 1.6 5.2 1.6 7 0" fill="none" stroke="#53372b" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    camera: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#dff2ec" />
        <rect x="27" y="20" width="26" height="10" rx="4" fill="#59b59d" />
        <rect x="16" y="26" width="48" height="34" rx="10" fill="#6bc7af" />
        <rect x="16" y="34" width="48" height="18" fill="#fffbf5" />
        <circle cx="55" cy="30" r="2.8" fill="#ffd97d" />
        <circle cx="40" cy="43" r="12" fill="#417a6b" />
        <circle cx="40" cy="43" r="8.5" fill="#fffbf5" />
        <circle cx="36.8" cy="42" r="1.8" fill="#2e4f46" />
        <circle cx="43.2" cy="42" r="1.8" fill="#2e4f46" />
        <path d="M37.5 46.2c1.4 1.5 3.6 1.5 5 0" fill="none" stroke="#2e4f46" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="24" cy="43" r="2.5" fill="#f38e7e" opacity="0.8" />
        <circle cx="56" cy="43" r="2.5" fill="#f38e7e" opacity="0.8" />
      </svg>
    ),
    luggage: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#e3effc" />
        <path d="M32 25v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6" fill="none" stroke="#4d7cb3" strokeWidth="3.5" strokeLinecap="round" />
        <rect x="22" y="24" width="36" height="40" rx="10" fill="#7cb3ee" />
        <rect x="27" y="24" width="5" height="40" fill="#5b96d6" opacity="0.35" />
        <rect x="48" y="24" width="5" height="40" fill="#5b96d6" opacity="0.35" />
        <circle cx="33.5" cy="41" r="2.4" fill="#2a3d54" />
        <circle cx="46.5" cy="41" r="2.4" fill="#2a3d54" />
        <path d="M36.5 46c1.8 1.9 5.2 1.9 7 0" fill="none" stroke="#2a3d54" strokeWidth="2.1" strokeLinecap="round" />
        <ellipse cx="29" cy="45" rx="3" ry="1.8" fill="#f5989d" opacity="0.8" />
        <ellipse cx="51" cy="45" rx="3" ry="1.8" fill="#f5989d" opacity="0.8" />
        <rect x="44" y="51" width="9" height="6" rx="2" transform="rotate(-8 48 54)" fill="#ffd97d" />
        <circle cx="29" cy="66" r="3" fill="#455f7d" />
        <circle cx="51" cy="66" r="3" fill="#455f7d" />
      </svg>
    ),
    balloon: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#efe6fb" />
        <path d="M12 52c3-4 10-4 13 0 3-2 7-1 9 2H10c0-1 1-2 2-2Z" fill="#ffffff" opacity="0.85" />
        <path d="M52 26c3-3 8-3 11 0 3-2 6-1 8 2H50c0-1 1-2 2-2Z" fill="#ffffff" opacity="0.85" />
        <path d="M40 14c12.5 0 21 9.5 21 20.5 0 10-7.5 18-13.5 21.5h-15C26.5 52.5 19 44.5 19 34.5 19 23.5 27.5 14 40 14Z" fill="#f58b7c" />
        <path d="M40 14c5.5 0 9.5 9.5 9.5 20.5 0 10-3 18-6 21.5h-7c-3-3.5-6-11.5-6-21.5C30.5 23.5 34.5 14 40 14Z" fill="#ffd97d" />
        <path d="M40 14c2.4 0 4 9.5 4 20.5 0 10-1.2 18-2.5 21.5h-3c-1.3-3.5-2.5-11.5-2.5-21.5C36 23.5 37.6 14 40 14Z" fill="#7dc9b8" />
        <path d="M35 56v6M45 56v6" stroke="#8a6c56" strokeWidth="2" />
        <rect x="33" y="61" width="14" height="8" rx="3" fill="#c98e59" />
      </svg>
    ),
    sun: (
      <svg viewBox="0 0 80 80" className="cute-avatar-svg" aria-hidden="true">
        <circle cx="40" cy="40" r="40" fill="#fff4cc" />
        <g stroke="#f5b841" strokeWidth="4.2" strokeLinecap="round">
          <path d="M40 11v6M40 63v6M11 40h6M63 40h6M19.5 19.5l4.2 4.2M56.3 56.3l4.2 4.2M60.5 19.5l-4.2 4.2M23.7 56.3l-4.2 4.2" />
        </g>
        <circle cx="40" cy="40" r="19" fill="#ffd45c" />
        <circle cx="33.5" cy="38.5" r="2.5" fill="#5e3d1a" />
        <circle cx="46.5" cy="38.5" r="2.5" fill="#5e3d1a" />
        <ellipse cx="29" cy="43" rx="3.3" ry="2" fill="#f2846c" opacity="0.65" />
        <ellipse cx="51" cy="43" rx="3.3" ry="2" fill="#f2846c" opacity="0.65" />
        <path d="M35.5 44.5c2 2.4 7 2.4 9 0" fill="none" stroke="#5e3d1a" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
  };

  if (id === 'initial') {
    return (
      <span className={`travel-avatar travel-avatar-initial ${className}`} aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <span className={`travel-avatar ${className}`} style={{ background: preset.bg }} aria-hidden="true">
      {art[id]}
    </span>
  );
}

/** 轻量可爱装饰贴纸：在「极简留白」风格中通过 CSS 自动隐藏，保持纯粹干净。 */
export function CuteSticker({
  kind,
  className = '',
}: {
  kind: 'plane' | 'sparkle' | 'cloud' | 'stamp' | 'suitcase' | 'compass';
  className?: string;
}) {
  switch (kind) {
    case 'plane':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 64 44" fill="none" aria-hidden="true">
          <path d="M4 35c10-2 16-9 21-15" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" opacity="0.6" />
          <path d="M24 19 57 7 44 33l-9-8-6 6 1-8 17-10-16 8Z" fill="currentColor" opacity="0.92" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M22 6 25.5 16.5 36 20 25.5 23.5 22 34 18.5 23.5 8 20 18.5 16.5Z" fill="#ffd166" />
          <path d="M38 28 39.8 32.2 44 34 39.8 35.8 38 40 36.2 35.8 32 34 36.2 32.2Z" fill="#f38d7c" />
          <circle cx="11" cy="35" r="2.6" fill="#7dc9b8" />
        </svg>
      );
    case 'cloud':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 72 44" fill="none" aria-hidden="true">
          <path d="M18 36h36a11 11 0 0 0 2-21.8A15 15 0 0 0 27 11a12 12 0 0 0-9 25Z" fill="#ffffff" stroke="currentColor" strokeWidth="2" opacity="0.9" />
          <circle cx="31" cy="24" r="1.7" fill="currentColor" />
          <circle cx="41" cy="24" r="1.7" fill="currentColor" />
          <path d="M34 27.5c1.2 1.2 2.8 1.2 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'stamp':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" opacity="0.65" />
          <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
          <path d="M22 33h20M26 26l6-5 6 5M26 40l6 4 6-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        </svg>
      );
    case 'suitcase':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M24 20v-4a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v4" stroke="#d97757" strokeWidth="3.2" strokeLinecap="round" />
          <rect x="13" y="20" width="38" height="32" rx="9" fill="#ffd98a" stroke="#d97757" strokeWidth="2.5" />
          <path d="M23 20v32M41 20v32" stroke="#eb9f5e" strokeWidth="2.2" opacity="0.7" />
          <rect x="27" y="31" width="10" height="7" rx="2.5" transform="rotate(-7 32 34)" fill="#eb6b56" />
          <circle cx="21" cy="54" r="3" fill="#8f5d43" />
          <circle cx="43" cy="54" r="3" fill="#8f5d43" />
        </svg>
      );
    case 'compass':
      return (
        <svg className={`cute-deco cute-sticker ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="32" cy="34" r="22" fill="#fff7e2" stroke="#e09a43" strokeWidth="3" />
          <circle cx="32" cy="34" r="16" fill="#ffffff" stroke="#f0d399" strokeWidth="1.5" />
          <path d="M32 20l5 14-5 14-5-14Z" fill="#eb6b56" />
          <path d="M32 34l5 0-5 14-5-14Z" fill="#78b7e8" />
          <circle cx="32" cy="34" r="3" fill="#ffd97d" stroke="#5c4230" strokeWidth="1.5" />
          <circle cx="32" cy="10" r="3.5" stroke="#e09a43" strokeWidth="2.5" />
        </svg>
      );
  }
}

/** 根据种子生成多套可爱风景插画，让没有照片的旅行卡片也生动有趣。 */
export function IllustratedJourneyCover({ seed, label }: { seed: string; label?: string }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const variant = hash % 4;

  return (
    <span className="illustrated-mini-cover" aria-hidden="true">
      {variant === 0 && (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <rect width="320" height="180" fill="var(--cover-sky-top, #fceee4)" />
          <circle cx="250" cy="48" r="24" fill="var(--cover-sun, #ffd166)" />
          <path d="M46 58c10-8 25-7 34 1 8-5 19-4 25 3H38c2-2 5-3 8-4Z" fill="#ffffff" opacity="0.82" />
          <path d="M-10 144c58-42 124-38 192-6 52 24 96 6 148-24v76H-10Z" fill="var(--cover-hill-far, #c5d9b6)" />
          <path d="M-10 158c76-34 156-30 232 4 42 18 76 12 110-8v36H-10Z" fill="var(--cover-hill-mid, #96b884)" />
          <path d="M120 132 138 100l18 32Z" fill="#eb6b56" opacity="0.85" />
          <path d="M138 100v32" stroke="#fff6ec" strokeWidth="2" />
        </svg>
      )}
      {variant === 1 && (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <rect width="320" height="180" fill="var(--cover-sky-bot, #e6f4f8)" />
          <circle cx="72" cy="48" r="20" fill="var(--cover-sun, #ffd97d)" />
          <path d="M160 44c10-7 24-6 33 1 7-4 17-3 22 3h-62c2-2 4-3 7-4Z" fill="#ffffff" opacity="0.85" />
          <g transform="translate(206 34)">
            <ellipse cx="22" cy="24" rx="18" ry="20" fill="#f08270" />
            <ellipse cx="22" cy="24" rx="9" ry="20" fill="#ffd97d" />
            <rect x="16" y="48" width="12" height="8" rx="2.5" fill="#b77b4c" />
            <path d="M17 43v5M27 43v5" stroke="#8a5f3c" strokeWidth="1.8" />
          </g>
          <path d="M-10 145c70-22 150-24 220 4 45 18 78 12 120-12v54H-10Z" fill="var(--cover-hill-far, #b8dce4)" />
          <path d="M-10 162c92-22 184-16 340-2v30H-10Z" fill="var(--cover-hill-mid, #7bb7c7)" />
        </svg>
      )}
      {variant === 2 && (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <rect width="320" height="180" fill="var(--cover-sky-top, #fff3e4)" />
          <circle cx="242" cy="54" r="26" fill="var(--cover-sun, #f6b26b)" opacity="0.9" />
          <path d="M0 120c64-14 128 14 192 0s98-10 132 2v68H0Z" fill="var(--cover-hill-far, #a9d5e2)" />
          <path d="M0 142c72-12 144 12 216 0 46-8 78-4 108 6v42H0Z" fill="var(--cover-hill-mid, #6baac0)" />
          <g transform="translate(88 76)">
            <path d="M22 4 42 36H22Z" fill="#ffffff" />
            <path d="M20 12 6 36h14Z" fill="#ffd97d" />
            <path d="M4 38h40l-6 10H10Z" fill="#eb6b56" />
          </g>
        </svg>
      )}
      {variant === 3 && (
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <rect width="320" height="180" fill="var(--cover-sky-bot, #f3ecfb)" />
          <circle cx="80" cy="46" r="18" fill="var(--cover-sun, #ffd97d)" />
          <path d="M180 42c11-7 25-6 34 1 7-4 16-3 22 3h-62c2-2 4-3 6-4Z" fill="#ffffff" opacity="0.82" />
          <path d="M-10 130c84-32 164-28 242 4 38 16 68 12 98-6v62H-10Z" fill="var(--cover-hill-far, #cbbbe4)" />
          <rect x="0" y="138" width="320" height="42" fill="var(--cover-hill-mid, #9d8cc2)" />
          <g transform="translate(96 102)">
            <rect x="0" y="6" width="128" height="30" rx="10" fill="#ffffff" stroke="#6c5a91" strokeWidth="2.5" />
            <rect x="14" y="13" width="22" height="12" rx="4" fill="#a8d8f0" />
            <rect x="44" y="13" width="22" height="12" rx="4" fill="#ffd97d" />
            <rect x="74" y="13" width="22" height="12" rx="4" fill="#f7b7b7" />
            <circle cx="110" cy="19" r="5" fill="#7dc9b8" />
            <circle cx="24" cy="38" r="5.5" fill="#52446e" />
            <circle cx="104" cy="38" r="5.5" fill="#52446e" />
          </g>
        </svg>
      )}
      {label && <span className="illustrated-mini-tag">{label}</span>}
    </span>
  );
}

/** 旅行手账可爱空态插画 */
export function JournalEmptyArt() {
  return (
    <svg className="empty-scene-svg" viewBox="0 0 260 150" fill="none" aria-hidden="true">
      <ellipse cx="130" cy="132" rx="92" ry="12" fill="var(--surface-2)" />
      <path d="M36 52c8-8 22-8 30 0 6-4 15-3 19 3H30c1-2 3-3 6-3Z" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M188 38c7-6 18-6 24 0 5-3 12-2 15 2h-44c1-1 3-2 5-2Z" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M52 94c18-24 44-32 76-22" stroke="var(--coral, #eb6b56)" strokeWidth="2.2" strokeDasharray="4 5" strokeLinecap="round" opacity="0.65" />
      <path d="M182 48 214 34l-14 26-9-9-6 6 1-8 16-10-16 8Z" fill="#eb6b56" />
      <g transform="translate(88 46)">
        <path d="M26 16v-8a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v8" stroke="#c96b4b" strokeWidth="4.5" strokeLinecap="round" />
        <rect x="8" y="16" width="68" height="58" rx="16" fill="#ffd98a" stroke="#c96b4b" strokeWidth="3" />
        <path d="M24 16v58M60 16v58" stroke="#f0ab65" strokeWidth="3" opacity="0.7" />
        <circle cx="33" cy="41" r="3" fill="#4f3326" />
        <circle cx="51" cy="41" r="3" fill="#4f3326" />
        <path d="M37 48c2.6 2.6 7.4 2.6 10 0" stroke="#4f3326" strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="26" cy="46" rx="4" ry="2.2" fill="#f28b7d" opacity="0.75" />
        <ellipse cx="58" cy="46" rx="4" ry="2.2" fill="#f28b7d" opacity="0.75" />
        <rect x="46" y="54" width="16" height="10" rx="3" transform="rotate(-10 54 59)" fill="#7dc9b8" />
        <circle cx="22" cy="78" r="5" fill="#6b4e3d" />
        <circle cx="62" cy="78" r="5" fill="#6b4e3d" />
      </g>
      <path d="M56 30l2.5 5.5 5.5 2.5-5.5 2.5-2.5 5.5-2.5-5.5-5.5-2.5 5.5-2.5Z" fill="#ffd166" />
      <circle cx="196" cy="96" r="4.5" fill="#7dc9b8" />
      <circle cx="64" cy="112" r="3.5" fill="#f3a6b8" />
    </svg>
  );
}

/** 高光时刻空态插画 */
export function HighlightEmptyArt() {
  return (
    <svg className="empty-scene-svg compact" viewBox="0 0 180 116" fill="none" aria-hidden="true">
      <rect x="24" y="20" width="66" height="76" rx="10" transform="rotate(-8 57 58)" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2.2" />
      <rect x="31" y="27" width="52" height="44" rx="6" transform="rotate(-8 57 49)" fill="#ffe8cf" />
      <circle cx="48" cy="42" r="6" fill="#ffd166" />
      <rect x="84" y="24" width="68" height="78" rx="10" transform="rotate(6 118 63)" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2.2" />
      <rect x="92" y="31" width="52" height="44" rx="6" transform="rotate(6 118 53)" fill="#dff2ec" />
      <path d="M92 66c12-10 24-8 36 0l12 8H92Z" fill="#7dc9b8" />
      <path d="M88 12l2.5 5.5 5.5 2.5-5.5 2.5-2.5 5.5-2.5-5.5-5.5-2.5 5.5-2.5Z" fill="#ffd166" />
    </svg>
  );
}

/** 9 枚预设成就彩绘贴纸徽章 */
export function AchievementBadgeArt({ id, unlocked }: { id: string; unlocked: boolean }) {
  const icons: Record<string, { bg: string; ring: string; svg: ReactNode }> = {
    'first-trip': {
      bg: '#fff0cc',
      ring: '#f0b849',
      svg: (
        <>
          <path d="M24 22v-4a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v4" stroke="#b56b2a" strokeWidth="2.8" strokeLinecap="round" />
          <rect x="16" y="22" width="32" height="26" rx="7" fill="#f7b249" stroke="#b56b2a" strokeWidth="2.2" />
          <path d="M24 22v26M40 22v26" stroke="#ffdf96" strokeWidth="2.2" />
          <circle cx="32" cy="35" r="4" fill="#fff6df" />
        </>
      ),
    },
    'five-cities': {
      bg: '#e1f3e5',
      ring: '#5ea873',
      svg: (
        <>
          <circle cx="32" cy="32" r="16" fill="#7dc998" stroke="#3f8556" strokeWidth="2.2" />
          <path d="M32 20l4 12-4 12-4-12Z" fill="#eb6b56" />
          <path d="M32 32h4l-4 12-4-12Z" fill="#fff7e6" />
          <circle cx="32" cy="32" r="2.6" fill="#ffd166" />
        </>
      ),
    },
    'ten-cities': {
      bg: '#fde4dc',
      ring: '#e3775d',
      svg: (
        <>
          <circle cx="32" cy="33" r="16" fill="#7ec2e8" stroke="#457fa3" strokeWidth="2.2" />
          <path d="M22 28c4-2 8 1 10 5 2 3 6 3 10 1M24 41c5-3 10-2 15 1" stroke="#85d198" strokeWidth="5" strokeLinecap="round" />
          <path d="M44 16l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" fill="#ffd166" />
        </>
      ),
    },
    'province-hopper': {
      bg: '#e3effc',
      ring: '#5691cf',
      svg: (
        <>
          <path d="M16 44c8-16 14-14 20-4s10 4 14-12" stroke="#4f8bc9" strokeWidth="3" strokeDasharray="3 4" strokeLinecap="round" />
          <path d="M24 19a7 7 0 1 1 14 0c0 6-7 13-7 13s-7-7-7-13Z" fill="#eb6b56" stroke="#b34432" strokeWidth="2" />
          <circle cx="31" cy="19" r="2.8" fill="#ffffff" />
        </>
      ),
    },
    'photo-lover': {
      bg: '#e0f4ef',
      ring: '#47a893',
      svg: (
        <>
          <rect x="24" y="18" width="16" height="6" rx="2.5" fill="#4ea894" />
          <rect x="15" y="22" width="34" height="25" rx="7" fill="#6ec4b0" stroke="#3b8574" strokeWidth="2.2" />
          <circle cx="32" cy="35" r="7.5" fill="#fffdf7" stroke="#3b8574" strokeWidth="2.2" />
          <circle cx="32" cy="35" r="3.4" fill="#ffd166" />
          <circle cx="43" cy="27" r="2" fill="#ffe17d" />
        </>
      ),
    },
    'voice-keeper': {
      bg: '#f2e6fc',
      ring: '#9a68cf',
      svg: (
        <>
          <rect x="25" y="15" width="14" height="22" rx="7" fill="#b488e8" stroke="#794db0" strokeWidth="2.2" />
          <path d="M19 32a13 13 0 0 0 26 0M32 45v6M25 51h14" stroke="#794db0" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M29 23h6M29 28h6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
    'highlight-hunter': {
      bg: '#fff2d1',
      ring: '#e6a62c',
      svg: (
        <>
          <path d="M32 14l4.8 11.2 12.2 1.2-9.2 8 2.8 12-10.6-6.2L21.4 46.4l2.8-12-9.2-8 12.2-1.2Z" fill="#ffd15c" stroke="#c9851e" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="29" cy="31" r="1.7" fill="#6b4410" />
          <circle cx="35" cy="31" r="1.7" fill="#6b4410" />
          <path d="M30 35c1.2 1.2 2.8 1.2 4 0" stroke="#6b4410" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ),
    },
    'companion-joy': {
      bg: '#fde4ef',
      ring: '#de739e',
      svg: (
        <>
          <ellipse cx="26" cy="28" rx="9" ry="11" fill="#f58fa8" stroke="#c75473" strokeWidth="2" />
          <ellipse cx="39" cy="30" rx="8.5" ry="10.5" fill="#ffd97d" stroke="#cc9129" strokeWidth="2" />
          <path d="M26 39c0 6 3 9 5 12M39 40c0 5-2 8-4 11" stroke="#b06b7d" strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
    'long-wanderer': {
      bg: '#e5ecff',
      ring: '#6483d9',
      svg: (
        <>
          <rect x="16" y="20" width="32" height="24" rx="7" fill="#7ca2f2" stroke="#4c6ec2" strokeWidth="2.2" />
          <rect x="21" y="25" width="9" height="8" rx="2.5" fill="#fff8e8" />
          <rect x="34" y="25" width="9" height="8" rx="2.5" fill="#ffd97d" />
          <circle cx="23" cy="47" r="3.2" fill="#4c6ec2" />
          <circle cx="41" cy="47" r="3.2" fill="#4c6ec2" />
          <path d="M14 50h36" stroke="#8aa6e8" strokeWidth="2.2" strokeLinecap="round" />
        </>
      ),
    },
  };

  const entry = icons[id] ?? icons['first-trip'];
  return (
    <div
      className={`cute-badge-medallion ${unlocked ? 'is-unlocked' : 'is-locked'}`}
      style={{ '--badge-bg': entry.bg, '--badge-ring': entry.ring } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="none">
        {entry.svg}
      </svg>
    </div>
  );
}

export interface TravelerLevelTier {
  level: number;
  minCities: number;
  title: string;
  subtitle: string;
}

export const TRAVELER_LEVEL_TIERS: TravelerLevelTier[] = [
  { level: 1, minCities: 0, title: '新手小旅人', subtitle: '刚背上小书包，准备出发啦' },
  { level: 2, minCities: 1, title: '见习背包客', subtitle: '第一枚城市邮戳已经落袋' },
  { level: 3, minCities: 5, title: '城市漫游家', subtitle: '把街角微风收进小册子里' },
  { level: 4, minCities: 12, title: '风景收集控', subtitle: '足迹越画越宽，故事越来越暖' },
  { level: 5, minCities: 25, title: '山河探索官', subtitle: '走过山海湖川，阅尽四季风物' },
  { level: 6, minCities: 45, title: '九州巡游者', subtitle: '大半个中国都留下你的笑声' },
  { level: 7, minCities: 75, title: '星辰大玩家', subtitle: '行走的风景画册与快乐制造机' },
  { level: 8, minCities: 120, title: '传奇环游家', subtitle: '满级达成！把山河岁月酿成永恒纪念' },
];

export const TRAVELER_LEVEL_TIERS_EN: TravelerLevelTier[] = [
  { level: 1, minCities: 0, title: 'Rookie Traveler', subtitle: 'Backpack ready, adventure awaits' },
  { level: 2, minCities: 1, title: 'Junior Backpacker', subtitle: 'Your very first city stamp is in' },
  { level: 3, minCities: 5, title: 'City Stroller', subtitle: 'Tucking street breezes into your booklet' },
  { level: 4, minCities: 12, title: 'Scenery Collector', subtitle: 'Wider footprints, warmer stories' },
  { level: 5, minCities: 25, title: 'Landscape Explorer', subtitle: 'Across mountains, lakes, and all four seasons' },
  { level: 6, minCities: 45, title: 'Grand Voyager', subtitle: 'Leaving footprints across half the map' },
  { level: 7, minCities: 75, title: 'Starlight Nomad', subtitle: 'A living travel album in motion' },
  { level: 8, minCities: 120, title: 'Legendary Globetrotter', subtitle: 'Max level! Turning every mile into memory' },
];

export interface TravelerLevelInfo {
  level: number;
  maxLevel: number;
  title: string;
  subtitle: string;
  visitedCities: number;
  currentMinCities: number;
  nextTarget: number | null;
  nextTitle: string | null;
  remainingCities: number;
  progressPct: number;
  tiers: TravelerLevelTier[];
}

/** 按已点亮城市数计算旅人成长等级（共 8 级，规则透明直观）。 */
export function getTravelerLevel(visitedCities: number, _travelDays = 0, lang: AppLanguage = 'zh'): TravelerLevelInfo {
  const tiers = lang === 'en' ? TRAVELER_LEVEL_TIERS_EN : TRAVELER_LEVEL_TIERS;
  let currentTier = tiers[0];
  let nextTier: TravelerLevelTier | null = tiers[1];
  for (let i = 0; i < tiers.length; i += 1) {
    if (visitedCities >= tiers[i].minCities) {
      currentTier = tiers[i];
      nextTier = tiers[i + 1] ?? null;
    }
  }
  const span = nextTier ? Math.max(1, nextTier.minCities - currentTier.minCities) : 1;
  const gained = nextTier ? Math.max(0, visitedCities - currentTier.minCities) : 1;
  const progressPct = nextTier
    ? Math.min(100, Math.round((gained / span) * 100))
    : 100;

  return {
    level: currentTier.level,
    maxLevel: tiers.length,
    title: currentTier.title,
    subtitle: currentTier.subtitle,
    visitedCities,
    currentMinCities: currentTier.minCities,
    nextTarget: nextTier?.minCities ?? null,
    nextTitle: nextTier?.title ?? null,
    remainingCities: nextTier ? Math.max(0, nextTier.minCities - visitedCities) : 0,
    progressPct,
    tiers,
  };
}
