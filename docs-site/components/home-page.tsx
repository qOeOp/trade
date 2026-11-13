import type { Locale } from '@/lib/i18n';
import { ArchitectureMap } from '@/components/architecture-map';

export const homeDescription: Record<Locale, string> = {
  en: 'The product architecture: IDE, Paper, Live, native Nautilus runtime, the Dolt research ledger with its public and recovery copies, and the market directory.',
  zh: '产品架构：IDE、Paper、Live、Nautilus 原生运行环境、Dolt 研究账本及其公开与恢复副本，以及市场目录。',
};

// The landing diagram shows system responsibilities; chapter detail lives in the docs.
export function HomePageContent({ locale }: { locale: Locale }) {
  return (
    <main className="docs-architecture-page relative flex flex-col">
      <div className="docs-home-container relative w-full">
        <ArchitectureMap locale={locale} />
      </div>
    </main>
  );
}
