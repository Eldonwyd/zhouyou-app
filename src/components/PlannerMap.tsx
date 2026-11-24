import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PlannerContent, WishlistPlace } from '../planner-types';
import { datedPlannerMapPlaces, plannerMapRouteStops, PLANNER_MAP_LOOKUP_VERSION } from '../planner-map';
import type { PlannerMapPosition } from '../planner-map';
import { plannerApi } from '../planner-api';
import { mapPlaceLinks, openMapAppPlace } from '../external-app-links';
import { plannerDisplayText } from '../planner-display';
import { XHS_PLACE_KIND_LABELS } from '../planner-xhs';

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const FALLBACK_TILE_URL = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

/** 计划保存后自动准备坐标；只有底图在展开时加载，避免地图界面决定数据是否存在。 */
export default function PlannerMap({ content, hotels = {}, wishlist = [], savedPositions = {}, onSavePositions, onScheduleWishlist }: {
  content: PlannerContent; hotels?: Record<string, string>; wishlist?: WishlistPlace[];
  savedPositions?: Record<string, PlannerMapPosition>;
  onSavePositions: (positions: PlannerMapPosition[]) => Promise<void>;
  onScheduleWishlist?: (item: WishlistPlace) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState('');
  const [retry, setRetry] = useState(0);
  const [positions, setPositions] = useState<PlannerMapPosition[]>(Object.values(savedPositions));
  const [adjustKey, setAdjustKey] = useState('');
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(onSavePositions);
  saveRef.current = onSavePositions;
  const savedRef = useRef(savedPositions);
  savedRef.current = { ...savedPositions, ...savedRef.current };
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [tileError, setTileError] = useState(false);
  const [tileUrl, setTileUrl] = useState(DEFAULT_TILE_URL);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const places = useMemo(() => datedPlannerMapPlaces(content, hotels), [content, hotels]);
  const defaultCity = content.cities[0]?.name ?? '';
  const wishlistPlaces = useMemo(
    () =>
      wishlist
        // 待选灵感池同样只定位景点和打卡点，餐饮与住宿不入地图。
        .filter((item) => item.kind === 'sight' || item.kind === 'photo_spot')
        .map((item) => {
          const city = (item.city || defaultCity).trim();
          const name = (item.canonicalName || item.name).trim();
          if (!city || !name) return null;
          const cityCode =
            content.cities.find((c) => c.name.replace(/市$/, '') === city.replace(/市$/, ''))?.code ?? '';
          return {
            key: JSON.stringify(['wishlist', city, name]),
            name,
            city,
            cityCode,
            item,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [wishlist, defaultCity, content.cities],
  );
  // 普通对话或锁定切换不重复检索；新增/删除/修改地点（含待选池）才更换查询签名。
  const query = JSON.stringify([
    ...places.map(({ key, name, city, cityCode }) => ({ key, name, city, cityCode })),
    ...wishlistPlaces.map(({ key, name, city, cityCode }) => ({ key, name, city, cityCode })),
  ]);
  const scheduleWishlistRef = useRef(onScheduleWishlist);
  scheduleWishlistRef.current = onScheduleWishlist;
  const visible = places.filter((place) => !date || place.visits.some((visit) => visit.date === date));
  const stops = plannerMapRouteStops(content, hotels);
  const colors = ['#187b72', '#b36522', '#5967b4', '#a24778', '#447c33'];
  const colorForDate = (value: string) => colors[content.days.findIndex((day) => day.date === value) % colors.length];
  const positionMap = new Map(positions.map((position) => [position.key, position]));

  useEffect(() => {
    if (date && !content.days.some((day) => day.date === date)) setDate('');
  }, [date, content.days]);
  useEffect(() => { setAdjustKey(''); }, [date]);
  useEffect(() => {
    const controller = new AbortController();
    const saved = Object.values(savedRef.current);
    setPositions(saved);
    setError('');
    setNotice('');
    setStage('正在匹配行程地点');
    const pending = (JSON.parse(query) as typeof places).filter((place) => {
      const position = savedRef.current[place.key];
      return !position || (position.status !== 'located' && (retry > 0 || position.lookupVersion !== PLANNER_MAP_LOOKUP_VERSION));
    });
    if (!pending.length) { setStage(''); return; }
    // 逐地点保存，关闭地图不会取消；计划切换时已完成的坐标也不会丢失。
    const startTimer = window.setTimeout(() => { void (async () => {
      for (const [index, place] of pending.entries()) {
        controller.signal.throwIfAborted();
        setStage(`正在定位 ${index + 1}/${pending.length}：${place.name}`);
        // 一个地点的请求中断不应让后面的所有地点都停止定位。
        let result;
        try {
          result = await plannerApi<{ positions: PlannerMapPosition[]; notice: string; tileUrl: string }>(
            'map', { places: [place], retry: retry > 0 }, controller.signal, () => {});
        } catch (failure) {
          if (controller.signal.aborted) throw failure;
          result = { positions: [{ key: place.key, status: 'unresolved' as const,
            reason: failure instanceof Error ? failure.message : '地点查询失败，请重试' }], notice: '', tileUrl: '' };
        }
        if (controller.signal.aborted) return;
        const resolved = result.positions.map((position) => ({ ...position, lookupVersion: PLANNER_MAP_LOOKUP_VERSION }));
        await saveRef.current(resolved);
        for (const position of resolved) savedRef.current[position.key] = position;
        setPositions(Object.values(savedRef.current));
        if (result.notice) setNotice(result.notice);
        if (/^https:\/\/[^@\s]+\{z\}.*\{x\}.*\{y\}/.test(result.tileUrl)) setTileUrl(result.tileUrl);
      }
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '地点查询失败，请重试');
    }).finally(() => { if (!controller.signal.aborted) setStage(''); }); }, 0);
    return () => { window.clearTimeout(startTimer); controller.abort(); };
  }, [query, retry]);

  /** 所选日期/地点的校正立即持久化；失败保留编辑入口，避免显示已保存的假象。 */
  async function saveManualPosition(position: PlannerMapPosition) {
    setSaving(true);
    setError('');
    try {
      await saveRef.current([position]);
      savedRef.current[position.key] = position;
      setPositions((current) => [...current.filter((item) => item.key !== position.key), position]);
      setAdjustKey('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '位置保存失败'); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    const instance = map.current;
    if (!instance || !adjustKey || saving) return;
    const click = (event: L.LeafletMouseEvent) => {
      void saveManualPosition({ key: adjustKey, status: 'located', latitude: event.latlng.lat,
        longitude: event.latlng.lng, source: '手动确认', coordinateSystem: 'WGS84' });
    };
    instance.on('click', click);
    return () => { instance.off('click', click); };
  }, [adjustKey, saving, open, tileUrl, retry]);

  useEffect(() => {
    if (!open || !host.current) return;
    const instance = L.map(host.current, { scrollWheelZoom: true, fadeAnimation: false }).setView([35, 105], 4);
    map.current = instance;
    setTileError(false);
    const layer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(instance);
    let tileErrors = 0;
    layer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors >= 3 && tileUrl === DEFAULT_TILE_URL) {
        setTileUrl(FALLBACK_TILE_URL);
        return;
      }
      if (tileErrors >= 3) setTileError(true);
    });
    const resize = new ResizeObserver(() => {
      instance.invalidateSize({ pan: false });
      // 放大或旋转手机后重新计算已打开弹窗，避免其留在旧画布边缘被截断。
      instance.eachLayer((item) => {
        const popup = item.getPopup();
        if (popup?.isOpen()) popup.update();
      });
    });
    resize.observe(host.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; };
  }, [open, tileUrl, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !open) return;
    const markers = L.featureGroup().addTo(instance);
    const lines = L.featureGroup().addTo(instance);
    const arrows = L.layerGroup().addTo(instance);
    // 每天独立连线，缺失位置会断开，不跨天或跨未知地点制造虚假的连续路线。
    const segments: Array<{ from: L.LatLng; to: L.LatLng; color: string }> = [];
    for (const day of content.days.filter((item) => !date || item.date === date)) {
      const daily = stops.filter((stop) => stop.visits[0].date === day.date);
      for (let index = 1; index < daily.length; index++) {
        const previous = positionMap.get(daily[index - 1].key), next = positionMap.get(daily[index].key);
        if (previous?.status !== 'located' || next?.status !== 'located') continue;
        const from = L.latLng(previous.latitude!, previous.longitude!), to = L.latLng(next.latitude!, next.longitude!);
        if (from.equals(to)) continue;
        const color = colorForDate(day.date);
        L.polyline([from, to], { color, weight: 3, opacity: .75, dashArray: '7 6', interactive: false }).addTo(lines);
        segments.push({ from, to, color });
      }
    }
    // 箭头按当前投影计算朝向，缩放后仍朝向下一站，置于线段中部避免被圆点遮住。
    const drawArrows = () => {
      arrows.clearLayers();
      for (const { from, to, color } of segments) {
        const start = instance.latLngToLayerPoint(from), end = instance.latLngToLayerPoint(to);
        if (start.distanceTo(end) < 45) continue;
        const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
        const midpoint = instance.layerPointToLatLng(start.add(end).divideBy(2));
        L.marker(midpoint, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'planner-route-arrow', html: `<span style="color:${color};transform:rotate(${angle}deg)">➤</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
        }).addTo(arrows);
      }
    };
    for (const place of visible) {
      const position = positionMap.get(place.key);
      if (position?.status !== 'located' || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) continue;
      // popup 使用 DOM + textContent，模型文本不得以 HTML 注入地图。
      const popup = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = plannerDisplayText(`${place.city} · ${place.name}`, content);
      popup.append(heading);
      if (position.precision === 'area') {
        const areaNote = document.createElement('p');
        areaNote.textContent = `片区参考位置：${position.label || place.name}`;
        popup.append(areaNote);
      }
      for (const visit of place.visits.filter((item) => !date || item.date === date)) {
        const row = document.createElement('p');
        row.textContent = plannerDisplayText(`${visit.date} · ${visit.title}`, content);
        popup.append(row);
      }
      const placeMapLinks = mapPlaceLinks({
        city: place.city,
        name: place.name,
        latitude: position.latitude,
        longitude: position.longitude,
      });
      const link = document.createElement('a');
      link.href = placeMapLinks.webUrl;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `在${placeMapLinks.label}查看`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openMapAppPlace({
          city: place.city,
          name: place.name,
          latitude: position.latitude,
          longitude: position.longitude,
        });
      });
      popup.append(link);
      const adjust = document.createElement('button');
      adjust.className = 'text-button'; adjust.textContent = '调整位置';
      adjust.onclick = () => { setAdjustKey(place.key); instance.closePopup(); };
      popup.append(adjust);
      const visits = place.visits.filter((visit) => !date || visit.date === date);
      const numbers = visits.map((visit) => visit.order).join('/');
      const color = colorForDate(visits[0].date);
      const label = document.createElement('span');
      label.textContent = `${!date ? `${visits[0].date.slice(5)} · ` : ''}${place.name}`;
      L.marker([position.latitude!, position.longitude!], { title: `${numbers} · ${place.name}`,
        icon: L.divIcon({ className: 'planner-number-marker', html: `<span style="background:${color}">${numbers}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
      }).bindPopup(popup, { maxWidth: 260, keepInView: true })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -17], className: 'planner-stop-label' }).addTo(markers);
    }
    // 叠加显示小红书「待选灵感池」点位，方便用户一眼看出离哪天行程顺路。
    for (const entry of wishlistPlaces) {
      const position = positionMap.get(entry.key);
      if (position?.status !== 'located' || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) continue;
      const popup = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = `★ 待选 · ${entry.item.name}`;
      popup.append(heading);
      const meta = document.createElement('p');
      meta.textContent = [entry.city, XHS_PLACE_KIND_LABELS[entry.item.kind]].filter(Boolean).join(' · ');
      popup.append(meta);
      if (entry.item.note) {
        const note = document.createElement('p');
        note.textContent = entry.item.note;
        popup.append(note);
      }
      if (entry.item.sourceUrl) {
        const src = document.createElement('a');
        src.href = entry.item.sourceUrl;
        src.target = '_blank';
        src.rel = 'noopener noreferrer';
        src.textContent = `查看小红书原帖${entry.item.sourceTitle ? `：${entry.item.sourceTitle}` : ''}`;
        popup.append(src);
      }
      const mapLinkInfo = mapPlaceLinks({
        city: entry.city,
        name: entry.name,
        latitude: position.latitude,
        longitude: position.longitude,
      });
      const amap = document.createElement('a');
      amap.href = mapLinkInfo.webUrl;
      amap.target = '_blank';
      amap.rel = 'noopener noreferrer';
      amap.textContent = `在${mapLinkInfo.label}查看`;
      amap.addEventListener('click', (event) => {
        event.preventDefault();
        openMapAppPlace({
          city: entry.city,
          name: entry.name,
          latitude: position.latitude,
          longitude: position.longitude,
        });
      });
      popup.append(amap);
      if (scheduleWishlistRef.current) {
        const btn = document.createElement('button');
        btn.className = 'text-button';
        btn.textContent = '排入行程';
        btn.onclick = () => {
          instance.closePopup();
          scheduleWishlistRef.current?.(entry.item);
        };
        popup.append(btn);
      }
      const label = document.createElement('span');
      label.textContent = `★ ${entry.item.name}`;
      L.marker([position.latitude!, position.longitude!], {
        title: `待选 · ${entry.item.name}`,
        icon: L.divIcon({
          className: 'planner-wishlist-marker',
          html: '<span>★</span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).bindPopup(popup, { maxWidth: 260, keepInView: true })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -15], className: 'planner-stop-label planner-wishlist-label' })
        .addTo(markers);
    }
    if (markers.getLayers().length) instance.fitBounds(markers.getBounds(), { padding: [65, 65], maxZoom: 15, animate: false });
    drawArrows();
    instance.on('zoomend moveend', drawArrows);
    return () => { instance.off('zoomend moveend', drawArrows); markers.remove(); lines.remove(); arrows.remove(); };
  }, [open, date, query, positions, tileUrl, retry, content, wishlistPlaces]);

  // 放大层支持 Esc；焦点保持在展开入口附近，便于键盘关闭。
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expanded]);

  return <section className={`card planner-map ${expanded ? 'planner-map-expanded' : ''}`} aria-label="行程地图">
    <div className="planner-map-heading">
      <div><h2>行程地图</h2><p className="muted">按天查看行程景点（不含餐饮与酒店），点击标记可查看活动并前往高德。</p>
        {!open && stage && <small role="status">{stage}</small>}
        {!open && error && <small role="alert">{error}</small>}
      </div>
      <div className="planner-map-actions">
        <button className="primary" aria-expanded={open} onClick={() => { setOpen(!open); setExpanded(false); }}>{open ? '收起地图' : '查看行程地图'}</button>
        {open && <button className="secondary" onClick={() => setExpanded(!expanded)}>{expanded ? '退出放大' : '放大地图'}</button>}
      </div>
    </div>
    {open && <>
      <div className="planner-map-actions">
        <label>查看日期 <select aria-label="地图日期" value={date} onChange={(event) => setDate(event.target.value)}><option value="">全部日期</option>{content.days.map((day) => <option key={day.date} value={day.date}>{day.date}</option>)}</select></label>
        <button className="secondary" disabled={Boolean(stage)} onClick={() => setRetry(retry + 1)}>重试定位与地图</button>
      </div>
      {stage && <p role="status">{stage}</p>}
      {/* 直接展示覆盖率，避免地图上的少数点被误认为整份行程只有这些景点。 */}
      <p className="muted" role="status">当前 {visible.length} 个景点，已定位 {visible.filter((place) => positionMap.get(place.key)?.status === 'located').length} 个
        {visible.some((place) => positionMap.get(place.key)?.status !== 'located') && '；其余景点及原因见下方“待定位景点”。'}</p>
      {adjustKey && <p role="status">{saving ? '正在保存位置…' : '请在地图上点击正确位置，点击后自动保存到该日期。'} <button className="text-button" disabled={saving} onClick={() => setAdjustKey('')}>取消</button></p>}
      {notice && <p className="planner-banner">{notice}</p>}
      {error && <p className="planner-error" role="alert">{error}</p>}
      {tileError && <p className="planner-error" role="alert">地图底图加载失败，请检查网络后重试。</p>}
      <div className="planner-map-canvas" ref={host} aria-label="可缩放和拖动的真实地图" />
      <small className="muted">
        数字为当天到访顺序，箭头为行程顺序示意
        {wishlistPlaces.length > 0 ? `；★ 为待选灵感池点位（已定位 ${wishlistPlaces.filter((p) => positionMap.get(p.key)?.status === 'located').length}/${wishlistPlaces.length} 个），点击可直接排入行程。` : '。'}
      </small>
      {visible.some((place) => positionMap.get(place.key)?.status !== 'located') && <details className="planner-map-missing">
        <summary>待定位景点（{visible.filter((place) => positionMap.get(place.key)?.status !== 'located').length}）</summary>
        <ul>{visible.filter((place) => positionMap.get(place.key)?.status !== 'located').map((place) =>
          <li key={place.key}>{place.visits[0].date} · {place.name}：{positionMap.get(place.key)?.reason || (stage ? '等待定位' : '尚未取得位置')}
            {' '}<a
              href={mapPlaceLinks(place).webUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                openMapAppPlace(place);
              }}
            >在{mapPlaceLinks(place).label}查找</a></li>)}</ul>
        <select aria-label="选择待定位地点" value={adjustKey} onChange={(event) => setAdjustKey(event.target.value)}>
          <option value="">选择地点后在地图上点击位置</option>
          {visible.filter((place) => positionMap.get(place.key)?.status !== 'located').map((place) =>
            <option key={place.key} value={place.key}>{place.visits[0].date} · {place.name}</option>)}
        </select>
        {positionMap.get(adjustKey)?.candidates?.map((candidate, index) => <button className="text-button" key={index} disabled={saving}
          onClick={() => void saveManualPosition({ ...candidate, key: adjustKey, status: 'located', source: '手动确认',
            coordinateSystem: candidate.amapLocation ? 'WGS84（由 GCJ-02 近似转换）' : 'WGS84' })}>{candidate.label}</button>)}
      </details>}
    </>}
  </section>;
}
