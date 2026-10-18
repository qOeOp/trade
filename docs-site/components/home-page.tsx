import type { Locale } from '@/lib/i18n';
import { ResearchMap, ResearchMapHeader } from '@/components/research-map';

export const homeDescription: Record<Locale, string> = {
  en: 'The research chain: a continuous loop of registered hypotheses on a candidate lineage, with trust boundaries enforced in code.',
  zh: '研发长链：在候选谱系上不停登记、回放、比较、反馈的循环，只有信任边界由代码强制。',
};

// The home page is the map itself: every chapter as a node, the loop between them as edges.
export function HomePageContent({ locale }: { locale: Locale }) {
  return (
    <main className="relative flex flex-1 flex-col">
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-[560px] w-full flex-col">
        <ResearchMapHeader locale={locale} />
        <div className="min-h-0 flex-1">
          <ResearchMap locale={locale} />
        </div>
      </div>
    </main>
  );
}
