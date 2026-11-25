import type { BudgetCategory, JourneyCity } from './types';

export type XhsPlaceKind = 'sight' | 'food' | 'lodging' | 'photo_spot' | 'other';
export type XhsReferenceMode = 'blend' | 'reorder' | 'follow' | 'inspire';
export type PlannerLuggageMode = 'backpack' | 'suitcase';

export interface XhsExtractedPlace {
  id: string;
  name: string;
  canonicalName: string;
  city: string;
  kind: XhsPlaceKind;
  dayHint: number | null;
  note: string;
  selected: boolean;
}

/** 结构化小红书参考包（截图只做瞬时识别，不保存图片内容）。 */
export interface XhsReference {
  id: string;
  sourceType: 'xhs_link' | 'screenshot' | 'text';
  title: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  destinations: string[];
  suggestedDays: number | null;
  styleTags: string[];
  routeOutline: string[];
  tips: string[];
  places: XhsExtractedPlace[];
  /** 仅解析弹窗预览期间用于二次识图，持久化前可省略。 */
  noteImages?: string[];
  imageTextSuggested?: boolean;
}

export interface WishlistPlace {
  id: string;
  name: string;
  canonicalName: string;
  city: string;
  kind: XhsPlaceKind;
  note: string;
  sourceTitle?: string;
  sourceUrl?: string;
  addedAt: string;
}

export interface PlannerMessageAttachment {
  title: string;
  url?: string;
  sourceType: 'xhs_link' | 'screenshot' | 'text';
  placeNames: string[];
}

/** Planner data is independent of diary entries and their media relationships. */
export interface PlannerRequest {
  destination: string;
  people: number;
  students: number;
  /** 老人、儿童人数；旧计划没有这两项时按 0 处理。学生、老人、儿童之外都是成人。 */
  seniors?: number;
  children?: number;
  travelersText?: string; // Preserve arbitrary party descriptions for the prompt.
  startDate: string;
  days: number | null;
  endDate: string;
  base: string;
  budgetCents: number | null;
  pace: string;
  transport: string;
  /** 旧计划省略时按行李箱出行。 */
  luggageMode?: PlannerLuggageMode;
  foodMode: boolean;
  skipBreakfast: boolean;
  dietary: string;
  lodgingLevel: string;
  rooms: number | null;
  notes: string;
  /** 新建计划时挂载的小红书参考包与参考策略（可选，兼容旧计划）。 */
  references?: XhsReference[];
  referenceMode?: XhsReferenceMode;
}

export interface PlannerSource {
  id: string;
  title: string;
  url: string;
  checkedAt: string;
}

export interface PlannerPhoto {
  url: string;
  sourceUrl: string;
  attribution: string;
  /** 本地已验证照片的内容散列；原始地址及来源仍独立保留。 */
  assetId?: string;
  storedAt?: string;
}

/** Prices are integer CNY cents. Null is unknown, never a free ticket. */
export interface PlannerCost {
  id: string;
  label: string;
  category: BudgetCategory;
  unit: 'ticket' | 'person' | 'room' | 'vehicle' | 'group';
  unitPriceCents: number | null;
  studentPriceCents: number | null;
  /** 老人票、儿童票单价；未知为 null（按成人价预算并提示待确认）。旧数据可能没有。 */
  seniorPriceCents?: number | null;
  childPriceCents?: number | null;
  quantity: number;
  occurrences: number;
  /** booked 表示用户确认的订单实付金额；verified 表示有公开资料佐证的价格。 */
  status: 'verified' | 'booked' | 'estimate' | 'unknown';
  qualification: string;
  sourceIds: string[];
  includedIn: string | null;
}

export type PlannerPeriod = 'morning' | 'noon' | 'afternoon' | 'evening';
export type PlannerTransferModeKind = 'walk' | 'subway' | 'bus' | 'taxi' | 'drive' | 'train' | 'flight' | 'other';

/** 交通衔接的结构化方案明细：公共交通可并列步行/地铁公交/打车供参考，自驾仅保留开车距离与耗时。 */
export interface PlannerTransferOption {
  mode: PlannerTransferModeKind;
  recommended?: boolean;
  line?: string;
  fromStation?: string;
  toStation?: string;
  transferNote?: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  costCents?: number | null;
  costUnit?: 'person' | 'vehicle';
  /** 较远路段可在打车项内附带顺风车预估价（人民币整数分）及简短说明。 */
  carpoolCostCents?: number | null;
  carpoolNote?: string;
}

export interface PlannerActivity {
  id: string;
  kind: 'sight' | 'food' | 'transport' | 'rest';
  /** 景区级别标注（如 5A / 4A / 3A），可选。 */
  grade?: string;
  period: PlannerPeriod;
  startTime: string;
  endTime: string;
  title: string;
  city: string;
  location: string;
  description: string;
  /** 与活动同卡显示；出处只引用应用实际查到的资料。 */
  luggageNote?: { text: string; sourceId?: string; searchQuery?: string };
  transportMode: string;
  /** 交通卡的路线估算距离，单位为公里；null 表示待确认，旧计划可以省略。 */
  distanceKm?: number | null;
  /** 交通卡的结构化出行方案明细（步行/地铁/公交/打车/自驾）；旧计划可以省略。 */
  transferOptions?: PlannerTransferOption[];
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  locked: boolean;
  photo: PlannerPhoto | null;
  photoQuery?: string; // Canonical place name, separate from a descriptive title.
  sourceIds: string[];
  costs: PlannerCost[];
  /** References identify the two activities joined by a transfer. */
  fromActivityId: string | null;
  toActivityId: string | null;
  /** 订单安排的行程卡由预订面板统一维护；游玩时间保留原计划，改签后可重新推算。 */
  bookingId?: string;
  bookingTiming?: {
    startTime: string;
    endTime: string;
    period: PlannerPeriod;
    /** 调整餐别时保留原文和原费用，后续改签可以按原安排重新推算。 */
    originalMeal?: Pick<PlannerActivity, 'meal' | 'title' | 'description' | 'costs'>;
    deferred?: 'no-time' | 'replaced-transfer';
  };
}

export interface PlannerLodging {
  city: string;
  area: string;
  searchKeyword: string;
  reason: string;
  costs: PlannerCost[];
  sourceIds: string[];
  /** 保留住宿的原估算，便于订单换酒店、换日期或移除时恢复。 */
  bookingOriginalCosts?: PlannerCost[];
}

export interface PlannerDay {
  date: string;
  title: string;
  weather: string;
  activities: PlannerActivity[];
  lodging: PlannerLodging | null;
}

export interface UnvisitedPopularSight {
  title: string;
  city: string;
  grade?: string;
  feature: string;
  location: string;
}

export interface PlannerContent {
  title: string;
  summary: string;
  request: PlannerRequest;
  cities: JourneyCity[];
  constraints: string[];
  warnings: string[];
  days: PlannerDay[];
  alternatives: Array<{ title: string; city: string; reason: string; rainyDay: boolean }>;
  /** 目的地内尚未排入本次行程的热门景点（精简展示，支持一键排入行程）。 */
  unvisitedHighlights?: UnvisitedPopularSight[];
  sources: PlannerSource[];
}

/** 每个候选方案独立保存范围、版本及实施状态，按钮和文字选择共用它。 */
export interface PlannerSuggestion {
  id?: string; // 旧备份中的单方案没有编号，读取时使用稳定的兼容编号。
  label?: string;
  title: string;
  instruction: string;
  scopeId: string | null;
  baseContentVersion: number;
  appliedAt?: string;
}

export interface PlannerMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  kind?: 'answer' | 'revision';
  /** 对话中附带的小红书参考摘要（不含原图）。 */
  attachments?: PlannerMessageAttachment[];
  /** 兼容旧消息；新消息使用 suggestions，每个方案分别实施。 */
  suggestion?: PlannerSuggestion;
  suggestions?: PlannerSuggestion[];
}

export interface PlannerRevision {
  version: number;
  savedAt: string;
  reason: string;
  content: PlannerContent;
}

export type PackingCategory = 'documents' | 'clothing' | 'medicine' | 'electronics' | 'bookings' | 'other';

export interface PackingItem {
  id: string;
  category: PackingCategory;
  name: string;
  note?: string;
  checked: boolean;
}

export interface PackingList {
  items: PackingItem[];
  updatedAt: string;
  generatedByAi?: boolean;
}

export interface PackingTemplate {
  id: string;
  name: string;
  items: Array<{ category: PackingCategory; name: string; note?: string }>;
  createdAt: string;
}

export type BookingKind = 'train' | 'flight' | 'hotel' | 'ticket' | 'other';

/** 车次、航班、酒店等结构化预订信息；截图只做瞬时识别，不保存在数据中。 */
export interface BookingRecord {
  id: string;
  kind: BookingKind;
  title: string;
  code: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  fromLocation: string;
  toLocation: string;
  city: string;
  hotelName: string;
  amountYuan: number | null;
  seatOrRoom: string;
  note: string;
  /** 车次/航班购票状态：未填或 'purchased' 表示已购买；'unpurchased' 表示计划乘坐但尚未购票，同步纳入抢票计划。 */
  purchaseStatus?: 'purchased' | 'unpurchased';
  backfilledToPlan?: boolean;
  backfilledToLedger?: boolean;
  internationalFlight?: boolean;
  stationLeadMinutes?: number;
  accessMinutes?: number;
  onwardMinutes?: number;
  /** 同一订单改签时沿用该卡片编号，并保存原预估交通段供移除订单后恢复。 */
  itineraryActivityId?: string;
  estimatedLeg?: { date: string; activity: PlannerActivity };
  createdAt: string;
}

export interface PlannerJournalVisit {
  /** 活动被改成另一个地点时，旧手账仍保留，新地点可单独确认。 */
  activityKey: string;
  tripId: string;
  placeId: string;
  completedAt: string;
}

export interface TicketReminderSetting {
  enabled: boolean;
  /** 提前多少分钟提醒（默认 20）。 */
  leadMinutes: number;
  /** 开售日期或时刻为空/需自定义时，可手动覆盖（YYYY-MM-DD / HH:mm）。 */
  customSaleDate?: string;
  customSaleTime?: string;
}

export interface AiTravelPlan {
  /** 行前打包与准备清单。 */
  packingList?: PackingList;
  /** 已导入或手动录入的车次、航班、酒店等预订信息（不含截图）。 */
  bookings?: BookingRecord[];
  /** 从小红书等攻略收藏到本行程的待选点位灵感池。 */
  wishlist?: WishlistPlace[];
  /** 日历提醒属于行程，独立于预算账本。 */
  reminderDays?: number;
  /** 地点键含日期，用户手动校正优先，不随AI内容改写丢失。 */
  mapPositions?: Record<string, import('./planner-map').PlannerMapPosition>;
  /** 用户选择的具体酒店独立于AI住宿建议，按晚保存。 */
  hotels?: Record<string, string>;
  /** 抢票计划与原行程分别保存；signature 用于提示日期或活动变更后重新查询。 */
  ticketPlan?: {
    signature: string;
    checkedAt: string;
    networkAvailable: boolean;
    items: Array<{
      activityId: string; title: string; travelDate: string;
      saleDate: string; saleTime: string; difficulty: string;
      platform: string; note: string;
      bookingRequired?: boolean;
      sources: Array<{ title: string; url: string }>;
    }>;
  };
  /** 抢票计划每一项的本地提醒设置，按 activityId 持久化。 */
  ticketReminders?: Record<string, TicketReminderSetting>;
  id: string;
  version: number;
  contentVersion?: number; // Questions do not invalidate an unchanged itinerary.
  createdAt: string;
  updatedAt: string;
  linkedTripId: string | null;
  /** Last explicit export permits safe conflict detection during synchronization. */
  linkedSnapshot: {
    title: string;
    startDate: string;
    endDate: string;
    cities: JourneyCity[];
    budget: Record<BudgetCategory, number>;
  } | null;
  content: PlannerContent;
  messages: PlannerMessage[];
  /** 攻略作为附加资料保存，不改变活动、锁定状态或行程内容版本。 */
  activityGuides?: Record<string, { text: string; createdAt: string }>;
  /** 已确认的景点到访和手账地点链接，独立于行程内容的修改和撤销。 */
  journalVisits?: Record<string, PlannerJournalVisit>;
  /** 两站之间自动补充的结构化交通方案（按起止点与出行方式键缓存），不改动原活动内容版本。 */
  legTransfers?: Record<string, PlannerTransferOption[]>;
  /** 用户在两站交通中点选的方案下标（选中后其余方案折叠，按路段/活动键持久化）。 */
  selectedTransfers?: Record<string, number>;
  history: PlannerRevision[];
}

export interface PlannerPreferences {
  id: 'planner';
  base: string;
  favorites: Array<{ title: string; destination: string; reason: string }>;
  /** 用户保存的个人行前清单模板，供后续行程一键套用。 */
  packingTemplates?: PackingTemplate[];
}

export interface DestinationRecommendation {
  title: string;
  destination: string;
  reason: string;
  season: string;
  suggestedDays: string;
  access: string;
  photo: PlannerPhoto | null;
  sourceIds: string[];
}

export interface PlannerBudget {
  totalCents: number;
  categories: Record<BudgetCategory, number>;
  unknownItems: string[];
  notes: string[];
  items: Array<{
    id: string;
    label: string;
    category: BudgetCategory;
    totalCents: number | null;
    explanation: string;
    status: PlannerCost['status'];
  }>;
}
