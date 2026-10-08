import type { Locale } from '@/lib/i18n';
import { ArchitectureMap } from '@/components/architecture-map';

export const homeDescription: Record<Locale, string> = {
  en: 'Explore the current Nautilus native strategy, replay, data and research evidence.',
  zh: '浏览当前 Nautilus 原生策略、回放、数据与研究证据。',
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
