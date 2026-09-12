import type { ReactNode } from "react";

import styles from "./form-field.module.css";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  wide = false,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.field} data-span={wide ? "full" : undefined} htmlFor={htmlFor}>
      <span className={styles.label}>{label}</span>
      {children}
      {error ? <small className={styles.error}>{error}</small>
        : hint ? <small className={styles.hint}>{hint}</small> : null}
    </label>
  );
}
