import { useEffect, useMemo, useState } from 'react';
import { loadNationalMap, loadProvinceMap } from '../map-data';
import type { AdministrativeFeature, Journey, JourneyCity } from '../types';

interface TravelCityBrowserProps {
  trips: Journey[];
  selectedCityCode: string | null;
  onSelectCity: (city: JourneyCity) => void;
  onShowAll: () => void;
  onError: (message: string) => void;
}

/**
 * Browse the full administrative catalogue one province at a time. Loading a
 * province only after selection keeps the first visit as light as the map home.
 */
export default function TravelCityBrowser({ trips, selectedCityCode, onSelectCity, onShowAll, onError }: TravelCityBrowserProps) {
  const [provinces, setProvinces] = useState<AdministrativeFeature[]>([]);
  const [provinceCode, setProvinceCode] = useState(selectedCityCode ? `${selectedCityCode.slice(0, 2)}0000` : '');
  const [cities, setCities] = useState<AdministrativeFeature[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    loadNationalMap().then((map) => { if (active) setProvinces(map.features); })
      .catch(() => { if (active) onError('省份列表加载失败'); });
    return () => { active = false; };
  }, [onError]);

  useEffect(() => {
    if (!provinceCode) { setCities([]); return; }
    let active = true;
    setLoading(true);
    loadProvinceMap(provinceCode).then((map) => { if (active) setCities(map.features); })
      .catch(() => { if (active) { setCities([]); onError('城市列表加载失败，请检查离线地图缓存'); } })
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

  return <section className="card travel-city-browser" aria-label="按省份选择城市">
    <div className="card-heading"><div><h2>按省份找城市</h2><p>选一座城市查看它参与的所有旅行。</p></div>
      <button className={!selectedCityCode ? 'primary' : 'secondary'} onClick={onShowAll}>全部旅行</button></div>
    <div className="province-choice-grid">{provinces.map((province) => {
      const code = String(province.properties.adcode);
      return <button key={code} className={provinceCode === code ? 'active' : ''}
        onClick={() => setProvinceCode(code)}>{province.properties.name}</button>;
    })}</div>
    {provinceCode && <div className="city-choice-grid" aria-live="polite">
      {loading ? <span className="muted">正在读取城市…</span> : cities.map((feature) => {
        const code = String(feature.properties.adcode);
        const count = tripCounts.get(code) ?? 0;
        return <button key={code} className={selectedCityCode === code ? 'active' : ''}
          onClick={() => onSelectCity({ code, name: feature.properties.name, provinceCode })}>
          <span>{feature.properties.name}</span><small>{count ? `${count} 次旅行` : '暂无记录'}</small>
        </button>;
      })}</div>}
  </section>;
}
