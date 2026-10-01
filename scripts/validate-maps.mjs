import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Validate every bundled province, not only the Shanxi smoke-test example. */
const mapDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maps');
const loadMap = async (name) => JSON.parse(await readFile(path.join(mapDirectory, name), 'utf8'));
const national = await loadMap('china.json');
assert.equal(national.features.length, 34);
const files = (await readdir(mapDirectory)).filter((name) => /^\d{6}\.json$/.test(name));
assert.equal(files.length, 34);
let regionCount = 0;
for (const province of national.features) {
  const code = String(province.properties.adcode);
  const fileName = `${code}.json`;
  assert.ok(files.includes(fileName), `${province.properties.name} is missing its city map`);
  const childMap = await loadMap(fileName);
  assert.ok(childMap.features.length > 0, `${fileName} is empty`);
  const ids = childMap.features.map((feature) => String(feature.properties.adcode));
  assert.equal(new Set(ids).size, ids.length, `${fileName} repeats a region code`);
  assert.ok(ids.every((id) => /^\d{6}$/.test(id)), `${fileName} has an invalid region code`);
  regionCount += ids.length;
}
process.stdout.write(`Validated all 34 province maps and ${regionCount} selectable city/direct-admin regions.\n`);
