"use client";

import { motion } from "framer-motion";
import { scheduleCalendarGroupsV1 } from "../../../../../lib/schedule-calendar";
import { staggerContainer, transition } from "../../animations";
import { DAY_MS, dayKey, fullWeekRange, WEEK_DAYS } from "../../geometry";
import type { CalendarViewProps } from "../../types";
import styles from "../../../schedule-calendar.module.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function CalendarYearView(props: CalendarViewProps) {
  const year = Number(props.date.slice(0, 4));
  return <motion.div data-slot="calendar-year-view" className={styles.yearView}
    initial="initial" animate="animate" variants={staggerContainer}>
    {MONTHS.map((month, monthIndex) => {
      const start = Date.UTC(year, monthIndex, 1);
      const end = Date.UTC(year, monthIndex + 1, 1);
      const grid = fullWeekRange(start, end);
      return <motion.section key={month} className={styles.yearMonth}
        initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: monthIndex * .035, ...transition }} aria-label={`${month} ${year} calendar`}>
        <button type="button" className={styles.yearMonthTitle} onClick={() => props.onDate(dayKey(start), "month")}>{month}</button>
        <div className={styles.yearWeekdays}>{WEEK_DAYS.map((day) => <span key={day}>{day.slice(0, 2)}</span>)}</div>
        <div className={styles.miniMonth}>{Array.from({ length: (grid.end - grid.start) / DAY_MS }, (_, index) => {
          const value = grid.start + index * DAY_MS;
          const inMonth = value >= start && value < end;
          const groups = inMonth ? scheduleCalendarGroupsV1(props.schedules, value, value + DAY_MS) : [];
          const expected = groups.filter((group) => group.kind === "expected").length;
          const observed = groups.filter((group) => group.kind === "observed").length;
          const label = `${dayKey(value)}: ${expected} expected groups, ${observed} observed runs`;
          return <button type="button" key={value} className={styles.miniDate} data-outside={!inMonth}
            data-today={dayKey(value) === dayKey(Date.now())} aria-label={label}
            onClick={() => groups.length ? props.onInspect(`${dayKey(value)} UTC`, groups) : props.onDate(dayKey(value), "day")}>
            <span>{new Date(value).getUTCDate()}</span><span className={styles.eventDots} aria-hidden="true">
              {expected > 0 && <i data-kind="expected" />}{observed > 0 && <i data-kind="observed" />}
            </span>
          </button>;
        })}</div>
      </motion.section>;
    })}
  </motion.div>;
}
