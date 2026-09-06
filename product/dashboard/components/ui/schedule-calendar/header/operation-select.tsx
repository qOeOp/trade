"use client";

import { useRef } from "react";
import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

function operationMark(operation: string): string {
  const words = operation.split(/[^a-zA-Z0-9]+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : operation.slice(0, 2)).toUpperCase();
}

export function OperationSelect({ value, operations, onChange }: {
  value: string;
  operations: readonly string[];
  onChange: (value: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const visibleOperations = value === "all" ? operations.slice(0, 3) : operations.filter((item) => item === value);
  const hiddenCount = value === "all" ? Math.max(operations.length - visibleOperations.length, 0) : 0;
  const choose = (nextValue: string) => {
    onChange(nextValue);
    menu.current?.removeAttribute("open");
  };
  return <details ref={menu} name="calendar-toolbar-menu" className={styles.operationScope}>
    <summary aria-label="Operation scope">
      {visibleOperations.length > 0 && <span className={styles.operationMarks} aria-hidden="true">
        {visibleOperations.map((operation) => <i key={operation}>{operationMark(operation)}</i>)}
        {hiddenCount > 0 && <i>+{hiddenCount}</i>}
      </span>}
      <strong>{value === "all" ? "All" : value}</strong>
      <InterfaceIcons.expand size={15} aria-hidden="true" />
    </summary>
    <div className={`${styles.toolPopover} ${styles.operationPopover}`} role="listbox" aria-label="Operation scope">
      {["all", ...operations].map((operation) => <button type="button" role="option" key={operation}
        aria-selected={value === operation} onClick={() => choose(operation)}>
        <span>{operation === "all" ? "All schedules" : operation}</span>
        {value === operation && <InterfaceIcons.selected size={14} aria-hidden="true" />}
      </button>)}
    </div>
  </details>;
}
