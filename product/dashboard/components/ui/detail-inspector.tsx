import type { HTMLAttributes, ReactNode } from "react";

export function DetailInspector({
  as: Element = "aside",
  children,
  className,
  ...props
}: {
  as?: "aside" | "section";
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Element {...props} className={["detail-inspector", className].filter(Boolean).join(" ")} data-layout="bento">
      {children}
    </Element>
  );
}

export function DetailInspectorHeader({
  eyebrow,
  title,
  titleId,
  titleAttribute,
  status,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  titleId?: string;
  titleAttribute?: string;
  status?: ReactNode;
}) {
  return (
    <header className="detail-inspector-header">
      <div>
        <span>{eyebrow}</span>
        <h3 id={titleId} title={titleAttribute}>{title}</h3>
      </div>
      {status}
    </header>
  );
}

export function DetailFactGrid({ children }: { children: ReactNode }) {
  return <div className="detail-fact-grid">{children}</div>;
}

export function DetailFact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div><span>{label}</span>{children}</div>;
}

export function DetailClusterGrid({ children }: { children: ReactNode }) {
  return <div className="detail-cluster-grid">{children}</div>;
}

export function DetailCluster({
  label,
  meta,
  children,
}: {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="detail-cluster">
      <header><span>{label}</span>{meta ? <b>{meta}</b> : null}</header>
      <dl>{children}</dl>
    </section>
  );
}

export function DetailClusterFact({
  label,
  children,
  wide = false,
}: {
  label: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return <div className="detail-cluster-fact" data-span={wide ? "full" : undefined}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function DetailSection({
  label,
  meta,
  children,
  className,
}: {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["detail-section", className].filter(Boolean).join(" ")}>
      <header><span>{label}</span>{meta ? <b>{meta}</b> : null}</header>
      {children}
    </section>
  );
}

export function DetailNotice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="detail-notice">
      {icon}
      <div><b>{title}</b><small>{children}</small></div>
    </section>
  );
}

export function DetailInspectorFooter({ children }: { children: ReactNode }) {
  return <footer className="detail-inspector-footer">{children}</footer>;
}

export function DetailEmpty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="detail-empty">{icon}<p>{children}</p></div>;
}
