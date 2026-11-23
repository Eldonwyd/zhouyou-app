import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultMapsDir = fileURLToPath(new URL('../public/maps/', import.meta.url));

const normalizeCityKey = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s·・()（）]/g, '')
  .replace(/(?:特别行政区)$/, '')
  .replace(/(?:壮族|维吾尔|回族|藏族|蒙古族|朝鲜族|满族|彝族|白族|傣族|景颇族|傈僳族|哈尼族|苗族|瑶族|侗族|布依族|土家族|羌族|水族|仡佬族|拉祜族|佤族|纳西族|柯尔克孜|哈萨克|蒙古|回|藏)+自治(?:州|区|县)$/, '')
  .replace(/(?:自治州|自治区|地区|盟|林区|省|市)$/, '');

// 常见县级/景区级热门目的地映射到所属地级市或州，用于获取准确的地理范围框（bbox）。
const TOURIST_COUNTY_TO_PREFECTURE = {
  香格里拉: '迪庆',
  阳朔: '桂林',
  龙胜: '桂林',
  九寨沟: '阿坝',
  松潘: '阿坝',
  理县: '阿坝',
  稻城: '甘孜',
  亚丁: '甘孜',
  康定: '甘孜',
  色达: '甘孜',
  理塘: '甘孜',
  都江堰: '成都',
  青城山: '成都',
  峨眉山: '乐山',
  阆中: '南充',
  平遥: '晋中',
  五台山: '忻州',
  乌镇: '嘉兴',
  西塘: '嘉兴',
  桐乡: '嘉兴',
  千岛湖: '杭州',
  淳安: '杭州',
  普陀山: '舟山',
  莫干山: '湖州',
  安吉: '湖州',
  横店: '金华',
  义乌: '金华',
  宏村: '黄山',
  西递: '黄山',
  婺源: '上饶',
  三清山: '上饶',
  庐山: '九江',
  景德镇: '景德镇',
  凤凰: '湘西',
  芙蓉镇: '湘西',
  张家界: '张家界',
  武陵源: '张家界',
  敦煌: '酒泉',
  嘉峪关: '嘉峪关',
  张掖: '张掖',
  腾冲: '保山',
  瑞丽: '德宏',
  芒市: '德宏',
  景洪: '西双版纳',
  建水: '红河',
  弥勒: '红河',
  元阳: '红河',
  普者黑: '文山',
  泸沽湖: '丽江',
  喀纳斯: '阿勒泰',
  禾木: '阿勒泰',
  布尔津: '阿勒泰',
  赛里木湖: '博尔塔拉',
  伊宁: '伊犁',
  那拉提: '伊犁',
  喀什: '喀什',
  吐鲁番: '吐鲁番',
  库车: '阿克苏',
  茶卡: '海西',
  格尔木: '海西',
  青海湖: '海南',
  延吉: '延边',
  长白山: '白山',
  漠河: '大兴安岭',
  满洲里: '呼伦贝尔',
  海拉尔: '呼伦贝尔',
  额尔古纳: '呼伦贝尔',
  阿尔山: '兴安',
  武夷山: '南平',
  平潭: '福州',
  鼓浪屿: '厦门',
  霞浦: '宁德',
  南澳: '汕头',
  开平: '江门',
  顺德: '佛山',
  万宁: '万宁',
  陵水: '陵水',
  文昌: '文昌',
  琼海: '琼海',
  北海: '北海',
  涠洲岛: '北海',
  崇左: '崇左',
  德天: '崇左',
  曲阜: '济宁',
  泰安: '泰安',
  蓬莱: '烟台',
  长岛: '烟台',
  荣成: '威海',
  周庄: '苏州',
  同里: '苏州',
  昆山: '苏州',
  宜兴: '无锡',
  扬州: '扬州',
  台北: '台湾',
  台中: '台湾',
  台南: '台湾',
  高雄: '台湾',
  花莲: '台湾',
  垦丁: '台湾',
  九份: '台湾',
};

function computeFeatureBounds(feature) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visitRing = (ring) => {
    for (const point of ring) {
      const lon = Number(point[0]), lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates ?? []) visitRing(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates ?? []) {
      for (const ring of polygon ?? []) visitRing(ring);
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return {
    minLon,
    minLat,
    maxLon,
    maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
}

let cachedIndexPromise = null;

/** 懒加载本地中国行政区划边界，为全国 34 省 370+ 城市/区县提供毫秒级 bbox 与坐标归属校验。 */
export function loadChinaCityBoundsIndex(mapsDir = defaultMapsDir) {
  if (mapsDir === defaultMapsDir && cachedIndexPromise) return cachedIndexPromise;
  const promise = (async () => {
    const byCode = new Map();
    const byName = new Map();
    const files = (await readdir(mapsDir).catch(() => [])).filter((name) => name.endsWith('.json'));
    // 先加载 china.json（包含四大直辖市、港澳台整体范围），再加载各省地级市。
    const ordered = [
      ...files.filter((name) => name === 'china.json'),
      ...files.filter((name) => name !== 'china.json').sort(),
    ];
    for (const file of ordered) {
      let data;
      try {
        data = JSON.parse(await readFile(path.join(mapsDir, file), 'utf8'));
      } catch {
        continue;
      }
      const isNational = file === 'china.json';
      for (const feature of data.features ?? []) {
        const adcode = String(feature.properties?.adcode ?? '');
        const name = String(feature.properties?.name ?? '');
        if (!adcode || !name) continue;
        const bounds = computeFeatureBounds(feature);
        if (!bounds) continue;
        const entry = { adcode, name, isNational, ...bounds };
        if (!byCode.has(adcode)) byCode.set(adcode, entry);
        const key = normalizeCityKey(name);
        // 避免直辖市下属区县覆盖同名城市；优先保留非省级或直辖市主条目。
        const isDirectCity = /^(11|12|31|50|71|81|82)0000$/.test(adcode);
        if (!byName.has(key) || (!isNational && byName.get(key).isNational && !isDirectCity)) {
          byName.set(key, entry);
        }
      }
    }
    return { byCode, byName };
  })();
  if (mapsDir === defaultMapsDir) cachedIndexPromise = promise;
  return promise;
}

/** 查找目标城市的地理范围（含适度外扩边距，兼容郊区机场、跨界景区和坐标近似偏差）。 */
export async function lookupCityBounds(city, cityCode = '', mapsDir = defaultMapsDir) {
  const index = await loadChinaCityBoundsIndex(mapsDir);
  const code = String(cityCode || '').trim();
  let match = null;
  if (/^\d{6}$/.test(code)) {
    match = index.byCode.get(code)
      ?? index.byCode.get(`${code.slice(0, 4)}00`)
      ?? index.byCode.get(`${code.slice(0, 2)}0000`)
      ?? null;
  }
  if (!match && city) {
    const key = normalizeCityKey(city);
    if (key) {
      match = index.byName.get(key) ?? null;
      if (!match) {
        const mapped = TOURIST_COUNTY_TO_PREFECTURE[key];
        if (mapped) match = index.byName.get(normalizeCityKey(mapped)) ?? null;
      }
      if (!match && key.length >= 2) {
        for (const [candidateKey, entry] of index.byName.entries()) {
          if (candidateKey.startsWith(key) || key.startsWith(candidateKey)) {
            match = entry;
            break;
          }
        }
      }
    }
  }
  if (!match) return null;
  // 外扩 0.12°（约 12km）以容纳郊区机场、高铁站、边界景区与 GCJ/WGS 误差。
  const pad = 0.12;
  const minLon = Math.max(72.0, match.minLon - pad);
  const maxLon = Math.min(136.0, match.maxLon + pad);
  const minLat = Math.max(3.0, match.minLat - pad);
  const maxLat = Math.min(54.0, match.maxLat + pad);
  return {
    ...match,
    padded: { minLon, minLat, maxLon, maxLat },
    contains(longitude, latitude) {
      return Number.isFinite(longitude) && Number.isFinite(latitude)
        && longitude >= minLon && longitude <= maxLon
        && latitude >= minLat && latitude <= maxLat;
    },
  };
}
