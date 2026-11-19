import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readServerKey } from '../server/index.mjs';
import { createPlannerService } from '../server/planner-service.mjs';
import { freshPlannerRequest, calculatePlannerBudget } from '../src/planner-domain.ts';

/** Opt-in live integration: no credential or full provider response is logged. */
await mkdir('.openai', { recursive: true });
const service = createPlannerService({
  apiKey: await readServerKey(),
  onInvalidContent: async (content, error) => {
    await writeFile('.openai/planner-invalid.json', JSON.stringify({ error, content }, null, 2));
  },
});
const request = {
  ...freshPlannerRequest('丽江、香格里拉'),
  days: 3,
  travelersText: '三个人，其中一名学生',
  startDate: '2026-11-20',
  skipBreakfast: true,
  foodMode: true,
  notes:
    '前两天丽江，第三天香格里拉。我们想慢慢玩，不用安排到丽江之前和离开香格里拉之后的交通。门票、住宿和特色吃饭请合理估算。',
};
try {
  const result = await service.generate({ request }, AbortSignal.timeout(300000), (stage) =>
    process.stdout.write(`${stage}\n`),
  );
  assert.equal(result.content.request.people, 3, 'free party description parsed by AI');
  assert.equal(result.content.request.students, 1);
  assert.equal(result.content.request.travelersText, request.travelersText);
  assert.ok(!('startTime' in result.content.request) && !('returnTo' in result.content.request));
  await mkdir('.openai', { recursive: true });
  await writeFile('.openai/planner-live-result.json', JSON.stringify(result.content, null, 2));
  process.stdout.write(
    `Live integration OK: ${result.content.days.length} days, ${result.content.sources.length} sources, ${result.content.days.flatMap((day) => day.activities).length} activities, budget ${calculatePlannerBudget(result.content).totalCents} cents\n`,
  );
} catch (error) {
  process.stderr.write(`Live integration failed: ${error.message}\n`);
  process.exitCode = 1;
}
