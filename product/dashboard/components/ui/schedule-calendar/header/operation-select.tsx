"use client";

import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

export function OperationSelect({ value, operations, onChange }: {
  value: string;
  operations: readonly string[];
  onChange: (value: string) => void;
}) {
  return <label className={styles.operationScope}>
    <select aria-label="Operation scope" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="all">All schedules</option>
      {operations.map((operation) => <option key={operation} value={operation}>{operation}</option>)}
    </select>
    <InterfaceIcons.expand size={15} aria-hidden="true" />
  </label>;
}
