import { useEffect, useMemo, useState } from 'react';
import {
  cloudApi,
  type CloudSelfUser,
  type FriendItem,
  type TravelGroupSummary,
} from '../cloud-api';
import { getCloudPlanMetaMap } from '../cloud-sync';
import type { AiTravelPlan } from '../planner-types';
import { PACKING_CATEGORY_LABELS } from './PlannerPackingList';
import { mergeTicketPlanItems, resolveTicketReminderSchedule } from '../planner-ticket-display';
import { plannerDisplayText } from '../planner-display';
import { fireSystemNotification, playNotificationChime, readNotificationPrefs } from '../notification-prefs';

export type TripSharePayloadKind = 'packing' | 'reminder';

export interface TripSharePayload {
  kind: TripSharePayloadKind;
  planId: string;
  planTitle: string;
  title: string;
  subtitle: string;
  items: Array<{ text: string; checked?: boolean; meta?: string }>;
  plainText: string;
}

/** 构造行前准备清单的发送数据与纯文本摘要。 */
export function buildPackingShareData(plan: AiTravelPlan): TripSharePayload {
  const rawItems = plan.packingList?.items ?? [];
  const checkedCount = rawItems.filter((item) => item.checked).length;
  const startDate = plan.content.days[0]?.date ?? '';
  const endDate = plan.content.days.at(-1)?.date ?? '';
  const dateRange = startDate && endDate && startDate !== endDate ? `${startDate} 至 ${endDate}` : startDate;
  const items = rawItems.map((item) => ({
    text: item.name,
    checked: item.checked,
    meta: [PACKING_CATEGORY_LABELS[item.category], item.note].filter(Boolean).join(' · '),
  }));
  const lines = [
    `🧳 行前准备清单 · ${plan.content.title}`,
    dateRange ? `行程日期：${dateRange}（已准备 ${checkedCount}/${rawItems.length}）` : `已准备 ${checkedCount}/${rawItems.length}`,
    ...rawItems.map((item) => `${item.checked ? '☑' : '☐'} [${PACKING_CATEGORY_LABELS[item.category]}] ${item.name}${item.note ? `（${item.note}）` : ''}`),
  ];
  return {
    kind: 'packing',
    planId: plan.id,
    planTitle: plan.content.title,
    title: `${plan.content.title} · 行前准备清单`,
    subtitle: `${dateRange ? `${dateRange} · ` : ''}共 ${rawItems.length} 项（已准备 ${checkedCount} 项）`,
    items,
    plainText: lines.join('\n'),
  };
}

/** 构造出行提醒的发送数据（包含出发日期、未购买/待抢票提醒、预订信息与注意事项）。 */
export function buildTripReminderShareData(plan: AiTravelPlan, warnings: string[] = []): TripSharePayload {
  const startDate = plan.content.days[0]?.date ?? '';
  const endDate = plan.content.days.at(-1)?.date ?? '';
  const dateRange = startDate && endDate && startDate !== endDate ? `${startDate} 至 ${endDate}` : startDate;
  const items: Array<{ text: string; meta?: string }> = [];

  if (dateRange) {
    const firstWeather = plan.content.days[0]?.weather ? plannerDisplayText(plan.content.days[0].weather, plan.content) : '';
    items.push({
      text: `出发日期：${dateRange}`,
      meta: firstWeather ? `首日天气：${firstWeather}` : undefined,
    });
  }

  const unpurchased = (plan.bookings ?? []).filter(
    (b) => (b.kind === 'train' || b.kind === 'flight') && b.purchaseStatus === 'unpurchased',
  );
  for (const b of unpurchased) {
    const route = [b.fromLocation, b.toLocation].filter(Boolean).join(' → ');
    items.push({
      text: `待购票：${b.code || (b.kind === 'flight' ? '航班' : '车次')} ${route}`.trim(),
      meta: `${b.date} ${b.startTime}—${b.endTime}`,
    });
  }

  const mergedTickets = mergeTicketPlanItems(plan);
  for (const item of mergedTickets) {
    const reminder = plan.ticketReminders?.[item.activityId];
    if (!reminder?.enabled) continue;
    const schedule = resolveTicketReminderSchedule(item, reminder);
    items.push({
      text: `抢票提醒：${plannerDisplayText(item.title)}`,
      meta: schedule.dateStr
        ? `${schedule.dateStr} ${schedule.timeStr} 开售（提前 ${reminder.leadMinutes} 分钟）`
        : `使用日期 ${item.travelDate}`,
    });
  }

  const warningList = warnings.length > 0 ? warnings : (plan.content.warnings ?? []);
  for (const w of warningList) {
    const clean = plannerDisplayText(w, plan.content).trim();
    if (clean) items.push({ text: clean });
  }

  const packingLeft = (plan.packingList?.items ?? []).filter((item) => !item.checked);
  if (packingLeft.length > 0) {
    const preview = packingLeft.slice(0, 5).map((item) => item.name).join('、');
    items.push({
      text: `尚有 ${packingLeft.length} 项行前物品未勾选`,
      meta: packingLeft.length > 5 ? `${preview} 等` : preview,
    });
  }

  const lines = [
    `📌 出行提醒 · ${plan.content.title}`,
    ...items.map((entry, idx) => `${idx + 1}. ${entry.text}${entry.meta ? `（${entry.meta}）` : ''}`),
  ];

  return {
    kind: 'reminder',
    planId: plan.id,
    planTitle: plan.content.title,
    title: `${plan.content.title} · 出行提醒`,
    subtitle: `${dateRange ? `${dateRange} · ` : ''}共 ${items.length} 条提醒`,
    items,
    plainText: lines.join('\n'),
  };
}

interface TripReminderShareModalProps {
  data: TripSharePayload;
  cloudUser: CloudSelfUser | null;
  onOpenAuth?: () => void;
  onClose: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export default function TripReminderShareModal({
  data,
  cloudUser,
  onOpenAuth,
  onClose,
  onNotice,
  onError,
}: TripReminderShareModalProps) {
  const [groups, setGroups] = useState<TravelGroupSummary[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [loading, setLoading] = useState(Boolean(cloudUser));
  const [note, setNote] = useState('');
  const [sentTargets, setSentTargets] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState('');

  const boundGroupId = useMemo(() => getCloudPlanMetaMap()[data.planId]?.groupId ?? '', [data.planId]);

  useEffect(() => {
    if (!cloudUser) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([cloudApi.listGroups(), cloudApi.getSocialOverview()])
      .then(([gRes, sRes]) => {
        if (!active) return;
        const sortedGroups = [...(gRes.groups ?? [])].sort(
          (a, b) => Number(b.id === boundGroupId) - Number(a.id === boundGroupId),
        );
        setGroups(sortedGroups);
        setFriends(sRes.friends ?? []);
      })
      .catch((err) => {
        if (active) onError(err instanceof Error ? err.message : '加载群聊与好友列表失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [cloudUser, boundGroupId, onError]);

  async function sendToTarget(roomType: 'group' | 'dm', targetId: string, label: string) {
    const key = `${roomType}:${targetId}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const textSummary = note.trim() || `${data.title}（${data.subtitle}）`;
      await cloudApi.sendChatMessage(roomType, targetId, {
        msgType: data.kind,
        textContent: textSummary,
        payload: {
          planId: data.planId,
          planTitle: data.planTitle,
          title: data.title,
          subtitle: data.subtitle,
          items: data.items.slice(0, 40),
          note: note.trim(),
        },
      });
      setSentTargets((prev) => ({ ...prev, [key]: true }));
      onNotice(`已将${data.kind === 'packing' ? '行前准备清单' : '出行提醒'}发送给「${label}」并推送通知。`);
    } catch (err) {
      onError(err instanceof Error ? err.message : '发送失败，请重试');
    } finally {
      setBusyKey('');
    }
  }

  function handleCopyText() {
    const fullText = note.trim() ? `${note.trim()}\n\n${data.plainText}` : data.plainText;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(fullText)
        .then(() => onNotice('已复制文本内容，可直接粘贴发到微信 / QQ 群或个人。'))
        .catch(() => onError('复制失败，请手动选择内容复制'));
    } else {
      onError('当前环境不支持自动复制');
    }
  }

  function handleSelfLocalRemind() {
    const prefs = readNotificationPrefs();
    if (prefs.sound) playNotificationChime();
    fireSystemNotification(data.title, note.trim() || data.subtitle, undefined, `zhouyou-self-${data.planId}`);
    onNotice(`已发送本机提醒：${data.title}`);
  }

  const label = data.kind === 'packing' ? '行前准备清单' : '出行提醒';

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyKey) onClose();
      }}
    >
      <section className="dialog planner-editor trip-share-dialog" role="dialog" aria-modal="true" aria-label={`发送${label}`}>
        <div className="card-heading">
          <div>
            <h2>{data.kind === 'packing' ? '🧳' : '📌'} 发送{label}到群里或个人</h2>
            <p className="muted">发送到行程群或好友私聊后，对方将同时收到聊天卡片与通知提醒。</p>
          </div>
          <button type="button" className="text-button" disabled={Boolean(busyKey)} onClick={onClose}>关闭</button>
        </div>

        <div className="trip-share-preview">
          <strong>{data.title}</strong>
          <small className="muted">{data.subtitle}</small>
          {data.items.length > 0 ? (
            <ul>
              {data.items.slice(0, 6).map((item, idx) => (
                <li key={`${item.text}-${idx}`}>
                  {data.kind === 'packing' ? (item.checked ? '☑ ' : '☐ ') : '• '}
                  <span>{item.text}</span>
                  {item.meta && <small className="muted">（{item.meta}）</small>}
                </li>
              ))}
              {data.items.length > 6 && (
                <li className="muted">…… 还有 {data.items.length - 6} 项</li>
              )}
            </ul>
          ) : (
            <p className="muted">当前暂无明细条目，可补充一句附言后发送。</p>
          )}
        </div>

        <label className="trip-share-note-field">
          <span>附言（可选）</span>
          <input
            type="text"
            maxLength={120}
            placeholder={data.kind === 'packing' ? '例如：大家出发前对照清单检查一下证件和充电宝～' : '例如：记得定好闹钟提前出发，注意天气变化～'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {!cloudUser ? (
          <div className="trip-share-login-hint">
            <p className="muted">登录周游账号后，可直接一键发送到行程群聊或好友私聊并触发通知提醒。</p>
            {onOpenAuth && (
              <button type="button" className="primary" onClick={() => { onClose(); onOpenAuth(); }}>
                登录周游账号
              </button>
            )}
          </div>
        ) : loading ? (
          <p className="muted">正在加载行程群与好友列表…</p>
        ) : (
          <div className="trip-share-targets">
            <div className="trip-share-section">
              <h4>👥 发送到行程群（群里）</h4>
              {groups.length === 0 ? (
                <p className="muted">还没有加入行程群，可在攻略顶部「绑定行程群」创建或加入。</p>
              ) : (
                <div className="trip-share-list">
                  {groups.map((g) => {
                    const key = `group:${g.id}`;
                    const sent = Boolean(sentTargets[key]);
                    return (
                      <div className="trip-share-row" key={g.id}>
                        <div>
                          <strong>
                            {g.name}
                            {g.id === boundGroupId && <span className="trip-share-bound-tag">当前行程群</span>}
                          </strong>
                          <small className="muted">{g.memberCount} 位成员</small>
                        </div>
                        <button
                          type="button"
                          className={sent ? 'secondary' : 'primary'}
                          disabled={Boolean(busyKey)}
                          onClick={() => void sendToTarget('group', g.id, g.name)}
                        >
                          {busyKey === key ? '发送中…' : sent ? '✓ 已发到群里' : '发到群里'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="trip-share-section">
              <h4>👤 发送给好友 / 个人</h4>
              <div className="trip-share-list">
                <div className="trip-share-row">
                  <div>
                    <strong>发给自己（个人备忘）</strong>
                    <small className="muted">保存到个人私聊记录，方便随时查看</small>
                  </div>
                  <button
                    type="button"
                    className={sentTargets[`dm:${cloudUser.id}`] ? 'secondary' : 'primary'}
                    disabled={Boolean(busyKey)}
                    onClick={() => void sendToTarget('dm', cloudUser.id, '个人备忘')}
                  >
                    {busyKey === `dm:${cloudUser.id}` ? '发送中…' : sentTargets[`dm:${cloudUser.id}`] ? '✓ 已发给自己' : '发给自己'}
                  </button>
                </div>
                {friends.map((f) => {
                  const key = `dm:${f.user.id}`;
                  const sent = Boolean(sentTargets[key]);
                  return (
                    <div className="trip-share-row" key={f.user.id}>
                      <div>
                        <strong>{f.user.nickname}</strong>
                        <small className="muted">周游号 {f.user.friendCode}</small>
                      </div>
                      <button
                        type="button"
                        className={sent ? 'secondary' : 'primary'}
                        disabled={Boolean(busyKey)}
                        onClick={() => void sendToTarget('dm', f.user.id, f.user.nickname)}
                      >
                        {busyKey === key ? '发送中…' : sent ? '✓ 已发送' : '发给好友'}
                      </button>
                    </div>
                  );
                })}
                {friends.length === 0 && (
                  <p className="muted">暂无好友，可在「同行旅伴」页添加好友后直接私聊发送。</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="dialog-actions trip-share-footer">
          <button type="button" className="secondary" onClick={handleCopyText}>
            📋 复制文本（发微信 / QQ）
          </button>
          <button type="button" className="secondary" onClick={handleSelfLocalRemind}>
            🔔 本机通知自己
          </button>
          <button type="button" className="text-button" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  );
}
