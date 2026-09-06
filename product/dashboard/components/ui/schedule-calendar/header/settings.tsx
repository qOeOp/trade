"use client";

import { InterfaceIcons } from "../../iconography";
import styles from "../../schedule-calendar.module.css";

export function Settings({ compactCalendar, tableMode, onCompactCalendar, onToggleTable }: {
  compactCalendar: boolean;
  tableMode: boolean;
  onCompactCalendar: (compact: boolean) => void;
  onToggleTable: () => void;
}) {
  return <details name="calendar-toolbar-menu" className={`${styles.toolMenu} ${styles.settingsMenu}`}>
    <summary aria-label="Calendar settings"><InterfaceIcons.settings size={16} aria-hidden="true" /></summary>
    <div className={styles.toolPopover}>
      <strong>Calendar settings</strong>
      <label className={styles.settingRow}>
        <span><b>Compact cells</b><small>Show more dates without changing schedule data.</small></span>
        <input type="checkbox" checked={compactCalendar} aria-label="Compact calendar cells"
          onChange={(event) => onCompactCalendar(event.target.checked)} />
      </label>
      <button type="button" className={styles.tableSetting} aria-pressed={tableMode}
        aria-label="Table view" onClick={onToggleTable}>
        <span>Table view</span>{tableMode && <InterfaceIcons.selected size={14} aria-hidden="true" />}
      </button>
    </div>
  </details>;
}
