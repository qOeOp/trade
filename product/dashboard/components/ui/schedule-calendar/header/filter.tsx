"use client";

import type { ScheduleObservationScope } from "../../../../lib/schedule-calendar";
import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

const observationOptions = [
  ["all", "All schedules"],
  ["observed", "Observed"],
  ["pending", "Not observed"],
] as const;

export function FilterSchedules({ query, observationScope, onQuery, onObservationScope }: {
  query: string;
  observationScope: ScheduleObservationScope;
  onQuery: (query: string) => void;
  onObservationScope: (scope: ScheduleObservationScope) => void;
}) {
  return <details name="calendar-toolbar-menu" className={`${styles.toolMenu} ${styles.filterMenu}`}>
    <summary aria-label="Filter schedules"><InterfaceIcons.filter size={16} aria-hidden="true" /></summary>
    <div className={styles.toolPopover}>
      <label className={styles.filterSearch}>
        <InterfaceIcons.search size={15} aria-hidden="true" />
        <input aria-label="Search schedules" type="search" value={query}
          onChange={(event) => onQuery(event.target.value)} placeholder="Operation or schedule…" />
      </label>
      <fieldset>
        <legend>Observation</legend>
        {observationOptions.map(([value, label]) => <button type="button" key={value}
          aria-pressed={observationScope === value} aria-label={label} onClick={() => onObservationScope(value)}>
          <span>{label}</span>{observationScope === value && <InterfaceIcons.selected size={14} aria-hidden="true" />}
        </button>)}
      </fieldset>
    </div>
  </details>;
}
