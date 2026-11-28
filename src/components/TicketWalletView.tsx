import { useEffect, useMemo, useState } from 'react';
import type { Journey } from '../types';
import { createLocalId, downloadBlob, localDay } from '../utils';
import {
  TICKET_KINDS,
  TICKET_KIND_META,
  extractRouteSegments,
  loadTicketsFromStorage,
  renderSingleTicketPng,
  renderTripRouteMapPng,
  renderTripTicketCollagePng,
  saveTicketsToStorage,
  type TicketKind,
  type TravelTicket,
} from '../ticket-wallet';
import ThemedDatePicker from './ThemedDatePicker';
import ThemedSelect from './ThemedSelect';
import { useI18n } from '../i18n';

interface TicketWalletViewProps {
  trips: Journey[];
  initialTripId?: string | null;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

interface ExportPreview {
  title: string;
  fileName: string;
  dataUrl: string;
  blob: Blob;
}

function emptyDraft(trips: Journey[], defaultTripId?: string | null): Omit<TravelTicket, 'id' | 'createdAt'> {
  const trip = defaultTripId ? trips.find((item) => item.id === defaultTripId) : null;
  return {
    kind: 'train',
    tripId: trip?.id ?? null,
    tripLabel: trip?.title ?? '',
    date: trip?.startDate ?? localDay(new Date()),
    time: '09:00',
    arriveTime: '',
    fromPlace: '',
    toPlace: '',
    code: '',
    seatOrGate: '',
    price: 0,
    passenger: '',
    note: '',
  };
}

/** 互动 SVG 出行路线图预览组件 */
function TicketRouteSvgPreview({ tickets }: { tickets: TravelTicket[] }) {
  const segments = useMemo(() => extractRouteSegments(tickets), [tickets]);

  if (segments.length === 0) {
    return (
      <div className="ticket-route-empty">
        <strong>还没有可连线的出发地与目的地</strong>
        <p>在票据中填写中国城市、高铁站、机场或高速收费站（如“北京南站 → 天津站”），即可自动串联成出行路线图。</p>
      </div>
    );
  }

  const allCoords = segments.flatMap((s) => [s.from.coord, s.to.coord]);
  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);
  const rawMinLng = Math.min(...lngs);
  const rawMaxLng = Math.max(...lngs);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const lngSpan = Math.max(2.2, rawMaxLng - rawMinLng);
  const latSpan = Math.max(1.8, rawMaxLat - rawMinLat);
  const minLng = rawMinLng - lngSpan * 0.2;
  const maxLng = rawMaxLng + lngSpan * 0.2;
  const minLat = rawMinLat - latSpan * 0.22;
  const maxLat = rawMaxLat + latSpan * 0.22;

  const W = 720;
  const H = 380;
  const project = ([lng, lat]: [number, number]): [number, number] => [
    ((lng - minLng) / (maxLng - minLng)) * W,
    H - ((lat - minLat) / (maxLat - minLat)) * H,
  ];

  const uniqueNodes: Array<{ name: string; coord: [number, number]; order: number }> = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (!seen.has(seg.from.cityName)) {
      seen.add(seg.from.cityName);
      uniqueNodes.push({ name: seg.from.cityName, coord: seg.from.coord, order: uniqueNodes.length + 1 });
    }
    if (!seen.has(seg.to.cityName)) {
      seen.add(seg.to.cityName);
      uniqueNodes.push({ name: seg.to.cityName, coord: seg.to.coord, order: uniqueNodes.length + 1 });
    }
  }

  return (
    <div className="ticket-route-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ticket-route-svg" role="img" aria-label="出行路线图">
        <defs>
          <pattern id="zyRouteGrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(218, 178, 118, 0.1)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} rx="16" fill="#171310" />
        <rect x="0" y="0" width={W} height={H} rx="16" fill="url(#zyRouteGrid)" />

        {segments.map((seg, idx) => {
          const [x1, y1] = project(seg.from.coord);
          const [x2, y2] = project(seg.to.coord);
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.hypot(dx, dy) || 1;
          const curve = seg.ticket.kind === 'flight' ? 0.25 : 0.14;
          const sign = idx % 2 === 0 ? -1 : 1;
          const cx = midX + (-dy / dist) * dist * curve * sign;
          const cy = midY + (dx / dist) * dist * curve * sign;
          const bx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
          const by = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
          const color = TICKET_KIND_META[seg.ticket.kind].routeColor;
          return (
            <g key={seg.ticket.id}>
              <path
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={seg.ticket.kind === 'flight' ? 2.6 : 3.2}
                strokeDasharray={seg.ticket.kind === 'flight' ? '7 5' : undefined}
                strokeLinecap="round"
              />
              <rect
                x={bx - 42}
                y={by - 12}
                width="84"
                height="24"
                rx="12"
                fill="rgba(20, 16, 13, 0.92)"
                stroke={color}
                strokeWidth="1.2"
              />
              <text x={bx} y={by + 4} textAnchor="middle" fill="#f8efe2" fontSize="11" fontWeight="700">
                {TICKET_KIND_META[seg.ticket.kind].icon} {seg.ticket.code || `${seg.distanceKm}km`}
              </text>
            </g>
          );
        })}

        {uniqueNodes.map((node) => {
          const [nx, ny] = project(node.coord);
          return (
            <g key={node.name}>
              <circle cx={nx} cy={ny} r="10" fill="#e2a452" stroke="#171310" strokeWidth="2.5" />
              <text x={nx} y={ny + 3.5} textAnchor="middle" fill="#1a1410" fontSize="10.5" fontWeight="800">
                {node.order}
              </text>
              <text x={nx} y={ny - 16} textAnchor="middle" fill="#f7e8d4" fontSize="13.5" fontWeight="700">
                {node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function TicketWalletView({ trips, initialTripId = null, onNotice, onError }: TicketWalletViewProps) {
  const { t } = useI18n();
  const [tickets, setTickets] = useState<TravelTicket[]>(() => loadTicketsFromStorage());
  const [selectedGroup, setSelectedGroup] = useState<string>(() => (initialTripId ? `trip:${initialTripId}` : 'all'));
  const [subView, setSubView] = useState<'wallet' | 'route'>('wallet');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<TravelTicket, 'id' | 'createdAt'>>(() => emptyDraft(trips, initialTripId));
  const [priceText, setPriceText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  useEffect(() => {
    if (initialTripId) {
      setSelectedGroup(`trip:${initialTripId}`);
    }
  }, [initialTripId]);

  const persistTickets = (next: TravelTicket[]) => {
    const sorted = [...next].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    setTickets(sorted);
    saveTicketsToStorage(sorted);
  };

  // 所有出行分组（已有旅行 + 自定义出行名）
  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    map.set('all', t('全部票据', 'All Tickets'));
    for (const trip of trips) {
      map.set(`trip:${trip.id}`, `${trip.title} (${trip.startDate})`);
    }
    for (const item of tickets) {
      if (item.tripId && !map.has(`trip:${item.tripId}`)) {
        map.set(`trip:${item.tripId}`, item.tripLabel || '已关联旅行');
      } else if (!item.tripId && item.tripLabel.trim()) {
        map.set(`label:${item.tripLabel.trim()}`, item.tripLabel.trim());
      }
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [trips, tickets, t]);

  const visibleTickets = useMemo(() => {
    if (selectedGroup === 'all') return tickets;
    if (selectedGroup.startsWith('trip:')) {
      const tid = selectedGroup.slice(5);
      return tickets.filter((item) => item.tripId === tid);
    }
    if (selectedGroup.startsWith('label:')) {
      const lbl = selectedGroup.slice(6);
      return tickets.filter((item) => !item.tripId && item.tripLabel.trim() === lbl);
    }
    return tickets;
  }, [tickets, selectedGroup]);

  const routeSegments = useMemo(() => extractRouteSegments(visibleTickets), [visibleTickets]);
  const totalCost = useMemo(() => visibleTickets.reduce((sum, item) => sum + (Number(item.price) || 0), 0), [visibleTickets]);
  const totalKm = useMemo(() => routeSegments.reduce((sum, seg) => sum + seg.distanceKm, 0), [routeSegments]);
  const activeGroupTitle = useMemo(() => {
    const found = groupOptions.find((opt) => opt.value === selectedGroup);
    return selectedGroup === 'all' ? '我的出行票夹' : (found?.label || '出行票夹');
  }, [groupOptions, selectedGroup]);

  function openNewEditor(defaultKind: TicketKind = 'train') {
    const linkedTripId = selectedGroup.startsWith('trip:') ? selectedGroup.slice(5) : null;
    const base = emptyDraft(trips, linkedTripId);
    if (selectedGroup.startsWith('label:')) {
      base.tripLabel = selectedGroup.slice(6);
    }
    base.kind = defaultKind;
    setEditingId(null);
    setDraft(base);
    setPriceText('');
    setEditorOpen(true);
  }

  function openEditEditor(ticket: TravelTicket) {
    setEditingId(ticket.id);
    setDraft({
      kind: ticket.kind,
      tripId: ticket.tripId,
      tripLabel: ticket.tripLabel,
      date: ticket.date,
      time: ticket.time,
      arriveTime: ticket.arriveTime,
      fromPlace: ticket.fromPlace,
      toPlace: ticket.toPlace,
      code: ticket.code,
      seatOrGate: ticket.seatOrGate,
      price: ticket.price,
      passenger: ticket.passenger,
      note: ticket.note,
    });
    setPriceText(ticket.price ? String(ticket.price) : '');
    setEditorOpen(true);
  }

  function handleSaveTicket() {
    if (!draft.fromPlace.trim() && !draft.toPlace.trim()) {
      onError(t('请至少填写出发地或目的地/景点名称', 'Please enter departure or destination'));
      return;
    }
    const parsedPrice = Number.parseFloat(priceText);
    const linkedTrip = draft.tripId ? trips.find((item) => item.id === draft.tripId) : null;
    const record: TravelTicket = {
      id: editingId ?? createLocalId(),
      ...draft,
      tripLabel: linkedTrip ? linkedTrip.title : draft.tripLabel.trim(),
      fromPlace: draft.fromPlace.trim(),
      toPlace: draft.toPlace.trim(),
      code: draft.code.trim(),
      seatOrGate: draft.seatOrGate.trim(),
      passenger: draft.passenger.trim(),
      note: draft.note.trim(),
      price: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0,
      createdAt: editingId
        ? (tickets.find((item) => item.id === editingId)?.createdAt ?? new Date().toISOString())
        : new Date().toISOString(),
    };
    const next = editingId
      ? tickets.map((item) => (item.id === editingId ? record : item))
      : [...tickets, record];
    persistTickets(next);
    setEditorOpen(false);
    onNotice(editingId ? t('票据已更新', 'Ticket updated') : t('已收入出行票夹', 'Added to Ticket Wallet'));
  }

  function handleDeleteTicket(id: string) {
    if (!window.confirm(t('确定删除这张票据吗？', 'Delete this ticket?'))) return;
    persistTickets(tickets.filter((item) => item.id !== id));
    onNotice(t('已删除票据', 'Ticket deleted'));
  }

  async function handleExportSingle(ticket: TravelTicket) {
    setExporting(true);
    try {
      const { blob, dataUrl } = await renderSingleTicketPng(ticket);
      const safeName = `${ticket.fromPlace || 'ticket'}-${ticket.toPlace || ticket.code || 'card'}`.replace(/[\\/:*?"<>|]/g, '_');
      setPreview({
        title: `${TICKET_KIND_META[ticket.kind].icon} ${ticket.fromPlace} → ${ticket.toPlace}`,
        fileName: `周游票夹-${safeName}.png`,
        dataUrl,
        blob,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : '拟物图片生成失败');
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCollage() {
    if (visibleTickets.length === 0) {
      onError(t('当前分组还没有票据，先添加一张吧', 'No tickets to export yet'));
      return;
    }
    setExporting(true);
    try {
      const { blob, dataUrl } = await renderTripTicketCollagePng(activeGroupTitle, visibleTickets);
      setPreview({
        title: `🎫 ${activeGroupTitle} · 票夹合集`,
        fileName: `周游票夹合集-${activeGroupTitle.replace(/[\\/:*?"<>|\s]/g, '_')}.png`,
        dataUrl,
        blob,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : '票夹长图生成失败');
    } finally {
      setExporting(false);
    }
  }

  async function handleExportRouteMap() {
    if (routeSegments.length === 0) {
      onError(t('请先添加至少 1 张包含起终点城市/站名的票据', 'Add at least one ticket with recognizable cities/stations'));
      return;
    }
    setExporting(true);
    try {
      const { blob, dataUrl } = await renderTripRouteMapPng(activeGroupTitle, visibleTickets);
      setPreview({
        title: `🗺️ ${activeGroupTitle} · 出行路线图`,
        fileName: `周游出行路线图-${activeGroupTitle.replace(/[\\/:*?"<>|\s]/g, '_')}.png`,
        dataUrl,
        blob,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : '路线图海报生成失败');
    } finally {
      setExporting(false);
    }
  }

  const kindMeta = TICKET_KIND_META[draft.kind];

  return (
    <section className="ticket-wallet-page">
      <div className="card ticket-wallet-hero">
        <div className="ticket-wallet-hero-top">
          <div>
            <h2>🎫 {t('出行票夹', 'Ticket Wallet')}</h2>
            <p className="muted">
              {t(
                '收纳高铁票、飞机登机牌、高速过路费与景点票根，一键生成高清拟物票据图片与出行路线图。',
                'Collect train tickets, boarding passes, highway tolls, and stubs—export skeuomorphic images & route maps.',
              )}
            </p>
          </div>
          <div className="ticket-wallet-hero-actions">
            <button type="button" className="primary" onClick={() => openNewEditor('train')}>
              ＋ {t('记一张票', 'Add Ticket')}
            </button>
          </div>
        </div>

        <div className="ticket-wallet-stats">
          <div className="ticket-stat-pill">
            <span>{t('票据总数', 'Tickets')}</span>
            <strong>{visibleTickets.length} 张</strong>
          </div>
          <div className="ticket-stat-pill">
            <span>{t('合计花费', 'Total Cost')}</span>
            <strong>¥ {totalCost.toFixed(1)}</strong>
          </div>
          <div className="ticket-stat-pill">
            <span>{t('估算里程', 'Est. Distance')}</span>
            <strong>{totalKm > 0 ? `${totalKm} km` : '--'}</strong>
          </div>
        </div>

        <div className="ticket-wallet-toolbar">
          <div className="ticket-group-picker">
            <ThemedSelect
              value={selectedGroup}
              title={t('按出行筛选票据', 'Filter by Trip')}
              options={groupOptions}
              onChange={setSelectedGroup}
            />
          </div>
          <div className="ticket-view-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'wallet'}
              className={subView === 'wallet' ? 'is-active' : ''}
              onClick={() => setSubView('wallet')}
            >
              🎫 {t('拟物票夹', 'Tickets')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'route'}
              className={subView === 'route' ? 'is-active' : ''}
              onClick={() => setSubView('route')}
            >
              🗺️ {t('出行路线图', 'Route Map')}
            </button>
          </div>
          <div className="ticket-export-actions">
            <button type="button" className="secondary" disabled={exporting || visibleTickets.length === 0} onClick={() => void handleExportCollage()}>
              🖼️ {t('导出票夹长图', 'Export Collage')}
            </button>
            <button type="button" className="secondary" disabled={exporting || routeSegments.length === 0} onClick={() => void handleExportRouteMap()}>
              🧭 {t('生成路线图海报', 'Export Route Poster')}
            </button>
          </div>
        </div>
      </div>

      {/* 添加 / 编辑票据表单 */}
      {editorOpen && (
        <div className="card ticket-editor-card">
          <div className="card-heading">
            <h3>{editingId ? t('编辑票据', 'Edit Ticket') : t('手动添加一张出行票据', 'Add Travel Ticket')}</h3>
            <button type="button" className="text-button" onClick={() => setEditorOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
          </div>

          <div className="ticket-kind-chips">
            {TICKET_KINDS.map((kind) => {
              const meta = TICKET_KIND_META[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className={`ticket-kind-chip${draft.kind === kind ? ' is-active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, kind }))}
                >
                  <span>{meta.icon}</span> {meta.label}
                </button>
              );
            })}
          </div>

          <div className="entry-form ticket-editor-grid">
            <label>
              {t('归属旅行（可选）', 'Linked Trip (optional)')}
              <ThemedSelect
                value={draft.tripId ?? ''}
                title={t('选择归属旅行', 'Select Trip')}
                options={[
                  { value: '', label: t('不关联已有旅行（自定义出行名）', 'Custom trip name') },
                  ...trips.map((trip) => ({ value: trip.id, label: `${trip.title} · ${trip.startDate}` })),
                ]}
                onChange={(val) => {
                  const found = trips.find((item) => item.id === val);
                  setDraft((prev) => ({
                    ...prev,
                    tripId: val || null,
                    tripLabel: found ? found.title : prev.tripLabel,
                  }));
                }}
              />
            </label>
            {!draft.tripId && (
              <label>
                {t('出行分组名（用于生成同次出行路线图）', 'Trip Group Name')}
                <input
                  value={draft.tripLabel}
                  placeholder={t('例如：2025 五一天津行', 'e.g. Tianjin Weekend')}
                  onChange={(e) => setDraft((prev) => ({ ...prev, tripLabel: e.target.value }))}
                />
              </label>
            )}
            <label>
              {draft.kind === 'toll' ? t('入口收费站 / 出发城', 'Entry Toll / Origin') : t('出发地 / 车站 / 机场', 'Departure')}
              <input
                value={draft.fromPlace}
                placeholder={kindMeta.fromPlaceholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, fromPlace: e.target.value }))}
              />
            </label>
            <label>
              {draft.kind === 'toll' ? t('出口收费站 / 到达城', 'Exit Toll / Destination') : draft.kind === 'ticket' ? t('景点 / 场馆名称', 'Attraction / Venue') : t('目的地 / 车站 / 机场', 'Destination')}
              <input
                value={draft.toPlace}
                placeholder={kindMeta.toPlaceholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, toPlace: e.target.value }))}
              />
            </label>
            <label>
              {t('出行日期', 'Date')}
              <ThemedDatePicker
                value={draft.date}
                title={t('选择票据日期', 'Select Ticket Date')}
                onChange={(val) => setDraft((prev) => ({ ...prev, date: val }))}
              />
            </label>
            <label>
              {t('出发时间（可选）', 'Time (optional)')}
              <input
                value={draft.time}
                placeholder="如 08:35"
                onChange={(e) => setDraft((prev) => ({ ...prev, time: e.target.value }))}
              />
            </label>
            <label>
              {kindMeta.codeLabel}
              <input
                value={draft.code}
                placeholder={kindMeta.codePlaceholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, code: e.target.value }))}
              />
            </label>
            <label>
              {t('金额 / 票价（元）', 'Price (CNY)')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={priceText}
                placeholder="如 54.5"
                onChange={(e) => setPriceText(e.target.value)}
              />
            </label>
            <label>
              {kindMeta.seatLabel}
              <input
                value={draft.seatOrGate}
                placeholder={kindMeta.seatPlaceholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, seatOrGate: e.target.value }))}
              />
            </label>
            <label>
              {kindMeta.passengerLabel}
              <input
                value={draft.passenger}
                placeholder={kindMeta.passengerPlaceholder}
                onChange={(e) => setDraft((prev) => ({ ...prev, passenger: e.target.value }))}
              />
            </label>
            <label className="ticket-editor-span">
              {t('备注（可选）', 'Note (optional)')}
              <input
                value={draft.note}
                placeholder={t('例如：靠窗风景很好 / 节假日高速免费', 'Optional memory or note')}
                onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>

          <div className="ticket-editor-actions">
            <button type="button" className="primary" onClick={handleSaveTicket}>
              {editingId ? t('保存修改', 'Save Changes') : t('收入票夹', 'Save to Wallet')}
            </button>
          </div>
        </div>
      )}

      {/* 视图 1：拟物票夹列表 */}
      {subView === 'wallet' && (
        visibleTickets.length === 0 ? (
          <div className="card ticket-empty-state">
            <div className="ticket-empty-icons" aria-hidden="true">🚄 ✈️ 🛣️ 🎟️</div>
            <h3>{t('你的出行票夹还是空的', 'Your Ticket Wallet is Empty')}</h3>
            <p className="muted">
              {t(
                '点下方快捷按钮记下本次出行的车票、机票或高速过路费，马上生成拟物票据图片和专属出行路线图！',
                'Record train tickets, flights, or highway tolls to generate skeuomorphic stubs and your trip route map.',
              )}
            </p>
            <div className="ticket-quick-add-row">
              <button type="button" className="primary" onClick={() => openNewEditor('train')}>🚄 记一张高铁票</button>
              <button type="button" className="secondary" onClick={() => openNewEditor('flight')}>✈️ 记一张登机牌</button>
              <button type="button" className="secondary" onClick={() => openNewEditor('toll')}>🛣️ 记一笔过路费</button>
            </div>
          </div>
        ) : (
          <div className="ticket-card-grid">
            {visibleTickets.map((ticket) => {
              const meta = TICKET_KIND_META[ticket.kind];
              return (
                <article key={ticket.id} className={`skeuo-ticket is-${ticket.kind}`}>
                  <div className="skeuo-ticket-head">
                    <span className="skeuo-ticket-badge">{meta.icon} {meta.label}</span>
                    <span className="skeuo-ticket-code">{ticket.code || meta.shortLabel}</span>
                  </div>
                  <div className="skeuo-ticket-route">
                    <strong className="skeuo-place">{ticket.fromPlace || '出发地'}</strong>
                    <span className="skeuo-arrow" aria-hidden="true">
                      {ticket.kind === 'flight' ? '── ✈ ──▶' : '──────▶'}
                    </span>
                    <strong className="skeuo-place">{ticket.toPlace || '目的地'}</strong>
                  </div>
                  <div className="skeuo-ticket-meta">
                    <span>📅 {ticket.date || '-'} {ticket.time}</span>
                    {ticket.seatOrGate && <span>💺 {ticket.seatOrGate}</span>}
                    {ticket.passenger && <span>👤 {ticket.passenger}</span>}
                    {ticket.tripLabel && <span className="skeuo-trip-tag">🏷️ {ticket.tripLabel}</span>}
                  </div>
                  {ticket.note && <p className="skeuo-ticket-note">{ticket.note}</p>}
                  <div className="skeuo-ticket-foot">
                    <strong className="skeuo-price">¥ {Number(ticket.price || 0).toFixed(1)}</strong>
                    <div className="skeuo-actions">
                      <button type="button" className="secondary" disabled={exporting} onClick={() => void handleExportSingle(ticket)}>
                        🖼️ 拟物图
                      </button>
                      <button type="button" className="text-button" onClick={() => openEditEditor(ticket)}>
                        编辑
                      </button>
                      <button type="button" className="text-button" onClick={() => handleDeleteTicket(ticket.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}

      {/* 视图 2：出行路线图 */}
      {subView === 'route' && (
        <div className="card ticket-route-card">
          <div className="card-heading">
            <div>
              <h3>🗺️ {activeGroupTitle} · {t('出行路线图', 'Trip Route Map')}</h3>
              <p className="muted">
                {routeSegments.length > 0
                  ? `共串联 ${routeSegments.length} 程交通 · 参考总里程约 ${totalKm} km · 合计 ¥${totalCost.toFixed(1)}`
                  : '添加包含起终点城市/站名的车票、机票或高速过路费后自动连线'}
              </p>
            </div>
            <button type="button" className="primary" disabled={exporting || routeSegments.length === 0} onClick={() => void handleExportRouteMap()}>
              📥 {t('导出高清路线图海报', 'Export Poster')}
            </button>
          </div>

          <TicketRouteSvgPreview tickets={visibleTickets} />

          {routeSegments.length > 0 && (
            <ol className="ticket-route-timeline">
              {routeSegments.map((seg, idx) => {
                const meta = TICKET_KIND_META[seg.ticket.kind];
                return (
                  <li key={seg.ticket.id}>
                    <span className="ticket-route-step">{idx + 1}</span>
                    <div className="ticket-route-seg-copy">
                      <strong>
                        {meta.icon} {seg.ticket.fromPlace} → {seg.ticket.toPlace}
                        {seg.ticket.code ? ` · ${seg.ticket.code}` : ''}
                      </strong>
                      <small>
                        {seg.ticket.date} {seg.ticket.time} · 约 {seg.distanceKm} km · ¥{Number(seg.ticket.price || 0).toFixed(1)}
                        {seg.ticket.seatOrGate ? ` · ${seg.ticket.seatOrGate}` : ''}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {/* 高清拟物图 / 海报预览与下载弹窗 */}
      {preview && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="dialog ticket-preview-dialog" role="dialog" aria-modal="true" aria-label={preview.title}>
            <div className="card-heading">
              <h3>{preview.title}</h3>
              <button type="button" className="text-button" onClick={() => setPreview(null)}>关闭</button>
            </div>
            <div className="ticket-preview-stage">
              <img src={preview.dataUrl} alt={preview.title} />
            </div>
            <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: '6px 0 0' }}>
              手机端可直接长按上方图片保存到相册，或点击下方按钮下载 PNG 原图
            </p>
            <div className="dialog-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  downloadBlob(preview.blob, preview.fileName);
                  onNotice(`已导出 ${preview.fileName}`);
                }}
              >
                📥 下载高清 PNG
              </button>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
