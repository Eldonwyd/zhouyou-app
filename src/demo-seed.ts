import type { AppSnapshot, CityMark, DayEntry, Journey, JourneyPlace, MediaFile, TravelMedia, TripPlan } from './types';
import type { AiTravelPlan } from './planner-types';
import { datedPlannerMapPlaces, PLANNER_MAP_LOOKUP_VERSION, type PlannerMapPosition } from './planner-map';
import { replaceSnapshot } from './db';
import northPostcards from './city-postcards-north.webp';
import southPostcards from './city-postcards-south.webp';
import shandongPostcards from './city-postcards-shandong.webp';

const DEMO_ACTIVE_KEY = 'zhouyou-demo-active';
const DEMO_DISMISSED_KEY = 'zhouyou-demo-banner-dismissed';

const ASSET_IDS = {
  erhai: 'a1'.repeat(32),
  xizhou: 'b2'.repeat(32),
  cangshan: 'c3'.repeat(32),
} as const;

export function isDemoModeActive(): boolean {
  try { return localStorage.getItem(DEMO_ACTIVE_KEY) === '1'; } catch { return false; }
}

export function isDemoBannerDismissed(): boolean {
  try { return localStorage.getItem(DEMO_DISMISSED_KEY) === '1'; } catch { return false; }
}

export function dismissDemoBanner(): void {
  try { localStorage.setItem(DEMO_DISMISSED_KEY, '1'); } catch { /* ignore */ }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('示例图片加载失败'));
    img.src = src;
  });
}

/** 从内置 4x4 城市明信片图集中裁剪无缝单景 WebP Blob，用于示例照片手账与 AI 行程配图。 */
async function cropPostcardTile(sheetUrl: string, col: number, row: number): Promise<Blob> {
  const img = await loadImage(sheetUrl);
  const tileW = Math.floor(img.naturalWidth / 4);
  const tileH = Math.floor(img.naturalHeight / 4);
  const sx = col * tileW + Math.round(tileW * 0.02);
  const sy = row * tileH + Math.round(tileH * 0.08);
  const sw = Math.round(tileW * 0.96);
  const sh = Math.round(tileH * 0.72);
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法初始化画布');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('示例图片编码失败'))),
      'image/webp',
      0.9,
    );
  });
}

function buildDemoMarks(): CityMark[] {
  const rows: Array<[string, string, string, boolean, boolean, string]> = [
    ['110100', '北京市', '110000', true, false, '2026-05-01T10:00:00.000Z'],
    ['310100', '上海市', '310000', true, false, '2026-05-10T10:00:00.000Z'],
    ['330100', '杭州市', '330000', true, false, '2026-04-12T10:00:00.000Z'],
    ['320100', '南京市', '320000', true, false, '2026-04-15T10:00:00.000Z'],
    ['370200', '青岛市', '370000', true, false, '2026-07-02T10:00:00.000Z'],
    ['510100', '成都市', '510000', true, false, '2026-08-05T10:00:00.000Z'],
    ['500100', '重庆市', '500000', true, false, '2026-08-09T10:00:00.000Z'],
    ['532900', '大理白族自治州', '530000', true, false, '2026-09-10T10:00:00.000Z'],
    ['530700', '丽江市', '530000', true, false, '2026-09-14T10:00:00.000Z'],
    ['350200', '厦门市', '350000', true, false, '2026-03-20T10:00:00.000Z'],
    ['610100', '西安市', '610000', true, false, '2026-06-11T10:00:00.000Z'],
    ['450300', '桂林市', '450000', true, false, '2026-10-03T10:00:00.000Z'],
    ['230100', '哈尔滨市', '230000', true, false, '2026-01-18T10:00:00.000Z'],
    ['460200', '三亚市', '460000', true, false, '2026-01-05T10:00:00.000Z'],
    ['540100', '拉萨市', '540000', false, true, '2026-11-01T10:00:00.000Z'],
    ['650100', '乌鲁木齐市', '650000', false, true, '2026-11-02T10:00:00.000Z'],
  ];
  return rows.map(([id, name, provinceCode, visited, planned, updatedAt]) => ({
    id, name, provinceCode, visited, planned, updatedAt,
  }));
}

function buildDemoAiPlan(): AiTravelPlan {
  const plan: AiTravelPlan = {
    id: 'demo-ai-plan-dali',
    version: 2,
    contentVersion: 2,
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-23T14:30:00.000Z',
    linkedTripId: 'demo-trip-dali',
    linkedSnapshot: {
      title: '彩云之南 · 大理洱海与喜洲 3日松弛感慢游',
      startDate: '2026-12-05',
      endDate: '2026-12-07',
      cities: [{ code: '532900', name: '大理白族自治州', provinceCode: '530000' }],
      budget: { transport: 140, lodging: 800, tickets: 280, food: 340, other: 120 },
    },
    reminderDays: 3,
    mapPositions: {},
    bookings: [
      {
        id: 'demo-booking-rail',
        kind: 'train',
        title: 'D8708 昆明 → 大理',
        code: 'D8708',
        date: '2026-12-05',
        endDate: '2026-12-05',
        startTime: '06:30',
        endTime: '08:25',
        fromLocation: '昆明站',
        toLocation: '大理站',
        city: '大理市',
        hotelName: '',
        amountYuan: 145,
        seatOrRoom: '04车 08F 二等座',
        note: '本地 OCR 识别导入示例订单',
        backfilledToLedger: true,
        createdAt: '2026-11-21T10:00:00.000Z',
      },
    ],
    packingList: {
      updatedAt: '2026-11-23T10:00:00.000Z',
      generatedByAi: true,
      items: [
        { id: 'pk-1', category: 'documents', name: '身份证 / 学生证（景区优惠）', checked: true },
        { id: 'pk-2', category: 'clothing', name: '防风冲锋衣 & 轻薄羽绒（大理早晚温差大）', checked: true },
        { id: 'pk-3', category: 'other', name: '高倍防晒霜 + 墨镜（高原紫外线较强）', checked: false },
        { id: 'pk-4', category: 'electronics', name: '相机、备用电池与充电宝', checked: false },
      ],
    },
    content: {
      title: '彩云之南 · 大理洱海与喜洲 3日松弛感慢游',
      summary: '兼顾洱海生态廊道骑行、喜洲古镇麦田与苍山玉带路轻徒步，避开人潮高峰，每日顺路串联不走回头路，一键可跳转高德地图与小红书查实时攻略。',
      request: {
        destination: '大理', people: 2, students: 0, seniors: 0, children: 0,
        startDate: '2026-12-05', days: 3, endDate: '2026-12-07', base: '上海',
        budgetCents: 380000, pace: '轻松慢游', transport: '公共交通 + 打车',
        luggageMode: 'suitcase', foodMode: true, skipBreakfast: false,
        dietary: '喜欢云南菌菇与手冲咖啡', lodgingLevel: '舒适景观民宿', rooms: 1,
        notes: '想拍洱海日出和喜洲稻田，不要太赶',
      },
      cities: [{ code: '532900', name: '大理白族自治州', provinceCode: '530000' }],
      constraints: ['每日不早于 08:30 出发，预留咖啡慢时光', '海西与苍山分天游览，减少折返'],
      warnings: ['大理昼夜温差约 12℃，早起看日出建议带防风外套'],
      days: [
        {
          date: '2026-12-05',
          title: '海西生态廊道骑行 · 龙龛日出与喜洲麦田',
          weather: '晴 · 6℃ ~ 19℃ · 紫外线较强',
          activities: [
            {
              id: 'demo-act-1', kind: 'sight', period: 'morning', startTime: '08:40', endTime: '11:30',
              title: '洱海生态廊道（龙龛码头 → 才村）', city: '大理市', location: '大理市龙龛码头',
              description: '沿湖骑行海西最精华一段，打卡水杉林与红嘴鸥，清晨湖面如镜，拍照光线极佳。',
              transportMode: '', meal: null, locked: true,
              photo: { url: '', sourceUrl: 'https://eldonwyd.github.io/zhouyou-app/', attribution: '周游示例实景图', assetId: ASSET_IDS.erhai },
              sourceIds: [],
              costs: [{ id: 'dc-1', label: '双人电助力单车租赁', category: 'transport', unit: 'person', unitPriceCents: 3500, studentPriceCents: null, quantity: 2, occurrences: 1, status: 'estimate', qualification: '', sourceIds: [], includedIn: null }],
              fromActivityId: null, toActivityId: null,
            },
            {
              id: 'demo-act-2', kind: 'food', period: 'noon', startTime: '12:00', endTime: '13:30',
              title: '大理古城白族私房菜（酸辣鱼 · 茉莉花炒蛋）', city: '大理市', location: '大理古城人民路附近',
              description: '地道白族酸木瓜洱海鱼配菌菇土鸡汤，饭后顺路逛人民路独立书店与手作市集。',
              transportMode: '', meal: 'lunch', locked: false, photo: null, sourceIds: [],
              costs: [{ id: 'dc-2', label: '双人白族风味午餐', category: 'food', unit: 'group', unitPriceCents: 16800, studentPriceCents: null, quantity: 1, occurrences: 1, status: 'estimate', qualification: '', sourceIds: [], includedIn: null }],
              fromActivityId: null, toActivityId: null,
            },
            {
              id: 'demo-act-3', kind: 'sight', period: 'afternoon', startTime: '14:30', endTime: '17:40',
              title: '喜洲古镇 · 严家大院与麦田咖啡', city: '大理市', location: '大理市喜洲古镇',
              description: '逛白族青瓦白墙古民居，尝现烤玫瑰喜洲粑粑，傍晚在田野边看苍山落日余晖。',
              transportMode: '', meal: null, locked: false,
              photo: { url: '', sourceUrl: 'https://eldonwyd.github.io/zhouyou-app/', attribution: '周游示例实景图', assetId: ASSET_IDS.xizhou },
              sourceIds: [],
              costs: [{ id: 'dc-3', label: '严家大院门票', category: 'tickets', unit: 'ticket', unitPriceCents: 2500, studentPriceCents: 1250, quantity: 2, occurrences: 1, status: 'verified', qualification: '', sourceIds: [], includedIn: null }],
              fromActivityId: null, toActivityId: null,
            },
          ],
          lodging: {
            city: '大理市', area: '才村码头 / 龙龛湿地周边海景民宿', searchKeyword: '大理 龙龛码头 洱海观景民宿',
            reason: '推窗见洱海且紧邻生态廊道，次日清晨看日出步行可达。',
            costs: [{ id: 'dl-1', label: '海景民宿（1间/晚）', category: 'lodging', unit: 'room', unitPriceCents: 42000, studentPriceCents: null, quantity: 1, occurrences: 1, status: 'estimate', qualification: '', sourceIds: [], includedIn: null }],
            sourceIds: [],
          },
        },
        {
          date: '2026-12-06',
          title: '苍山云海轻徒步 · 寂照庵素斋与古城夜色',
          weather: '多云转晴 · 5℃ ~ 18℃',
          activities: [
            {
              id: 'demo-act-4', kind: 'sight', period: 'morning', startTime: '09:30', endTime: '12:30',
              title: '苍山感通索道 · 玉带云游路轻徒步', city: '大理市', location: '大理苍山感通索道',
              description: '乘索道俯瞰整片洱海全景，沿平缓石板玉带路漫步清碧溪，轻松无压力。',
              transportMode: '', meal: null, locked: false,
              photo: { url: '', sourceUrl: 'https://eldonwyd.github.io/zhouyou-app/', attribution: '周游示例实景图', assetId: ASSET_IDS.cangshan },
              sourceIds: [],
              costs: [{ id: 'dc-4', label: '苍山进山费 + 感通索道往返', category: 'tickets', unit: 'ticket', unitPriceCents: 11500, studentPriceCents: 8000, quantity: 2, occurrences: 1, status: 'verified', qualification: '', sourceIds: [], includedIn: null }],
              fromActivityId: null, toActivityId: null,
            },
            {
              id: 'demo-act-5', kind: 'food', period: 'noon', startTime: '12:45', endTime: '14:15',
              title: '寂照庵素斋 · 古城傍晚漫步', city: '大理市', location: '大理苍山寂照庵',
              description: '被多肉与花草包围的“中国最美尼姑庵”，尝一碗热腾腾的清淡斋饭，下午回古城喝手冲。',
              transportMode: '', meal: 'lunch', locked: false, photo: null, sourceIds: [],
              costs: [{ id: 'dc-5', label: '寂照庵双人素斋', category: 'food', unit: 'person', unitPriceCents: 2000, studentPriceCents: null, quantity: 2, occurrences: 1, status: 'verified', qualification: '', sourceIds: [], includedIn: null }],
              fromActivityId: null, toActivityId: null,
            },
          ],
          lodging: {
            city: '大理市', area: '大理古城南门安静院落', searchKeyword: '大理古城 南门 设计师民宿',
            reason: '进出苍山与古城晚餐都极为方便。',
            costs: [{ id: 'dl-2', label: '古城院落民宿（1间/晚）', category: 'lodging', unit: 'room', unitPriceCents: 38000, studentPriceCents: null, quantity: 1, occurrences: 1, status: 'estimate', qualification: '', sourceIds: [], includedIn: null }],
            sourceIds: [],
          },
        },
      ],
      alternatives: [
        { title: '沙溪古镇一日慢游', city: '大理州剑川县', reason: '如果偏好茶马古道静谧氛围，可把第 3 天留给沙溪玉津桥与先锋书局。', rainyDay: false },
      ],
      unvisitedHighlights: [
        { title: '崇圣寺三塔文化旅游区', city: '大理市', grade: '5A', feature: '南诏大理国皇家寺院地标，苍山洱海绝佳取景位', location: '大理市214国道崇圣寺三塔' },
        { title: '双廊古镇', city: '大理市', grade: '4A', feature: '洱海东北岸渔村风情，杨丽萍太阳宫与玉几岛日落', location: '大理市双廊镇' },
        { title: '蝴蝶泉公园', city: '大理市', grade: '4A', feature: '五朵金花取景地，苍山云弄峰下清泉古树', location: '大理市喜洲镇周城村北蝴蝶泉' },
        { title: '理想邦圣托里尼', city: '大理市', grade: '', feature: '洱海东岸白色阶梯建筑群，海景咖啡与拍照打卡', location: '大理市海东镇理想邦旅游度假小镇' },
      ],
      sources: [],
    },
    messages: [
      { id: 'dm-1', role: 'user', text: '帮我安排 3 天大理轻松慢游，重点看洱海日出、喜洲麦田和苍山，预算 3800 左右。', createdAt: '2026-11-20T09:00:00.000Z' },
      { id: 'dm-2', role: 'assistant', text: '已为你生成 3 日大理松弛感慢游方案：第 1 天专注海西生态廊道骑行与喜洲古镇麦田，第 2 天轻松游览苍山玉带路与寂照庵，所有点位均支持一键跳转高德地图与小红书核对实时攻略。', createdAt: '2026-11-20T09:00:18.000Z', kind: 'revision' },
    ],
    legTransfers: {
      'demo-act-1->demo-act-2': [
        { mode: 'taxi', recommended: true, durationMinutes: 14, distanceKm: 5.2, costCents: 1600, costUnit: 'vehicle' },
        { mode: 'bus', line: 'C2 路环线', fromStation: '才村码头站', toStation: '大理古城东门站', durationMinutes: 26, distanceKm: 5.4, costCents: 300, costUnit: 'person' },
      ],
      'demo-act-2->demo-act-3': [
        { mode: 'taxi', recommended: true, durationMinutes: 28, distanceKm: 18.6, costCents: 4500, costUnit: 'vehicle' },
        { mode: 'bus', line: '古城-喜洲专线', fromStation: '大理古城北门', toStation: '喜洲古镇牌坊', durationMinutes: 42, distanceKm: 19.0, costCents: 1000, costUnit: 'person' },
      ],
    },
    history: [],
  };
  const coordsByHint: Array<[RegExp, number, number, string]> = [
    [/龙龛|洱海|才村/, 25.7145, 100.1942, '大理龙龛生态廊道'],
    [/喜洲|严家/, 25.8531, 100.1328, '大理喜洲古镇'],
    [/苍山|感通/, 25.6612, 100.1445, '苍山感通索道'],
  ];
  const mapPositions: Record<string, PlannerMapPosition> = {};
  for (const place of datedPlannerMapPlaces(plan.content)) {
    const matched = coordsByHint.find(([re]) => re.test(`${place.name} ${place.visits.map((v) => v.title).join(' ')}`));
    if (!matched) continue;
    mapPositions[place.key] = {
      key: place.key,
      status: 'located',
      latitude: matched[1],
      longitude: matched[2],
      label: matched[3],
      precision: 'place',
      source: '手动确认',
      lookupVersion: PLANNER_MAP_LOOKUP_VERSION,
    };
  }
  plan.mapPositions = mapPositions;
  return plan;
}

/** 一键载入丰富示例数据（14座点亮城市、完整大理AI行程、照片手账与每日账本）。 */
export async function loadDemoWorkspace(): Promise<AppSnapshot> {
  const [erhaiBlob, xizhouBlob, cangshanBlob, qingdaoBlob, beijingBlob] = await Promise.all([
    cropPostcardTile(southPostcards, 2, 1),
    cropPostcardTile(southPostcards, 2, 0),
    cropPostcardTile(southPostcards, 3, 0),
    cropPostcardTile(shandongPostcards, 2, 0),
    cropPostcardTile(northPostcards, 0, 0),
  ]);

  const marks = buildDemoMarks();
  const trips: Journey[] = [
    {
      id: 'demo-trip-dali',
      title: '彩云之南 · 洱海环湖与古城漫游',
      status: 'visited',
      startDate: '2026-09-10',
      endDate: '2026-09-15',
      cities: [
        { code: '532900', name: '大理白族自治州', provinceCode: '530000' },
        { code: '530700', name: '丽江市', provinceCode: '530000' },
      ],
      companions: ['阿青', '小满'],
      createdAt: '2026-09-10T08:00:00.000Z',
    },
    {
      id: 'demo-trip-qingdao',
      title: '青岛盛夏 · 红瓦绿树与橘子海日落',
      status: 'visited',
      startDate: '2026-07-02',
      endDate: '2026-07-05',
      cities: [{ code: '370200', name: '青岛市', provinceCode: '370000' }],
      companions: ['小满'],
      createdAt: '2026-07-02T08:00:00.000Z',
    },
  ];

  const places: JourneyPlace[] = [
    {
      id: 'demo-place-erhai', tripId: 'demo-trip-dali', cityCode: '532900',
      name: '洱海生态廊道 · 才村码头',
      reviewText: '清晨七点沿着湖边骑行，水杉倒影在平静湖面上，远处的苍山还笼着薄雾，偶遇一群晒太阳的小狗。',
      reviewAudioId: null, createdAt: '2026-09-11T09:00:00.000Z',
    },
    {
      id: 'demo-place-xizhou', tripId: 'demo-trip-dali', cityCode: '532900',
      name: '喜洲古镇 · 稻田咖啡馆',
      reviewText: '刚出炉的玫瑰喜洲粑粑外酥里软，坐在转角楼旁吹着麦浪的风，整个人都慢下来了。',
      reviewAudioId: null, createdAt: '2026-09-12T15:00:00.000Z',
    },
    {
      id: 'demo-place-lijiang', tripId: 'demo-trip-dali', cityCode: '530700',
      name: '束河古镇 · 青龙桥',
      reviewText: '傍晚的雪山被晚霞染成淡金色，石板路边流水潺潺，比大研古城更安静惬意。',
      reviewAudioId: null, createdAt: '2026-09-14T18:00:00.000Z',
    },
    {
      id: 'demo-place-qingdao', tripId: 'demo-trip-qingdao', cityCode: '370200',
      name: '小麦岛公园',
      reviewText: '傍晚的橘子海太治愈了，草坡上坐满听吉他弹唱的人，海风带着微咸的夏天气息。',
      reviewAudioId: null, createdAt: '2026-07-03T18:30:00.000Z',
    },
  ];

  const entries: DayEntry[] = [
    {
      id: 'demo-entry-1', cityCode: '532900', tripId: 'demo-trip-dali', placeId: 'demo-place-erhai',
      date: '2026-09-11', period: 'morning',
      note: '沿着洱海生态廊道一口气骑了 18 公里，每一帧都像电影里的夏天。',
      place: '洱海生态廊道 · 才村码头', order: 0, highlight: true,
    },
    {
      id: 'demo-entry-2', cityCode: '532900', tripId: 'demo-trip-dali', placeId: 'demo-place-xizhou',
      date: '2026-09-12', period: 'afternoon',
      note: '喜洲稻田边的风特别温柔，在麦田咖啡馆写了三张明信片寄给朋友。',
      place: '喜洲古镇 · 稻田咖啡馆', order: 1, highlight: true,
    },
    {
      id: 'demo-entry-3', cityCode: '370200', tripId: 'demo-trip-qingdao', placeId: 'demo-place-qingdao',
      date: '2026-07-03', period: 'evening',
      note: '等到了整片粉紫色的海上日落，晚风里飘着海浪声和民谣吉他。',
      place: '小麦岛公园', order: 0, highlight: true,
    },
  ];

  const media: TravelMedia[] = [
    { id: 'demo-media-1', cityCode: '532900', tripId: 'demo-trip-dali', placeId: 'demo-place-erhai', entryId: 'demo-entry-1', kind: 'photo', fileName: 'erhai-morning.webp', mimeType: 'image/webp', capturedAt: '2026-09-11T08:30:00.000Z', placeName: '洱海生态廊道 · 才村码头', latitude: 25.714, longitude: 100.194 },
    { id: 'demo-media-2', cityCode: '532900', tripId: 'demo-trip-dali', placeId: 'demo-place-xizhou', entryId: 'demo-entry-2', kind: 'photo', fileName: 'xizhou-fields.webp', mimeType: 'image/webp', capturedAt: '2026-09-12T15:10:00.000Z', placeName: '喜洲古镇 · 稻田咖啡馆', latitude: 25.853, longitude: 100.132 },
    { id: 'demo-media-3', cityCode: '530700', tripId: 'demo-trip-dali', placeId: 'demo-place-lijiang', entryId: null, kind: 'photo', fileName: 'lijiang-dusk.webp', mimeType: 'image/webp', capturedAt: '2026-09-14T18:10:00.000Z', placeName: '束河古镇 · 青龙桥', latitude: 26.921, longitude: 100.203 },
    { id: 'demo-media-4', cityCode: '370200', tripId: 'demo-trip-qingdao', placeId: 'demo-place-qingdao', entryId: 'demo-entry-3', kind: 'photo', fileName: 'qingdao-sunset.webp', mimeType: 'image/webp', capturedAt: '2026-07-03T18:45:00.000Z', placeName: '小麦岛公园', latitude: 36.053, longitude: 120.422 },
    { id: 'demo-media-5', cityCode: '110100', tripId: null, placeId: 'demo-place-erhai', entryId: null, kind: 'photo', fileName: 'beijing-autumn.webp', mimeType: 'image/webp', capturedAt: '2026-05-02T10:30:00.000Z', placeName: '天坛祈年殿', latitude: 39.882, longitude: 116.407 },
  ];

  const plans: TripPlan[] = [
    {
      id: 'demo-trip-dali',
      tripId: 'demo-trip-dali',
      cityCode: '532900',
      startDate: '2026-09-10',
      endDate: '2026-09-15',
      people: 2,
      budget: { transport: 360, lodging: 1600, tickets: 320, food: 680, other: 240 },
      actual: { transport: 290, lodging: 1520, tickets: 280, food: 615, other: 160 },
      manualActualTotal: null,
      reminderDays: 3,
      dailyExpenses: {
        '2026-09-10': { transport: 145, dinner: 168, lodging: 420 },
        '2026-09-11': { breakfast: 38, lunch: 124, dinner: 145, transport: 70, tickets: 50, lodging: 420 },
        '2026-09-12': { breakfast: 32, lunch: 108, transport: 75, tickets: 230, lodging: 380, other: 160 },
      },
      splitMembers: ['我', '阿青'],
      splitItems: [
        { id: 'sp-1', date: '2026-09-10', category: 'transport', title: 'D8708 动车票（OCR 自动导入）', amountCents: 29000, payer: '我', participants: ['我', '阿青'] },
        { id: 'sp-2', date: '2026-09-11', category: 'lodging', title: '才村海景民宿 2 晚', amountCents: 84000, payer: '阿青', participants: ['我', '阿青'] },
        { id: 'sp-3', date: '2026-09-11', category: 'dinner', title: '白族私房菜酸辣鱼', amountCents: 16800, payer: '我', participants: ['我', '阿青'] },
      ],
    },
  ];

  const snapshot: AppSnapshot = {
    marks,
    trips,
    places,
    entries,
    media,
    plans,
    badges: [
      { id: 'demo-badge-1', title: '洱海追风骑士', linkedEntryId: 'demo-entry-1', image: null, createdAt: '2026-09-11T19:00:00.000Z' },
    ],
    profile: [
      { id: 'profile', nickname: '山海旅人', avatar: 'bear', motto: '把喜欢的风和日落，悄悄夹进旅行小册子 ✨' },
    ],
    aiPlans: [buildDemoAiPlan()],
    plannerPreferences: [],
  };

  const mediaFiles: MediaFile[] = [
    { id: 'demo-media-1', blob: erhaiBlob },
    { id: 'demo-media-2', blob: xizhouBlob },
    { id: 'demo-media-3', blob: cangshanBlob },
    { id: 'demo-media-4', blob: qingdaoBlob },
    { id: 'demo-media-5', blob: beijingBlob },
  ];
  const plannerPhotos: MediaFile[] = [
    { id: ASSET_IDS.erhai, blob: erhaiBlob },
    { id: ASSET_IDS.xizhou, blob: xizhouBlob },
    { id: ASSET_IDS.cangshan, blob: cangshanBlob },
  ];

  await replaceSnapshot(snapshot, mediaFiles, plannerPhotos);
  try {
    localStorage.setItem(DEMO_ACTIVE_KEY, '1');
    localStorage.removeItem(DEMO_DISMISSED_KEY);
  } catch { /* ignore */ }
  return snapshot;
}

/** 退出演示模式并清空示例数据，恢复空白小册子。 */
export async function clearDemoWorkspace(): Promise<AppSnapshot> {
  const empty: AppSnapshot = {
    marks: [], entries: [], plans: [], media: [], badges: [],
    profile: [], trips: [], places: [], aiPlans: [], plannerPreferences: [],
  };
  await replaceSnapshot(empty, [], []);
  try {
    localStorage.removeItem(DEMO_ACTIVE_KEY);
    localStorage.setItem(DEMO_DISMISSED_KEY, '1');
  } catch { /* ignore */ }
  return empty;
}
