import { useEffect, useId, useState } from 'react';
import { getMediaBlob, getMediaPreview } from '../db';
import { useI18n } from '../i18n';
import type { TravelMedia } from '../types';

/** 图标沿用轻线条笔触，使用内联 SVG，无需联网加载图标字体。 */
export function TravelIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    map: 'M3 5 9 3l6 3 6-2v15l-6 2-6-3-6 2Zm6-2v15m6-12v15',
    detail: 'M4 3h16v18H4Zm4 0v18m3-12h5m-5 4h5',
    plan: 'M4 5h16v16H4Zm4-3v6m8-6v6M4 11h16m-12 4h2m4 0h2',
    achievements: 'M12 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm-4 13-2 7 6-3 6 3-2-7',
    profile: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 22v-3a8 8 0 0 1 16 0v3',
    settings: 'M12 8.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Zm7.4 4.25a7.5 7.5 0 0 0 .06-1 7.5 7.5 0 0 0-.06-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.3 7.3 0 0 0-1.73 1l-2.39-.96a.5.5 0 0 0-.61.22L2.45 8.78a.5.5 0 0 0 .12.64L4.6 11a7.5 7.5 0 0 0-.06 1c0 .34.02.67.06 1l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.53.41 1.11.75 1.73 1l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.62-.25 1.2-.59 1.73-1l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13Z',
    globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
    palette: 'M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a1.5 1.5 0 0 1 0-3h3a5 5 0 0 0 5-5c0-2.8-4-5-9-5Zm-4.5 7a1 1 0 1 1 0 .01M10 6.5a1 1 0 1 1 0 .01M14.5 6.5a1 1 0 1 1 0 .01',
    server: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm0 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Zm4-8h.01M8 17h.01',
    leaf: 'M19 3C5 1 1 10 7 16s15 2 12-13ZM5 21 16 8m-8 7 1-6m3 3h5',
    sun: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0-5v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
    mountain: 'm2 20 8-16 5 9 3-5 5 12Zm4-8 4 3 3-3',
    food: 'M4 3v5a3 3 0 0 0 6 0V3M7 3v18M19 3c-3 1-4 5-4 9h4m0-9v18',
    camera: 'M3 7h4l2-3h6l2 3h4v13H3Zm9 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    train: 'M6 16V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2ZM6 10h12M12 3v7m-3 8-3 3m9-3 3 3M9 14h.1m5.9 0h.1',
    plane: 'M22 5a2 2 0 0 0-3-2l-5 5-8-3-2 2 6 5-4 4-3-1-1 2 4 2 2 4 2-1-1-3 4-4 5 6 2-2-3-8 4-4a2 2 0 0 0 1-2Z',
    backup: 'M4 6h16v15H4ZM3 3h18v3H3Zm6 9 3 3 3-3m-3-4v7',
  };
  return <svg className="travel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.leaf} /></svg>;
}

/** 封面只使用用户自己的照片；没有照片时显示可爱手账风风景插画，绝不伪造实拍照片。 */
export function TravelCover({ media, label, full = false }: { media?: TravelMedia; label?: string; full?: boolean }) {
  const { t } = useI18n();
  const displayLabel = label === undefined ? t('等待下一次出发', 'Ready for the next journey') : label;
  const [url, setUrl] = useState('');
  const uid = useId().replace(/:/g, '');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    if (media?.kind === 'photo') void (full ? getMediaBlob(media.id) : getMediaPreview(media.id, 'photo')).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [media?.id, full]);

  return (
    <div className={`travel-cover ${url ? 'has-photo' : 'illustrated'}`}>
      {url ? (
        <img src={url} alt={displayLabel} loading="lazy" />
      ) : (
        <>
          <svg className="cover-art-svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <linearGradient id={`cover-sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cover-sky-top, #ffece1)" />
                <stop offset="100%" stopColor="var(--cover-sky-bot, #fff6ea)" />
              </linearGradient>
              <radialGradient id={`cover-sun-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--cover-sun, #ffd166)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="var(--cover-sun, #ffd166)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="640" height="360" fill={`url(#cover-sky-${uid})`} />
            <circle cx="496" cy="96" r="96" fill={`url(#cover-sun-${uid})`} />
            <circle cx="496" cy="96" r="36" fill="var(--cover-sun, #ffd166)" opacity="0.96" />

            {/* 蓬松白云 */}
            <g opacity="0.88">
              <path d="M98 112c14-14 38-15 54-3 12-9 30-7 40 3 10-4 22 2 24 12H82c1-6 8-11 16-12Z" fill="#ffffff" />
              <path d="M342 138c11-10 28-11 40-2 9-6 22-5 29 3 8-3 16 1 18 9h-98c1-5 5-8 11-10Z" fill="#ffffff" opacity="0.8" />
            </g>

            {/* 可爱绘本装饰层（极简留白风下自动隐藏） */}
            <g className="cute-deco cover-cute-details">
              {/* 虚线飞行轨迹 */}
              <path d="M188 182c42-48 116-74 204-56" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeDasharray="6 7" strokeLinecap="round" opacity="0.82" />
              {/* 彩虹热气球 */}
              <g transform="translate(232 62) rotate(-5)">
                <ellipse cx="30" cy="34" rx="26" ry="29" fill="#f38472" />
                <ellipse cx="30" cy="34" rx="15" ry="29" fill="#ffd97d" />
                <ellipse cx="30" cy="34" rx="6" ry="29" fill="#7dc9b8" />
                <path d="M23 62v9M37 62v9" stroke="#8a624a" strokeWidth="2" />
                <rect x="21" y="70" width="18" height="11" rx="3.5" fill="#c78a52" />
              </g>
              {/* 远处小小热气球 */}
              <g transform="translate(384 114) scale(0.55) rotate(6)">
                <ellipse cx="30" cy="34" rx="26" ry="29" fill="#8dc5eb" />
                <ellipse cx="30" cy="34" rx="13" ry="29" fill="#fff3c4" />
                <path d="M23 62v9M37 62v9" stroke="#7d6452" strokeWidth="2.4" />
                <rect x="21" y="70" width="18" height="11" rx="4" fill="#c78a52" />
              </g>
              {/* 星星点缀 */}
              <path d="M148 76l3 6.5 6.5 3-6.5 3-3 6.5-3-6.5-6.5-3 6.5-3Z" fill="#ffd166" />
              <circle cx="428" cy="76" r="4" fill="#ffffff" opacity="0.9" />
              <circle cx="566" cy="146" r="3.5" fill="#f5988a" opacity="0.8" />
            </g>

            {/* 远中近三层温柔山丘 */}
            <path d="M-20 264C92 204 196 202 308 248c100 40 198 10 352-52v184H-20Z" fill="var(--cover-hill-far, #b8e0c4)" opacity="0.86" />
            <path d="M-20 292C118 238 240 228 386 276c94 31 182 22 274-20v124H-20Z" fill="var(--cover-hill-mid, #86cc9f)" opacity="0.92" />

            {/* 山坡上的小房子、松树和风车（极简留白风下自动隐藏） */}
            <g className="cute-deco cover-cute-details">
              {/* 小红顶小屋 */}
              <g transform="translate(468 206)">
                <rect x="10" y="24" width="38" height="28" rx="4" fill="#fffaf0" />
                <path d="M4 27 29 7l25 20Z" fill="#eb6b56" />
                <rect x="23" y="34" width="11" height="18" rx="4" fill="#d9945b" />
                <rect x="38" y="32" width="7" height="7" rx="1.8" fill="#9cd3ee" />
                <rect x="40" y="10" width="6" height="12" rx="1.5" fill="#d67c63" />
              </g>
              {/* 小松树 */}
              <g transform="translate(426 226)">
                <rect x="11" y="24" width="5" height="12" rx="2" fill="#8c6244" />
                <path d="M13.5 0 25 18H2Z" fill="#5aa173" />
                <path d="M13.5 9 27 27H0Z" fill="#4e9266" />
              </g>
              <g transform="translate(534 220) scale(0.85)">
                <rect x="11" y="24" width="5" height="12" rx="2" fill="#8c6244" />
                <path d="M13.5 0 25 18H2Z" fill="#67b080" />
                <path d="M13.5 9 27 27H0Z" fill="#52976b" />
              </g>
              {/* 左侧小露营帐篷 */}
              <g transform="translate(132 226)">
                <path d="M22 4 44 36H0Z" fill="#ffd166" />
                <path d="M22 4 32 36H12Z" fill="#f0826f" />
                <path d="M22 20 27 36H17Z" fill="#6d4739" />
              </g>
            </g>

            <path d="M-20 326C150 272 318 268 660 324v56H-20Z" fill="var(--cover-hill-near, #53a677)" />
          </svg>
          <span className="cover-caption">{displayLabel}</span>
        </>
      )}
    </div>
  );
}
