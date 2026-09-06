"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ScheduleCalendarView } from "../../../lib/schedule-calendar";
import { fadeIn, transition } from "./animations";
import type { CalendarViewProps } from "./types";
import { AgendaEvents } from "./views/agenda-view/agenda-events";
import { CalendarMonthView } from "./views/month-view/calendar-month-view";
import { CalendarDayView } from "./views/week-and-day-view/calendar-day-view";
import { CalendarWeekView } from "./views/week-and-day-view/calendar-week-view";
import { CalendarYearView } from "./views/year-view/calendar-year-view";
import styles from "../schedule-calendar.module.css";

export function CalendarBody({ view, ...props }: CalendarViewProps & { view: ScheduleCalendarView }) {
  return <div data-slot="calendar-body" className={styles.calendarBody}>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={`${view}-${props.date}`} initial="initial" animate="animate" exit="exit"
        variants={fadeIn} transition={transition} className={styles.calendarTransition}>
        {view === "month" && <CalendarMonthView {...props} />}
        {view === "week" && <CalendarWeekView {...props} />}
        {view === "day" && <CalendarDayView {...props} />}
        {view === "year" && <CalendarYearView {...props} />}
        {view === "agenda" && <AgendaEvents {...props} />}
      </motion.div>
    </AnimatePresence>
  </div>;
}
