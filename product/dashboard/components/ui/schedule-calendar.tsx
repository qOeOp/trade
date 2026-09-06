"use client";

import { useState } from "react";
import type { ScheduleCalendarGroupV1, ScheduleCalendarView } from "../../lib/schedule-calendar";
import type { ScheduleProjectionV1 } from "../../lib/schedule-projection";
import { CalendarBody } from "./schedule-calendar/calendar-body";
import { ScheduleInspectionDialog, type ScheduleInspection } from "./schedule-calendar/dialogs/schedule-inspection-dialog";
import styles from "./schedule-calendar.module.css";

// Vibe Journal's CalendarBody -> View -> Cell/Badge/Dialog hierarchy is retained.
// Trade schedule custody is adapted as read-only point evidence; no editable duration event is invented.
export function ScheduleCalendar({ schedules, date, view, selectedIdentity, onSelect, onDate, compact = false }: {
  schedules: readonly ScheduleProjectionV1[];
  date: string;
  view: ScheduleCalendarView;
  selectedIdentity: string | null;
  onSelect: (identity: string) => void;
  onDate: (date: string, view: ScheduleCalendarView) => void;
  compact?: boolean;
}) {
  const [inspection, setInspection] = useState<ScheduleInspection | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [page, setPage] = useState(0);
  const inspect = (label: string, groups: ScheduleCalendarGroupV1[], index = 0) => {
    setInspection({ label, groups });
    setGroupIndex(index);
    setPage(0);
    if (groups[index]) onSelect(groups[index].schedule_identity);
  };
  return <div className={styles.calendar} data-density={compact ? "compact" : "comfortable"}>
    <CalendarBody schedules={schedules} date={date} view={view} selectedIdentity={selectedIdentity}
      compact={compact} onDate={onDate} onInspect={inspect} />
    <ScheduleInspectionDialog inspection={inspection} groupIndex={groupIndex} page={page}
      onGroup={(index) => { setGroupIndex(index); setPage(0); onSelect(inspection!.groups[index].schedule_identity); }}
      onPage={setPage} onClose={() => setInspection(null)} />
  </div>;
}
