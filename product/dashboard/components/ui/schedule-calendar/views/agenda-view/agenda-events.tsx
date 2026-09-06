"use client";

import { motion } from "framer-motion";
import { calendarRangeV1, scheduleCalendarGroupsV1 } from "../../../../../lib/schedule-calendar";
import { staggerContainer, transition } from "../../animations";
import { DAY_MS, dayKey } from "../../geometry";
import { ScheduleEntry } from "../../schedule-entry";
import type { CalendarViewProps } from "../../types";
import styles from "../../../schedule-calendar.module.css";

export function AgendaEvents(props: CalendarViewProps) {
  const range = calendarRangeV1(props.date, "agenda");
  const days = Array.from({ length: (range.end - range.start) / DAY_MS }, (_, index) => range.start + index * DAY_MS)
    .map((value) => ({ value, groups: scheduleCalendarGroupsV1(props.schedules, value, value + DAY_MS) }))
    .filter(({ groups }) => groups.length > 0);
  return <motion.div data-slot="calendar-agenda-view" className={styles.agendaView}
    initial="initial" animate="animate" variants={staggerContainer}>
    {days.length === 0 ? <div className={styles.agendaEmpty}>No entries in this month.</div> : days.map(({ value, groups }, dayIndex) => {
      const label = dayKey(value);
      return <motion.section key={value} className={styles.agendaDay}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: dayIndex * .025, ...transition }}>
        <button type="button" className={styles.agendaDate} onClick={() => props.onDate(label, "day")}>
          <b>{new Date(value).toLocaleDateString("en", { weekday: "long", timeZone: "UTC" })}</b>
          <span>{new Date(value).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
        </button>
        <div className={styles.agendaEvents}>{groups.map((group, index) => <ScheduleEntry
          key={`${group.schedule_identity}-${group.kind}`} group={group} groups={groups} index={index}
          label={`${label} UTC`} selectedIdentity={props.selectedIdentity} onInspect={props.onInspect} />)}</div>
      </motion.section>;
    })}
  </motion.div>;
}
