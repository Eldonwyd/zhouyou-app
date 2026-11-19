import { useEffect, useRef, useState } from 'react';
import { plannerActivitiesByTime, plannerDayCount, PLANNER_PERIODS } from '../planner-domain';
import { plannerDisplayText } from '../planner-display';
import type { PlannerContent } from '../planner-types';

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** 计划的日期和时段是墙上时间，直接与设备的本地年月日和时分比较。 */
function tripClock(now: Date) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  const minute = now.getMinutes();
  return {
    date: `${now.getFullYear()}-${twoDigits(month)}-${twoDigits(day)}`,
    time: `${twoDigits(hour)}:${twoDigits(minute)}`,
    label: `${month}/${day} ${twoDigits(hour)}:${twoDigits(minute)}`,
    dayProgress: (hour * 60 + minute) / 1440,
  };
}

/** 对齐整分钟更新。在手机切回页面或电脑唤醒后，直接重新读取设备时间。 */
function useDeviceClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    function refresh() {
      window.clearTimeout(timer);
      const current = new Date();
      setNow(current);
      timer = window.setTimeout(refresh, 60_000 - current.getTime() % 60_000);
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return tripClock(now);
}

export const plannerDayAnchor = (date: string) => `planner-day-${date}`;

/** 每天一个时间轴节点，状态信息按当天实际排入行程的活动切换。 */
export default function PlannerTripTimeline({ content }: { content: PlannerContent }) {
  const clock = useDeviceClock();
  const dayStrip = useRef<HTMLOListElement>(null);
  const todayNode = useRef<HTMLLIElement>(null);
  const firstDay = content.days[0];
  const lastDay = content.days.at(-1)!;
  const todayIndex = content.days.findIndex((day) => day.date === clock.date);
  const today = content.days[todayIndex];
  const daysUntil = clock.date < firstDay.date ? plannerDayCount(clock.date, firstDay.date) - 1 : 0;
  const ended = clock.date > lastDay.date;

  useEffect(() => {
    // 仅滚动日期栏。长行程也能自动找到今天，同时保留页面原来的阅读位置。
    const strip = dayStrip.current;
    const node = todayNode.current;
    if (!strip || !node) return;
    const offset = node.offsetLeft;
    if (offset < strip.scrollLeft) strip.scrollLeft = offset;
    else if (offset + node.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = offset + node.offsetWidth - strip.clientWidth;
    }
  }, [todayIndex, content.days.length]);

  let status = daysUntil === 1 ? '明天出发' : `还有 ${daysUntil} 天出发`;
  let detail = `首日 · ${plannerDisplayText(firstDay.title, content)}`;
  let mood = '🧳';
  if (ended) {
    status = '旅程已结束';
    detail = `${content.days.length} 天的旅程`;
    mood = '🏁';
  } else if (today) {
    const ordered = plannerActivitiesByTime(today.activities);
    const current = ordered.find((activity) => activity.startTime <= clock.time && clock.time < activity.endTime);
    const next = ordered.find((activity) => activity.startTime > clock.time);
    status = `第 ${todayIndex + 1} 天${current ? ` · ${PLANNER_PERIODS[current.period]}` : ''}`;
    mood = '📍';
    if (current) {
      detail = `当前安排 · ${current.startTime}–${current.endTime} ${plannerDisplayText(current.title, content)}`;
    } else if (next) {
      detail = `下一站 · ${next.startTime} ${plannerDisplayText(next.title, content)}`;
    } else {
      detail = ordered.length ? '今天的安排已结束' : '今天暂无定时安排';
    }
  }

  return (
    <section className="planner-trip-timeline" aria-label="旅程时间轴">
      <div className="planner-trip-clock">
        <div className="planner-trip-status">
          <span className="planner-trip-sticker" data-state={ended ? 'ended' : today ? 'today' : 'upcoming'} aria-hidden="true">{mood}</span>
          <div className="planner-trip-status-text">
            <h3>{status}</h3>
            <p>{detail}</p>
          </div>
        </div>
        <span className="planner-trip-device-time">
          设备时间 <time dateTime={`${clock.date}T${clock.time}`}>{clock.label}</time>
        </span>
      </div>
      <ol className="planner-trip-days" aria-label="按日期查看行程" ref={dayStrip}>
        {content.days.map((day, index) => {
          const isToday = index === todayIndex;
          const isPast = day.date < clock.date;
          const progress = isPast ? 1 : isToday ? clock.dayProgress : 0;
          return (
            <li key={day.date} ref={isToday ? todayNode : undefined}>
              <a
                className="planner-trip-day-link"
                data-stage={isToday ? 'today' : isPast ? 'past' : 'upcoming'}
                href={`#${plannerDayAnchor(day.date)}`}
                aria-current={isToday ? 'date' : undefined}
                title={plannerDisplayText(day.title, content)}
              >
                <span className="planner-trip-day-caption">
                  <span className="planner-trip-day-stamp" aria-hidden="true">{isPast ? '✓' : ''}</span>
                  <strong>第 {index + 1} 天</strong>
                  <time dateTime={day.date}>{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8, 10))}</time>
                </span>
                <span className="planner-trip-day-track" aria-hidden="true">
                  <span className="planner-trip-day-fill" style={{ width: `${progress * 100}%` }} />
                  {isToday && <span className="planner-trip-day-pin" style={{ left: `${progress * 100}%` }} />}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
