"use client";

import { useEffect, useRef } from "react";
import { calendarGroupPageV1, type ScheduleCalendarGroupV1 } from "../../../../lib/schedule-calendar";
import { Button } from "../../button";
import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

export type ScheduleInspection = { label: string; groups: ScheduleCalendarGroupV1[] };

export function ScheduleInspectionDialog({ inspection, groupIndex, page, onGroup, onPage, onOpenRun, onClose }: {
  inspection: ScheduleInspection | null;
  groupIndex: number;
  page: number;
  onGroup: (index: number) => void;
  onPage: (page: number) => void;
  onOpenRun: (runIdentity: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const transitioningToRun = useRef(false);
  useEffect(() => {
    const current = dialog.current;
    if (!inspection || !current || current.open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current.showModal();
    current.querySelector<HTMLElement>("button, select, a[href]")?.focus();
  }, [inspection]);
  if (!inspection) return null;
  const selected = inspection.groups[groupIndex];
  const close = () => {
    onClose();
    if (!transitioningToRun.current) window.requestAnimationFrame(() => returnFocus.current?.focus());
    transitioningToRun.current = false;
  };
  const openRun = (runIdentity: string) => {
    const trigger = returnFocus.current;
    transitioningToRun.current = true;
    dialog.current?.close();
    trigger?.focus();
    onOpenRun(runIdentity);
  };
  return <dialog ref={dialog} className={styles.dialog} aria-label={inspection.label} onClose={close}>
    <header className={styles.dialogHeader}><div><small>Schedule inspection</small><h3>{inspection.label}</h3></div>
      <Button type="button" variant="outline" size="icon-tool" aria-label="Close schedule inspection" onClick={() => dialog.current?.close()}>
        <InterfaceIcons.close size={16} aria-hidden="true" />
      </Button>
    </header>
    <label className={styles.dialogSelect}>Schedule <select value={groupIndex} onChange={(event) => onGroup(Number(event.target.value))}>
      {inspection.groups.map((group, index) => <option key={`${group.schedule_identity}-${group.kind}`} value={index}
        data-run-identity={group.run_identity ?? undefined}>
        {group.operation_id} · {group.kind}
      </option>)}
    </select></label>
    {selected && <>
      <div className={styles.inspectionStatus} data-kind={selected.kind}>
        <i aria-hidden="true" /><span>{selected.kind === "expected" ? "Expected triggers · not execution history" : "Observed run reference · not proof of success"}</span>
      </div>
      <ol className={styles.timestampList}>{calendarGroupPageV1(selected, page).map((time) => <li key={time}>
        <time dateTime={time}>{time.replace("T", " ").replace("Z", " UTC")}</time>
        {selected.run_identity && <Button type="button" variant="link" size="xs"
          data-run-preview-trigger={selected.run_identity} onClick={() => openRun(selected.run_identity!)}>
          Inspect run<InterfaceIcons.next aria-hidden="true" size={12} />
        </Button>}
      </li>)}</ol>
      <footer className={styles.dialogFooter}>
        <Button type="button" variant="outline" size="tool" disabled={page === 0} onClick={() => onPage(page - 1)}><InterfaceIcons.previous size={12} aria-hidden="true" />Previous</Button>
        <span>{page + 1} / {Math.ceil(selected.count / 50)}</span>
        <Button type="button" variant="outline" size="tool" disabled={(page + 1) * 50 >= selected.count} onClick={() => onPage(page + 1)}>Next<InterfaceIcons.next size={12} aria-hidden="true" /></Button>
      </footer>
    </>}
  </dialog>;
}
