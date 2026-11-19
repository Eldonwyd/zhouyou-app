import { mkdir, writeFile } from 'node:fs/promises';
import { createPlannerMapService } from '../server/planner-map-service.mjs';

/** 公开地点小样本验证；不读取AI Key、不消耗AI额度，结果保留来源供复核。 */
const samples = [
  ['昆明市', '滇池国家旅游度假区海埂大坝'],
  ['昆明市', '翠湖—南屏街片区'],
  ['大理白族自治州', '大理站'],
  ['丽江市', '丽江站'],
  ['香格里拉市', '独克宗古城'],
  ['昆明市', '官渡区官渡古镇'],
  ['大理白族自治州', '大理古城'],
  ['昆明市', '云南大学呈贡校区'],
];
const locate = createPlannerMapService();
const results = [];
for (const [city, name] of samples) {
  const result = await locate({ places: [{ key: JSON.stringify([city, name]), city, name }] }, new AbortController().signal);
  const position = result.positions[0];
  results.push({ city, name, ...position });
  console.log(JSON.stringify({ city, name, ...position }));
}
await mkdir('.openai', { recursive: true });
await writeFile('.openai/place-source-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ located: results.filter((result) => result.status === 'located').length, total: results.length }));
