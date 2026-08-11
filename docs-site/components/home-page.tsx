import type { Locale } from '@/lib/i18n';
import Link from 'next/link';

export const homeContent = {
  en: {
    heading: 'Documentation for research, backtesting, and live execution',
    description:
      'Start with the core architecture, build a reproducible backtest, then carry the same strategy semantics into live trading.',
    getStarted: 'Get started',
    github: 'View on GitHub',
    sections: [
      ['Getting Started', 'Install Vibe Trader and run your first backtest.', 'getting_started'],
      ['Concepts', 'Architecture, data, execution, backtesting, and live trading.', 'concepts'],
      ['How-To', 'Goal-oriented recipes for common development and trading tasks.', 'how_to'],
      ['Tutorials', 'Runnable walkthroughs for strategies, data workflows, and Rust.', 'tutorials'],
      ['Integrations', 'Venue and data-provider setup guides.', 'integrations'],
      ['Developer Guide', 'Internals, testing standards, and contribution guidance.', 'developer_guide'],
    ],
  },
  zh: {
    heading: '面向研究、回测与实盘执行的文档',
    description: '从核心架构开始，构建可复现的回测，再将相同的策略语义带入实盘交易。',
    getStarted: '开始使用',
    github: '在 GitHub 查看',
    sections: [
      ['入门', '安装 Vibe Trader 并运行第一次回测。', 'getting_started'],
      ['核心概念', '了解架构、数据、执行、回测和实盘交易。', 'concepts'],
      ['操作指南', '面向常见开发与交易任务的目标导向步骤。', 'how_to'],
      ['教程', '涵盖策略、数据工作流与 Rust 的可运行演练。', 'tutorials'],
      ['集成', '交易场所与数据提供商的设置指南。', 'integrations'],
      ['开发者指南', '内部机制、测试标准与贡献指南。', 'developer_guide'],
    ],
  },
} satisfies Record<Locale, {
  heading: string;
  description: string;
  getStarted: string;
  github: string;
  sections: readonly (readonly [string, string, string])[];
}>;

export function HomePageContent({ locale }: { locale: Locale }) {
  const page = homeContent[locale];

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="docs-hero pointer-events-none absolute inset-x-0 top-0 h-[34rem]" />
      <div className="relative mx-auto w-full max-w-5xl px-6 py-20 md:py-28">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          {page.heading}
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-fd-muted-foreground">
          {page.description}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/${locale}/docs/getting_started`}
            className="rounded-lg bg-fd-primary px-5 py-3 font-medium text-fd-primary-foreground"
          >
            {page.getStarted}
          </Link>
          <Link
            href="https://github.com/qOeOp/trade"
            className="rounded-lg border bg-fd-card px-5 py-3 font-medium"
          >
            {page.github}
          </Link>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {page.sections.map(([title, description, slug]) => (
            <Link
              key={slug}
              href={`/${locale}/docs/${slug}`}
              className="rounded-xl border bg-fd-card/80 p-5 transition-colors hover:bg-fd-accent"
            >
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
