import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPlannerService } from '../server/planner-service.mjs';
import { readServerKey } from '../server/index.mjs';

/** Opt-in model check for the actual advice -> explicit apply transition. */
const content = JSON.parse(await readFile('.openai/planner-live-result.json', 'utf8'));
const target = content.days[0].activities.find((item) => item.kind === 'sight');
const locked = content.days[1].activities.find((item) => item.kind === 'sight');
locked.locked = true;
const original = structuredClone(content);
const plan = { id: 'conversation-live', version: 1, contentVersion: 1, content, messages: [] };
const service = createPlannerService({ apiKey: await readServerKey() });
const signal = AbortSignal.timeout(240000);
const progress = (stage) => process.stdout.write(`${stage}\n`);
const answer = await service.chat(
  {
    plan,
    baseVersion: 1,
    scopeId: target.id,
    mode: 'auto',
    message: '如果把这个活动换成休息怎么样？先分析利弊，不要直接修改。',
  },
  signal,
  progress,
);
assert.equal(answer.action, 'answer');
assert.equal(answer.content, undefined);
await writeFile('.openai/planner-conversation-advice.json', JSON.stringify(answer, null, 2));
assert.ok(answer.suggestion?.instruction);
assert.deepEqual(plan.content, original);
const withSuggestion = {
  ...plan,
  version: 2,
  messages: [
    {
      id: 'live-advice',
      role: 'assistant',
      text: answer.answer,
      createdAt: new Date().toISOString(),
      suggestion: answer.suggestion,
    },
  ],
};
const result = await service.chat(
  {
    plan: withSuggestion,
    baseVersion: 2,
    mode: 'apply-suggestion',
    message: '应用这条建议',
    applySuggestionMessageId: 'live-advice',
  },
  signal,
  progress,
);
await writeFile(
  '.openai/planner-conversation-live.json',
  JSON.stringify({ answer, result }, null, 2),
);
assert.equal(result.action, 'revision');
assert.equal(result.content.days[0].activities.find((item) => item.id === target.id).kind, 'rest');
assert.deepEqual(
  result.content.days[1].activities.find((item) => item.id === locked.id),
  locked,
);
await writeFile(
  '.openai/planner-conversation-live.json',
  JSON.stringify({ answer, result }, null, 2),
);
console.log(
  'Live conversation: hypothetical stays read-only, explicit apply changes target, locked activity preserved. OK',
);
