"use client";

import { motion } from "framer-motion";
import { calendarRangeV1, scheduleCalendarGroupsV1, type ScheduleCalendarView } from "../../../../../lib/schedule-calendar";
import { fadeIn, staggerContainer, transition } from "../../animations";
import { DAY_MS, dayKey, HOUR_MS } from "../../geometry";
import { ScheduleEntry } from "../../schedule-entry";
import type { CalendarViewProps } from "../../types";
import styles from "../../../schedule-calendar.module.css";

export function CalendarTimeGrid(props: CalendarViewProps & { view: Extract<ScheduleCalendarView, "day" | "week"> }) {
  const range = calendarRangeV1(props.date, props.view);
  const days = Array.from({ length: (range.end - range.start) / DAY_MS }, (_, index) => range.start + index * DAY_MS);
  return <motion.div data-slot={props.view === "day" ? "calendar-day-view" : "calendar-week-view"} className={styles.timeView}
    initial="initial" animate="animate" variants={fadeIn} transition={transition}>
    {props.view === "week" && <div className={styles.smallScreenWarning}>Weekly view is best on a wider screen. Scroll horizontally to retain all seven days.</div>}
    <div className={styles.timeGrid} data-week={props.view === "week"}>
      <div className={styles.timeGridHeader}><span />{days.map((day, index) => <motion.button type="button" key={day}
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, ...transition }}
        onClick={() => props.onDate(dayKey(day), "day")}>
        <small>{new Date(day).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</small>
        <b data-today={dayKey(day) === dayKey(Date.now())}>{new Date(day).getUTCDate()}</b>
      </motion.button>)}</div>
      <motion.div className={styles.timeRows} variants={staggerContainer}>
        {Array.from({ length: 24 }, (_, hour) => <div className={styles.timeRow} key={hour}>
          <time>{hour === 0 ? "UTC" : `${String(hour).padStart(2, "0")}:00`}</time>
          {days.map((day) => {
            const start = day + hour * HOUR_MS;
            const groups = scheduleCalendarGroupsV1(props.schedules, start, start + HOUR_MS);
            return <div className={styles.timeCell} key={day}>
              <span className={styles.halfHourLine} aria-hidden="true" />
              {groups.length > 0 && <div className={styles.timeEvents}>{groups.slice(0, 3).map((group, index) => <ScheduleEntry
                key={`${group.schedule_identity}-${group.kind}`} group={group} groups={groups} index={index}
                label={`${dayKey(start)} ${String(hour).padStart(2, "0")}:00 UTC`} selectedIdentity={props.selectedIdentity}
                compact={props.compact} onInspect={props.onInspect} />)}
                {groups.length > 3 && <button type="button" className={styles.timeMore}
                  onClick={() => props.onInspect(`${dayKey(start)} ${String(hour).padStart(2, "0")}:00 UTC`, groups)}>
                  +{groups.length - 3}
                </button>}
              </div>}
            </div>;
          })}
        </div>)}
      </motion.div>
    </div>
  </motion.div>;
}
