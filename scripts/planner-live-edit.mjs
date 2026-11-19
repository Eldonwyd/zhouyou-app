import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPlannerService } from '../server/planner-service.mjs';
import { readServerKey } from '../server/index.mjs';

/** Verify an actual narrowly scoped edit against the saved live sample.
 * Keep Unicode text in a UTF-8 file rather than a Windows shell pipe.
 */
const content = JSON.parse(await readFile('.openai/planner-live-result.json', 'utf8'));
const target = content.days[0].activities.find((activity) => activity.kind === 'sight');
const service = createPlannerService({ apiKey: await readServerKey() });
const result = await service.chat(
  {
    plan: { id: 'live-test', version: 1, content, messages: [] },
    baseVersion: 1,
    scopeId: target.id,
    mode: 'edit',
    message: '请仅把这个景点活动改成原地休息，保留原时间，不增加费用，其余行程不变。',
  },
  AbortSignal.timeout(240000),
  (stage) => process.stdout.write(`${stage}\n`),
);
const changed = result.content.days[0].activities.find((activity) => activity.id === target.id);
assert.equal(changed.kind, 'rest');
assert.equal(changed.startTime, target.startTime);
assert.equal(changed.endTime, target.endTime);
assert.equal(changed.costs.length, 0);
assert.deepEqual(result.content.days.slice(1), content.days.slice(1));
await writeFile('.openai/planner-live-edit.json', JSON.stringify(result, null, 2));
process.stdout.write('Live scoped edit: target changed to rest; later days unchanged. OK\n');
