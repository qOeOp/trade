import type { Locale } from '@/lib/i18n';
import { ArchitectureMap } from '@/components/architecture-map';

export const homeDescription: Record<Locale, string> = {
  en: 'The product architecture: IDE, Paper, native Nautilus runtime, the Dolt research and market databases, and their read copies.',
  zh: '产品架构：IDE、Paper、Nautilus 原生运行环境、Dolt 研究与市场数据库，以及它们的只读副本。',
};

// The landing diagram shows system responsibilities; chapter detail lives in the docs.
export function HomePageContent({ locale }: { locale: Locale }) {
  return (
    <main className="docs-architecture-page relative flex flex-col">
      <div className="docs-home-container relative mx-auto w-full max-w-[1440px] px-4">
        <ArchitectureMap locale={locale} />
      </div>
    </main>
  );
}
