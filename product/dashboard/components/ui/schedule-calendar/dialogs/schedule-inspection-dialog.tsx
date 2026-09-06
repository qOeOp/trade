"use client";

import { useEffect, useRef } from "react";
import { calendarGroupPageV1, type ScheduleCalendarGroupV1 } from "../../../../lib/schedule-calendar";
import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

export type ScheduleInspection = { label: string; groups: ScheduleCalendarGroupV1[] };

export function ScheduleInspectionDialog({ inspection, groupIndex, page, onGroup, onPage, onClose }: {
  inspection: ScheduleInspection | null;
  groupIndex: number;
  page: number;
  onGroup: (index: number) => void;
  onPage: (page: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (inspection && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [inspection]);
  if (!inspection) return null;
  const selected = inspection.groups[groupIndex];
  return <dialog ref={dialog} className={styles.dialog} aria-label={inspection.label} onClose={onClose}>
    <header className={styles.dialogHeader}><div><small>Schedule inspection</small><h3>{inspection.label}</h3></div>
      <button type="button" className={styles.iconButton} aria-label="Close schedule inspection" onClick={() => dialog.current?.close()}>
        <InterfaceIcons.close size={16} aria-hidden="true" />
      </button>
    </header>
    <label className={styles.dialogSelect}>Schedule <select value={groupIndex} onChange={(event) => onGroup(Number(event.target.value))}>
      {inspection.groups.map((group, index) => <option key={`${group.schedule_identity}-${group.kind}`} value={index}>
        {group.operation_id} · {group.kind}
      </option>)}
    </select></label>
    {selected && <>
      <div className={styles.inspectionStatus} data-kind={selected.kind}>
        <i aria-hidden="true" /><span>{selected.kind === "expected" ? "Expected triggers · not execution history" : "Observed run reference · not proof of success"}</span>
      </div>
      <ol className={styles.timestampList}>{calendarGroupPageV1(selected, page).map((time) => <li key={time}>
        <time dateTime={time}>{time.replace("T", " ").replace("Z", " UTC")}</time>
        {selected.run_identity && <a href={`/operations/runs/${encodeURIComponent(selected.run_identity)}`}>Open run</a>}
      </li>)}</ol>
      <footer className={styles.dialogFooter}>
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}><InterfaceIcons.previous size={14} aria-hidden="true" />Previous</button>
        <span>{page + 1} / {Math.ceil(selected.count / 50)}</span>
        <button type="button" disabled={(page + 1) * 50 >= selected.count} onClick={() => onPage(page + 1)}>Next<InterfaceIcons.next size={14} aria-hidden="true" /></button>
      </footer>
    </>}
  </dialog>;
}
