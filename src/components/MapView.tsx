import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';
import type { EChartsType } from 'echarts/core';
import { themeColor, useAppearanceStyle, useDarkTheme } from '../theme';
import { provinceDisplayName, useI18n } from '../i18n';
import type { AdministrativeFeature, AdministrativeGeoJSON, CityMark } from '../types';
import {
  fillForStatus, loadNationalMap, loadProvinceMap, pointInFeature, provinceColor, statusForCity, statusForProvince,
} from '../map-data';

interface MapViewProps {
  marks: CityMark[];
  activeProvinceCode: string | null;
  setActiveProvinceCode: (code: string | null) => void;
  onSelectCity: (feature: AdministrativeFeature, province: AdministrativeFeature) => void;
  onError: (message: string) => void;
  onRecommendProvince: (name: string) => void;
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
  const { lang, t } = useI18n();
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
  const [notice, setNotice] = useState<'loading-map' | 'loading-province' | 'ready-province' | 'ready-national' | 'offline-province' | string>('loading-map');
  const [provinceFilter, setProvinceFilter] = useState<'all' | 'visited' | 'unvisited'>('visited');
  const hoveredRegionRef = useRef<string | null>(null);
  // 手机端无鼠标悬浮提示，全国和省内市级地图均直接显示名称，重叠交给 ECharts hideOverlap 自动避让。
  const [compactMap, setCompactMap] = useState(() => window.matchMedia('(max-width: 560px)').matches);
  const showMapLabels = true;

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
    // Fetches may finish after a return, a province switch or an unmount.
    // Only the active effect may update the map, loading indicator and errors.
    let isCurrentRequest = true;
    let loadingProvince = false;
    setLoading(true);
    setLoadedProvince(null);
    setNotice(activeProvinceCode ? 'loading-province' : 'loading-map');

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
        setNotice(activeProvinceCode ? 'ready-province' : 'ready-national');
      } catch (error: unknown) {
        if (!isCurrentRequest) return;
        const detail = error instanceof Error ? error.message : 'Unknown error';
        // Keep the concrete cause visible in the map after the toast expires.
        setNotice(loadingProvince && !navigator.onLine
          ? 'offline-province'
          : `${loadingProvince ? 'province-error:' : 'national-error:'}${detail}`);
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
      chart.getWidth() * (compactMap ? 1.02 : 0.96),
      chart.getHeight() * 0.94 * ((135.1 - 73.4) / (53.6 - 18)) * 0.75,
    );
    const { mapColors, data } = buildSeriesVisuals(currentMap);
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: (params: { name?: string; data?: { adcode?: string } }) => {
          const rawName = params.name ?? '';
          if (!activeProvinceCode) return provinceDisplayName(params.data?.adcode ?? '', rawName, lang);
          return rawName;
        },
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
        layoutCenter: activeProvinceCode ? ['50%', '52%'] : ['50%', compactMap ? '53%' : '52%'],
        layoutSize: activeProvinceCode ? '86%' : nationalLayoutSize(),
        zoom: 1,
        selectedMode: false,
        label: {
          show: showMapLabels, fontSize: activeProvinceCode ? (compactMap ? 9.5 : 11) : (compactMap ? 9 : 10), color: mapColors.label,
          formatter: ({ name }: { name: string }) => (!activeProvinceCode && lang === 'en'
            ? provinceDisplayName('', name, 'en', true)
            : shortRegionLabel(name)),
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
      tooltip: {
        backgroundColor: mapColors.tooltip,
        formatter: (params: { name?: string; data?: { adcode?: string } }) => {
          const rawName = params.name ?? '';
          if (!activeProvinceCode) return provinceDisplayName(params.data?.adcode ?? '', rawName, lang);
          return rawName;
        },
      },
      series: [{
        label: {
          show: showMapLabels,
          fontSize: activeProvinceCode ? (compactMap ? 9.5 : 11) : (compactMap ? 9 : 10),
          color: mapColors.label,
          formatter: ({ name }: { name: string }) => (!activeProvinceCode && lang === 'en'
            ? provinceDisplayName('', name, 'en', true)
            : shortRegionLabel(name)),
        },
        itemStyle: { borderColor: mapColors.border, areaColor: mapColors.area },
        emphasis: {
          label: { color: mapColors.strong },
          itemStyle: { areaColor: mapColors.emphasis, borderColor: mapColors.emphasisBorder },
        },
        data,
      }],
    });
  }, [currentMap, activeProvinceCode, showMapLabels, compactMap, marks, dark, appearance, lang]);

  function adjustZoom(multiplier: number): void {
    const chart = chartRef.current;
    if (!chart) return;
    const option = chart.getOption() as { series?: Array<{ zoom?: number }> };
    const series = option.series?.[0];
    const zoom = Math.max(0.8, Math.min(12, (Number(series?.zoom) || 1) * multiplier));
    chart.setOption({ series: [{ zoom }] });
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

  const activeProvinceTitle = activeProvince
    ? provinceDisplayName(String(activeProvince.properties.adcode), activeProvince.properties.name, lang)
    : '';

  const noticeText = notice === 'loading-map'
    ? t('正在加载地图…', 'Loading map…')
    : notice === 'loading-province'
      ? t('正在加载市级边界…', 'Loading city boundaries…')
      : notice === 'ready-province'
        ? t('点击城市直接点亮，再次点击可进入手账或取消点亮', 'Click a city to mark as visited; click again to open Journal or unmark')
        : notice === 'ready-national'
          ? t('点击省份进入市级地图', 'Click a province to view its cities')
          : notice === 'offline-province'
            ? t('当前地区尚未缓存，请联网后前往个人中心的「设置 → 离线地图」下载。', 'This region is not cached yet. Connect online and download it in Profile → Settings → Offline Maps.')
            : notice.startsWith('province-error:')
              ? t(`市级地图加载失败：${notice.slice('province-error:'.length)}`, `Failed to load province map: ${notice.slice('province-error:'.length)}`)
              : notice.startsWith('national-error:')
                ? t(`全国地图加载失败：${notice.slice('national-error:'.length)}`, `Failed to load China map: ${notice.slice('national-error:'.length)}`)
                : notice;

  return (
    <div className="map-page">
      <div className="section-heading map-heading">
        <div className="map-heading-main">
          <h1>{t('中国旅行地图', 'China Travel Map')}</h1>
          <p>
            {t('点选省份探索城市 · ', 'Tap a province to explore cities · ')}
            <span className="map-zoom-desktop">{t('滚轮缩放', 'Scroll to zoom')}</span>
            <span className="map-zoom-phone">{t('双指缩放', 'Pinch to zoom')}</span>
            {t(' · 拖动漫游', ' · Drag to pan')}
          </p>
        </div>
      </div>
      <div className="map-layout">
        <div className="map-card">
          <div className="map-toolbar">
            <div className="map-toolbar-context">
              {activeProvince && (
                <button type="button" className="map-back-button" onClick={() => setActiveProvinceCode(null)}>
                  {t('← 返回全国', '← Back to China')}
                </button>
              )}
              <span className={`map-level-chip${activeProvince ? ' is-province' : ''}`}>
                <i className="map-level-dot" style={activeProvinceColor ? { background: activeProvinceColor } : undefined} />
                {activeProvince ? t(`${activeProvinceTitle} · 市级`, `${activeProvinceTitle} · Cities`) : t('全国 · 省级', 'China · Provinces')}
              </span>
            </div>
            <div className="map-control-group">
              <button type="button" aria-label={t('放大地图', 'Zoom in')} title={t('放大', 'Zoom in')} onClick={() => adjustZoom(1.35)}>＋</button>
              <button type="button" aria-label={t('缩小地图', 'Zoom out')} title={t('缩小', 'Zoom out')} onClick={() => adjustZoom(1 / 1.35)}>－</button>
              <button type="button" aria-label={t('重置地图视野', 'Reset map view')} title={t('重置视野', 'Reset view')} onClick={() => {
                chartRef.current?.setOption({ series: [{ zoom: 1, center: null }] });
              }}>{t('重置', 'Reset')}</button>
            </div>
          </div>
          <div ref={containerRef} className="map-canvas" role="img" aria-label={activeProvince ? t(`${activeProvinceTitle}城市地图`, `${activeProvinceTitle} city map`) : t('中国省级地图', 'China province map')} />
          {loading && <div className="map-overlay">{t('正在加载地图…', 'Loading map…')}</div>}
          {!loading && !currentMap && <div className="map-overlay error">{noticeText}<button type="button" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>{t('重新加载地图', 'Retry Map')}</button></div>}
          <div className="map-bottom">
            <span className="map-notice-text">{noticeText}</span>
            <div className="map-legend">
              <span><i className="legend-dot visited" style={activeProvinceColor ? { background: activeProvinceColor } : undefined} />{t('已去过', 'Visited')}</span>
              <span><i className="legend-dot empty" />{t('未标记', 'Unvisited')}</span>
            </div>
          </div>
        </div>
        <aside className="map-side card">
          {activeProvince ? <>
            <div className="map-province-hero">
              <div className="map-province-head">
                <div className="map-province-title">
                  <i className="map-province-accent" style={{ background: activeProvinceColor }} />
                  <h2>{activeProvinceTitle}</h2>
                </div>
                <span className="map-progress-pill" style={{ '--pill-color': activeProvinceColor } as CSSProperties}>
                  {t(`${activeProvinceVisitedCount} / ${cities.length} 城`, `${activeProvinceVisitedCount} / ${cities.length}`)}
                </span>
              </div>
              <div className="side-stat-bar" aria-hidden="true">
                <span style={{ width: `${activeProvincePct}%`, background: activeProvinceColor }} />
              </div>
              <div className="map-province-actions">
                <button type="button" className="primary province-ai-button" onClick={() => onRecommendProvince(activeProvince.properties.name)}>
                  {t('✦ AI 推荐怎么玩', '✦ AI Trip Ideas')}
                </button>
              </div>
            </div>
            <div className="map-list-header">
              <span>{t('城市索引', 'Cities')}</span>
              <small>{t('点击点亮 · 再点记手账', 'Tap to mark · Tap again for Journal')}</small>
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
              <span>
                {activeProvinceVisitedCount > 0
                  ? t(`已点亮 ${activeProvinceVisitedCount} 座 · 再次点击可进入手账`, `${activeProvinceVisitedCount} visited · Click again to open Journal`)
                  : t('点击任意城市即可直接点亮足迹', 'Click any city to mark it as visited')}
              </span>
            </div>
          </> : <>
            <div className="side-stat-box map-atlas-summary">
              <div className="map-atlas-summary-head">
                <h2>{t('足迹总览', 'Footprint Overview')}</h2>
                <span className="map-progress-pill">{t(`探索 ${provinceExplorePct}%`, `${provinceExplorePct}% Explored`)}</span>
              </div>
              <div className="side-stat">
                <div><strong>{visitedMarks.length}</strong><span>{t('已去城市', 'Visited Cities')}</span></div>
                <div><strong>{visitedProvincesCount}<em> / {totalProvinces}</em></strong><span>{t('点亮省份', 'Provinces')}</span></div>
              </div>
              <div className="side-stat-bar" aria-hidden="true"><span style={{ width: `${provinceExplorePct}%` }} /></div>
            </div>
            <div className="map-province-filter" role="tablist" aria-label={t('筛选省份', 'Filter provinces')}>
              <button type="button" role="tab" aria-selected={provinceFilter === 'visited'} className={provinceFilter === 'visited' ? 'active' : ''} onClick={() => setProvinceFilter('visited')}>
                {t('已点亮', 'Visited')} <span>{visitedProvincesCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={provinceFilter === 'all'} className={provinceFilter === 'all' ? 'active' : ''} onClick={() => setProvinceFilter('all')}>
                {t('全部', 'All')} <span>{totalProvinces}</span>
              </button>
              <button type="button" role="tab" aria-selected={provinceFilter === 'unvisited'} className={provinceFilter === 'unvisited' ? 'active' : ''} onClick={() => setProvinceFilter('unvisited')}>
                {t('待探索', 'To Go')} <span>{Math.max(0, totalProvinces - visitedProvincesCount)}</span>
              </button>
            </div>
            {filteredProvinces.length > 0 ? (
              <div className="province-list">{filteredProvinces.map((feature) => {
                const code = String(feature.properties.adcode);
                const color = provinceColor(code);
                const litCount = visitedCountByProvince.get(code) ?? 0;
                const fullName = provinceDisplayName(code, feature.properties.name, lang);
                const shortName = lang === 'en' ? provinceDisplayName(code, feature.properties.name, 'en', true) : labelForFeature(feature);
                return <button
                  key={code}
                  type="button"
                  className={litCount > 0 ? 'is-visited' : undefined}
                  style={{ '--prov-color': color } as CSSProperties}
                  title={litCount > 0
                    ? t(`${fullName} · 已点亮 ${litCount} 座城市`, `${fullName} · ${litCount} cities visited`)
                    : t(`${fullName} · 点击进入市级地图`, `${fullName} · Click to view cities`)}
                  onClick={() => setActiveProvinceCode(code)}
                  onMouseEnter={() => highlightRegion(feature.properties.name)}
                  onMouseLeave={() => highlightRegion(null)}
                >
                  <i style={{ background: color }} />
                  <span className="province-name">{shortName}</span>
                  {litCount > 0 && <em className="province-count">{litCount}</em>}
                </button>;
              })}</div>
            ) : (
              <div className="map-filter-empty">
                {provinceFilter === 'visited'
                  ? t('还没有点亮任何省份，点击左侧地图开始第一段旅程吧', 'No provinces lit yet. Click the map to start your first journey.')
                  : t('太棒了，全国 34 个省级行政区都已点亮！', 'Amazing! All 34 provincial regions are lit!')}
              </div>
            )}
            <div className="map-side-foot">
              {recentVisitedMarks.length > 0 ? (
                <div className="map-recent-strip">
                  <span className="map-recent-label">{t('最近点亮', 'Recent')}</span>
                  <div className="map-recent-chips">
                    {recentVisitedMarks.map((mark) => (
                      <button
                        key={mark.id}
                        type="button"
                        className="map-recent-chip"
                        onClick={() => mark.provinceCode && setActiveProvinceCode(mark.provinceCode)}
                        title={t(`查看 ${mark.name} 所在省份`, `View province for ${mark.name}`)}
                      >
                        <i style={{ background: provinceColor(mark.provinceCode) }} />
                        {shortRegionLabel(mark.name)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <span>{t('点击地图或省份标签，点亮你的第一座城市', 'Tap the map or a province to light your first city')}</span>
              )}
            </div>
          </>}
        </aside>
      </div>
    </div>
  );
}
