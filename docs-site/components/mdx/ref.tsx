'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PreviewCard } from '@base-ui/react/preview-card';
import index from '@/lib/generated/rd-index.json';
import type { Locale } from '@/lib/i18n';

type Entry = {
  kind: 'capability' | 'table' | 'node';
  title: string;
  label: string;
  body: string;
  slug: string;
  anchor: string;
  owner?: string;
  where?: string;
};

const data = index as Record<Locale, Record<string, Entry>>;

const KIND_LABEL: Record<Locale, Record<Entry['kind'], string>> = {
  zh: { capability: '能力', table: '表', node: '节' },
  en: { capability: 'capability', table: 'table', node: 'section' },
};

/** Backtick-quoted identifiers in preview text render as inline code. */
function withInlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded-[3px] border border-[var(--line)] bg-fd-muted px-1 font-mono text-[0.9em] text-fd-foreground">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** Cross-reference: a link to the definition with a hover preview (no focus trap, so it never re-opens itself).
 * Every id has an entry in its page's locale: building the index fails on a dangling ref. */
export function Ref({ id, lang, children }: { id: string; lang: Locale; children?: ReactNode }) {
  const entry = data[lang][id];
  const href = `/${lang}/docs/${entry.slug}/#${entry.anchor}`;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={250}
        closeDelay={120}
        render={<Link href={href} className="rd-ref border-b border-dotted border-fd-primary/60 text-fd-primary no-underline hover:border-solid" />}
      >
        {children ?? entry.label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <PreviewCard.Popup className="rd-ref-popup w-[min(32rem,92vw)] p-3 text-[13px] text-fd-popover-foreground">
            <div className="mb-1 flex items-center gap-2 text-xs text-fd-muted-foreground">
              <span className="rd-badge rd-badge-kind">{KIND_LABEL[lang][entry.kind]}</span>
              <span className={entry.where ? '' : 'font-mono'}>{entry.where ?? id}</span>
              {entry.owner ? <span>{lang === 'zh' ? '定义于' : 'defined in'} {entry.owner}</span> : null}
            </div>
            <div className="font-semibold text-fd-foreground">{entry.title}</div>
            {entry.body ? <p className="mt-1 line-clamp-6 leading-relaxed text-fd-muted-foreground">{withInlineCode(entry.body)}</p> : null}
            <Link href={href} className="mt-2 inline-block text-xs text-fd-primary no-underline outline-none hover:underline">
              {lang === 'zh' ? '跳转到定义 →' : 'Go to definition →'}
            </Link>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
