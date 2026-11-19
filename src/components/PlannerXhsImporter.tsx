import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  AiTravelPlan,
  XhsExtractedPlace,
  XhsPlaceKind,
  XhsReference,
  XhsReferenceMode,
} from '../planner-types';
import { plannerApi } from '../planner-api';
import {
  DEFAULT_XHS_REFERENCE_MODE,
  MAX_XHS_REFERENCES,
  XHS_PLACE_KIND_LABELS,
  XHS_REFERENCE_MODE_OPTIONS,
  buildXhsInsertPrompt,
  compactXhsReference,
  mergeXhsReferences,
  selectedPlacesFromRefs,
} from '../planner-xhs';

export interface XhsParseResponse {
  reference: XhsReference;
  providerLabel?: string;
  usedVision?: boolean;
  warnings?: string[];
}

/**
 * 将上传的小红书截图在浏览器内压缩为紧凑 JPEG，仅作瞬时 AI 识图传输，不保存在本地存储。
 * 针对手机长截图（高宽比 > 2.2）自动按宽 1080 纵向切片并留重叠区，避免长图等比缩放后文字变糊。
 */
export async function prepareXhsImagesForParse(files: File[], maxSlices = 10): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (results.length >= maxSlices) break;
    const bitmap = await createImageBitmap(file);
    try {
      const ratio = bitmap.height / Math.max(1, bitmap.width);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器画布初始化失败');

      const toDataUrl = () =>
        new Promise<string>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error('截图压缩失败'));
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(reader.error ?? new Error('读取截图失败'));
              reader.readAsDataURL(blob);
            },
            'image/jpeg',
            0.85,
          );
        });

      if (ratio > 2.2 && bitmap.height > 1800) {
        const targetWidth = Math.min(1080, bitmap.width);
        const scale = targetWidth / bitmap.width;
        const scaledTotalHeight = Math.round(bitmap.height * scale);
        const sliceHeight = 1500;
        const overlap = 90;
        const maxPerImage = Math.min(4, maxSlices - results.length);
        let y = 0;
        for (let count = 0; count < maxPerImage && y < scaledTotalHeight; count++) {
          const h = Math.min(sliceHeight, scaledTotalHeight - y);
          canvas.width = Math.max(1, Math.round(targetWidth));
          canvas.height = Math.max(1, Math.round(h));
          const srcY = y / scale;
          const srcH = h / scale;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, srcY, bitmap.width, srcH, 0, 0, canvas.width, canvas.height);
          results.push(await toDataUrl());
          if (y + h >= scaledTotalHeight) break;
          y += sliceHeight - overlap;
        }
      } else {
        const maxEdge = 1500;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        results.push(await toDataUrl());
      }
    } finally {
      bitmap.close();
    }
  }
  return results;
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
}

interface PlannerXhsImporterProps {
  visible: boolean;
  planTaskBusy: boolean;
  mode: 'create' | 'plan' | 'chat';
  plan?: AiTravelPlan | null;
  initialRefs?: XhsReference[];
  initialReferenceMode?: XhsReferenceMode;
  initialTab?: 'add-places' | 'revise-plan';
  initialTargetDate?: string;
  initialFiles?: File[];
  onClose: () => void;
  onMinimize: () => void;
  onResume: () => void;
  onApplyToCreate?: (refs: XhsReference[], referenceMode: XhsReferenceMode) => void;
  onAddToWishlist?: (refs: XhsReference[]) => Promise<void>;
  onSendPlanPrompt?: (
    prompt: string,
    refs: XhsReference[],
    options: { mode: 'auto' | 'edit'; scopeId?: string | null },
  ) => Promise<boolean>;
  onAttachToChat?: (refs: XhsReference[]) => void;
}

const KIND_ORDER: XhsPlaceKind[] = ['sight', 'food', 'photo_spot', 'lodging', 'other'];

export default function PlannerXhsImporter({
  visible,
  planTaskBusy,
  mode,
  plan = null,
  initialRefs = [],
  initialReferenceMode = DEFAULT_XHS_REFERENCE_MODE,
  initialTab = 'add-places',
  initialTargetDate = 'auto',
  initialFiles,
  onClose,
  onMinimize,
  onResume,
  onApplyToCreate,
  onAddToWishlist,
  onSendPlanPrompt,
  onAttachToChat,
}: PlannerXhsImporterProps) {
  const [refs, setRefs] = useState<XhsReference[]>(() => initialRefs.map((r) => structuredClone(r)));
  const [showInput, setShowInput] = useState<boolean>(initialRefs.length === 0);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const handlingImport = parsing || submitting;
  const planActionsDisabled = handlingImport || planTaskBusy;

  // 新建模式参数
  const [referenceMode, setReferenceMode] = useState<XhsReferenceMode>(initialReferenceMode);

  // 已有行程模式参数
  const [planTab, setPlanTab] = useState<'add-places' | 'revise-plan'>(initialTab);
  const [targetDate, setTargetDate] = useState<string>(initialTargetDate || 'auto');
  const [insertMode, setInsertMode] = useState<'insert' | 'replace'>('insert');
  const [replaceActivityId, setReplaceActivityId] = useState<string>('');
  const [customReviseText, setCustomReviseText] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewsRef = useRef<PendingImage[]>([]);
  previewsRef.current = pendingImages;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      for (const item of previewsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  // 如果从聊天框拖入或粘贴了截图直接打开，自动加入待识别列表并立即触发解析。
  const autoParsedInitial = useRef(false);
  useEffect(() => {
    if (!initialFiles?.length || autoParsedInitial.current) return;
    const valid = initialFiles.filter((file) => file.type.startsWith('image/')).slice(0, 6);
    if (!valid.length) return;
    // 让开发模式的 Strict Mode 完成首次挂载检查后再启动解析，避免首次请求被清理掉。
    const timer = window.setTimeout(() => {
      autoParsedInitial.current = true;
      const items: PendingImage[] = valid.map((file, idx) => ({
        id: `init-${Date.now()}-${idx}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name || `粘贴截图 ${idx + 1}`,
      }));
      setPendingImages(items);
      setShowInput(true);
      void runParse(valid, '');
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  // 弹窗内支持直接 Ctrl+V 粘贴剪贴板截图（光标在文本框内粘贴纯文本时正常输入）。
  useEffect(() => {
    if (!visible || handlingImport) return;
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
      setShowInput(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, handlingImport]);

  // 收起只改变显示状态；解析完成后仍保留输入、勾选状态和结果。
  const dismiss = handlingImport ? onMinimize : onClose;
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dismiss, visible]);

  function addFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    setPendingImages((prev) => {
      const remaining = Math.max(0, 6 - prev.length);
      if (!remaining) {
        setErrorText('单次最多上传 6 张截图，如需更多可解析完后点「再追加一篇」。');
        return prev;
      }
      const next = images.slice(0, remaining).map((file, idx) => ({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${idx}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name || `截图 ${prev.length + idx + 1}`,
      }));
      return [...prev, ...next];
    });
    setErrorText('');
  }

  function removePendingImage(id: string) {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  function clearPendingImages() {
    setPendingImages((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }

  async function runParse(overrideFiles?: File[], overrideText?: string, extraBody?: { noteImageUrls?: string[]; readNoteImages?: boolean; replaceRefId?: string }) {
    if (parsing) return;
    const text = overrideText !== undefined ? overrideText : inputText;
    const files = overrideFiles ?? pendingImages.map((item) => item.file);
    if (!text.trim() && !files.length && !extraBody?.noteImageUrls?.length) {
      setErrorText('请粘贴小红书链接/口令、上传截图（支持 Ctrl+V 粘贴），或粘贴攻略文字。');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setParsing(true);
    setErrorText('');
    setWarnings([]);
    setStatusText(files.length ? '正在处理截图（长图自动分段以防模糊）并交给 AI 解析…' : '正在解析小红书内容…');
    try {
      const encodedImages = files.length ? await prepareXhsImagesForParse(files) : [];
      const result = await plannerApi<XhsParseResponse>(
        'xhs-parse',
        {
          text: text.trim(),
          images: encodedImages,
          ...(extraBody?.noteImageUrls?.length ? { noteImageUrls: extraBody.noteImageUrls } : {}),
          ...(extraBody?.readNoteImages ? { readNoteImages: true } : {}),
          planContext: plan
            ? {
                startDate: plan.content.days[0]?.date ?? '',
                endDate: plan.content.days.at(-1)?.date ?? '',
                cities: plan.content.cities.map((c) => c.name),
              }
            : undefined,
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]),
        (stage) => setStatusText(stage),
      );
      if (controller.signal.aborted) return;
      setRefs((prev) => {
        if (extraBody?.replaceRefId) {
          return prev.map((item) =>
            item.id === extraBody.replaceRefId ? { ...result.reference, id: item.id } : item,
          );
        }
        return mergeXhsReferences(prev, result.reference);
      });
      setWarnings(result.warnings ?? []);
      setStatusText(
        `已解析「${result.reference.title}」，提取 ${result.reference.places.length} 个地点${result.providerLabel ? `（${result.providerLabel}）` : ''}。截图仅瞬时识别，未保存原图。`,
      );
      setInputText('');
      clearPendingImages();
      setShowInput(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorText(error instanceof Error ? error.message : '解析失败，请确认链接或截图清晰后重试');
        setStatusText('');
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setParsing(false);
      }
    }
  }

  const selectedPlaces = useMemo(() => selectedPlacesFromRefs(refs), [refs]);
  const totalPlaces = useMemo(() => refs.reduce((sum, ref) => sum + ref.places.length, 0), [refs]);

  const unlockedActivitiesForTargetDate = useMemo(() => {
    if (!plan || targetDate === 'auto') return [];
    const day = plan.content.days.find((d) => d.date === targetDate);
    if (!day) return [];
    return day.activities.filter((a) => !a.locked && a.kind !== 'transport');
  }, [plan, targetDate]);

  useEffect(() => {
    if (insertMode === 'replace' && targetDate === 'auto' && plan?.content.days.length) {
      setTargetDate(plan.content.days[0].date);
    }
  }, [insertMode, targetDate, plan]);

  useEffect(() => {
    if (!unlockedActivitiesForTargetDate.some((a) => a.id === replaceActivityId)) {
      setReplaceActivityId(unlockedActivitiesForTargetDate[0]?.id ?? '');
    }
  }, [unlockedActivitiesForTargetDate, replaceActivityId]);

  function togglePlace(refId: string, placeId: string) {
    setRefs((prev) =>
      prev.map((ref) =>
        ref.id !== refId
          ? ref
          : {
              ...ref,
              places: ref.places.map((p) => (p.id === placeId ? { ...p, selected: !p.selected } : p)),
            },
      ),
    );
  }

  function updatePlaceName(refId: string, placeId: string, name: string) {
    setRefs((prev) =>
      prev.map((ref) =>
        ref.id !== refId
          ? ref
          : {
              ...ref,
              places: ref.places.map((p) => (p.id === placeId ? { ...p, name, canonicalName: name } : p)),
            },
      ),
    );
  }

  function removePlace(refId: string, placeId: string) {
    setRefs((prev) =>
      prev.map((ref) =>
        ref.id !== refId ? ref : { ...ref, places: ref.places.filter((p) => p.id !== placeId) },
      ),
    );
  }

  function setAllPlaces(refId: string, selected: boolean) {
    setRefs((prev) =>
      prev.map((ref) =>
        ref.id !== refId ? ref : { ...ref, places: ref.places.map((p) => ({ ...p, selected })) },
      ),
    );
  }

  function removeRef(refId: string) {
    setRefs((prev) => {
      const next = prev.filter((item) => item.id !== refId);
      if (!next.length) setShowInput(true);
      return next;
    });
  }

  const compactRefs = () => refs.map(compactXhsReference);

  async function handleSaveWishlist() {
    if (!onAddToWishlist || planActionsDisabled || !selectedPlaces.length) return;
    setSubmitting(true);
    try {
      await onAddToWishlist(compactRefs());
      onClose();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存到待选池失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPlanPrompt(prompt: string, options: { mode: 'auto' | 'edit'; scopeId: string | null }) {
    if (!onSendPlanPrompt || planActionsDisabled) return;
    setSubmitting(true);
    setErrorText('');
    // 对话由规划工作区执行并保存。交给它之后立即释放遮罩，失败时保留草稿供重试。
    onMinimize();
    try {
      if (await onSendPlanPrompt(prompt, compactRefs(), options)) onClose();
      else setErrorText('AI 任务未完成，可在行程中查看原因，或返回草稿后重新提交。');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '提交失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInsertPlaces(askFirst: boolean) {
    if (planActionsDisabled || !selectedPlaces.length) return;
    const replaceAct = unlockedActivitiesForTargetDate.find((a) => a.id === replaceActivityId);
    if (insertMode === 'replace' && !replaceAct) {
      setErrorText('请先选择具体某天和一个未锁定的替换目标，或切换为「顺路插入当天」。');
      return;
    }
    const prompt = buildXhsInsertPrompt(selectedPlaces, {
      targetDate,
      mode: insertMode,
      replaceActivityTitle: replaceAct?.title,
      askFirst,
    });
    await submitPlanPrompt(prompt, {
      mode: askFirst ? 'auto' : 'edit',
      scopeId: insertMode === 'replace' && replaceAct ? replaceAct.id : null,
    });
  }

  async function handleReviseWithPrompt(promptText: string, editDirectly: boolean) {
    if (planActionsDisabled || !refs.length || !promptText.trim()) return;
    await submitPlanPrompt(promptText.trim(), {
      mode: editDirectly ? 'edit' : 'auto',
      scopeId: null,
    });
  }

  const dialogTitle =
    mode === 'create'
      ? '从小红书灵感新建计划'
      : mode === 'chat'
        ? '附加小红书笔记 / 截图到对话'
        : '小红书加景点 / 改计划';

  return <>
    {!visible && createPortal(
      <button className="secondary xhs-resume-task" type="button" onClick={onResume}>
        {parsing ? '小红书解析中 · 查看' : '返回小红书'}
      </button>,
      document.body,
    )}
    <div
      className="dialog-backdrop xhs-dialog-backdrop"
      hidden={!visible}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        className="dialog xhs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
      >
        <div className="card-heading xhs-dialog-header">
          <h2>{dialogTitle}</h2>
          <button
            className="text-button"
            type="button"
            onClick={dismiss}
          >
            {handlingImport ? '收起' : '关闭'}
          </button>
        </div>

        {/* 统一输入区：链接/口令 + 多图截图 + 纯文本 */}
        {showInput ? (
          <div className="xhs-input-panel">
            <label className="xhs-text-label">
              <span>粘贴小红书分享口令 / 链接，或直接粘贴攻略文字</span>
              <textarea
                rows={4}
                disabled={parsing}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="粘贴小红书 App 复制的整段分享文案、笔记链接或正文…"
              />
            </label>

            <div
              className={`booking-dropzone xhs-dropzone ${dragOver ? 'is-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <div>
                <strong>拖入小红书截图，或直接按 Ctrl+V 粘贴（支持 1～6 张 / 长截图自动分段）</strong>
                <small>截图仅在本次解析内存中识别，不会保存到本地磁盘或行程备份</small>
              </div>
              <div className="xhs-dropzone-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={parsing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  选择截图
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={(event) => {
                    if (event.target.files?.length) addFiles(Array.from(event.target.files));
                    event.target.value = '';
                  }}
                />
              </div>
            </div>

            {pendingImages.length > 0 && (
              <div className="xhs-thumb-grid">
                {pendingImages.map((item) => (
                  <figure className="xhs-thumb" key={item.id}>
                    <img src={item.previewUrl} alt={item.name} />
                    <button
                      type="button"
                      className="xhs-thumb-remove"
                      disabled={parsing}
                      aria-label={`移除 ${item.name}`}
                      onClick={() => removePendingImage(item.id)}
                    >
                      ×
                    </button>
                  </figure>
                ))}
              </div>
            )}

            <div className="xhs-parse-bar">
              <button
                type="button"
                className="primary"
                disabled={parsing || (!inputText.trim() && pendingImages.length === 0)}
                onClick={() => void runParse()}
              >
                {parsing ? '解析中…' : '✦ AI 解析小红书内容'}
              </button>
              {parsing && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    abortRef.current?.abort();
                    setParsing(false);
                    setStatusText('已取消解析');
                  }}
                >
                  取消
                </button>
              )}
              {refs.length > 0 && !parsing && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowInput(false)}
                >
                  返回已解析列表（{refs.length} 篇）
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="xhs-add-more-bar">
            <span>已解析 {refs.length} 篇参考笔记 · 已勾选 <strong>{selectedPlaces.length}</strong> / {totalPlaces} 个地点</span>
            <button
              type="button"
              className="secondary"
              disabled={parsing || submitting || refs.length >= MAX_XHS_REFERENCES}
              onClick={() => {
                setShowInput(true);
                setErrorText('');
              }}
            >
              ＋ 再追加一篇笔记 / 截图
            </button>
          </div>
        )}

        {statusText && <p className="booking-status" role="status">{statusText}</p>}
        {warnings.length > 0 && (
          <div className="planner-banner">
            {warnings.map((w, idx) => <p key={idx}>{w}</p>)}
          </div>
        )}
        {errorText && <p className="planner-error" role="alert">{errorText}</p>}

        {/* 结构化确认层：类似圆周旅迹的点位勾选与路线/贴士卡片 */}
        {refs.length > 0 && !showInput && (
          <div className="xhs-ref-list">
            {refs.map((ref) => {
              const refSelectedCount = ref.places.filter((p) => p.selected).length;
              return (
                <article className="xhs-ref-card" key={ref.id}>
                  <div className="xhs-ref-head">
                    <div>
                      <span className="booking-kind-tag">
                        {ref.sourceType === 'xhs_link' ? '小红书链接' : ref.sourceType === 'screenshot' ? '截图识别' : '文字攻略'}
                      </span>
                      <h3>{ref.title}</h3>
                      <small className="muted">
                        {[
                          ref.author ? `作者：${ref.author}` : '',
                          ref.destinations.length ? `城市：${ref.destinations.join('、')}` : '',
                          ref.suggestedDays ? `原帖约 ${ref.suggestedDays} 天` : '',
                        ].filter(Boolean).join(' · ')}
                      </small>
                    </div>
                    <div className="xhs-ref-head-actions">
                      {ref.url && (
                        <a className="text-button" href={ref.url} target="_blank" rel="noopener noreferrer">
                          查看原帖
                        </a>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        disabled={parsing || submitting}
                        onClick={() => removeRef(ref.id)}
                      >
                        移除本篇
                      </button>
                    </div>
                  </div>

                  {ref.styleTags.length > 0 && (
                    <div className="xhs-tag-row">
                      {ref.styleTags.map((tag) => (
                        <span className="xhs-style-tag" key={tag}>#{tag}</span>
                      ))}
                    </div>
                  )}

                  {ref.noteImages && ref.noteImages.length > 0 && (
                    <div className="xhs-note-ocr-bar">
                      <small className="muted">
                        {ref.imageTextSuggested
                          ? '这篇笔记正文较短，核心路线可能在配图里：'
                          : `原帖附带 ${ref.noteImages.length} 张配图，若路线写在图里可点右侧二次识图：`}
                      </small>
                      <button
                        type="button"
                        className="secondary"
                        disabled={parsing || submitting}
                        onClick={() =>
                          void runParse([], ref.title, {
                            noteImageUrls: ref.noteImages!.slice(0, 4),
                            readNoteImages: true,
                            replaceRefId: ref.id,
                          })
                        }
                      >
                        {parsing ? '识图中…' : '识别原帖配图文字'}
                      </button>
                    </div>
                  )}

                  {ref.routeOutline.length > 0 && (
                    <details className="xhs-sub-details">
                      <summary>原帖路线骨架（{ref.routeOutline.length} 段）</summary>
                      <ul>
                        {ref.routeOutline.map((line, i) => <li key={i}>{line}</li>)}
                      </ul>
                    </details>
                  )}

                  {ref.tips.length > 0 && (
                    <details className="xhs-sub-details">
                      <summary>避坑与实用贴士（{ref.tips.length} 条）</summary>
                      <ul>
                        {ref.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                      </ul>
                    </details>
                  )}

                  <div className="xhs-places-header">
                    <strong>提取出的地点（已选 {refSelectedCount}/{ref.places.length}）</strong>
                    <div>
                      <button type="button" className="text-button" onClick={() => setAllPlaces(ref.id, true)}>
                        全选
                      </button>
                      <button type="button" className="text-button" onClick={() => setAllPlaces(ref.id, false)}>
                        全不选
                      </button>
                    </div>
                  </div>

                  {ref.places.length === 0 ? (
                    <p className="muted">未提取到具体地点名称，仍可作为风格与避坑贴士参考。</p>
                  ) : (
                    <div className="xhs-place-list">
                      {[...ref.places]
                        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
                        .map((place: XhsExtractedPlace) => (
                          <div className={`xhs-place-item ${place.selected ? 'is-selected' : ''}`} key={place.id}>
                            <input
                              type="checkbox"
                              checked={place.selected}
                              aria-label={`选择 ${place.name}`}
                              onChange={() => togglePlace(ref.id, place.id)}
                            />
                            <div className="xhs-place-body">
                              <div className="xhs-place-top">
                                <span className={`xhs-kind-badge kind-${place.kind}`}>
                                  {XHS_PLACE_KIND_LABELS[place.kind]}
                                </span>
                                <input
                                  className="xhs-place-name-input"
                                  value={place.name}
                                  aria-label="地点名称"
                                  onChange={(event) => updatePlaceName(ref.id, place.id, event.target.value)}
                                />
                                {place.city && <small className="xhs-place-city">{place.city}</small>}
                                {place.dayHint && <small className="xhs-place-day">原帖 D{place.dayHint}</small>}
                              </div>
                              {place.note && <p className="xhs-place-note">{place.note}</p>}
                            </div>
                            <button
                              type="button"
                              className="text-button xhs-place-del"
                              aria-label={`删除 ${place.name}`}
                              onClick={() => removePlace(ref.id, place.id)}
                            >
                              删
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* 底部去向分流区 */}
        {refs.length > 0 && !showInput && mode === 'create' && (
          <div className="booking-backfill-box xhs-action-box">
            <strong>选择生成时的参考策略</strong>
            <div className="xhs-mode-grid">
              {XHS_REFERENCE_MODE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`xhs-mode-card ${referenceMode === opt.value ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name="xhs-reference-mode"
                    checked={referenceMode === opt.value}
                    onChange={() => setReferenceMode(opt.value)}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <small>{opt.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary"
                disabled={parsing}
                onClick={() => {
                  onApplyToCreate?.(compactRefs(), referenceMode);
                  onClose();
                }}
              >
                带入新建计划（{refs.length} 篇参考 · {selectedPlaces.length} 个地点）
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                取消
              </button>
            </div>
          </div>
        )}

        {refs.length > 0 && !showInput && mode === 'chat' && (
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              disabled={parsing}
              onClick={() => {
                onAttachToChat?.(compactRefs());
                onClose();
              }}
            >
              附加到 AI 对话框（{refs.length} 篇 · {selectedPlaces.length} 个地点）
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              取消
            </button>
          </div>
        )}

        {refs.length > 0 && !showInput && mode === 'plan' && plan && (
          <div className="booking-backfill-box xhs-action-box">
            <div className="booking-kind-pills">
              <button
                type="button"
                className={planTab === 'add-places' ? 'primary' : 'secondary'}
                onClick={() => setPlanTab('add-places')}
              >
                加入行程点位（{selectedPlaces.length}）
              </button>
              <button
                type="button"
                className={planTab === 'revise-plan' ? 'primary' : 'secondary'}
                onClick={() => setPlanTab('revise-plan')}
              >
                参考这篇改计划 / 排雷
              </button>
            </div>

            {planTab === 'add-places' ? (
              <div className="xhs-plan-add-body">
                <div className="xhs-wishlist-quick">
                  <div>
                    <strong>方式 A：先存入「待选灵感池」（0 秒保存，不改当前行程）</strong>
                    <small className="muted">保存后会在侧边栏和行程地图上以 ★ 标记显示，方便看顺路后再决定排进哪一天。</small>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={planActionsDisabled || selectedPlaces.length === 0}
                    onClick={() => void handleSaveWishlist()}
                  >
                    ★ 存入待选池（{selectedPlaces.length}）
                  </button>
                </div>

                <div className="xhs-schedule-box">
                  <strong>方式 B：直接安排进本次行程</strong>
                  <div className="booking-form-grid">
                    <label>
                      目标日期
                      <select value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>
                        {insertMode === 'insert' && (
                          <option value="auto">让 AI 自动选最顺路的一天</option>
                        )}
                        {plan.content.days.map((day, idx) => (
                          <option key={day.date} value={day.date}>
                            DAY {idx + 1} · {day.date}（{day.title}）
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      加入方式
                      <select
                        value={insertMode}
                        onChange={(event) => setInsertMode(event.target.value as 'insert' | 'replace')}
                      >
                        <option value="insert">顺路插入当天（保留已有安排）</option>
                        <option value="replace">替换当天某项未锁定活动</option>
                      </select>
                    </label>
                    {insertMode === 'replace' && (
                      <label className="span-2">
                        要替换的活动（已锁定卡片受保护不可选）
                        <select
                          value={replaceActivityId}
                          onChange={(event) => setReplaceActivityId(event.target.value)}
                        >
                          {unlockedActivitiesForTargetDate.length === 0 ? (
                            <option value="">当天没有可替换的未锁定活动</option>
                          ) : (
                            unlockedActivitiesForTargetDate.map((act) => (
                              <option key={act.id} value={act.id}>
                                {act.startTime}–{act.endTime} {act.title}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={planActionsDisabled || selectedPlaces.length === 0}
                      onClick={() => void handleInsertPlaces(true)}
                    >
                      先让 AI 评估顺路并给方案（推荐）
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={planActionsDisabled || selectedPlaces.length === 0}
                      onClick={() => void handleInsertPlaces(false)}
                    >
                      直接排入行程
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="xhs-revise-body">
                <div className="xhs-quick-prompts">
                  {[
                    {
                      label: '排雷体检（不改行程）',
                      text: '请对照这篇小红书笔记的避坑要点和实操经验，帮我给当前行程做一次排雷体检：指出我计划里的隐患、时间/预约/闭馆风险，以及这篇笔记本身与我出行日期、人数或季节不匹配的地方。先只分析并给出可选调整方案，不要直接修改。',
                    },
                    {
                      label: '把这篇美食融入行程',
                      text: '请参考这篇小红书里我勾选的美食和餐厅，对照我每天的景点位置，提出顺路融入我行程的餐饮优化方案（保留已锁定项与饮食偏好），先给方案 A/B 让我选。',
                    },
                    {
                      label: '参考这篇优化路线顺序',
                      text: '请参考这篇小红书的路线顺序和游玩节奏，对比我当前的行程，看看哪些天可以调整得更顺路、更省腿或更出片，给出具体改造方案（不改动已锁定活动），先不要直接修改。',
                    },
                    {
                      label: '全面对比并给 A/B 改造方案',
                      text: '请对比这篇小红书笔记和我当前的旅行计划：1) 列出这篇笔记值得吸收的新亮点；2) 列出不适合照搬的部分；3) 给出 2 个不同程度的改造方案（如微调融入 vs 重点重构），供我一键实施。',
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="secondary"
                      disabled={planActionsDisabled}
                      onClick={() => void handleReviseWithPrompt(preset.text, false)}
                    >
                      ✦ {preset.label}
                    </button>
                  ))}
                </div>
                <label className="xhs-text-label">
                  <span>或输入你自己的参考改造要求</span>
                  <textarea
                    rows={2}
                    value={customReviseText}
                    onChange={(event) => setCustomReviseText(event.target.value)}
                    placeholder="例如：参考这篇小红书把第二天下午改得更轻松一些，保留锁定景点…"
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={planActionsDisabled || !customReviseText.trim()}
                    onClick={() => void handleReviseWithPrompt(customReviseText, false)}
                  >
                    发给 AI 分析并给方案
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={planActionsDisabled || !customReviseText.trim()}
                    onClick={() => void handleReviseWithPrompt(customReviseText, true)}
                  >
                    直接按要求修改行程
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  </>;
}
