"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  filterMarketHeatmapItems,
  formatMarketHeatmapChange,
  marketHeatmapTone,
  normalizeMarketHeatmapProjection,
  type MarketHeatmapItem,
  type MarketHeatmapProjection,
} from "../../lib/market-heatmap-contract";
import {
  calculateRippleLayout,
  getAdaptiveStyles,
  getBorderRadius,
  getTargetSize,
  useMarketHeatmapLayout,
} from "../../lib/market-heatmap-layout";
import { EmptyState, UnavailableState } from "./evidence-strip";
import { InterfaceIcons, ModuleIcons } from "./iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
} from "./panel-frame";
import styles from "./market-heatmap.module.css";

export const MarketHeatmap = memo(function MarketHeatmap({
  projection,
  title = "Market heatmap",
  eyebrow = "Point-in-time market view",
}: {
  projection: MarketHeatmapProjection;
  title?: string;
  eyebrow?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const safeProjection = useMemo(
    () => normalizeMarketHeatmapProjection(projection),
    [projection],
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const filteredItems = useMemo(
    () => filterMarketHeatmapItems(safeProjection.items, deferredQuery),
    [deferredQuery, safeProjection.items],
  );
  const { layout, splitLineStructure } = useMarketHeatmapLayout(
    filteredItems,
    dimensions.width,
    dimensions.height,
  );
  const hoveredIndex = layout.findIndex((tile) => tile.data.id === hoveredId);
  const { targetW, targetH } = getTargetSize(
    dimensions.width,
    dimensions.height,
    filteredItems.length,
  );
  const displayedLayout = useMemo(() => {
    if (hoveredIndex < 0 || !splitLineStructure) return layout;
    const hovered = layout[hoveredIndex];
    if (!hovered || (hovered.width >= targetW && hovered.height >= targetH)) return layout;
    return calculateRippleLayout(
      layout,
      splitLineStructure,
      hoveredIndex,
      dimensions.width,
      dimensions.height,
      targetW,
      targetH,
    );
  }, [dimensions.height, dimensions.width, hoveredIndex, layout, splitLineStructure, targetH, targetW]);
  const { minArea, maxArea } = useMemo(() => {
    if (layout.length === 0) return { minArea: 0, maxArea: 0 };
    const areas = layout.map((tile) => tile.width * tile.height);
    return { minArea: Math.min(...areas), maxArea: Math.max(...areas) };
  }, [layout]);

  const search = (
    <label className={styles.search}>
      <InterfaceIcons.search aria-hidden="true" size={15} />
      <span className="sr-only">Search instruments</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search instruments"
        disabled={safeProjection.availability !== "available"}
      />
      {query ? (
        <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
          <InterfaceIcons.close aria-hidden="true" size={13} />
        </button>
      ) : null}
    </label>
  );

  return (
    <PanelFrame className={styles.frame} aria-labelledby="market-heatmap-title">
      <PanelFrameHeader
        eyebrow={eyebrow}
        title={<span id="market-heatmap-title">{title}</span>}
        actions={search}
        layout="inline"
      />
      <PanelFrameBody className={styles.body} bodyRef={bodyRef} mode="static">
        <MarketHeatmapBody
          projection={safeProjection}
          query={query}
          layout={displayedLayout}
          minArea={minArea}
          maxArea={maxArea}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          clearSearch={() => setQuery("")}
          dimensions={dimensions}
        />
      </PanelFrameBody>
      <PanelFrameFooter className={styles.legend}>
        <span><i data-tone="loss-strong" />Loss</span>
        <span><i data-tone="neutral" />Flat</span>
        <span><i data-tone="gain-strong" />Gain</span>
        <small>Area reflects Owner-projected weight</small>
      </PanelFrameFooter>
    </PanelFrame>
  );
});

function MarketHeatmapBody({
  projection,
  query,
  layout,
  minArea,
  maxArea,
  hoveredId,
  setHoveredId,
  clearSearch,
  dimensions,
}: {
  projection: MarketHeatmapProjection;
  query: string;
  layout: ReturnType<typeof useMarketHeatmapLayout>["layout"];
  minArea: number;
  maxArea: number;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  clearSearch: () => void;
  dimensions: { width: number; height: number };
}) {
  if (projection.availability === "loading") {
    return <div className={styles.state} aria-busy="true"><span className={styles.loader} />Loading market cut…</div>;
  }
  if (projection.availability === "unavailable") {
    return (
      <UnavailableState
        density="compact"
        icon={<ModuleIcons.chart aria-hidden="true" size={17} />}
        title="Market heatmap unavailable"
        detail="No verified market cut is available."
        reason={projection.reason ?? "OWNER_MARKET_PROJECTION_UNAVAILABLE"}
      />
    );
  }
  if (projection.items.length === 0) {
    return <EmptyState density="compact" title="No market observations" icon={<ModuleIcons.chart aria-hidden="true" size={17} />}>The current Owner cut contains no heatmap members.</EmptyState>;
  }
  if (layout.length === 0 && query) {
    return (
      <div className={styles.state}>
        <span>No instruments match &quot;{query}&quot;.</span>
        <button type="button" onClick={clearSearch}>Clear search</button>
      </div>
    );
  }

  return (
    <div className={styles.canvas} role="list" aria-label="Market heatmap instruments">
      {layout.map((tile) => (
        <MarketHeatmapTile
          key={tile.data.id}
          item={tile.data}
          geometry={tile}
          dimensions={dimensions}
          minArea={minArea}
          maxArea={maxArea}
          active={hoveredId === tile.data.id}
          onActiveChange={(active) => setHoveredId(active ? tile.data.id : null)}
        />
      ))}
    </div>
  );
}

function MarketHeatmapTile({
  item,
  geometry,
  dimensions,
  minArea,
  maxArea,
  active,
  onActiveChange,
}: {
  item: MarketHeatmapItem;
  geometry: ReturnType<typeof useMarketHeatmapLayout>["layout"][number];
  dimensions: { width: number; height: number };
  minArea: number;
  maxArea: number;
  active: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const adaptive = getAdaptiveStyles(geometry.width, geometry.height, item.label, maxArea, minArea);
  const style = {
    left: geometry.x,
    top: geometry.y,
    width: geometry.width,
    height: geometry.height,
    borderRadius: getBorderRadius(
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
      dimensions.width,
      dimensions.height,
      15,
    ),
    "--heatmap-pad": `${adaptive.pad.toFixed(1)}px`,
    "--heatmap-name-size": `${adaptive.nameSize.toFixed(1)}px`,
    "--heatmap-name-weight": adaptive.nameWeight,
    "--heatmap-change-size": `${adaptive.badgeSize.toFixed(1)}px`,
  } as CSSProperties;
  return (
    <article
      role="listitem"
      tabIndex={0}
      className={styles.tile}
      style={style}
      data-tone={marketHeatmapTone(item.changePercent)}
      data-active={active || undefined}
      data-vertical={adaptive.isVertical || undefined}
      data-compact={adaptive.hideBadge || undefined}
      aria-label={`${item.label}, ${formatMarketHeatmapChange(item.changePercent)}`}
      onPointerEnter={() => onActiveChange(true)}
      onPointerLeave={() => onActiveChange(false)}
      onFocus={() => onActiveChange(true)}
      onBlur={() => onActiveChange(false)}
    >
      <strong>{item.label}</strong>
      <span>{formatMarketHeatmapChange(item.changePercent)}</span>
    </article>
  );
}
