"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type BentoSize = "collapse" | "narrow" | "wide";

export function BentoGrid({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<BentoSize>("wide");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setSize(width < 560 ? "collapse" : width < 700 ? "narrow" : "wide");
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return <div className="bento-grid" data-size={size} ref={containerRef}>{children}</div>;
}
