/** 旧计划没有结构化预约标记时，识别明确的“无需预约”结论；规则未知仍保留。 */
export function needsTicketPreparation(item: { bookingRequired?: boolean; platform: string; note: string }): boolean {
  if (typeof item.bookingRequired === 'boolean') return item.bookingRequired;
  return !/无需预约|不需预约|不需要预约|无需抢票|无需购票|无门票与预约环节/.test(`${item.platform} ${item.note}`);
}
