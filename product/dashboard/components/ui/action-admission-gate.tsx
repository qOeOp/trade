"use client";

import type { ReactNode } from "react";

import { actionStateTone } from "./status-tone-policy";
import { DetailInspector, DetailInspectorBody, DetailInspectorHeader } from "./detail-inspector";
import { Input } from "./input";
import { StatusBadge } from "./status-badge";
import styles from "./action-admission-gate.module.css";

export function ActionAdmissionGate({
  title,
  state,
  message,
  capability,
  onCapabilityChange,
  showCapability = true,
  capabilityDisabled = false,
  actions,
}: {
  title: ReactNode;
  state: string;
  message: ReactNode;
  capability: string;
  onCapabilityChange: (value: string) => void;
  showCapability?: boolean;
  capabilityDisabled?: boolean;
  actions: ReactNode;
}) {
  return (
    <DetailInspector as="section" className={styles.gate} aria-label="Artifact formation action">
      <DetailInspectorHeader
        eyebrow="Artifact formation"
        title={title}
        status={<StatusBadge tone={actionStateTone(state)}>{state.toLowerCase()}</StatusBadge>}
      />
      <DetailInspectorBody className={styles.body} aria-live="polite">
        <div className={styles.status}>
          <small>{message}</small>
        </div>
        {showCapability ? <div className={styles.capability}>
          <Input
            type="password"
            variant="surface"
            autoComplete="off"
            aria-label="Disposable operator access"
            placeholder="Disposable operator access"
            value={capability}
            disabled={capabilityDisabled}
            onChange={(event) => onCapabilityChange(event.target.value)}
          />
        </div> : null}
        <div className={styles.actions}>{actions}</div>
      </DetailInspectorBody>
    </DetailInspector>
  );
}
