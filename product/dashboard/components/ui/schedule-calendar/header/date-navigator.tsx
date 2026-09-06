"use client";

import { AnimatePresence, motion } from "framer-motion";
import { calendarRangeV1, type ScheduleCalendarView } from "../../../../lib/schedule-calendar";
import { InterfaceIcons } from "../../iconography";
import { buttonHover, transition } from "../animations";
import styles from "../../schedule-calendar.module.css";

function monthHeading(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function compactRange(start: number, end: number): string {
  const format = (value: number) => new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format(start)} - ${format(end - 1)}`;
}

export function DateNavigator({ date, view, statusLabel, onShift }: {
  date: string;
  view: ScheduleCalendarView;
  statusLabel: string;
  onShift: (offset: number) => void;
}) {
  const range = calendarRangeV1(date, view);
  return <div className={styles.dateNavigator}>
    <div className={styles.headingLine}>
      <motion.h3 initial={false} animate={{ x: 0, opacity: 1 }} transition={transition}>
        {monthHeading(date)}
      </motion.h3>
      <AnimatePresence mode="wait">
        <motion.span key={statusLabel} initial={false} animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }} transition={transition}>
          {statusLabel}
        </motion.span>
      </AnimatePresence>
    </div>
    <div className={styles.rangeNavigator}>
      <motion.button type="button" aria-label="Previous range" onClick={() => onShift(-1)}
        variants={buttonHover} whileHover="hover" whileTap="tap">
        <InterfaceIcons.previous size={15} aria-hidden="true" />
      </motion.button>
      <motion.p key={`${range.start}-${range.end}`} initial={false} animate={{ opacity: 1 }} transition={transition}>
        {compactRange(range.start, range.end)}
      </motion.p>
      <motion.button type="button" aria-label="Next range" onClick={() => onShift(1)}
        variants={buttonHover} whileHover="hover" whileTap="tap">
        <InterfaceIcons.next size={15} aria-hidden="true" />
      </motion.button>
    </div>
  </div>;
}
