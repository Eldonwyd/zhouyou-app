import { useEffect, useRef, useState } from 'react';
import { plannerActivitiesByTime, plannerDayCount, PLANNER_PERIODS } from '../planner-domain';
import { plannerDisplayText } from '../planner-display';
import type { PlannerContent } from '../planner-types';

type TripTimelineState = 'upcoming' | 'today' | 'ended';

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

/** 可爱手绘风状态小贴纸：替代系统原生 Emoji，在不同主题与设备上均保持灵动统一。 */
function TripStickerArt({ state }: { state: TripTimelineState }) {
  if (state === 'ended') {
    return (
      <svg className="planner-trip-sticker-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* 丝带飘尾 */}
        <path d="M22 41 16 58l9-4 5 5 3-15" fill="#7ec99e" stroke="#4a372d" strokeWidth="2.1" strokeLinejoin="round" />
        <path d="M42 41 48 58l-9-4-5 5-3-15" fill="#f58b77" stroke="#4a372d" strokeWidth="2.1" strokeLinejoin="round" />
        {/* 纪念花边小勋章 */}
        <circle cx="32" cy="28" r="19" fill="#ffe07d" stroke="#4a372d" strokeWidth="2.2" />
        <circle cx="32" cy="28" r="14.5" fill="#fff5cc" stroke="#f0b643" strokeWidth="1.5" strokeDasharray="3 2.5" />
        {/* 开心小表情 */}
        <circle cx="26.5" cy="26.5" r="2.2" fill="#4a372d" />
        <circle cx="37.5" cy="26.5" r="2.2" fill="#4a372d" />
        <circle cx="27.2" cy="25.8" r="0.8" fill="#ffffff" />
        <circle cx="38.2" cy="25.8" r="0.8" fill="#ffffff" />
        <ellipse cx="22.5" cy="30" rx="2.9" ry="1.8" fill="#f58b77" opacity="0.65" />
        <ellipse cx="41.5" cy="30" rx="2.9" ry="1.8" fill="#f58b77" opacity="0.65" />
        <path d="M28.8 31.2c1.4 2.1 5 2.1 6.4 0" stroke="#4a372d" strokeWidth="2" strokeLinecap="round" />
        {/* 彩色彩带小星点 */}
        <path d="M53 9l1.4 3.2L57.6 13.6l-3.2 1.4L53 18.2l-1.4-3.2-3.2-1.4 3.2-1.4Z" fill="#f58b77" />
        <circle cx="11" cy="14" r="2.6" fill="#7ab8eb" />
        <circle cx="55" cy="34" r="2.2" fill="#7ec99e" />
      </svg>
    );
  }
  if (state === 'today') {
    return (
      <svg className="planner-trip-sticker-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* 小白云 */}
        <path d="M6 48c2.2-3.2 7.2-3.4 9.8-.5 2.2-1.6 5.4-.6 6.4 2H5c0-.6.4-1.1 1-1.5Z" fill="#ffffff" opacity="0.92" />
        <path d="M45 20c1.8-2.6 5.8-2.8 8-.4 1.8-1.3 4.4-.5 5.2 1.6H44c0-.5.3-.9 1-1.2Z" fill="#ffffff" opacity="0.9" />
        {/* 热气球主体 */}
        <path d="M32 7c11.8 0 19.5 8.5 19.5 18.8 0 9-6.6 16.5-12.5 20.2H25c-5.9-3.7-12.5-11.2-12.5-20.2C12.5 15.5 20.2 7 32 7Z" fill="#ff8f7a" stroke="#4a372d" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M32 7c5.4 0 9.6 8.5 9.6 18.8 0 9-3.2 16.5-6.1 20.2h-7c-2.9-3.7-6.1-11.2-6.1-20.2C22.4 15.5 26.6 7 32 7Z" fill="#ffe07d" />
        <path d="M32 7c5.4 0 9.6 8.5 9.6 18.8 0 9-3.2 16.5-6.1 20.2h-7c-2.9-3.7-6.1-11.2-6.1-20.2C22.4 15.5 26.6 7 32 7Z" stroke="#4a372d" strokeWidth="1.6" strokeLinejoin="round" opacity="0.35" />
        {/* 微笑脸 */}
        <circle cx="27.2" cy="24.5" r="2.1" fill="#4a372d" />
        <circle cx="36.8" cy="24.5" r="2.1" fill="#4a372d" />
        <circle cx="27.9" cy="23.8" r="0.75" fill="#ffffff" />
        <circle cx="37.5" cy="23.8" r="0.75" fill="#ffffff" />
        <ellipse cx="23.5" cy="28" rx="2.6" ry="1.6" fill="#ff6b6b" opacity="0.55" />
        <ellipse cx="40.5" cy="28" rx="2.6" ry="1.6" fill="#ff6b6b" opacity="0.55" />
        <path d="M29.2 29.2c1.2 1.8 4.4 1.8 5.6 0" stroke="#4a372d" strokeWidth="1.9" strokeLinecap="round" />
        {/* 吊篮与绳索 */}
        <path d="M27.5 46v5.5M36.5 46v5.5" stroke="#4a372d" strokeWidth="2" strokeLinecap="round" />
        <rect x="25" y="51" width="14" height="8" rx="3" fill="#d99a5b" stroke="#4a372d" strokeWidth="2" />
        {/* 小闪星 */}
        <path d="M12 12l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2Z" fill="#ffd166" />
      </svg>
    );
  }
  return (
    <svg className="planner-trip-sticker-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {/* 拉杆与提手 */}
      <path d="M24 20v-5a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v5" stroke="#4a372d" strokeWidth="2.6" strokeLinecap="round" />
      {/* 小轮子 */}
      <circle cx="21" cy="54.5" r="3.4" fill="#4a372d" />
      <circle cx="43" cy="54.5" r="3.4" fill="#4a372d" />
      {/* 圆润可爱行李箱 */}
      <rect x="13" y="19" width="38" height="33" rx="10" fill="#ffd97d" stroke="#4a372d" strokeWidth="2.2" />
      <path d="M21 20v31M43 20v31" stroke="#ebb042" strokeWidth="2" opacity="0.55" />
      {/* 微笑脸 */}
      <circle cx="26.5" cy="33.5" r="2.2" fill="#4a372d" />
      <circle cx="37.5" cy="33.5" r="2.2" fill="#4a372d" />
      <circle cx="27.2" cy="32.8" r="0.8" fill="#ffffff" />
      <circle cx="38.2" cy="32.8" r="0.8" fill="#ffffff" />
      <ellipse cx="22.4" cy="37.2" rx="2.8" ry="1.7" fill="#f58473" opacity="0.7" />
      <ellipse cx="41.6" cy="37.2" rx="2.8" ry="1.7" fill="#f58473" opacity="0.7" />
      <path d="M29 38.4c1.3 1.9 4.7 1.9 6 0" stroke="#4a372d" strokeWidth="2" strokeLinecap="round" />
      {/* 斜贴小旅行贴纸 */}
      <rect x="35" y="40" width="11" height="7" rx="2.5" transform="rotate(-11 40 43)" fill="#7ec99e" stroke="#4a372d" strokeWidth="1.5" />
      {/* 闪星 */}
      <path d="M54 11l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3Z" fill="#ff8f7a" />
      <circle cx="10" cy="14" r="2.3" fill="#7ab8eb" />
    </svg>
  );
}

/** 轻量天空手账底纹：极简纯白风下通过 .cute-deco 自动隐藏。 */
function TripSkyDoodle() {
  return (
    <svg className="planner-trip-sky-doodle cute-deco" viewBox="0 0 240 72" fill="none" aria-hidden="true">
      <path d="M12 56c32-24 72-32 112-16 28 11 54 4 74-14" stroke="currentColor" strokeWidth="1.8" strokeDasharray="4 6" strokeLinecap="round" opacity="0.45" />
      {/* 纸飞机 */}
      <path d="M196 23l22-11-11 22-4-7-7-4Z" fill="var(--tl-peach-ink, var(--coral))" opacity="0.55" />
      <path d="M203 27l15-15" stroke="var(--surface)" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      {/* 软萌小云朵 */}
      <path d="M74 20c3-4 9.5-4.5 13-1 3-2 7.5-1 8.8 2.5H71.5c.3-1 1.2-1.3 2.5-1.5Z" fill="var(--surface)" opacity="0.75" />
      {/* 星星点缀 */}
      <path d="M148 16l1.5 3.3 3.3 1.5-3.3 1.5-1.5 3.3-1.5-3.3-3.3-1.5 3.3-1.5Z" fill="var(--tl-honey-ink, var(--app-honey-ink))" opacity="0.55" />
      <circle cx="48" cy="24" r="2.4" fill="var(--tl-sky-ink, var(--app-blue-ink))" opacity="0.4" />
      <circle cx="174" cy="48" r="2" fill="var(--tl-mint-ink, var(--app-sage-ink))" opacity="0.45" />
    </svg>
  );
}

/** 每天一张专属可爱小手账徽标，循环呈现阳光、相机、山景、小风帆，让日程卡更生动。 */
function DayMiniArt({ index }: { index: number }) {
  const variant = index % 4;
  if (variant === 0) {
    // 暖阳小云朵
    return (
      <svg className="planner-trip-day-art" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="15" cy="9" r="5" fill="#ffd166" />
        <path d="M15 2v1.6M20.2 4.2l-1.1 1.1M22 9h-1.6M9.8 4.2l1.1 1.1" stroke="#f0a830" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M5.5 18.5h10.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1A3.4 3.4 0 0 0 5.5 18.5Z" fill="#ffffff" stroke="#5fa87c" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 1) {
    // 微笑小相机
    return (
      <svg className="planner-trip-day-art" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 7 10 5h4l1.5 2H19a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V9.5A2.5 2.5 0 0 1 5 7h3.5Z" fill="#8cc9f5" stroke="#3670a6" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="12" cy="13.2" r="3.6" fill="#ffffff" stroke="#3670a6" strokeWidth="1.5" />
        <circle cx="12" cy="13.2" r="1.4" fill="#ffd166" />
        <circle cx="17.4" cy="10.2" r="1" fill="#fff3c4" />
      </svg>
    );
  }
  if (variant === 2) {
    // 远山与红顶小屋/松树
    return (
      <svg className="planner-trip-day-art" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="17.5" cy="7" r="2.6" fill="#ffd166" />
        <path d="M2.5 18.5 9.2 8.2 14 14.8l2.5-3.3 5 7H2.5Z" fill="#ff9e8a" stroke="#b84c3a" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7.3 11.1 9.2 8.2l2.1 2.9-1.1.8-1-1-1 .9-.9-.7Z" fill="#ffffff" />
      </svg>
    );
  }
  // 彩虹小星帆/气球
  return (
    <svg className="planner-trip-day-art" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5c4 0 6.8 3 6.8 6.8 0 3.4-2.5 6.2-4.6 7.4H9.8C7.7 16.5 5.2 13.7 5.2 10.3 5.2 6.5 8 3.5 12 3.5Z" fill="#c39ef5" stroke="#6c49a3" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 3.5c1.9 0 3.2 3 3.2 6.8 0 3.4-1.1 6.2-2 7.4h-2.4c-.9-1.2-2-4-2-7.4 0-3.8 1.3-6.8 3.2-6.8Z" fill="#ffe07d" />
      <rect x="9.5" y="19" width="5" height="2.6" rx="1" fill="#d99a5b" stroke="#6c49a3" strokeWidth="1.2" />
    </svg>
  );
}

export const plannerDayAnchor = (date: string) => `planner-day-${date}`;

/** 每天一个时间轴节点，状态信息按当天实际排入行程的活动切换。 */
export default function PlannerTripTimeline({
  content,
  onSelectDay,
}: {
  content: PlannerContent;
  onSelectDay?: (date: string) => void;
}) {
  const clock = useDeviceClock();
  const dayStrip = useRef<HTMLOListElement>(null);
  const todayNode = useRef<HTMLLIElement>(null);
  const firstDay = content.days[0];
  const lastDay = content.days.at(-1)!;
  const todayIndex = content.days.findIndex((day) => day.date === clock.date);
  const today = content.days[todayIndex];
  const daysUntil = clock.date < firstDay.date ? plannerDayCount(clock.date, firstDay.date) - 1 : 0;
  const ended = clock.date > lastDay.date;
  const state: TripTimelineState = ended ? 'ended' : today ? 'today' : 'upcoming';

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
  let stateBadge = daysUntil === 1 ? '明日启程' : '出发倒计时';
  if (ended) {
    status = '旅程已结束';
    detail = `${content.days.length} 天的旅程`;
    stateBadge = '圆满打卡';
  } else if (today) {
    const ordered = plannerActivitiesByTime(today.activities);
    const current = ordered.find((activity) => activity.startTime <= clock.time && clock.time < activity.endTime);
    const next = ordered.find((activity) => activity.startTime > clock.time);
    status = `第 ${todayIndex + 1} 天${current ? ` · ${PLANNER_PERIODS[current.period]}` : ''}`;
    stateBadge = '旅途进行中';
    if (current) {
      detail = `当前安排 · ${current.startTime}–${current.endTime} ${plannerDisplayText(current.title, content)}`;
    } else if (next) {
      detail = `下一站 · ${next.startTime} ${plannerDisplayText(next.title, content)}`;
    } else {
      detail = ordered.length ? '今天的安排已结束' : '今天暂无定时安排';
    }
  }

  return (
    <section className="planner-trip-timeline" data-state={state} aria-label="旅程时间轴">
      <TripSkyDoodle />
      <div className="planner-trip-clock">
        <div className="planner-trip-status">
          <span className="planner-trip-sticker" data-state={state} aria-hidden="true">
            <TripStickerArt state={state} />
          </span>
          <div className="planner-trip-status-text">
            <div className="planner-trip-title-row">
              <h3>{status}</h3>
              <span className="planner-trip-state-pill" data-state={state} aria-hidden="true">
                {stateBadge}
              </span>
            </div>
            <p>{detail}</p>
          </div>
        </div>
        <span className="planner-trip-device-time">
          <svg className="planner-trip-clock-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.8V8.2L10.3 9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>设备时间</span>
          <time dateTime={`${clock.date}T${clock.time}`}>{clock.label}</time>
        </span>
      </div>
      <ol className="planner-trip-days" data-count={content.days.length} aria-label="按日期查看行程" ref={dayStrip}>
        {content.days.map((day, index) => {
          const isToday = index === todayIndex;
          const isPast = day.date < clock.date;
          const stage = isToday ? 'today' : isPast ? 'past' : 'upcoming';
          const progress = isPast ? 1 : isToday ? clock.dayProgress : 0;
          const pinPercent = Math.min(93, Math.max(7, progress * 100));
          const dayTitle = plannerDisplayText(day.title, content);
          return (
            <li key={day.date} ref={isToday ? todayNode : undefined}>
              <a
                className="planner-trip-day-link"
                data-stage={stage}
                data-palette={index % 4}
                href={`#${plannerDayAnchor(day.date)}`}
                aria-current={isToday ? 'date' : undefined}
                title={dayTitle}
                onClick={(event) => {
                  if (!onSelectDay) return;
                  event.preventDefault();
                  onSelectDay(day.date);
                }}
              >
                <span className="planner-trip-day-head">
                  <span className="planner-trip-day-stamp" aria-hidden="true">
                    {isPast ? (
                      <svg viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6.3 5 8.8 9.6 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : isToday ? (
                      <span className="planner-trip-live-dot" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </span>
                  <strong className="planner-trip-day-num">第 {index + 1} 天</strong>
                  <time dateTime={day.date}>{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8, 10))}</time>
                </span>
                <span className="planner-trip-day-body">
                  <span className="planner-trip-day-meta">
                    <DayMiniArt index={index} />
                    <span className="planner-trip-day-title">{dayTitle}</span>
                    <strong className="planner-trip-day-num-mobile" aria-hidden="true">第 {index + 1} 天</strong>
                  </span>
                  <span className="planner-trip-day-track" aria-hidden="true">
                    <span className="planner-trip-day-fill" style={{ width: `${progress * 100}%` }} />
                    {isToday && <span className="planner-trip-day-pin" style={{ left: `${pinPercent}%` }} />}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
