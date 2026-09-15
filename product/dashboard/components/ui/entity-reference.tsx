import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./entity-reference.module.css";

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
}: {
  label: ReactNode;
  identity: string;
  detail?: ReactNode;
  href?: string;
  exactTitle?: string;
  labelTitle?: string;
}) {
  const content = <>
    <strong title={labelTitle}>{label}</strong>
    <span title={exactTitle ?? identity}>
      {compactEntityIdentity(identity)}{detail ? <> · {detail}</> : null}
    </span>
  </>;

  return href
    ? <Link className={styles.reference} href={href}>{content}</Link>
    : <div className={styles.reference}>{content}</div>;
}
