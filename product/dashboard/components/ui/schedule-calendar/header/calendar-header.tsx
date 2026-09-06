"use client";

import { motion } from "framer-motion";
import { InterfaceIcons } from "../../iconography";
import { slideFromLeft, slideFromRight, transition } from "../animations";
import styles from "../../schedule-calendar.module.css";
import { DateNavigator } from "./date-navigator";
import { FilterSchedules } from "./filter";
import { OperationSelect } from "./operation-select";
import { Settings } from "./settings";
import { TodayButton } from "./today-button";
import type { CalendarHeaderProps } from "./types";
import { Views } from "./view-tabs";

export function CalendarHeader(props: CalendarHeaderProps) {
  return <div className={styles.calendarHeader} data-slot="schedule-calendar-header" aria-label="Schedule controls">
    <motion.div className={styles.calendarIdentity} variants={slideFromLeft} initial="initial" animate="animate"
      transition={transition}>
      <TodayButton onToday={props.onToday} />
      <DateNavigator date={props.date} view={props.view} statusLabel={props.statusLabel} onShift={props.onShift} />
    </motion.div>
    <motion.div className={styles.calendarTools} variants={slideFromRight} initial="initial" animate="animate"
      transition={transition}>
      <div className={styles.calendarOptions}>
        <FilterSchedules query={props.query} observationScope={props.observationScope}
          onQuery={props.onQuery} onObservationScope={props.onObservationScope} />
        <Views view={props.view} mode={props.mode} onView={props.onView} />
      </div>
      <div className={styles.calendarActions}>
        <OperationSelect value={props.operationScope} operations={props.operations} onChange={props.onOperationScope} />
        <motion.button type="button" className={styles.refreshAction} disabled={props.pending}
          onClick={props.onRefresh} whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>
          <InterfaceIcons.refresh size={16} aria-hidden="true" /><span>Refresh</span>
        </motion.button>
      </div>
      <Settings compactCalendar={props.compactCalendar} tableMode={props.mode === "table"}
        onCompactCalendar={props.onCompactCalendar} onToggleTable={props.onToggleTable} />
    </motion.div>
  </div>;
}
