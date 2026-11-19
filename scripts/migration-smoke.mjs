import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

/** Exercise the real v1 database upgrade and the old ZIP import format. */
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const origin = 'http://127.0.0.1:5173';
const date = '2025-07-08';
const mark = { id: '140100', name: '太原市', provinceCode: '140000', visited: true, planned: false, updatedAt: `${date}T12:00:00.000Z` };
const entry = { id: 'old-entry', cityCode: '140100', date, period: 'afternoon', note: '从旧版带来的文字', place: '晋祠', order: 1, highlight: true };
const media = { id: 'old-photo', cityCode: '140100', entryId: entry.id, kind: 'photo', fileName: 'old.png', mimeType: 'image/png', capturedAt: `${date}T12:00:00.000Z`, placeName: '太原市', latitude: null, longitude: null };
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dZkAAAAASUVORK5CYII=', 'base64');

try {
  // A synthetic blank document uses the same origin without starting React.
  await page.route('**/seed', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
  await page.goto(`${origin}/seed`);
  await page.evaluate(async ({ mark, entry, media, bytes }) => {
    const request = indexedDB.open('travel-footprints', 1);
    await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        for (const name of ['marks', 'entries', 'plans', 'media', 'badges', 'profile']) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const db = request.result;
    const tx = db.transaction(['marks', 'entries', 'media'], 'readwrite');
    tx.objectStore('marks').put(mark);
    tx.objectStore('entries').put(entry);
    tx.objectStore('media').put({ ...media, blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }) });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, { mark, entry, media, bytes: [...pixel] });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const upgraded = await page.evaluate(async () => {
    const request = indexedDB.open('travel-footprints');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['trips', 'places', 'entries', 'media', 'mediaFiles'], 'readonly');
    const get = (name) => new Promise((resolve) => { const item = tx.objectStore(name).getAll(); item.onsuccess = () => resolve(item.result); });
    const [trips, places, entries, media, files] = await Promise.all(['trips', 'places', 'entries', 'media', 'mediaFiles'].map(get));
    return { trips, places, entries, media, fileSize: files[0]?.blob.size };
  });
  assert.equal(upgraded.trips.length, 1);
  assert.equal(upgraded.places[0].name, '晋祠');
  assert.equal(upgraded.places[0].reviewText, '从旧版带来的文字');
  assert.equal(upgraded.entries[0].tripId, upgraded.trips[0].id);
  assert.equal(upgraded.media[0].blob, undefined);
  assert.equal(upgraded.fileSize, pixel.length);

  const writer = new ZipWriter(new BlobWriter('application/zip'));
  const manifest = { format: 'travel-footprints-backup', version: 1, exportedAt: new Date().toISOString(),
    data: { marks: [mark], entries: [entry], plans: [], media: [media], badges: [], profile: [] } };
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
  await writer.add(`media/${media.id}`, new BlobReader(new Blob([pixel], { type: 'image/png' })));
  const archive = Buffer.from(await (await writer.close()).arrayBuffer());
  await page.getByRole('button', { name: '个人中心' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({ name: 'legacy.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByText('备份已导入，旅行记录和媒体已恢复。').waitFor();
  await page.getByRole('button', { name: '旅行手账' }).click();
  await page.getByRole('heading', { name: '太原市 · 2025-07-08' }).waitFor();
  process.stdout.write('IndexedDB v1 upgrade and ZIP v1 import: OK\n');
} finally {
  await browser.close();
}
