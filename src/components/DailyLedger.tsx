import { useMemo, useState } from 'react';
import type { ExpenseAmounts, ExpenseCategory, ExpenseSplitItem, TripPlan } from '../types';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_LABELS,
  calculateAaSplit,
  defaultSplitMembers,
  expenseDates,
  expenseTotal,
  expenseTotals,
  formatAaSettlementText,
  overallExpenses,
  unallocatedFood,
  updateExpenses,
} from '../finance';
import { createLocalId, currency } from '../utils';

/** 金额符号采用独立网格列，不能覆盖输入内容；清空时移除该项。 */
function ExpenseFields({ title, amounts, onChange }: { title: string; amounts: ExpenseAmounts; onChange: (amounts: ExpenseAmounts) => void }) {
  return <section className="amount-section"><h3>{title}</h3><div className="amount-grid">
    {EXPENSE_CATEGORIES.map((key) => <label key={key}>{EXPENSE_LABELS[key]}<span className="money-input"><span aria-hidden="true">¥</span>
      <input aria-label={EXPENSE_LABELS[key]} type="number" min="0" step="0.01" inputMode="decimal" placeholder="可留空" value={amounts[key] ?? ''} onChange={(event) => {
        const next = { ...amounts };
        if (event.target.value === '') delete next[key];
        else next[key] = Math.round(Math.max(0, Number(event.target.value) || 0) * 100) / 100;
        onChange(next);
      }} />
    </span></label>)}
  </div></section>;
}

/** 日账、整程与 AA 分账编辑同一份草稿，切换视图不会丢失未保存的金额。 */
export default function DailyLedger({ plan, startDate, endDate, companions = [], tripTitle = '', onChange }: {
  plan: TripPlan;
  startDate: string;
  endDate: string;
  companions?: string[];
  tripTitle?: string;
  onChange: (plan: TripPlan) => void;
}) {
  const [view, setView] = useState<'daily' | 'complete' | 'split'>('complete');
  const [selectedDate, setSelectedDate] = useState(startDate);
  const dates = expenseDates(startDate, endDate, Object.keys(plan.dailyExpenses ?? {}));
  const date = dates.includes(selectedDate) ? selectedDate : dates[0] ?? '';
  const daily = plan.dailyExpenses?.[date] ?? {};
  const totals = expenseTotals(plan);
  const oldFood = unallocatedFood(plan);
  const total = Math.round((expenseTotal(totals) + oldFood) * 100) / 100;

  // 同行人 AA 分账状态
  const members = useMemo(
    () => defaultSplitMembers(plan.people, companions, plan.splitMembers),
    [plan.people, companions, plan.splitMembers],
  );
  const splitItems = plan.splitItems ?? [];
  const aaSummary = useMemo(() => calculateAaSplit(members, splitItems), [members, splitItems]);

  const [newMember, setNewMember] = useState('');
  const [splitDate, setSplitDate] = useState(date);
  const [splitCategory, setSplitCategory] = useState<ExpenseCategory>('dinner');
  const [splitTitle, setSplitTitle] = useState('');
  const [splitAmount, setSplitAmount] = useState('');
  const [splitPayer, setSplitPayer] = useState('');
  const [splitParticipants, setSplitParticipants] = useState<string[] | null>(null);
  const [syncToDaily, setSyncToDaily] = useState(true);
  const [copiedMsg, setCopiedMsg] = useState('');

  const activePayer = splitPayer && members.includes(splitPayer) ? splitPayer : members[0] ?? '我';
  const activeParticipants = useMemo(() => {
    const chosen = (splitParticipants ?? members).filter((name) => members.includes(name));
    return chosen.length ? chosen : members;
  }, [splitParticipants, members]);

  function updateSplit(nextMembers: string[], nextItems: ExpenseSplitItem[], basePlan: TripPlan = plan) {
    onChange({ ...basePlan, splitMembers: nextMembers, splitItems: nextItems });
  }

  function addMember() {
    const name = newMember.trim();
    if (!name || members.includes(name)) return;
    const nextMembers = [...members, name];
    setNewMember('');
    setSplitParticipants(null);
    updateSplit(nextMembers, splitItems);
  }

  function removeMember(name: string) {
    if (members.length <= 1) return;
    const nextMembers = members.filter((m) => m !== name);
    const fallbackPayer = nextMembers[0];
    const nextItems = splitItems.map((item) => {
      const nextParts = item.participants.filter((p) => p !== name);
      return {
        ...item,
        payer: item.payer === name ? fallbackPayer : item.payer,
        participants: nextParts.length ? nextParts : [fallbackPayer],
      };
    });
    updateSplit(nextMembers, nextItems);
  }

  function addSplitItem() {
    const yuan = Math.round(Math.max(0, Number(splitAmount) || 0) * 100) / 100;
    const amountCents = Math.round(yuan * 100);
    if (amountCents <= 0 || !activePayer || !activeParticipants.length) return;
    const itemDate = splitDate || date || '';
    const item: ExpenseSplitItem = {
      id: createLocalId(),
      date: itemDate,
      category: splitCategory,
      title: splitTitle.trim() || `${EXPENSE_LABELS[splitCategory]}支出`,
      amountCents,
      payer: activePayer,
      participants: [...activeParticipants],
    };
    let nextPlan: TripPlan = plan;
    if (syncToDaily) {
      if (itemDate) {
        const dailyExpenses = { ...plan.dailyExpenses };
        const row = { ...(dailyExpenses[itemDate] ?? {}) };
        const prevCents = Math.round((row[splitCategory] ?? 0) * 100);
        row[splitCategory] = (prevCents + amountCents) / 100;
        dailyExpenses[itemDate] = row;
        nextPlan = updateExpenses(plan, { dailyExpenses });
      } else {
        const overall = { ...overallExpenses(plan) };
        const prevCents = Math.round((overall[splitCategory] ?? 0) * 100);
        overall[splitCategory] = (prevCents + amountCents) / 100;
        nextPlan = updateExpenses(plan, { overallExpenses: overall });
      }
    }
    updateSplit(members, [item, ...splitItems], nextPlan);
    setSplitTitle('');
    setSplitAmount('');
  }

  function importFromDailyLedger() {
    const existingKeys = new Set(splitItems.map((item) => `${item.date}|${item.category}|${item.amountCents}`));
    const additions: ExpenseSplitItem[] = [];
    for (const [day, row] of Object.entries(plan.dailyExpenses ?? {})) {
      for (const cat of EXPENSE_CATEGORIES) {
        const cents = Math.round((row[cat] ?? 0) * 100);
        if (cents <= 0) continue;
        const key = `${day}|${cat}|${cents}`;
        if (existingKeys.has(key)) continue;
        additions.push({
          id: createLocalId(),
          date: day,
          category: cat,
          title: `${day} · ${EXPENSE_LABELS[cat]}`,
          amountCents: cents,
          payer: members[0] ?? '我',
          participants: [...members],
        });
      }
    }
    const overall = overallExpenses(plan);
    for (const cat of EXPENSE_CATEGORIES) {
      const cents = Math.round((overall[cat] ?? 0) * 100);
      if (cents <= 0) continue;
      const key = `|${cat}|${cents}`;
      if (existingKeys.has(key)) continue;
      additions.push({
        id: createLocalId(),
        date: '',
        category: cat,
        title: `整程 · ${EXPENSE_LABELS[cat]}`,
        amountCents: cents,
        payer: members[0] ?? '我',
        participants: [...members],
      });
    }
    if (!additions.length) return;
    updateSplit(members, [...additions, ...splitItems]);
  }

  function updateSplitRecord(id: string, patch: Partial<ExpenseSplitItem>) {
    updateSplit(
      members,
      splitItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeSplitRecord(id: string) {
    updateSplit(members, splitItems.filter((item) => item.id !== id));
  }

  async function copySettlement() {
    const text = formatAaSettlementText(tripTitle, aaSummary);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg('已复制结算单，可直接粘贴到微信群');
      window.setTimeout(() => setCopiedMsg(''), 3500);
    } catch {
      setCopiedMsg('复制失败，请手动选中文本复制');
    }
  }

  return <div className="daily-ledger">
    <div className="heading-actions ledger-view-switch" role="group" aria-label="账单范围">
      <button type="button" className={view === 'daily' ? 'primary' : 'secondary'} aria-pressed={view === 'daily'} onClick={() => setView('daily')}>每日账单</button>
      <button type="button" className={view === 'complete' ? 'primary' : 'secondary'} aria-pressed={view === 'complete'} onClick={() => setView('complete')}>完整账单</button>
      <button type="button" className={view === 'split' ? 'primary' : 'secondary'} aria-pressed={view === 'split'} onClick={() => setView('split')}>
        AA 分账结算{splitItems.length ? `（${splitItems.length}）` : ''}
      </button>
    </div>

    {view === 'daily' ? <>
      <label className="stacked">账单日期<select aria-label="账单日期" value={date} onChange={(event) => setSelectedDate(event.target.value)}>
        {dates.map((day) => <option key={day} value={day}>{day}</option>)}
      </select></label>
      {date ? <ExpenseFields title={`${date} · 实际花费`} amounts={daily} onChange={(amounts) => {
        const dailyExpenses = { ...plan.dailyExpenses };
        if (Object.keys(amounts).length) dailyExpenses[date] = amounts;
        else delete dailyExpenses[date];
        onChange(updateExpenses(plan, { dailyExpenses }));
      }} /> : <p>填写行程日期后即可记录每日账单。</p>}
      <p className="ledger-total" aria-live="polite">当天合计 <strong data-testid="daily-total">{currency(expenseTotal(daily))}</strong></p>
    </> : view === 'complete' ? <>
      <section className="amount-section"><h3>整程分类合计</h3><div className="ledger-category-totals">
        {EXPENSE_CATEGORIES.map((key) => <div key={key}><span>{EXPENSE_LABELS[key]}</span><strong>{currency(totals[key] ?? 0)}</strong></div>)}
      </div></section>
      <section className="amount-section"><h3>每日账单汇总</h3><div className="ledger-table-scroll"><table className="ledger-table">
        <thead><tr><th>日期</th>{EXPENSE_CATEGORIES.map((key) => <th key={key}>{EXPENSE_LABELS[key]}</th>)}<th>当天合计</th></tr></thead>
        <tbody>{dates.map((day) => <tr key={day}><th><button className="text-button" onClick={() => { setSelectedDate(day); setView('daily'); }}>{day}</button></th>
          {EXPENSE_CATEGORIES.map((key) => <td key={key}>{plan.dailyExpenses?.[day]?.[key] == null ? '—' : currency(plan.dailyExpenses[day][key]!)}</td>)}
          <td>{currency(expenseTotal(plan.dailyExpenses?.[day] ?? {}))}</td>
        </tr>)}</tbody>
      </table></div></section>
      <ExpenseFields title="整程补充花费" amounts={overallExpenses(plan)} onChange={(amounts) => onChange(updateExpenses(plan, { overallExpenses: amounts }))} />
      <p className="muted">每日明细已自动计入整程合计。整程补充花费用于不归属某一天的支出，无需重复填写。</p>
      {oldFood > 0 && <label className="stacked">原有餐饮（未分三餐）<input type="number" min="0" step="0.01" value={oldFood} onChange={(event) => onChange(updateExpenses(plan, { unallocatedFood: Math.max(0, Number(event.target.value) || 0) }))} /></label>}
    </> : (
      <div className="aa-split-panel">
        <section className="amount-section">
          <h3>参与分账成员（{members.length} 人）</h3>
          <div className="aa-member-chips">
            {members.map((name) => (
              <span className="aa-member-chip" key={name}>
                {name}
                {members.length > 1 && (
                  <button type="button" aria-label={`移除成员 ${name}`} onClick={() => removeMember(name)}>×</button>
                )}
              </span>
            ))}
          </div>
          <div className="aa-member-add">
            <input
              aria-label="添加分账成员"
              placeholder="输入同行人姓名，如：小王"
              maxLength={20}
              value={newMember}
              onChange={(event) => setNewMember(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addMember();
                }
              }}
            />
            <button type="button" className="secondary" disabled={!newMember.trim()} onClick={addMember}>添加成员</button>
            {total > 0 && (
              <button type="button" className="text-button" onClick={importFromDailyLedger}>
                从已填日账一键生成分摊项
              </button>
            )}
          </div>
        </section>

        <section className="amount-section aa-add-card">
          <h3>记一笔 AA 支出</h3>
          <div className="aa-form-grid">
            <label>
              日期
              <select aria-label="AA支出日期" value={splitDate} onChange={(event) => setSplitDate(event.target.value)}>
                <option value="">整程补充</option>
                {dates.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
            <label>
              分类
              <select aria-label="AA支出分类" value={splitCategory} onChange={(event) => setSplitCategory(event.target.value as ExpenseCategory)}>
                {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{EXPENSE_LABELS[cat]}</option>)}
              </select>
            </label>
            <label>
              支出说明
              <input aria-label="AA支出说明" placeholder="如：野生菌火锅 / 打车" value={splitTitle} onChange={(event) => setSplitTitle(event.target.value)} />
            </label>
            <label>
              金额（元）
              <span className="money-input">
                <span aria-hidden="true">¥</span>
                <input
                  aria-label="AA支出金额"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={splitAmount}
                  onChange={(event) => setSplitAmount(event.target.value)}
                />
              </span>
            </label>
            <label>
              谁付的钱（付款人）
              <select aria-label="付款人" value={activePayer} onChange={(event) => setSplitPayer(event.target.value)}>
                {members.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="aa-participants-picker">
            <span>参与分摊人：</span>
            {members.map((name) => {
              const checked = activeParticipants.includes(name);
              return (
                <label key={name} className={`aa-check-pill ${checked ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? activeParticipants.filter((p) => p !== name)
                        : [...activeParticipants, name];
                      setSplitParticipants(next.length ? next : [name]);
                    }}
                  />
                  {name}
                </label>
              );
            })}
            <button type="button" className="text-button" onClick={() => setSplitParticipants([...members])}>全选</button>
          </div>
          <div className="aa-form-footer">
            <label className="aa-sync-toggle">
              <input type="checkbox" checked={syncToDaily} onChange={(event) => setSyncToDaily(event.target.checked)} />
              同步累加到每日账单（不重复记账时可取消勾选）
            </label>
            <button type="button" className="primary" disabled={!(Number(splitAmount) > 0)} onClick={addSplitItem}>
              ＋ 记入分账
            </button>
          </div>
        </section>

        <section className="amount-section aa-settlement-box">
          <div className="aa-settlement-head">
            <h3>最少转账 AA 结算单</h3>
            {splitItems.length > 0 && (
              <button type="button" className="secondary" onClick={() => void copySettlement()}>
                复制结算单
              </button>
            )}
          </div>
          {copiedMsg && <p className="muted" role="status">{copiedMsg}</p>}
          {splitItems.length === 0 ? (
            <p className="muted">还没有 AA 分账记录。在上方记一笔，或点“从已填日账一键生成分摊项”，系统会自动按分算出最少转账方案。</p>
          ) : (
            <>
              <div className="aa-transfers-list" data-testid="aa-transfers">
                {aaSummary.transfers.length === 0 ? (
                  <p className="aa-settled-note">全部成员已结清，无需相互转账。</p>
                ) : (
                  aaSummary.transfers.map((transfer, idx) => (
                    <div className="aa-transfer-card" key={`${transfer.from}-${transfer.to}-${idx}`}>
                      <span><strong>{transfer.from}</strong> → <strong>{transfer.to}</strong></span>
                      <strong className="aa-transfer-amount">{currency(transfer.amountCents / 100)}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className="aa-balance-grid">
                {aaSummary.members.map((member) => (
                  <div className="aa-balance-card" key={member.name}>
                    <strong>{member.name}</strong>
                    <small>实付 {currency(member.paidCents / 100)} · 应付 {currency(member.owedCents / 100)}</small>
                    <span className={member.netCents > 0 ? 'is-plus' : member.netCents < 0 ? 'is-minus' : ''}>
                      {member.netCents > 0
                        ? `应收 +${currency(member.netCents / 100)}`
                        : member.netCents < 0
                          ? `应付 -${currency(-member.netCents / 100)}`
                          : '已结清'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {splitItems.length > 0 && (
          <section className="amount-section">
            <h3>分账明细（{splitItems.length} 笔 · 合计 {currency(aaSummary.totalCents / 100)}）</h3>
            <div className="aa-items-list">
              {splitItems.map((item) => (
                <article className="aa-item-row" key={item.id}>
                  <div className="aa-item-main">
                    <strong>{item.title}</strong>
                    <span className="muted">{item.date || '整程'} · {EXPENSE_LABELS[item.category]}</span>
                    <strong className="aa-item-amount">{currency(item.amountCents / 100)}</strong>
                  </div>
                  <div className="aa-item-controls">
                    <label>
                      付款人
                      <select
                        aria-label={`${item.title} 付款人`}
                        value={item.payer}
                        onChange={(event) => updateSplitRecord(item.id, { payer: event.target.value })}
                      >
                        {members.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <div className="aa-item-parts">
                      {members.map((name) => {
                        const checked = item.participants.includes(name);
                        return (
                          <label key={name} className={`aa-check-pill small ${checked ? 'active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? item.participants.filter((p) => p !== name)
                                  : [...item.participants, name];
                                if (next.length) updateSplitRecord(item.id, { participants: next });
                              }}
                            />
                            {name}
                          </label>
                        );
                      })}
                    </div>
                    <button type="button" className="text-button" onClick={() => removeSplitRecord(item.id)}>删除</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    )}

    <p className="ledger-total" aria-live="polite">整程合计 <strong data-testid="trip-total">{currency(total)}</strong></p>
    {plan.manualActualTotal != null && <p className="muted">旧账本另有手填总额 {currency(plan.manualActualTotal)}；填写任一明细后将自动按明细合计。</p>}
  </div>;
}
