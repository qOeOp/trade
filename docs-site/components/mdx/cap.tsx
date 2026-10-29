import type { ReactNode } from 'react';

// Kind is a neutral hairline badge; the verification tier carries the IDE's data hues (global.css).
export function Kind({ value, label }: { value: string; label?: string }) {
  return <span className="rd-badge rd-badge-kind">{label ?? value}</span>;
}

export function Tier({ value, label, note }: { value: string; label?: string; note?: string }) {
  return (
    <span title={note} className={`rd-badge rd-badge-tier rd-tier-${value}`}>
      {label ?? value}
      {note ? ' *' : ''}
    </span>
  );
}

/** Capability block: a bordered card keyed by its path so every capability has one visual unit. */
export function Cap({ id, kind, kindLabel, tier, tierLabel, tierNote, title, children }: { id: string; kind: string; kindLabel?: string; tier: string; tierLabel?: string; tierNote?: string; title: string; children?: ReactNode }) {
  const anchor = id.replaceAll('.', '-');
  return (
    <section id={anchor} data-cap={id} className="rd-cap scroll-mt-24">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <a href={`#${anchor}`} className="font-mono text-xs text-fd-muted-foreground no-underline hover:text-fd-primary">{id}</a>
        <Kind value={kind} label={kindLabel} />
        <Tier value={tier} label={tierLabel} note={tierNote} />
        <span className="basis-full text-sm font-semibold leading-snug text-fd-foreground">{title}</span>
      </header>
      <div className="rd-cap-body text-[13px] [&>p]:my-2">{children}</div>
    </section>
  );
}
