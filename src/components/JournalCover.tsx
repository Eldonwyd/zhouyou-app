import { useEffect, useState } from 'react';
import { plannerApiUrl } from '../api-base';
import { getCloudPlannerPhotoUrl } from '../cloud-api';
import { getMediaPreview, getPlannerPhotoBlob } from '../db';
import type { AiTravelPlan, PlannerPhoto } from '../planner-types';
import northPostcards from '../city-postcards-north.webp';
import southPostcards from '../city-postcards-south.webp';
import shandongPostcards from '../city-postcards-shandong.webp';
import genericPostcards from '../city-postcards-generic.webp';
import { IllustratedJourneyCover } from './CuteArt';

// 每一行按图集从左到右排列。只有明确对应的行政区划代码才使用地标插画。
const CITY_ART_SHEETS = {
  [northPostcards]: [
    '110100', '120100', '130300', '140200',
    '150700', '150500', '210100', '211200',
    '220600', '220200', '220400', '220300',
    '220500', '222400', '220100', '231000',
  ],
  [southPostcards]: [
    '310100', '320100', '320500', '320200',
    '321000', '321100', '330100', '330600',
    '340100', '341000', '440100', '440300',
    '610100', '610400', '610300', '610600',
  ],
  [shandongPostcards]: [
    '370700', '370100', '370200', '370300',
    '370600', '371000', '370900', '371100',
    '370800', '371300', '370500', '370400',
  ],
};
const CITY_CODE_ALIASES: Readonly<Record<string, string>> = {
  '110000': '110100', '120000': '120100', '310000': '310100',
};
const cityArt = new Map(Object.entries(CITY_ART_SHEETS).flatMap(([sheet, cities]) =>
  cities.map((code, tile) => [code, { sheet, tile }] as const),
));

type CoverIllustration = { sheet: string; tile: number };

/** 用行政区划代码稳定分配通用风景，新增城市无需维护配图表。 */
function genericCityIllustration(cityCode: string): CoverIllustration {
  let hash = 2166136261;
  for (const character of cityCode) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  // 取 FNV-1a 哈希的高四位，映射到图集的 16 格。
  return { sheet: genericPostcards, tile: hash >>> 28 };
}

/** 先选行程里的景点照片，加载失败时仍可尝试预订或餐饮等活动的已存照片。 */
export function findJournalPlannerPhotos(plans: AiTravelPlan[]): Map<string, PlannerPhoto[]> {
  const byTrip = new Map<string, PlannerPhoto[]>();
  for (const plan of plans) {
    if (!plan.linkedTripId) continue;
    const sights: PlannerPhoto[] = [];
    const other: PlannerPhoto[] = [];
    const seen = new Set<string>();
    for (const day of plan.content.days) for (const activity of day.activities) {
      const photo = activity.photo;
      if (!photo) continue;
      const key = photo.assetId || photo.url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      (activity.kind === 'sight' ? sights : other).push(photo);
    }
    byTrip.set(plan.linkedTripId, [...sights, ...other]);
  }
  return byTrip;
}

function RecordedCoverPhoto({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void getMediaPreview(photoId, 'photo').then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photoId]);
  return src ? <img className="journal-cover-photo" src={src} alt="" loading="lazy" onError={() => setSrc('')} /> : null;
}

function PlannerCoverPhoto({ photo, onUnavailable }: { photo: PlannerPhoto; onUnavailable: () => void }) {
  const { assetId, url } = photo;
  const [localSrc, setLocalSrc] = useState<string | null>(assetId ? null : '');
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => {
    if (!assetId) return;
    let active = true;
    let objectUrl = '';
    void getPlannerPhotoBlob(assetId).then((blob) => {
      if (!active) return;
      objectUrl = blob ? URL.createObjectURL(blob) : '';
      setLocalSrc(objectUrl);
    }).catch(() => { if (active) setLocalSrc(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId]);

  // 离线优先读取已验证的本地照片；其次走云端已同步参考图、本地服务端缓存或保存的原图地址。
  const cloudSrc = assetId ? getCloudPlannerPhotoUrl(assetId) : '';
  const serverSrc = assetId ? plannerApiUrl(`photo-file/${assetId}`) : '';
  const sources = [...new Set([localSrc, cloudSrc, serverSrc, url].filter(Boolean))];
  const src = sources[sourceIndex];
  if (!src || localSrc === null) return null;
  return <img className="journal-cover-photo" src={src} alt="" loading="lazy" onError={() => {
    if (sourceIndex + 1 < sources.length) setSourceIndex(sourceIndex + 1);
    else onUnavailable();
  }} />;
}

function PlannerCoverPhotos({ photos }: { photos: PlannerPhoto[] }) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const photo = photos[photoIndex];
  return photo ? <PlannerCoverPhoto key={photoIndex} photo={photo} onUnavailable={() => setPhotoIndex(photoIndex + 1)} /> : null;
}

/** 每张图集为四行四列，裁出城市对应的一格，再由封面容器居中裁切。 */
function CityCoverIllustration({ preferred, fallback }: {
  preferred: CoverIllustration | undefined;
  fallback: CoverIllustration;
}) {
  const [current, setCurrent] = useState<CoverIllustration | null>(preferred ?? fallback);
  if (!current) return null;
  const { sheet, tile } = current;
  return (
    <span className="journal-cover-illustration">
      <img key={sheet} src={sheet} alt="" loading="lazy"
        onError={() => setCurrent(sheet === fallback.sheet ? null : fallback)}
        style={{ left: `${-(tile % 4) * 100}%`, top: `${-Math.floor(tile / 4) * 100}%` }} />
    </span>
  );
}

/** 城市卡、置顶明信片和旅行卡共享照片、地标插画和通用风景。 */
export default function JournalCover({ cityCode, photoId, plannerPhotos }: {
  cityCode?: string;
  photoId?: string;
  plannerPhotos?: PlannerPhoto[];
}) {
  const cityKey = cityCode ? CITY_CODE_ALIASES[cityCode] ?? cityCode : 'journal';
  const illustration = cityArt.get(cityKey);
  return (
    <span className="journal-cover-art" aria-hidden="true">
      {/* 图集尚未加载或无法读取时，内嵌风景仍能填满封面。 */}
      <IllustratedJourneyCover seed={cityKey} />
      <CityCoverIllustration key={cityKey} preferred={illustration} fallback={genericCityIllustration(cityKey)} />
      {photoId && <RecordedCoverPhoto key={photoId} photoId={photoId} />}
      {plannerPhotos?.length ? <PlannerCoverPhotos
        key={JSON.stringify(plannerPhotos.map((photo) => [photo.assetId, photo.url]))} photos={plannerPhotos} /> : null}
    </span>
  );
}
