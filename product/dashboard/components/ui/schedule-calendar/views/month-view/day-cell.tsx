"use client";

import { motion } from "framer-motion";
import { scheduleCalendarGroupsV1 } from "../../../../../lib/schedule-calendar";
import { transition } from "../../animations";
import { DAY_MS, dayKey } from "../../geometry";
import { ScheduleEntry } from "../../schedule-entry";
import type { CalendarViewProps } from "../../types";
import styles from "../../../schedule-calendar.module.css";

const MAX_VISIBLE_EVENTS = 3;

export function DayCell({ value, rangeStart, rangeEnd, schedules, selectedIdentity, compact, onDate, onInspect }: CalendarViewProps & {
  value: number;
  rangeStart: number;
  rangeEnd: number;
}) {
  const label = dayKey(value);
  const groups = scheduleCalendarGroupsV1(schedules, value, value + DAY_MS);
  const outside = value < rangeStart || value >= rangeEnd;
  return <motion.section className={styles.dayCell} data-slot="calendar-day-cell" data-outside={outside}
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
    <button type="button" className={styles.dateNumber} data-today={label === dayKey(Date.now())}
      aria-label={`Open ${label}`} onClick={() => onDate(label, "day")}>
      {new Date(value).getUTCDate()}
    </button>
    <div className={styles.dayEvents}>
      {groups.slice(0, MAX_VISIBLE_EVENTS).map((group, index) => <ScheduleEntry
        key={`${group.schedule_identity}-${group.kind}`} group={group} groups={groups} index={index}
        label={`${label} UTC`} selectedIdentity={selectedIdentity} compact={compact} onInspect={onInspect} />)}
    </div>
    {groups.length > MAX_VISIBLE_EVENTS && <motion.button type="button" className={styles.moreEvents}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, ...transition }}
      aria-label={`Show ${groups.length - MAX_VISIBLE_EVENTS} more schedule groups on ${label}`}
      onClick={() => onInspect(`${label} UTC`, groups)}>
      {groups.length - MAX_VISIBLE_EVENTS} <span>more…</span>
    </motion.button>}
  </motion.section>;
}
