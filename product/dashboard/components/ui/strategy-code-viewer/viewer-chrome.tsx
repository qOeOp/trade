"use client";

import { EvidenceIcons, InterfaceIcons, ModuleIcons } from "../iconography";
import styles from "../strategy-code-viewer.module.css";

type ViewerState = "loading" | "available" | "unavailable";

const steps = [
  { icon: EvidenceIcons.artifact, label: "Owner artifact" },
  { icon: EvidenceIcons.verified, label: "Source bound" },
  { icon: EvidenceIcons.locked, label: "Read only" },
] as const;

export function ViewerChrome({
  state,
  onCopy,
}: {
  state: ViewerState;
  onCopy?: () => void;
}) {
  return (
    <header className={styles.chrome} data-slot="strategy-viewer-chrome" data-state={state}>
      <div className={styles.chromeIdentity} aria-hidden="true">
        <ModuleIcons.terminal size={17} strokeWidth={1.5} />
      </div>
      <div className={styles.chromeSteps} aria-label="Source projection state">
        {steps.map(({ icon: Icon, label }, index) => (
          <div className={styles.chromeStepGroup} key={label}>
            {index > 0 ? <InterfaceIcons.next className={styles.chromeArrow} size={12} aria-hidden="true" /> : null}
            <span className={styles.chromeStep} data-current={index === 1 ? "true" : undefined}>
              <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
              {label}
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.chromeAction}
        onClick={onCopy}
        disabled={!onCopy}
        aria-label="Copy strategy source"
        title={onCopy ? "Copy strategy source" : "Source unavailable"}
      >
        <InterfaceIcons.copy size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </header>
  );
}
