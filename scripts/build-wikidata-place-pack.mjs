import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createSupplementalPlaceLookup } from '../server/supplemental-places.mjs';

/** 缓存本次行程已核验的CC0实体；只保存唯一、实际来源可追溯的坐标。 */
const lookup = createSupplementalPlaceLookup({ localRecords: [] });
const target = new URL('../data/places/yunnan-wikidata.json', import.meta.url);
const records = await readFile(target, 'utf8').then((text) => JSON.parse(text).records).catch(() => []);
for (const [city, name, aliases] of [
  ['大理市', '大理站', []], ['丽江市', '丽江站', []], ['香格里拉市', '独克宗古城', ['独克宗']],
]) {
  if (records.some((record) => record.city === city && record.name === name)) continue;
  try {
  const candidates = await lookup.wikidata({ city }, [name, ...aliases], new AbortController().signal);
  const unique = [...new Map(candidates.map((item) => [`${item.longitude},${item.latitude}`, item])).values()];
  if (unique.length === 1) records.push({ name, aliases, city, ...unique[0], coordinateSystem: 'WGS84', checkedAt: new Date().toISOString() });
  console.log(JSON.stringify({ name, found: unique.length === 1 }));
  } catch (error) { console.log(JSON.stringify({ name, error: error.message })); }
}
await mkdir(new URL('../data/places/', import.meta.url), { recursive: true });
await writeFile(target, JSON.stringify({ license: 'CC0-1.0', records }, null, 2));
console.log(JSON.stringify({ saved: records.length }));
