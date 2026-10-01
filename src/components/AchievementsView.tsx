import { useEffect, useRef, useState } from 'react';
import type { Badge, CityMark, DayEntry, Journey } from '../types';
import { downloadBlob } from '../utils';

interface AchievementsViewProps {
  marks: CityMark[];
  entries: DayEntry[];
  trips: Journey[];
  badges: Badge[];
  onSaveBadge: (badge: Badge) => Promise<void>;
  onOpenEntry: (entry: DayEntry) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const PRESET_BADGES = [
  { title: '初次远行', symbol: '✦', threshold: 1 },
  { title: '城市漫游者', symbol: '✺', threshold: 5 },
  { title: '旅行收藏家', symbol: '◆', threshold: 10 },
];

async function drawBadgePoster(title: string, symbol: string, image: Blob | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成海报');
  context.fillStyle = '#102c3b';
  context.fillRect(0, 0, 900, 1200);
  context.fillStyle = '#f5c94e';
  context.fillRect(72, 72, 756, 1056);
  context.fillStyle = '#102c3b';
  context.fillRect(94, 94, 712, 1012);
  if (image) {
    const bitmap = await createImageBitmap(image);
    const size = 500;
    context.save();
    context.beginPath();
    context.arc(450, 455, 250, 0, Math.PI * 2);
    context.clip();
    context.drawImage(bitmap, 200, 205, size, size);
    context.restore();
    bitmap.close();
  } else {
    context.fillStyle = '#f5c94e';
    context.font = '240px serif';
    context.textAlign = 'center';
    context.fillText(symbol, 450, 540);
  }
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.font = 'bold 64px sans-serif';
  context.fillText(title.slice(0, 12), 450, 860);
  context.fillStyle = '#b9d0d8';
  context.font = '30px sans-serif';
  context.fillText('旅行足迹 · 我的城市记忆', 450, 1000);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('海报生成失败');
  return blob;
}

function CustomBadgeCard({ badge, onShare, onOpenEntry, linkedEntry }: { badge: Badge; onShare: () => void; onOpenEntry: (entry: DayEntry) => void; linkedEntry?: DayEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!badge.image) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(badge.image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [badge.image]);
  return <div className="badge-card"><div className="badge-art">{url ? <img src={url} alt="" /> : '✧'}</div><h3>{badge.title}</h3><div className="badge-actions"><button className="text-button" onClick={onShare}>生成海报</button>{linkedEntry && <button className="text-button" onClick={() => onOpenEntry(linkedEntry)}>查看高光</button>}</div></div>;
}

/** Date strings are expanded in UTC so overlapping journeys count each day once. */
function uniqueTravelDates(trips: Journey[], entries: DayEntry[]): string[] {
  const days = new Set<string>();
  for (const trip of trips) {
    const start = Date.parse(`${trip.startDate}T00:00:00Z`);
    const end = Date.parse(`${trip.endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    for (let cursor = start, count = 0; cursor <= end && count < 3660; cursor += 86_400_000, count += 1) {
      days.add(new Date(cursor).toISOString().slice(0, 10));
    }
  }
  // City photos and notes are real travel memories even before a journey is
  // created. Their dates enter the same set, so later grouping adds no days.
  for (const entry of entries) if (entry.tripId === null) days.add(entry.date);
  return [...days].sort();
}

export default function AchievementsView({ marks, entries, trips, badges, onSaveBadge, onOpenEntry, onError, onNotice }: AchievementsViewProps) {
  const [title, setTitle] = useState('');
  const [linkedEntryId, setLinkedEntryId] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const visited = marks.filter((mark) => mark.visited);
  const dates = uniqueTravelDates(trips.filter((trip) => trip.status !== 'planned'), entries);
  const travelDays = dates.length;
  const yearly = Object.entries(dates.reduce<Record<string, number>>((counts, date) => {
    counts[date.slice(0, 4)] = (counts[date.slice(0, 4)] || 0) + 1;
    return counts;
  }, {})).sort(([yearA], [yearB]) => yearA.localeCompare(yearB));
  const highlights = entries.filter((entry) => entry.highlight);

  async function createBadge(): Promise<void> {
    if (!title.trim()) { onError('请填写徽章名称'); return; }
    const image = imageInputRef.current?.files?.[0] ?? null;
    try {
      await onSaveBadge({ id: crypto.randomUUID(), title: title.trim(), linkedEntryId: linkedEntryId || null, image, createdAt: new Date().toISOString() });
      setTitle('');
      setLinkedEntryId('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      onNotice('专属徽章已创建。');
    } catch (error) { onError(error instanceof Error ? error.message : '徽章保存失败'); }
  }

  async function shareBadge(badgeTitle: string, symbol: string, image: Blob | null): Promise<void> {
    try { downloadBlob(await drawBadgePoster(badgeTitle, symbol, image), `${badgeTitle}-旅行徽章.png`); }
    catch (error) { onError(error instanceof Error ? error.message : '海报生成失败'); }
  }

  return <div className="content-page"><div className="section-heading"><div><span className="eyebrow">MILESTONES</span><h1>旅途成就</h1><p>每一座城市和每一个旅行日，都会留在足迹里。</p></div></div>
    <div className="metric-grid"><div className="metric-card"><span>已去城市</span><strong>{visited.length}</strong><small>座城市</small></div><div className="metric-card"><span>累计旅行天数</span><strong>{travelDays}</strong><small>个不同日期</small></div><div className="metric-card"><span>高光时刻</span><strong>{highlights.length}</strong><small>篇记录</small></div></div>
    <section className="card"><div className="card-heading"><h2>旅行时间轴</h2><span>按年浏览</span></div>{yearly.length ? <div className="timeline">{yearly.map(([year, count]) => <div className="timeline-item" key={year}><i /><strong>{year}</strong><span>{count} 个旅行日</span></div>)}</div> : <p className="muted">还没有已去城市的旅行记录。</p>}</section>
    <section className="card"><div className="card-heading"><h2>旅行徽章</h2><span>可下载为海报分享</span></div><div className="badge-grid">{PRESET_BADGES.map((badge) => <div className={`badge-card ${visited.length >= badge.threshold ? '' : 'locked'}`} key={badge.title}><div className="badge-art">{badge.symbol}</div><h3>{badge.title}</h3><p>{visited.length >= badge.threshold ? '已解锁' : `去过 ${badge.threshold} 座城市解锁`}</p>{visited.length >= badge.threshold && <button className="text-button" onClick={() => void shareBadge(badge.title, badge.symbol, null)}>生成海报</button>}</div>)}{badges.map((badge) => <CustomBadgeCard key={badge.id} badge={badge} linkedEntry={entries.find((entry) => entry.id === badge.linkedEntryId)} onOpenEntry={onOpenEntry} onShare={() => void shareBadge(badge.title, '✧', badge.image)} />)}</div>
      <div className="badge-creator"><h3>创建专属徽章</h3><div className="entry-form"><label>徽章名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={12} placeholder="例如：山海之间" /></label><label>徽章图片<input type="file" accept="image/*" ref={imageInputRef} /></label><label>关联高光记录<select value={linkedEntryId} onChange={(event) => setLinkedEntryId(event.target.value)}><option value="">不关联</option>{highlights.map((entry) => <option key={entry.id} value={entry.id}>{marks.find((mark) => mark.id === entry.cityCode)?.name ?? '城市'} · {entry.date}</option>)}</select></label></div><button className="primary" onClick={() => void createBadge()}>创建徽章</button></div>
    </section>
  </div>;
}
