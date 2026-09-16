import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./entity-reference.module.css";

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
  onActivate,
  disclosure,
}: {
  label: ReactNode;
  identity: string;
  detail?: ReactNode;
  exactTitle?: string;
  labelTitle?: string;
  disclosure?: { controls: string; expanded: boolean };
} & EntityReferenceDestination) {
  const content = <>
    <strong title={labelTitle}>{label}</strong>
    <span title={exactTitle ?? identity}>
      {compactEntityIdentity(identity)}{detail ? <> · {detail}</> : null}
    </span>
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
        onActivate();
      }}
    >{content}</button>;
  }
  return <div className={styles.reference}>{content}</div>;
}
