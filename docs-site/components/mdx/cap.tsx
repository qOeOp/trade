import type { ReactNode } from 'react';

const KIND: Record<string, string> = {
  code: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  database: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  skill: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};
const TIER: Record<string, string> = {
  verified: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rehearsal: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  unverified: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

export function Kind({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] leading-none ${KIND[value] ?? 'bg-fd-muted'}`}>{label ?? value}</span>;
}

export function Tier({ value, label, note }: { value: string; label?: string; note?: string }) {
  return (
    <span title={note} className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-none ${TIER[value] ?? 'bg-fd-muted'}`}>
      {label ?? value}
      {note ? ' *' : ''}
    </span>
  );
}

/** Capability block: a bordered card keyed by its path so every capability has one visual unit. */
export function Cap({ id, kind, kindLabel, tier, tierLabel, tierNote, title, children }: { id: string; kind: string; kindLabel?: string; tier: string; tierLabel?: string; tierNote?: string; title: string; children?: ReactNode }) {
  const anchor = id.replaceAll('.', '-');
  return (
    <section id={anchor} data-cap={id} className="rd-cap my-5 scroll-mt-24 rounded-lg border border-fd-border bg-fd-card/40 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <a href={`#${anchor}`} className="font-mono text-xs font-semibold text-fd-primary no-underline">{id}</a>
        <Kind value={kind} label={kindLabel} />
        <Tier value={tier} label={tierLabel} note={tierNote} />
        <span className="basis-full text-[15px] font-semibold leading-snug text-fd-foreground">{title}</span>
      </header>
      <div className="rd-cap-body text-sm [&>p]:my-2">{children}</div>
    </section>
  );
}
