import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { PlannerLuggageMode, PlannerRequest } from '../planner-types';
import { PLANNER_LOCAL_TRANSPORT_OPTIONS, plannerLocalTransport, plannerPartyText, updatePlannerDates } from '../planner-domain';
import { useI18n } from '../i18n';
import ThemedDatePicker from './ThemedDatePicker';

/** 新建和修改条件共用选择器，旧计划打开时也会显示实际使用的默认值。 */
export function PlannerLuggageField({ value, onChange }: {
  value: PlannerLuggageMode | undefined;
  onChange: (mode: PlannerLuggageMode) => void;
}) {
  const { t } = useI18n();
  return <label className="planner-luggage-field">
    {t('行李方式', 'Luggage')}
    <select aria-label={t('行李方式', 'Luggage')} value={value ?? 'suitcase'} onChange={(event) => onChange(event.target.value === 'backpack' ? 'backpack' : 'suitcase')}>
      <option value="suitcase">{t('行李箱出行（默认）', 'Suitcase (default)')}</option>
      <option value="backpack">{t('背包出行', 'Backpack')}</option>
    </select>
  </label>;
}

/** Preserve the original structured choices and explanatory examples. Only
 * trip-level departure time/return transport have been removed; activity times
 * remain editable in the itinerary. Dates and duration use one shared helper.
 */
export default function PlannerRequestFields({
  value,
  onChange,
  extraPreferences,
}: {
  value: PlannerRequest;
  onChange: (request: PlannerRequest) => void;
  extraPreferences?: ReactNode;
}) {
  const { t } = useI18n();
  const update = <K extends keyof PlannerRequest>(key: K, next: PlannerRequest[K]) =>
    onChange({ ...value, [key]: next });
  // Counts and any older free-form party description must stay in agreement.
  // Updating numeric controls makes those explicit values the prompt source.
  const updateParty = (patch: Partial<Pick<PlannerRequest, 'people' | 'students' | 'seniors' | 'children'>>) => {
    const next = { ...value, ...patch };
    onChange({ ...next, travelersText: plannerPartyText(next) });
  };
  type PartyCountKey = 'people' | 'students' | 'seniors' | 'children';
  const [partyDrafts, setPartyDrafts] = useState<Record<PartyCountKey, string>>({
    people: String(value.people ?? 1),
    students: String(value.students ?? 0),
    seniors: String(value.seniors ?? 0),
    children: String(value.children ?? 0),
  });
  useEffect(() => {
    setPartyDrafts((prev) => ({
      people: prev.people === '' ? '' : String(value.people ?? 1),
      students: prev.students === '' ? '' : String(value.students ?? 0),
      seniors: prev.seniors === '' ? '' : String(value.seniors ?? 0),
      children: prev.children === '' ? '' : String(value.children ?? 0),
    }));
  }, [value.people, value.students, value.seniors, value.children]);

  const handlePartyInput = (key: PartyCountKey, raw: string) => {
    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (digitsOnly === '') {
      setPartyDrafts((prev) => ({ ...prev, [key]: '' }));
      if (key !== 'people') updateParty({ [key]: 0 });
      return;
    }
    // 去掉前导 0，避免从 0 开始输入时变成 01 / 02
    const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
    const parsed = Number.parseInt(normalized, 10);
    const clamped = key === 'people'
      ? Math.max(1, parsed)
      : Math.max(0, Math.min(Math.max(1, value.people), parsed));
    setPartyDrafts((prev) => ({ ...prev, [key]: String(clamped) }));
    updateParty({ [key]: clamped });
  };

  const handlePartyBlur = (key: PartyCountKey) => {
    const fallback = key === 'people' ? 1 : 0;
    const raw = partyDrafts[key].trim();
    if (raw === '') {
      setPartyDrafts((prev) => ({ ...prev, [key]: String(fallback) }));
      updateParty({ [key]: fallback });
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const clamped = Number.isFinite(parsed)
      ? (key === 'people' ? Math.max(1, parsed) : Math.max(0, Math.min(Math.max(1, value.people), parsed)))
      : fallback;
    setPartyDrafts((prev) => ({ ...prev, [key]: String(clamped) }));
    updateParty({ [key]: clamped });
  };

  const groups = [
    ['students', t('学生', 'Students')],
    ['seniors', t('老人', 'Seniors')],
    ['children', t('儿童', 'Children')],
  ] as const;
  const groupSummary = groups.filter(([key]) => (value[key] ?? 0) > 0).map(([key, label]) => `${label} ${value[key]}`).join(t('、', ', '));
  const peopleInputId = useId();
  const partyRef = useRef<HTMLDivElement>(null);
  const [partyOpen, setPartyOpen] = useState(false);

  useEffect(() => {
    if (!partyOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (partyRef.current && !partyRef.current.contains(event.target as Node)) {
        setPartyOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPartyOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [partyOpen]);

  return (
    <>
      <div className="planner-input-grid">
        <label>
          {t('目的地（可选）', 'Destination (optional)')}
          <input
            value={value.destination}
            placeholder={t('例如：丽江、香格里拉', 'e.g. Lijiang, Shangri-La')}
            onChange={(event) => onChange({ ...value, destination: event.target.value })}
          />
        </label>
        <div className="planner-party" ref={partyRef}>
          <label htmlFor={peopleInputId}>
            {t('旅行人群（总人数）', 'Travelers (total)')}
          </label>
          <div className="planner-party-input-wrap">
            <input
              id={peopleInputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={partyDrafts.people}
              placeholder={t('例如：4', 'e.g. 4')}
              onChange={(event) => handlePartyInput('people', event.target.value)}
              onBlur={() => handlePartyBlur('people')}
            />
            {/* 学生、老人、儿童默认收起为输入框右侧小按钮，避免撑高整行；不填为 0，其余按成人计价。 */}
            <button
              type="button"
              className={`planner-party-toggle${groupSummary ? ' has-value' : ''}`}
              aria-expanded={partyOpen}
              title={
                groupSummary
                  ? t(`学生 / 老人 / 儿童：${groupSummary}`, `Students / Seniors / Children: ${groupSummary}`)
                  : t('学生 / 老人 / 儿童（选填）', 'Students / Seniors / Children (optional)')
              }
              onClick={() => setPartyOpen((open) => !open)}
            >
              <span className="planner-party-toggle-label">
                {groupSummary || t('学生/老人/儿童', 'Groups')}
              </span>
              <span className="planner-party-toggle-arrow" aria-hidden="true">
                {partyOpen ? '▴' : '▾'}
              </span>
            </button>
          </div>
          {partyOpen && (
            <div
              className="planner-party-popover"
              role="group"
              aria-label={t('学生 / 老人 / 儿童（选填）', 'Students / Seniors / Children (optional)')}
            >
              <div className="planner-party-popover-head">
                <span>{t('学生 / 老人 / 儿童（选填）', 'Students / Seniors / Children (optional)')}</span>
                <button
                  type="button"
                  className="planner-party-popover-close"
                  onClick={() => setPartyOpen(false)}
                >
                  {t('完成', 'Done')}
                </button>
              </div>
              <div className="planner-party-grid">
                {groups.map(([key, label]) => (
                  <label key={key}>
                    {t(`${label}人数`, label)}
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={partyDrafts[key]}
                      placeholder="0"
                      onChange={(event) => handlePartyInput(key, event.target.value)}
                      onBlur={() => handlePartyBlur(key)}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <label>
          {t('开始日期', 'Start Date')}
          <ThemedDatePicker
            required
            title={t('开始日期', 'Start Date')}
            value={value.startDate}
            onChange={(val) =>
              onChange(updatePlannerDates(value, { startDate: val }))
            }
          />
        </label>
        <label>
          {t('结束日期', 'End Date')}
          <ThemedDatePicker
            min={value.startDate}
            title={t('结束日期', 'End Date')}
            value={value.endDate}
            onChange={(val) =>
              onChange(updatePlannerDates(value, { endDate: val }))
            }
          />
        </label>
        <label>
          {t('旅行天数', 'Days')}
          <input
            type="number"
            step="1"
            min="1"
            value={value.days ?? ''}
            placeholder={t('留空由 AI 推荐', 'Leave blank for AI')}
            onChange={(event) =>
              onChange(
                updatePlannerDates(value, {
                  days: event.target.value === '' ? null : Number(event.target.value),
                }),
              )
            }
          />
        </label>
        <label>
          {t('所在地（选填）', 'Departure City (optional)')}
          <input
            value={value.base}
            placeholder={t('例如：广州', 'e.g. Guangzhou')}
            onChange={(event) => update('base', event.target.value)}
          />
        </label>
      </div>
      <p className="muted planner-date-hint">{t('日期与天数自动换算，留空可由 AI 推荐', 'Dates and days sync automatically; leave blank for AI suggestions')}</p>
      <details className="planner-preferences">
        <summary>{t('预算、节奏与吃住偏好（选填）', 'Budget, Pace & Preferences (optional)')}</summary>
        <div className="planner-input-grid">
          <label>
            {t('总预算（元）', 'Total Budget (CNY)')}
            <input
              aria-label={t('整次旅行预算（元）', 'Total trip budget (CNY)')}
              type="number"
              min="0"
              step="0.01"
              value={value.budgetCents === null ? '' : value.budgetCents / 100}
              placeholder={t('如 5000（合计）', 'e.g. 5000')}
              onChange={(event) =>
                update(
                  'budgetCents',
                  event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
                )
              }
            />
          </label>
          <label>
            {t('游玩节奏', 'Travel Pace')}
            <select
              aria-label={t('游玩节奏', 'Travel Pace')}
              value={value.pace || '均衡'}
              onChange={(event) => update('pace', event.target.value)}
            >
              <option value="均衡">{t('均衡', 'Balanced')}</option>
              <option value="特种兵">{t('特种兵', 'Fast-paced')}</option>
              <option value="慢慢玩">{t('慢慢玩', 'Relaxed')}</option>
            </select>
          </label>
          <label>
            {t('当地交通', 'Local Transport')}
            <select
              aria-label={t('当地交通', 'Local Transport')}
              value={plannerLocalTransport(value.transport)}
              onChange={(event) => update('transport', event.target.value)}
            >
              {PLANNER_LOCAL_TRANSPORT_OPTIONS.map(({ value: optValue, label }) => <option key={optValue} value={optValue}>{label}</option>)}
            </select>
          </label>
          <label>
            {t('住宿档次', 'Lodging Tier')}
            <select
              aria-label={t('住宿档次', 'Lodging Tier')}
              value={value.lodgingLevel || '舒适经济'}
              onChange={(event) => update('lodgingLevel', event.target.value)}
            >
              <option value="舒适经济">{t('舒适经济', 'Comfort Economy')}</option>
              <option value="节省预算">{t('节省预算', 'Budget')}</option>
              <option value="舒适优先">{t('舒适优先', 'Comfort First')}</option>
            </select>
          </label>
          <label>
            {t('房间数', 'Rooms')}
            <input
              type="number"
              min="1"
              step="1"
              value={value.rooms ?? ''}
              placeholder={t(`默认 ${Math.ceil(Math.max(1, value.people) / 2)} 间`, `Default ${Math.ceil(Math.max(1, value.people) / 2)}`)}
              onChange={(event) =>
                update('rooms', event.target.value === '' ? null : Number(event.target.value))
              }
            />
          </label>
          <label>
            {t('忌口 / 饮食', 'Dietary Notes')}
            <input
              aria-label={t('忌口／饮食偏好', 'Dietary preferences')}
              value={value.dietary}
              placeholder={t('如：不吃辣、素食', 'e.g. No spicy food, vegetarian')}
              onChange={(event) => update('dietary', event.target.value)}
            />
          </label>
          {!extraPreferences && (
            <PlannerLuggageField
              value={value.luggageMode}
              onChange={(luggageMode) => update('luggageMode', luggageMode)}
            />
          )}
        </div>
      </details>
      {extraPreferences}
      <label className="planner-notes-field">
        {t('补充要求（选填）', 'Additional Notes (optional)')}
        <textarea
          aria-label={t('补充要求（可任意填写）', 'Additional notes')}
          rows={3}
          value={value.notes}
          placeholder={t('如：前两天丽江、后去香格里拉；不想早起；必去玉龙雪山，尽量少换住宿。', 'e.g. 2 days in Lijiang then Shangri-La; no early mornings; must-see Jade Dragon Snow Mountain.')}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
        />
      </label>
      <div className="planner-checks">
        <label>
          <input
            type="checkbox"
            checked={value.foodMode}
            onChange={(event) => onChange({ ...value, foodMode: event.target.checked })}
          />
          {t('当地美食推荐', 'Local Food Picks')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.skipBreakfast}
            onChange={(event) => onChange({ ...value, skipBreakfast: event.target.checked })}
          />
          {t('不吃早餐', 'Skip Breakfast')}
        </label>
      </div>
    </>
  );
}
