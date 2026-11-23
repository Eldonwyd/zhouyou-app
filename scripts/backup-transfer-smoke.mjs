import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, devices } from 'playwright-core';
import sharp from 'sharp';
import { aiPlanFixture } from './planner-fixture.mjs';

const origin = 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

try {
  // 分开两套浏览器存储，确保电脑只能从下载的 ZIP 获得手机数据。
  const phone = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const desktop = await browser.newContext({ serviceWorkers: 'block' });
  const phonePage = await phone.newPage();
  const desktopPage = await desktop.newPage();
  await desktop.addInitScript(() => {
    // 局域网 HTTP 环境可能缺少 SubtleCrypto，规划照片仍需验证内容。
    Object.defineProperty(crypto, 'subtle', { value: undefined });
  });
  await Promise.all([phonePage.goto(origin), desktopPage.goto(origin)]);

  const plan = aiPlanFixture();
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#278872' } }).webp().toBuffer();
  const photoId = createHash('sha256').update(bytes).digest('hex');
  plan.content.days[0].activities[0].photo = {
    url: 'https://example.org/photo.webp', sourceUrl: 'https://example.org/place', attribution: '测试配图', assetId: photoId,
  };
  await phonePage.evaluate(async ({ plan, photoId, bytes }) => {
    const db = await import('/src/db.ts');
    await db.savePlannerPhotoBlob(photoId, new Blob([new Uint8Array(bytes)], { type: 'image/webp' }));
    await db.saveAiPlan(plan, null);
    await db.saveItem('profile', { id: 'profile', nickname: '手机旅人' });
    const cityCode = '530700';
    const date = '2026-12-01';
    const createdAt = `${date}T12:00:00.000Z`;
    await db.saveItem('trips', { id: 'phone-trip', title: '手机上的丽江之旅', startDate: date, endDate: date,
      cities: [{ code: cityCode, name: '丽江市', provinceCode: '530000' }], companions: [], createdAt });
    await db.saveItem('places', { id: 'phone-place', tripId: 'phone-trip', cityCode, name: '丽江古城',
      reviewText: '在古城散步', reviewAudioId: null, createdAt });
    await db.saveItem('entries', { id: 'phone-entry', tripId: 'phone-trip', placeId: 'phone-place', cityCode,
      date, period: 'afternoon', note: '手机手账原文', place: '丽江古城', order: 1, highlight: false });
    const budget = { transport: 0, lodging: 0, tickets: 0, food: 100, other: 0 };
    await db.saveItem('plans', { id: 'phone-trip', tripId: 'phone-trip', cityCode, startDate: date, endDate: date,
      people: 1, budget, actual: { ...budget, food: 36 }, manualActualTotal: null, reminderDays: 1 });
    await db.saveMediaBatch([{
      media: { id: 'phone-photo', tripId: 'phone-trip', placeId: 'phone-place', entryId: 'phone-entry', cityCode,
        kind: 'photo', fileName: '古城.webp', mimeType: 'image/webp', capturedAt: createdAt,
        placeName: '丽江古城', latitude: null, longitude: null },
      blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
    }]);
  }, { plan, photoId, bytes: [...bytes] });
  const savedOnPhone = await phonePage.evaluate(async () => (await import('/src/db.ts')).loadSnapshot());

  await desktopPage.evaluate(async () => {
    const db = await import('/src/db.ts');
    await db.saveItem('profile', { id: 'profile', nickname: '电脑原有旅人' });
    await db.saveItem('marks', { id: '110100', name: '北京市', provinceCode: '110000', visited: true,
      planned: false, updatedAt: '2026-11-01T12:00:00.000Z' });
  });
  await desktopPage.reload();
  await phonePage.getByRole('button', { name: '个人中心', exact: true }).click();
  await phonePage.getByRole('button', { name: '数据导出与导入', exact: true }).click();
  assert.equal(await phonePage.locator('#travel-data-backup').evaluate((element) => element === document.activeElement), true);
  const download = phonePage.waitForEvent('download');
  await phonePage.getByRole('button', { name: '导出完整备份' }).click();
  const archive = await (await download).path();
  assert.ok(archive);

  await desktopPage.getByRole('button', { name: '个人中心', exact: true }).click();
  const input = desktopPage.locator('input[type="file"][accept^=".zip"]');
  const readSnapshot = () => desktopPage.evaluate(async () => (await import('/src/db.ts')).loadSnapshot());
  await input.setInputFiles({ name: '损坏的备份.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid ZIP') });
  await desktopPage.getByText('操作未完成', { exact: false }).waitFor();
  assert.equal((await readSnapshot()).marks[0].id, '110100');

  // 拒绝确认后仍可选择同一份 ZIP，直到明确接受才覆盖电脑数据。
  const rejected = desktopPage.waitForEvent('dialog');
  await input.setInputFiles(archive);
  const confirm = await rejected;
  assert.match(confirm.message(), /1 篇手账.*1 份 AI 计划/);
  await confirm.dismiss();
  await desktopPage.getByRole('button', { name: '导入备份', exact: true }).waitFor();
  assert.equal((await readSnapshot()).profile[0].nickname, '电脑原有旅人');

  desktopPage.once('dialog', (dialog) => void dialog.accept());
  await input.setInputFiles(archive);
  await desktopPage.getByText('备份已导入，旅行记录和媒体已恢复。').waitFor();
  await desktopPage.reload();
  const restored = await readSnapshot();
  assert.deepEqual(restored.marks, []);
  assert.equal(restored.profile[0].nickname, '手机旅人');
  assert.equal(restored.entries[0].note, '手机手账原文');
  assert.equal(restored.places[0].tripId, restored.trips[0].id);
  assert.deepEqual(restored, savedOnPhone);
  const photoSizes = await desktopPage.evaluate(async (id) => {
    const db = await import('/src/db.ts');
    return [(await db.getPlannerPhotoBlob(id))?.size, (await db.getMediaBlob('phone-photo')).size];
  }, photoId);
  assert.deepEqual(photoSizes, [bytes.length, bytes.length]);
  process.stdout.write('手机 ZIP 导出、取消覆盖、损坏 ZIP 保留数据、电脑覆盖和照片恢复通过。\n');
} finally {
  await browser.close();
}
