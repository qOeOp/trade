import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./entity-reference.module.css";
import { preserveRowViewportPosition } from "./preserve-row-viewport-position";

type EntityReferenceDestination =
  | { href?: string; onActivate?: never }
  | { href?: never; onActivate: () => void };

export function compactEntityIdentity(identity: string): string {
  return identity.length > 12 ? `…${identity.slice(-8)}` : identity;
}

export function EntityReference({
  label,
  identity,
  detail,
  href,
  exactTitle,
  labelTitle,
  showIdentity = true,
  onActivate,
  disclosure,
}: {
  label: ReactNode;
  identity: string;
  detail?: ReactNode;
  exactTitle?: string;
  labelTitle?: string;
  showIdentity?: boolean;
  disclosure?: { controls: string; expanded: boolean };
} & EntityReferenceDestination) {
  const content = <>
    <strong title={labelTitle}>{label}</strong>
    {showIdentity || detail ? <span title={showIdentity ? exactTitle ?? identity : undefined}>
      {showIdentity ? compactEntityIdentity(identity) : null}{showIdentity && detail ? <> · </> : null}{detail}
    </span> : null}
  </>;

  if (href) return <Link className={styles.reference} href={href}>{content}</Link>;
  if (onActivate) {
    return <button
      className={styles.reference}
      type="button"
      aria-controls={disclosure?.controls}
      aria-expanded={disclosure?.expanded}
      onClick={(event) => {
        event.currentTarget.focus();
        const row = disclosure ? event.currentTarget.closest("tr") : null;
        if (row) preserveRowViewportPosition(row);
        onActivate();
      }}
    >{content}</button>;
  }
  return <div className={styles.reference}>{content}</div>;
}
