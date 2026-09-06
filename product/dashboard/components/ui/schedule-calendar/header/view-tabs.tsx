"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ScheduleCalendarView } from "../../../../lib/schedule-calendar";
import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

const calendarViews = [
  ["agenda", "Agenda", InterfaceIcons.calendarAgenda],
  ["day", "Day", InterfaceIcons.calendarDay],
  ["week", "Week", InterfaceIcons.calendarWeek],
  ["month", "Month", InterfaceIcons.calendarMonth],
  ["year", "Year", InterfaceIcons.calendarYear],
] as const;

export function Views({ view, mode, onView }: {
  view: ScheduleCalendarView;
  mode: "calendar" | "table";
  onView: (view: ScheduleCalendarView) => void;
}) {
  return <div className={styles.viewTabs} role="group" aria-label="Calendar view">
    {calendarViews.map(([value, label, Icon]) => {
      const active = mode === "calendar" && view === value;
      return <motion.button type="button" key={value} aria-label={`${label} view`} aria-pressed={active}
        initial={false} animate={{ width: active ? 120 : 32 }}
        transition={{ type: "tween", duration: 0.25, ease: "easeOut" }} onClick={() => onView(value)}>
        <Icon size={16} aria-hidden="true" />
        <AnimatePresence initial={false}>{active ? <motion.span
          initial={{ opacity: 0, scaleX: 0.8 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}>
          {label}
        </motion.span> : null}</AnimatePresence>
      </motion.button>;
    })}
  </div>;
}
