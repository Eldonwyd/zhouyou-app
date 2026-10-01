import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';
import type { AdministrativeFeature, AdministrativeGeoJSON, CityMark } from '../types';
import {
  cacheProvinceMap, fillForStatus, listCachedProvinceCodes, loadNationalMap, loadProvinceMap,
  provinceColor, removeCachedProvinceMap, statusForCity, statusForProvince,
} from '../map-data';

interface MapViewProps {
  marks: CityMark[];
  activeProvinceCode: string | null;
  setActiveProvinceCode: (code: string | null) => void;
  onSelectCity: (feature: AdministrativeFeature, province: AdministrativeFeature) => void;
  onError: (message: string) => void;
}

// Register only the map chart features used by this page. The complete ECharts
// bundle would make the first map load substantially larger.
echarts.use([MapChart, TooltipComponent, CanvasRenderer]);

function labelForFeature(feature: AdministrativeFeature): string {
  return feature.properties.name.replace(/特别行政区$|壮族自治区$|维吾尔自治区$|回族自治区$|自治区$|省$|市$/, '');
}

/** A single chart is reused for country and city levels; click changes the registered geometry. */
export default function MapView({ marks, activeProvinceCode, setActiveProvinceCode, onSelectCity, onError }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [nationalMap, setNationalMap] = useState<AdministrativeGeoJSON | null>(null);
  const [provinceMap, setProvinceMap] = useState<AdministrativeGeoJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('正在加载地图…');
  const [cachedCodes, setCachedCodes] = useState<string[]>([]);
  const [cacheBusy, setCacheBusy] = useState(false);
  // Dense administrative labels collide on narrow screens. The city list
  // remains visible below the map, while a touched region shows its label.
  const [compactMap, setCompactMap] = useState(() => window.matchMedia('(max-width: 560px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 560px)');
    const updateLayout = () => setCompactMap(query.matches);
    query.addEventListener('change', updateLayout);
    return () => query.removeEventListener('change', updateLayout);
  }, []);

  const activeProvince = useMemo(() => nationalMap?.features.find((feature) =>
    String(feature.properties.adcode) === activeProvinceCode), [nationalMap, activeProvinceCode]);

  useEffect(() => {
    loadNationalMap().then((data) => {
      setNationalMap(data);
      if (!activeProvinceCode) setNotice('点击省份进入市级地图');
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : '全国地图加载失败');
      setLoading(false);
    });
    listCachedProvinceCodes().then(setCachedCodes).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeProvinceCode) {
      setProvinceMap(null);
      setLoading(!nationalMap);
      return;
    }
    setLoading(true);
    setNotice('正在加载市级边界…');
    loadProvinceMap(activeProvinceCode).then((data) => {
      setProvinceMap(data);
      setLoading(false);
      setNotice('点击城市查看或标记旅行');
    }).catch((error: unknown) => {
      setProvinceMap(null);
      setLoading(false);
      setNotice(navigator.onLine ? '市级地图加载失败，请重试' : '当前地区尚未缓存，请联网后选择缓存');
      onError(error instanceof Error ? error.message : '市级地图加载失败');
    });
  }, [activeProvinceCode, nationalMap, onError]);

  const currentMap = activeProvinceCode ? provinceMap : nationalMap;
  useEffect(() => {
    if (!containerRef.current || !currentMap || (activeProvinceCode && !activeProvince)) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    // Development-only hook lets browser tests click a real polygon at its
    // projected centroid rather than relying on brittle screenshot positions.
    if (import.meta.env.DEV) (window as Window & { __travelMapChart?: EChartsType }).__travelMapChart = chart;
    const mapName = activeProvinceCode ? `province-${activeProvinceCode}` : 'china';
    echarts.registerMap(mapName, currentMap as Parameters<typeof echarts.registerMap>[1]);
    const data = currentMap.features.map((feature) => {
      const code = String(feature.properties.adcode);
      const provinceCode = activeProvinceCode ?? code;
      const status = activeProvinceCode
        ? statusForCity(marks.find((mark) => mark.id === code))
        : statusForProvince(code, marks);
      return {
        name: feature.properties.name,
        adcode: code,
        value: status === 'visited' ? 2 : 0,
        itemStyle: { areaColor: fillForStatus(status, provinceCode) },
      };
    });
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}', backgroundColor: '#123343', textStyle: { color: '#fff' } },
      series: [{
        type: 'map', map: mapName, roam: true, scaleLimit: { min: 0.8, max: 12 },
        layoutCenter: ['50%', '50%'], layoutSize: '91%', zoom: 1,
        selectedMode: false, label: { show: !compactMap, fontSize: activeProvinceCode ? 11 : 10, color: '#273b47' },
        labelLayout: { hideOverlap: true },
        itemStyle: { borderColor: '#fff', borderWidth: 1.1, areaColor: '#d7dee2' },
        emphasis: { label: { show: true, color: '#102c3b', fontWeight: 'bold' }, itemStyle: { areaColor: '#f5c94e' } },
        data,
      }],
    }, true);
    chart.on('georoam', () => { suppressClickUntilRef.current = Date.now() + 260; });
    chart.on('click', (params) => {
      if (Date.now() < suppressClickUntilRef.current || params.componentType !== 'series' || params.seriesType !== 'map') return;
      const clicked = currentMap.features.find((feature) => String(feature.properties.adcode) === String((params.data as { adcode?: string } | undefined)?.adcode));
      if (!clicked) return;
      if (!activeProvinceCode) {
        setActiveProvinceCode(String(clicked.properties.adcode));
      } else if (activeProvince) {
        onSelectCity(clicked, activeProvince);
      }
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
      if (import.meta.env.DEV) delete (window as Window & { __travelMapChart?: EChartsType }).__travelMapChart;
    };
  }, [currentMap, activeProvinceCode, activeProvince, compactMap, marks, onSelectCity, setActiveProvinceCode]);

  function adjustZoom(multiplier: number): void {
    const chart = chartRef.current;
    if (!chart) return;
    const option = chart.getOption() as { series?: Array<{ zoom?: number }> };
    const series = option.series?.[0];
    const zoom = Math.max(0.8, Math.min(12, (Number(series?.zoom) || 1) * multiplier));
    chart.setOption({ series: [{ zoom }] });
  }

  async function toggleCache(): Promise<void> {
    if (!activeProvinceCode) return;
    setCacheBusy(true);
    try {
      if (cachedCodes.includes(activeProvinceCode)) await removeCachedProvinceMap(activeProvinceCode);
      else await cacheProvinceMap(activeProvinceCode);
      setCachedCodes(await listCachedProvinceCodes());
      setNotice(cachedCodes.includes(activeProvinceCode) ? '该地区离线缓存已删除' : '该地区市级地图已缓存');
    } catch (error) {
      onError(error instanceof Error ? error.message : '缓存操作失败');
    } finally {
      setCacheBusy(false);
    }
  }

  const cities = provinceMap?.features ?? [];
  return (
    <div className="map-page">
      <div className="section-heading map-heading">
        <div><span className="eyebrow">TRAVEL ATLAS</span><h1>中国旅行地图</h1><p>点选省份，再选择城市。滚轮或双指可缩放，拖动可移动地图。</p></div>
        <div className="breadcrumb"><button onClick={() => setActiveProvinceCode(null)} className={!activeProvinceCode ? 'current' : ''}>全国</button>{activeProvince && <><span>›</span><strong>{activeProvince.properties.name}</strong></>}</div>
      </div>
      <div className="map-layout">
        <div className="map-card">
          <div className="map-toolbar">
            <div className="map-toolbar-context">
              {activeProvince && <button className="map-back-button" onClick={() => setActiveProvinceCode(null)}>← 返回全国</button>}
              <span className="map-level-chip">{activeProvince ? `${activeProvince.properties.name} · 市级` : '全国 · 省级'}</span>
            </div>
            <div className="map-control-group">
              <button aria-label="放大地图" title="放大" onClick={() => adjustZoom(1.35)}>＋</button>
              <button aria-label="缩小地图" title="缩小" onClick={() => adjustZoom(1 / 1.35)}>－</button>
              <button aria-label="重置地图视野" title="重置视野" onClick={() => {
                chartRef.current?.setOption({ series: [{ zoom: 1, center: null }] });
              }}>重置</button>
            </div>
          </div>
          <div ref={containerRef} className="map-canvas" role="img" aria-label={activeProvince ? `${activeProvince.properties.name}城市地图` : '中国省级地图'} />
          {loading && <div className="map-overlay">正在加载地图…</div>}
          {!loading && !currentMap && <div className="map-overlay error">{notice}<button onClick={() => activeProvinceCode ? setActiveProvinceCode(null) : loadNationalMap().then(setNationalMap)}>返回或重试</button></div>}
          <div className="map-bottom"><span>{notice}</span><div className="map-legend"><span><i className="legend-dot visited" />已去过</span><span><i className="legend-dot empty" />未标记</span></div></div>
        </div>
        <aside className="map-side card">
          {activeProvince ? <>
            <div className="side-top"><span className="eyebrow">CITY INDEX</span><h2>{activeProvince.properties.name}</h2><p>{cities.length} 个可选择地区</p></div>
            <button className="secondary full" onClick={toggleCache} disabled={cacheBusy || !provinceMap}>{cacheBusy ? '处理中…' : cachedCodes.includes(activeProvinceCode!) ? '删除该省离线地图' : '缓存该省市级地图'}</button>
            <div className="city-list">{cities.map((feature) => {
              const code = String(feature.properties.adcode);
              const status = statusForCity(marks.find((mark) => mark.id === code));
              return <button key={code} onClick={() => onSelectCity(feature, activeProvince)}><span className="city-swatch" style={{ background: fillForStatus(status, activeProvinceCode!) }} />{feature.properties.name}<span>›</span></button>;
            })}</div>
          </> : <>
            <div className="side-top"><span className="eyebrow">YOUR FOOTPRINTS</span><h2>从一座城市开始</h2><p>点击地图上的省份，下钻查看城市。标记后，颜色会同步到全国地图。</p></div>
            <div className="side-stat"><strong>{marks.filter((mark) => mark.visited).length}</strong><span>已去城市</span></div>
            <div className="province-list">{nationalMap?.features.map((feature) => <button key={String(feature.properties.adcode)} onClick={() => setActiveProvinceCode(String(feature.properties.adcode))}><i style={{ background: provinceColor(String(feature.properties.adcode)) }} />{labelForFeature(feature)}</button>)}</div>
          </>}
        </aside>
      </div>
    </div>
  );
}
