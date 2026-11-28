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
  compactMode?: boolean;
  readOnlyGallery?: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

interface ExportPreview {
  title: string;
  fileName: string;
  dataUrl: string;
  blob: Blob;
}

/** 定制矢量图标（替代系统彩色 emoji，确保跨平台风格统一精致） */
function TicketSvgIcon({ name, size = 16 }: { name: 'ticket' | 'route' | 'download' | 'plus' | 'train' | 'flight' | 'toll' | 'bus' | 'ferry' | 'stub' | 'collage'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.85, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'ticket':
      return <svg {...common}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.2a1.8 1.8 0 0 0 0 3.6V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.2a1.8 1.8 0 0 0 0-3.6V8Z" /><path d="M14.5 6.5v11" strokeDasharray="2.5 2.5" /></svg>;
    case 'route':
      return <svg {...common}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H13a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h4.5" /></svg>;
    case 'download':
      return <svg {...common}><path d="M12 4v11" /><path d="m7.5 11.5 4.5 4.5 4.5-4.5" /><path d="M4 19h16" /></svg>;
    case 'collage':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 10h18M9 10v10" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'train':
      return <svg {...common}><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 10h14M9 14h.01M15 14h.01M8 17l-2 4M16 17l2 4" /></svg>;
    case 'flight':
      return <svg {...common}><path d="M17.8 19.2 16 11l3.5-3.5a1.5 1.5 0 0 0-2.1-2.1L14 8.8 5.8 7 4 8.8l6.2 3.1-2.8 2.8-2.6-.5-1.3 1.3 3.4 1.8 1.8 3.4 1.3-1.3-.5-2.6 2.8-2.8 3.1 6.2Z" /></svg>;
    case 'toll':
      return <svg {...common}><path d="M4 19 8 5h8l4 14" /><path d="M12 7v3m0 4v3" /></svg>;
    case 'bus':
      return <svg {...common}><rect x="4" y="4" width="16" height="13" rx="2.5" /><path d="M4 11h16M7 17v2M17 17v2M8 14h.01M16 14h.01" /></svg>;
    case 'ferry':
      return <svg {...common}><path d="M3 17l2-7h14l2 7" /><path d="M7 10V6h10v4" /><path d="M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0" /></svg>;
    case 'stub':
    default:
      return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" strokeDasharray="2 2" /></svg>;
  }
}

/** 精致的拟物票夹封面插画（叠放高铁票 + 登机牌剪影） */
function TicketWalletHeroArt() {
  return (
    <svg className="ticket-hero-art" viewBox="0 0 132 88" width="132" height="88" aria-hidden="true">
      <defs>
        <linearGradient id="zyTicketCardA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#89c4f4" />
          <stop offset="65%" stopColor="#d9ecfb" />
          <stop offset="100%" stopColor="#f2cad9" />
        </linearGradient>
        <linearGradient id="zyTicketCardB" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1b4f8a" />
          <stop offset="72%" stopColor="#266cb5" />
          <stop offset="100%" stopColor="#d19a45" />
        </linearGradient>
      </defs>
      {/* 后层登机牌 */}
      <g transform="translate(22 6) rotate(7)">
        <rect x="0" y="0" width="92" height="54" rx="8" fill="#fdfaf3" stroke="rgba(160,130,96,0.4)" strokeWidth="1.2" />
        <path d="M0 8a8 8 0 0 1 8-8h76a8 8 0 0 1 8 8v7H0Z" fill="url(#zyTicketCardB)" />
        <rect x="9" y="24" width="32" height="5" rx="2.5" fill="#2b3d54" opacity="0.72" />
        <rect x="9" y="34" width="48" height="3.5" rx="1.75" fill="#7c8b9c" opacity="0.5" />
        <line x1="68" y1="18" x2="68" y2="50" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="3 2.5" />
        <rect x="74" y="25" width="12" height="19" rx="1.5" fill="#2b3d54" opacity="0.5" />
      </g>
      {/* 前层蓝粉高铁磁票 */}
      <g transform="translate(8 24) rotate(-5)">
        <rect x="0" y="0" width="98" height="56" rx="9" fill="url(#zyTicketCardA)" stroke="rgba(96,154,209,0.65)" strokeWidth="1.2" />
        <rect x="0" y="42" width="98" height="14" rx="0" fill="rgba(42,114,181,0.14)" />
        <circle cx="0" cy="34" r="4.5" fill="var(--surface, #241e19)" />
        <circle cx="98" cy="34" r="4.5" fill="var(--surface, #241e19)" />
        <rect x="11" y="13" width="24" height="6" rx="3" fill="#18324d" opacity="0.82" />
        <rect x="63" y="13" width="24" height="6" rx="3" fill="#18324d" opacity="0.82" />
        <path d="M39 16h20l-4-3" fill="none" stroke="#1b5fa8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="11" y="27" width="38" height="4" rx="2" fill="#b91c1c" opacity="0.72" />
        <circle cx="76" cy="32" r="10" fill="none" stroke="#c93b3b" strokeWidth="1.4" opacity="0.65" />
      </g>
    </svg>
  );
}

/** 实时高清拟物票据预览组件：无需点导出，直接在页面内呈现真实票据图像 */
export function LiveSkeuoTicketImage({
  ticket,
  onClick,
}: {
  ticket: TravelTicket;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState<string>('');
  const ticketKey = `${ticket.id}|${ticket.kind}|${ticket.fromPlace}|${ticket.toPlace}|${ticket.date}|${ticket.time}|${ticket.code}|${ticket.seatOrGate}|${ticket.price}|${ticket.passenger}|${ticket.note}|${ticket.tripLabel}`;

  useEffect(() => {
    let active = true;
    void renderSingleTicketPng(ticket)
      .then(({ dataUrl }) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [ticketKey]);

  return (
    <button
      type="button"
      className="live-skeuo-ticket-frame"
      onClick={onClick}
      aria-label={`预览拟物票据 ${ticket.fromPlace} 到 ${ticket.toPlace}`}
    >
      {src ? (
        <img src={src} alt={`${ticket.fromPlace} → ${ticket.toPlace} ${TICKET_KIND_META[ticket.kind].label}`} loading="lazy" />
      ) : (
        <div className="live-skeuo-ticket-skeleton">正在绘制拟物票据…</div>
      )}
    </button>
  );
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
export function TicketRouteSvgPreview({ tickets }: { tickets: TravelTicket[] }) {
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
                {seg.ticket.code || `${seg.distanceKm}km`}
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

/** 供成就系统直接嵌入的「出行票夹珍藏墙」：直接展示实时高清拟物票据与出行路线图 */
export function AchievementsTicketShowcase({
  trips,
  onNotice,
  onError,
}: {
  trips: Journey[];
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [tickets, setTickets] = useState<TravelTicket[]>(() => loadTicketsFromStorage());
  const [viewMode, setViewMode] = useState<'tickets' | 'route'>('tickets');
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  useEffect(() => {
    const sync = () => setTickets(loadTicketsFromStorage());
    window.addEventListener('storage', sync);
    window.addEventListener('zhouyou-tickets-updated', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('zhouyou-tickets-updated', sync);
    };
  }, []);

  const routeSegments = useMemo(() => extractRouteSegments(tickets), [tickets]);
  const totalCost = useMemo(() => tickets.reduce((sum, item) => sum + (Number(item.price) || 0), 0), [tickets]);
  const totalKm = useMemo(() => routeSegments.reduce((sum, seg) => sum + seg.distanceKm, 0), [routeSegments]);

  async function openSinglePreview(ticket: TravelTicket) {
    setExporting(true);
    try {
      const { blob, dataUrl } = await renderSingleTicketPng(ticket);
      setPreview({
        title: `${ticket.fromPlace} → ${ticket.toPlace}`,
        fileName: `周游票夹-${(ticket.fromPlace || 'ticket').replace(/[\\/:*?"<>|]/g, '_')}.png`,
        dataUrl,
        blob,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : '拟物票据生成失败');
    } finally {
      setExporting(false);
    }
  }

  async function exportCollage() {
    if (!tickets.length) return;
    setExporting(true);
    try {
      const title = trips[0]?.title || '我的出行票夹珍藏';
      const { blob, dataUrl } = await renderTripTicketCollagePng(title, tickets);
      setPreview({ title: '出行票夹合集长图', fileName: '周游出行票夹合集.png', dataUrl, blob });
    } catch (error) {
      onError(error instanceof Error ? error.message : '票夹长图生成失败');
    } finally {
      setExporting(false);
    }
  }

  async function exportRoutePoster() {
    if (!routeSegments.length) return;
    setExporting(true);
    try {
      const { blob, dataUrl } = await renderTripRouteMapPng('我的票夹出行路线图', tickets);
      setPreview({ title: '出行路线图海报', fileName: '周游票夹出行路线图.png', dataUrl, blob });
    } catch (error) {
      onError(error instanceof Error ? error.message : '路线图海报生成失败');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="card achievements-ticket-showcase">
      <div className="ticket-showcase-head">
        <div>
          <span className="eyebrow">TICKET KEEPSAKES</span>
          <h2>{t('出行票夹珍藏墙', 'Ticket Keepsake Wall')}</h2>
          <p className="muted">
            {tickets.length > 0
              ? t(
                `已珍藏 ${tickets.length} 张拟物票据 · 累计 ¥${totalCost.toFixed(1)}${totalKm > 0 ? ` · 约 ${totalKm} km` : ''}`,
                `${tickets.length} skeuomorphic tickets · ¥${totalCost.toFixed(1)}${totalKm > 0 ? ` · ~${totalKm} km` : ''}`,
              )
              : t('在「旅行手账」里的出行票夹记下车票、机票或高速过路费，这里会直接陈列你的拟物票根与路线图。', 'Log train tickets, flights, or tolls in Travel Journal to display skeuomorphic stubs and route maps here.')}
          </p>
        </div>
        {tickets.length > 0 && (
          <div className="ticket-showcase-controls">
            <div className="ticket-view-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={viewMode === 'tickets'} className={viewMode === 'tickets' ? 'is-active' : ''} onClick={() => setViewMode('tickets')}>
                <TicketSvgIcon name="ticket" size={14} /> {t('拟物票根', 'Stubs')}
              </button>
              <button type="button" role="tab" aria-selected={viewMode === 'route'} className={viewMode === 'route' ? 'is-active' : ''} onClick={() => setViewMode('route')}>
                <TicketSvgIcon name="route" size={14} /> {t('路线图', 'Route')}
              </button>
            </div>
            <button type="button" className="secondary ticket-icon-btn" disabled={exporting} onClick={() => void (viewMode === 'tickets' ? exportCollage() : exportRoutePoster())}>
              <TicketSvgIcon name="download" size={14} />
              <span>{viewMode === 'tickets' ? t('保存长图', 'Save Collage') : t('保存海报', 'Save Poster')}</span>
            </button>
          </div>
        )}
      </div>

      {tickets.length === 0 ? (
        <div className="ticket-showcase-empty">
          <TicketWalletHeroArt />
          <div>
            <strong>{t('票夹珍藏墙正等待第一张票根', 'Your Ticket Wall Awaits')}</strong>
            <p className="muted">{t('前往「旅行手账」中的出行票夹添加高铁票、登机牌或高速过路费，即可在此直接预览高清拟物票据。', 'Open Ticket Wallet inside Travel Journal to log tickets and preview skeuomorphic keepsakes right here.')}</p>
          </div>
        </div>
      ) : viewMode === 'tickets' ? (
        <div className="live-skeuo-grid">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="live-skeuo-item">
              <LiveSkeuoTicketImage ticket={ticket} onClick={() => void openSinglePreview(ticket)} />
            </div>
          ))}
        </div>
      ) : (
        <TicketRouteSvgPreview tickets={tickets} />
      )}

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
              手机端可长按上方图片保存，或点击下方按钮下载 PNG 原图
            </p>
            <div className="dialog-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button
                type="button"
                className="primary ticket-icon-btn"
                onClick={() => {
                  downloadBlob(preview.blob, preview.fileName);
                  onNotice(`已导出 ${preview.fileName}`);
                }}
              >
                <TicketSvgIcon name="download" size={15} />
                <span>下载高清 PNG</span>
              </button>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const KIND_ICON_MAP: Record<TicketKind, 'train' | 'flight' | 'toll' | 'bus' | 'ferry' | 'stub'> = {
  train: 'train',
  flight: 'flight',
  toll: 'toll',
  bus: 'bus',
  ferry: 'ferry',
  ticket: 'stub',
};

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
    } else {
      setSelectedGroup('all');
    }
  }, [initialTripId]);

  const persistTickets = (next: TravelTicket[]) => {
    const sorted = [...next].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    setTickets(sorted);
    saveTicketsToStorage(sorted);
    window.dispatchEvent(new Event('zhouyou-tickets-updated'));
  };

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
    onNotice(editingId ? t('票据已更新', 'Ticket updated') : t('已收入出行票夹，并同步至成就珍藏墙', 'Saved to Ticket Wallet & Achievements'));
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
        title: `${ticket.fromPlace} → ${ticket.toPlace}`,
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
        title: `${activeGroupTitle} · 票夹合集`,
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
        title: `${activeGroupTitle} · 出行路线图`,
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
      <div className="card ticket-wallet-hero is-refined">
        <div className="ticket-wallet-banner">
          <div className="ticket-wallet-banner-copy">
            <span className="eyebrow">TICKET WALLET</span>
            <h2>{t('出行票夹', 'Ticket Wallet')}</h2>
            <p className="muted">
              {t(
                '收纳车票、登机牌与高速过路费，实时生成高清拟物票根与出行路线图，并同步陈列在成就系统。',
                'Collect train tickets, boarding passes, and highway tolls with live skeuomorphic stubs & route maps.',
              )}
            </p>
          </div>
          <TicketWalletHeroArt />
        </div>

        <div className="ticket-wallet-metrics-bar">
          <div className="ticket-metric-item">
            <span className="ticket-metric-label">{t('票据', 'Tickets')}</span>
            <strong>{visibleTickets.length}<small>张</small></strong>
          </div>
          <span className="ticket-metric-divider" aria-hidden="true" />
          <div className="ticket-metric-item">
            <span className="ticket-metric-label">{t('合计花费', 'Total')}</span>
            <strong>¥{totalCost.toFixed(1)}</strong>
          </div>
          <span className="ticket-metric-divider" aria-hidden="true" />
          <div className="ticket-metric-item">
            <span className="ticket-metric-label">{t('估算里程', 'Distance')}</span>
            <strong>{totalKm > 0 ? totalKm : '--'}<small>{totalKm > 0 ? 'km' : ''}</small></strong>
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
              <TicketSvgIcon name="ticket" size={14} /> {t('拟物票夹', 'Tickets')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subView === 'route'}
              className={subView === 'route' ? 'is-active' : ''}
              onClick={() => setSubView('route')}
            >
              <TicketSvgIcon name="route" size={14} /> {t('出行路线图', 'Route Map')}
            </button>
          </div>
          <div className="ticket-export-actions">
            <button type="button" className="primary ticket-icon-btn" onClick={() => openNewEditor('train')}>
              <TicketSvgIcon name="plus" size={14} />
              <span>{t('记一张票', 'Add Ticket')}</span>
            </button>
            <button type="button" className="secondary ticket-icon-btn" disabled={exporting || visibleTickets.length === 0} onClick={() => void handleExportCollage()}>
              <TicketSvgIcon name="collage" size={14} />
              <span>{t('合集长图', 'Collage')}</span>
            </button>
            <button type="button" className="secondary ticket-icon-btn" disabled={exporting || routeSegments.length === 0} onClick={() => void handleExportRouteMap()}>
              <TicketSvgIcon name="download" size={14} />
              <span>{t('路线海报', 'Route Poster')}</span>
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
                  <TicketSvgIcon name={KIND_ICON_MAP[kind]} size={14} />
                  <span>{meta.label}</span>
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

      {/* 视图 1：直接实时预览高清拟物票据 */}
      {subView === 'wallet' && (
        visibleTickets.length === 0 ? (
          <div className="card ticket-empty-state">
            <TicketWalletHeroArt />
            <h3>{t('出行票夹还是空的', 'Your Ticket Wallet is Empty')}</h3>
            <p className="muted">
              {t(
                '记下本次出行的车票、机票或高速过路费，马上直接呈现高清拟物票据与专属出行路线图。',
                'Record train tickets, flights, or highway tolls to preview skeuomorphic stubs and your trip route map.',
              )}
            </p>
            <div className="ticket-quick-add-row">
              <button type="button" className="primary ticket-icon-btn" onClick={() => openNewEditor('train')}>
                <TicketSvgIcon name="train" size={15} /><span>记一张高铁票</span>
              </button>
              <button type="button" className="secondary ticket-icon-btn" onClick={() => openNewEditor('flight')}>
                <TicketSvgIcon name="flight" size={15} /><span>记一张登机牌</span>
              </button>
              <button type="button" className="secondary ticket-icon-btn" onClick={() => openNewEditor('toll')}>
                <TicketSvgIcon name="toll" size={15} /><span>记一笔过路费</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="live-skeuo-grid">
            {visibleTickets.map((ticket) => (
              <article key={ticket.id} className="live-skeuo-item">
                <LiveSkeuoTicketImage ticket={ticket} onClick={() => void handleExportSingle(ticket)} />
                <div className="live-skeuo-item-bar">
                  <span className="live-skeuo-item-tag">
                    <TicketSvgIcon name={KIND_ICON_MAP[ticket.kind]} size={13} />
                    <span>{ticket.tripLabel || TICKET_KIND_META[ticket.kind].label}</span>
                  </span>
                  <div className="skeuo-actions">
                    <button type="button" className="secondary ticket-icon-btn" disabled={exporting} onClick={() => void handleExportSingle(ticket)}>
                      <TicketSvgIcon name="download" size={13} /><span>保存原图</span>
                    </button>
                    <button type="button" className="text-button" onClick={() => openEditEditor(ticket)}>编辑</button>
                    <button type="button" className="text-button" onClick={() => handleDeleteTicket(ticket.id)}>删除</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {/* 视图 2：出行路线图 */}
      {subView === 'route' && (
        <div className="card ticket-route-card">
          <div className="card-heading">
            <div>
              <h3>{activeGroupTitle} · {t('出行路线图', 'Trip Route Map')}</h3>
              <p className="muted">
                {routeSegments.length > 0
                  ? `共串联 ${routeSegments.length} 程交通 · 参考总里程约 ${totalKm} km · 合计 ¥${totalCost.toFixed(1)}`
                  : '添加包含起终点城市/站名的车票、机票或高速过路费后自动连线'}
              </p>
            </div>
            <button type="button" className="primary ticket-icon-btn" disabled={exporting || routeSegments.length === 0} onClick={() => void handleExportRouteMap()}>
              <TicketSvgIcon name="download" size={14} />
              <span>{t('保存路线海报', 'Save Poster')}</span>
            </button>
          </div>

          <TicketRouteSvgPreview tickets={visibleTickets} />

          {routeSegments.length > 0 && (
            <ol className="ticket-route-timeline">
              {routeSegments.map((seg, idx) => (
                <li key={seg.ticket.id}>
                  <span className="ticket-route-step">{idx + 1}</span>
                  <div className="ticket-route-seg-copy">
                    <strong>
                      {seg.ticket.fromPlace} → {seg.ticket.toPlace}
                      {seg.ticket.code ? ` · ${seg.ticket.code}` : ''}
                    </strong>
                    <small>
                      {seg.ticket.date} {seg.ticket.time} · 约 {seg.distanceKm} km · ¥{Number(seg.ticket.price || 0).toFixed(1)}
                      {seg.ticket.seatOrGate ? ` · ${seg.ticket.seatOrGate}` : ''}
                    </small>
                  </div>
                </li>
              ))}
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
                className="primary ticket-icon-btn"
                onClick={() => {
                  downloadBlob(preview.blob, preview.fileName);
                  onNotice(`已导出 ${preview.fileName}`);
                }}
              >
                <TicketSvgIcon name="download" size={15} />
                <span>下载高清 PNG</span>
              </button>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
