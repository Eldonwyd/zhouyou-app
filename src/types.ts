import type { AiTravelPlan, PlannerPreferences } from './planner-types';

export type PageName = 'map' | 'plan' | 'companions' | 'detail' | 'achievements' | 'profile';
export type VisitStatus = 'empty' | 'visited';
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'all-day';
export type MediaKind = 'photo' | 'video' | 'audio';
export type BudgetCategory = 'transport' | 'lodging' | 'tickets' | 'food' | 'other';
export type CategoryAmounts = Record<BudgetCategory, number>;
/** 账单按三餐拆分；金额单位为元，空项不写入对象。 */
export type ExpenseCategory = 'breakfast' | 'lunch' | 'dinner' | 'transport' | 'tickets' | 'other' | 'lodging';
export type ExpenseAmounts = Partial<Record<ExpenseCategory, number>>;

/** 单笔 AA 分账记录，金额统一以整数“分”保存，避免浮点误差。 */
export interface ExpenseSplitItem {
  id: string;
  date: string;
  category: ExpenseCategory;
  title: string;
  amountCents: number;
  payer: string;
  participants: string[];
}

export interface CityMark {
  id: string; // The six-digit administrative code is the permanent city ID.
  name: string;
  provinceCode: string;
  visited: boolean;
  planned: boolean;
  updatedAt: string;
}

export interface DayEntry {
  id: string;
  cityCode: string;
  tripId: string | null; // City notes can wait here until a dated journey claims them.
  placeId: string;
  date: string;
  period: DayPeriod;
  note: string;
  place: string;
  order: number;
  highlight: boolean;
}

export interface BookingLedgerEntry {
  category: ExpenseCategory;
  dailyCents: Record<string, number>;
  overallCents?: number;
}

export interface TripPlan {
  /** 仅首次预填预测值，之后清空或改成 0 都不会再次被 AI 覆盖。 */
  aiExpenseSeeded?: boolean;
  dailyExpenses?: Record<string, ExpenseAmounts>;
  overallExpenses?: ExpenseAmounts;
  /** 按订单 ID 记录已回填到账本的金额明细，保证同订单幂等更新与删单准确扣回。 */
  bookingLedgerEntries?: Record<string, BookingLedgerEntry>;
  /** 旧版餐饮没有三餐划分，单独保留原值，不能猜测属于哪一餐。 */
  unallocatedFood?: number;
  id: string; // New sheets use the journey ID; old sheets retain their city ID.
  tripId?: string; // Missing only on legacy city sheets awaiting manual assignment.
  cityCode: string; // Retained so old backups and city-based records remain readable.
  startDate: string;
  endDate: string;
  people: number;
  budget: CategoryAmounts;
  actual: CategoryAmounts;
  manualActualTotal: number | null;
  reminderDays: number;
  /** 同行人 AA 分账成员与逐笔分摊记录。 */
  splitMembers?: string[];
  splitItems?: ExpenseSplitItem[];
}

export interface TravelMedia {
  id: string;
  cityCode: string;
  tripId: string | null;
  placeId: string;
  entryId: string | null;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  capturedAt: string;
  placeName: string;
  latitude: number | null;
  longitude: number | null;
  /** 原始文件大小（字节），原图无损保存。 */
  fileSize?: number;
  /** iOS 实况照片配对视频在 mediaFiles 中的 ID。 */
  liveVideoId?: string | null;
  /** 安卓动态照片（Motion Photo）内嵌视频在原图中的字节偏移。 */
  liveVideoOffset?: number | null;
  /** 安卓动态照片（Motion Photo）内嵌视频的字节长度。 */
  liveVideoLength?: number | null;
  /** 实况视频 MIME 类型（如 video/mp4 或 video/quicktime）。 */
  liveVideoMimeType?: string | null;
}

/** One journey can light several cities while keeping a single date range. */
export interface JourneyCity {
  code: string;
  name: string;
  provinceCode: string;
}

export interface Journey {
  id: string;
  title: string;
  status?: 'planned' | 'visited'; // Missing on older data means visited.
  startDate: string;
  endDate: string;
  cities: JourneyCity[];
  companions: string[];
  createdAt: string;
}

/** Places can wait in a city collection or belong to one dated journey. */
export interface JourneyPlace {
  id: string;
  tripId: string | null; // Null means this place is still in its city's collection.
  cityCode: string;
  name: string;
  reviewText: string;
  /** 每次保存独立保留；缺省时兼容旧版单条文字及备份。 */
  reviewNotes?: Array<{ id: string; text: string; createdAt: string }>;
  reviewAudioId: string | null;
  createdAt: string;
}

export interface MediaFile {
  id: string;
  blob: Blob;
}

export interface Badge {
  id: string;
  title: string;
  linkedEntryId: string | null;
  image: Blob | null;
  createdAt: string;
}

export interface LocalProfile {
  id: 'profile';
  nickname: string;
  avatar?: string;
  motto?: string;
}

export interface AppSnapshot {
  aiPlans: AiTravelPlan[];
  plannerPreferences: PlannerPreferences[];
  marks: CityMark[];
  entries: DayEntry[];
  plans: TripPlan[];
  media: TravelMedia[];
  trips: Journey[];
  places: JourneyPlace[];
  badges: Badge[];
  profile: LocalProfile[];
}

export interface AdministrativeFeature {
  type: 'Feature';
  properties: {
    adcode: number | string;
    name: string;
    level?: string;
    parent?: { adcode: number | string };
    acroutes?: Array<number | string>;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface AdministrativeGeoJSON {
  type: 'FeatureCollection';
  features: AdministrativeFeature[];
}

export const BUDGET_LABELS: Record<BudgetCategory, string> = {
  transport: '交通',
  lodging: '住宿',
  tickets: '门票',
  food: '餐饮',
  other: '其他',
};

export const PERIOD_LABELS: Record<DayPeriod, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
  'all-day': '全天',
};

export const BUDGET_CATEGORIES = Object.keys(BUDGET_LABELS) as BudgetCategory[];

export function emptyAmounts(): CategoryAmounts {
  return { transport: 0, lodging: 0, tickets: 0, food: 0, other: 0 };
}
