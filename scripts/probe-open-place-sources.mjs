/** 小样本探测开放数据的真实可用性；只输出公开地点资料，不读取用户配置或密钥。 */
const headers = { 'User-Agent': 'TravelFootprints/1.0 (open geographic data evaluation)' };
import { createSupplementalPlaceLookup } from '../server/supplemental-places.mjs';
for (const [label, address] of [
  ['Overture目录', 'https://stac.overturemaps.org/catalog.json'],
  ['Wikidata大理站', `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: '大理站', language: 'zh', format: 'json', limit: '5' })}`],
  ['Wikidata独克宗', `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: '独克宗', language: 'zh', format: 'json', limit: '5' })}`],
]) {
  try {
    const response = await fetch(address, { headers, signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    console.log(JSON.stringify({ label, status: response.status, data: label.startsWith('Overture') ? { latest: data.latest, links: data.links?.slice(0, 4) } : data }));
  } catch (error) { console.log(JSON.stringify({ label, error: error.message })); }
}
try {
  const items = await createSupplementalPlaceLookup({ localRecords: [] }).wikidata(
    { city: '大理白族自治州' }, ['大理站'], new AbortController().signal);
  console.log(JSON.stringify({ label: 'Wikidata大理站坐标及行政区核对', items }));
} catch (error) { console.log(JSON.stringify({ label: 'Wikidata坐标', error: error.message })); }
