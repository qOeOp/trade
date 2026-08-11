import Link from 'next/link';

const sections = [
  ['Getting Started', 'Install Vibe Trader and run your first backtest.', '/docs/getting_started'],
  ['Concepts', 'Architecture, data, execution, backtesting, and live trading.', '/docs/concepts'],
  ['How-To', 'Goal-oriented recipes for common development and trading tasks.', '/docs/how_to'],
  ['Tutorials', 'Runnable walkthroughs for strategies, data workflows, and Rust.', '/docs/tutorials'],
  ['Integrations', 'Venue and data-provider setup guides.', '/docs/integrations'],
  ['Developer Guide', 'Internals, testing standards, and contribution guidance.', '/docs/developer_guide'],
] as const;

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="docs-hero pointer-events-none absolute inset-x-0 top-0 h-[34rem]" />
      <div className="relative mx-auto w-full max-w-5xl px-6 py-20 md:py-28">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          Documentation for research, backtesting, and live execution
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-fd-muted-foreground">
          Start with the core architecture, build a reproducible backtest, then carry the same
          strategy semantics into live trading.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/docs/getting_started"
            className="rounded-lg bg-fd-primary px-5 py-3 font-medium text-fd-primary-foreground"
          >
            Get started
          </Link>
          <Link
            href="https://github.com/qOeOp/trade"
            className="rounded-lg border bg-fd-card px-5 py-3 font-medium"
          >
            View on GitHub
          </Link>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(([title, description, href]) => (
            <Link
              key={href}
              href={href}
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
