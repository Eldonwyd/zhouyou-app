import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiTravelPlan, BookingKind, BookingRecord } from '../planner-types';
import { plannerApi } from '../planner-api';
import {
  BOOKING_KIND_LABELS,
  bookingTransportTiming,
  emptyBookingDraft,
  finalizeBookingRecord,
  isTransportBooking,
  pendingTransportLegs,
  validateTransportBooking,
} from '../planner-booking';
import { EXPENSE_LABELS, bookingExpenseCategory, bookingLedgerDates } from '../finance';
import { currency } from '../utils';
import ThemedDatePicker from './ThemedDatePicker';

const BOOKING_KINDS: BookingKind[] = ['train', 'flight', 'hotel', 'ticket', 'other'];

/** 将上传的截图在浏览器内缩放为紧凑 JPEG，仅作本次 AI 识别传输，不保存在任何本地存储中。 */
async function compressScreenshotForParse(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请拖入或选择图片格式的订单截图');
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 1500;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('截图压缩失败，请重试');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error ?? new Error('读取截图失败'));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

interface BookingDialogProps {
  plan?: AiTravelPlan;
  defaultDate?: string;
  defaultCity?: string;
  initial?: BookingRecord;
  initialTarget?: string;
  editing?: boolean;
  onClose: () => void;
  onConfirm: (
    booking: BookingRecord,
    options: {
      updatePlan: boolean;
      targetActivityId: string | 'new';
      updateLedger: boolean;
      ledgerMode: 'replace' | 'add';
    },
  ) => Promise<void>;
}

/** 导入 12306/携程/酒店截图（不保存原图）或手动录入车次、航班、酒店并一键回填行程与账本。 */
export function PlannerBookingDialog({ plan, defaultDate = plan?.content.days[0]?.date ?? '', defaultCity = plan?.content.cities[0]?.name ?? '', initial, initialTarget, editing, onClose, onConfirm }: BookingDialogProps) {

  const [drafts, setDrafts] = useState<BookingRecord[]>([initial ?? emptyBookingDraft('train', defaultDate, defaultCity)]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [lookupStops, setLookupStops] = useState<string[]>([]);
  const [errorText, setErrorText] = useState('');

  const [updatePlan, setUpdatePlan] = useState(true);
  const [targetActivityId, setTargetActivityId] = useState(initialTarget ?? 'auto');
  const [updateLedger, setUpdateLedger] = useState(Boolean(plan) && !editing);
  const [ledgerMode, setLedgerMode] = useState<'replace' | 'add'>('add');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const draft = drafts[activeIndex] ?? drafts[0];
  const transport = isTransportBooking(draft);
  const isUnpurchased = transport && draft.purchaseStatus === 'unpurchased';
  const timing = bookingTransportTiming(draft);

  const updateDraft = (patch: Partial<BookingRecord>) => {
    setDrafts((prev) => prev.map((item, idx) => (idx === activeIndex ? { ...item, ...patch } : item)));
  };

  // 查找当天可替换的未锁定行程卡片（车次/航班优先找交通卡，门票找游玩卡）。
  const matchingActivities = useMemo(() => {
    const day = plan?.content.days.find((d) => d.date === draft.date);
    if (!day) return [];
    return day.activities.filter((act) => {
      if (act.locked || act.bookingId || act.bookingTiming?.deferred) return false;
      if (draft.kind === 'train' || draft.kind === 'flight') return act.kind === 'transport';
      if (draft.kind === 'ticket') return act.kind === 'sight';
      return true;
    });
  }, [plan, draft.date, draft.kind]);

  useEffect(() => {
    if (targetActivityId !== 'auto' && targetActivityId !== 'new' && targetActivityId !== initialTarget
      && !matchingActivities.some((a) => a.id === targetActivityId)) {
      setTargetActivityId('auto');
    }
  }, [matchingActivities, targetActivityId, initialTarget]);

  async function parseScreenshot(file: File) {
    if (parsing) return;
    setParsing(true);
    setErrorText('');
    setStatusText('正在读取截图并交给 AI 提取订单信息（截图不会保存）…');
    try {
      const imageDataUrl = await compressScreenshotForParse(file);
      const result = await plannerApi<{ bookings: BookingRecord[]; providerLabel?: string }>(
        'booking-parse',
        {
          imageDataUrl,
          planContext: plan ? {
            startDate: plan.content.days[0]?.date ?? '',
            endDate: plan.content.days.at(-1)?.date ?? '',
            cities: plan.content.cities.map((c) => c.name),
          } : undefined,
        },
        AbortSignal.timeout(95000),
        (stage) => setStatusText(stage),
      );
      if (result.bookings?.length) {
        if (initial && (editing || initialTarget)) {
          const recognized = result.bookings.find((item) => item.kind === initial.kind);
          if (!recognized) throw new Error('截图里没有识别到对应类型的订单。');
          setDrafts([{ ...initial, ...recognized, id: initial.id }]);
        } else {
          setDrafts(result.bookings);
        }
        setActiveIndex(0);
        setLookupStops([]);
        setStatusText(`已提取 ${editing || initialTarget ? 1 : result.bookings.length} 条预订信息${result.providerLabel ? `（${result.providerLabel}）` : ''}，请核对后保存。`);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '识别截图失败，请改为下方手动输入');
      setStatusText('');
    } finally {
      setParsing(false);
    }
  }

  async function lookupByCode() {
    if (lookingUp || parsing || saving) return;
    const code = draft.code.trim().toUpperCase();
    if (!code) {
      setErrorText(draft.kind === 'train' ? '请先输入车次号，如 G128' : '请先输入航班号，如 MU5801');
      return;
    }
    setLookingUp(true);
    setErrorText('');
    setLookupStops([]);
    setStatusText(draft.kind === 'train' ? `正在联网查询 ${code} 时刻表与参考票价…` : `正在联网查询 ${code} 航班起降机场与时刻…`);
    try {
      const result = await plannerApi<{
        code: string;
        fromLocation: string;
        toLocation: string;
        city: string;
        startTime: string;
        endTime: string;
        amountYuan: number | null;
        priceNote: string;
        stops: string[];
        note: string;
      }>(
        'booking-lookup',
        {
          kind: draft.kind === 'flight' ? 'flight' : 'train',
          code,
          date: draft.date,
          fromLocation: draft.fromLocation,
          toLocation: draft.toLocation,
          planContext: plan ? {
            startDate: plan.content.days[0]?.date ?? '',
            endDate: plan.content.days.at(-1)?.date ?? '',
            cities: plan.content.cities.map((c) => c.name),
          } : undefined,
        },
        AbortSignal.timeout(90000),
        (stage) => setStatusText(stage),
      );
      updateDraft({
        code: result.code || code,
        ...(result.fromLocation ? { fromLocation: result.fromLocation } : {}),
        ...(result.toLocation ? { toLocation: result.toLocation } : {}),
        ...(result.city ? { city: result.city } : {}),
        ...(result.startTime ? { startTime: result.startTime } : {}),
        ...(result.endTime ? { endTime: result.endTime } : {}),
        ...(result.note && !draft.note ? { note: result.note } : {}),
      });
      setLookupStops(result.stops ?? []);
      const route = [result.fromLocation, result.toLocation].filter(Boolean).join(' → ');
      const time = [result.startTime, result.endTime].filter(Boolean).join('—');
      const priceText = result.amountYuan != null ? `，二等座参考价 ${currency(result.amountYuan)}` : '';
      setStatusText(`已查到 ${result.code}${route ? `：${route}` : ''}${time ? `（${time}）` : ''}${priceText}。${result.priceNote || ''}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '联网查询失败，请手动填写');
      setStatusText('');
    } finally {
      setLookingUp(false);
    }
  }

  // 支持在弹窗内直接 Ctrl+V 粘贴剪贴板截图。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void parseScreenshot(file);
          }
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const ledgerDates = bookingLedgerDates(draft);
  const ledgerCat = EXPENSE_LABELS[bookingExpenseCategory(draft.kind)];
  const planDayDates = useMemo(() => new Set(plan?.content.days.map((day) => day.date) ?? []), [plan]);
  const nonCoreDateOutsidePlan = Boolean(
    plan && !transport && draft.kind !== 'hotel' && draft.date && planDayDates.size > 0 && !planDayDates.has(draft.date),
  );
  useEffect(() => {
    if (nonCoreDateOutsidePlan && updatePlan) {
      setUpdatePlan(false);
    }
  }, [nonCoreDateOutsidePlan, updatePlan]);

  async function submit() {
    if (saving || parsing) return;
    const rawStart = draft.startTime.trim();
    const rawEnd = draft.endTime.trim();
    const validHm = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (rawStart && !validHm(rawStart)) {
      setErrorText('开始时间请使用 24 小时制 HH:MM 格式，例如 09:30');
      return;
    }
    if (rawEnd && !validHm(rawEnd)) {
      setErrorText('结束时间请使用 24 小时制 HH:MM 格式，例如 17:30');
      return;
    }
    if (!transport && draft.kind !== 'hotel' && rawStart && rawEnd && rawEnd <= rawStart) {
      setErrorText('结束时间需晚于开始时间，请核对预约时段。');
      return;
    }
    const finalized = finalizeBookingRecord(draft);
    if (finalized.kind === 'hotel' && !finalized.hotelName) {
      setErrorText('请填写具体酒店名称');
      return;
    }
    if (finalized.kind === 'hotel' && (!finalized.date || (finalized.endDate && finalized.endDate <= finalized.date))) {
      setErrorText('请选择入住日期。填写离店日期时，离店须晚于入住。');
      return;
    }
    if (finalized.kind === 'hotel' && finalized.endDate && finalized.date) {
      const nights = Math.round((Date.parse(`${finalized.endDate}T00:00:00Z`) - Date.parse(`${finalized.date}T00:00:00Z`)) / 86400000);
      if (nights > 60) {
        setErrorText(`单笔酒店入住最多支持 60 晚（当前为 ${nights} 晚），请核对离店年份或拆分为多笔订单。`);
        return;
      }
    }
    if (finalized.kind !== 'hotel' && !finalized.title && !finalized.code) {
      setErrorText('请填写车次/航班号或预订名称');
      return;
    }
    if (!editing && plan?.bookings?.length) {
      const duplicate = plan.bookings.find((item) =>
        item.id !== finalized.id
        && item.kind === finalized.kind
        && item.date === finalized.date
        && (
          (finalized.code && item.code && item.code.toUpperCase() === finalized.code.toUpperCase())
          || (finalized.hotelName && item.hotelName && item.hotelName === finalized.hotelName)
          || (finalized.title && item.title && item.title === finalized.title)
        )
        && item.amountYuan === finalized.amountYuan,
      );
      if (duplicate && !window.confirm(`当前行程中已有疑似相同的订单「${duplicate.hotelName || duplicate.title}（${duplicate.date}）」，确认仍要作为新订单录入吗？`)) {
        return;
      }
    }
    setSaving(true);
    setErrorText('');
    try {
      validateTransportBooking(finalized);
      const shouldUpdatePlan = transport || draft.kind === 'hotel' || (updatePlan && !nonCoreDateOutsidePlan);
      await onConfirm(finalized, {
        updatePlan: shouldUpdatePlan,
        targetActivityId: targetActivityId === 'auto' && !transport ? 'new' : targetActivityId,
        updateLedger: updateLedger && finalized.amountYuan != null,
        ledgerMode,
      });
      // 若一次识别了多条订单，确认完当前条后切到剩余条；只剩一条时关闭弹窗。
      if (drafts.length > 1) {
        const rest = drafts.filter((_, idx) => idx !== activeIndex);
        setDrafts(rest);
        setActiveIndex(0);
        setTargetActivityId('auto');
        setStatusText(`已导入「${finalized.title}」，还可继续确认其余 ${rest.length} 条订单。`);
      } else {
        onClose();
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '导入失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !parsing && !saving) onClose();
      }}
    >
      <section className="dialog planner-editor booking-dialog" role="dialog" aria-modal="true" aria-label="导入车次、酒店与订单">
        <div className="card-heading">
          <div>
            <h2>导入车次 / 航班 / 酒店订单</h2>
            <p className="muted">拖入或粘贴 12306 / 携程 / 酒店截图自动提取，也可直接手动录入；截图仅用于瞬时识别，绝不保存。</p>
          </div>
          <button type="button" className="text-button" disabled={parsing || saving} onClick={onClose}>关闭</button>
        </div>

        <div
          className={`booking-dropzone ${dragOver ? 'is-over' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void parseScreenshot(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void parseScreenshot(file);
            }}
          />
          <div>
            <strong>拖入 / Ctrl+V 粘贴订单截图（可选）</strong>
            <small>支持 12306、携程、美团及酒店确认页；DeepSeek 将自动通过本机离线 OCR 识字后解析，原图绝不保存</small>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={parsing || saving}
            onClick={() => fileInputRef.current?.click()}
          >
            {parsing ? '识别中…' : '选择截图识别'}
          </button>
        </div>

        {statusText && <p className="booking-status" role="status">{statusText}</p>}
        {lookupStops.length > 0 && (
          <p className="booking-stops-hint">
            <strong>经停参考：</strong>{lookupStops.join(' · ')}
            <small>如坐中途区间，可填好“出发站 / 到达站”后再点一次查询精确匹配该段时刻与票价。</small>
          </p>
        )}
        {errorText && <p className="planner-error" role="alert">{errorText}</p>}

        {drafts.length > 1 && (
          <div className="booking-draft-tabs" role="tablist" aria-label="识别出的多条订单">
            {drafts.map((item, idx) => (
              <button
                key={item.id || idx}
                type="button"
                role="tab"
                aria-selected={idx === activeIndex}
                className={idx === activeIndex ? 'primary' : 'secondary'}
                onClick={() => setActiveIndex(idx)}
              >
                {BOOKING_KIND_LABELS[item.kind]} · {item.code || item.hotelName || item.title || `第 ${idx + 1} 条`}
              </button>
            ))}
          </div>
        )}

        <div className="booking-kind-pills" role="group" aria-label="订单类型">
          {BOOKING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={draft.kind === kind ? 'primary' : 'secondary'}
              aria-pressed={draft.kind === kind}
              disabled={editing || Boolean(initialTarget)}
              onClick={() => updateDraft({ kind })}
            >
              {BOOKING_KIND_LABELS[kind]}
            </button>
          ))}
        </div>

        {transport && (
          <div className="booking-purchase-status" role="group" aria-label="购票状态">
            <span className="booking-purchase-label">购票状态</span>
            <div className="booking-purchase-pills">
              <button
                type="button"
                className={!isUnpurchased ? 'primary' : 'secondary'}
                aria-pressed={!isUnpurchased}
                onClick={() => updateDraft({ purchaseStatus: 'purchased' })}
              >
                已购买
              </button>
              <button
                type="button"
                className={isUnpurchased ? 'primary' : 'secondary'}
                aria-pressed={isUnpurchased}
                onClick={() => {
                  updateDraft({ purchaseStatus: 'unpurchased' });
                  setUpdateLedger(false);
                }}
              >
                未购买（加入抢票计划）
              </button>
            </div>
            {isUnpurchased && (
              <small className="booking-purchase-hint">
                未购买的{draft.kind === 'flight' ? '航班' : '车次'}将同步写入行程时间轴并加入「抢票计划」，方便开启放票提醒。
              </small>
            )}
          </div>
        )}

        <div className="booking-form-grid">
          {draft.kind === 'hotel' ? (
            <>
              <label className="span-2">
                具体酒店全名
                <input
                  value={draft.hotelName}
                  placeholder="例如：全季酒店（昆明翠湖公园店）"
                  onChange={(event) => updateDraft({ hotelName: event.target.value, title: event.target.value })}
                />
              </label>
              <label>
                所在城市
                <input value={draft.city} placeholder="例如：昆明" onChange={(event) => updateDraft({ city: event.target.value })} />
              </label>
              <label>
                酒店地址（可选）
                <input value={draft.toLocation} placeholder="填写酒店地址" onChange={(event) => updateDraft({ toLocation: event.target.value })} />
              </label>
              <label>
                订单总金额（元，可选）
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="留空则不填账本"
                  value={draft.amountYuan ?? ''}
                  onChange={(event) => updateDraft({ amountYuan: event.target.value === '' ? null : Number(event.target.value) })}
                />
              </label>
              <label>
                入住日期
                <ThemedDatePicker value={draft.date} title="入住日期" onChange={(val) => updateDraft({ date: val })} />
              </label>
              <label>
                离店日期（单晚可留空）
                <ThemedDatePicker min={draft.date} value={draft.endDate} title="离店日期" onChange={(val) => updateDraft({ endDate: val })} />
              </label>
              <label>
                入住时间
                <input value={draft.startTime} placeholder="14:00" onChange={(event) => updateDraft({ startTime: event.target.value })} />
              </label>
              <label>
                退房时间
                <input value={draft.endTime} placeholder="12:00" onChange={(event) => updateDraft({ endTime: event.target.value })} />
              </label>
              <label className="span-2">
                房型 / 含早 / 备注
                <input
                  value={draft.seatOrRoom}
                  placeholder="例如：高级大床房 · 含双早 · 18点前免费取消"
                  onChange={(event) => updateDraft({ seatOrRoom: event.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              {(draft.kind === 'train' || draft.kind === 'flight') ? (
                <label className="span-2">
                  {draft.kind === 'train' ? '车次（如 G128 / D8712）' : '航班号（如 MU5801）'}
                  <div className="booking-code-row">
                    <input
                      value={draft.code}
                      placeholder={draft.kind === 'train' ? '输入车次如 G128，点右侧自动查时刻与参考价' : '输入航班号如 MU5801，点右侧自动查机场与时刻'}
                      onChange={(event) => updateDraft({ code: event.target.value })}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={lookingUp || parsing || saving || !draft.code.trim()}
                      onClick={() => void lookupByCode()}
                    >
                      {lookingUp ? '查询中…' : draft.kind === 'train' ? '联网查时刻与参考价' : '联网查起降与时刻'}
                    </button>
                  </div>
                </label>
              ) : (
                <label>
                  项目名称
                  <input
                    value={draft.title}
                    placeholder="例如：玉龙雪山冰川公园大索道"
                    onChange={(event) => updateDraft({ title: event.target.value })}
                  />
                </label>
              )}
              <label>
                {isUnpurchased ? '参考票价（元，可选）' : '订单金额（元，可选）'}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={isUnpurchased ? '预估/参考价，未付款可留空' : '实付金额'}
                  value={draft.amountYuan ?? ''}
                  onChange={(event) => updateDraft({ amountYuan: event.target.value === '' ? null : Number(event.target.value) })}
                />
              </label>
              <label>
                日期
                <ThemedDatePicker value={draft.date} title="订单日期" onChange={(val) => updateDraft({ date: val })} />
              </label>
              <label>
                所属城市
                <input value={draft.city} placeholder="目的地城市" onChange={(event) => updateDraft({ city: event.target.value })} />
              </label>
              <label>
                出发 / 开始时间
                <input value={draft.startTime} placeholder="09:15" onChange={(event) => updateDraft({ startTime: event.target.value })} />
              </label>
              <label>
                到达 / 结束时间
                <input value={draft.endTime} placeholder="11:20" onChange={(event) => updateDraft({ endTime: event.target.value })} />
              </label>
              {(draft.kind === 'train' || draft.kind === 'flight') ? (
                <>
                  <label>
                    出发站 / 机场
                    <input value={draft.fromLocation} placeholder="例如：昆明站" onChange={(event) => updateDraft({ fromLocation: event.target.value })} />
                  </label>
                  <label>
                    到达站 / 机场
                    <input value={draft.toLocation} placeholder="例如：大理站" onChange={(event) => updateDraft({ toLocation: event.target.value })} />
                  </label>
                </>
              ) : (
                <label className="span-2">
                  地点 / 地址
                  <input value={draft.toLocation} placeholder="景点或活动地址" onChange={(event) => updateDraft({ toLocation: event.target.value })} />
                </label>
              )}
              <label>
                座位 / 车厢 / 票种
                <input
                  value={draft.seatOrRoom}
                  placeholder={draft.kind === 'train' ? '如 04车 08F 二等座' : '如 经济舱 / 成人票×2'}
                  onChange={(event) => updateDraft({ seatOrRoom: event.target.value })}
                />
              </label>
              <label>
                补充备注
                <input value={draft.note} placeholder="检票口、航站楼、入园时段等" onChange={(event) => updateDraft({ note: event.target.value })} />
              </label>
            </>
          )}
        </div>

        {transport && <div className="booking-form-grid">
          <label>到达日期（跨日可填）
            <ThemedDatePicker min={draft.date} value={draft.endDate} title="到达日期" onChange={(val) => updateDraft({ endDate: val })} />
          </label>
          {draft.kind === 'flight' && <label className="booking-check">
            <input type="checkbox" checked={Boolean(draft.internationalFlight)}
              onChange={(event) => updateDraft({ internationalFlight: event.target.checked, stationLeadMinutes: undefined })} />
            国际或地区航班
          </label>}
          <label>提前到站 / 机场（分钟）
            <input type="number" min="15" max="360" value={draft.stationLeadMinutes ?? timing.lead}
              onChange={(event) => updateDraft({ stationLeadMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
          <label>去车站 / 机场预计用时（分钟）
            <input type="number" min="0" max="360" value={draft.accessMinutes ?? timing.access}
              onChange={(event) => updateDraft({ accessMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
          <label>抵达后接驳预计用时（分钟）
            <input type="number" min="0" max="360" value={draft.onwardMinutes ?? timing.onward}
              onChange={(event) => updateDraft({ onwardMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>
        </div>}
        <div className="booking-backfill-box">
          {transport || draft.kind === 'hotel' ? <p className="muted">{transport
            ? '按票面时刻更新行程，并为路程、进站或值机及抵达后的接驳留出时间。'
            : '将酒店资料同步到对应日期的住宿安排。'}</p> : plan && <label className="booking-check">
            <input
              type="checkbox"
              checked={updatePlan && !nonCoreDateOutsidePlan}
              disabled={nonCoreDateOutsidePlan}
              onChange={(event) => setUpdatePlan(event.target.checked)}
            />
            <span>
              <strong>一键回填到行程卡片</strong>
              <small>
                {nonCoreDateOutsidePlan
                  ? `预订日期（${draft.date}）不在当前行程日期内，将仅保存到预订列表，不自动插入行程第一天。`
                  : '写入对应日期的行程时间轴和预订费用。'}
              </small>
            </span>
          </label>}
          {plan && !editing && !initialTarget && updatePlan && draft.kind !== 'hotel' && (
            <label className="booking-target-select">
              回填方式
              <select value={targetActivityId} onChange={(event) => setTargetActivityId(event.target.value)}>
                <option value="auto">{transport ? '自动匹配同日同路线的预估交通' : '按日期加入行程'}</option>
                <option value="new">新增为当天独立活动卡片</option>
                {matchingActivities.map((act) => (
                  <option key={act.id} value={act.id}>
                    更新已有卡片：{act.startTime} {act.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {plan && !editing && <label className="booking-check">
            <input
              type="checkbox"
              checked={updateLedger}
              disabled={draft.amountYuan == null}
              onChange={(event) => setUpdateLedger(event.target.checked)}
            />
            <span>
              <strong>一键回填到当日账本</strong>
              <small>
                {draft.amountYuan == null
                  ? '填写订单金额后可自动记入账本'
                  : `将 ${currency(draft.amountYuan)} 写入「${ledgerCat}」（${
                    ledgerDates.length === 0
                      ? '整程补充'
                      : ledgerDates.length > 3
                        ? `${ledgerDates[0]} 至 ${ledgerDates[ledgerDates.length - 1]}（共 ${ledgerDates.length} 晚均摊）`
                        : `${ledgerDates.join('、')}${ledgerDates.length > 1 ? ' 均摊' : ''}`
                  }）`}
              </small>
            </span>
          </label>}
          {updateLedger && draft.amountYuan != null && (
            <div className="booking-ledger-mode" role="group" aria-label="账本写入方式">
              <label>
                <input type="radio" name="ledgerMode" checked={ledgerMode === 'add'} onChange={() => setLedgerMode('add')} />
                累加到该日原金额
              </label>
              <label>
                <input type="radio" name="ledgerMode" checked={ledgerMode === 'replace'} onChange={() => setLedgerMode('replace')} />
                覆盖该日该分类（替换 AI 预估值）
              </label>
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" className="primary" disabled={parsing || lookingUp || saving} onClick={() => void submit()}>
            {saving ? '保存中…' : editing ? '保存修改' : plan ? '确认导入并回填' : '加入新建行程'}
          </button>
          <button type="button" className="secondary" disabled={parsing || saving} onClick={onClose}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}

/** 行程页折叠展示已录入的车次、航班与酒店预订列表，支持随时增删。 */
export function PlannerBookingsSummary({
  plan,
  disabled = false,
  onOpenImporter,
  onFillLeg,
  onEditBooking,
  onRemoveBooking,
}: {
  plan: AiTravelPlan;
  disabled?: boolean;
  onOpenImporter: () => void;
  onFillLeg: (leg: ReturnType<typeof pendingTransportLegs>[number]) => void;
  onEditBooking: (booking: BookingRecord) => void;
  onRemoveBooking: (bookingId: string) => Promise<void>;
}) {
  const bookings = plan.bookings ?? [];
  const pending = pendingTransportLegs(plan.content, bookings);
  return (
    <details className="planner-notes planner-bookings-panel" aria-label="车次、航班与酒店预订">
      <summary>
        <span className="planner-notes-title">车次 / 航班 / 酒店预订</span>
        <span className="planner-notes-badges">
          {bookings.length > 0 && <span className="packing-badge">{bookings.length} 条</span>}
          {pending.length > 0 && <span className="packing-badge">{pending.length} 段待填票</span>}
          {bookings.length === 0 && pending.length === 0 && <span className="packing-badge is-muted">可录入</span>}
        </span>
      </summary>
      <div className="packing-toolbar">
        <button type="button" className="secondary" disabled={disabled} onClick={onOpenImporter}>
          ＋ 截图识别或手动录入车次 / 航班 / 酒店
        </button>
      </div>
      {pending.length > 0 && <div className="booking-saved-grid">
        {pending.map((leg) => <article className="booking-saved-card" key={leg.activity.id}>
          <div className="booking-saved-head">
            <span className="booking-kind-tag">待填{leg.kind === 'flight' ? '机票' : '车票'}</span>
            <button type="button" className="secondary" disabled={disabled || leg.activity.locked} onClick={() => onFillLeg(leg)}>
              填写{leg.kind === 'flight' ? '机票' : '车票'}信息
            </button>
          </div>
          <h4>{leg.from && leg.to ? `${leg.from} → ${leg.to}` : leg.activity.title}</h4>
          <p className="muted">{leg.date} · 预估 {leg.activity.startTime}—{leg.activity.endTime}{leg.activity.locked ? ' · 解锁交通卡片后可填票' : ''}</p>
        </article>)}
      </div>}
      {bookings.length === 0 && pending.length === 0 ? (
        <p className="muted">还没有录入真实车次、航班或酒店。支持拖入 12306/携程截图自动识别（不存原图）或手动输入并一键回填行程和账本。</p>
      ) : (
        <div className="booking-saved-grid">
          {bookings.map((item) => {
            const route = [item.fromLocation, item.toLocation].filter(Boolean).join(' → ');
            const dateRange = item.endDate && item.endDate !== item.date ? `${item.date} — ${item.endDate}` : item.date;
            const timeRange = [item.startTime, item.endTime].filter(Boolean).join('—');
            return (
              <article className="booking-saved-card" key={item.id}>
                <div className="booking-saved-head">
                  <span className="booking-kind-tag">{BOOKING_KIND_LABELS[item.kind]}</span>
                  {item.purchaseStatus === 'unpurchased' && (
                    <span className="booking-unpurchased-tag">未购买 · 已入抢票计划</span>
                  )}
                  {item.amountYuan != null && <strong>{currency(item.amountYuan)}</strong>}
                  {(isTransportBooking(item) || item.kind === 'hotel') && <button type="button" className="text-button" disabled={disabled}
                    aria-label={`编辑 ${item.title}`} onClick={() => onEditBooking(item)}>编辑</button>}
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    aria-label={`移除 ${item.title}`}
                    onClick={() => void onRemoveBooking(item.id)}
                  >
                    移除
                  </button>
                </div>
                <h4>{item.hotelName || item.title}</h4>
                <p className="muted">
                  {[dateRange, timeRange, item.code, route].filter(Boolean).join(' · ')}
                </p>
                {(item.seatOrRoom || item.note) && <p>{[item.seatOrRoom, item.note].filter(Boolean).join(' · ')}</p>}
              </article>
            );
          })}
        </div>
      )}
    </details>
  );
}

