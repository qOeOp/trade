import Link from 'next/link';
import rdEntries from '@/lib/generated/rd-entries.json';
import type { Locale } from '@/lib/i18n';
import { Mermaid } from '@/components/mdx/mermaid';

export const homeDescription: Record<Locale, string> = {
  en: 'The research chain: a continuous loop of registered hypotheses on a candidate lineage, with trust boundaries enforced in code.',
  zh: '研发长链：在候选谱系上不停登记、回放、比较、反馈的循环，只有信任边界由代码强制。',
};

type Chapter = { slug: string; prefix: string; title: Record<Locale, string> };

const chapters: Chapter[] = [
  { slug: 'principles', prefix: 'A', title: { zh: '总则', en: 'Principles' } },
  { slug: 'entry', prefix: 'E', title: { zh: '入口', en: 'Entry' } },
  { slug: 'library', prefix: 'L', title: { zh: '策略库', en: 'Strategy Library' } },
  { slug: 'lineage', prefix: 'T', title: { zh: '候选谱系', en: 'Candidate Lineage' } },
  { slug: 'hypothesis', prefix: 'H', title: { zh: '提假设', en: 'Hypothesis' } },
  { slug: 'comparison', prefix: 'V', title: { zh: '比较证据', en: 'Comparison Evidence' } },
  { slug: 'feedback', prefix: 'F', title: { zh: '反馈与优先级', en: 'Feedback and Priority' } },
  { slug: 'validation', prefix: 'X', title: { zh: '样本外验证', en: 'Out-of-Sample Validation' } },
  { slug: 'strategy-file', prefix: 'C', title: { zh: '策略文件', en: 'Strategy File' } },
  { slug: 'replay-environment', prefix: 'W', title: { zh: '回放环境', en: 'Replay Environment' } },
  { slug: 'audit', prefix: 'G', title: { zh: '完整性审计与证据资格', en: 'Integrity Audit and Evidence Eligibility' } },
  { slug: 'report', prefix: 'R', title: { zh: '报告', en: 'Report' } },
  { slug: 'ledger-runtime', prefix: 'J', title: { zh: '账本与运行环境', en: 'Ledger and Runtime' } },
  { slug: 'changes', prefix: 'D', title: { zh: '变化之后', en: 'After Changes' } },
];

const copy: Record<Locale, { title: string; intro: string; rules: string[]; loop: string; chapters: string; read: string }> = {
  zh: {
    title: '研发长链',
    intro:
      '研发是一个不停的循环：入口恢复状态并给出综合推荐，用户选研究路线；Agent 在路线内提假设、回放前登记并锁定、原生预检后回放；完整性审计与实质活动资格决定一次回放算不算经济证据；配对检验给出效应、区间和 p；反馈更新研究优先级，次数触发复盘。所有完整版本都是候选，认不认可由用户看报告后判断。',
    rules: ['登记先于回放并锁定；完整性审计不过或没有实质活动的回放不提供经济证据。', '比较只给效应、区间和 p，不做采纳裁决；账本只追加，运行环境按摘要钉死。'],
    loop: 'flowchart LR\n  E[入口：恢复状态与综合推荐] --> H[提假设：登记五样并锁定]\n  H --> P[原生预检与独立审查]\n  P --> G[回放：完整性审计与活动资格]\n  G --> V[比较证据：效应、区间、p]\n  V --> F[反馈：优先级与复盘]\n  F --> H\n  F -->|换路线| E\n  V --> T[候选谱系与推荐]\n  T --> E\n  L[策略库：根节点] --> E\n  T -.->|用户发起| X[样本外验证]',
    chapters: '章节',
    read: '阅读文档',
  },
  en: {
    title: 'Research Chain',
    intro:
      'Research is a continuous loop: the entry restores state and gives a multi-dimensional recommendation, the user picks a research line; within it the Agent proposes hypotheses, registers and locks them before replay, prechecks natively, then replays; the integrity audit and substantive-activity eligibility decide whether a replay counts as economic evidence; the paired test reports effect, interval and p; feedback updates research priority and attempt counts trigger reviews. Every complete version is a candidate; acceptance is the user\'s judgement after reading the report.',
    rules: ['Registration precedes and locks every replay; a replay that fails the integrity audit or shows no substantive activity yields no economic evidence.', 'Comparison reports effect, interval and p without an adoption verdict; the ledger is append-only and the runtime image is digest-pinned.'],
    loop: 'flowchart LR\n  E[Entry: restore state, recommend] --> H[Hypothesis: register five items, lock]\n  H --> P[Native precheck and independent review]\n  P --> G[Replay: integrity audit, activity eligibility]\n  G --> V[Comparison: effect, interval, p]\n  V --> F[Feedback: priority and review]\n  F --> H\n  F -->|change line| E\n  V --> T[Candidate lineage and recommendation]\n  T --> E\n  L[Strategy library: roots] --> E\n  T -.->|user initiated| X[Out-of-sample validation]',
    chapters: 'Chapters',
    read: 'Read the documentation',
  },
};

// Design pages and appendices come from the generated page table, so new design entries need no edit here.
type Entry = [slug: string, source: string, english: string, chinese: string, group: string];
const generated = rdEntries as Entry[];
const linkGroups: Array<{ group: string; title: Record<Locale, string> }> = [
  { group: 'design', title: { zh: '设计', en: 'Design' } },
  { group: 'appendices', title: { zh: '附录', en: 'Appendices' } },
];

export function HomePageContent({ locale }: { locale: Locale }) {
  const t = copy[locale];
  return (
    <main className="relative flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-(--fd-layout-width) px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-4 max-w-3xl text-fd-muted-foreground">{t.intro}</p>
        <ol className="mt-4 max-w-3xl list-decimal space-y-1 pl-6">
          {t.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
        <Mermaid chart={t.loop} />
        <Link href={`/${locale}/docs`} className="inline-block rounded-md border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent">
          {t.read}
        </Link>
        <h2 className="mt-10 text-xl font-semibold">{t.chapters}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {chapters.map((chapter) => (
            <li key={chapter.slug}>
              <Link
                href={`/${locale}/docs/${chapter.slug}`}
                className="flex items-baseline gap-3 rounded-lg border border-fd-border bg-fd-card p-4 hover:border-fd-primary"
              >
                <span className="font-mono text-sm text-fd-primary">{chapter.prefix}</span>
                <span className="font-medium">{chapter.title[locale]}</span>
              </Link>
            </li>
          ))}
        </ul>
        {linkGroups.map(({ group, title }) => (
          <section key={group}>
            <h2 className="mt-10 text-xl font-semibold">{title[locale]}</h2>
            <ul className="mt-4 flex flex-wrap gap-3">
              {generated
                .filter((entry) => entry[4] === group)
                .map(([slug, , english, chinese]) => (
                  <li key={slug}>
                    <Link href={`/${locale}/docs/${slug}`} className="rounded-md border border-fd-border px-3 py-1.5 text-sm hover:bg-fd-accent">
                      {locale === 'zh' ? chinese : english}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
