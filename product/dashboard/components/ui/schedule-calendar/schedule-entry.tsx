"use client";

import { motion } from "framer-motion";
import type { ScheduleCalendarGroupV1 } from "../../../lib/schedule-calendar";
import { transition } from "./animations";
import { timeLabel } from "./geometry";
import type { InspectScheduleGroups } from "./types";
import styles from "../schedule-calendar.module.css";

export function ScheduleEntry({ group, groups, index, label, selectedIdentity, compact = false, position = "none", onInspect }: {
  group: ScheduleCalendarGroupV1;
  groups: ScheduleCalendarGroupV1[];
  index: number;
  label: string;
  selectedIdentity: string | null;
  compact?: boolean;
  position?: "first" | "middle" | "last" | "none";
  onInspect: InspectScheduleGroups;
}) {
  return <motion.button type="button" className={styles.eventBadge}
    data-slot="calendar-event-badge" data-kind={group.kind} data-position={position}
    aria-pressed={selectedIdentity === group.schedule_identity}
    aria-label={`${group.operation_id} · ${group.kind === "observed" ? "Observed run" : "Expected triggers"} · ${group.count > 1 ? group.count : group.first_at}`}
    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
    transition={{ delay: Math.min(index, 3) * 0.04, ...transition }}
    onClick={() => onInspect(label, groups, index)}>
    <span className={styles.eventIdentity}><i aria-hidden="true" />
      {position !== "middle" && position !== "last" && <b title={group.operation_id}>{group.operation_id}</b>}
    </span>
    {position !== "first" && position !== "middle" && <small>
      {group.count > 1 ? group.count.toLocaleString() : timeLabel(group.first_at)}{compact ? "" : group.kind === "observed" ? " observed" : " expected"}
    </small>}
  </motion.button>;
}
