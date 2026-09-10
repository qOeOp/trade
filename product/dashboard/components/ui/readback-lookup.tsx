import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

import styles from "./readback-lookup.module.css";

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ReadbackLookup({
  children,
  className,
  columns = "single",
  validation,
  validationId,
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  columns?: "single" | "double";
  validation?: ReactNode;
  validationId?: string;
}) {
  return (
    <div className={styles.root} data-ui="readback-lookup">
      <form {...props} className={classes(styles.rail, className)} data-columns={columns}>
        {children}
      </form>
      {validation ? <p className={styles.validation} id={validationId}>{validation}</p> : null}
    </div>
  );
}

export function ReadbackLookupField({
  children,
  className,
  label,
  labelHidden = false,
  leading,
  mono = false,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  labelHidden?: boolean;
  leading?: ReactNode;
  mono?: boolean;
}) {
  return (
    <label
      {...props}
      className={classes(styles.field, className)}
      data-label-hidden={labelHidden}
      data-leading={Boolean(leading)}
      data-mono={mono}
    >
      <span className={labelHidden ? "sr-only" : undefined}>{label}</span>
      {leading}
      {children}
    </label>
  );
}

export function ReadbackLookupAction({
  children,
  className,
  type = "submit",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={classes(styles.action, className)} type={type}>
      {children}
    </button>
  );
}
