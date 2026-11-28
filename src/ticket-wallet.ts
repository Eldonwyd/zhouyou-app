export type TicketKind = 'train' | 'flight' | 'toll' | 'bus' | 'ferry' | 'ticket';

export interface TravelTicket {
  id: string;
  kind: TicketKind;
  tripId: string | null;
  tripLabel: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  arriveTime: string;
  fromPlace: string;
  toPlace: string;
  code: string; // 车次 / 航班号 / 高速编号 / 场馆
  seatOrGate: string; // 座位 / 检票口 / 舱位 / 车型ETC
  price: number;
  passenger: string; // 乘客 / 车牌号
  note: string;
  createdAt: string;
}

export interface TicketKindMeta {
  kind: TicketKind;
  label: string;
  shortLabel: string;
  icon: string;
  fromPlaceholder: string;
  toPlaceholder: string;
  codeLabel: string;
  codePlaceholder: string;
  seatLabel: string;
  seatPlaceholder: string;
  passengerLabel: string;
  passengerPlaceholder: string;
  routeColor: string;
}

export const TICKET_KIND_META: Record<TicketKind, TicketKindMeta> = {
  train: {
    kind: 'train',
    label: '高铁 / 火车票',
    shortLabel: '铁路',
    icon: '🚄',
    fromPlaceholder: '例如：北京南站',
    toPlaceholder: '例如：天津站',
    codeLabel: '车次',
    codePlaceholder: '如 C2015 / G128',
    seatLabel: '席别 / 座位 / 检票口',
    seatPlaceholder: '如 03车06F · 二等座 · 检票口5B',
    passengerLabel: '乘车人（可选）',
    passengerPlaceholder: '如 王小明',
    routeColor: '#2d7dd2',
  },
  flight: {
    kind: 'flight',
    label: '飞机票 / 登机牌',
    shortLabel: '航空',
    icon: '✈️',
    fromPlaceholder: '例如：北京首都 T3',
    toPlaceholder: '例如：上海虹桥 T2',
    codeLabel: '航班号',
    codePlaceholder: '如 CA1501 / MU5102',
    seatLabel: '舱位 / 座位 / 登机口',
    seatPlaceholder: '如 经济舱 · 18A · 登机口 C12',
    passengerLabel: '登机人（可选）',
    passengerPlaceholder: '如 WANG / XIAOMING',
    routeColor: '#0284c7',
  },
  toll: {
    kind: 'toll',
    label: '高速过路费',
    shortLabel: '高速',
    icon: '🛣️',
    fromPlaceholder: '例如：京沪高速北京站',
    toPlaceholder: '例如：天津西青收费站',
    codeLabel: '高速 / 路段',
    codePlaceholder: '如 G2 京沪高速 / ETC通道',
    seatLabel: '车型 / 通道',
    seatPlaceholder: '如 一型客车 · ETC扣费',
    passengerLabel: '车牌号（可选）',
    passengerPlaceholder: '如 京A·88888',
    routeColor: '#d97706',
  },
  bus: {
    kind: 'bus',
    label: '大巴 / 城际车票',
    shortLabel: '客运',
    icon: '🚌',
    fromPlaceholder: '例如：丽江客运站',
    toPlaceholder: '例如：香格里拉客运站',
    codeLabel: '班次 / 线路',
    codePlaceholder: '如 城际快线 08:30',
    seatLabel: '座位 / 检票口',
    seatPlaceholder: '如 12座 · 2号检票口',
    passengerLabel: '乘车人（可选）',
    passengerPlaceholder: '如 王小明',
    routeColor: '#16a34a',
  },
  ferry: {
    kind: 'ferry',
    label: '轮渡 / 船票',
    shortLabel: '航运',
    icon: '⛴️',
    fromPlaceholder: '例如：厦门邮轮中心',
    toPlaceholder: '例如：鼓浪屿三丘田码头',
    codeLabel: '航次 / 船名',
    codePlaceholder: '如 屿见号 10:10',
    seatLabel: '舱位 / 登船口',
    seatPlaceholder: '如 普通舱 · 3号登船口',
    passengerLabel: '乘客（可选）',
    passengerPlaceholder: '如 王小明',
    routeColor: '#0d9488',
  },
  ticket: {
    kind: 'ticket',
    label: '景点 / 活动票根',
    shortLabel: '票根',
    icon: '🎟️',
    fromPlaceholder: '所在城市（如：天津）',
    toPlaceholder: '景点 / 场馆名（如：天津之眼）',
    codeLabel: '票种 / 场次',
    codePlaceholder: '如 成人夜场票 / 19:30场',
    seatLabel: '区域 / 座位 / 入口',
    seatPlaceholder: '如 南门检票 · 8号轿厢',
    passengerLabel: '持票人（可选）',
    passengerPlaceholder: '如 王小明',
    routeColor: '#c026d3',
  },
};

export const TICKET_KINDS: TicketKind[] = ['train', 'flight', 'toll', 'bus', 'ferry', 'ticket'];

const STORAGE_KEY = 'zhouyou-ticket-wallet-v1';

export function loadTicketsFromStorage(): TravelTicket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is TravelTicket => Boolean(item && typeof item.id === 'string'))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  } catch {
    return [];
  }
}

export function saveTicketsToStorage(tickets: TravelTicket[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  } catch {
    /* ignore storage quota error */
  }
}

/** 中国主要城市及热门旅行城市坐标库 [lng, lat] */
const CITY_COORDS: Record<string, [number, number]> = {
  北京: [116.4074, 39.9042],
  天津: [117.2009, 39.0842],
  上海: [121.4737, 31.2304],
  重庆: [106.5516, 29.563],
  石家庄: [114.5149, 38.0428],
  唐山: [118.1802, 39.6309],
  秦皇岛: [119.5996, 39.9354],
  邯郸: [114.5391, 36.6256],
  保定: [115.4648, 38.8739],
  张家口: [114.8875, 40.8244],
  承德: [117.9634, 40.9515],
  沧州: [116.8388, 38.3044],
  廊坊: [116.6838, 39.538],
  太原: [112.5489, 37.8706],
  大同: [113.3001, 40.0768],
  平遥: [112.1758, 37.1892],
  呼和浩特: [111.7492, 40.8426],
  包头: [109.8404, 40.6574],
  呼伦贝尔: [119.7657, 49.2116],
  沈阳: [123.4315, 41.8057],
  大连: [121.6147, 38.914],
  丹东: [124.3547, 40.0005],
  长春: [125.3235, 43.8171],
  吉林: [126.5496, 43.8379],
  延吉: [129.5089, 42.8913],
  长白山: [128.0558, 42.0056],
  哈尔滨: [126.535, 45.8038],
  漠河: [122.5362, 52.972],
  南京: [118.7969, 32.0603],
  无锡: [120.3119, 31.4912],
  徐州: [117.2841, 34.2058],
  常州: [119.9741, 31.8112],
  苏州: [120.5853, 31.299],
  南通: [120.8943, 31.9802],
  连云港: [119.2216, 34.5967],
  扬州: [119.4129, 32.3942],
  镇江: [119.4258, 32.1878],
  杭州: [120.1551, 30.2741],
  宁波: [121.544, 29.8683],
  温州: [120.6994, 27.9943],
  嘉兴: [120.7555, 30.7461],
  湖州: [120.0868, 30.8943],
  绍兴: [120.5802, 30.0298],
  金华: [119.6474, 29.0791],
  舟山: [122.2072, 29.9853],
  台州: [121.4208, 28.6564],
  合肥: [117.2272, 31.8206],
  芜湖: [118.4329, 31.3529],
  黄山: [118.3375, 29.7147],
  福州: [119.2965, 26.0745],
  厦门: [118.0894, 24.4798],
  泉州: [118.6757, 24.8741],
  漳州: [117.6471, 24.513],
  武夷山: [118.0353, 27.7566],
  南昌: [115.8582, 28.6829],
  景德镇: [117.1784, 29.2688],
  九江: [115.9928, 29.712],
  赣州: [114.9336, 25.8318],
  上饶: [117.9434, 28.4549],
  婺源: [117.8617, 29.2484],
  济南: [117.1201, 36.6512],
  青岛: [120.3826, 36.0671],
  淄博: [118.0549, 36.8135],
  烟台: [121.4479, 37.4638],
  潍坊: [119.1618, 36.7067],
  泰安: [117.0876, 36.2003],
  威海: [122.1204, 37.5131],
  日照: [119.5269, 35.4164],
  临沂: [118.3564, 35.1047],
  曲阜: [116.9862, 35.5809],
  郑州: [113.6254, 34.7466],
  开封: [114.3076, 34.7973],
  洛阳: [112.454, 34.6197],
  安阳: [114.3928, 36.0976],
  武汉: [114.3054, 30.5931],
  宜昌: [111.2865, 30.6919],
  襄阳: [112.1224, 32.009],
  恩施: [109.4869, 30.2722],
  长沙: [112.9388, 28.2282],
  岳阳: [113.1289, 29.3571],
  张家界: [110.4792, 29.1171],
  衡阳: [112.572, 26.8938],
  凤凰: [109.5993, 27.9483],
  广州: [113.2644, 23.1291],
  深圳: [114.0579, 22.5431],
  珠海: [113.5767, 22.2707],
  汕头: [116.6819, 23.3541],
  佛山: [113.1214, 23.0215],
  惠州: [114.4162, 23.1118],
  东莞: [113.7518, 23.0207],
  中山: [113.3928, 22.5176],
  潮州: [116.6226, 23.657],
  湛江: [110.3594, 21.2707],
  南宁: [108.3665, 22.817],
  柳州: [109.4159, 24.3255],
  桂林: [110.2902, 25.2736],
  北海: [109.1199, 21.4813],
  阳朔: [110.4966, 24.7784],
  海口: [110.1999, 20.044],
  三亚: [109.5119, 18.2528],
  成都: [104.0668, 30.5728],
  绵阳: [104.6791, 31.4675],
  乐山: [103.7656, 29.5521],
  峨眉山: [103.4844, 29.6012],
  九寨沟: [104.2367, 33.2602],
  稻城: [100.2981, 29.0377],
  甘孜: [101.9623, 30.0495],
  贵阳: [106.6302, 26.6477],
  遵义: [106.9274, 27.7257],
  安顺: [105.9476, 26.2531],
  昆明: [102.8329, 24.8801],
  大理: [100.2676, 25.6065],
  丽江: [100.2278, 26.855],
  香格里拉: [99.7065, 27.8269],
  西双版纳: [100.7977, 22.0077],
  腾冲: [98.4906, 25.0205],
  拉萨: [91.1409, 29.6456],
  林芝: [94.3615, 29.6491],
  日喀则: [88.8806, 29.2669],
  西安: [108.9398, 34.3416],
  咸阳: [108.709, 34.3296],
  延安: [109.4897, 36.5854],
  汉中: [107.0233, 33.0675],
  兰州: [103.8343, 36.0611],
  天水: [105.7249, 34.5809],
  张掖: [100.4498, 38.9259],
  嘉峪关: [98.2892, 39.7731],
  敦煌: [94.6619, 40.1421],
  西宁: [101.7782, 36.6171],
  格尔木: [94.9033, 36.4024],
  银川: [106.2309, 38.4872],
  中卫: [105.1968, 37.5002],
  乌鲁木齐: [87.6168, 43.8256],
  吐鲁番: [89.1897, 42.9513],
  喀什: [75.9897, 39.4677],
  伊宁: [81.3241, 43.9168],
  阿勒泰: [88.1412, 47.8449],
  香港: [114.1694, 22.3193],
  澳门: [113.5439, 22.1987],
  台北: [121.5654, 25.033],
};

/** 常见机场 / 高铁枢纽别名到城市的映射 */
const HUB_ALIASES: Array<[RegExp, string]> = [
  [/首都|大兴|北京南|北京西|北京北|北京朝阳|清河|丰台/i, '北京'],
  [/虹桥|浦东|上海南|上海西|松江/i, '上海'],
  [/滨海|天津西|天津南|于家堡|武清|西青/i, '天津'],
  [/白云|广州南|广州东|广州北|庆盛/i, '广州'],
  [/宝安|深圳北|福田|坪山/i, '深圳'],
  [/萧山|杭州东|杭州西|杭州南/i, '杭州'],
  [/禄口|南京南/i, '南京'],
  [/天府|双流|成都东|成都南|成都西/i, '成都'],
  [/江北|重庆北|重庆西|沙坪坝/i, '重庆'],
  [/咸阳|西安北/i, '西安'],
  [/天河|汉口|武昌|武汉东/i, '武汉'],
  [/黄花|长沙南/i, '长沙'],
  [/新郑|郑州东/i, '郑州'],
  [/胶东|流亭|青岛北|青岛西/i, '青岛'],
  [/遥墙|济南西|济南东/i, '济南'],
  [/高崎|厦门北|鼓浪屿/i, '厦门'],
  [/长乐|福州南/i, '福州'],
  [/长水|昆明南/i, '昆明'],
  [/美兰|海口东/i, '海口'],
  [/凤凰机场|亚龙湾/i, '三亚'],
  [/龙洞堡|贵阳北|贵阳东/i, '贵阳'],
  [/吴圩|南宁东/i, '南宁'],
  [/两江|桂林北|桂林西/i, '桂林'],
  [/桃仙|沈阳北|沈阳南/i, '沈阳'],
  [/周水子|大连北/i, '大连'],
  [/太平|哈尔滨西/i, '哈尔滨'],
  [/龙嘉|长春西/i, '长春'],
  [/武宿|太原南/i, '太原'],
  [/正定/i, '石家庄'],
  [/新桥|合肥南/i, '合肥'],
  [/昌北|南昌西/i, '南昌'],
  [/中川|兰州西/i, '兰州'],
  [/曹家堡/i, '西宁'],
  [/河东/i, '银川'],
  [/地窝堡/i, '乌鲁木齐'],
  [/贡嘎/i, '拉萨'],
  [/三义/i, '丽江'],
  [/嘎洒/i, '西双版纳'],
  [/白塔/i, '呼和浩特'],
  [/栎社/i, '宁波'],
  [/龙湾/i, '温州'],
  [/硕放/i, '无锡'],
  [/晋江/i, '泉州'],
  [/金湾/i, '珠海'],
  [/揭阳/i, '潮州'],
  [/赤鱲角/i, '香港'],
];

const SORTED_CITY_KEYS = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);

export interface ResolvedPlace {
  cityName: string;
  coord: [number, number];
}

export function resolvePlaceCoord(rawName: string): ResolvedPlace | null {
  const cleaned = String(rawName || '').trim();
  if (!cleaned) return null;
  for (const [pattern, city] of HUB_ALIASES) {
    if (pattern.test(cleaned) && CITY_COORDS[city]) {
      return { cityName: city, coord: CITY_COORDS[city] };
    }
  }
  for (const city of SORTED_CITY_KEYS) {
    if (cleaned.includes(city)) {
      return { cityName: city, coord: CITY_COORDS[city] };
    }
  }
  return null;
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export interface RouteSegment {
  ticket: TravelTicket;
  from: ResolvedPlace;
  to: ResolvedPlace;
  distanceKm: number;
}

export function extractRouteSegments(tickets: TravelTicket[]): RouteSegment[] {
  const ordered = [...tickets].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const segments: RouteSegment[] = [];
  for (const ticket of ordered) {
    const from = resolvePlaceCoord(ticket.fromPlace);
    const to = resolvePlaceCoord(ticket.toPlace);
    if (from && to && (from.cityName !== to.cityName || haversineKm(from.coord, to.coord) > 5)) {
      segments.push({
        ticket,
        from,
        to,
        distanceKm: haversineKm(from.coord, to.coord),
      });
    }
  }
  return segments;
}

/* ==================== 高清拟物票据 Canvas 绘制引擎 ==================== */

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seedStr: string, color: string) {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  ctx.fillStyle = color;
  let cx = x;
  while (cx < x + w - 2) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    const barW = ((hash >>> 0) % 3) + 1.4;
    const gap = (((hash >>> 4) & 3) % 3) + 1.6;
    if (cx + barW <= x + w) {
      ctx.fillRect(cx, y, barW, h);
    }
    cx += barW + gap;
  }
}

function drawStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, topText: string, bottomText: string, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.22);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, radius - 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(topText, 0, -9);
  ctx.font = '700 11px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(bottomText, 0, 10);
  ctx.restore();
}

function drawTicketCardOnCanvas(ctx: CanvasRenderingContext2D, ticket: TravelTicket, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x, y);

  if (ticket.kind === 'train') {
    // 经典蓝粉磁介质高铁票
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c8e4fa');
    grad.addColorStop(0.58, '#e3f1fc');
    grad.addColorStop(0.82, '#f5e4ea');
    grad.addColorStop(1, '#f2d3de');
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#97c4e8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 淡网格底纹
    ctx.save();
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.clip();
    ctx.strokeStyle = 'rgba(72, 134, 194, 0.09)';
    ctx.lineWidth = 1;
    for (let gx = 20; gx < w; gx += 22) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }
    for (let gy = 20; gy < h; gy += 22) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    // 底部深蓝磁条装饰
    ctx.fillStyle = 'rgba(42, 114, 181, 0.14)';
    ctx.fillRect(0, h - 42, w, 42);
    ctx.restore();

    // 左右半圆打孔缺口
    ctx.fillStyle = '#f6efe4';
    ctx.beginPath(); ctx.arc(0, h * 0.62, 11, -Math.PI / 2, Math.PI / 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w, h * 0.62, 11, Math.PI / 2, -Math.PI / 2); ctx.fill();

    // 顶部栏
    ctx.fillStyle = '#c43e3e';
    ctx.font = '700 15px "Courier New", monospace';
    ctx.fillText(`NO.${ticket.id.slice(-8).toUpperCase()}`, 26, 34);
    ctx.fillStyle = '#1e4b7a';
    ctx.textAlign = 'right';
    ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(ticket.seatOrGate || '电子客票 · 铁路畅行', w - 26, 34);
    ctx.textAlign = 'left';

    // 主起终点与车次
    ctx.fillStyle = '#14263a';
    ctx.font = '800 34px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(ticket.fromPlace || '出发站', 34, 102);
    ctx.textAlign = 'right';
    ctx.fillText(ticket.toPlace || '到达站', w - 34, 102);

    // 居中车次与长箭头
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1b5fa8';
    ctx.font = '800 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(ticket.code || 'G----', w / 2, 86);
    ctx.strokeStyle = '#1b5fa8';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 78, 104);
    ctx.lineTo(w / 2 + 78, 104);
    ctx.lineTo(w / 2 + 64, 96);
    ctx.stroke();

    // 发车时间与票价
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1d3247';
    ctx.font = '700 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`${ticket.date || '日期未填'}  ${ticket.time ? `${ticket.time} 开` : ''}`, 34, 152);
    ctx.fillStyle = '#b91c1c';
    ctx.font = '800 24px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`¥ ${Number(ticket.price || 0).toFixed(1)} 元`, 34, 192);

    ctx.fillStyle = '#334e68';
    ctx.font = '500 15px "PingFang SC", "Microsoft YaHei", sans-serif';
    const infoLine = [ticket.passenger, ticket.note].filter(Boolean).join(' · ') || '限乘当日当次车 · 周游票夹珍藏';
    ctx.fillText(infoLine.slice(0, 34), 34, 232);

    // 右下条码 + 印章
    drawBarcode(ctx, w - 210, 178, 176, 42, ticket.id + ticket.code, '#1b3550');
    drawStamp(ctx, w - 122, 134, 34, '周游票夹', '已乘纪念', '#c93b3b');
  } else if (ticket.kind === 'flight') {
    // 航空登机牌
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.fillStyle = '#fffdf9';
    ctx.fill();
    ctx.strokeStyle = '#d4dce6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 顶部深蓝航司条
    ctx.save();
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.clip();
    const topGrad = ctx.createLinearGradient(0, 0, w, 0);
    topGrad.addColorStop(0, '#0f3d6e');
    topGrad.addColorStop(0.7, '#1d5fa3');
    topGrad.addColorStop(1, '#c8923a');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, 54);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('✈  BOARDING PASS · 登机牌', 26, 34);
    ctx.textAlign = 'right';
    ctx.font = '700 16px "Courier New", monospace';
    ctx.fillText(ticket.code || 'FLIGHT', w - 26, 34);
    ctx.textAlign = 'left';

    // 右侧副券虚线
    const stubX = w - 215;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(stubX, 62); ctx.lineTo(stubX, h - 14); ctx.stroke();
    ctx.setLineDash([]);

    // 上下半圆缺口
    ctx.fillStyle = '#f6efe4';
    ctx.beginPath(); ctx.arc(stubX, 0, 11, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(stubX, h, 11, Math.PI, Math.PI * 2); ctx.fill();

    // 航段起降
    ctx.fillStyle = '#0f2540';
    ctx.font = '800 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText((ticket.fromPlace || '出发地').slice(0, 8), 28, 114);
    ctx.fillStyle = '#1d5fa3';
    ctx.font = '700 24px sans-serif';
    ctx.fillText('── ✈ ──▶', 210, 112);
    ctx.fillStyle = '#0f2540';
    ctx.font = '800 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText((ticket.toPlace || '目的地').slice(0, 8), 342, 114);

    // 网格信息
    const cols = [
      { label: 'DATE / 日期', val: ticket.date || '-' },
      { label: 'TIME / 起飞', val: ticket.time || '-' },
      { label: 'SEAT & GATE / 座位登机口', val: (ticket.seatOrGate || '待定').slice(0, 18) },
    ];
    cols.forEach((col, i) => {
      const cx = 28 + i * 165;
      ctx.fillStyle = '#64748b';
      ctx.font = '600 12px "PingFang SC", sans-serif';
      ctx.fillText(col.label, cx, 160);
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 17px "PingFang SC", sans-serif';
      ctx.fillText(col.val, cx, 184);
    });

    ctx.fillStyle = '#475569';
    ctx.font = '600 14px "PingFang SC", sans-serif';
    ctx.fillText(`PASSENGER: ${ticket.passenger || 'TRAVELER'}   ·   ¥ ${Number(ticket.price || 0).toFixed(0)}`, 28, 226);

    // 副券区
    ctx.fillStyle = '#0f3d6e';
    ctx.font = '700 16px "PingFang SC", sans-serif';
    ctx.fillText(ticket.code || 'FLIGHT', stubX + 20, 96);
    ctx.fillStyle = '#475569';
    ctx.font = '600 13px "PingFang SC", sans-serif';
    ctx.fillText(`${ticket.date || ''}`, stubX + 20, 122);
    ctx.fillText(`${(ticket.fromPlace || '').slice(0, 5)} → ${(ticket.toPlace || '').slice(0, 5)}`, stubX + 20, 146);
    drawBarcode(ctx, stubX + 18, 174, 176, 52, ticket.id + ticket.fromPlace + ticket.toPlace, '#0f2540');
    drawStamp(ctx, stubX - 58, 206, 30, 'AIR', 'BOARDED', '#0369a1');
  } else if (ticket.kind === 'toll') {
    // 高速过路费机打热敏票
    drawRoundedRect(ctx, 0, 0, w, h, 10);
    ctx.fillStyle = '#fbf7ee';
    ctx.fill();
    ctx.strokeStyle = '#d9ccb6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 顶部与底部锯齿纹装饰
    ctx.fillStyle = '#b45309';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillStyle = '#92400e';
    ctx.textAlign = 'center';
    ctx.font = '800 20px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('公路车辆通行费电子票据 · 高速过路费', w / 2, 42);
    ctx.strokeStyle = '#c8b496';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(28, 58); ctx.lineTo(w - 28, 58); ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#3b2f24';
    ctx.font = '600 16px "Courier New", "PingFang SC", monospace';
    ctx.fillText(`入口收费站：${ticket.fromPlace || '未填写'}`, 34, 94);
    ctx.fillText(`出口收费站：${ticket.toPlace || '未填写'}`, 34, 124);
    ctx.fillText(`通行路段：  ${ticket.code || '高速公路'}`, 34, 154);
    ctx.fillText(`日期 / 车型：${ticket.date || '-'} ${ticket.time || ''}  ${ticket.seatOrGate || '一型客车'}`, 34, 184);
    ctx.fillText(`车牌 / 备注：${[ticket.passenger, ticket.note].filter(Boolean).join(' · ') || 'ETC 自动扣费'}`, 34, 214);

    // 右侧金额框
    drawRoundedRect(ctx, w - 220, 78, 186, 84, 12);
    ctx.fillStyle = 'rgba(217, 119, 6, 0.1)';
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#92400e';
    ctx.font = '600 13px "PingFang SC", sans-serif';
    ctx.fillText('实付通行费', w - 127, 102);
    ctx.fillStyle = '#b45309';
    ctx.font = '800 28px "PingFang SC", sans-serif';
    ctx.fillText(`¥ ${Number(ticket.price || 0).toFixed(2)}`, w - 127, 140);

    drawStamp(ctx, w - 115, 206, 32, '高速通行', '已核销', '#c2410c');
  } else {
    // 大巴 / 轮渡 / 景点票根
    const accent = TICKET_KIND_META[ticket.kind].routeColor;
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    drawRoundedRect(ctx, 0, 0, w, h, 18);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 16, h);
    ctx.restore();

    ctx.fillStyle = '#f6efe4';
    ctx.beginPath(); ctx.arc(w - 190, 0, 11, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.arc(w - 190, h, 11, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d6d3d1';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(w - 190, 16); ctx.lineTo(w - 190, h - 16); ctx.stroke();
    ctx.setLineDash([]);

    const meta = TICKET_KIND_META[ticket.kind];
    ctx.fillStyle = accent;
    ctx.font = '700 16px "PingFang SC", sans-serif';
    ctx.fillText(`${meta.icon}  ${meta.label}`, 36, 40);

    ctx.fillStyle = '#1f2937';
    ctx.font = '800 30px "PingFang SC", sans-serif';
    const routeTitle = ticket.kind === 'ticket'
      ? (ticket.toPlace || ticket.fromPlace || '景点票根')
      : `${ticket.fromPlace || '出发'} → ${ticket.toPlace || '到达'}`;
    ctx.fillText(routeTitle.slice(0, 18), 36, 98);

    ctx.fillStyle = '#4b5563';
    ctx.font = '600 17px "PingFang SC", sans-serif';
    ctx.fillText(`${ticket.date || '-'} ${ticket.time || ''}   ${ticket.code || ''}`, 36, 142);
    ctx.fillText(ticket.seatOrGate || ticket.note || '周游票夹 · 出行留念', 36, 178);

    ctx.fillStyle = accent;
    ctx.font = '800 24px "PingFang SC", sans-serif';
    ctx.fillText(`¥ ${Number(ticket.price || 0).toFixed(1)}`, 36, 224);

    drawBarcode(ctx, w - 170, 168, 146, 52, ticket.id + ticket.toPlace, '#1f2937');
    drawStamp(ctx, w - 98, 96, 32, '周游票根', meta.shortLabel, accent);
  }

  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片生成失败'));
    }, 'image/png');
  });
}

/** 导出单张高清拟物票据 PNG */
export async function renderSingleTicketPng(ticket: TravelTicket): Promise<{ blob: Blob; dataUrl: string }> {
  const scale = 2;
  const pad = 28;
  const cardW = 760;
  const cardH = 260;
  const canvas = document.createElement('canvas');
  canvas.width = (cardW + pad * 2) * scale;
  canvas.height = (cardH + pad * 2 + 34) * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#f6efe4';
  ctx.fillRect(0, 0, cardW + pad * 2, cardH + pad * 2 + 34);

  // 卡片柔和投影
  ctx.save();
  ctx.shadowColor = 'rgba(30, 20, 12, 0.14)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  drawTicketCardOnCanvas(ctx, ticket, pad, pad, cardW, cardH);
  ctx.restore();

  // 底部落款
  ctx.fillStyle = '#8a7a6a';
  ctx.font = '500 13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  const footer = `周游地图 · 出行票夹${ticket.tripLabel ? ` · ${ticket.tripLabel}` : ''}`;
  ctx.fillText(footer, (cardW + pad * 2) / 2, cardH + pad + 26);

  const blob = await canvasToBlob(canvas);
  return { blob, dataUrl: canvas.toDataURL('image/png') };
}

/** 导出整次出行票夹合集长图 PNG */
export async function renderTripTicketCollagePng(tripTitle: string, tickets: TravelTicket[]): Promise<{ blob: Blob; dataUrl: string }> {
  const ordered = [...tickets].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const scale = 2;
  const pad = 34;
  const cardW = 760;
  const cardH = 260;
  const gap = 24;
  const headerH = 128;
  const footerH = 56;
  const totalW = cardW + pad * 2;
  const totalH = headerH + ordered.length * cardH + Math.max(0, ordered.length - 1) * gap + footerH + pad;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // 手账纸纹底色
  ctx.fillStyle = '#f6efe4';
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.strokeStyle = 'rgba(180, 156, 126, 0.14)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < totalW; gx += 28) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, totalH); ctx.stroke();
  }
  for (let gy = 0; gy < totalH; gy += 28) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(totalW, gy); ctx.stroke();
  }

  // 顶部标题与统计
  const totalPrice = ordered.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const segments = extractRouteSegments(ordered);
  const totalKm = segments.reduce((sum, s) => sum + s.distanceKm, 0);
  const dates = ordered.map((t) => t.date).filter(Boolean).sort();
  const dateRange = dates.length > 1 ? `${dates[0]} — ${dates[dates.length - 1]}` : (dates[0] || '');

  ctx.fillStyle = '#2d231c';
  ctx.font = '800 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`🎫 ${tripTitle || '我的出行票夹'}`, pad, 56);
  ctx.fillStyle = '#7c6a58';
  ctx.font = '600 16px "PingFang SC", "Microsoft YaHei", sans-serif';
  const summaryParts = [
    dateRange,
    `${ordered.length} 张票据`,
    `合计 ¥${totalPrice.toFixed(1)}`,
    totalKm > 0 ? `约 ${totalKm} km` : '',
  ].filter(Boolean);
  ctx.fillText(summaryParts.join('  ·  '), pad, 92);

  // 逐张绘制拟物票据
  ordered.forEach((ticket, index) => {
    const cy = headerH + index * (cardH + gap);
    ctx.save();
    ctx.shadowColor = 'rgba(30, 20, 12, 0.12)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    drawTicketCardOnCanvas(ctx, ticket, pad, cy, cardW, cardH);
    ctx.restore();
  });

  ctx.fillStyle = '#8b7b6b';
  ctx.textAlign = 'center';
  ctx.font = '500 14px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('周游地图 · 一页规划远方，一生点亮周游', totalW / 2, totalH - 24);

  const blob = await canvasToBlob(canvas);
  return { blob, dataUrl: canvas.toDataURL('image/png') };
}

/** 导出基于票据生成的「出行路线图海报」PNG */
export async function renderTripRouteMapPng(tripTitle: string, tickets: TravelTicket[]): Promise<{ blob: Blob; dataUrl: string }> {
  const segments = extractRouteSegments(tickets);
  const scale = 2;
  const W = 900;
  const mapH = 540;
  const listH = Math.max(170, 92 + segments.length * 46);
  const H = 116 + mapH + listH + 46;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // 深色暖琥珀复古航海图背景
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#1e1915');
  bgGrad.addColorStop(1, '#29211b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const totalPrice = tickets.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const totalKm = segments.reduce((sum, s) => sum + s.distanceKm, 0);
  const cityChain: string[] = [];
  for (const seg of segments) {
    if (cityChain[cityChain.length - 1] !== seg.from.cityName) cityChain.push(seg.from.cityName);
    if (cityChain[cityChain.length - 1] !== seg.to.cityName) cityChain.push(seg.to.cityName);
  }

  // 头部
  ctx.fillStyle = '#f6e7d4';
  ctx.font = '800 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`🗺️ ${tripTitle || '出行路线图'}`, 36, 52);
  ctx.fillStyle = '#c8a982';
  ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(
    `${cityChain.join(' → ') || '已记录票据路线'}  ·  ${segments.length} 程  ·  约 ${totalKm} km  ·  ¥${totalPrice.toFixed(1)}`,
    36,
    84,
  );

  // 地图画布区域
  const mx = 36;
  const my = 108;
  const mw = W - 72;
  const mh = mapH;
  drawRoundedRect(ctx, mx, my, mw, mh, 20);
  ctx.fillStyle = '#15120f';
  ctx.fill();
  ctx.strokeStyle = 'rgba(218, 178, 118, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 经纬网格底纹
  ctx.save();
  drawRoundedRect(ctx, mx, my, mw, mh, 20);
  ctx.clip();
  ctx.strokeStyle = 'rgba(218, 178, 118, 0.08)';
  ctx.lineWidth = 1;
  for (let gx = mx + 50; gx < mx + mw; gx += 60) {
    ctx.beginPath(); ctx.moveTo(gx, my); ctx.lineTo(gx, my + mh); ctx.stroke();
  }
  for (let gy = my + 50; gy < my + mh; gy += 60) {
    ctx.beginPath(); ctx.moveTo(mx, gy); ctx.lineTo(mx + mw, gy); ctx.stroke();
  }

  // 计算坐标投影
  const allCoords = segments.flatMap((s) => [s.from.coord, s.to.coord]);
  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);
  let minLng = Math.min(...lngs, 100);
  let maxLng = Math.max(...lngs, 120);
  let minLat = Math.min(...lats, 24);
  let maxLat = Math.max(...lats, 40);
  if (allCoords.length > 0) {
    minLng = Math.min(...lngs);
    maxLng = Math.max(...lngs);
    minLat = Math.min(...lats);
    maxLat = Math.max(...lats);
  }
  const lngSpan = Math.max(2.5, maxLng - minLng);
  const latSpan = Math.max(2.0, maxLat - minLat);
  const padLng = lngSpan * 0.22;
  const padLat = latSpan * 0.24;
  minLng -= padLng; maxLng += padLng;
  minLat -= padLat; maxLat += padLat;

  const project = ([lng, lat]: [number, number]): [number, number] => {
    const px = mx + ((lng - minLng) / (maxLng - minLng)) * mw;
    const py = my + mh - ((lat - minLat) / (maxLat - minLat)) * mh;
    return [px, py];
  };

  // 绘制每一段轨迹
  segments.forEach((seg, idx) => {
    const [x1, y1] = project(seg.from.coord);
    const [x2, y2] = project(seg.to.coord);
    const color = TICKET_KIND_META[seg.ticket.kind].routeColor;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const curveFactor = seg.ticket.kind === 'flight' ? 0.26 : 0.14;
    const sign = idx % 2 === 0 ? -1 : 1;
    const ctrlX = midX + (-dy / dist) * dist * curveFactor * sign;
    const ctrlY = midY + (dx / dist) * dist * curveFactor * sign;

    // 发光外描边
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = seg.ticket.kind === 'flight' ? 3 : 3.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    if (seg.ticket.kind === 'flight') ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
    ctx.stroke();
    ctx.restore();

    // 曲线中点徽章
    const bx = 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2;
    const by = 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2;
    const badgeText = `${TICKET_KIND_META[seg.ticket.kind].icon} ${seg.ticket.code || `${seg.distanceKm}km`}`;
    ctx.font = '700 12px "PingFang SC", sans-serif';
    const tw = ctx.measureText(badgeText).width + 18;
    drawRoundedRect(ctx, bx - tw / 2, by - 13, tw, 26, 13);
    ctx.fillStyle = 'rgba(22, 18, 14, 0.9)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#f8efe2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx, by);
  });

  // 绘制城市节点
  const uniqueNodes = new Map<string, { name: string; coord: [number, number]; order: number }>();
  let orderNo = 1;
  for (const seg of segments) {
    if (!uniqueNodes.has(seg.from.cityName)) uniqueNodes.set(seg.from.cityName, { name: seg.from.cityName, coord: seg.from.coord, order: orderNo++ });
    if (!uniqueNodes.has(seg.to.cityName)) uniqueNodes.set(seg.to.cityName, { name: seg.to.cityName, coord: seg.to.coord, order: orderNo++ });
  }
  for (const node of uniqueNodes.values()) {
    const [nx, ny] = project(node.coord);
    ctx.beginPath();
    ctx.arc(nx, ny, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#e2a452';
    ctx.fill();
    ctx.strokeStyle = '#15120f';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#1b1510';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 11px sans-serif';
    ctx.fillText(String(node.order), nx, ny + 0.5);

    ctx.fillStyle = '#f8e9d6';
    ctx.font = '700 15px "PingFang SC", sans-serif';
    ctx.fillText(node.name, nx, ny - 22);
  }
  ctx.restore();

  // 底部逐程时间轴明细
  const listTop = my + mh + 26;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e2a452';
  ctx.font = '700 16px "PingFang SC", sans-serif';
  ctx.fillText('行程票据明细', 36, listTop + 14);

  segments.forEach((seg, idx) => {
    const ry = listTop + 48 + idx * 44;
    const meta = TICKET_KIND_META[seg.ticket.kind];
    drawRoundedRect(ctx, 36, ry - 24, W - 72, 36, 10);
    ctx.fillStyle = 'rgba(255, 245, 232, 0.06)';
    ctx.fill();
    ctx.fillStyle = '#f5e8d8';
    ctx.font = '600 14px "PingFang SC", sans-serif';
    ctx.fillText(
      `${idx + 1}. ${meta.icon} ${seg.ticket.fromPlace} → ${seg.ticket.toPlace}   ${seg.ticket.code ? `(${seg.ticket.code})` : ''}`,
      50,
      ry,
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d4b48c';
    ctx.fillText(
      `${seg.ticket.date}  ·  约 ${seg.distanceKm} km  ·  ¥${Number(seg.ticket.price || 0).toFixed(1)}`,
      W - 50,
      ry,
    );
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = '#9c8872';
  ctx.textAlign = 'center';
  ctx.font = '500 13px "PingFang SC", sans-serif';
  ctx.fillText('周游地图 · 出行票夹自动生成路线图', W / 2, H - 18);

  const blob = await canvasToBlob(canvas);
  return { blob, dataUrl: canvas.toDataURL('image/png') };
}
