import { useEffect, useState } from 'react';
import { getMediaPreview, getPlannerPhotoBlob } from '../db';
import type { AiTravelPlan, PlannerPhoto } from '../planner-types';
import { TravelIcon } from './TravelArt';

// 每一行按图集从左到右排列。只有明确对应的行政区划代码才使用地标插画。
const CITY_ART_SHEETS = {
  north: [
    '110100', '120100', '130300', '140200',
    '150700', '150500', '210100', '211200',
    '220600', '220200', '220400', '220300',
    '220500', '222400', '220100', '231000',
  ],
  south: [
    '310100', '320100', '320500', '320200',
    '321000', '321100', '330100', '330600',
    '340100', '341000', '440100', '440300',
    '610100', '610400', '610300', '610600',
  ],
  shandong: [
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

  // 离线优先读取已验证的本地照片；旧行程还可以使用服务端缓存或保存的原图地址。
  const serverSrc = assetId ? `${import.meta.env.BASE_URL}api/planner/photo-file/${assetId}` : '';
  const sources = [...new Set([localSrc, serverSrc, url].filter(Boolean))];
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

/** 城市卡、置顶明信片和旅行卡共享封面；未配图的城市使用中性地图图案。 */
export default function JournalCover({ cityCode, photoId, plannerPhotos }: {
  cityCode?: string;
  photoId?: string;
  plannerPhotos?: PlannerPhoto[];
}) {
  const illustration = cityCode ? cityArt.get(CITY_CODE_ALIASES[cityCode] ?? cityCode) : undefined;
  return (
    <span className="journal-cover-art" aria-hidden="true">
      {illustration ? (
        <span className="journal-cover-illustration" data-sheet={illustration.sheet}
          style={{ backgroundPosition: `${(illustration.tile % 4) * 100 / 3}% ${Math.floor(illustration.tile / 4) * 100 / 3}%` }} />
      ) : <span className="journal-cover-placeholder"><TravelIcon name="map" /></span>}
      {photoId && <RecordedCoverPhoto key={photoId} photoId={photoId} />}
      {plannerPhotos?.length ? <PlannerCoverPhotos
        key={JSON.stringify(plannerPhotos.map((photo) => [photo.assetId, photo.url]))} photos={plannerPhotos} /> : null}
    </span>
  );
}
