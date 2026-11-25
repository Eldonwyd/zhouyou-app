import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { cloudApi, RELATION_META, type FriendFootprintCompare } from '../cloud-api';
import { loadNationalMap } from '../map-data';
import type { CityMark } from '../types';
import { TravelAvatar } from './CuteArt';

interface FriendFootprintModalProps {
  targetUserId: string | null;
  myMarks: CityMark[];
  onClose: () => void;
}

export default function FriendFootprintModal({ targetUserId, myMarks, onClose }: FriendFootprintModalProps) {
  const [data, setData] = useState<FriendFootprintCompare | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!targetUserId) {
      setData(null);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    cloudApi.getFriendFootprints(targetUserId)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : '无法加载好友足迹');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [targetUserId]);

  useEffect(() => {
    if (!data || !chartContainerRef.current) return;
    let disposed = false;
    let chart: echarts.ECharts | null = null;

    loadNationalMap().then((geo) => {
      if (disposed || !chartContainerRef.current) return;
      const mapName = 'zhouyou-compare-china';
      if (!echarts.getMap(mapName)) {
        echarts.registerMap(mapName, geo as unknown as Parameters<typeof echarts.registerMap>[1]);
      }
      chart = echarts.init(chartContainerRef.current);

      const myVisitedProvinces = new Set(myMarks.filter((m) => m.visited).map((m) => m.provinceCode));
      const peerVisitedProvinces = new Set(data.peerMarks.filter((m) => m.visited).map((m) => m.provinceCode));
      const sharedPlannedProvinces = new Set(data.stats.sharedPlannedCities.map((c) => c.provinceCode));

      const seriesData = geo.features.map((feature) => {
        const code = String(feature.properties.adcode);
        const name = feature.properties.name;
        const mine = myVisitedProvinces.has(code);
        const theirs = peerVisitedProvinces.has(code);
        const bothPlanned = sharedPlannedProvinces.has(code);

        let color = '#e9e2dc';
        let label = '暂未点亮';
        if (mine && theirs) {
          color = '#eb6b56';
          label = '你们都去过 ✨';
        } else if (theirs) {
          color = '#4ea674';
          label = `${data.peer.nickname} 去过`;
        } else if (mine) {
          color = '#5b9bd5';
          label = '我去过';
        } else if (bothPlanned) {
          color = '#f4c542';
          label = '你们都想去 🌟';
        }
        return { name, value: mine && theirs ? 3 : theirs ? 2 : mine ? 1 : 0, itemStyle: { areaColor: color }, statusLabel: label };
      });

      chart.setOption({
        tooltip: {
          trigger: 'item',
          formatter: (params: { name?: string; data?: { statusLabel?: string } }) =>
            `${params.name || ''}：${params.data?.statusLabel || '暂未点亮'}`,
        },
        series: [
          {
            type: 'map',
            map: mapName,
            roam: false,
            zoom: 1.18,
            selectedMode: false,
            label: { show: false },
            itemStyle: { borderColor: '#ffffff', borderWidth: 0.9 },
            emphasis: { label: { show: true, color: '#3c2e2a', fontSize: 11 }, itemStyle: { areaColor: '#ff9b85' } },
            data: seriesData,
          },
        ],
      });
    }).catch(() => undefined);

    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [data, myMarks]);

  if (!targetUserId) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog footprint-compare-dialog" role="dialog" aria-modal="true" aria-labelledby="compare-map-title">
        <div className="auth-dialog-head">
          <div>
            <span className="city-dialog-pill">🗺️ 好友足迹对比</span>
            <h2 id="compare-map-title">
              {data ? `我和 ${data.peer.nickname} 的中国足迹` : '正在读取好友足迹…'}
            </h2>
          </div>
          <button type="button" className="text-button auth-close-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {loading && <div className="empty-state">正在加载对方点亮的中国地图…</div>}
        {error && <div className="auth-alert auth-alert-error">{error}</div>}

        {data && (
          <>
            <div className="compare-peer-header">
              <TravelAvatar avatarId={data.peer.avatar} nickname={data.peer.nickname} className="avatar" />
              <div>
                <strong>{data.peer.nickname}</strong>
                {data.intimacy && (
                  <span className="intimacy-pill">
                    {RELATION_META[data.intimacy.relationType].emoji} {data.intimacy.customLabel || RELATION_META[data.intimacy.relationType].label}
                  </span>
                )}
                <small>好友码：{data.peer.friendCode}</small>
              </div>
            </div>

            <div className="compare-stats-grid">
              <div className="compare-stat-box highlight">
                <strong>{data.stats.sharedVisitedCount}</strong>
                <span>共同去过城市</span>
              </div>
              <div className="compare-stat-box">
                <strong>{data.stats.peerVisitedCount}</strong>
                <span>{data.peer.nickname} 已点亮</span>
              </div>
              <div className="compare-stat-box">
                <strong>{data.stats.sharedPlannedCount}</strong>
                <span>两人都想去</span>
              </div>
            </div>

            <div className="compare-legend">
              <span><i style={{ background: '#eb6b56' }} /> 共同去过</span>
              <span><i style={{ background: '#4ea674' }} /> {data.peer.nickname} 去过</span>
              <span><i style={{ background: '#5b9bd5' }} /> 我去过</span>
              <span><i style={{ background: '#f4c542' }} /> 共同想去</span>
            </div>

            <div ref={chartContainerRef} className="compare-map-canvas" />

            <div className="compare-city-lists">
              <div>
                <h4>共同去过的城市（{data.stats.sharedVisitedCities.length}）</h4>
                {data.stats.sharedVisitedCities.length ? (
                  <div className="compare-city-chips">
                    {data.stats.sharedVisitedCities.map((c) => <span key={c.id} className="stop-pill">{c.name}</span>)}
                  </div>
                ) : (
                  <small className="auth-hint">还没有共同点亮的城市，快约一场同游吧！</small>
                )}
              </div>
              {data.stats.sharedPlannedCities.length > 0 && (
                <div>
                  <h4>两人都想去的目的地（{data.stats.sharedPlannedCities.length}）</h4>
                  <div className="compare-city-chips">
                    {data.stats.sharedPlannedCities.map((c) => <span key={c.id} className="stop-pill planned">{c.name}</span>)}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
