import type { Locale } from '@/lib/i18n';
import { ArchitectureMap } from '@/components/architecture-map';

export const homeDescription: Record<Locale, string> = {
  en: 'Research, backtest, and execute with governed strategy semantics.',
  zh: '以受治理的策略语义连接研究、回测与实盘执行。',
};

export function HomePageContent({ locale }: { locale: Locale }) {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="docs-home-container relative mx-auto w-full max-w-(--fd-layout-width) px-4">
        <ArchitectureMap locale={locale} />
      </div>
    </main>
  );
}
