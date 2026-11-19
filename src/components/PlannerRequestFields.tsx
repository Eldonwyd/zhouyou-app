import type { PlannerLuggageMode, PlannerRequest } from '../planner-types';
import { PLANNER_LOCAL_TRANSPORT_OPTIONS, plannerLocalTransport, plannerPartyText, updatePlannerDates } from '../planner-domain';

/** 新建和修改条件共用选择器，旧计划打开时也会显示实际使用的默认值。 */
export function PlannerLuggageField({ value, onChange }: {
  value: PlannerLuggageMode | undefined;
  onChange: (mode: PlannerLuggageMode) => void;
}) {
  return <label className="planner-luggage-field">
    行李方式
    <select aria-label="行李方式" value={value ?? 'suitcase'} onChange={(event) => onChange(event.target.value === 'backpack' ? 'backpack' : 'suitcase')}>
      <option value="suitcase">行李箱出行（默认）</option>
      <option value="backpack">背包出行</option>
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
}: {
  value: PlannerRequest;
  onChange: (request: PlannerRequest) => void;
}) {
  const update = <K extends keyof PlannerRequest>(key: K, next: PlannerRequest[K]) =>
    onChange({ ...value, [key]: next });
  // Counts and any older free-form party description must stay in agreement.
  // Updating numeric controls makes those explicit values the prompt source.
  const updateParty = (patch: Partial<Pick<PlannerRequest, 'people' | 'students' | 'seniors' | 'children'>>) => {
    const next = { ...value, ...patch };
    onChange({ ...next, travelersText: plannerPartyText(next) });
  };
  const groups = [['students', '学生'], ['seniors', '老人'], ['children', '儿童']] as const;
  const groupSummary = groups.filter(([key]) => (value[key] ?? 0) > 0).map(([key, label]) => `${label} ${value[key]}`).join('、');
  return (
    <>
      <div className="planner-input-grid">
        <label>
          目的地（可选）
          <input
            value={value.destination}
            placeholder="例如：丽江、香格里拉"
            onChange={(event) => onChange({ ...value, destination: event.target.value })}
          />
        </label>
        <div className="planner-party">
          <label>
            旅行人群（总人数）
            <input
              type="number"
              min="1"
              step="1"
              value={value.people}
              placeholder="例如：4"
              onChange={(event) => updateParty({ people: Number(event.target.value) })}
            />
          </label>
          {/* 学生、老人、儿童默认收起，不填为 0；其余按成人计价。 */}
          <details className="planner-party-details">
            <summary>其中学生 / 老人 / 儿童{groupSummary ? `：${groupSummary}` : '（不填为 0）'}</summary>
            <div className="planner-party-grid">
              {groups.map(([key, label]) => (
                <label key={key}>
                  {label}人数
                  <input
                    type="number"
                    min="0"
                    max={value.people}
                    step="1"
                    value={value[key] ?? 0}
                    onChange={(event) => updateParty({ [key]: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
              ))}
            </div>
          </details>
        </div>
        <label>
          开始日期
          <input
            type="date"
            required
            value={value.startDate}
            onChange={(event) =>
              onChange(updatePlannerDates(value, { startDate: event.target.value }))
            }
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={value.endDate}
            onChange={(event) =>
              onChange(updatePlannerDates(value, { endDate: event.target.value }))
            }
          />
        </label>
        <label>
          旅行天数
          <input
            type="number"
            step="1"
            min="1"
            value={value.days ?? ''}
            placeholder="留空先让 AI 推荐时长"
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
          Base／所在地（可选）
          <input
            value={value.base}
            placeholder="例如：广州"
            onChange={(event) => update('base', event.target.value)}
          />
        </label>
      </div>
      <p className="muted">结束日期和天数会自动换算；只填开始日期，也可以让 AI 推荐。</p>
      <details className="planner-preferences">
        <summary>预算、节奏、交通与吃住偏好（可选）</summary>
        <div className="planner-input-grid">
          <label>
            整次旅行预算（元）
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.budgetCents === null ? '' : value.budgetCents / 100}
              placeholder="例如：5000（全部同行者合计）"
              onChange={(event) =>
                update(
                  'budgetCents',
                  event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
                )
              }
            />
          </label>
          <label>
            游玩节奏
            <select
              aria-label="游玩节奏"
              value={value.pace || '均衡'}
              onChange={(event) => update('pace', event.target.value)}
            >
              <option>均衡</option>
              <option>特种兵</option>
              <option>慢慢玩</option>
            </select>
          </label>
          <label>
            当地交通
            <select
              aria-label="当地交通"
              value={plannerLocalTransport(value.transport)}
              onChange={(event) => update('transport', event.target.value)}
            >
              {PLANNER_LOCAL_TRANSPORT_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            住宿档次
            <select
              aria-label="住宿档次"
              value={value.lodgingLevel || '舒适经济'}
              onChange={(event) => update('lodgingLevel', event.target.value)}
            >
              <option>舒适经济</option>
              <option>节省预算</option>
              <option>舒适优先</option>
            </select>
          </label>
          <label>
            房间数
            <input
              type="number"
              min="1"
              step="1"
              value={value.rooms ?? ''}
              placeholder={`默认 ${Math.ceil(Math.max(1, value.people) / 2)} 间（每间两人）`}
              onChange={(event) =>
                update('rooms', event.target.value === '' ? null : Number(event.target.value))
              }
            />
          </label>
          <label>
            忌口／饮食偏好
            <input
              value={value.dietary}
              placeholder="例如：不吃辣、素食"
              onChange={(event) => update('dietary', event.target.value)}
            />
          </label>
        </div>
      </details>
      <label>
        补充要求（可任意填写）
        <textarea
          rows={5}
          value={value.notes}
          placeholder="例如：前两天丽江，后面去香格里拉；不要早起；必去玉龙雪山；希望少换住宿。也可以补充预算、交通和不想去的地方。"
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
          开启当地美食推荐
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.skipBreakfast}
            onChange={(event) => onChange({ ...value, skipBreakfast: event.target.checked })}
          />
          不吃早餐
        </label>
      </div>
    </>
  );
}
