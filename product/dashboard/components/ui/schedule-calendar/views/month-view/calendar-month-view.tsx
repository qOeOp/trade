"use client";

import { motion } from "framer-motion";
import { calendarRangeV1 } from "../../../../../lib/schedule-calendar";
import { staggerContainer, transition } from "../../animations";
import { DAY_MS, fullWeekRange, WEEK_DAYS } from "../../geometry";
import type { CalendarViewProps } from "../../types";
import { DayCell } from "./day-cell";
import styles from "../../../schedule-calendar.module.css";

export function CalendarMonthView(props: CalendarViewProps) {
  const range = calendarRangeV1(props.date, "month");
  const grid = fullWeekRange(range.start, range.end);
  return <motion.div data-slot="calendar-month-view" initial="initial" animate="animate" variants={staggerContainer}
    className={styles.monthView}>
    <div className={styles.weekdayHeader}>{WEEK_DAYS.map((day, index) => <motion.span key={day}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, ...transition }}>{day}</motion.span>)}</div>
    <div className={styles.monthGrid}>{Array.from({ length: (grid.end - grid.start) / DAY_MS }, (_, index) =>
      <DayCell key={grid.start + index * DAY_MS} value={grid.start + index * DAY_MS}
        rangeStart={range.start} rangeEnd={range.end} {...props} />)}</div>
  </motion.div>;
}
