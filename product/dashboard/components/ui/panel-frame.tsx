"use client";

import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useId,
} from "react";
import { Button } from "./button";
import { InterfaceIcons } from "./iconography";

export function PanelFrame({
  children,
  className,
  variant = "framed",
  as: Component = "section",
  ...props
}: {
  children: ReactNode;
  variant?: "framed" | "flat";
  as?: "section" | "aside";
} & HTMLAttributes<HTMLElement>) {
  return (
    <Component
      {...props}
      className={["panel-frame", className].filter(Boolean).join(" ")}
      data-geometry={variant === "framed" ? "shell-inset" : "flat"}
      data-slot="panel-frame"
      data-variant={variant}
    >
      {children}
    </Component>
  );
}

export function PanelFrameHeader({
  eyebrow,
  title,
  titleId,
  subtitle,
  description,
  meta,
  actions,
  onClose,
  className,
  density = "default",
  layout = "stacked",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  className?: string;
  density?: "default" | "compact";
  layout?: "stacked" | "inline";
}) {
  return (
    <header
      className={["panel-frame-header", className].filter(Boolean).join(" ")}
      data-density={density}
      data-layout={layout}
      data-slot="panel-frame-header"
      data-surface="frame"
    >
      <div className="panel-frame-heading">
        {eyebrow ? <span className="panel-frame-eyebrow">{eyebrow}</span> : null}
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <div className="panel-frame-subtitle">{subtitle}</div> : null}
        {meta ? <div className="panel-frame-meta">{meta}</div> : null}
        {description ? <p>{description}</p> : null}
      </div>
      {actions || onClose ? (
        <div className="panel-frame-actions">
          {actions}
          {onClose ? <PanelFrameCloseButton onClick={onClose} /> : null}
        </div>
      ) : null}
    </header>
  );
}

type PanelFrameBodyProps = {
  children: ReactNode;
  density?: "default" | "compact";
  toolbar?: ReactNode;
  mode?: "static" | "scroll" | "flex";
  bodyRef?: Ref<HTMLDivElement>;
} & HTMLAttributes<HTMLDivElement>;

export function PanelFrameBody({
  children,
  className,
  density = "default",
  toolbar,
  mode = "static",
  bodyRef,
  ...props
}: PanelFrameBodyProps) {
  const content = mode === "static" && !toolbar
    ? children
    : (
      <>
        {toolbar ? <div className="panel-frame-toolbar">{toolbar}</div> : null}
        <div className="panel-frame-body-content" data-mode={mode}>{children}</div>
      </>
    );

  return (
    <div
      {...props}
      ref={bodyRef}
      className={["panel-frame-body", className].filter(Boolean).join(" ")}
      data-density={density}
      data-mode={mode}
      data-slot="panel-frame-body"
      data-surface="inset"
    >
      {content}
    </div>
  );
}

export function PanelSection({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["panel-section", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function PanelFrameIconAction({
  children,
  className,
  ...props
}: { children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return <Button {...props} type="button" variant="outline" size="icon-sm"
    className={["panel-frame-icon-action", className].filter(Boolean).join(" ")}>{children}</Button>;
}

export function PanelFrameInfo({
  children,
  label = "View technical details",
}: {
  children: ReactNode;
  label?: string;
}) {
  const popoverId = useId();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="panel-info-trigger"
        aria-label={label}
        title={label}
        popoverTarget={popoverId}
      >
        <InterfaceIcons.info aria-hidden="true" size={15} />
      </Button>
      <div id={popoverId} className="panel-info-popover" popover="auto">
        {children}
      </div>
    </>
  );
}

export function PanelFrameInfoList({ children }: { children: ReactNode }) {
  return <dl className="panel-info-facts">{children}</dl>;
}

export function PanelFrameInfoFact({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function PanelFrameCloseButton({
  className,
  "aria-label": ariaLabel = "Close panel",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <Button
      {...props}
      type="button"
      variant="outline"
      size="icon-xs"
      aria-label={ariaLabel}
      className={["panel-frame-close-button", className].filter(Boolean).join(" ")}
      data-slot="panel-frame-close-button"
    >
      <InterfaceIcons.close aria-hidden="true" size={12} strokeWidth={2.25} />
    </Button>
  );
}

export function PanelFrameFooter({
  children,
  className,
  layout = "plain",
  ...props
}: {
  children: ReactNode;
  layout?: "plain" | "split";
} & HTMLAttributes<HTMLElement>) {
  return (
    <footer
      {...props}
      className={["panel-frame-footer", className].filter(Boolean).join(" ")}
      data-layout={layout}
      data-slot="panel-frame-footer"
      data-surface="frame"
    >
      {children}
    </footer>
  );
}

export function PanelFrameFooterSummary({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return <div className="panel-frame-footer-summary"><b>{primary}</b>{secondary ? <small>{secondary}</small> : null}</div>;
}

export function PanelFrameFooterMeta({ children }: { children: ReactNode }) {
  return <code className="panel-frame-footer-meta">{children}</code>;
}

export function PanelFrameFooterActions({ children }: { children: ReactNode }) {
  return <div className="panel-frame-footer-actions">{children}</div>;
}
