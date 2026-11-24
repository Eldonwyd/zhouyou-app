import { useEffect, useMemo, useState } from 'react';
import { loadNationalMap, loadProvinceMap } from '../map-data';
import { provinceDisplayName, useI18n } from '../i18n';
import type { AdministrativeFeature, CityMark, Journey, JourneyCity, JourneyPlace } from '../types';

interface TravelCityBrowserProps {
  trips: Journey[];
  places: JourneyPlace[];
  marks: CityMark[];
  selectedCityCode: string | null;
  onSelectCity: (city: JourneyCity) => void;
  onShowAll: () => void;
  onOpenMap?: () => void;
  onError: (message: string) => void;
}

/**
 * Browse the full administrative catalogue one province at a time. Loading a
 * province only after selection keeps the first visit as light as the map home.
 */
export default function TravelCityBrowser({ trips, places, marks, selectedCityCode, onSelectCity, onShowAll, onOpenMap, onError }: TravelCityBrowserProps) {
  const { lang, t } = useI18n();
  const [provinces, setProvinces] = useState<AdministrativeFeature[]>([]);
  const [provinceCode, setProvinceCode] = useState(selectedCityCode ? `${selectedCityCode.slice(0, 2)}0000` : '');
  const [cities, setCities] = useState<AdministrativeFeature[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    loadNationalMap().then((map) => { if (active) setProvinces(map.features); })
      .catch(() => { if (active) onError(t('省份列表加载失败', 'Failed to load province list')); });
    return () => { active = false; };
  }, [onError]);

  useEffect(() => {
    if (!provinceCode) { setCities([]); return; }
    let active = true;
    setLoading(true);
    loadProvinceMap(provinceCode).then((map) => { if (active) setCities(map.features); })
      .catch(() => { if (active) { setCities([]); onError(t('城市列表加载失败，请检查离线地图缓存', 'Failed to load city list. Check offline map cache.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [provinceCode, onError]);

  // A multi-city journey counts once in each of its cities, but appears only
  // once in the journey list after the user selects a city.
  const tripCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trip of trips) for (const city of trip.cities) {
      counts.set(city.code, (counts.get(city.code) ?? 0) + 1);
    }
    return counts;
  }, [trips]);
  const placeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of places) counts.set(place.cityCode, (counts.get(place.cityCode) ?? 0) + 1);
    return counts;
  }, [places]);
  const visitedCodes = useMemo(() => new Set(marks.filter((mark) => mark.visited).map((mark) => mark.id)), [marks]);

  return <section className="card travel-city-browser" aria-label={t('按省份选择城市', 'Browse cities by province')}>
    <div className="card-heading">
      <div>
        <h2>{t('按省份找城市', 'Browse by Province')}</h2>
        <p>{t('选一座城市查看旅行与独立保存的地点记录。', 'Choose a city to view its trips and saved places.')}</p>
      </div>
      <div className="heading-actions travel-browser-actions">
        {onOpenMap && <button type="button" className="secondary" onClick={onOpenMap}>{t('去地图选择城市', 'Pick on Map')}</button>}
        <button type="button" className={!selectedCityCode ? 'primary' : 'secondary'} onClick={onShowAll}>{t('全部旅行', 'All Trips')}</button>
      </div>
    </div>
    <div className="province-choice-grid">{provinces.map((province) => {
      const code = String(province.properties.adcode);
      return <button key={code} className={provinceCode === code ? 'active' : ''}
        onClick={() => setProvinceCode(code)}>{provinceDisplayName(code, province.properties.name, lang, true)}</button>;
    })}</div>
    {provinceCode && <div className="city-choice-grid" aria-live="polite">
      {loading ? <span className="muted">{t('正在读取城市…', 'Loading cities…')}</span> : cities.map((feature) => {
        const code = String(feature.properties.adcode);
        const tripCount = tripCounts.get(code) ?? 0;
        const placeCount = placeCounts.get(code) ?? 0;
        const summary = [
          tripCount && t(`${tripCount} 次旅行`, `${tripCount} trips`),
          placeCount && t(`${placeCount} 个地点`, `${placeCount} places`),
          visitedCodes.has(code) && t('已去过', 'Visited'),
        ].filter(Boolean).join(' · ') || t('暂无记录', 'No records');
        return <button key={code} className={selectedCityCode === code ? 'active' : ''}
          onClick={() => onSelectCity({ code, name: feature.properties.name, provinceCode })}>
          <span>{feature.properties.name}</span><small>{summary}</small>
        </button>;
      })}</div>}
  </section>;
}
