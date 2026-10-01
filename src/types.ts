export type PageName = 'map' | 'detail' | 'plan' | 'achievements' | 'profile';
export type VisitStatus = 'empty' | 'planned' | 'visited';
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'all-day';
export type MediaKind = 'photo' | 'video' | 'audio';
export type BudgetCategory = 'transport' | 'lodging' | 'tickets' | 'food' | 'other';
export type CategoryAmounts = Record<BudgetCategory, number>;

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
  tripId: string;
  placeId: string;
  date: string;
  period: DayPeriod;
  note: string;
  place: string;
  order: number;
  highlight: boolean;
}

export interface TripPlan {
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
}

export interface TravelMedia {
  id: string;
  cityCode: string;
  tripId: string;
  placeId: string;
  entryId: string | null;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  capturedAt: string;
  placeName: string;
  latitude: number | null;
  longitude: number | null;
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

/** Places belong to a particular journey and city, so repeat visits stay distinct. */
export interface JourneyPlace {
  id: string;
  tripId: string;
  cityCode: string;
  name: string;
  reviewText: string;
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
}

export interface AppSnapshot {
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
