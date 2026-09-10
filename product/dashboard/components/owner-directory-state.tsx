import type { ReactNode } from "react";

import { RunIcons } from "./ui/iconography";
import styles from "./owner-directory.module.css";

export function OwnerDirectoryInfo({
  children,
  label = "View interface details",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className={styles.infoDisclosure}>
      <summary aria-label={label} title={label}>
        <RunIcons.unknown aria-hidden="true" size={14} />
      </summary>
      <div className={styles.infoPopover}>{children}</div>
    </details>
  );
}

export function OwnerDirectoryUnavailable({
  icon,
  title,
  detail,
  reason,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  reason: ReactNode;
}) {
  return (
    <div className={styles.directoryUnavailable}>
      {icon}
      <div className={styles.directoryUnavailableCopy}>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <OwnerDirectoryInfo label="View technical reason">
        <span>Technical reason</span>
        <code>{reason}</code>
      </OwnerDirectoryInfo>
    </div>
  );
}
