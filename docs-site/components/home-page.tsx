import type { Locale } from '@/lib/i18n';
import { ArchitectureMap } from '@/components/architecture-map';

export const homeDescription: Record<Locale, string> = {
  en: 'Explore the product blueprint for strategy and portfolio research, validation and governed trading.',
  zh: '探索策略与投资组合的研究、验证和受治理交易产品蓝图。',
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
