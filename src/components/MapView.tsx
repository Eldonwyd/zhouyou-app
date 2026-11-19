import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import type { EChartsType } from 'echarts/core';
import { themeColor, useAppearanceStyle, useDarkTheme } from '../theme';
import type { AdministrativeFeature, AdministrativeGeoJSON, CityMark } from '../types';
import {
  cacheProvinceMap, fillForStatus, listCachedProvinceCodes, loadNationalMap, loadProvinceMap,
  pointInFeature, provinceColor, removeCachedProvinceMap, statusForCity, statusForProvince,
} from '../map-data';

interface MapViewProps {
  marks: CityMark[];
  activeProvinceCode: string | null;
  setActiveProvinceCode: (code: string | null) => void;
  onSelectCity: (feature: AdministrativeFeature, province: AdministrativeFeature) => void;
  onError: (message: string) => void;
  onRecommendProvince?: (name: string) => void;
}

// Register only the map chart features used by this page. The complete ECharts
// bundle would make the first map load substantially larger.
// 按需构建需注册标签布局功能，否则 hideOverlap 不生效。
echarts.use([MapChart, TooltipComponent, CanvasRenderer, LabelLayout]);

function shortRegionLabel(name: string): string {
  const shortened = name
    .replace(/特别行政区$/, '')
    .replace(/(?:壮族|维吾尔|回族)?自治区$/, '')
    .replace(/(?:壮族|维吾尔|回族|藏族|蒙古族|朝鲜族|满族|彝族|白族|傣族|景颇族|傈僳族|哈尼族|苗族|瑶族|侗族|布依族|土家族|羌族|水族|仡佬族|拉祜族|佤族|纳西族|柯尔克孜|哈萨克|蒙古|回|藏)+自治(?:州|县)$/, '')
    .replace(/(?:自治州|地区|林区|省|市|盟)$/, '');
  return shortened || name;
}

function labelForFeature(feature: AdministrativeFeature): string {
  return shortRegionLabel(feature.properties.name);
}

function featureRings(feature: AdministrativeFeature): number[][][] {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates[0] as number[][]]
    : (feature.geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
}

/** 兜底定位：用户轻微点偏、点在细长/海岛边界旁或错位标签上时，吸附到 22px 内最近的行政区。 */
function findNearestFeatureAtPixel(
  chart: EChartsType,
  features: AdministrativeFeature[],
  x: number,
  y: number,
  activeProvinceCode: string | null,
  nationalLabelOffsets: Record<string, [number, number]>,
): AdministrativeFeature | null {
  try {
    const geo = chart.convertFromPixel({ seriesIndex: 0 }, [x, y]);
    if (Array.isArray(geo) && Number.isFinite(geo[0]) && Number.isFinite(geo[1])) {
      const exact = features.find((feature) => pointInFeature(geo[0], geo[1], feature));
      if (exact) return exact;
    }
  } catch { /* Fall through to projected pixel proximity check. */ }

  const option = chart.getOption() as { series?: Array<{ zoom?: number }> };
  const zoom = Number(option.series?.[0]?.zoom) || 1;
  const offsetWeight = Math.max(0, Math.min(1, (3 - zoom) / 2));
  const maxSnapDistance = 22;
  let bestFeature: AdministrativeFeature | null = null;
  let bestDistance = maxSnapDistance;

  for (const feature of features) {
    const code = String(feature.properties.adcode);
    const props = feature.properties as AdministrativeFeature['properties'] & { center?: [number, number]; centroid?: [number, number] };
    const anchor = props.centroid ?? props.center;
    if (anchor) {
      const projected = chart.convertToPixel({ seriesIndex: 0 }, anchor);
      if (Array.isArray(projected) && Number.isFinite(projected[0]) && Number.isFinite(projected[1])) {
        const offset = !activeProvinceCode ? nationalLabelOffsets[code] : undefined;
        const lx = projected[0] + (offset?.[0] ?? 0) * offsetWeight;
        const ly = projected[1] + (offset?.[1] ?? 0) * offsetWeight;
        const labelDist = Math.hypot(x - lx, y - ly);
        if (labelDist < bestDistance) { bestDistance = labelDist; bestFeature = feature; }
      }
    }
    for (const ring of featureRings(feature)) {
      const step = Math.max(1, Math.floor(ring.length / 40));
      for (let i = 0; i < ring.length; i += step) {
        const projected = chart.convertToPixel({ seriesIndex: 0 }, ring[i]);
        if (!Array.isArray(projected) || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) continue;
        const dist = Math.hypot(x - projected[0], y - projected[1]);
        if (dist < bestDistance) { bestDistance = dist; bestFeature = feature; }
      }
    }
  }
  return bestFeature;
}

/** A single chart is reused for country and city levels; click changes the registered geometry. */
export default function MapView({ marks, activeProvinceCode, setActiveProvinceCode, onSelectCity, onError, onRecommendProvince }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const suppressClickUntilRef = useRef(0);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const maxDragDistRef = useRef(0);
  const downAdcodeRef = useRef<string | null>(null);
  const handledByChartRef = useRef(false);
  const onSelectCityRef = useRef(onSelectCity);
  const setActiveProvinceCodeRef = useRef(setActiveProvinceCode);
  const activeProvinceRef = useRef<AdministrativeFeature | undefined>(undefined);
  onSelectCityRef.current = onSelectCity;
  setActiveProvinceCodeRef.current = setActiveProvinceCode;
  const [nationalMap, setNationalMap] = useState<AdministrativeGeoJSON | null>(null);
  // Keep the code beside the geometry: a previously loaded province must never
  // be rendered under the next province's title, even before effects run.
  const [loadedProvince, setLoadedProvince] = useState<{ code: string; data: AdministrativeGeoJSON } | null>(null);
  const provinceMap = loadedProvince?.code === activeProvinceCode ? loadedProvince.data : null;
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('正在加载地图…');
  const [cachedCodes, setCachedCodes] = useState<string[]>([]);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState<'all' | 'visited' | 'unvisited'>('all');
  const hoveredRegionRef = useRef<string | null>(null);
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
  activeProvinceRef.current = activeProvince;

  useEffect(() => {
    listCachedProvinceCodes().then(setCachedCodes).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Fetches may finish after a return, a province switch or an unmount.
    // Only the active effect may update the map, loading indicator and errors.
    let isCurrentRequest = true;
    let loadingProvince = false;
    setLoading(true);
    setLoadedProvince(null);
    setNotice(activeProvinceCode ? '正在加载市级边界…' : '正在加载地图…');

    async function loadCurrentMap(): Promise<void> {
      try {
        // National geometry is also required to resolve the province heading
        // and city-selection context when returning from another page.
        const nationalData = await loadNationalMap();
        if (!isCurrentRequest) return;
        setNationalMap(nationalData);
        if (activeProvinceCode) {
          loadingProvince = true;
          const provinceData = await loadProvinceMap(activeProvinceCode);
          if (!isCurrentRequest) return;
          setLoadedProvince({ code: activeProvinceCode, data: provinceData });
        }
        setNotice(activeProvinceCode ? '点击城市直接点亮，再次点击可进入手账或取消点亮' : '点击省份进入市级地图');
      } catch (error: unknown) {
        if (!isCurrentRequest) return;
        const detail = error instanceof Error ? error.message : '未知错误';
        // Keep the concrete cause visible in the map after the toast expires.
        setNotice(loadingProvince && !navigator.onLine
          ? '当前地区尚未缓存，请联网后选择缓存'
          : `${loadingProvince ? '市级' : '全国'}地图加载失败：${detail}`);
        onError(detail);
      } finally {
        if (isCurrentRequest) setLoading(false);
      }
    }

    void loadCurrentMap();
    return () => { isCurrentRequest = false; };
  }, [activeProvinceCode, retryAttempt, onError]);

  const currentMap = activeProvinceCode ? provinceMap : nationalMap;
  const hasActiveProvince = Boolean(activeProvince);
  const dark = useDarkTheme();
  const appearance = useAppearanceStyle();

  // Helper: read current theme colors & build series data so visited cities
  // stay vividly highlighted even while the cursor is still hovering on them.
  function buildSeriesVisuals(mapData: AdministrativeGeoJSON) {
    const mapColors = {
      area: themeColor('--map-area', '#e6e8dc'),
      border: themeColor('--map-border', '#fffefa'),
      label: themeColor('--map-label', '#5a6354'),
      strong: themeColor('--map-label-strong', themeColor('--ink', '#303b33')),
      tooltip: themeColor('--map-tooltip', themeColor('--warm-dark', '#364a30')),
      emphasis: themeColor('--map-emphasis', '#dbe5cf'),
      emphasisBorder: themeColor('--warm-green', '#526c48'),
    };
    const data = mapData.features.map((feature) => {
      const code = String(feature.properties.adcode);
      const provinceCode = activeProvinceCode ?? code;
      const status = activeProvinceCode
        ? statusForCity(marks.find((mark) => mark.id === code))
        : statusForProvince(code, marks);
      const areaColor = fillForStatus(status, provinceCode, mapColors.area);
      const isVisited = status === 'visited';
      return {
        name: feature.properties.name,
        adcode: code,
        value: isVisited ? 2 : 0,
        itemStyle: { areaColor },
        label: isVisited ? { color: '#ffffff', fontWeight: 'bold' as const, textShadowColor: 'rgba(0,0,0,0.28)', textShadowBlur: 3 } : undefined,
        emphasis: isVisited ? {
          itemStyle: { areaColor, borderColor: '#ffffff', borderWidth: 1.8, shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.18)' },
          label: { show: true, color: '#ffffff', fontWeight: 'bold' as const, textShadowColor: 'rgba(0,0,0,0.35)', textShadowBlur: 4 },
        } : undefined,
      };
    });
    return { mapColors, data };
  }

  // Effect 1: create & dispose ECharts instance ONLY when geometry/level changes,
  // so clicking cities never tears down the canvas or resets zoom/pan.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !currentMap || (activeProvinceCode && !activeProvinceRef.current)) return;
    const chart = echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    if (import.meta.env.DEV) (window as Window & { __travelMapChart?: EChartsType }).__travelMapChart = chart;
    const mapName = activeProvinceCode ? `province-${activeProvinceCode}` : 'china';
    echarts.registerMap(mapName, currentMap as Parameters<typeof echarts.registerMap>[1]);

    const nationalLabelOffsets: Record<string, [number, number]> = {
      '110000': [-12, -18],
      '120000': [22, 5],
      '130000': [-16, 15],
      '810000': [27, 10],
      '820000': [-25, 24],
    };
    const adcodes = currentMap.features.map((feature) => String(feature.properties.adcode));
    const layoutLabels = ({ dataIndex }: { dataIndex?: number }) => {
      const option = chart.getOption() as { series?: Array<{ zoom?: number }> };
      const zoom = Number(option.series?.[0]?.zoom) || 1;
      const offsetWeight = Math.max(0, Math.min(1, (3 - zoom) / 2));
      const code = dataIndex === undefined ? '' : adcodes[dataIndex];
      const offset = !activeProvinceCode && code ? nationalLabelOffsets[code] : undefined;
      return {
        hideOverlap: true,
        dx: (offset?.[0] ?? 0) * offsetWeight,
        dy: (offset?.[1] ?? 0) * offsetWeight,
      };
    };
    const nationalLayoutSize = () => Math.min(
      chart.getWidth() * 0.96,
      chart.getHeight() * 0.94 * ((135.1 - 73.4) / (53.6 - 18)) * 0.75,
    );
    const { mapColors, data } = buildSeriesVisuals(currentMap);
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: '{b}',
        backgroundColor: mapColors.tooltip,
        borderWidth: 0,
        textStyle: { color: '#fff' },
        enterable: false,
        extraCssText: 'pointer-events: none;',
      },
      series: [{
        type: 'map', map: mapName, roam: true, scaleLimit: { min: 0.8, max: 12 },
        boundingCoords: activeProvinceCode ? undefined : [[73.4, 53.6], [135.1, 18]],
        // 微微下移并留出顶部工具栏余量，避免最北端城市落到顶部按钮下方导致不好点。
        layoutCenter: activeProvinceCode ? ['50%', '52%'] : ['50%', '52%'],
        layoutSize: activeProvinceCode ? '86%' : nationalLayoutSize(),
        zoom: 1,
        selectedMode: false,
        label: {
          show: !compactMap, fontSize: activeProvinceCode ? 11 : 10, color: mapColors.label,
          formatter: ({ name }: { name: string }) => shortRegionLabel(name),
        },
        labelLayout: layoutLabels,
        itemStyle: { borderColor: mapColors.border, borderWidth: 1.1, areaColor: mapColors.area },
        emphasis: {
          label: { show: true, color: mapColors.strong, fontWeight: 'bold' },
          itemStyle: { areaColor: mapColors.emphasis, borderColor: mapColors.emphasisBorder, borderWidth: 1.4 },
        },
        data,
      }],
    }, true);

    const activateFeature = (clicked: AdministrativeFeature | undefined | null) => {
      if (!clicked) return;
      if (!activeProvinceCode) {
        setActiveProvinceCodeRef.current(String(clicked.properties.adcode));
      } else if (activeProvinceRef.current) {
        onSelectCityRef.current(clicked, activeProvinceRef.current);
      }
    };

    let fallbackTimer = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
      maxDragDistRef.current = 0;
      downAdcodeRef.current = null;
      handledByChartRef.current = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      const start = pointerDownRef.current;
      if (!start) return;
      const dist = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (dist > maxDragDistRef.current) maxDragDistRef.current = dist;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDownRef.current) return;
      const dist = Math.max(
        maxDragDistRef.current,
        Math.hypot(event.clientX - pointerDownRef.current.x, event.clientY - pointerDownRef.current.y),
      );
      pointerDownRef.current = null;
      if (dist > 12 || Date.now() < suppressClickUntilRef.current) return;
      const rect = container.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const relY = event.clientY - rect.top;
      const capturedDownCode = downAdcodeRef.current;
      // 等一个微宏周期让 ECharts 原生 click 先触发；若因轻微手抖或点偏边缘被吞，则由兜底命中接管。
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = 0;
        if (handledByChartRef.current || chart.isDisposed() || Date.now() < suppressClickUntilRef.current) return;
        const fromDown = capturedDownCode
          ? currentMap.features.find((feature) => String(feature.properties.adcode) === capturedDownCode)
          : null;
        const target = fromDown ?? findNearestFeatureAtPixel(chart, currentMap.features, relX, relY, activeProvinceCode, nationalLabelOffsets);
        if (target) {
          handledByChartRef.current = true;
          activateFeature(target);
        }
      }, 0);
    };
    const onPointerCancel = () => { pointerDownRef.current = null; downAdcodeRef.current = null; };
    container.addEventListener('pointerdown', onPointerDown, { passive: true });
    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerup', onPointerUp, { passive: true });
    container.addEventListener('pointercancel', onPointerCancel, { passive: true });

    chart.on('mousedown', (params) => {
      if (params.componentType !== 'series' || params.seriesType !== 'map') return;
      const code = (params.data as { adcode?: string } | undefined)?.adcode;
      if (code) downAdcodeRef.current = String(code);
    });

    let labelFrame = 0;
    chart.on('georoam', (event: unknown) => {
      // labelLayout 仅依赖 zoom，平移微抖时不重跑 setOption，避免打断点击手势。
      if ((event as { zoom?: number } | undefined)?.zoom === undefined) return;
      suppressClickUntilRef.current = Date.now() + 200;
      if (!labelFrame) {
        labelFrame = window.requestAnimationFrame(() => {
          labelFrame = 0;
          if (!chart.isDisposed()) chart.setOption({ series: [{ labelLayout: layoutLabels }] });
        });
      }
    });
    chart.on('click', (params) => {
      if (maxDragDistRef.current > 12 || Date.now() < suppressClickUntilRef.current || params.componentType !== 'series' || params.seriesType !== 'map') return;
      const clicked = currentMap.features.find((feature) => String(feature.properties.adcode) === String((params.data as { adcode?: string } | undefined)?.adcode));
      if (!clicked) return;
      handledByChartRef.current = true;
      activateFeature(clicked);
    });
    const observer = new ResizeObserver(() => {
      chart.resize();
      if (!activeProvinceCode) chart.setOption({ series: [{ layoutSize: nationalLayoutSize() }] });
    });
    observer.observe(container);
    return () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (labelFrame) window.cancelAnimationFrame(labelFrame);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
      if (import.meta.env.DEV) delete (window as Window & { __travelMapChart?: EChartsType }).__travelMapChart;
    };
  }, [currentMap, activeProvinceCode, hasActiveProvince]);

  // Effect 2: lightweight incremental repaint when marks/theme/viewport change
  // (keeps current zoom/pan & avoids flicker or dropped clicks during rapid tapping).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed() || !currentMap) return;
    const { mapColors, data } = buildSeriesVisuals(currentMap);
    chart.setOption({
      tooltip: { backgroundColor: mapColors.tooltip },
      series: [{
        label: { show: !compactMap, color: mapColors.label },
        itemStyle: { borderColor: mapColors.border, areaColor: mapColors.area },
        emphasis: {
          label: { color: mapColors.strong },
          itemStyle: { areaColor: mapColors.emphasis, borderColor: mapColors.emphasisBorder },
        },
        data,
      }],
    });
  }, [currentMap, activeProvinceCode, compactMap, marks, dark, appearance]);

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

  const highlightRegion = useCallback((name: string | null) => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    if (hoveredRegionRef.current && hoveredRegionRef.current !== name) {
      chart.dispatchAction({ type: 'downplay', seriesIndex: 0, name: hoveredRegionRef.current });
    }
    if (name) {
      chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name });
    }
    hoveredRegionRef.current = name;
  }, []);

  useEffect(() => {
    hoveredRegionRef.current = null;
  }, [activeProvinceCode]);

  const cities = provinceMap?.features ?? [];
  const visitedMarks = useMemo(() => marks.filter((mark) => mark.visited), [marks]);
  const visitedCountByProvince = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mark of visitedMarks) {
      if (!mark.provinceCode) continue;
      counts.set(mark.provinceCode, (counts.get(mark.provinceCode) ?? 0) + 1);
    }
    return counts;
  }, [visitedMarks]);
  const visitedProvincesCount = visitedCountByProvince.size;
  const totalProvinces = nationalMap?.features.length || 34;
  const provinceExplorePct = Math.min(100, Math.round((visitedProvincesCount / totalProvinces) * 100));
  const filteredProvinces = useMemo(() => {
    const all = nationalMap?.features ?? [];
    if (provinceFilter === 'visited') return all.filter((feature) => (visitedCountByProvince.get(String(feature.properties.adcode)) ?? 0) > 0);
    if (provinceFilter === 'unvisited') return all.filter((feature) => (visitedCountByProvince.get(String(feature.properties.adcode)) ?? 0) === 0);
    return all;
  }, [nationalMap, provinceFilter, visitedCountByProvince]);

  const activeProvinceColor = activeProvinceCode ? provinceColor(activeProvinceCode) : undefined;
  const activeProvinceVisitedCount = useMemo(() => {
    if (!activeProvinceCode) return 0;
    const cityCodes = new Set(cities.map((feature) => String(feature.properties.adcode)));
    return visitedMarks.filter((mark) => cityCodes.has(mark.id)).length;
  }, [activeProvinceCode, cities, visitedMarks]);
  const activeProvincePct = cities.length ? Math.min(100, Math.round((activeProvinceVisitedCount / cities.length) * 100)) : 0;
  const recentVisitedMarks = useMemo(() => [...visitedMarks]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 4), [visitedMarks]);

  return (
    <div className="map-page">
      <div className="section-heading map-heading">
        <div className="map-heading-main">
          <span className="eyebrow">TRAVEL ATLAS</span>
          <h1>中国旅行地图</h1>
          <p>点选省份探索城市 · 滚轮缩放 · 拖动漫游</p>
        </div>
        <div className="breadcrumb">
          <button type="button" onClick={() => setActiveProvinceCode(null)} className={!activeProvinceCode ? 'current' : ''}>全国</button>
          {activeProvince && <><span>›</span><strong>{activeProvince.properties.name}</strong></>}
        </div>
      </div>
      <div className="map-layout">
        <div className="map-card">
          <div className="map-toolbar">
            <div className="map-toolbar-context">
              {activeProvince && <button type="button" className="map-back-button" onClick={() => setActiveProvinceCode(null)}>← 返回全国</button>}
              <span className={`map-level-chip${activeProvince ? ' is-province' : ''}`}>
                <i className="map-level-dot" style={activeProvinceColor ? { background: activeProvinceColor } : undefined} />
                {activeProvince ? `${activeProvince.properties.name} · 市级` : '全国 · 省级'}
              </span>
            </div>
            <div className="map-control-group">
              <button type="button" aria-label="放大地图" title="放大" onClick={() => adjustZoom(1.35)}>＋</button>
              <button type="button" aria-label="缩小地图" title="缩小" onClick={() => adjustZoom(1 / 1.35)}>－</button>
              <button type="button" aria-label="重置地图视野" title="重置视野" onClick={() => {
                chartRef.current?.setOption({ series: [{ zoom: 1, center: null }] });
              }}>重置</button>
            </div>
          </div>
          <div ref={containerRef} className="map-canvas" role="img" aria-label={activeProvince ? `${activeProvince.properties.name}城市地图` : '中国省级地图'} />
          {loading && <div className="map-overlay">正在加载地图…</div>}
          {!loading && !currentMap && <div className="map-overlay error">{notice}<button type="button" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>重新加载地图</button></div>}
          <div className="map-bottom">
            <span className="map-notice-text">{notice}</span>
            <div className="map-legend">
              <span><i className="legend-dot visited" style={activeProvinceColor ? { background: activeProvinceColor } : undefined} />已去过</span>
              <span><i className="legend-dot empty" />未标记</span>
            </div>
          </div>
        </div>
        <aside className="map-side card">
          {activeProvince ? <>
            <div className="map-province-hero">
              <div className="map-province-head">
                <div className="map-province-title">
                  <i className="map-province-accent" style={{ background: activeProvinceColor }} />
                  <h2>{activeProvince.properties.name}</h2>
                </div>
                <span className="map-progress-pill" style={{ '--pill-color': activeProvinceColor } as CSSProperties}>
                  {activeProvinceVisitedCount} / {cities.length} 城
                </span>
              </div>
              <div className="side-stat-bar" aria-hidden="true">
                <span style={{ width: `${activeProvincePct}%`, background: activeProvinceColor }} />
              </div>
              <div className="map-province-actions">
                {onRecommendProvince && <button type="button" className="primary province-ai-button" onClick={() => onRecommendProvince(activeProvince.properties.name)}>✦ AI 推荐怎么玩</button>}
                <button type="button" className="secondary province-cache-button" onClick={toggleCache} disabled={cacheBusy || !provinceMap}>
                  {cacheBusy ? '处理中…' : cachedCodes.includes(activeProvinceCode!) ? '删除离线' : '缓存离线'}
                </button>
              </div>
            </div>
            <div className="map-list-header">
              <span>城市索引</span>
              <small>点击点亮 · 再点记手账</small>
            </div>
            <div className="city-list">{cities.map((feature) => {
              const code = String(feature.properties.adcode);
              const status = statusForCity(marks.find((mark) => mark.id === code));
              const isVisited = status === 'visited';
              return <button
                key={code}
                type="button"
                title={feature.properties.name}
                className={isVisited ? 'is-visited' : undefined}
                style={isVisited ? { '--city-color': activeProvinceColor } as CSSProperties : undefined}
                onClick={() => onSelectCity(feature, activeProvince)}
                onMouseEnter={() => highlightRegion(feature.properties.name)}
                onMouseLeave={() => highlightRegion(null)}
              >
                <span className="city-swatch" style={{ background: fillForStatus(status, activeProvinceCode!, 'var(--map-area)') }} />
                <span className="city-name">{feature.properties.name}</span>
                <span className="city-arrow">{isVisited ? '✓' : '›'}</span>
              </button>;
            })}</div>
            <div className="map-side-foot">
              <span>{activeProvinceVisitedCount > 0 ? `已点亮 ${activeProvinceVisitedCount} 座 · 再次点击可进入手账` : '点击任意城市即可直接点亮足迹'}</span>
            </div>
          </> : <>
            <div className="side-stat-box map-atlas-summary">
              <div className="map-atlas-summary-head">
                <h2>足迹总览</h2>
                <span className="map-progress-pill">探索 {provinceExplorePct}%</span>
              </div>
              <div className="side-stat">
                <div><strong>{visitedMarks.length}</strong><span>已去城市</span></div>
                <div><strong>{visitedProvincesCount}<em> / {totalProvinces}</em></strong><span>点亮省份</span></div>
              </div>
              <div className="side-stat-bar" aria-hidden="true"><span style={{ width: `${provinceExplorePct}%` }} /></div>
            </div>
            <div className="map-province-filter" role="tablist" aria-label="筛选省份">
              <button type="button" role="tab" aria-selected={provinceFilter === 'all'} className={provinceFilter === 'all' ? 'active' : ''} onClick={() => setProvinceFilter('all')}>
                全部 <span>{totalProvinces}</span>
              </button>
              <button type="button" role="tab" aria-selected={provinceFilter === 'visited'} className={provinceFilter === 'visited' ? 'active' : ''} onClick={() => setProvinceFilter('visited')}>
                已点亮 <span>{visitedProvincesCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={provinceFilter === 'unvisited'} className={provinceFilter === 'unvisited' ? 'active' : ''} onClick={() => setProvinceFilter('unvisited')}>
                待探索 <span>{Math.max(0, totalProvinces - visitedProvincesCount)}</span>
              </button>
            </div>
            {filteredProvinces.length > 0 ? (
              <div className="province-list">{filteredProvinces.map((feature) => {
                const code = String(feature.properties.adcode);
                const color = provinceColor(code);
                const litCount = visitedCountByProvince.get(code) ?? 0;
                return <button
                  key={code}
                  type="button"
                  className={litCount > 0 ? 'is-visited' : undefined}
                  style={{ '--prov-color': color } as CSSProperties}
                  title={litCount > 0 ? `${feature.properties.name} · 已点亮 ${litCount} 座城市` : `${feature.properties.name} · 点击进入市级地图`}
                  onClick={() => setActiveProvinceCode(code)}
                  onMouseEnter={() => highlightRegion(feature.properties.name)}
                  onMouseLeave={() => highlightRegion(null)}
                >
                  <i style={{ background: color }} />
                  <span className="province-name">{labelForFeature(feature)}</span>
                  {litCount > 0 && <em className="province-count">{litCount}</em>}
                </button>;
              })}</div>
            ) : (
              <div className="map-filter-empty">
                {provinceFilter === 'visited' ? '还没有点亮任何省份，点击左侧地图开始第一段旅程吧' : '太棒了，全国 34 个省级行政区都已点亮！'}
              </div>
            )}
            <div className="map-side-foot">
              {recentVisitedMarks.length > 0 ? (
                <div className="map-recent-strip">
                  <span className="map-recent-label">最近点亮</span>
                  <div className="map-recent-chips">
                    {recentVisitedMarks.map((mark) => (
                      <button
                        key={mark.id}
                        type="button"
                        className="map-recent-chip"
                        onClick={() => mark.provinceCode && setActiveProvinceCode(mark.provinceCode)}
                        title={`查看 ${mark.name} 所在省份`}
                      >
                        <i style={{ background: provinceColor(mark.provinceCode) }} />
                        {shortRegionLabel(mark.name)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <span>点击地图或省份标签，点亮你的第一座城市</span>
              )}
            </div>
          </>}
        </aside>
      </div>
    </div>
  );
}
