/** 12306 的 15 天预售期含乘车日；使用 UTC 日历运算避免时区导致跨日。 */
export function railwaySaleDate(travelDate) {
  const date = new Date(`${travelDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

/** 开售时间未知的项目排在末尾；同一时间优先展示难抢项目。 */
export function sortTicketItems(items) {
  return [...items].sort((left, right) =>
    `${left.saleDate || '9999'} ${left.saleTime || '99:99'}`.localeCompare(`${right.saleDate || '9999'} ${right.saleTime || '99:99'}`)
    || Number(right.difficulty === '难') - Number(left.difficulty === '难'));
}

/** 铁路日期由程序计算，模型只补充难度与依据，不让模型心算预售期。 */
export function railwayTicketItems(content) {
  return content.days.flatMap((day) => day.activities.filter((activity) =>
    activity.kind === 'transport' && /高铁|动车|火车|城际|列车|铁路/.test(`${activity.title} ${activity.transportMode} ${activity.description}`)
    && !/地铁/.test(activity.transportMode)
  ).map((activity) => ({
    activityId: activity.id, title: activity.title, travelDate: day.date,
    saleDate: railwaySaleDate(day.date), saleTime: '', difficulty: '待核实',
    platform: '铁路12306', note: '预售期15天（含当日）；具体起售时刻请在12306查询，临时调整以官方公告为准。',
    sources: [{ title: '12306 预售期说明', url: 'https://help.12306.cn/cms/answer/h5/001531826595438842083440b580b2e0' }],
  })));
}
