import Link from 'next/link';
import { ArrowUpRight, Code2, Database, BookOpen } from 'lucide-react';
import entries from '@/lib/generated/rd-entries.json';
import type { Locale } from '@/lib/i18n';

const sections = [
  { group: 'code', number: '4.1', label: 'Code', zh: '代码', icon: Code2,
    description: { zh: '执行、身份与强制检查', en: 'Execution, identity and enforced contracts' } },
  { group: 'database', number: '4.2', label: 'Database', zh: '数据库', icon: Database,
    description: { zh: '事实、关联与读取视图', en: 'Facts, relations and read views' } },
  { group: 'skill', number: '4.3', label: 'Skill', zh: '研究技能', icon: BookOpen,
    description: { zh: '研究方法、证据与诊断', en: 'Research methods, evidence and diagnosis' } },
];

export function ArchitectureOverview({ locale = 'zh' }: { locale?: Locale }) {
  return (
    <div className="not-prose my-8 grid gap-4 xl:grid-cols-3">
      {sections.map(({ group, number, label, zh, icon: Icon, description }) => (
        <section key={group} className="min-w-0 overflow-hidden rounded-md border border-fd-border bg-fd-card">
          <div className="border-b border-fd-border bg-fd-muted/35 p-5">
            <div className="mb-3 flex items-center justify-between text-fd-muted-foreground">
              <Icon className="size-5" aria-hidden />
              <span className="font-mono text-xs">{number}</span>
            </div>
            <h3 className="m-0 text-[15px] font-semibold text-fd-foreground">{label}
              {locale === 'zh' && <span className="ml-2 text-sm font-normal text-fd-muted-foreground">{zh}</span>}
            </h3>
            <p className="mb-0 mt-1 text-xs leading-5 text-fd-muted-foreground">{description[locale]}</p>
          </div>
          <ul className="m-0 list-none p-2">
            {entries.filter((entry) => entry[4] === group).map(([slug, , en, zhTitle]) => (
              <li key={slug}>
                <Link href={`/${locale}/docs/${slug}/`} className="group flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm leading-5 text-fd-foreground no-underline transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-fd-ring">
                  <span className="min-w-0 break-words">
                    {locale === 'zh' ? zhTitle : en}
                    {group === 'skill' && <span className="mt-0.5 block font-mono text-[11px] text-fd-muted-foreground">{slug.replace('design-skill-', '')}</span>}
                  </span>
                  <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-fd-muted-foreground group-hover:text-fd-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
