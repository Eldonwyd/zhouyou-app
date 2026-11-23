import { useEffect, useState } from 'react';
import { cacheProvinceMap, listCachedProvinceCodes, loadNationalMap, removeCachedProvinceMap } from '../map-data';
import type { AdministrativeFeature } from '../types';
import MobileDisclosure from './MobileDisclosure';

interface OfflineMapSettingsProps {
  initialProvinceCode: string | null;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export default function OfflineMapSettings({ initialProvinceCode, onError, onNotice }: OfflineMapSettingsProps) {
  const [provinces, setProvinces] = useState<AdministrativeFeature[]>([]);
  const [selectedCode, setSelectedCode] = useState(initialProvinceCode ?? '');
  const [cachedCodes, setCachedCodes] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const cacheAvailable = typeof window.caches !== 'undefined';

  useEffect(() => {
    if (!cacheAvailable) return;
    let active = true;
    // 沿用全国地图的省份列表和已有的浏览器缓存，入口迁移后仍能看到以前下载的省份。
    void Promise.all([loadNationalMap(), listCachedProvinceCodes()]).then(([map, codes]) => {
      if (!active) return;
      setProvinces(map.features);
      setCachedCodes(codes);
      setLoadState('ready');
    }).catch(() => {
      if (active) setLoadState('failed');
    });
    return () => { active = false; };
  }, [cacheAvailable]);

  const selectedProvince = provinces.find((province) => String(province.properties.adcode) === selectedCode);
  const isCached = cachedCodes.includes(selectedCode);

  /** 缓存写入或删除成功后才更新状态，失败时可直接重试。 */
  async function toggleSelectedCache(): Promise<void> {
    if (!selectedProvince || busy) return;
    const name = selectedProvince.properties.name;
    setBusy(true);
    try {
      if (isCached) {
        await removeCachedProvinceMap(selectedCode);
        setCachedCodes((codes) => codes.filter((code) => code !== selectedCode));
        onNotice(`已删除${name}的离线地图。`);
      } else {
        await cacheProvinceMap(selectedCode);
        setCachedCodes((codes) => [...codes, selectedCode]);
        onNotice(`已缓存${name}的市级地图。`);
      }
    } catch (error) {
      const detail = error instanceof Error ? `：${error.message}` : '';
      onError(`离线地图${isCached ? '删除' : '下载'}失败${detail}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card profile-offline-maps" aria-labelledby="offline-maps-title">
      <div className="card-heading">
        <h2 id="offline-maps-title">离线地图</h2>
        {loadState === 'ready' && <span>已缓存 {cachedCodes.length} 个地区</span>}
      </div>
      <MobileDisclosure label="离线地图" value={loadState === 'ready' ? `已缓存 ${cachedCodes.length} 个地区` : undefined}>
      <p>联网时下载市级地图，断网后仍可在当前浏览器查看城市边界和足迹。</p>
      {!cacheAvailable ? <p className="muted">请用 HTTPS 地址打开应用以管理离线地图。</p> : (
        <>
          {loadState === 'failed' && <p role="alert">离线地图列表加载失败，请联网后重新打开个人中心。</p>}
          <div className="profile-offline-map-controls">
            <label htmlFor="offline-map-province">省级地区</label>
            <select id="offline-map-province" value={selectedProvince ? selectedCode : ''} disabled={busy || loadState !== 'ready'} onChange={(event) => setSelectedCode(event.target.value)}>
              <option value="">{loadState === 'loading' ? '正在加载地区…' : '请选择地区'}</option>
              {provinces.map(({ properties }) => (
                <option key={properties.adcode} value={properties.adcode}>
                  {properties.name}{cachedCodes.includes(String(properties.adcode)) ? '（已缓存）' : ''}
                </option>
              ))}
            </select>
            <button type="button" className={isCached ? 'secondary' : 'primary'} disabled={!selectedProvince || busy} onClick={() => void toggleSelectedCache()}>
              {busy ? '处理中…' : isCached ? '删除离线地图' : '缓存离线地图'}
            </button>
          </div>
        </>
      )}
      </MobileDisclosure>
    </section>
  );
}
