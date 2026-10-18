'use client';

import { useEffect, useState } from 'react';
import { ResearchMap } from '@/components/research-map';
import type { Locale } from '@/lib/i18n';

const COPY = {
  zh: { open: '放大查看', close: '关闭', hint: '拖动平移，滚轮或双指缩放，点节点跳到对应的节' },
  en: { open: 'Open full screen', close: 'Close', hint: 'Drag to pan, scroll or pinch to zoom, click a node to jump to its section' },
};

/** A chapter's sections and components: static in the page, full screen with pan and zoom on demand. */
export function ChapterMap({ chapter, lang = 'zh' }: { chapter: string; lang?: string }) {
  const locale = (lang === 'en' ? 'en' : 'zh') as Locale;
  const t = COPY[locale];
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open]);
  return (
    <div className="rd-chapter-map not-prose">
      <div className="rd-chapter-map-frame">
        <ResearchMap locale={locale} chapter={chapter} interactive={false} />
        <button type="button" className="rd-chapter-map-open" onClick={() => setOpen(true)}>{t.open}</button>
      </div>
      {open ? (
        <div className="rd-chapter-map-full" role="dialog" aria-modal="true">
          <div className="rd-chapter-map-bar">
            <span>{t.hint}</span>
            <button type="button" onClick={() => setOpen(false)}>{t.close}</button>
          </div>
          <div className="rd-chapter-map-canvas">
            <ResearchMap locale={locale} chapter={chapter} interactive />
          </div>
        </div>
      ) : null}
    </div>
  );
}
