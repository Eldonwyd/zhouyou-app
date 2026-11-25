import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, FormEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import FinanceView from './PlanView';
import PlannerCalendarExport from './PlannerCalendarExport';
import PlannerTripTimeline, { plannerDayAnchor } from './PlannerTripTimeline';
import RequestFields, { PlannerLuggageField } from './PlannerRequestFields';
import PlannerConversation from './PlannerConversation';
import PlannerMap from './PlannerMap';
import RichAiText from './RichAiText';
import PlannerPhotoSettings from './PlannerPhotoSettings';
import PlannerAiSettings, { PlannerAiStatusBar, normalizeAiStatus, type AiStatus } from './PlannerAiSettings';
import PlannerPlanCard from './PlannerPlanCard';
import PlannerPackingList from './PlannerPackingList';
import { PlannerBookingDialog, PlannerBookingsSummary } from './PlannerBookingImporter';
import { applyBookingToPlan, bookingArrivalDate, bookingConnectionTimes, emptyBookingDraft, hotelBookingForDay, isTransportBooking, pendingTransportLegs, plannerContentForAi, reconcileBookedContent, removeBookingFromPlan } from '../planner-booking';
import { TravelIcon } from './TravelArt';
import { CuteTransportIcon, DirectTransferBridge, GapTransferConnector, TransferBridgeCard, TransferOptionRow } from './PlannerTransferConnector';
import PlannerXhsImporter, { type XhsParseResponse } from './PlannerXhsImporter';
import PlannerExternalAiImporter from './PlannerExternalAiImporter';
import CityGuideLinks from './CityGuideLinks';
import { exportOfflineRoadbook } from '../planner-html-export';
import {
  DEFAULT_XHS_REFERENCE_MODE,
  MAX_XHS_REFERENCES,
  XHS_PLACE_KIND_LABELS,
  XHS_REFERENCE_MODE_OPTIONS,
  buildXhsInsertPrompt,
  compactXhsReference,
  extractXhsUrlsFromText,
  mergeXhsReferences,
  referencesToWishlist,
  selectedPlacesFromRefs,
  summarizeXhsForMessage,
  xiaohongshuSearchUrl,
} from '../planner-xhs';
import { plannerLuggageNoteText } from '../planner-luggage';
import { applyBookingToLedger, removeBookingFromLedger } from '../finance';
import { BUDGET_CATEGORIES, emptyAmounts } from '../types';
import type {
  AiTravelPlan,
  BookingRecord,
  DestinationRecommendation,
  PackingList,
  PlannerActivity,
  PlannerContent,
  PlannerCost,
  PlannerPhoto,
  PlannerPreferences,
  PlannerRequest,
  UnvisitedPopularSight,
  PlannerSource,
  PlannerMessage,
  PlannerTransferModeKind,
  PlannerTransferOption,
  TicketReminderSetting,
  WishlistPlace,
  XhsReference,
  XhsReferenceMode,
} from '../planner-types';
import {
  addPlannerDays,
  updatePlannerDates,
  calculatePlannerBudget,
  enforcePlannerScope,
  freshPlannerRequest,
  PLANNER_PERIODS,
  plannerActivitiesByTime,
  plannerConflicts,
  plannerDurationLabel,
  plannerParty,
  plannerFillEstimates,
  revisePlanner,
  validatePlannerContent,
  validatePlannerRequest,
  plannerSuggestions,
  resolvePlannerChoice,
} from '../planner-domain';
import {
  collectMissingLegTransfers,
  formatTransferOption,
  isIntraCityTransferCard,
  plannerDisplayText,
  plannerExportText,
  plannerGapTransfer,
  plannerTransferDisplay,
  plannerTransferOptions,
  plannerTransportActivityKey,
  plannerActivityScenicGrade,
  splitAnswerLinks,
} from '../planner-display';
import { plannerShortStage } from '../planner-stage';
import { plannerXiaohongshuSearchUrl } from '../planner-photo';
import { getPlannerPhotoBlob, savePlannerMapPositions, savePlannerPhotoBlob, type recordPlannerJournalVisit } from '../db';
import { getCloudPlannerPhotoUrl } from '../cloud-api';
import { markCloudRecordDirty } from '../cloud-sync';
import { plannerJournalActivityKey, plannerJournalCity, plannerJournalVisitFor } from '../planner-journal';
import { mapAppLabel, mapPlaceLinks, openMapAppPlace, openXiaohongshuSearch } from '../external-app-links';
import { PLANNER_API_ORIGIN_EVENT, plannerApiUrl } from '../api-base';
import { buildMobileAiStatus, isDesktopFreeTrialEnabled, isMobileNativeAiActive } from '../mobile-ai-runtime';
import { plannerApi } from '../planner-api';
import { ticketPlanSignature } from '../planner-ticket-signature';
import {
  DEFAULT_TICKET_REMINDER_LEAD_MINUTES,
  formatReminderClock,
  getUpcomingTicketUrgency,
  isTicketReminderUrgent,
  mergeTicketPlanItems,
  resolveTicketReminderSchedule,
} from '../planner-ticket-display';
import {
  getSystemNotificationPermission,
  readNotificationPrefs,
  requestSystemNotificationPermission,
  writeNotificationPrefs,
} from '../notification-prefs';
import { BUDGET_LABELS, type TripPlan } from '../types';
import { createLocalId, currency, downloadBlob } from '../utils';
import { useI18n } from '../i18n';
import { isWebTourMode, type TourRestrictedFeature } from '../web-tour';
import type { CloudSelfUser } from '../cloud-api';
import PlanCollabBar from './PlanCollabBar';
import TripReminderShareModal, {
  buildPackingShareData,
  buildTripReminderShareData,
  type TripSharePayload,
} from './TripReminderShareModal';

const isNativeMobileApp = () => Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
);

interface PlannerWorkspaceProps extends ComponentProps<typeof FinanceView> {
  visible: boolean;
  onReturnToPlanner: () => void;
  aiPlans: AiTravelPlan[];
  preferences: PlannerPreferences | undefined;
  provinceIntent: { name: string; token: number } | null;
  onSaveAi: (plan: AiTravelPlan, expectedVersion: number | null) => Promise<void>;
  onSaveAiPhoto: (planId: string, activityId: string, photo: PlannerPhoto) => Promise<void>;
  onPublishAi: (plan: AiTravelPlan, initialFinance?: TripPlan) => Promise<AiTravelPlan>;
  onSaveAiWithLedger?: (
    plan: AiTravelPlan,
    expectedVersion: number,
    ledgerUpdate: { kind: 'update'; sheet: TripPlan } | { kind: 'publish'; initialFinance: TripPlan } | null,
  ) => Promise<AiTravelPlan>;
  onSaveJournalVisit: typeof recordPlannerJournalVisit;
  onOpenJournalPlace: (placeId: string) => void;
  onSavePreferences: (preferences: PlannerPreferences) => Promise<void>;
  webTourMode?: boolean;
  onRequireClient?: (feature: TourRestrictedFeature) => void;
  cloudUser?: CloudSelfUser | null;
  targetPlanId?: string | null;
  onOpenAuth?: () => void;
  onSyncNow?: () => Promise<void>;
}

type PlannerTab = 'discover' | 'itineraries' | 'finance';
type DiscoveryRequest = Pick<PlannerRequest, 'destination' | 'startDate' | 'endDate' | 'base' | 'notes' | 'luggageMode' | 'references' | 'referenceMode'>;
interface XhsDialogOptions {
  mode: 'create' | 'plan' | 'chat';
  initialTab?: 'add-places' | 'revise-plan';
  initialTargetDate?: string;
  initialFiles?: File[];
}

/** 保留用户填写的行程条件。多篇笔记的推荐天数相互冲突时，交给时长推荐。 */
function withXhsReferences(request: PlannerRequest, references: XhsReference[], referenceMode: XhsReferenceMode): PlannerRequest {
  const destinations = [...new Set(references.flatMap((ref) => ref.destinations).filter(Boolean))];
  const suggestedDays = [...new Set(references.flatMap((ref) => ref.suggestedDays ? [ref.suggestedDays] : []))];
  const next = { ...request, references, referenceMode };
  if (!next.destination.trim() && destinations.length) next.destination = destinations.join('、');
  return !next.days && !next.endDate && suggestedDays.length === 1
    ? updatePlannerDates(next, { days: suggestedDays[0] })
    : next;
}

const costLabels = {
  ticket: '门票（按人群）',
  person: '每人',
  room: '每间',
  vehicle: '每辆',
  group: '整单',
} as const;
const costStatusLabels: Record<PlannerCost['status'], string> = {
  verified: '已查证',
  booked: '订单实付',
  estimate: '预估，仅供参考',
  unknown: '',
};
const kindLabels = { sight: '游玩', food: '餐饮', transport: '交通', rest: '休息' } as const;
const priceText = (cents: number | null) => (cents === null ? '以现场为准' : currency(cents / 100));
function HotelBookingDetails({ booking }: { booking: BookingRecord }) {
  const details = [booking.city, booking.toLocation, booking.seatOrRoom, booking.note,
    booking.startTime && `${booking.date} ${booking.startTime} 入住`,
    booking.endTime && `${booking.endDate || addPlannerDays(booking.date, 1)} ${booking.endTime} 退房`,
  ].filter(Boolean);
  return details.length > 0 ? <p>{details.join(' · ')}</p> : null;
}

/** 每段实际车次或航班只显示一张票券。缓冲时间仍用于排程，按需展开即可查看。 */
function TransportBookingCard({ booking, disabled, onEdit }: { booking: BookingRecord; disabled: boolean; onEdit: () => void }) {
  const flight = booking.kind === 'flight';
  const arrivalDate = bookingArrivalDate(booking);
  const connection = bookingConnectionTimes(booking);
  const kindLabel = flight ? '航班' : '火车票';
  return <article className={`card planner-booking-ticket ${flight ? 'is-flight' : 'is-train'}`} aria-label={booking.title}>
    <div className="planner-ticket-main">
      <header className="planner-ticket-header">
        <span className="planner-ticket-icon"><TravelIcon name={flight ? 'plane' : 'train'} /></span>
        <h3>{booking.code || kindLabel}</h3>
        {booking.code && <span>{kindLabel}</span>}
        {booking.purchaseStatus === 'unpurchased' && (
          <span className="booking-unpurchased-tag">未购买 · 待抢票</span>
        )}
      </header>
      <div className="planner-ticket-route">
        <div>
          <strong>{booking.fromLocation}</strong>
          <time dateTime={`${booking.date}T${booking.startTime}`}>{booking.startTime}</time>
        </div>
        <span className="planner-ticket-track" aria-hidden="true">→</span>
        <div>
          <strong>{booking.toLocation}</strong>
          <time dateTime={`${arrivalDate}T${booking.endTime}`}>{booking.endTime}</time>
          {arrivalDate !== booking.date && <small>{Number(arrivalDate.slice(5, 7))} 月 {Number(arrivalDate.slice(8))} 日到达</small>}
        </div>
      </div>
      <details className="planner-ticket-connections">
        <summary>接驳时间</summary>
        <p>{connection.leave} 预计出发 · {connection.stationArrival} 到{flight ? '机场' : '站'}
          {connection.onward > 0 && ` · ${connection.ready} 预计完成到达接驳`}</p>
      </details>
    </div>
    <div className="planner-ticket-stub">
      {booking.seatOrRoom && <span>{booking.seatOrRoom}</span>}
      {booking.amountYuan != null && <strong>{currency(booking.amountYuan)}</strong>}
      {booking.note && <small>{booking.note}</small>}
      <button type="button" className="text-button" disabled={disabled} onClick={onEdit}>编辑预订</button>
    </div>
  </article>;
}
/** 费用行显示：预估价前加“约”，未知显示“以现场为准”，不再出现“待确认”。 */
const costPriceText = (cost: PlannerCost, cents: number | null = cost.unitPriceCents) =>
  cents === null ? '以现场为准' : `${cost.status === 'verified' || cost.status === 'booked' ? '' : '约 '}${currency(cents / 100)}`;
/** 门票只列出本次同行实际有的人群，例如“成人 ¥100 / 老人 待确认”。 */
const ticketPriceText = (cost: PlannerCost, request: PlannerRequest) => {
  const party = plannerParty(request);
  return [
    ['成人', cost.unitPriceCents, party.adults], ['学生', cost.studentPriceCents, party.students],
    ['老人', cost.seniorPriceCents ?? null, party.seniors], ['儿童', cost.childPriceCents ?? null, party.children],
  ].filter(([, , count], index) => index === 0 || Number(count) > 0)
    .map(([label, cents]) => `${label} ${priceText(cents as number | null)}`).join(' / ');
};
const partyBreakdown = (request: PlannerRequest) => {
  const party = plannerParty(request);
  return [[party.adults, '成人'], [party.students, '学生'], [party.seniors, '老人'], [party.children, '儿童']]
    .filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`).join(' / ');
};

function Sources({ ids, sources }: { ids?: string[]; sources?: PlannerSource[] }) {
  const idList = Array.isArray(ids) ? ids : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  const selected = sourceList.filter((source) => idList.includes(source.id));
  return selected.length ? (
    <div className="planner-sources">
      {selected.map((source) => (
        <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
          {plannerDisplayText(source.title)}
          <small> · {source.checkedAt.slice(0, 10)}</small>
        </a>
      ))}
    </div>
  ) : null;
}

/** 自动配图最多 2 张同时查找：本地小红书工具实测可并发 2 个（约 15 秒一批），
 * 再多会让每张卡等更久，也更容易触发站点风控。手动“重新查找”不排队，立即开始。
 */
const AUTO_PHOTO_PARALLEL = 2;
let autoPhotoActive = 0;
const autoPhotoWaiting: Array<() => Promise<void>> = [];
function drainAutoPhotos() {
  while (autoPhotoActive < AUTO_PHOTO_PARALLEL && autoPhotoWaiting.length) {
    const run = autoPhotoWaiting.shift()!;
    autoPhotoActive++;
    void run().catch(() => {}).finally(() => { autoPhotoActive--; drainAutoPhotos(); });
  }
}
function queueAutoPhoto(run: () => Promise<void>) {
  autoPhotoWaiting.push(run);
  // 异步启动：开发模式下组件会先卸载再挂载一次，同步开始会被那次卸载取消。
  queueMicrotask(drainAutoPhotos);
}

/** Lazy-load external photos, with a real metadata lookup for the retry button. */
function PlacePhoto({
  photo,
  title,
  city,
  location,
  date,
  autoLoad = false,
  onResolved,
}: {
  photo: PlannerPhoto | null;
  title: string;
  city: string;
  location?: string;
  date?: string;
  autoLoad?: boolean;
  onResolved: (photo: PlannerPhoto) => void;
}) {
  const [queued, setQueued] = useState(false);
  const mounted = useRef(true);
  const autoTried = useRef(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoStage, setPhotoStage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const [localUrl, setLocalUrl] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(Boolean(photo?.assetId));
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setFailed(false);
    setFallbackIndex(0);
    setMessage('');
  }, [photo?.url, photo?.assetId]);
  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setLocalUrl('');
    setFallbackIndex(0);
    setLoadingLocal(Boolean(photo?.assetId));
    if (photo?.assetId) {
      const assetId = photo.assetId;
      void getPlannerPhotoBlob(assetId).then(async (blob) => {
        if (disposed) return;
        let resolvedBlob = blob;
        if (!resolvedBlob && !isWebTourMode()) {
          // 跨端同步过来的行程参考图：优先从云端拉取并缓存到本地 IndexedDB
          try {
            const resp = await fetch(getCloudPlannerPhotoUrl(assetId));
            if (resp.ok) {
              const cloudBlob = await resp.blob();
              if (cloudBlob.size > 0) {
                await savePlannerPhotoBlob(assetId, cloudBlob).catch(() => undefined);
                resolvedBlob = cloudBlob;
              }
            }
          } catch {
            // 离线或云端暂无时回退到其他源
          }
        }
        if (!resolvedBlob || disposed) return;
        objectUrl = URL.createObjectURL(resolvedBlob);
        setLocalUrl(objectUrl);
        setFailed(false);
      }).catch(() => setMessage('本地照片读取失败，请重新查找'))
        .finally(() => { if (!disposed) setLoadingLocal(false); });
    }
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo?.assetId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    // 行程先显示，没有照片的卡片自动排队补图；若排队或首次请求因切换/重挂载被取消，允许下次挂载自动重试。
    if (isWebTourMode() || !autoLoad || photo || autoTried.current) return;
    autoTried.current = true;
    setQueued(true);
    queueAutoPhoto(async () => {
      if (!mounted.current) {
        autoTried.current = false;
        return;
      }
      setQueued(false);
      await retry();
    });
  }, [autoLoad, photo]);
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  async function retry() {
    if (isWebTourMode()) {
      setMessage('在线体验模式暂不支持联网抓取实拍配图，请下载客户端体验');
      return;
    }
    controller.current?.abort();
    const currentRequest = new AbortController();
    controller.current = currentRequest;
    // 浏览器兜底限时略长于服务端，覆盖最后的本地照片下载，防止断流后一直等待。
    const signal = AbortSignal.any([currentRequest.signal, AbortSignal.timeout(70000)]);
    setBusy(true);
    setElapsedSeconds(0);
    setQueued(false);
    setPhotoStage('正在查找小红书实拍照片');
    setMessage('');
    try {
      const result = await plannerApi<{ photo: PlannerPhoto | null; message?: string; queryLabel?: string }>(
        'photo',
        { title, city, ...(location ? { location } : {}), stream: true, ...(date ? { date } : {}) },
        signal,
        (stage) => { if (controller.current === currentRequest && !signal.aborted) setPhotoStage(stage); },
      );
      if (controller.current !== currentRequest || signal.aborted) return;
      if (result.photo) {
        setFailed(false);
        onResolved(result.photo);
      } else setMessage([
        result.queryLabel ? `暂未取得参考照片：${result.queryLabel}` : `暂未取得参考照片：${city} · ${title}`,
        result.message || '可打开小红书查看，或稍后重试',
      ].join('\n'));
    } catch (error) {
      if (controller.current === currentRequest) {
        setMessage(currentRequest.signal.aborted ? '已取消查找，原照片已保留'
          : signal.aborted ? '图片查找超时，请稍后重试或打开小红书查看'
          : error instanceof Error ? error.message : '图片查询失败');
      }
    } finally {
      if (controller.current === currentRequest) { setBusy(false); setPhotoStage(''); }
    }
  }
  const photoSources = useMemo(() => {
    if (!photo) return [];
    const list: string[] = [];
    if (localUrl) list.push(localUrl);
    if (photo.assetId) {
      list.push(getCloudPlannerPhotoUrl(photo.assetId));
      list.push(plannerApiUrl(`photo-file/${photo.assetId}`));
    }
    if (photo.url) list.push(photo.url);
    return [...new Set(list.filter(Boolean))];
  }, [localUrl, photo]);
  const activePhotoSrc = photoSources[fallbackIndex] || '';
  return (
    <div className="planner-photo">
      {photo && !failed && !loadingLocal && activePhotoSrc && (localUrl || !isWebTourMode()) ? (
        <>
          <img
            src={activePhotoSrc}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              if (fallbackIndex + 1 < photoSources.length) {
                setFallbackIndex((prev) => prev + 1);
              } else {
                setFailed(true);
              }
            }}
          />
          <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
            {photo.attribution}
          </a>
        </>
      ) : (
        <div className="planner-photo-empty">
          <span>◇</span>
          <small>{loadingLocal ? '正在读取本地照片…' : queued ? '排队等待自动查找照片…' : busy ? '正在查找照片…' : '实景照片待补充'}</small>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => void retry()}
          >
            {busy ? '查找中…' : '重新查找照片'}
          </button>
        </div>
      )}
      <div className="planner-photo-bar">
        {busy && <small role="status" className="planner-photo-progress">{plannerShortStage(photoStage)} 已等待 {elapsedSeconds} 秒</small>}
        {!busy && message && <small role="status" className="planner-photo-message">{message}</small>}
        {photo?.assetId && localUrl && <small className="planner-photo-status">已保存到本地 · 参考照片，具体机位与拍摄月份未确认</small>}
        <div className="planner-photo-links">
          {photo && !failed && <button className="text-button" type="button" disabled={busy} onClick={() => void retry()}>
            {busy ? '查找中…' : '按小红书优先重新查找'}
          </button>}
          {busy && <button className="text-button" type="button" onClick={() => controller.current?.abort()}>取消查找</button>}
          <a
            href={plannerXiaohongshuSearchUrl(city, title, date)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openXiaohongshuSearch(`${city} ${title}`.trim());
            }}
            title="在小红书 App 内搜索"
          >
            去小红书搜这个地点
          </a>
        </div>
      </div>
    </div>
  );
}

const transferModeEditorLabels: Record<PlannerTransferModeKind, string> = {
  walk: '步行',
  subway: '地铁',
  bus: '公交',
  taxi: '打车',
  drive: '自驾开车',
  train: '火车／高铁',
  flight: '飞机',
  other: '其他交通',
};

function ActivityEditor({
  initial,
  error,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: PlannerActivity;
  error: string;
  onSave: (activity: PlannerActivity) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => structuredClone(initial));
  function updateCost(index: number, patch: Partial<PlannerCost>) {
    setValue({
      ...value,
      costs: value.costs.map((cost, ordinal) =>
        ordinal === index
          ? { ...cost, ...patch, status: patch.unitPriceCents === null ? 'unknown' : 'estimate' }
          : cost,
      ),
    });
  }
  function updateTransferOption(index: number, patch: Partial<PlannerTransferOption>) {
    const next = (value.transferOptions ?? []).map((item, ordinal) =>
      ordinal === index ? { ...item, ...patch } : item,
    );
    setValue({ ...value, transferOptions: next });
  }
  return (
    <div className="dialog-backdrop">
      <section
        className="dialog planner-editor"
        role="dialog"
        aria-modal="true"
        aria-label="编辑行程模块"
      >
        {error && (
          <div className="planner-error" role="alert">
            {plannerDisplayText(error)}
          </div>
        )}
        <div className="card-heading">
          <h2>编辑行程模块</h2>
          <button className="text-button" onClick={onCancel}>
            关闭
          </button>
        </div>
        <div className="planner-input-grid">
          <label>
            活动名称
            <input
              value={value.title}
              onChange={(event) =>
                setValue({
                  ...value,
                  title: event.target.value,
                  photo: null,
                  photoQuery: undefined,
                })
              }
            />
          </label>
          <label>
            活动类型
            <select
              value={value.kind}
              onChange={(event) =>
                setValue({
                  ...value,
                  kind: event.target.value as PlannerActivity['kind'],
                  distanceKm: event.target.value === 'transport' ? value.distanceKm : undefined,
                  transferOptions: event.target.value === 'transport' ? value.transferOptions : undefined,
                  costs: event.target.value === 'rest' ? [] : value.costs,
                  meal: event.target.value === 'food' ? 'lunch' : null,
                })
              }
            >
              {Object.entries(kindLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            时段
            <select
              value={value.period}
              onChange={(event) =>
                setValue({ ...value, period: event.target.value as PlannerActivity['period'] })
              }
            >
              {Object.entries(PLANNER_PERIODS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            开始时间
            <input
              type="time"
              value={value.startTime}
              onChange={(event) => setValue({ ...value, startTime: event.target.value })}
            />
          </label>
          <label>
            结束时间
            <input
              type="time"
              value={value.endTime}
              onChange={(event) => setValue({ ...value, endTime: event.target.value })}
            />
          </label>
          <label>
            城市
            <input
              value={value.city}
              onChange={(event) =>
                setValue({ ...value, city: event.target.value, photo: null, photoQuery: undefined })
              }
            />
          </label>
          <label>
            具体位置
            <input
              value={value.location}
              onChange={(event) =>
                setValue({
                  ...value,
                  location: event.target.value,
                  photo: null,
                  photoQuery: undefined,
                })
              }
            />
          </label>
          {value.kind === 'food' && (
            <label>
              用餐
              <select
                value={value.meal ?? 'lunch'}
                onChange={(event) =>
                  setValue({ ...value, meal: event.target.value as PlannerActivity['meal'] })
                }
              >
                <option value="breakfast">早餐</option>
                <option value="lunch">午餐</option>
                <option value="dinner">晚餐</option>
                <option value="snack">小吃／茶歇</option>
              </select>
            </label>
          )}
          {value.kind === 'transport' && (
            <>
              <label>
                交通方式
                <input
                  value={value.transportMode}
                  onChange={(event) => setValue({ ...value, transportMode: event.target.value })}
                />
              </label>
              <label>
                路线距离（公里）
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={value.distanceKm ?? ''}
                  onChange={(event) => setValue({ ...value, distanceKm: event.target.value ? event.target.valueAsNumber : null })}
                />
              </label>
            </>
          )}
        </div>
        <label>
          说明
          <textarea
            rows={3}
            value={value.description}
            onChange={(event) => setValue({ ...value, description: event.target.value })}
          />
        </label>
        {value.kind === 'transport' && (
          <div className="planner-transfer-editor-section">
            <h3>交通方案明细（展示在两张卡片之间）</h3>
            {(value.transferOptions ?? []).map((option, index) => (
              <div className="planner-cost-editor" key={index}>
                <label>
                  方式
                  <select
                    value={option.mode}
                    onChange={(event) => {
                      const mode = event.target.value as PlannerTransferModeKind;
                      updateTransferOption(index, {
                        mode,
                        costUnit: mode === 'subway' || mode === 'bus' || mode === 'train' || mode === 'flight' ? 'person' : 'vehicle',
                      });
                    }}
                  >
                    {Object.entries(transferModeEditorLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                {option.mode !== 'drive' && option.mode !== 'walk' && (
                  <label>
                    线路／方式名
                    <input
                      value={option.line ?? ''}
                      placeholder="例如：地铁 1 号线换乘 2 号线"
                      onChange={(event) => updateTransferOption(index, { line: event.target.value })}
                    />
                  </label>
                )}
                {(option.mode === 'subway' || option.mode === 'bus' || option.mode === 'train') && (
                  <>
                    <label>
                      上车站
                      <input
                        value={option.fromStation ?? ''}
                        placeholder="例如：西北角站"
                        onChange={(event) => updateTransferOption(index, { fromStation: event.target.value })}
                      />
                    </label>
                    <label>
                      下车站
                      <input
                        value={option.toStation ?? ''}
                        placeholder="例如：东南角站"
                        onChange={(event) => updateTransferOption(index, { toStation: event.target.value })}
                      />
                    </label>
                  </>
                )}
                <label>
                  预计时间（分钟）
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={option.durationMinutes ?? ''}
                    onChange={(event) => updateTransferOption(index, {
                      durationMinutes: event.target.value === '' ? null : Math.max(1, Math.round(Number(event.target.value))),
                    })}
                  />
                </label>
                <label>
                  距离（公里，如 0.6 表示 600 米）
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={option.distanceKm ?? ''}
                    onChange={(event) => updateTransferOption(index, {
                      distanceKm: event.target.value === '' ? null : event.target.valueAsNumber,
                    })}
                  />
                </label>
                {option.mode !== 'walk' && option.mode !== 'drive' && (
                  <>
                    <label>
                      预计费用（元）
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="未知留空"
                        value={option.costCents == null ? '' : option.costCents / 100}
                        onChange={(event) => updateTransferOption(index, {
                          costCents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
                        })}
                      />
                    </label>
                    <label>
                      计价口径
                      <select
                        value={option.costUnit ?? (option.mode === 'subway' || option.mode === 'bus' ? 'person' : 'vehicle')}
                        onChange={(event) => updateTransferOption(index, { costUnit: event.target.value as 'person' | 'vehicle' })}
                      >
                        <option value="person">每人</option>
                        <option value="vehicle">每辆／打车预估</option>
                      </select>
                    </label>
                    {option.mode === 'taxi' && (
                      <label>
                        顺风车预估（元，较远可选）
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="较远路段可填"
                          value={option.carpoolCostCents == null ? '' : option.carpoolCostCents / 100}
                          onChange={(event) => updateTransferOption(index, {
                            carpoolCostCents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
                          })}
                        />
                      </label>
                    )}
                  </>
                )}
                <label>
                  换乘／接驳备注
                  <input
                    value={option.transferNote ?? ''}
                    placeholder="例如：西南角站换乘"
                    onChange={(event) => updateTransferOption(index, { transferNote: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    const next = (value.transferOptions ?? []).filter((_, ordinal) => ordinal !== index);
                    setValue({ ...value, transferOptions: next.length ? next : undefined });
                  }}
                >
                  移除方案
                </button>
              </div>
            ))}
            {(value.transferOptions?.length ?? 0) < 6 && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setValue({
                    ...value,
                    transferOptions: [
                      ...(value.transferOptions ?? []),
                      { mode: 'subway', line: '', durationMinutes: 15, costUnit: 'person' },
                    ],
                  })
                }
              >
                ＋ 添加交通方案（步行／地铁／打车／自驾）
              </button>
            )}
          </div>
        )}
        <h3>费用明细 · 单价按元填写</h3>
        {value.costs.map((cost, index) => (
          <div className="planner-cost-editor" key={cost.id}>
            <label>
              费用名称
              <input
                value={cost.label}
                onChange={(event) => updateCost(index, { label: event.target.value })}
              />
            </label>
            <label>
              类别
              <select
                value={cost.category}
                onChange={(event) =>
                  updateCost(index, { category: event.target.value as PlannerCost['category'] })
                }
              >
                {Object.entries(BUDGET_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              计费单位
              <select
                value={cost.unit}
                onChange={(event) =>
                  updateCost(index, { unit: event.target.value as PlannerCost['unit'] })
                }
              >
                {Object.entries(costLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {cost.unit === 'ticket' ? '成人票单价' : '单价'}
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="未知留空"
                value={cost.unitPriceCents === null ? '' : cost.unitPriceCents / 100}
                onChange={(event) =>
                  updateCost(index, {
                    unitPriceCents:
                      event.target.value === ''
                        ? null
                        : Math.round(Number(event.target.value) * 100),
                  })
                }
              />
            </label>
            {cost.unit === 'ticket' && (
              <label>
                学生票单价
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="未知留空，暂按成人价"
                  value={cost.studentPriceCents === null ? '' : cost.studentPriceCents / 100}
                  onChange={(event) =>
                    updateCost(index, {
                      studentPriceCents:
                        event.target.value === ''
                          ? null
                          : Math.round(Number(event.target.value) * 100),
                    })
                  }
                />
              </label>
            )}
            {cost.unit === 'ticket' && (
              <>
              <label>
                老人票单价
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="未知留空，暂按成人价"
                  value={cost.seniorPriceCents == null ? '' : cost.seniorPriceCents / 100}
                  onChange={(event) =>
                    updateCost(index, {
                      seniorPriceCents:
                        event.target.value === ''
                          ? null
                          : Math.round(Number(event.target.value) * 100),
                    })
                  }
                />
              </label>
              <label>
                儿童票单价
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="未知留空，暂按成人价"
                  value={cost.childPriceCents == null ? '' : cost.childPriceCents / 100}
                  onChange={(event) =>
                    updateCost(index, {
                      childPriceCents:
                        event.target.value === ''
                          ? null
                          : Math.round(Number(event.target.value) * 100),
                    })
                  }
                />
              </label>
              </>
            )}
            {(cost.unit === 'vehicle' || cost.unit === 'group') && (
              <label>
                数量
                <input
                  type="number"
                  min="1"
                  value={cost.quantity}
                  onChange={(event) => updateCost(index, { quantity: Number(event.target.value) })}
                />
              </label>
            )}
            <label>
              次数
              <input
                type="number"
                min="1"
                value={cost.occurrences}
                onChange={(event) => updateCost(index, { occurrences: Number(event.target.value) })}
              />
            </label>
            <label>
              资格／说明
              <input
                value={cost.qualification}
                onChange={(event) => updateCost(index, { qualification: event.target.value })}
              />
            </label>
            <label>
              已含在套餐费用 ID
              <input
                value={cost.includedIn ?? ''}
                placeholder="独立收费留空"
                onChange={(event) => updateCost(index, { includedIn: event.target.value || null })}
              />
            </label>
            <button
              className="text-button"
              onClick={() =>
                setValue({ ...value, costs: value.costs.filter((_, ordinal) => ordinal !== index) })
              }
            >
              移除费用
            </button>
          </div>
        ))}
        <button
          className="secondary"
          onClick={() =>
            setValue({
              ...value,
              costs: [
                ...value.costs,
                {
                  id: createLocalId(),
                  label: '新增费用',
                  category: 'other',
                  unit: 'person',
                  unitPriceCents: null,
                  studentPriceCents: null,
                  quantity: 1,
                  occurrences: 1,
                  status: 'unknown',
                  qualification: '',
                  sourceIds: [],
                  includedIn: null,
                },
              ],
            })
          }
        >
          ＋ 添加费用
        </button>
        <div className="dialog-actions">
          <button className="primary" onClick={() => onSave(value)}>
            保存模块
          </button>
          <button className="secondary" onClick={onDelete}>
            删除模块
          </button>
          <button className="text-button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}

/** Independent plans live beside the old finance view. Every mutation goes
 * through an optimistic-version save, while AI requests keep their originating
 * version so late results can never replace a newer card edit or restored plan.
 */
export default function PlannerWorkspace(props: PlannerWorkspaceProps) {
  const { t } = useI18n();
  const webTourMode = Boolean(props.webTourMode);
  const [tab, setTab] = useState<PlannerTab>(
    props.provinceIntent ? 'discover' : 'itineraries',
  );
  const [serviceToolsExpanded, setServiceToolsExpanded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(props.aiPlans[0]?.id ?? null);
  useEffect(() => {
    if (props.targetPlanId && props.aiPlans.some((p) => p.id === props.targetPlanId)) {
      setActiveId(props.targetPlanId);
      setCreating(false);
      setTab('itineraries');
    }
  }, [props.targetPlanId, props.aiPlans]);
  const [financeKey, setFinanceKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(props.aiPlans.length === 0);
  const [request, setRequest] = useState(() =>
    freshPlannerRequest('', props.preferences?.base ?? ''),
  );
  const [xhsDraft, setXhsDraft] = useState('');
  const [discover, setDiscover] = useState<DiscoveryRequest>(() => ({
    destination: props.provinceIntent?.name ?? '',
    startDate: freshPlannerRequest().startDate,
    endDate: '',
    base: props.preferences?.base ?? '',
    notes: '',
  }));
  const [recommendations, setRecommendations] = useState<DestinationRecommendation[]>([]);
  const [recommendationSources, setRecommendationSources] = useState<PlannerSource[]>([]);
  const [durations, setDurations] = useState<
    Array<{ days: number; title: string; reason: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [taskLocation, setTaskLocation] = useState<{ tab: PlannerTab; planId: string | null }>({ tab: 'itineraries', planId: null });
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [lastTask, setLastTask] = useState<(() => Promise<void>) | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiBackendOffline, setAiBackendOffline] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [externalAiOpen, setExternalAiOpen] = useState(false);
  const [editing, setEditing] = useState<{
    dayIndex: number;
    activity: PlannerActivity;
    isNew: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<PlannerRequest | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [openChatPlanId, setOpenChatPlanId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalCityChoice, setJournalCityChoice] = useState<{ planId: string; activityId: string; cityCode: string } | null>(null);
  const [bookingDialog, setBookingDialog] = useState<{ initial?: BookingRecord; target?: string; editing?: boolean } | null>(null);
  const [shareModalData, setShareModalData] = useState<TripSharePayload | null>(null);
  const [draftBookings, setDraftBookings] = useState<BookingRecord[]>([]);
  const [xhsDialog, setXhsDialog] = useState<(XhsDialogOptions & { planId: string | null; minimized: boolean }) | null>(null);
  const [chatRefs, setChatRefs] = useState<XhsReference[]>([]);
  const [exportingHtml, setExportingHtml] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const plansRef = useRef(props.aiPlans);
  plansRef.current = props.aiPlans;
  const activePlan = props.aiPlans.find((plan) => plan.id === activeId) ?? props.aiPlans[0] ?? null;
  const chatOpen = Boolean(activePlan && openChatPlanId === activePlan.id);
  const activitiesById = useMemo(() => new Map(
    (activePlan?.content.days ?? []).flatMap((day) => day.activities.map((activity) => [activity.id, activity] as const)),
  ), [activePlan?.content.days]);
  const currentView = useRef({ visible: props.visible, tab, planId: activePlan?.id });
  currentView.current = { visible: props.visible, tab, planId: activePlan?.id };
  const awayFromTask = !props.visible || tab !== taskLocation.tab || Boolean(taskLocation.planId && taskLocation.planId !== activePlan?.id);
  const ticketSignature = activePlan ? ticketPlanSignature(activePlan.content) : '';
  const [ticketStatus, setTicketStatus] = useState({ key: '', stage: '', error: '' });
  const [ticketNowMs, setTicketNowMs] = useState(() => Date.now());
  const hasEnabledTicketReminder = Boolean(
    activePlan?.ticketReminders && Object.values(activePlan.ticketReminders).some((r) => r?.enabled),
  );
  useEffect(() => {
    setTicketNowMs(Date.now());
    if (!hasEnabledTicketReminder) return;
    const tick = () => setTicketNowMs(Date.now());
    const timer = window.setInterval(tick, 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasEnabledTicketReminder, activePlan?.id]);
  const ticketPlanId = activePlan?.id;
  const savedTicketSignature = activePlan?.ticketPlan?.signature;
  /** 行程先显示，抢票资料后台补全。改日期/增删活动/AI修改/恢复历史都走同一更新路径。
   * 独立取消请求，避免后台抢票查询阻塞用户继续编辑；旧行程的结果不会覆盖新行程。 */
  useEffect(() => {
    if (webTourMode || !ticketPlanId || !ticketSignature || savedTicketSignature === ticketSignature || busy || bookingDialog) return;
    const abort = new AbortController();
    const key = `${ticketPlanId}:${ticketSignature}`;
    const timer = window.setTimeout(() => {
      const original = plansRef.current.find((plan) => plan.id === ticketPlanId);
      if (!original) return;
      setTicketStatus({ key, stage: '正在自动查询预约与放票规则…', error: '' });
      void (async () => {
        try {
          const result = await plannerApi<NonNullable<AiTravelPlan['ticketPlan']>>('tickets',
            { plan: { ...original, history: [], messages: [] } }, abort.signal,
            (stage) => { if (!abort.signal.aborted) setTicketStatus({ key, stage, error: '' }); });
          if (abort.signal.aborted) return;
          const current = plansRef.current.find((plan) => plan.id === ticketPlanId);
          if (!current || ticketPlanSignature(current.content) !== ticketSignature) return;
          await props.onSaveAi({ ...current, version: current.version + 1,
            contentVersion: current.contentVersion ?? current.version, updatedAt: new Date().toISOString(),
            ticketPlan: { ...result, signature: ticketSignature },
          }, current.version);
          if (!abort.signal.aborted) setTicketStatus({ key, stage: '', error: '' });
        } catch (failure) {
          if (!abort.signal.aborted) setTicketStatus({ key, stage: '', error: failure instanceof Error ? failure.message : '抢票计划自动生成失败' });
        }
      })();
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [ticketPlanId, ticketSignature, savedTicketSignature, busy, bookingDialog]);

  const missingLegTransfers = useMemo(
    () => (activePlan ? collectMissingLegTransfers(activePlan) : []),
    [activePlan],
  );
  const missingTransferSig = activePlan && missingLegTransfers.length
    ? `${activePlan.id}:${missingLegTransfers.map((item) => item.key).join('|')}`
    : '';
  const triedTransferSigsRef = useRef(new Set<string>());
  const [transfersLoadingSig, setTransfersLoadingSig] = useState('');

  /** 已有行程缺少详细两站交通时，打开后自动在后台计算并保存，直接呈现在两张卡片之间，无需手动点补全。 */
  useEffect(() => {
    if (webTourMode || !ticketPlanId || !missingTransferSig || busy || bookingDialog || aiStatus?.configured !== true) return;
    if (triedTransferSigsRef.current.has(missingTransferSig)) return;
    const abort = new AbortController();
    let started = false;
    const timer = window.setTimeout(() => {
      const original = plansRef.current.find((plan) => plan.id === ticketPlanId);
      if (!original) return;
      const legs = collectMissingLegTransfers(original);
      if (!legs.length) return;
      started = true;
      triedTransferSigsRef.current.add(missingTransferSig);
      setTransfersLoadingSig(missingTransferSig);
      void (async () => {
        try {
          const result = await plannerApi<{ legs?: Record<string, PlannerTransferOption[]> }>(
            'transfers',
            {
              transport: original.content.request.transport,
              people: original.content.request.people,
              legs,
            },
            abort.signal,
            () => {},
          );
          if (abort.signal.aborted) {
            triedTransferSigsRef.current.delete(missingTransferSig);
            return;
          }
          const entries = Object.entries(result?.legs ?? {}).filter(([, value]) => Array.isArray(value) && value.length > 0);
          if (!entries.length) return;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = plansRef.current.find((plan) => plan.id === ticketPlanId);
            if (!current) return;
            try {
              await props.onSaveAi(
                {
                  ...current,
                  version: current.version + 1,
                  contentVersion: current.contentVersion ?? current.version,
                  updatedAt: new Date().toISOString(),
                  legTransfers: { ...current.legTransfers, ...Object.fromEntries(entries) },
                },
                current.version,
              );
              break;
            } catch {
              if (attempt === 1) break;
              await new Promise((resolve) => window.setTimeout(resolve, 180));
            }
          }
        } catch {
          if (abort.signal.aborted) triedTransferSigsRef.current.delete(missingTransferSig);
        } finally {
          if (!abort.signal.aborted) {
            setTransfersLoadingSig((prev) => (prev === missingTransferSig ? '' : prev));
          }
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
      if (started) triedTransferSigsRef.current.delete(missingTransferSig);
    };
  }, [ticketPlanId, missingTransferSig, busy, bookingDialog, aiStatus?.configured]);

  const [unvisitedLoadingId, setUnvisitedLoadingId] = useState('');
  const [unvisitedError, setUnvisitedError] = useState('');
  const triedUnvisitedPlansRef = useRef(new Set<string>());

  /** 过滤掉已在行程中安排过的景点，避免安排后仍滞留在「未去热门景点」中。 */
  const visibleUnvisitedHighlights = useMemo<UnvisitedPopularSight[]>(() => {
    const raw = activePlan?.content.unvisitedHighlights;
    if (!activePlan || !Array.isArray(raw) || !raw.length) return [];
    const norm = (value: string) =>
      value
        .toLowerCase()
        .replace(/[\s·\-—_()（）【】「」《》,，.。]/g, '')
        .replace(/(?:国家)?[45]a级?(?:旅游)?(?:景区|景点)?/gi, '')
        .replace(/(?:风景区|旅游区|景区|公园|博物馆|遗址|故居|古镇|古城)$/g, '');
    const scheduled = activePlan.content.days
      .flatMap((day) => day.activities)
      .map((act) => norm(act.title))
      .filter((t) => t.length >= 2);
    return raw.filter((item) => {
      const key = norm(item.title);
      if (!key) return false;
      return !scheduled.some(
        (s) => s === key || (s.length >= 3 && key.length >= 3 && (s.includes(key) || key.includes(s))),
      );
    });
  }, [activePlan]);

  async function fetchUnvisitedHighlights(planId: string, manual = false, externalSignal?: AbortSignal): Promise<void> {
    const original = plansRef.current.find((plan) => plan.id === planId);
    if (!original) return;
    if (webTourMode) {
      if (manual) props.onRequireClient?.('ai');
      return;
    }
    const abort = externalSignal ? null : new AbortController();
    const signal = externalSignal ?? abort!.signal;
    setUnvisitedLoadingId(planId);
    if (manual) setUnvisitedError('');
    try {
      const result = await plannerApi<{ items?: UnvisitedPopularSight[] }>(
        'unvisited',
        { plan: { ...original, history: [], messages: [] } },
        signal,
        () => {},
      );
      if (signal.aborted) return;
      const items = Array.isArray(result?.items) ? result.items : [];
      if (!items.length) {
        if (manual) setUnvisitedError('暂未识别到更多未去热门景点，可稍后重试');
        return;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = plansRef.current.find((plan) => plan.id === planId);
        if (!current) return;
        try {
          await props.onSaveAi(
            {
              ...current,
              version: current.version + 1,
              contentVersion: current.contentVersion ?? current.version,
              updatedAt: new Date().toISOString(),
              content: {
                ...current.content,
                unvisitedHighlights: items,
              },
            },
            current.version,
          );
          if (!signal.aborted) setUnvisitedError('');
          break;
        } catch {
          if (attempt === 1) break;
          await new Promise((resolve) => window.setTimeout(resolve, 180));
        }
      }
    } catch (failure) {
      if (!signal.aborted && manual) {
        setUnvisitedError(failure instanceof Error ? failure.message : '生成未去热门景点失败，请重试');
      }
    } finally {
      if (!signal.aborted) {
        setUnvisitedLoadingId((prev) => (prev === planId ? '' : prev));
      }
    }
  }

  /** 旧行程缺少未去热门景点时，打开后自动在后台补齐一次（每个计划仅自动尝试一次）。 */
  const missingUnvisitedPlanId =
    activePlan && (!activePlan.content.unvisitedHighlights || activePlan.content.unvisitedHighlights.length === 0)
      ? activePlan.id
      : '';
  useEffect(() => {
    if (
      webTourMode
      || !missingUnvisitedPlanId
      || busy
      || bookingDialog
      || aiStatus?.configured !== true
      || triedUnvisitedPlansRef.current.has(missingUnvisitedPlanId)
    ) {
      return;
    }
    const abort = new AbortController();
    let started = false;
    const timer = window.setTimeout(() => {
      started = true;
      triedUnvisitedPlansRef.current.add(missingUnvisitedPlanId);
      void fetchUnvisitedHighlights(missingUnvisitedPlanId, false, abort.signal);
    }, 600);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
      if (started) triedUnvisitedPlansRef.current.delete(missingUnvisitedPlanId);
    };
  }, [missingUnvisitedPlanId, busy, bookingDialog, aiStatus?.configured]);

  /** 记住用户在某段交通中点选的方案下标（选中后其余方案折叠，刷新页面保持选中）。 */
  async function selectTransferOption(selectionKey: string, index: number): Promise<boolean> {
    const planId = activePlan?.id;
    if (!planId) return false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = plansRef.current.find((plan) => plan.id === planId);
      if (!current) return false;
      if (current.selectedTransfers?.[selectionKey] === index) return true;
      try {
        await props.onSaveAi(
          {
            ...current,
            version: current.version + 1,
            contentVersion: current.contentVersion ?? current.version,
            updatedAt: new Date().toISOString(),
            selectedTransfers: { ...current.selectedTransfers, [selectionKey]: index },
          },
          current.version,
        );
        return true;
      } catch (error) {
        if (attempt === 1) {
          report(error);
          return false;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    }
    return false;
  }

  // 住宿/餐饮按所选档次和餐别补全预估价后再显示和计算合计（旧计划也立即生效）；编辑仍基于原计划。
  const estimated = useMemo(() => (activePlan ? plannerFillEstimates(activePlan.content) : null), [activePlan]);
  const shownCost = useMemo(() => {
    const map = new Map<string, PlannerCost>();
    for (const day of estimated?.days ?? [])
      for (const cost of [...day.activities.flatMap((activity) => activity.costs), ...(day.lodging?.costs ?? [])]) map.set(cost.id, cost);
    return (cost: PlannerCost) => map.get(cost.id) ?? cost;
  }, [estimated]);
  const budget = useMemo(() => (estimated ? calculatePlannerBudget(estimated) : null), [estimated]);
  const conflicts = activePlan ? plannerConflicts(activePlan.content) : [];
  const itineraryWarnings = [...new Set([
    ...(activePlan?.content.warnings ?? []).filter((warning) => !/^\d{4}-\d{2}-\d{2}「.+」与「.+」时间重叠$/.test(warning)),
    ...conflicts,
  ])];

  useEffect(() => {
    if (webTourMode) {
      setAiStatus(null);
      setAiBackendOffline(false);
      return;
    }
    let active = true;
    let healthController: AbortController | null = null;
    const probeHealth = () => {
      if (isMobileNativeAiActive() || isDesktopFreeTrialEnabled()) {
        setAiStatus(normalizeAiStatus(buildMobileAiStatus()));
        setAiBackendOffline(false);
        return;
      }
      healthController?.abort();
      healthController = new AbortController();
      const signal = AbortSignal.any([healthController.signal, AbortSignal.timeout(8000)]);
      fetch(plannerApiUrl('health'), { signal })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<Partial<AiStatus>>;
        })
        .then((health) => {
          if (!active) return;
          setAiStatus(normalizeAiStatus(health));
          setAiBackendOffline(false);
        })
        .catch(() => {
          if (!active || healthController?.signal.aborted) return;
          setAiStatus(null);
          setAiBackendOffline(true);
        });
    };
    probeHealth();
    const onOriginChange = () => probeHealth();
    window.addEventListener(PLANNER_API_ORIGIN_EVENT, onOriginChange);
    return () => {
      active = false;
      window.removeEventListener(PLANNER_API_ORIGIN_EVENT, onOriginChange);
      healthController?.abort();
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!props.provinceIntent) return;
    setDiscover(({ references: _refs, referenceMode: _mode, ...current }) => ({ ...current, destination: props.provinceIntent!.name }));
    setTab('discover');
  }, [props.provinceIntent?.token]);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : '操作失败，请重试');
  }
  /** Own exactly one abort controller and retain a retry closure. Network
   * failures do not clear saved plans or partially persist a generated draft.
   */
  async function task(
    operation: (signal: AbortSignal) => Promise<void>,
    retry: () => Promise<void>,
  ) {
    if (webTourMode) {
      props.onRequireClient?.('ai');
      return false;
    }
    if (controller.current) return false;
    const next = new AbortController();
    controller.current = next;
    // 任务绑定发起时的行程，之后切换页面或浏览另一份行程都不改变保存目标。
    const taskPlanId = tab === 'itineraries' && !creating ? activePlan?.id ?? null : null;
    setTaskLocation({ tab, planId: taskPlanId });
    setBusy(true);
    setError('');
    setStage('正在连接本地 AI 服务…');
    setLastTask(() => retry);
    const viewingTask = () => currentView.current.visible && currentView.current.tab === tab
      && (!taskPlanId || currentView.current.planId === taskPlanId);
    try {
      await operation(next.signal);
      if (next.signal.aborted) return false;
      if (!viewingTask()) props.onNotice('AI 任务已完成，可回到发起任务的位置查看结果。');
      return true;
    } catch (failure) {
      if (!next.signal.aborted) {
        report(failure);
        if (!viewingTask()) props.onNotice('AI 任务未完成，可回到发起任务的位置查看原因并重试。');
      }
      return false;
    } finally {
      if (controller.current === next) {
        controller.current = null;
        setBusy(false);
        setStage('');
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStage('');
    setError('已取消，原计划保持不变。可以重试。');
  }
  async function rememberBase(base: string) {
    if (base !== (props.preferences?.base ?? ''))
      await props.onSavePreferences({
        id: 'planner',
        favorites: props.preferences?.favorites ?? [],
        base,
      });
  }
  async function recommend() {
    await task(async (signal) => {
      const result = await plannerApi<{
        recommendations: DestinationRecommendation[];
        sources: PlannerSource[];
      }>('recommendations', { request: discover }, signal, setStage);
      await rememberBase(discover.base);
      setRecommendations(Array.isArray(result.recommendations) ? result.recommendations : []);
      setRecommendationSources(Array.isArray(result.sources) ? result.sources : []);
    }, recommend);
  }
  /** Duration discovery is a separate step: the user's selection becomes the
   * fixed date range before a complete itinerary can be saved.
   */
  async function generate(override?: PlannerRequest, pendingXhs = xhsDraft) {
    let input = override ?? request;
    let remaining = pendingXhs.trim();
    await task(
      async (signal) => {
        validatePlannerRequest(input);
        if (input.endDate || input.days) {
          const lastDate = input.endDate || addPlannerDays(input.startDate, input.days! - 1);
          const outside = draftBookings.find((item) => isTransportBooking(item) && (item.date < input.startDate || item.date > lastDate));
          if (outside) throw new Error(`「${outside.title}」出发日期不在计划内，请先核对预订或行程日期。`);
        }
        if (remaining) {
          const pastedLinks = extractXhsUrlsFromText(remaining);
          if (!pastedLinks.length) throw new Error('请粘贴小红书链接或含链接的分享文案。截图和纯文字攻略可从「导入截图 / 攻略」添加。');
          let references = input.references ?? [];
          const links = pastedLinks.filter((url) => !references.some((ref) => ref.url === url));
          if (links.length + references.length > MAX_XHS_REFERENCES) {
            throw new Error(`每个计划最多参考 ${MAX_XHS_REFERENCES} 篇小红书笔记，请删除多出的链接后继续。`);
          }
          const referenceMode = input.referenceMode ?? DEFAULT_XHS_REFERENCE_MODE;
          // 本地读取逐篇执行。每篇成功后就保留结果，失败或取消时只重试尚未读取的链接。
          for (const [index, url] of links.entries()) {
            const label = `小红书参考 ${index + 1}/${links.length}`;
            setStage(`正在解析${label}…`);
            let result: XhsParseResponse;
            try {
              result = await plannerApi<XhsParseResponse>('xhs-parse', { text: url },
                AbortSignal.any([signal, AbortSignal.timeout(125_000)]), (stage) => setStage(`${label} · ${stage}`));
            } catch (failure) {
              signal.throwIfAborted();
              const reason = failure instanceof Error ? failure.message : '读取失败';
              throw new Error(`${label}未能读取（${reason}）。可重试，或删除这条链接后继续。`);
            }
            signal.throwIfAborted();
            const note = compactXhsReference(result.reference);
            if (!note.url || !references.some((ref) => ref.url === note.url)) references = mergeXhsReferences(references, note);
            input = { ...input, references, referenceMode };
            remaining = links.slice(index + 1).join('\n');
            setRequest(input);
            setXhsDraft(remaining);
          }
          input = withXhsReferences(input, references, referenceMode);
          remaining = '';
          setRequest(input);
          setXhsDraft('');
        }
        await rememberBase(input.base);
        if (!input.destination.trim()) {
          // Date-only input is enough to discover destinations. Forward all
          // free text to the same prompt instead of asking for a fixed city.
          const result = await plannerApi<{
            recommendations: DestinationRecommendation[];
            sources: PlannerSource[];
          }>('recommendations', { request: input }, signal, setStage);
          setDiscover({
            destination: '',
            startDate: input.startDate,
            endDate: input.endDate,
            base: input.base,
            notes: input.notes,
            luggageMode: input.luggageMode,
            references: input.references,
            referenceMode: input.referenceMode,
          });
          setRecommendations(result.recommendations);
          setRecommendationSources(result.sources);
          if (currentView.current.tab === tab) setTab('discover');
          return;
        }
        if (!input.days && !input.endDate) {
          const result = await plannerApi<{ options: typeof durations }>(
            'duration',
            { request: input },
            signal,
            setStage,
          );
          setDurations(result.options);
          return;
        }
        const result = await plannerApi<{ content: PlannerContent }>(
          'generate',
          { request: input },
          signal,
          setStage,
        );
        validatePlannerContent(result.content);
        if (signal.aborted) return;
        const now = new Date().toISOString();
        let plan: AiTravelPlan = {
          id: createLocalId(),
          version: 1,
          contentVersion: 1,
          createdAt: now,
          updatedAt: now,
          linkedTripId: null,
          linkedSnapshot: null,
          content: result.content,
          messages: [],
          history: [],
        };
        for (const booking of draftBookings) {
          const inRange = isTransportBooking(booking) || booking.kind === 'hotel'
            || plan.content.days.some((day) => day.date === booking.date);
          plan = applyBookingToPlan(plan, booking, { updatePlan: inRange });
        }
        if (draftBookings.length) {
          // 首次保存已经包含全部预订，历史从用户实际看到的版本开始。
          plan = { ...plan, version: 1, contentVersion: 1, history: [] };
          validatePlannerContent(plan.content);
        }
        await props.onSaveAi(plan, null);
        setDraftBookings([]);
        setActiveId(plan.id);
        setCreating(false);
        setDurations([]);
        if (currentView.current.tab === tab) setTab('itineraries');
      },
      () => generate(input, remaining),
    );
  }
  async function commit(
    content: PlannerContent,
    reason: string,
    allowLockChange = false,
  ): Promise<boolean> {
    if (!activePlan || busy) return false;
    try {
      if (!allowLockChange) enforcePlannerScope(activePlan.content, content, null);
      const next = revisePlanner(activePlan, reconcileBookedContent(activePlan, content), reason);
      await props.onSaveAi(next, activePlan.version);
      setError('');
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }
  /** 复用现有问答接口，只将回答保存到对应卡片，刷新后仍可阅读。 */
  async function generateActivityGuide(activity: PlannerActivity) {
    if (!activePlan || busy || activity.bookingId) return;
    const original = activePlan;
    await task(async (signal) => {
      const result = await plannerApi<{ action: string; answer?: string }>('chat', {
        plan: { ...original, content: plannerContentForAi(original), bookings: undefined, hotels: undefined, history: [], messages: [] },
        baseVersion: original.version,
        scopeId: activity.id,
        mode: 'auto',
        activityGuide: true,
        message: `请仅提供「${activity.city}·${activity.title}」的详细实用攻略，不修改行程，不提出行程修改方案。结合当前日期、活动时间、同行人群和偏好，分段说明推荐游览顺序与时间分配、必看亮点、入口与交通、预约与费用、拍照建议、餐饮休息、天气及避坑事项；餐饮/交通/休息模块请给对应的实用指南。${activity.kind === 'food' ? '餐饮攻略重点推荐附近3至5家真实、评价有依据的具体店铺，列出店名及分店、地址或所在片区、招牌菜、人均预估、推荐理由与评价来源、排队或预约建议。兼顾距离和同行忌口；火锅须推荐对应锅底与点菜组合。没有真实评分、评论证据不得声称高分或好评，不编造店铺；证据不足可以少推荐并简短注明。' : ''}区分已核实资料与经验建议，不编造营业时间或票价。直接给实用内容，不复述用户要求或用长篇资料边界开场。使用中文短标题和段落。`,
      }, signal, setStage);
      if (result.action !== 'answer' || !result.answer?.trim()) throw new Error('未获取到详细攻略，请重试');
      // 合并保存：允许与后台地图定位/抢票/交通写入并发时自动重试最新版本，不丢失已生成攻略。
      const now = new Date().toISOString();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = plansRef.current.find((plan) => plan.id === original.id);
        if (!current || (current.contentVersion ?? current.version) !== (original.contentVersion ?? original.version)) {
          throw new Error('行程已更新，请重新获取攻略');
        }
        try {
          await props.onSaveAi({
            ...current,
            version: current.version + 1,
            contentVersion: current.contentVersion ?? current.version,
            updatedAt: now,
            activityGuides: { ...current.activityGuides, [activity.id]: { text: result.answer, createdAt: now } },
          }, current.version);
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => window.setTimeout(r, 120));
        }
      }
    }, () => generateActivityGuide(activity));
  }

  /** 一键为当前行程内所有尚未生成攻略的景点依次生成详细攻略，每完成一个即落盘保存。 */
  async function generateAllActivityGuides() {
    if (!activePlan || busy) return;
    const planId = activePlan.id;
    const allSights = activePlan.content.days.flatMap((day) =>
      plannerActivitiesByTime(day.activities).filter(
        (activity) => activity.kind === 'sight' && !activity.bookingId,
      ),
    );
    if (!allSights.length) return;
    const missing = allSights.filter((activity) => !activePlan.activityGuides?.[activity.id]);
    const targets = missing.length ? missing : allSights;

    await task(async (signal) => {
      for (let i = 0; i < targets.length; i += 1) {
        if (signal.aborted) return;
        const activity = targets[i];
        const latest = plansRef.current.find((plan) => plan.id === planId);
        if (!latest) return;
        setStage(`生成攻略 ${i + 1}/${targets.length}：${activity.title}`);
        const result = await plannerApi<{ action: string; answer?: string }>('chat', {
          plan: { ...latest, content: plannerContentForAi(latest), bookings: undefined, hotels: undefined, history: [], messages: [] },
          baseVersion: latest.version,
          scopeId: activity.id,
          mode: 'auto',
          activityGuide: true,
          message: `请仅提供「${activity.city}·${activity.title}」的详细实用攻略，不修改行程，不提出行程修改方案。结合当前日期、活动时间、同行人群和偏好，分段说明推荐游览顺序与时间分配、必看亮点、入口与交通、预约与费用、拍照建议、天气及避坑事项。区分已核实资料与经验建议，不编造营业时间或票价。直接给实用内容，使用中文【短标题】分段，不要使用 ** 星号。`,
        }, signal, () => {});
        if (signal.aborted) return;
        if (result.action !== 'answer' || !result.answer?.trim()) continue;
        const now = new Date().toISOString();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const current = plansRef.current.find((plan) => plan.id === planId);
          if (!current) return;
          try {
            await props.onSaveAi({
              ...current,
              version: current.version + 1,
              contentVersion: current.contentVersion ?? current.version,
              updatedAt: now,
              activityGuides: { ...current.activityGuides, [activity.id]: { text: result.answer, createdAt: now } },
            }, current.version);
            break;
          } catch (err) {
            if (attempt === 2) throw err;
            await new Promise((r) => window.setTimeout(r, 120));
          }
        }
      }
    }, generateAllActivityGuides);
  }
  /** Answers append dialogue only. A validated revision additionally captures
   * the prior content for undo and calculates its budget delta without AI math.
   */
  async function sendChat(
    text = message,
    mode: 'auto' | 'edit' | 'apply-suggestion' = 'auto',
    overrideRequest?: PlannerRequest,
    forcedScope?: string | null,
    applySuggestionMessageId?: string,
    applySuggestionId?: string,
    explicitXhsRefs?: XhsReference[],
  ) {
    if (!activePlan || !text.trim()) return false;
    const original = activePlan;
    const aiContent = plannerContentForAi(original);
    const activeXhsRefs = explicitXhsRefs ?? (mode === 'apply-suggestion' ? [] : chatRefs);
    // 文字选择和按钮都提交相同的方案编号；服务端会再次核对范围及版本。
    const choice = mode === 'auto' ? resolvePlannerChoice(text, original.messages) : null;
    if (choice) {
      mode = 'apply-suggestion';
      applySuggestionMessageId = choice.messageId;
      applySuggestionId = choice.suggestion.id;
      forcedScope = choice.suggestion.scopeId;
    }
    const effectiveScope = overrideRequest
      ? null
      : forcedScope !== undefined
        ? forcedScope
        : scopeId;
    return task(
      async (signal) => {
        // 从备用方案、小红书等入口直接发起对话时，也展开原行程的助手供查看结果。
        setOpenChatPlanId(original.id);
        const result = await plannerApi<{
          action: 'answer' | 'revision';
          answer?: string;
          content?: PlannerContent;
          summary?: string;
          suggestion?: PlannerMessage['suggestion'];
          suggestions?: PlannerMessage['suggestions'];
          scopeId?: string | null;
          appliedSuggestionMessageId?: string;
          appliedSuggestionId?: string;
          baseVersion: number;
        }>(
          'chat',
          {
            plan: { ...original, content: aiContent, bookings: undefined, hotels: undefined, history: [] },
            message: text,
            scopeId: effectiveScope,
            applySuggestionMessageId,
            applySuggestionId,
            mode,
            baseVersion: original.version,
            overrideRequest,
            ...(activeXhsRefs.length ? { xhsReferences: activeXhsRefs } : {}),
          },
          signal,
          setStage,
        );
        const current = plansRef.current.find((plan) => plan.id === original.id);
        if (!current || current.version !== result.baseVersion)
          throw new Error('计划已更新，旧 AI 回复未应用。请重新发送。');
        const now = new Date().toISOString();
        let next: AiTravelPlan = {
          ...original,
          version: original.version + 1,
          updatedAt: now,
          contentVersion: original.contentVersion ?? original.version,
        };
        let reply = result.answer ?? '';
        if (result.action === 'revision') {
          if (!result.content) throw new Error('修改内容缺失，原计划已保留');
          enforcePlannerScope(aiContent, result.content, result.scopeId === undefined ? effectiveScope : result.scopeId);
          next = revisePlanner(original, reconcileBookedContent(original, result.content), result.summary ?? 'AI 修改');
          const delta =
            calculatePlannerBudget(next.content).totalCents -
            calculatePlannerBudget(original.content).totalCents;
          reply = `${result.summary}\n预算变化：${delta >= 0 ? '+' : '-'}${priceText(Math.abs(delta))}。可在历史版本中撤销。`;
        }
        if (!reply.trim()) throw new Error('AI 回复为空');
        const assistantMessage: PlannerMessage = {
          id: createLocalId(),
          role: 'assistant',
          text: reply,
          createdAt: now,
          kind: result.action === 'revision' ? 'revision' : 'answer',
          ...(result.action === 'answer' && result.suggestion
            ? { suggestion: result.suggestion }
            : {}),
          ...(result.action === 'answer' && result.suggestions?.length ? { suggestions: result.suggestions } : {}),
        };
        const attachments = activeXhsRefs.length ? summarizeXhsForMessage(activeXhsRefs) : undefined;
        next.messages = [
          ...original.messages.map((item) => {
            if (result.action !== 'revision' || item.id !== (result.appliedSuggestionMessageId ?? applySuggestionMessageId)) return item;
            const id = result.appliedSuggestionId ?? applySuggestionId;
            return { ...item, suggestions: plannerSuggestions(item).map((suggestion) => suggestion.id === id ? { ...suggestion, appliedAt: now } : suggestion) };
          }),
          {
            id: createLocalId(),
            role: 'user' as const,
            text,
            createdAt: now,
            ...(attachments ? { attachments } : {}),
          },
          assistantMessage,
        ];
        if (signal.aborted) return;
        await props.onSaveAi(next, original.version);
        setMessage('');
        if (!explicitXhsRefs) setChatRefs([]);
        setSettings(null);
      },
      async () => { await sendChat(text, mode, overrideRequest, forcedScope, applySuggestionMessageId, applySuggestionId, explicitXhsRefs); },
    );
  }
  function applySuggestion(messageId: string, suggestionId: string): void {
    const source = activePlan?.messages.find((item) => item.id === messageId);
    const suggestion = source && plannerSuggestions(source).find((item) => item.id === suggestionId);
    if (!suggestion || !activePlan) return;
    if (suggestion.baseContentVersion !== (activePlan.contentVersion ?? activePlan.version)) {
      setError('行程已更新，请重新询问后再应用建议。');
      return;
    }
    void sendChat(
      suggestion.instruction,
      'apply-suggestion',
      undefined,
      suggestion.scopeId,
      messageId,
      suggestionId,
    );
  }
  async function applyExternalEdit(nextContent: PlannerContent, summary: string): Promise<void> {
    if (!activePlan) return;
    const original = activePlan;
    const now = new Date().toISOString();
    const next = revisePlanner(original, reconcileBookedContent(original, nextContent), summary || '外部 AI 修改');
    const delta = calculatePlannerBudget(next.content).totalCents - calculatePlannerBudget(original.content).totalCents;
    const reply = `已应用外部 AI 修改：${summary || '行程已更新'}\n预算变化：${delta >= 0 ? '+' : '-'}${priceText(Math.abs(delta))}。可在「历史撤销」中一键恢复。`;
    next.messages = [
      ...original.messages,
      {
        id: createLocalId(),
        role: 'assistant',
        text: reply,
        createdAt: now,
        kind: 'revision',
      },
    ];
    await props.onSaveAi(next, original.version);
    props.onNotice('已应用外部 AI 修改，可在「历史撤销」中随时恢复');
  }
  function focusPlannerChat(): void {
    if (webTourMode) {
      props.onRequireClient?.('ai');
      return;
    }
    if (!activePlan) return;
    // 先提交展开状态，再在同一次点击中聚焦，短屏上也能直接输入。
    if (!chatOpen) flushSync(() => setOpenChatPlanId(activePlan.id));
    const input = document.getElementById('planner-chat-input');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  }

  function openXhsDialog(options: XhsDialogOptions) {
    if (webTourMode) {
      props.onRequireClient?.('ai');
      return;
    }
    // 一次只保留一份导入草稿。其他入口在任务收起时也优先回到这份草稿。
    if (xhsDialog) {
      resumeXhsDialog();
      return;
    }
    setXhsDialog({ ...options, planId: options.mode === 'create' ? null : activePlan?.id ?? null, minimized: false });
  }

  function resumeXhsDialog() {
    if (!xhsDialog) return;
    // 用户可在解析时浏览别的行程，重新打开后仍使用发起导入时的行程。
    if (xhsDialog.planId && !plansRef.current.some((plan) => plan.id === xhsDialog.planId)) {
      setXhsDialog(null);
      props.onError('这次小红书导入对应的行程已不存在。');
      return;
    }
    setTab('itineraries');
    setCreating(xhsDialog.mode === 'create');
    if (xhsDialog.planId) setActiveId(xhsDialog.planId);
    setXhsDialog({ ...xhsDialog, minimized: false });
    props.onReturnToPlanner();
  }
  async function publish() {
    if (!activePlan || busy) return;
    try {
      await props.onPublishAi(activePlan);
      props.onNotice(
        activePlan.linkedTripId
          ? '计划已显式同步，原有实际花费与媒体已保留。'
          : '已加入旅行手账，状态为计划中，地图不会点亮。',
      );
    } catch (failure) {
      report(failure);
    }
  }

  async function recordJournalVisit(activity: PlannerActivity, cityCode?: string) {
    if (!activePlan || journalSaving) return;
    if (!cityCode && !plannerJournalCity(activePlan.content.cities, activity.city)) {
      setJournalCityChoice({ planId: activePlan.id, activityId: activity.id, cityCode: '' });
      return;
    }
    setJournalSaving(true);
    try {
      const { place, cityName } = await props.onSaveJournalVisit(activePlan.id, activity.id, plannerJournalActivityKey(activity), cityCode);
      setJournalCityChoice(null);
      props.onNotice(`「${place.name}」已加入${cityName}的旅行手账，可以去上传照片了。`);
    } catch (failure) {
      props.onError(failure instanceof Error ? failure.message : '景点记录失败，请重试');
    } finally {
      setJournalSaving(false);
    }
  }
  async function saveFavorite(title: string, destination: string, reason: string) {
    const favorites = props.preferences?.favorites ?? [];
    if (favorites.some((item) => item.title === title && item.destination === destination)) return;
    try {
      await props.onSavePreferences({
        id: 'planner',
        base: props.preferences?.base ?? '',
        favorites: [...favorites, { title, destination, reason }],
      });
      props.onNotice('已收藏到发现目的地。');
    } catch (failure) {
      report(failure);
    }
  }
  function editActivity(activity: PlannerActivity, dayIndex: number) {
    setEditing({ dayIndex, activity, isNew: false });
  }
  async function handleExternalAiImported(result: { content: PlannerContent }) {
    validatePlannerContent(result.content);
    const now = new Date().toISOString();
    let plan: AiTravelPlan = {
      id: createLocalId(),
      version: 1,
      contentVersion: 1,
      createdAt: now,
      updatedAt: now,
      linkedTripId: null,
      linkedSnapshot: null,
      content: result.content,
      messages: [],
      history: [],
    };
    for (const booking of draftBookings) {
      const inRange = isTransportBooking(booking) || booking.kind === 'hotel'
        || plan.content.days.some((day) => day.date === booking.date);
      plan = applyBookingToPlan(plan, booking, { updatePlan: inRange });
    }
    if (draftBookings.length) {
      plan = { ...plan, version: 1, contentVersion: 1, history: [] };
      validatePlannerContent(plan.content);
    }
    await props.onSaveAi(plan, null);
    setDraftBookings([]);
    setActiveId(plan.id);
    setCreating(false);
    setDurations([]);
    setError('');
    setTab('itineraries');
    props.onNotice('已通过外部免费 AI 导入行程！现在可自由手动编辑、拉群协作、投票与记 AA 账。');
  }
  async function saveActivity(activity: PlannerActivity) {
    if (!editing || !activePlan) return;
    const content = structuredClone(activePlan.content);
    const day = content.days[editing.dayIndex];
    const previous = day.activities.find((item) => item.id === activity.id);
    // 手动换地点后，原景点查到的寄存地址和价格不能继续显示。
    const placeFields = ['kind', 'city', 'location', 'photoQuery'] as const;
    if (activity.luggageNote && previous && placeFields.some((field) => previous[field] !== activity[field])) {
      activity = { ...activity };
      delete activity.luggageNote;
    }
    day.activities = editing.isNew
      ? [...day.activities, activity]
      : day.activities.map((item) => (item.id === activity.id ? activity : item));
    day.activities.sort((left, right) => left.startTime.localeCompare(right.startTime));
    content.warnings = [
      ...new Set([
        ...content.warnings,
        '手动调整的地点或时间，请核对相邻交通与预约；可让 AI 仅修改当前模块。',
      ]),
    ];
    try {
      validatePlannerContent(content);
      if (await commit(content, '手动编辑模块')) setEditing(null);
    } catch (failure) {
      report(failure);
    }
  }
  async function deleteActivity() {
    if (!editing || !activePlan) return;
    if (editing.isNew) {
      setEditing(null);
      return;
    }
    const content = structuredClone(activePlan.content);
    const id = editing.activity.id;
    content.days[editing.dayIndex].activities = content.days[editing.dayIndex].activities.filter(
      (activity) => activity.id !== id,
    );
    for (const day of content.days)
      for (const activity of day.activities) {
        if (activity.fromActivityId === id) activity.fromActivityId = null;
        if (activity.toActivityId === id) activity.toActivityId = null;
      }
    try {
      validatePlannerContent(content);
      if (await commit(content, '删除模块')) setEditing(null);
    } catch (failure) {
      report(failure);
    }
  }
  function startFor(destination: string) {
    setRequest({
      ...freshPlannerRequest(destination, discover.base),
      startDate: discover.startDate,
      endDate: discover.endDate,
      luggageMode: discover.luggageMode ?? 'suitcase',
      ...(discover.references?.length ? { references: discover.references, referenceMode: discover.referenceMode } : {}),
    });
    setXhsDraft('');
    setCreating(true);
    setDurations([]);
    setTab('itineraries');
  }

  async function savePackingList(packingList: PackingList) {
    if (!activePlan) return;
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    await props.onSaveAi(
      {
        ...current,
        packingList,
        version: current.version + 1,
        contentVersion: current.contentVersion ?? current.version,
        updatedAt: new Date().toISOString(),
      },
      current.version,
    );
  }

  async function saveTicketReminder(activityId: string, patch: Partial<TicketReminderSetting>) {
    if (!activePlan) return;
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    const prev = current.ticketReminders?.[activityId] ?? {
      enabled: false,
      leadMinutes: DEFAULT_TICKET_REMINDER_LEAD_MINUTES,
    };
    const nextLead = patch.leadMinutes != null && Number.isFinite(patch.leadMinutes)
      ? Math.max(1, Math.min(1440, Math.round(patch.leadMinutes)))
      : prev.leadMinutes;
    const nextSetting: TicketReminderSetting = {
      ...prev,
      ...patch,
      leadMinutes: nextLead,
    };
    await props.onSaveAi(
      {
        ...current,
        ticketReminders: {
          ...(current.ticketReminders ?? {}),
          [activityId]: nextSetting,
        },
        version: current.version + 1,
        contentVersion: current.contentVersion ?? current.version,
        updatedAt: new Date().toISOString(),
      },
      current.version,
    );
    if (patch.enabled === true && !prev.enabled) {
      const prefs = readNotificationPrefs();
      if (!prefs.enabled || !prefs.types.ticketReminders) {
        writeNotificationPrefs({
          ...prefs,
          enabled: true,
          types: { ...prefs.types, ticketReminders: true },
        });
      }
      if (getSystemNotificationPermission() === 'default') {
        const perm = await requestSystemNotificationPermission();
        if (perm === 'granted') {
          const latestPrefs = readNotificationPrefs();
          writeNotificationPrefs({ ...latestPrefs, systemPopup: true });
        }
      }
      const merged = mergeTicketPlanItems(current);
      const item = merged.find((entry) => entry.activityId === activityId);
      if (item) {
        const schedule = resolveTicketReminderSchedule(item, nextSetting);
        if (schedule.triggerMs != null) {
          props.onNotice(`已开启抢票通知：将在 ${formatReminderClock(schedule.triggerMs)}（提前 ${nextSetting.leadMinutes} 分钟）提醒你。`);
        } else {
          props.onNotice('已开启抢票通知，请填写开售日期与时刻以准点提醒。');
        }
      }
    } else if (patch.enabled === false && prev.enabled) {
      props.onNotice('已关闭该项抢票通知。');
    }
  }

  async function importBooking(
    booking: BookingRecord,
    options: {
      updatePlan: boolean;
      targetActivityId: string | 'new';
      updateLedger: boolean;
      ledgerMode: 'replace' | 'add';
    },
  ) {
    if (creating) {
      setDraftBookings((previous) => previous.some((item) => item.id === booking.id)
        ? previous.map((item) => item.id === booking.id ? booking : item) : [...previous, booking]);
      return;
    }
    if (!activePlan) throw new Error('当前行程已不存在。');
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    const updatedPlan = applyBookingToPlan(current, booking, {
      updatePlan: options.updatePlan,
      targetActivityId: options.targetActivityId === 'auto' ? undefined : options.targetActivityId,
      backfilledToLedger: options.updateLedger,
    });
    validatePlannerContent(updatedPlan.content);

    let ledgerUpdate: { kind: 'update'; sheet: TripPlan } | { kind: 'publish'; initialFinance: TripPlan } | null = null;
    if (options.updateLedger && booking.amountYuan != null) {
      // 不再静默调用 seedAiExpenses 灌入整程 AI 估算，新账本保持实际花费干净，只写入本笔真实订单。
      if (updatedPlan.linkedTripId) {
        const existingSheet = props.plans.find((sheet) => sheet.tripId === updatedPlan.linkedTripId);
        const content = updatedPlan.content;
        const baseSheet: TripPlan = existingSheet ?? {
          id: updatedPlan.linkedTripId,
          tripId: updatedPlan.linkedTripId,
          cityCode: content.cities[0]?.code ?? '',
          startDate: content.days[0]?.date ?? '',
          endDate: content.days.at(-1)?.date ?? '',
          people: content.request.people,
          budget: emptyAmounts(),
          actual: emptyAmounts(),
          manualActualTotal: null,
          reminderDays: updatedPlan.reminderDays ?? 1,
        };
        ledgerUpdate = { kind: 'update', sheet: applyBookingToLedger(baseSheet, booking, options.ledgerMode) };
      } else {
        const content = updatedPlan.content;
        const categories = calculatePlannerBudget(plannerFillEstimates(content)).categories;
        const initialBudget = emptyAmounts();
        for (const cat of BUDGET_CATEGORIES) initialBudget[cat] = categories[cat] / 100;
        const emptySheet: TripPlan = {
          id: updatedPlan.id,
          cityCode: content.cities[0]?.code ?? '',
          startDate: content.days[0]?.date ?? '',
          endDate: content.days.at(-1)?.date ?? '',
          people: content.request.people,
          budget: initialBudget,
          actual: emptyAmounts(),
          manualActualTotal: null,
          reminderDays: updatedPlan.reminderDays ?? 1,
        };
        ledgerUpdate = { kind: 'publish', initialFinance: applyBookingToLedger(emptySheet, booking, options.ledgerMode) };
      }
    }

    if (props.onSaveAiWithLedger) {
      await props.onSaveAiWithLedger(updatedPlan, current.version, ledgerUpdate);
    } else {
      await props.onSaveAi(updatedPlan, current.version);
      if (ledgerUpdate?.kind === 'update') await props.onSave(ledgerUpdate.sheet);
      else if (ledgerUpdate?.kind === 'publish') await props.onPublishAi(updatedPlan, ledgerUpdate.initialFinance);
    }
    const notes = [
      options.updatePlan ? '已回填到行程' : '已保存到预订列表',
      options.updateLedger && booking.amountYuan != null ? '已回填到每日账本' : '',
    ].filter(Boolean).join('，');
    props.onNotice(`「${booking.hotelName || booking.title}」${notes}。`);
  }

  async function removeBooking(bookingId: string) {
    if (!activePlan) return;
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    try {
      const next = removeBookingFromPlan(current, bookingId);
      validatePlannerContent(next.content);
      const existingSheet = current.linkedTripId
        ? props.plans.find((sheet) => sheet.tripId === current.linkedTripId)
        : undefined;
      const hasLedgerEntry = Boolean(existingSheet?.bookingLedgerEntries?.[bookingId]);
      const ledgerUpdate = existingSheet && hasLedgerEntry
        ? { kind: 'update' as const, sheet: removeBookingFromLedger(existingSheet, bookingId) }
        : null;
      if (props.onSaveAiWithLedger) {
        await props.onSaveAiWithLedger(next, current.version, ledgerUpdate);
      } else {
        await props.onSaveAi(next, current.version);
        if (ledgerUpdate) await props.onSave(ledgerUpdate.sheet);
      }
      props.onNotice(hasLedgerEntry ? '已移除预订，更新行程并同步扣回账本金额。' : '已移除预订并更新对应行程。');
    } catch (error) {
      props.onError(error instanceof Error ? error.message : '移除预订失败。');
    }
  }

  function fillPlannedBooking(leg: ReturnType<typeof pendingTransportLegs>[number]) {
    setBookingDialog({ target: leg.activity.id, initial: {
      ...emptyBookingDraft(leg.kind, leg.date, ''),
      fromLocation: leg.from, toLocation: leg.to,
    } });
  }

  function applyXhsToCreate(refs: XhsReference[], referenceMode: XhsReferenceMode) {
    setRequest((prev) => withXhsReferences(prev, refs, referenceMode));
    setDurations([]);
    props.onNotice(`已挂载 ${refs.length} 篇小红书参考（已选 ${selectedPlacesFromRefs(refs).length} 个地点）。`);
  }

  async function addXhsToWishlist(refs: XhsReference[]) {
    if (!activePlan) return;
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    const { next, addedCount } = referencesToWishlist(refs, current.wishlist ?? []);
    if (!addedCount) {
      props.onNotice('所选地点已经在待选灵感池中。');
      return;
    }
    await props.onSaveAi(
      {
        ...current,
        wishlist: next,
        version: current.version + 1,
        contentVersion: current.contentVersion ?? current.version,
        updatedAt: new Date().toISOString(),
      },
      current.version,
    );
    props.onNotice(`已将 ${addedCount} 个小红书地点加入待选灵感池，可在侧边栏与行程地图查看顺路位置。`);
  }

  async function removeWishlistPlace(wishId: string) {
    if (!activePlan) return;
    const current = plansRef.current.find((plan) => plan.id === activePlan.id);
    if (!current) return;
    await props.onSaveAi(
      {
        ...current,
        wishlist: (current.wishlist ?? []).filter((item) => item.id !== wishId),
        version: current.version + 1,
        contentVersion: current.contentVersion ?? current.version,
        updatedAt: new Date().toISOString(),
      },
      current.version,
    );
    props.onNotice('已从待选灵感池移除该地点。');
  }

  async function scheduleWishlistPlace(item: WishlistPlace, askFirst = true) {
    if (!activePlan || busy) return;
    const prompt = buildXhsInsertPrompt([item], { targetDate: 'auto', mode: 'insert', askFirst });
    const syntheticRef: XhsReference | null = item.sourceUrl
      ? {
          id: `wish-ref-${item.id}`,
          sourceType: 'xhs_link',
          title: item.sourceTitle || `小红书待选 · ${item.name}`,
          url: item.sourceUrl,
          destinations: item.city ? [item.city] : [],
          suggestedDays: null,
          styleTags: [],
          routeOutline: [],
          tips: item.note ? [item.note] : [],
          places: [
            {
              id: item.id,
              name: item.name,
              canonicalName: item.canonicalName,
              city: item.city,
              kind: item.kind,
              dayHint: null,
              note: item.note,
              selected: true,
            },
          ],
        }
      : null;
    focusPlannerChat();
    await sendChat(
      prompt,
      askFirst ? 'auto' : 'edit',
      undefined,
      null,
      undefined,
      undefined,
      syntheticRef ? [syntheticRef] : [],
    );
  }

  async function handleExportHtmlRoadbook() {
    if (!activePlan || exportingHtml) return;
    setExportingHtml(true);
    try {
      const linkedSheet = activePlan.linkedTripId
        ? props.plans.find((sheet) => sheet.tripId === activePlan.linkedTripId) ?? null
        : null;
      await exportOfflineRoadbook(activePlan, linkedSheet);
      props.onNotice('已导出单文件离线 HTML 路书，可直接发给同行人离线查看。');
    } catch (failure) {
      report(failure);
    } finally {
      setExportingHtml(false);
    }
  }

  return (
    <div className="planner-workspace" data-task-running={busy || undefined}>
      <div className="planner-chrome" data-tools-expanded={serviceToolsExpanded}>
        <div className="planner-chrome-bar">
          <div className="planner-tabs" role="tablist" aria-label={t('计划模块', 'Planner sections')}>
            {(
              [
                ['itineraries', t('我的行程', 'My Trips')],
                ['finance', t('预算与账本', 'Budget & Ledger')],
                ['discover', t('发现目的地', 'Discover')],
              ] as const
            ).map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => {
                  if (key === 'finance' && activePlan) setFinanceKey(activePlan.linkedTripId ? `journey:${activePlan.linkedTripId}` : `ai:${activePlan.id}`);
                  setTab(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!webTourMode && (
            <button
              type="button"
              className="mobile-disclosure-toggle planner-service-toggle"
              aria-expanded={serviceToolsExpanded}
              aria-controls="planner-ai-tools"
              onClick={() => setServiceToolsExpanded((expanded) => !expanded)}
            >
              <span>{t('AI 服务设置', 'AI Settings')}</span>
              <small className={aiStatus?.configured ? 'planner-service-summary ok' : 'planner-service-summary'}>
                <i className="planner-service-dot" aria-hidden="true" />
                {aiStatus
                  ? (aiStatus.configured ? (aiStatus.label ?? aiStatus.model ?? t('AI 已配置', 'AI Ready')) : t('AI 待配置', 'Setup AI'))
                  : (aiBackendOffline ? t('AI 未连接', 'AI Offline') : t('AI 检查中', 'Checking AI'))}
              </small>
            </button>
          )}
          {!webTourMode && !isNativeMobileApp() && (
            <div id="planner-photo-tools" className="planner-service-panel planner-xhs-login-desktop">
              <PlannerPhotoSettings />
            </div>
          )}
        </div>
        <div id="planner-ai-tools" className="planner-service-panel">
          {webTourMode ? (
            <div className="tour-planner-notice" role="note">
              <span>{t('🔒 在线体验模式仅展示示例大理路书、路线地图与预算账本；AI 规划、对话微调与离线 OCR 识票为客户端专属能力。', '🔒 Web Tour previews the sample Dali roadbook, route map & ledger; live AI planning and offline OCR are client-only.')}</span>
              <button type="button" className="primary" onClick={() => props.onRequireClient?.('ai')}>
                {t('下载客户端解锁 AI', 'Unlock AI in Client')}
              </button>
            </div>
          ) : (
            <PlannerAiStatusBar
              status={aiStatus}
              offline={aiBackendOffline}
              onOpen={() => setAiSettingsOpen(true)}
              onChange={(next) => {
                setAiStatus(next);
                setAiBackendOffline(false);
              }}
            />
          )}
        </div>
      </div>
      {aiSettingsOpen && createPortal(
        <PlannerAiSettings
          initialOffline={aiBackendOffline}
          onClose={() => setAiSettingsOpen(false)}
          onSaved={(next) => {
            setAiStatus(next);
            setAiBackendOffline(false);
          }}
        />,
        document.body,
      )}
      {externalAiOpen && createPortal(
        <PlannerExternalAiImporter
          request={request}
          onClose={() => setExternalAiOpen(false)}
          onImported={handleExternalAiImported}
        />,
        document.body,
      )}
      {busy && createPortal(
        <div className="planner-status" role="status">
          <span className="planner-spinner" />
          <span className="planner-status-text">{plannerShortStage(stage)}</span>
          {awayFromTask && (
            <button className="secondary" type="button" onClick={() => {
              setTab(taskLocation.tab);
              if (taskLocation.planId) {
                setCreating(false);
                setActiveId(taskLocation.planId);
              }
              props.onReturnToPlanner();
            }}>返回任务</button>
          )}
          <button className="secondary" onClick={cancel}>
            取消生成
          </button>
        </div>,
        document.body,
      )}
      {error && (
        <div className="planner-error" role="alert">
          {plannerDisplayText(error, activePlan?.content)}
          {lastTask && !busy && (
            <button className="text-button" onClick={() => void lastTask()}>
              重试上次 AI 请求
            </button>
          )}
          {!busy && /额度|免费体验|API|登录/.test(error) && (
            <button className="text-button" onClick={() => setExternalAiOpen(true)}>
              借用外部免费 AI 导入
            </button>
          )}
        </div>
      )}

      {tab === 'finance' ? (
        <FinanceView {...props} selectedFinanceKey={financeKey} />
      ) : tab === 'discover' ? (
        <div className="content-page">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SEASONAL DISCOVERY</span>
              <h1>{t('这个时候，去哪玩', 'Where to Go This Season')}</h1>
              <p>{t('从当季看点出发，也考虑你从哪里出发。', 'Seasonal highlights tailored to your departure city and dates.')}</p>
            </div>
          </div>
          <form
            className="card planner-discovery-form"
            onSubmit={(event) => {
              event.preventDefault();
              void recommend();
            }}
          >
            <div className="planner-input-grid">
              <label>
                {t('范围', 'Region')}
                <input
                  value={discover.destination}
                  onChange={(event) =>
                    setDiscover({ ...discover, destination: event.target.value })
                  }
                  placeholder={t('留空推荐全国，也可填写省份', 'Leave blank for nationwide, or enter a province')}
                />
              </label>
              <label>
                {t('开始日期', 'Start Date')}
                <input
                  type="date"
                  required
                  value={discover.startDate}
                  onChange={(event) => setDiscover({ ...discover, startDate: event.target.value })}
                />
              </label>
              <label>
                {t('结束日期（可选）', 'End Date (optional)')}
                <input
                  type="date"
                  min={discover.startDate}
                  value={discover.endDate}
                  onChange={(event) => setDiscover({ ...discover, endDate: event.target.value })}
                />
              </label>
              <label>
                {t('Base／出发地', 'Departure City')}
                <input
                  value={discover.base}
                  onChange={(event) => setDiscover({ ...discover, base: event.target.value })}
                />
              </label>
            </div>
            <label>
              {t('补充要求（可任意填写）', 'Notes (optional)')}
              <textarea
                value={discover.notes}
                rows={3}
                onChange={(event) => setDiscover({ ...discover, notes: event.target.value })}
              />
            </label>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  setDiscover({
                    ...discover,
                    startDate: freshPlannerRequest().startDate,
                    endDate: '',
                  })
                }
              >
                {t('今天', 'Today')}
              </button>
              <button className="primary" disabled={busy}>
                {discover.destination
                  ? t('AI 推荐省内玩法', 'AI Recommend Regional Ideas')
                  : t('AI 推荐全国当季目的地', 'AI Recommend Seasonal Picks')}
              </button>
            </div>
          </form>
          <div className="planner-recommendation-grid">
            {recommendations.map((item, index) => (
              <article className="card planner-recommendation" key={`${item.title}-${index}`}>
                <PlacePhoto
                  photo={item.photo}
                  title={item.title}
                  city={item.destination}
                  date={discover.startDate}
                  autoLoad
                  onResolved={(photo) =>
                    setRecommendations((items) =>
                      items.map((value, ordinal) =>
                        ordinal === index ? { ...value, photo } : value,
                      ),
                    )
                  }
                />
                <div>
                  <span className="eyebrow">
                    {item.season} · {item.suggestedDays}
                  </span>
                  <h2>{item.title}</h2>
                  <p>{item.reason}</p>
                  <p className="muted">{item.access}</p>
                  <Sources ids={item.sourceIds} sources={recommendationSources} />
                  <div className="heading-actions">
                    <button className="primary" onClick={() => startFor(item.destination)}>
                      用这个目的地规划
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void saveFavorite(item.title, item.destination, item.reason)}
                    >
                      收藏
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {(props.preferences?.favorites.length ?? 0) > 0 && (
            <section className="card planner-favorites">
              <h2>收藏与备用目的地</h2>
              {props.preferences!.favorites.map((item, index) => (
                <div key={index}>
                  <strong>{item.title}</strong>
                  <p>{item.reason}</p>
                  <button className="text-button" onClick={() => startFor(item.destination)}>
                    制定计划
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void props
                        .onSavePreferences({
                          ...props.preferences!,
                          favorites: props.preferences!.favorites.filter(
                            (_, ordinal) => ordinal !== index,
                          ),
                        })
                        .catch(report)
                    }
                  >
                    取消收藏
                  </button>
                </div>
              ))}
            </section>
          )}
          {!recommendations.length && (
            <div className="empty-state">
              <h2>{t('让季节替你选一个目的地', 'Let the season inspire your next destination')}</h2>
              <p>{t('选择日期、填写出发地，或从地图点进某省探索。', 'Pick your dates and departure city, or select a province from the map.')}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="content-page">
          <div className="section-heading planner-itinerary-heading">
            <div className="planner-itinerary-heading-copy">
              <span className="eyebrow">YOUR NEXT JOURNEY</span>
              <h1>{t('我的旅行计划', 'My Travel Plans')}</h1>
              <p>{t('先规划，再出发。随时问，明确要求才修改。', 'Plan first, travel smoothly. Ask anytime and revise on your terms.')}</p>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setCreating(true);
                setDurations([]);
                setXhsDraft('');
                setDraftBookings([]);
                setRequest(freshPlannerRequest('', props.preferences?.base ?? ''));
              }}
            >
              {t('＋ 新建 AI 计划', '+ New AI Plan')}
            </button>
          </div>
          {props.aiPlans.length > 0 && (() => {
            const selectPlan = (planId: string) => {
              setActiveId(planId);
              setCreating(false);
              setScopeId(null);
              setChatRefs([]);
              setError('');
            };
            const sortedPlans = [...props.aiPlans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return (
              <>
                {sortedPlans.length > 1 && (
                  <div className="planner-plan-switcher" role="tablist" aria-label={t('切换计划', 'Switch plan')}>
                    {sortedPlans.map((plan) => {
                      const selected = activePlan?.id === plan.id && !creating;
                      const days = plan.content.days;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          className={selected ? 'active' : ''}
                          disabled={busy}
                          onClick={() => selectPlan(plan.id)}
                          title={plan.content.title}
                        >
                          <small>{plan.content.cities.map((city) => city.name).join(' → ') || plan.content.request.destination}</small>
                          <strong>{plan.content.title}</strong>
                          {days.length > 0 && (
                            <em>{days[0].date.slice(5).replace('-', '/')} · {days.length}{t('天', 'd')}</em>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {activePlan && !creating && (
                  <div className="planner-plan-list single">
                    <PlannerPlanCard
                      key={activePlan.id}
                      plan={activePlan}
                      disabled={busy}
                      active
                      onSelect={() => selectPlan(activePlan.id)}
                    />
                  </div>
                )}
              </>
            );
          })()}
          {creating ? (
            <section className="card planner-create">
              <div className="card-heading">
                <h2>这次想怎么玩</h2>
                {activePlan && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => setCreating(false)}
                  >
                    返回已存计划
                  </button>
                )}
              </div>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void generate();
                }}
              >
                <fieldset disabled={busy}>
                  <RequestFields
                    value={request}
                    onChange={(value) => {
                      setRequest(value);
                      setDurations([]);
                    }}
                    extraPreferences={
                      <details className="planner-preferences planner-optional-imports">
                        <summary>
                          <span>行李方式、已订预订与小红书参考（选填）</span>
                          {(draftBookings.length > 0 || (request.references?.length ?? 0) > 0 || xhsDraft.trim() || request.luggageMode === 'backpack') && (
                            <span className="planner-pref-summary-badge">
                              {[
                                request.luggageMode === 'backpack' ? '背包出行' : '',
                                draftBookings.length > 0 ? `${draftBookings.length} 项预订` : '',
                                (request.references?.length ?? 0) > 0
                                  ? `${request.references!.length} 篇参考`
                                  : xhsDraft.trim()
                                    ? '已填攻略文案'
                                    : '',
                              ].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </summary>
                        <div className="planner-optional-imports-body">
                          <PlannerLuggageField value={request.luggageMode} onChange={(luggageMode) => {
                            setRequest((previous) => ({ ...previous, luggageMode }));
                            setDurations([]);
                          }} />
                          <div className="booking-backfill-box">
                            <div className="heading-actions">
                              <strong>已订车票 / 机票 / 酒店</strong>
                              <button type="button" className="secondary" onClick={() => setBookingDialog({})}>＋ 提前录入预订</button>
                            </div>
                            {!draftBookings.length && <p className="muted">可先按预估生成行程，购票后再补填。</p>}
                            {draftBookings.map((booking) => <div key={booking.id} className="heading-actions">
                              <span>{booking.date} · {booking.title}</span>
                              <button type="button" className="text-button" aria-label={`编辑 ${booking.title}`}
                                onClick={() => setBookingDialog({ initial: booking, editing: true })}>编辑</button>
                              <button type="button" className="text-button" aria-label={`移除 ${booking.title}`}
                                onClick={() => setDraftBookings((items) => items.filter((item) => item.id !== booking.id))}>移除</button>
                            </div>)}
                          </div>
                          <div className="xhs-ref-banner">
                            <div className="xhs-ref-banner-top">
                              <div>
                                <label className="xhs-ref-label" htmlFor="planner-xhs-draft">小红书参考（可选）</label>
                                <p id="planner-xhs-draft-hint">最多 {MAX_XHS_REFERENCES} 篇。AI 会结合你的日期、路线和同行需求，挑选适合的内容。</p>
                              </div>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => openXhsDialog({ mode: 'create' })}
                              >
                                {request.references?.length ? '管理参考 / 导入截图' : '导入截图 / 攻略'}
                              </button>
                            </div>
                            <textarea
                              id="planner-xhs-draft"
                              aria-describedby="planner-xhs-draft-hint"
                              rows={2}
                              placeholder="粘贴小红书链接或整段分享文案，多篇可以分行粘贴"
                              value={xhsDraft}
                              onChange={(event) => {
                                setXhsDraft(event.target.value);
                                setDurations([]);
                              }}
                            />
                            {request.references && request.references.length > 0 && <>
                              <div className="xhs-ref-banner-top">
                                <div>
                                  <strong>已添加 {request.references.length} 篇参考</strong>
                                  <p>{request.references.map((ref) => `「${ref.title}」`).join('、')}</p>
                                </div>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => {
                                    setRequest((prev) => {
                                      const { references: _refs, referenceMode: _mode, ...rest } = prev;
                                      return rest;
                                    });
                                    setDurations([]);
                                  }}
                                >
                                  清除已添加的参考
                                </button>
                              </div>
                              <div className="xhs-ref-banner-modes" role="group" aria-label="参考方式">
                                {XHS_REFERENCE_MODE_OPTIONS.map((opt) => (
                                  <label key={opt.value}>
                                    <input
                                      type="radio"
                                      name="create-xhs-mode"
                                      checked={(request.referenceMode ?? DEFAULT_XHS_REFERENCE_MODE) === opt.value}
                                      onChange={() => {
                                        setRequest((prev) => ({ ...prev, referenceMode: opt.value }));
                                        setDurations([]);
                                      }}
                                    />
                                    {opt.label}
                                  </label>
                                ))}
                              </div>
                            </>}
                          </div>
                        </div>
                      </details>
                    }
                  />
                  <div className="heading-actions" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <button className="primary" type="submit">
                      {xhsDraft.trim()
                        ? '读取小红书并规划'
                        : !request.destination.trim()
                          ? '让 AI 推荐目的地'
                          : request.days || request.endDate
                            ? (aiStatus?.searchAvailable === false ? 'AI 生成旅行计划' : '联网生成旅行计划')
                            : '先让 AI 建议玩几天'}
                    </button>
                    {!webTourMode && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setExternalAiOpen(true)}
                        title="复制提示词去豆包 / DeepSeek / Kimi / 腾讯元宝免费生成，再粘贴一键导入"
                      >
                        ✨ 借用外部免费 AI 生成（0 成本）
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
              {durations.length > 0 && (
                <div className="planner-duration-options">
                  <h3>选一种时长，再展开完整行程</h3>
                  {durations.map((option) => (
                    <button
                      key={option.days}
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        const next = updatePlannerDates(request, { days: option.days });
                        setRequest(next);
                        void generate(next);
                      }}
                    >
                      <strong>
                        {option.days} 天 · {option.title}
                      </strong>
                      <span>{option.reason}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : activePlan && budget ? (
            <>
              <section className="card planner-overview" aria-labelledby="planner-overview-heading">
                {/* 行程卡已展示名称与日期，操作区只保留能继续查看或操作的入口。 */}
                <header className="planner-overview-header">
                  <div className="planner-overview-heading">
                    <h2 id="planner-overview-heading">行程安排</h2>
                    <CityGuideLinks cities={activePlan.content.cities.map((city) => city.name)} />
                  </div>
                  {props.aiPlans.length > 1 && (
                    <label className="planner-overview-switch">
                      切换行程
                      <select aria-label="当前行程" value={activePlan.id} onChange={(event) => setActiveId(event.target.value)}>
                        {props.aiPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.content.title} · {plan.content.days[0].date}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </header>
                {props.onOpenAuth && props.onSyncNow && (
                  <PlanCollabBar
                    plan={activePlan}
                    cloudUser={props.cloudUser ?? null}
                    onOpenAuth={props.onOpenAuth}
                    onPlanReverted={async (restored) => {
                      await props.onSaveAi({ ...restored, version: activePlan.version + 1 }, activePlan.version);
                    }}
                    onSyncNow={props.onSyncNow}
                    onExecutePollOption={(prompt) => {
                      setScopeId(null);
                      focusPlannerChat();
                      void sendChat(prompt, 'edit', undefined, null);
                    }}
                    onNotice={props.onNotice}
                    onError={props.onError}
                  />
                )}
                <div className="planner-overview-timeline" key={activePlan.id}>
                  <PlannerTripTimeline content={activePlan.content} />
                  <PlannerCalendarExport plan={activePlan} disabled={busy}
                    initialReminderDays={props.plans.find((plan) => plan.tripId === activePlan.linkedTripId)?.reminderDays ?? 1}
                    onSave={props.onSaveAi} onError={props.onError} />
                </div>
                <div className="planner-overview-actions" role="group" aria-label="行程操作">
                  {/* 主操作区：高频核心动作（预算账本 + 一键攻略） */}
                  <div className="planner-actions-primary">
                    <button
                      type="button"
                      className="planner-cta-btn is-primary"
                      onClick={() => {
                        setFinanceKey(activePlan.linkedTripId ? `journey:${activePlan.linkedTripId}` : `ai:${activePlan.id}`);
                        setTab('finance');
                      }}
                    >
                      <span className="planner-cta-ic" aria-hidden="true">¥</span>
                      <span>预算与账本</span>
                    </button>
                    {(() => {
                      const sightList = activePlan.content.days.flatMap((d) =>
                        plannerActivitiesByTime(d.activities).filter((a) => a.kind === 'sight' && !a.bookingId),
                      );
                      if (!sightList.length) return null;
                      const missingCount = sightList.filter((a) => !activePlan.activityGuides?.[a.id]).length;
                      return (
                        <button
                          className="planner-cta-btn is-accent"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (webTourMode) {
                              props.onRequireClient?.('ai');
                              return;
                            }
                            void generateAllActivityGuides();
                          }}
                        >
                          <span className="planner-cta-ic" aria-hidden="true">✦</span>
                          <span>{missingCount > 0 ? `生成攻略 (${missingCount})` : '重生成攻略'}</span>
                        </button>
                      );
                    })()}
                  </div>

                  {/* 快捷工具坞：紧凑图标+短标签，桌面单行/手机四列，零截断 */}
                  <div className="planner-actions-tools">
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title="小红书加景点 / 改计划"
                      disabled={busy}
                      onClick={() => openXhsDialog({ mode: 'plan', initialTab: 'add-places' })}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">✦</span>
                      <span>小红书加点</span>
                    </button>
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title="导入车次 / 酒店"
                      disabled={busy}
                      onClick={() => {
                        if (webTourMode) {
                          props.onRequireClient?.('ai');
                          return;
                        }
                        setBookingDialog({});
                      }}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">＋</span>
                      <span>车次酒店</span>
                    </button>
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title="修改日期与出行条件"
                      disabled={busy}
                      onClick={() => {
                        setSettings(structuredClone(activePlan.content.request));
                        setScopeId(null);
                      }}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">⚙</span>
                      <span>出行条件</span>
                    </button>
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title={activePlan.linkedTripId ? '同步到旅行手账' : '加入旅行手账'}
                      disabled={busy}
                      onClick={() => void publish()}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">▤</span>
                      <span>{activePlan.linkedTripId ? '同步手账' : '加入手账'}</span>
                    </button>
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title="导出离线 HTML 路书"
                      disabled={busy || exportingHtml}
                      onClick={() => void handleExportHtmlRoadbook()}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">↓</span>
                      <span>{exportingHtml ? '打包中…' : '离线HTML'}</span>
                    </button>
                    <button
                      type="button"
                      className="planner-tool-btn"
                      title="导出文字行程"
                      onClick={() => {
                        const text = [
                          activePlan.content.title,
                          activePlan.content.summary,
                          ...activePlan.content.days.flatMap((day) => [
                            `\n${day.date} ${day.title}`,
                            day.weather,
                            ...plannerActivitiesByTime(day.activities).map((activity) => {
                              const transfer = plannerTransferDisplay(activity, activitiesById);
                              const options = activity.kind === 'transport'
                                ? plannerTransferOptions(activity, activePlan.content.request)
                                : [];
                              return [
                                `${activity.startTime}—${activity.endTime} ${transfer?.route || activity.title}${activity.location ? ` · ${activity.location}` : ''}`,
                                ...(options.length
                                  ? options.map((opt) => formatTransferOption(opt).summaryText)
                                  : [transfer?.details]),
                                activity.description,
                                activePlan.content.request.luggageMode !== 'backpack' && plannerLuggageNoteText(activity),
                              ].filter(Boolean).join('\n');
                            }),
                            ...(day.lodging
                              ? [`住宿搜索：${day.lodging.searchKeyword}（${day.lodging.reason}）`]
                              : []),
                          ]),
                          `\n预算：${priceText(budget.totalCents)}；人均 ${priceText(Math.round(budget.totalCents / activePlan.content.request.people))}`,
                          ...budget.items.map(
                            (item) => `${item.label}：${priceText(item.totalCents)}`,
                          ),
                        ].join('\n');
                        downloadBlob(
                          new Blob([plannerExportText(text, activePlan.content)], { type: 'text/plain;charset=utf-8' }),
                          `${activePlan.content.title}.txt`,
                        );
                      }}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">≡</span>
                      <span>文字行程</span>
                    </button>
                    <button
                      type="button"
                      className={`planner-tool-btn${showHistory ? ' is-active' : ''}`}
                      title="历史版本 / 撤销"
                      disabled={busy}
                      aria-expanded={showHistory}
                      onClick={() => setShowHistory(!showHistory)}
                    >
                      <span className="planner-tool-ic" aria-hidden="true">↺</span>
                      <span>历史撤销</span>
                    </button>
                  </div>
                </div>
              </section>
              <PlannerConversation
                plan={activePlan}
                open={chatOpen}
                onToggle={() => setOpenChatPlanId(chatOpen ? null : activePlan.id)}
                scopeId={scopeId}
                message={message}
                busy={busy}
                onScopeChange={setScopeId}
                onMessageChange={setMessage}
                onSend={() => void sendChat()}
                onApplySuggestion={applySuggestion}
                onApplyExternalEdit={applyExternalEdit}
                onConfigureAi={() => setAiSettingsOpen(true)}
                aiLabel={aiStatus?.configured ? (aiStatus.label ?? aiStatus.model ?? '').split(' · ')[0] : ''}
                attachedRefs={chatRefs}
                onOpenXhsAttach={(files) => openXhsDialog({ mode: 'chat', initialFiles: files })}
                onRemoveAttachedRef={(id) => setChatRefs((prev) => prev.filter((item) => item.id !== id))}
                cloudUser={props.cloudUser ?? null}
                onExecutePollOption={(prompt) => {
                  setScopeId(null);
                  void sendChat(prompt, 'edit', undefined, null);
                }}
                onNotice={props.onNotice}
                onError={props.onError}
              />
              <button className="planner-ai-launcher" type="button" aria-expanded={chatOpen}
                aria-controls="planner-conversation-body" onClick={focusPlannerChat}>
                ✦ 问 AI / 修改
              </button>
              <PlannerMap key={activePlan.id} content={activePlan.content} hotels={activePlan.hotels}
                wishlist={activePlan.wishlist ?? []}
                savedPositions={activePlan.mapPositions}
                onSavePositions={async (positions) => {
                  await savePlannerMapPositions(activePlan.id, positions);
                  markCloudRecordDirty('aiPlans', activePlan.id);
                }}
                onScheduleWishlist={(item) => void scheduleWishlistPlace(item, true)} />
              {showHistory && (
                <section className="card planner-history">
                  <h3>恢复会保留当前版本，随时可再次撤销</h3>
                  {activePlan.history.length ? (
                    [...activePlan.history].reverse().map((revision) => (
                      <div key={`${revision.version}-${revision.savedAt}`}>
                        <span>
                          v{revision.version} · {plannerDisplayText(revision.reason, revision.content)} ·{' '}
                          {new Date(revision.savedAt).toLocaleString('zh-CN')}
                        </span>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void commit(
                              structuredClone(revision.content),
                              `恢复版本 v${revision.version}`,
                            )
                          }
                        >
                          恢复这个版本
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>还没有历史修改。</p>
                  )}
                </section>
              )}
              <div className="planner-utility-stack">
              {(() => {
                const allTicketItems = mergeTicketPlanItems(activePlan);
                const isFreeOrNoBooking = (item: (typeof allTicketItems)[number]) => {
                  if (item.fromUnpurchasedBookingId) return false;
                  if (item.bookingRequired === false) return true;
                  if (item.activityId.startsWith('train-') || item.saleDate || item.saleTime) return false;
                  if (['难', '中', '易'].includes(item.difficulty)) return false;
                  // 未查到收费/抢票规则且难度为待核实的普通景点，默认视为免费开放或现场入园，不单列占位
                  return item.difficulty === '待核实' && (!item.platform || item.platform.includes('待核实'));
                };
                const needBookingItems = allTicketItems.filter((item) => !isFreeOrNoBooking(item));
                const freeItems = allTicketItems.filter((item) => isFreeOrNoBooking(item));
                const activeReminderCount = needBookingItems.filter(
                  (item) => activePlan.ticketReminders?.[item.activityId]?.enabled,
                ).length;
                const ticketUrgency = getUpcomingTicketUrgency(activePlan, ticketNowMs);
                return (
                  <details className={`planner-notes planner-ticket-plan${ticketUrgency.urgentCount > 0 ? ' is-urgent' : ''}`} aria-label="抢票计划">
                    <summary>
                      <span className="planner-notes-title">
                        抢票计划
                        {ticketUrgency.urgentCount > 0 && (
                          <i className="planner-ticket-red-dot" aria-label={`有 ${ticketUrgency.urgentCount} 项即将开抢`} />
                        )}
                      </span>
                      <span className="planner-notes-badges">
                        {ticketUrgency.urgentCount > 0 && (
                          <span className="packing-badge is-urgent">{ticketUrgency.soonestLabel || '即将开抢'}</span>
                        )}
                        {needBookingItems.length > 0 && <span className="packing-badge">{needBookingItems.length} 项</span>}
                        {activeReminderCount > 0 && <span className="packing-badge is-reminder">已开 {activeReminderCount} 个提醒</span>}
                      </span>
                    </summary>
                    {ticketStatus.key === `${activePlan.id}:${ticketSignature}` && ticketStatus.stage && <p role="status">{ticketStatus.stage}</p>}
                    {ticketStatus.key === `${activePlan.id}:${ticketSignature}` && ticketStatus.error && <p role="alert">抢票计划自动生成失败：{ticketStatus.error}</p>}
                    {!activePlan.ticketPlan && needBookingItems.length === 0 && <p>抢票计划将自动生成，行程修改后自动更新；录入“未购买”的车次或航班也会立即加入这里。</p>}
                    {activePlan.ticketPlan && activePlan.ticketPlan.signature !== ticketSignature && <p role="status">行程已变化，正在自动更新；以下为上次查询结果。</p>}
                    {activePlan.ticketPlan && needBookingItems.length === 0 && <p>当前行程暂无需要提前抢票的收费或限流项目。</p>}
                    {needBookingItems.length > 0 && (
                      <div className="planner-ticket-list">
                        {needBookingItems.map((item) => {
                          const reminder = activePlan.ticketReminders?.[item.activityId];
                          const enabled = Boolean(reminder?.enabled);
                          const leadMinutes = reminder?.leadMinutes ?? DEFAULT_TICKET_REMINDER_LEAD_MINUTES;
                          const schedule = resolveTicketReminderSchedule(item, reminder);
                          const itemUrgent = isTicketReminderUrgent(item, reminder, ticketNowMs);
                          const playDateEndMs = item.travelDate ? Date.parse(`${item.travelDate}T23:59:59`) : NaN;
                          const isExpired = Number.isFinite(playDateEndMs) && ticketNowMs > playDateEndMs;
                          const isSold = !isExpired && schedule.saleMs != null && ticketNowMs > schedule.saleMs + 30 * 60_000;
                          const isLive = !isExpired && !isSold && schedule.saleMs != null && ticketNowMs >= schedule.saleMs;
                          const saleDisplay = `${schedule.dateStr || item.saleDate || '提前预约'}${
                            schedule.hasExplicitTime ? ` · ${schedule.timeStr}` : item.saleTime ? ` · ${item.saleTime}` : ''
                          }`;
                          const diffClass = item.difficulty === '难'
                            ? 'is-hard'
                            : item.difficulty === '中'
                              ? 'is-medium'
                              : item.difficulty === '易'
                                ? 'is-easy'
                                : '';
                          const noteText = plannerDisplayText(item.note, activePlan.content);
                          const previewText = isExpired
                            ? '已过期（出行游玩日已过）'
                            : isSold && schedule.saleMs != null
                              ? `已开售（${formatReminderClock(schedule.saleMs)}，建议前往查看余票或候补）`
                              : isLive && schedule.saleMs != null
                                ? `🔥 正在开抢（${formatReminderClock(schedule.saleMs)}）`
                                : schedule.triggerMs != null
                                  ? `${enabled ? '将在' : '开启后将于'} ${formatReminderClock(schedule.triggerMs)} 提醒（关页时建议导出日历）`
                                  : '填写开售日期与时刻后即可按时提醒';
                          const previewTone = isLive
                            ? 'is-live'
                            : itemUrgent
                              ? 'is-urgent'
                              : enabled && !isExpired && !isSold
                                ? 'is-active'
                                : '';
                          return (
                            <article
                              className={`planner-ticket-item${itemUrgent ? ' is-urgent' : enabled ? ' is-enabled' : ''}${isExpired || isSold ? ' is-past' : ''}`}
                              key={item.activityId}
                            >
                              <div className="planner-ticket-item-head">
                                <div className="planner-ticket-item-title-wrap">
                                  <h4>{plannerDisplayText(item.title)}</h4>
                                  {item.difficulty && item.difficulty !== '待核实' && (
                                    <span className={`planner-ticket-diff-tag ${diffClass}`}>
                                      {item.difficulty === '难' ? '难抢 · 优先准备' : `难度：${item.difficulty}`}
                                    </span>
                                  )}
                                  {item.fromUnpurchasedBookingId && (
                                    <span className="booking-unpurchased-tag">未购买车次/航班</span>
                                  )}
                                  {itemUrgent && (
                                    <span className="planner-ticket-urgent-pill">
                                      <i className="planner-ticket-red-dot" />
                                      {isLive ? '正在开抢' : '即将开抢'}
                                    </span>
                                  )}
                                </div>
                                <span className="planner-ticket-sale-pill" title="预计开售时间">
                                  <span className="planner-ticket-sale-k">开售</span>
                                  <strong>{saleDisplay}</strong>
                                </span>
                              </div>
                              <div className="planner-ticket-item-meta">
                                {item.travelDate && (
                                  <span className="planner-ticket-meta-chip">使用日期：{item.travelDate}</span>
                                )}
                                {item.platform && !item.platform.includes('待核实') && (
                                  <span className="planner-ticket-meta-chip">渠道：{item.platform}</span>
                                )}
                              </div>
                              {noteText && <p className="planner-ticket-item-note">{noteText}</p>}
                              <div className={`planner-ticket-reminder-bar${enabled ? ' is-enabled' : ''}${itemUrgent ? ' is-urgent' : ''}`}>
                                <div className="planner-ticket-reminder-controls">
                                  <button
                                    type="button"
                                    className={enabled ? 'primary planner-ticket-notify-btn' : 'secondary planner-ticket-notify-btn'}
                                    disabled={busy}
                                    aria-pressed={enabled}
                                    onClick={() => void saveTicketReminder(item.activityId, { enabled: !enabled, leadMinutes })}
                                  >
                                    {enabled ? '🔔 已开启通知' : '🔕 开启抢票通知'}
                                  </button>
                                  <label className="planner-ticket-lead-input">
                                    <span>提前</span>
                                    <input
                                      type="number"
                                      min={1}
                                      max={1440}
                                      step={1}
                                      disabled={busy}
                                      value={leadMinutes}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        if (Number.isFinite(val) && val >= 1) {
                                          void saveTicketReminder(item.activityId, { enabled, leadMinutes: val });
                                        }
                                      }}
                                    />
                                    <span>分钟</span>
                                  </label>
                                  {(!item.saleDate || Boolean(reminder?.customSaleDate)) && (
                                    <label className="planner-ticket-time-input">
                                      <span>开售日</span>
                                      <input
                                        type="date"
                                        disabled={busy}
                                        value={reminder?.customSaleDate ?? schedule.dateStr}
                                        onChange={(e) => void saveTicketReminder(item.activityId, {
                                          enabled,
                                          leadMinutes,
                                          customSaleDate: e.target.value,
                                        })}
                                      />
                                    </label>
                                  )}
                                  {(!schedule.hasExplicitTime || Boolean(reminder?.customSaleTime)) && (
                                    <label className="planner-ticket-time-input">
                                      <span>时刻</span>
                                      <input
                                        type="time"
                                        disabled={busy}
                                        value={reminder?.customSaleTime ?? schedule.timeStr}
                                        onChange={(e) => void saveTicketReminder(item.activityId, {
                                          enabled,
                                          leadMinutes,
                                          customSaleTime: e.target.value,
                                        })}
                                      />
                                    </label>
                                  )}
                                </div>
                                <small className={`planner-ticket-reminder-preview${previewTone ? ` ${previewTone}` : ''}`}>
                                  {previewText}
                                </small>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    {freeItems.length > 0 && (
                      <div className="planner-ticket-free-summary">
                        <strong>免费 / 无需提前抢票：</strong>
                        <span>{freeItems.map((item) => plannerDisplayText(item.title)).join('、')}</span>
                        <small>（免费开放或现场直接入园，具体以现场公告为准）</small>
                      </div>
                    )}
                  </details>
                );
              })()}
              <PlannerPackingList
                plan={activePlan}
                preferences={props.preferences}
                disabled={busy}
                onSavePacking={savePackingList}
                onSavePreferences={props.onSavePreferences}
                onSharePacking={() => setShareModalData(buildPackingShareData(activePlan))}
                onNotice={props.onNotice}
                onError={props.onError}
              />
              <PlannerBookingsSummary
                key={activePlan.id}
                plan={activePlan}
                disabled={busy}
                onOpenImporter={() => setBookingDialog({})}
                onFillLeg={fillPlannedBooking}
                onEditBooking={(booking) => setBookingDialog({ initial: booking, editing: true })}
                onRemoveBooking={removeBooking}
              />
              <details className="planner-notes planner-reminders-panel" aria-label="出行提醒与待核对事项">
                <summary>
                  <span className="planner-notes-title">出行提醒与待核对事项</span>
                  <span className="planner-notes-badges">
                    {itineraryWarnings.length > 0
                      ? <span className="packing-badge">{itineraryWarnings.length} 条</span>
                      : <span className="packing-badge is-muted">可分享</span>}
                  </span>
                </summary>
                <div className="packing-toolbar">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setShareModalData(buildTripReminderShareData(activePlan, itineraryWarnings))}
                  >
                    📤 发送出行提醒到群里 / 个人
                  </button>
                </div>
                {itineraryWarnings.length > 0 ? (
                  itineraryWarnings.map(
                    (warning, index) => (
                      <p key={index}>{plannerDisplayText(warning, activePlan.content)}</p>
                    ),
                  )
                ) : (
                  <p className="muted">当前行程暂无时间冲突或额外待核对事项，仍可一键将出发日期、待购票及抢票提醒发到群里或好友。</p>
                )}
              </details>
              </div>
              <div className="planner-workbench">
                <div className="planner-itinerary">
                  {activePlan.content.days.map((day, dayIndex) => {
                    const bookedHotel = hotelBookingForDay(activePlan, day.date);
                    const dayOrdered = plannerActivitiesByTime(day.activities);
                    const prevById = new Map<string, PlannerActivity>();
                    for (let i = 1; i < dayOrdered.length; i += 1) {
                      prevById.set(dayOrdered[i].id, dayOrdered[i - 1]);
                    }
                    return (
                    <section className="planner-day" id={plannerDayAnchor(day.date)} tabIndex={-1} key={day.date}>
                      <div className="planner-day-heading">
                        <span>DAY {dayIndex + 1}</span>
                        <div>
                          <h2>{plannerDisplayText(day.title, activePlan.content)}</h2>
                          <p>
                            {day.date} · {plannerDisplayText(day.weather, activePlan.content)}
                          </p>
                        </div>
                      </div>
                      {day.activities.some((item) => item.bookingTiming?.deferred === 'no-time') && <p className="planner-banner">
                        预订时间和接驳已预留，以下活动暂未排入时间轴：{day.activities.filter((item) => item.bookingTiming?.deferred === 'no-time').map((item) => item.title).join('、')}。
                      </p>}
                      {Object.entries(PLANNER_PERIODS).map(([period, label]) => (
                        <div className="planner-period" key={period}>
                          <h3>{label}</h3>
                          {plannerActivitiesByTime(day.activities.filter((activity) => activity.period === period))
                            .map((activity) => {
                              const transfer = plannerTransferDisplay(activity, activitiesById);
                              const booking = activePlan.bookings?.find((item) => item.id === activity.bookingId);
                              if (booking && isTransportBooking(booking)) return <TransportBookingCard
                                key={activity.id} booking={booking} disabled={busy}
                                onEdit={() => setBookingDialog({ initial: booking, editing: true })} />;
                              const savedActTransfers = activity.kind === 'transport' && !activity.transferOptions?.length
                                ? activePlan.legTransfers?.[plannerTransportActivityKey(activity, activePlan.content.request)]
                                : undefined;
                              // 旧行程补查到的市内交通选项也使用可切换的紧凑交通条。
                              const transferActivity = savedActTransfers?.length ? { ...activity, transferOptions: savedActTransfers } : activity;
                              const compactTransfer = !booking && isIntraCityTransferCard(transferActivity, activitiesById, day.activities);
                              const transferOptions = activity.kind === 'transport' && !booking
                                ? plannerTransferOptions(transferActivity, activePlan.content.request)
                                : [];
                              const prevActivity = prevById.get(activity.id);
                              const prevBooking = prevActivity ? activePlan.bookings?.find((item) => item.id === prevActivity.bookingId) : undefined;
                              const gapTransfer = !booking && !(prevBooking && isTransportBooking(prevBooking))
                                ? plannerGapTransfer(prevActivity, activity, activePlan.content.request)
                                : null;
                              const directGapOptions = gapTransfer ? activePlan.legTransfers?.[gapTransfer.key] : undefined;
                              const journalVisit = activity.kind === 'sight' ? plannerJournalVisitFor(activePlan, activity) : undefined;
                              const chooseJournalCity = journalCityChoice?.planId === activePlan.id
                                && journalCityChoice.activityId === activity.id;
                              const cardContent = (
                                <>
                                  {activity.kind === 'sight' && (
                                    <PlacePhoto
                                      key={`${activity.id}-${activity.location}`}
                                      photo={activity.photo}
                                      title={activity.photoQuery || activity.title}
                                      city={activity.city}
                                      location={activity.location}
                                      date={day.date}
                                      autoLoad
                                      onResolved={(photo) =>
                                        void props.onSaveAiPhoto(activePlan.id, activity.id, photo).catch(report)
                                      }
                                    />
                                  )}
                                  <div className="planner-activity-content">
                                    <div className="planner-activity-meta">
                                      <span>
                                        {activity.startTime}—{activity.endTime}
                                      </span>
                                      <span>
                                        {kindLabels[activity.kind]}
                                        {!transfer && ` · ${plannerDurationLabel(activity.startTime, activity.endTime)}`}
                                        {activity.locked ? ' · 已锁定' : ''}
                                        {journalVisit ? ' · 已游玩' : ''}
                                      </span>
                                    </div>
                                    {!compactTransfer && (() => {
                                      const scenicGrade = !transfer ? plannerActivityScenicGrade(activity, activePlan.content.unvisitedHighlights) : '';
                                      return (
                                        <h3 className={scenicGrade ? 'planner-activity-title-row' : undefined}>
                                          <button
                                            className="planner-title-button"
                                            disabled={busy || activity.locked}
                                            onClick={() => booking ? setBookingDialog({ initial: booking, editing: true }) : editActivity(activity, dayIndex)}
                                          >
                                            {plannerDisplayText(transfer?.route || activity.title, activePlan.content)}
                                          </button>
                                          {scenicGrade && <span className="planner-unvisited-grade">{scenicGrade}</span>}
                                        </h3>
                                      );
                                    })()}
                                    {!compactTransfer && (transfer ? (
                                      transferOptions.length > 0 ? (
                                        <div className="planner-transfer-options-list is-full-card">
                                          {transferOptions.map((option, index) => (
                                            <TransferOptionRow
                                              key={`${option.mode}-${index}`}
                                              option={option}
                                              content={activePlan.content}
                                              recommended={transferOptions.length > 1 && Boolean(option.recommended)}
                                            />
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="planner-transfer-details">
                                          <CuteTransportIcon mode="other" size={20} />
                                          <span>{plannerDisplayText(transfer.details, activePlan.content)}</span>
                                        </p>
                                      )
                                    ) : (
                                      <p className="muted">
                                        {plannerDisplayText(
                                          [activity.city, activity.location, gapTransfer?.hasHint ? '' : activity.transportMode]
                                            .filter(Boolean)
                                            .join(' · '),
                                          activePlan.content,
                                        )}
                                      </p>
                                    ))}
                                    {activity.description && <p>{plannerDisplayText(activity.description, activePlan.content)}</p>}
                                  {activePlan.content.request.luggageMode !== 'backpack' && activity.luggageNote && (
                                    <p className="planner-luggage-note">
                                      {plannerLuggageNoteText(activity)}{' '}
                                      {activity.luggageNote.searchQuery && (
                                        <a
                                          href={xiaohongshuSearchUrl(activity.luggageNote.searchQuery)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            openXiaohongshuSearch(activity.luggageNote!.searchQuery!);
                                          }}
                                        >去小红书查寄存</a>
                                      )}
                                    </p>
                                  )}
                                  {activity.costs.map(shownCost).map((cost) => (
                                    <div className="planner-price" key={cost.id}>
                                      <span>{plannerDisplayText(cost.label, activePlan.content)}</span>
                                      <strong>
                                        {cost.includedIn
                                          ? '套餐已含'
                                          : cost.unit === 'ticket'
                                            ? ticketPriceText(cost, activePlan.content.request)
                                            : `${costPriceText(cost)} / ${costLabels[cost.unit]}`}
                                      </strong>
                                      <small>
                                        {[costStatusLabels[cost.status],
                                          plannerDisplayText(cost.qualification, activePlan.content)].filter(Boolean).join(' · ')}
                                      </small>
                                    </div>
                                  ))}
                                  <Sources
                                    ids={[
                                      ...new Set([
                                        ...activity.sourceIds,
                                        ...(activePlan.content.request.luggageMode !== 'backpack' && activity.luggageNote?.sourceId ? [activity.luggageNote.sourceId] : []),
                                        ...activity.costs.flatMap((cost) => cost.sourceIds),
                                      ]),
                                    ]}
                                    sources={activePlan.content.sources}
                                  />
                                  <div className="planner-activity-actions">
                                    {!booking && <button className="text-button" disabled={busy}
                                      title={activePlan.activityGuides?.[activity.id] ? '重新生成详细攻略' : 'AI 详细攻略'}
                                      aria-label={activePlan.activityGuides?.[activity.id] ? '重新生成详细攻略' : 'AI 详细攻略'}
                                      onClick={() => void generateActivityGuide(activity)}>
                                      {activePlan.activityGuides?.[activity.id] ? '重生成攻略' : '详细攻略'}
                                    </button>}
                                    <a
                                      className="text-button"
                                      href={mapPlaceLinks({ city: activity.city, name: activity.location || activity.photoQuery || activity.title }).webUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        openMapAppPlace({ city: activity.city, name: activity.location || activity.photoQuery || activity.title });
                                      }}
                                      aria-label={`在${mapAppLabel()}查看`}
                                      title={`在${mapAppLabel()}查看`}
                                    >{mapAppLabel()}</a>
                                    <button
                                      className="text-button"
                                      disabled={busy || activity.locked}
                                      onClick={() => booking ? setBookingDialog({ initial: booking, editing: true }) : editActivity(activity, dayIndex)}
                                    >
                                      {booking ? '编辑预订' : '编辑'}
                                    </button>
                                    <button
                                      className="text-button"
                                      disabled={busy || activity.locked || Boolean(booking)}
                                      aria-label="AI 只改本模块"
                                      title="用 AI 单独微调这一项安排"
                                      onClick={() => {
                                        setScopeId(activity.id);
                                        focusPlannerChat();
                                      }}
                                    >
                                      AI 微调
                                    </button>
                                    <button
                                      className="text-button"
                                      disabled={busy || Boolean(booking)}
                                      onClick={() => {
                                        const content = structuredClone(activePlan.content);
                                        content.days[dayIndex].activities.find(
                                          (item) => item.id === activity.id,
                                        )!.locked = !activity.locked;
                                        void commit(
                                          content,
                                          activity.locked ? '解锁活动' : '锁定活动',
                                          true,
                                        );
                                      }}
                                    >
                                      {activity.locked ? '解锁' : '锁定'}
                                    </button>
                                    {activity.kind === 'sight' && (
                                      <button
                                        className="text-button"
                                        onClick={() =>
                                          void saveFavorite(
                                            activity.title,
                                            activity.city,
                                            activity.description,
                                          )
                                        }
                                      >
                                        收藏
                                      </button>
                                    )}
                                  </div>
                                  {activePlan.activityGuides?.[activity.id] && (() => {
                                    const guide = activePlan.activityGuides[activity.id];
                                    const { body, links } = splitAnswerLinks(plannerDisplayText(guide.text, activePlan.content));
                                    return <details className="planner-activity-guide planner-notes" aria-label={`${activity.title}详细攻略`}>
                                      <summary>AI 详细攻略</summary>
                                      <RichAiText text={body} />
                                      {links.length > 0 && <div className="planner-sources">相关链接：{links.map((link) =>
                                        <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.title}</a>)}</div>}
                                      <small>生成于 {new Date(guide.createdAt).toLocaleString('zh-CN')}</small>
                                    </details>;
                                  })()}
                                  {activity.kind === 'sight' && (
                                    <div className="planner-journal-row">
                                      {journalVisit ? (
                                        <button type="button" className="text-button planner-journal-action"
                                          onClick={() => props.onOpenJournalPlace(journalVisit.placeId)}>
                                          打开地点手账
                                        </button>
                                      ) : (
                                        <button type="button" className="text-button planner-journal-action"
                                          disabled={busy || journalSaving} onClick={() => void recordJournalVisit(activity)}>
                                          标记已游玩
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {!journalVisit && chooseJournalCity && (
                                    <div className="planner-journal-city">
                                      <label>景点所属城市
                                        <select value={journalCityChoice.cityCode} disabled={journalSaving}
                                          onChange={(event) => setJournalCityChoice({ ...journalCityChoice, cityCode: event.target.value })}>
                                          <option value="">选择城市</option>
                                          {activePlan.content.cities.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}
                                        </select>
                                      </label>
                                      <button type="button" className="secondary" disabled={busy || journalSaving || !journalCityChoice.cityCode}
                                        onClick={() => void recordJournalVisit(activity, journalCityChoice.cityCode)}>确认并加入手账</button>
                                      <button type="button" className="text-button" onClick={() => setJournalCityChoice(null)}>取消</button>
                                    </div>
                                  )}
                                </div>
                              </>
                              );
                              if (compactTransfer) {
                                const actSelectionKey = activity.id;
                                return (
                                  <TransferBridgeCard
                                    key={activity.id}
                                    options={transferOptions}
                                    content={activePlan.content}
                                    routeLabel={transfer?.route}
                                    selected={scopeId === activity.id}
                                    selectedOptionIndex={activePlan.selectedTransfers?.[actSelectionKey]}
                                    onSelectOption={(index) => selectTransferOption(actSelectionKey, index)}
                                  >
                                    {cardContent}
                                  </TransferBridgeCard>
                                );
                              }
                              return (
                                <Fragment key={activity.id}>
                                  {gapTransfer && (directGapOptions?.length ? (
                                    <DirectTransferBridge
                                      options={directGapOptions}
                                      content={activePlan.content}
                                      routeLabel={gapTransfer.routeLabel}
                                      selectedOptionIndex={activePlan.selectedTransfers?.[gapTransfer.key]}
                                      onSelectOption={(index) => selectTransferOption(gapTransfer.key, index)}
                                    />
                                  ) : (
                                    <GapTransferConnector
                                      gap={gapTransfer}
                                      loading={Boolean(missingTransferSig && transfersLoadingSig === missingTransferSig)}
                                    />
                                  ))}
                                  <article
                                    className={`card planner-activity kind-${activity.kind} ${scopeId === activity.id ? 'selected' : ''}`}
                                  >
                                    {cardContent}
                                  </article>
                                </Fragment>
                              );
                            })}
                        </div>
                      ))}
                      <div className="xhs-day-add-row">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            setEditing({
                              dayIndex,
                              isNew: true,
                              activity: {
                                id: createLocalId(),
                                kind: 'rest',
                                period: 'evening',
                                startTime: '21:00',
                                endTime: '22:00',
                                title: '自由休息',
                                city: day.activities[0]?.city ?? '',
                                location: '',
                                description: '',
                                transportMode: '',
                                meal: null,
                                locked: false,
                                photo: null,
                                sourceIds: [],
                                costs: [],
                                fromActivityId: null,
                                toActivityId: null,
                              },
                            })
                          }
                        >
                          ＋ 添加活动／休息
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            openXhsDialog({
                              mode: 'plan',
                              initialTab: 'add-places',
                              initialTargetDate: day.date,
                            })
                          }
                        >
                          ✦ 从小红书加景点到这天
                        </button>
                      </div>
                      {day.lodging && (
                        <section className="card planner-lodging">
                          <span className="eyebrow">STAY IN THIS AREA</span>
                          <h3>
                            今晚住：{activePlan.hotels?.[day.date] || plannerDisplayText(`${day.lodging.city} · ${day.lodging.area}`, activePlan.content)}
                          </h3>
                          {bookedHotel ? <>
                            <HotelBookingDetails booking={bookedHotel} />
                            <button className="text-button" type="button" disabled={busy}
                              onClick={() => setBookingDialog({ initial: bookedHotel, editing: true })}>编辑酒店预订</button>
                            <a
                              className="text-button"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={mapPlaceLinks({ city: bookedHotel.city || day.lodging.city, name: bookedHotel.hotelName }).webUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                openMapAppPlace({ city: bookedHotel.city || day.lodging?.city || '', name: bookedHotel.hotelName });
                              }}
                            >在{mapAppLabel()}查看酒店</a>
                          </> : <p>{plannerDisplayText(day.lodging.reason, activePlan.content)}</p>}
                          {!bookedHotel && <form className="planner-hotel-form" key={`${activePlan.id}:${day.date}:${activePlan.hotels?.[day.date] || ''}`}
                            onSubmit={(event) => {
                              event.preventDefault();
                              const hotel = String(new FormData(event.currentTarget).get('hotel') || '').trim();
                              const current = plansRef.current.find((plan) => plan.id === activePlan.id);
                              if (!current) return;
                              void props.onSaveAi({ ...current, hotels: { ...current.hotels, [day.date]: hotel },
                                version: current.version + 1, contentVersion: current.contentVersion ?? current.version,
                                updatedAt: new Date().toISOString(),
                              }, current.version).catch(report);
                            }}>
                            <label>具体酒店名称<input name="hotel" aria-label={`${day.date}具体酒店名称`} maxLength={150}
                              placeholder="填写酒店全名，保存后便于查看与一键跳转地图导航"
                              defaultValue={activePlan.hotels?.[day.date] || ''} /></label>
                            <button className="secondary" disabled={busy} type="submit">保存酒店</button>
                            {activePlan.hotels?.[day.date] && <a
                              className="text-button"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={mapPlaceLinks({ city: day.lodging.city, name: activePlan.hotels[day.date] }).webUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                openMapAppPlace({ city: day.lodging?.city || '', name: activePlan.hotels![day.date] });
                              }}
                            >在{mapAppLabel()}查看酒店</a>}
                          </form>}
                          {!bookedHotel && <p>
                            <strong>订房搜索：{plannerDisplayText(day.lodging.searchKeyword, activePlan.content)}</strong>
                          </p>}
                          {day.lodging.costs.map(shownCost).map((cost) => (
                            <small key={cost.id}>
                              {costPriceText(cost)} / 间晚 · {costStatusLabels[cost.status] || costStatusLabels.estimate}
                            </small>
                          ))}
                          <Sources
                            ids={day.lodging.sourceIds}
                            sources={activePlan.content.sources}
                          />
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setScopeId(null);
                              setMessage(`请把 ${day.date} 的住宿片区改为`);
                              focusPlannerChat();
                            }}
                          >
                            让 AI 修改住宿
                          </button>
                        </section>
                      )}
                      {!day.lodging && activePlan.hotels?.[day.date] && <section className="card planner-lodging">
                        <h3>今晚住：{activePlan.hotels[day.date]}</h3>
                        {bookedHotel && <HotelBookingDetails booking={bookedHotel} />}
                      </section>}
                    </section>
                    );
                  })}
                </div>
                <aside className="planner-sidebar">
                  <section className="card planner-live-budget">
                    <span className="eyebrow">ESTIMATED BUDGET</span>
                    <h2>费用概览</h2>
                    <strong className="planner-budget-total">{priceText(budget.totalCents)}</strong>
                    <p>
                      人均{' '}
                      {priceText(Math.round(budget.totalCents / activePlan.content.request.people))}{' '}
                      · {partyBreakdown(activePlan.content.request)}
                    </p>
                    {Object.entries(budget.categories).map(([category, cents]) => (
                      <div className="planner-budget-row" key={category}>
                        <span>{BUDGET_LABELS[category as keyof typeof BUDGET_LABELS]}</span>
                        <strong>{priceText(cents)}</strong>
                      </div>
                    ))}
                    {activePlan.content.request.budgetCents !== null && (
                      <p className="planner-banner">
                        {budget.totalCents > activePlan.content.request.budgetCents
                          ? '超出预算'
                          : '预算余量'}{' '}
                        {priceText(
                          Math.abs(activePlan.content.request.budgetCents - budget.totalCents),
                        )}
                      </p>
                    )}
                    <p className="muted">住宿、餐饮按所选档次和推荐菜品预估，仅供参考。</p>
                    <details>
                      <summary>逐项计算明细</summary>
                      {budget.items.map((item) => (
                        <div key={item.id} className="planner-budget-item">
                          <strong>
                            {plannerDisplayText(item.label, activePlan.content)} · {priceText(item.totalCents)}
                          </strong>
                          <small>
                            {item.explanation} ·{' '}
                            {item.status === 'estimate' || item.status === 'unknown' ? '预估' : costStatusLabels[item.status]}
                          </small>
                        </div>
                      ))}
                    </details>
                  </section>
                  {(activePlan.wishlist?.length ?? 0) > 0 && (
                    <section className="card planner-alternatives xhs-wishlist-panel" aria-label="小红书灵感待选池">
                      <div className="xhs-wishlist-heading">
                        <h3>★ 待选灵感池（{activePlan.wishlist!.length}）</h3>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => openXhsDialog({ mode: 'plan', initialTab: 'add-places' })}
                        >
                          ＋ 继续加点
                        </button>
                      </div>
                      <p className="muted">已在行程地图上用 ★ 标出，可看顺路位置后一键排入。</p>
                      {activePlan.wishlist!.map((item) => (
                        <div className="xhs-wishlist-item" key={item.id}>
                          <div className="xhs-wishlist-item-top">
                            <span className={`xhs-kind-badge kind-${item.kind}`}>
                              {XHS_PLACE_KIND_LABELS[item.kind]}
                            </span>
                            <strong>{item.name}</strong>
                            {item.city && <small className="muted">{item.city}</small>}
                          </div>
                          {item.note && <p>{item.note}</p>}
                          <div className="xhs-wishlist-item-actions">
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => void scheduleWishlistPlace(item, false)}
                            >
                              直接顺路排入
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => void scheduleWishlistPlace(item, true)}
                            >
                              问 AI 方案
                            </button>
                            {item.sourceUrl && (
                              <a
                                className="text-button"
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                原帖
                              </a>
                            )}
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              onClick={() => void removeWishlistPlace(item.id)}
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                  {activePlan.content.alternatives.length > 0 && (
                    <section className="card planner-alternatives">
                      <h3>备用玩法</h3>
                      {activePlan.content.alternatives.map((item, index) => (
                        <div key={index}>
                          <strong>
                            {plannerDisplayText(item.title, activePlan.content)}
                            {item.rainyDay ? ' · 雨天备选' : ''}
                          </strong>
                          <p>{plannerDisplayText(item.reason, activePlan.content)}</p>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setScopeId(null);
                              void sendChat(
                                `请在合适的日期启用备用景点 ${item.city} ${item.title}，原因：${item.reason}，重新检查衔接。`,
                                'edit',
                                undefined,
                                null,
                              );
                            }}
                          >
                            启用方案
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              // 带到 AI 对话框讨论：只填入问题并聚焦，不修改行程；用户可补充后回车发送。
                              setScopeId(null);
                              setMessage(`想讨论备用方案「${item.city} ${item.title}」：${item.reason}。这个方案适合放在哪天？对现有安排、交通和费用有什么影响？`);
                              focusPlannerChat();
                            }}
                          >
                            讨论方案
                          </button>
                          <button
                            className="text-button"
                            onClick={() => void saveFavorite(item.title, item.city, item.reason)}
                          >
                            收藏
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  <details className="card planner-unvisited" aria-label="未去热门景点">
                    <summary className="planner-unvisited-summary">
                      <span className="planner-unvisited-summary-title">
                        <span>未去热门景点</span>
                        {visibleUnvisitedHighlights.length > 0 && (
                          <em className="planner-unvisited-count">({visibleUnvisitedHighlights.length})</em>
                        )}
                      </span>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy || unvisitedLoadingId === activePlan.id}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void fetchUnvisitedHighlights(activePlan.id, true);
                        }}
                      >
                        {unvisitedLoadingId === activePlan.id
                          ? '整理中…'
                          : visibleUnvisitedHighlights.length > 0
                            ? '↻ 刷新'
                            : '✦ 生成清单'}
                      </button>
                    </summary>
                    {visibleUnvisitedHighlights.length > 0 ? (
                      <div className="planner-unvisited-list">
                        {visibleUnvisitedHighlights.map((item, index) => (
                          <div className="planner-unvisited-row" key={`${item.title}-${index}`}>
                            <div className="planner-unvisited-head">
                              <strong>{plannerDisplayText(item.title, activePlan.content)}</strong>
                              {item.grade && <span className="planner-unvisited-grade">{item.grade}</span>}
                            </div>
                            {item.feature && (
                              <p className="planner-unvisited-feature">{plannerDisplayText(item.feature, activePlan.content)}</p>
                            )}
                            <div className="planner-unvisited-actions">
                              <a
                                className="planner-unvisited-loc"
                                href={mapPlaceLinks({ city: item.city, name: item.location || item.title }).webUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`在${mapAppLabel()}中打开位置`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  openMapAppPlace({ city: item.city, name: item.location || item.title });
                                }}
                              >
                                📍 {mapAppLabel()}
                              </a>
                              <button
                                className="planner-unvisited-add-btn"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (webTourMode) {
                                    props.onRequireClient?.('ai');
                                    return;
                                  }
                                  setScopeId(null);
                                  void sendChat(
                                    `请把未去热门景点「${item.city} ${item.title}」（${item.grade ? `${item.grade}，` : ''}${item.feature}，位置：${item.location || item.title}）合理安排到当前行程合适的日期中，并重新检查路线衔接与时间。`,
                                    'edit',
                                    undefined,
                                    null,
                                  );
                                }}
                              >
                                ＋ 安排到行程
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="planner-unvisited-empty">
                        {unvisitedLoadingId === activePlan.id
                          ? '正在整理该目的地未去的热门景点（仅展示名称、景区级别、特色与高德位置）…'
                          : unvisitedError || '暂无未去热门景点，点击右上角「✦ 生成清单」即可列出目的地未去的热门景点并一键安排到行程。'}
                      </p>
                    )}
                  </details>
                  <details className="card planner-all-sources">
                    <summary>全部联网参考资料</summary>
                    <Sources
                      ids={activePlan.content.sources.map((source) => source.id)}
                      sources={activePlan.content.sources}
                    />
                  </details>
                </aside>
              </div>
            </>
          ) : (
            <div className="empty-state">新建一个计划，开始安排下一段旅程。</div>
          )}
        </div>
      )}
      {shareModalData && (
        <TripReminderShareModal
          data={shareModalData}
          cloudUser={props.cloudUser ?? null}
          onOpenAuth={props.onOpenAuth}
          onClose={() => setShareModalData(null)}
          onNotice={props.onNotice}
          onError={props.onError}
        />
      )}
      {bookingDialog && (creating || activePlan) && (
        <PlannerBookingDialog
          plan={creating ? undefined : activePlan ?? undefined}
          defaultDate={creating ? request.startDate : undefined}
          defaultCity={creating ? request.destination : undefined}
          initial={bookingDialog.initial}
          initialTarget={bookingDialog.target}
          editing={bookingDialog.editing}
          onClose={() => setBookingDialog(null)}
          onConfirm={importBooking}
        />
      )}
      {xhsDialog && (
        <PlannerXhsImporter
          visible={props.visible && !xhsDialog.minimized}
          planTaskBusy={busy}
          mode={xhsDialog.mode}
          plan={props.aiPlans.find((plan) => plan.id === xhsDialog.planId) ?? null}
          initialRefs={
            xhsDialog.mode === 'create'
              ? request.references ?? []
              : xhsDialog.mode === 'chat'
                ? chatRefs
                : []
          }
          initialReferenceMode={request.referenceMode ?? DEFAULT_XHS_REFERENCE_MODE}
          initialTab={xhsDialog.initialTab}
          initialTargetDate={xhsDialog.initialTargetDate}
          initialFiles={xhsDialog.initialFiles}
          onClose={() => setXhsDialog(null)}
          onMinimize={() => setXhsDialog((current) => current && { ...current, minimized: true })}
          onResume={resumeXhsDialog}
          onApplyToCreate={applyXhsToCreate}
          onAddToWishlist={addXhsToWishlist}
          onAttachToChat={(refs) => {
            setChatRefs(refs);
            focusPlannerChat();
          }}
          onSendPlanPrompt={async (prompt, refs, options) => {
            if (activePlan?.id !== xhsDialog.planId) return false;
            return sendChat(
              prompt,
              options.mode,
              undefined,
              options.scopeId ?? null,
              undefined,
              undefined,
              refs,
            );
          }}
        />
      )}
      {editing && (
        <ActivityEditor
          key={editing.activity.id}
          initial={editing.activity}
          error={error}
          onSave={(activity) => void saveActivity(activity)}
          onDelete={() => void deleteActivity()}
          onCancel={() => setEditing(null)}
        />
      )}
      {settings && (
        <div className="dialog-backdrop">
          <section
            className="dialog planner-editor"
            role="dialog"
            aria-modal="true"
            aria-label="修改出行条件"
          >
            {error && (
              <div className="planner-error" role="alert">
                {error}
              </div>
            )}
            <div className="card-heading">
              <h2>修改日期与出行条件</h2>
              <button className="text-button" onClick={() => setSettings(null)}>
                关闭
              </button>
            </div>
            <fieldset disabled={busy}>
              <RequestFields value={settings} onChange={setSettings} />
              <div className="dialog-actions">
                <button
                  className="primary"
                  onClick={() => {
                    try {
                      validatePlannerRequest(settings, true);
                      const normalized = { ...settings };
                      if (!normalized.endDate)
                        normalized.endDate = addPlannerDays(
                          normalized.startDate,
                          normalized.days! - 1,
                        );
                      void sendChat(
                        '请应用我填写的新条件和自由描述，按开始日期与结束日期调整游玩安排，不考虑去程返程，并重新核查天气、行程内交通和开放安排。',
                        'edit',
                        normalized,
                      );
                    } catch (failure) {
                      report(failure);
                    }
                  }}
                >
                  应用并让 AI 重新核查
                </button>
                <button className="secondary" onClick={() => setSettings(null)}>
                  取消
                </button>
              </div>
            </fieldset>
          </section>
        </div>
      )}
    </div>
  );
}
