import { useState } from 'react';
import type {
  AiTravelPlan,
  PackingCategory,
  PackingItem,
  PackingList,
  PackingTemplate,
  PlannerPreferences,
} from '../planner-types';
import { plannerApi } from '../planner-api';
import { createLocalId } from '../utils';

export const PACKING_CATEGORY_LABELS: Record<PackingCategory, string> = {
  documents: '证件票据',
  clothing: '衣物鞋帽',
  medicine: '常备药品',
  electronics: '电子设备',
  bookings: '预约核对',
  other: '其他物品',
};
const PACKING_CATEGORIES = Object.keys(PACKING_CATEGORY_LABELS) as PackingCategory[];

interface PlannerPackingListProps {
  plan: AiTravelPlan;
  preferences: PlannerPreferences | undefined;
  disabled?: boolean;
  onSavePacking: (packingList: PackingList) => Promise<void>;
  onSavePreferences: (preferences: PlannerPreferences) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export default function PlannerPackingList({
  plan,
  preferences,
  disabled = false,
  onSavePacking,
  onSavePreferences,
  onNotice,
  onError,
}: PlannerPackingListProps) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [newCategory, setNewCategory] = useState<PackingCategory>('documents');
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const items = plan.packingList?.items ?? [];
  const templates = preferences?.packingTemplates ?? [];
  const checkedCount = items.filter((item) => item.checked).length;

  async function saveItems(nextItems: PackingItem[], generatedByAi?: boolean) {
    await onSavePacking({
      items: nextItems,
      updatedAt: new Date().toISOString(),
      generatedByAi: generatedByAi ?? plan.packingList?.generatedByAi,
    });
  }

  async function generateByAi() {
    if (busy || disabled) return;
    setBusy(true);
    setStage('正在结合季节、天气与人群生成行前清单…');
    try {
      const result = await plannerApi<PackingList>(
        'packing',
        { plan },
        AbortSignal.timeout(90000),
        (msg) => setStage(msg),
      );
      // 保留之前已经手动勾选过的同名物品状态，避免重新生成丢进度。
      const checkedNames = new Set(items.filter((item) => item.checked).map((item) => item.name));
      const merged = result.items.map((item) => ({
        ...item,
        checked: checkedNames.has(item.name),
      }));
      await saveItems(merged, true);
      onNotice(`已生成 ${merged.length} 项行前准备清单。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : '生成行前清单失败');
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  async function toggleItem(id: string) {
    try {
      await saveItems(items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
    } catch (error) {
      onError(error instanceof Error ? error.message : '更新清单失败');
    }
  }

  async function removeItem(id: string) {
    try {
      await saveItems(items.filter((item) => item.id !== id));
    } catch (error) {
      onError(error instanceof Error ? error.message : '删除清单项失败');
    }
  }

  async function addItem() {
    const name = newName.trim();
    if (!name) return;
    const note = newNote.trim();
    const next: PackingItem = {
      id: createLocalId(),
      category: newCategory,
      name,
      ...(note ? { note } : {}),
      checked: false,
    };
    try {
      await saveItems([...items, next]);
      setNewName('');
      setNewNote('');
    } catch (error) {
      onError(error instanceof Error ? error.message : '添加清单项失败');
    }
  }

  async function saveAsTemplate() {
    const name = templateName.trim();
    if (!name || !items.length) return;
    const template: PackingTemplate = {
      id: createLocalId(),
      name,
      items: items.map(({ category, name: itemName, note }) => ({
        category,
        name: itemName,
        ...(note ? { note } : {}),
      })),
      createdAt: new Date().toISOString(),
    };
    const nextPrefs: PlannerPreferences = {
      id: 'planner',
      base: preferences?.base ?? '',
      favorites: preferences?.favorites ?? [],
      packingTemplates: [template, ...templates],
    };
    try {
      await onSavePreferences(nextPrefs);
      setTemplateName('');
      setSavingTemplate(false);
      onNotice(`已保存为个人模板「${name}」。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存模板失败');
    }
  }

  async function applyTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    const existingNames = new Set(items.map((item) => item.name));
    const additions: PackingItem[] = template.items
      .filter((item) => !existingNames.has(item.name))
      .map((item) => ({
        id: createLocalId(),
        category: item.category,
        name: item.name,
        ...(item.note ? { note: item.note } : {}),
        checked: false,
      }));
    if (!additions.length) {
      onNotice('该模板中的物品已全部在当前清单中。');
      return;
    }
    try {
      await saveItems([...items, ...additions]);
      onNotice(`已从模板「${template.name}」补充 ${additions.length} 项物品。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : '套用模板失败');
    }
  }

  async function deleteTemplate(templateId: string) {
    const target = templates.find((t) => t.id === templateId);
    if (!target || !preferences) return;
    try {
      await onSavePreferences({
        ...preferences,
        packingTemplates: templates.filter((t) => t.id !== templateId),
      });
      setSelectedTemplateId('');
      onNotice(`已删除模板「${target.name}」。`);
    } catch (error) {
      onError(error instanceof Error ? error.message : '删除模板失败');
    }
  }

  return (
    <details className="planner-notes planner-packing-list" aria-label="行前准备清单">
      <summary>
        行前准备清单
        {items.length > 0 && <span className="packing-badge">{checkedCount}/{items.length} 已准备</span>}
      </summary>

      <div className="packing-toolbar">
        <button type="button" className="primary" disabled={busy || disabled} onClick={() => void generateByAi()}>
          {busy ? '生成中…' : items.length ? 'AI 重新生成清单' : 'AI 生成行前清单'}
        </button>
        {items.length > 0 && (
          <button
            type="button"
            className="secondary"
            disabled={busy || disabled}
            onClick={() => {
              setTemplateName(templateName || `${plan.content.cities[0]?.name ?? '我的'}出行模板`);
              setSavingTemplate(!savingTemplate);
            }}
          >
            存为个人模板
          </button>
        )}
        {templates.length > 0 && (
          <div className="packing-template-picker">
            <select
              aria-label="选择行前清单模板"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              <option value="">套用已存模板（{templates.length}）</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}（{tpl.items.length}项）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={!selectedTemplateId || busy || disabled}
              onClick={() => void applyTemplate(selectedTemplateId)}
            >
              套用
            </button>
            {selectedTemplateId && (
              <button
                type="button"
                className="text-button"
                disabled={busy || disabled}
                onClick={() => void deleteTemplate(selectedTemplateId)}
              >
                删模板
              </button>
            )}
          </div>
        )}
      </div>

      {stage && <p className="muted" role="status">{stage}</p>}

      {savingTemplate && (
        <form
          className="packing-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveAsTemplate();
          }}
        >
          <input
            aria-label="模板名称"
            placeholder="例如：高原5日游 / 带娃海边必备"
            maxLength={40}
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!templateName.trim()}>保存模板</button>
          <button type="button" className="text-button" onClick={() => setSavingTemplate(false)}>取消</button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="muted">点击“AI 生成行前清单”结合季节、天气与同行人群自动整理，也可在下方手动添加。</p>
      ) : (
        <div className="packing-groups">
          {PACKING_CATEGORIES.map((category) => {
            const rows = items.filter((item) => item.category === category);
            if (!rows.length) return null;
            return (
              <section className="packing-group" key={category}>
                <h4>
                  {PACKING_CATEGORY_LABELS[category]}
                  <small>{rows.filter((r) => r.checked).length}/{rows.length}</small>
                </h4>
                <ul>
                  {rows.map((item) => (
                    <li key={item.id} className={item.checked ? 'is-checked' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.checked}
                          disabled={disabled}
                          onChange={() => void toggleItem(item.id)}
                        />
                        <span>
                          <strong>{item.name}</strong>
                          {item.note && <small>{item.note}</small>}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="text-button packing-remove"
                        aria-label={`删除 ${item.name}`}
                        disabled={disabled}
                        onClick={() => void removeItem(item.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <form
        className="packing-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addItem();
        }}
      >
        <select
          aria-label="新增物品分类"
          value={newCategory}
          onChange={(event) => setNewCategory(event.target.value as PackingCategory)}
        >
          {PACKING_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{PACKING_CATEGORY_LABELS[cat]}</option>
          ))}
        </select>
        <input
          aria-label="新增物品名称"
          placeholder="手动添加物品，如：学生证 / 防晒霜"
          maxLength={60}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <input
          aria-label="物品备注（可选）"
          placeholder="备注（可选）"
          maxLength={80}
          value={newNote}
          onChange={(event) => setNewNote(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={!newName.trim() || disabled}>添加</button>
      </form>
    </details>
  );
}
