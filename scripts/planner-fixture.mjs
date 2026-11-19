import { freshPlannerRequest } from '../src/planner-domain.ts';

/** A realistic multi-city fixture with mixed travelers and shared resources. */
export function plannerFixture() {
  const request = {
    ...freshPlannerRequest('丽江、香格里拉', '昆明'),
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    days: 3,
    people: 3,
    students: 1,
    rooms: null,
    skipBreakfast: true,
    foodMode: true,
  };
  const cost = (id, label, category, unit, unitPriceCents, extra = {}) => ({
    id,
    label,
    category,
    unit,
    unitPriceCents,
    studentPriceCents: null,
    quantity: 1,
    occurrences: 1,
    status: unitPriceCents === null ? 'unknown' : 'estimate',
    qualification: '',
    sourceIds: [],
    includedIn: null,
    ...extra,
  });
  const activity = (id, title, kind, startTime, endTime, costs = [], extra = {}) => ({
    id,
    title,
    kind,
    startTime,
    endTime,
    period: 'morning',
    city: '丽江市',
    location: title,
    description: '预留步行与休息时间',
    transportMode: '',
    meal: null,
    locked: false,
    photo: null,
    sourceIds: ['official'],
    costs,
    fromActivityId: null,
    toActivityId: null,
    ...extra,
  });
  const lodging = (id) => ({
    city: '丽江市',
    area: '古城南门附近',
    searchKeyword: '丽江古城南门',
    reason: '便于前往车站和古城',
    costs: [cost(id, '住宿', 'lodging', 'room', 20000)],
    sourceIds: [],
  });
  return {
    title: '丽江与香格里拉三日',
    summary: '两天丽江，第三天乘火车去香格里拉。',
    request,
    cities: [
      { code: '530700', name: '丽江市', provinceCode: '530000' },
      { code: '533400', name: '迪庆藏族自治州', provinceCode: '530000' },
    ],
    constraints: ['不吃早餐', '前两天丽江'],
    warnings: ['铁路班次和学生优惠请出发前核实'],
    days: [
      {
        date: '2026-12-01',
        title: '丽江古城',
        weather: '冬季气候参考，非当日预报',
        activities: [
          activity('sight-1', '丽江古城', 'sight', '09:00', '11:00', [
            cost('ticket-1', '景点票', 'tickets', 'ticket', 10000, { studentPriceCents: 5000 }),
          ]),
          activity(
            'food-1',
            '午餐',
            'food',
            '12:00',
            '13:00',
            [cost('food-1', '午餐', 'food', 'person', 4000)],
            { period: 'noon', meal: 'lunch' },
          ),
        ],
        lodging: lodging('room-1'),
      },
      {
        date: '2026-12-02',
        title: '丽江慢游',
        weather: '远期天气待确认',
        activities: [
          activity('sight-2', '束河古镇', 'sight', '09:00', '11:00', [
            cost('taxi-1', '打车', 'transport', 'vehicle', 6000),
          ]),
          activity(
            'food-2',
            '午餐',
            'food',
            '12:00',
            '13:00',
            [cost('food-2', '午餐', 'food', 'person', 4000)],
            { period: 'noon', meal: 'lunch' },
          ),
        ],
        lodging: lodging('room-2'),
      },
      {
        date: '2026-12-03',
        title: '火车去香格里拉',
        weather: '高原冬季保暖',
        activities: [
          activity(
            'train-1',
            '丽江至香格里拉',
            'transport',
            '09:00',
            '11:00',
            [cost('train-1', '铁路票', 'transport', 'person', 8000)],
            {
              transportMode: '火车，含进出站及接驳',
              fromActivityId: 'sight-2',
              toActivityId: 'sight-3',
            },
          ),
          activity(
            'sight-3',
            '独克宗古城',
            'sight',
            '11:30',
            '12:00',
            [cost('pending-1', '待确认体验', 'other', 'group', null)],
            { city: '香格里拉市' },
          ),
          activity(
            'food-3',
            '藏式午餐',
            'food',
            '12:00',
            '13:00',
            [cost('food-3', '午餐', 'food', 'person', 4000)],
            { period: 'noon', meal: 'lunch', city: '香格里拉市' },
          ),
        ],
        lodging: null,
      },
    ],
    alternatives: [
      { title: '博物馆', city: '丽江', reason: '雨天备选，确认后再替换', rainyDay: true },
    ],
    sources: [
      {
        id: 'official',
        title: '景点参考',
        url: 'https://www.lijiang.gov.cn/',
        checkedAt: '2026-11-10T12:00:00Z',
      },
    ],
  };
}

export function aiPlanFixture() {
  return {
    id: 'planner-fixture',
    version: 1,
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-10T12:00:00Z',
    linkedTripId: null,
    linkedSnapshot: null,
    content: plannerFixture(),
    history: [],
    messages: [],
  };
}
