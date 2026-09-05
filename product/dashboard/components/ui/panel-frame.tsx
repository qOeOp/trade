"use client";

import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
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
  return <button {...props} type="button" className={["panel-frame-icon-action", className].filter(Boolean).join(" ")}>{children}</button>;
}

export function PanelFrameCloseButton({
  className,
  "aria-label": ariaLabel = "Close panel",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      {...props}
      type="button"
      aria-label={ariaLabel}
      className={["panel-frame-close-button", className].filter(Boolean).join(" ")}
      data-slot="panel-frame-close-button"
    >
      <InterfaceIcons.close aria-hidden="true" size={12} strokeWidth={2.25} />
    </button>
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
