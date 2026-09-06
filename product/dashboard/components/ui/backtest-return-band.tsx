"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { area, curveLinear, line } from "d3-shape";
import { motion, useReducedMotion } from "framer-motion";
import {
  formatBacktestReturn,
  normalizeBacktestReturnBandProjection,
  type BacktestReturnBandPoint,
  type BacktestReturnBandProjection,
  type BacktestReturnSeries,
  type BacktestReturnValuePoint,
} from "../../lib/backtest-return-band-contract";
import {
  bandValues,
  buildBacktestBrushSegments,
  buildBacktestDrawdownRows,
  buildBacktestMonthLayers,
  clampBacktestWindow,
  nearestBacktestPointIndex,
} from "../../lib/backtest-return-band-layout";
import { EmptyState, UnavailableState } from "./evidence-strip";
import { InterfaceIcons, ModuleIcons } from "./iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
  PanelFrameIconAction,
} from "./panel-frame";
import styles from "./backtest-return-band.module.css";

const CHART_HEIGHT = 340;
const MARGINS = { top: 34, right: 18, bottom: 36, left: 52 };

type ChartGeometry = Readonly<{
  width: number;
  plotWidth: number;
  plotHeight: number;
  xScale: ReturnType<typeof scalePoint<string>>;
  yScale: ReturnType<typeof scaleLinear<number, number>>;
  yTicks: number[];
  outerPath: string;
  innerPath: string;
  medianPath: string;
}>;

function formatUtcDate(timestamp: string, withYear = false): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function seriesWithinWindow(
  series: BacktestReturnSeries | null,
  timestamps: ReadonlySet<string>,
): BacktestReturnValuePoint[] {
  return series?.points.filter((point) => timestamps.has(point.at)) ?? [];
}

function buildLinePath(
  points: readonly BacktestReturnValuePoint[],
  geometry: ChartGeometry,
): string {
  return line<BacktestReturnValuePoint>()
    .x((point) => geometry.xScale(point.at) ?? 0)
    .y((point) => geometry.yScale(point.value))
    .curve(curveLinear)(points) ?? "";
}

function projectionLabel(projection: BacktestReturnBandProjection): string {
  if (projection.availability === "loading") return "Loading Backtest result";
  if (projection.availability === "unavailable") return "Backtest result unavailable";
  return `Backtest result ${projection.resultIdentity}`;
}

export function BacktestReturnBand({
  projection,
  title = "Return distribution",
  eyebrow = "Owner-sealed Backtest result",
}: {
  projection: unknown;
  title?: string;
  eyebrow?: string;
}) {
  const safeProjection = useMemo(
    () => normalizeBacktestReturnBandProjection(projection),
    [projection],
  );
  const [window, setWindow] = useState({ start: 0, end: 0 });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    setWindow({ start: 0, end: Math.max(0, safeProjection.points.length - 1) });
    setHoveredIndex(null);
  }, [safeProjection.resultIdentity, safeProjection.points.length]);

  const hoveredPoint = hoveredIndex === null ? null : safeProjection.points[hoveredIndex] ?? null;
  const hoverTimestamp = hoveredPoint?.at ?? null;
  const strategyByTimestamp = useMemo(
    () => new Map(safeProjection.strategy?.points.map((point) => [point.at, point.value]) ?? []),
    [safeProjection.strategy],
  );
  const benchmarkByTimestamp = useMemo(
    () => new Map(safeProjection.benchmark?.points.map((point) => [point.at, point.value]) ?? []),
    [safeProjection.benchmark],
  );

  const hoverReadout = hoveredPoint ? (
    <div className={styles.readout} aria-live="polite">
      <time>{formatUtcDate(hoveredPoint.at, true)}</time>
      <span>Median <b>{formatBacktestReturn(hoveredPoint.median)}</b></span>
      {hoverTimestamp && strategyByTimestamp.has(hoverTimestamp) ? (
        <span>Strategy <b>{formatBacktestReturn(strategyByTimestamp.get(hoverTimestamp) ?? 0)}</b></span>
      ) : null}
      {hoverTimestamp && benchmarkByTimestamp.has(hoverTimestamp) ? (
        <span>Benchmark <b>{formatBacktestReturn(benchmarkByTimestamp.get(hoverTimestamp) ?? 0)}</b></span>
      ) : null}
    </div>
  ) : undefined;

  return (
    <PanelFrame className={styles.frame} aria-label={projectionLabel(safeProjection)}>
      <PanelFrameHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={safeProjection.availability === "available" ? safeProjection.resultIdentity : undefined}
        actions={hoverReadout}
        layout="inline"
      />
      <PanelFrameBody className={styles.body} mode="static">
        <BacktestReturnBandBody
          projection={safeProjection}
          window={window}
          setWindow={setWindow}
          hoveredIndex={hoveredIndex}
          setHoveredIndex={setHoveredIndex}
        />
      </PanelFrameBody>
      <PanelFrameFooter className={styles.footer} layout="split">
        <BacktestReturnLegend projection={safeProjection} />
        {safeProjection.availability === "available" && safeProjection.points.length > 1 ? (
          <div className={styles.windowMeta}>
            <span>{formatUtcDate(safeProjection.points[window.start]?.at ?? safeProjection.points[0].at, true)}</span>
            <i aria-hidden="true" />
            <span>{formatUtcDate(safeProjection.points[window.end]?.at ?? safeProjection.points.at(-1)?.at ?? safeProjection.points[0].at, true)}</span>
            <PanelFrameIconAction
              aria-label="Reset time window"
              title="Reset time window"
              disabled={window.start === 0 && window.end === safeProjection.points.length - 1}
              onClick={() => setWindow({ start: 0, end: safeProjection.points.length - 1 })}
            >
              <InterfaceIcons.refresh aria-hidden="true" size={13} />
            </PanelFrameIconAction>
          </div>
        ) : <span />}
      </PanelFrameFooter>
    </PanelFrame>
  );
}

function BacktestReturnLegend({ projection }: { projection: BacktestReturnBandProjection }) {
  return (
    <div className={styles.legend} aria-label="Chart legend">
      <span data-tone="band"><i />Q1-Q3 range</span>
      <span data-tone="median"><i />Median</span>
      {projection.strategy ? <span data-tone="strategy"><i />{projection.strategy.label}</span> : null}
      {projection.benchmark ? <span data-tone="benchmark"><i />{projection.benchmark.label}</span> : null}
    </div>
  );
}

function BacktestReturnBandBody({
  projection,
  window,
  setWindow,
  hoveredIndex,
  setHoveredIndex,
}: {
  projection: BacktestReturnBandProjection;
  window: { start: number; end: number };
  setWindow: (value: { start: number; end: number }) => void;
  hoveredIndex: number | null;
  setHoveredIndex: (value: number | null) => void;
}) {
  if (projection.availability === "loading") {
    return <div className={styles.state} aria-busy="true"><span className={styles.loader} />Loading Backtest result…</div>;
  }
  if (projection.availability === "unavailable") {
    return (
      <UnavailableState
        density="compact"
        icon={<ModuleIcons.activity aria-hidden="true" size={17} />}
        title="Return curve unavailable"
        detail="No verified Backtest result is available."
        reason={projection.reason ?? "BACKTEST_RESULT_UNAVAILABLE"}
      />
    );
  }
  if (projection.points.length === 0) {
    return (
      <EmptyState density="compact" icon={<ModuleIcons.activity aria-hidden="true" size={17} />} title="No return observations">
        The sealed result contains no time-series points.
      </EmptyState>
    );
  }
  return (
    <BacktestReturnCanvas
      projection={projection}
      window={window}
      setWindow={setWindow}
      hoveredIndex={hoveredIndex}
      setHoveredIndex={setHoveredIndex}
    />
  );
}

function BacktestReturnCanvas({
  projection,
  window,
  setWindow,
  hoveredIndex,
  setHoveredIndex,
}: {
  projection: BacktestReturnBandProjection;
  window: { start: number; end: number };
  setWindow: (value: { start: number; end: number }) => void;
  hoveredIndex: number | null;
  setHoveredIndex: (value: number | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const reactId = useId().replaceAll(":", "");

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const boundedWindow = clampBacktestWindow(window.start, window.end, projection.points.length);
  const visiblePoints = projection.points.slice(boundedWindow.start, boundedWindow.end + 1);
  const visibleTimestamps = useMemo(
    () => new Set(visiblePoints.map((point) => point.at)),
    [visiblePoints],
  );
  const visibleStrategy = seriesWithinWindow(projection.strategy, visibleTimestamps);
  const visibleBenchmark = seriesWithinWindow(projection.benchmark, visibleTimestamps);
  const geometry = useMemo(
    () => buildChartGeometry(width, visiblePoints, visibleStrategy, visibleBenchmark),
    [visibleBenchmark, visiblePoints, visibleStrategy, width],
  );
  const monthLayers = useMemo(() => buildBacktestMonthLayers(visiblePoints), [visiblePoints]);
  const brushSegments = useMemo(() => buildBacktestBrushSegments(visibleStrategy), [visibleStrategy]);
  const drawdownRows = useMemo(
    () => buildBacktestDrawdownRows(visibleStrategy, geometry.yScale),
    [geometry.yScale, visibleStrategy],
  );
  const strategyPath = useMemo(() => buildLinePath(visibleStrategy, geometry), [geometry, visibleStrategy]);
  const benchmarkPath = useMemo(() => buildLinePath(visibleBenchmark, geometry), [geometry, visibleBenchmark]);

  const localIndexFromPointer = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return nearestBacktestPointIndex(
      event.clientX,
      bounds.left,
      bounds.width,
      visiblePoints.length,
    );
  }, [visiblePoints.length]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    const localIndex = localIndexFromPointer(event);
    setHoveredIndex(boundedWindow.start + localIndex);
    if (drag) setDrag({ ...drag, current: localIndex });
  }, [boundedWindow.start, drag, localIndexFromPointer, setHoveredIndex]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (visiblePoints.length < 4) return;
    const localIndex = localIndexFromPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ start: localIndex, current: localIndex });
  }, [localIndexFromPointer, visiblePoints.length]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const start = Math.min(drag.start, drag.current);
    const end = Math.max(drag.start, drag.current);
    setDrag(null);
    if (end - start < 2) return;
    setWindow(clampBacktestWindow(
      boundedWindow.start + start,
      boundedWindow.start + end,
      projection.points.length,
    ));
  }, [boundedWindow.start, drag, projection.points.length, setWindow]);

  const hoverLocalIndex = hoveredIndex === null ? -1 : hoveredIndex - boundedWindow.start;
  const hoverPoint = visiblePoints[hoverLocalIndex];
  const hoverX = hoverPoint ? geometry.xScale(hoverPoint.at) ?? null : null;
  const dragStartX = drag ? geometry.xScale(visiblePoints[drag.start]?.at ?? "") ?? 0 : 0;
  const dragEndX = drag ? geometry.xScale(visiblePoints[drag.current]?.at ?? "") ?? 0 : 0;

  return (
    <div ref={shellRef} className={styles.chartShell}>
      {width > 0 ? (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          role="img"
          aria-label="Backtest return distribution over time"
          onDoubleClick={() => setWindow({ start: 0, end: projection.points.length - 1 })}
        >
          <defs>
            <linearGradient id={`band-outer-${reactId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.outerStopTop} />
              <stop offset="1" className={styles.outerStopBottom} />
            </linearGradient>
            <linearGradient id={`band-inner-${reactId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.innerStopTop} />
              <stop offset="1" className={styles.innerStopBottom} />
            </linearGradient>
            <clipPath id={`plot-${reactId}`}>
              <rect x={MARGINS.left} y={MARGINS.top} width={geometry.plotWidth} height={geometry.plotHeight} />
            </clipPath>
          </defs>

          <g clipPath={`url(#plot-${reactId})`}>
            <MonthLayerRects layers={monthLayers} points={visiblePoints} geometry={geometry} />
            <DrawdownRows rows={drawdownRows} points={visibleStrategy} geometry={geometry} />
            <motion.path
              d={geometry.outerPath}
              fill={`url(#band-outer-${reactId})`}
              initial={reducedMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
            />
            <motion.path
              d={geometry.innerPath}
              fill={`url(#band-inner-${reactId})`}
              initial={reducedMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
            />
            {benchmarkPath ? <path d={benchmarkPath} className={styles.benchmarkLine} /> : null}
            {brushSegments.length > 0 ? (
              <g className={styles.strategyBrush}>
                {brushSegments.map((segment) => {
                  const path = buildLinePath(segment.points, geometry);
                  return <path key={`knockout-${segment.key}`} d={path} className={styles.strategyKnockout} style={{ strokeWidth: 4 * segment.widthFactor }} />;
                })}
                {brushSegments.map((segment) => {
                  const path = buildLinePath(segment.points, geometry);
                  return <path key={segment.key} d={path} className={styles.strategyLine} style={{ strokeWidth: 2 * segment.widthFactor }} />;
                })}
              </g>
            ) : strategyPath ? <path d={strategyPath} className={styles.strategyLine} /> : null}
            <motion.path
              d={geometry.medianPath}
              className={styles.medianLine}
              initial={reducedMotion ? undefined : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.72, ease: "easeInOut" }}
            />
            {hoverX !== null ? <line x1={hoverX} x2={hoverX} y1={MARGINS.top} y2={MARGINS.top + geometry.plotHeight} className={styles.crosshair} /> : null}
            {drag ? (
              <rect
                x={Math.min(dragStartX, dragEndX)}
                y={MARGINS.top}
                width={Math.abs(dragEndX - dragStartX)}
                height={geometry.plotHeight}
                className={styles.brushSelection}
              />
            ) : null}
          </g>
          <ChartAxes points={visiblePoints} geometry={geometry} />
          <rect
            x={MARGINS.left}
            y={MARGINS.top}
            width={geometry.plotWidth}
            height={geometry.plotHeight}
            className={styles.interactionLayer}
            onPointerEnter={handlePointerMove}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => { if (!drag) setHoveredIndex(null); }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrag(null)}
          />
        </svg>
      ) : null}
      <div className={styles.zoomHint} aria-hidden="true">
        <span>Drag across the chart to focus a time window</span>
        <span>Double-click to reset</span>
      </div>
    </div>
  );
}

function buildChartGeometry(
  width: number,
  points: readonly BacktestReturnBandPoint[],
  strategy: readonly BacktestReturnValuePoint[],
  benchmark: readonly BacktestReturnValuePoint[],
): ChartGeometry {
  const plotWidth = Math.max(1, width - MARGINS.left - MARGINS.right);
  const plotHeight = CHART_HEIGHT - MARGINS.top - MARGINS.bottom;
  const timestamps = points.map((point) => point.at);
  const xScale = scalePoint<string>().domain(timestamps).range([MARGINS.left, MARGINS.left + plotWidth]);
  const values = [...bandValues(points), ...strategy.map((point) => point.value), ...benchmark.map((point) => point.value)];
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const spread = Math.max(1, maximum - minimum);
  const yScale = scaleLinear<number, number>()
    .domain([minimum - spread * 0.08, maximum + spread * 0.08])
    .nice(5)
    .range([MARGINS.top + plotHeight, MARGINS.top]);
  const x = (point: BacktestReturnBandPoint) => xScale(point.at) ?? 0;
  const outerPath = area<BacktestReturnBandPoint>()
    .x(x).y0((point) => yScale(point.min)).y1((point) => yScale(point.max)).curve(curveLinear)(points) ?? "";
  const innerPath = area<BacktestReturnBandPoint>()
    .x(x).y0((point) => yScale(point.q1)).y1((point) => yScale(point.q3)).curve(curveLinear)(points) ?? "";
  const medianPath = line<BacktestReturnBandPoint>()
    .x(x).y((point) => yScale(point.median)).curve(curveLinear)(points) ?? "";
  return { width, plotWidth, plotHeight, xScale, yScale, yTicks: yScale.ticks(5), outerPath, innerPath, medianPath };
}

function MonthLayerRects({
  layers,
  points,
  geometry,
}: {
  layers: ReturnType<typeof buildBacktestMonthLayers>;
  points: readonly BacktestReturnBandPoint[];
  geometry: ChartGeometry;
}) {
  return layers.map((layer) => {
    const x = geometry.xScale(points[layer.startIndex]?.at ?? "") ?? MARGINS.left;
    if (layer.mode === "divider") {
      return <line key={layer.key} x1={x} x2={x} y1={MARGINS.top} y2={MARGINS.top + geometry.plotHeight} className={styles.periodDivider} />;
    }
    const endX = geometry.xScale(points[layer.endIndex]?.at ?? "") ?? x;
    return <rect key={layer.key} x={x} y={MARGINS.top} width={Math.max(geometry.xScale.step(), endX - x + geometry.xScale.step())} height={geometry.plotHeight} className={styles.monthStripe} />;
  });
}

function DrawdownRows({
  rows,
  points,
  geometry,
}: {
  rows: ReturnType<typeof buildBacktestDrawdownRows>;
  points: readonly BacktestReturnValuePoint[];
  geometry: ChartGeometry;
}) {
  const rowStep = 4;
  const dashWidth = Math.max(1, geometry.xScale.step() * 0.72);
  return (
    <g className={styles.drawdownRows}>
      {rows.map((row) => (
        <path
          key={row.key}
          d={row.indices.map((index) => {
            const x = (geometry.xScale(points[index]?.at ?? "") ?? 0) - dashWidth / 2;
            const y = MARGINS.top + row.key * rowStep + 1;
            return `M${x},${y}h${dashWidth}`;
          }).join("")}
        />
      ))}
    </g>
  );
}

function ChartAxes({
  points,
  geometry,
}: {
  points: readonly BacktestReturnBandPoint[];
  geometry: ChartGeometry;
}) {
  const tickCount = Math.max(2, Math.min(6, Math.floor(geometry.plotWidth / 120)));
  const tickIndices = Array.from({ length: tickCount }, (_, index) => (
    Math.round((points.length - 1) * (index / Math.max(1, tickCount - 1)))
  ));
  return (
    <g aria-hidden="true">
      {geometry.yTicks.map((tick) => {
        const y = geometry.yScale(tick);
        return (
          <g key={tick}>
            <line x1={MARGINS.left} x2={MARGINS.left + geometry.plotWidth} y1={y} y2={y} className={styles.gridline} />
            <text x={MARGINS.left - 10} y={y + 3} textAnchor="end" className={styles.axisLabel}>{formatBacktestReturn(tick)}</text>
          </g>
        );
      })}
      {tickIndices.map((pointIndex, index) => {
        const point = points[pointIndex];
        if (!point) return null;
        const x = geometry.xScale(point.at) ?? 0;
        return (
          <text
            key={`${point.at}-${index}`}
            x={x}
            y={CHART_HEIGHT - 12}
            textAnchor={index === 0 ? "start" : index === tickIndices.length - 1 ? "end" : "middle"}
            className={styles.axisLabel}
          >
            {formatUtcDate(point.at, index === 0 || index === tickIndices.length - 1)}
          </text>
        );
      })}
    </g>
  );
}
