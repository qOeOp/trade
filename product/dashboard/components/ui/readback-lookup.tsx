import type {
  FormHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

import { Button, type ButtonProps } from "./button";
import { Input, type InputProps } from "./input";
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

export function ReadbackLookupInput({ className, ...props }: InputProps) {
  return <Input {...props} className={classes(styles.input, className)} />;
}

export function ReadbackLookupAction({
  children,
  className,
  type = "submit",
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      className={classes(styles.action, className)}
      size="default"
      type={type}
      variant="default"
    >
      {children}
    </Button>
  );
}
