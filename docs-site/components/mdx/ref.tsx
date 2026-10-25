'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PreviewCard } from '@base-ui/react/preview-card';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import index from '@/lib/generated/rd-index.json';

type Entry = {
  kind: 'capability' | 'function' | 'table' | 'eval' | 'section' | 'node';
  title: string;
  body: string;
  signature?: string;
  slug: string;
  anchor: string;
  owner?: string;
  where?: string;
};

const data = index as Record<string, Record<string, Entry>>;

const KIND_LABEL: Record<string, Record<Entry['kind'], string>> = {
  zh: { capability: '能力', function: '函数', table: '表', eval: 'eval', section: 'skill 节', node: '节' },
  en: { capability: 'capability', function: 'function', table: 'table', eval: 'eval', section: 'skill section', node: 'section' },
};

/** Backtick-quoted identifiers in preview text render as inline code. */
function withInlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-fd-muted px-1 py-0.5 font-mono text-[0.85em] text-fd-foreground">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** Cross-reference: a link to the definition with a hover preview (no focus trap, so it never re-opens itself). */
export function Ref({ id, lang = 'zh', children }: { id: string; lang?: string; children?: ReactNode }) {
  const entry = data[lang]?.[id] ?? data.zh?.[id];
  // sections and capabilities read as their numbered section; the preview shows the exact capability
  const label = children ?? (entry ? ((entry.kind === 'capability' || entry.kind === 'node') && entry.where ? entry.where.split('：')[0] : entry.title) : id);

  if (!entry) {
    return <span className="rounded border border-dashed border-fd-border px-1 font-mono text-xs text-fd-muted-foreground">{label}</span>;
  }

  const href = `/${lang}/docs/${entry.slug}/#${entry.anchor}`;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={250}
        closeDelay={120}
        render={<Link href={href} className="rd-ref border-b border-dotted border-fd-primary/60 text-fd-primary no-underline hover:border-solid" />}
      >
        {label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <PreviewCard.Popup className="w-[min(32rem,92vw)] rounded-xl border bg-fd-popover p-3 text-sm text-fd-popover-foreground shadow-lg">
            {entry.signature ? (
              // Functions: kind, id and owner as comments on top of the signature, in one code block.
              <div className="rd-ref-code text-xs">
                <DynamicCodeBlock
                  lang="python"
                  code={`# ${KIND_LABEL[lang]?.[entry.kind] ?? entry.kind} ${id}\n${entry.owner ? `# ${lang === 'zh' ? '定义于' : 'defined in'} ${entry.owner}\n` : ''}${entry.signature}`}
                  codeblock={{ allowCopy: false }}
                />
              </div>
            ) : (
              <>
                <div className="mb-1 flex items-center gap-2 text-xs text-fd-muted-foreground">
                  <span className="rounded bg-fd-muted px-1.5 py-0.5 font-mono">{KIND_LABEL[lang]?.[entry.kind] ?? entry.kind}</span>
                  <span className={entry.where ? '' : 'font-mono'}>{entry.where ?? id}</span>
                  {entry.owner ? <span>{lang === 'zh' ? '定义于' : 'defined in'} {entry.owner}</span> : null}
                </div>
                <div className="font-medium text-fd-foreground">{entry.title}</div>
              </>
            )}
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
