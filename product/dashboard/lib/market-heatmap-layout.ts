import { useMemo } from "react";
import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyNode,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import type { MarketHeatmapItem } from "./market-heatmap-contract";

// ============ Types ============

export interface TileLayout {
  data: MarketHeatmapItem;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitLineStructure {
  vLines: Map<number, { idx: number; side: "left" | "right" }[]>;
  hLines: Map<number, { idx: number; side: "top" | "bottom" }[]>;
  vLineMap: Map<number, number>;
  hLineMap: Map<number, number>;
  vCanonicals: number[];
  hCanonicals: number[];
}

// ============ Constants ============

const BORDER = 2;
const MIN = 60; // Minimum tile size to preserve
const TOL = 2.5; // Tolerance for split-line grouping
const S = 1.35; // Y-stretch factor for horizontal bias

// ============ Utility Functions ============

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============ Split-Line Grouping ============

export function buildSplitLineStructure(layout: TileLayout[]): SplitLineStructure {
  const vEdges: number[] = [];
  const hEdges: number[] = [];

  layout.forEach((tile) => {
    vEdges.push(tile.x, tile.x + tile.width);
    hEdges.push(tile.y, tile.y + tile.height);
  });

  function groupEdges(edges: number[]) {
    const sorted = [...new Set(edges)].sort((a, b) => a - b);
    const groups: number[][] = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= TOL) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [sorted[i]];
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);

    return groups.map((group) => {
      const median = group[Math.floor(group.length / 2)];
      return { canonical: Math.round(median), values: group };
    });
  }

  const vGroups = groupEdges(vEdges);
  const hGroups = groupEdges(hEdges);

  const vLineMap = new Map<number, number>();
  const hLineMap = new Map<number, number>();

  vGroups.forEach((g) => g.values.forEach((v) => vLineMap.set(v, g.canonical)));
  hGroups.forEach((g) => g.values.forEach((v) => hLineMap.set(v, g.canonical)));

  const structure: SplitLineStructure = {
    vLines: new Map(),
    hLines: new Map(),
    vLineMap,
    hLineMap,
    vCanonicals: vGroups.map((g) => g.canonical).sort((a, b) => a - b),
    hCanonicals: hGroups.map((g) => g.canonical).sort((a, b) => a - b),
  };

  layout.forEach((tile, i) => {
    const l = vLineMap.get(tile.x) ?? 0;
    const r = vLineMap.get(tile.x + tile.width) ?? 0;
    const t = hLineMap.get(tile.y) ?? 0;
    const b = hLineMap.get(tile.y + tile.height) ?? 0;

    if (!structure.vLines.has(l)) structure.vLines.set(l, []);
    if (!structure.vLines.has(r)) structure.vLines.set(r, []);
    if (!structure.hLines.has(t)) structure.hLines.set(t, []);
    if (!structure.hLines.has(b)) structure.hLines.set(b, []);

    structure.vLines.get(l)?.push({ idx: i, side: "left" });
    structure.vLines.get(r)?.push({ idx: i, side: "right" });
    structure.hLines.get(t)?.push({ idx: i, side: "top" });
    structure.hLines.get(b)?.push({ idx: i, side: "bottom" });
  });

  return structure;
}

export function buildTileSpans(
  layout: TileLayout[],
  structure: SplitLineStructure,
  axis: "v" | "h"
): [number, number][] {
  const spans: [number, number][] = [];
  for (const tile of layout) {
    let lo: number | undefined;
    let hi: number | undefined;
    if (axis === "v") {
      lo = structure.vLineMap.get(tile.x);
      hi = structure.vLineMap.get(tile.x + tile.width);
    } else {
      lo = structure.hLineMap.get(tile.y);
      hi = structure.hLineMap.get(tile.y + tile.height);
    }
    if (lo !== undefined && hi !== undefined) {
      spans.push([lo, hi]);
    }
  }
  return spans;
}

// ============ Elastic Redistribute (Water Ripple Core) ============

export function elasticRedistribute(
  canonicals: number[],
  hovLo: number,
  hovHi: number,
  targetSize: number,
  vbLo: number,
  vbHi: number,
  tileSpans: [number, number][]
): Map<number, number> {
  const n = canonicals.length;
  const pos = new Map<number, number>();

  const idxLo = canonicals.indexOf(hovLo);
  const idxHi = canonicals.indexOf(hovHi);

  if (idxLo === -1 || idxHi === -1) {
    canonicals.forEach((c) => pos.set(c, c));
    return pos;
  }

  // Analyze region intervals for gradient compression
  function analyzeRegionIntervals(regionIndices: number[]) {
    const regionCans = regionIndices.map((i) => canonicals[i]);
    const intervals: {
      lo: number;
      hi: number;
      size: number;
      compressible: number;
      rate: number;
      weight: number;
      minSize: number;
      bestTileSize: number;
    }[] = [];
    let totalWeight = 0;
    let totalMinFootprint = 0;

    for (let k = 0; k < regionCans.length - 1; k++) {
      const intLo = regionCans[k];
      const intHi = regionCans[k + 1];
      const intSize = intHi - intLo;
      if (intSize < 0.01) continue;

      // Find the smallest tile that spans this interval
      let bestTileSize = Infinity;
      for (const [tLo, tHi] of tileSpans) {
        if (tLo === hovLo && tHi === hovHi) continue;
        if (tLo <= intLo && tHi >= intHi) {
          const ts = tHi - tLo;
          if (ts < bestTileSize) bestTileSize = ts;
        }
      }
      if (bestTileSize === Infinity) bestTileSize = intSize;

      // 5-tier gradient compression rate
      const compressible = Math.max(0, bestTileSize - MIN);
      let rate: number;
      if (compressible <= 5) rate = 0;
      else if (compressible <= 15) rate = 0.15;
      else if (compressible <= 40) rate = 0.4;
      else if (compressible <= 80) rate = 0.7;
      else rate = 1.0;

      const weight = intSize * rate;
      totalWeight += weight;

      const minSize =
        bestTileSize <= MIN ? intSize : intSize * (MIN / bestTileSize);
      totalMinFootprint += minSize;

      intervals.push({
        lo: intLo,
        hi: intHi,
        size: intSize,
        compressible,
        rate,
        weight,
        minSize,
        bestTileSize,
      });
    }

    const totalOrigRange =
      regionCans.length > 1
        ? regionCans[regionCans.length - 1] - regionCans[0]
        : 0;
    const trueCapacity = Math.max(0, totalOrigRange - totalMinFootprint);

    return { intervals, totalWeight, totalMinFootprint, totalOrigRange, trueCapacity };
  }

  const pinnedLeft = idxLo === 0;
  const pinnedRight = idxHi === n - 1;
  const origSize = hovHi - hovLo;
  const needExpand = targetSize - origSize;

  let newHovLo: number;
  let newHovHi: number;

  if (pinnedLeft && pinnedRight) {
    newHovLo = vbLo;
    newHovHi = vbHi;
  } else if (pinnedLeft) {
    newHovLo = vbLo;
    newHovHi = Math.min(vbLo + targetSize, vbHi);
  } else if (pinnedRight) {
    newHovHi = vbHi;
    newHovLo = Math.max(vbHi - targetSize, vbLo);
  } else {
    // Capacity-aware expansion
    const beforeIndices: number[] = [];
    for (let i = 0; i <= idxLo; i++) beforeIndices.push(i);
    const afterIndices: number[] = [];
    for (let i = idxHi; i < n; i++) afterIndices.push(i);

    const beforeAnalysis = analyzeRegionIntervals(beforeIndices);
    const afterAnalysis = analyzeRegionIntervals(afterIndices);

    const spaceBefore = hovLo - vbLo;
    const spaceAfter = vbHi - hovHi;

    const effBefore = Math.min(spaceBefore, beforeAnalysis.trueCapacity);
    const effAfter = Math.min(spaceAfter, afterAnalysis.trueCapacity);
    const totalEffective = effBefore + effAfter;

    let expandBefore: number;
    let expandAfter: number;

    if (totalEffective > 0.01) {
      expandBefore = needExpand * (effBefore / totalEffective);
      expandAfter = needExpand * (effAfter / totalEffective);
    } else {
      const totalSpace = spaceBefore + spaceAfter;
      if (totalSpace > 0.01) {
        expandBefore = needExpand * (spaceBefore / totalSpace);
        expandAfter = needExpand * (spaceAfter / totalSpace);
      } else {
        expandBefore = needExpand / 2;
        expandAfter = needExpand / 2;
      }
    }

    // Redistribute excess
    if (expandBefore > effBefore && effBefore < spaceBefore) {
      const excess = expandBefore - effBefore;
      expandBefore = effBefore;
      expandAfter += excess;
    }
    if (expandAfter > effAfter && effAfter < spaceAfter) {
      const excess = expandAfter - effAfter;
      expandAfter = effAfter;
      expandBefore += excess;
    }

    // Clamp to available space
    if (expandBefore > spaceBefore) {
      expandAfter += expandBefore - spaceBefore;
      expandBefore = spaceBefore;
    }
    if (expandAfter > spaceAfter) {
      expandBefore += expandAfter - spaceAfter;
      expandAfter = spaceAfter;
    }

    newHovLo = hovLo - expandBefore;
    newHovHi = hovHi + expandAfter;

    // Final bounds check
    if (newHovLo < vbLo) {
      newHovHi += vbLo - newHovLo;
      newHovLo = vbLo;
    }
    if (newHovHi > vbHi) {
      newHovLo -= newHovHi - vbHi;
      newHovHi = vbHi;
    }
    if (newHovLo < vbLo) newHovLo = vbLo;
    if (newHovHi > vbHi) newHovHi = vbHi;
  }

  // Gradient map region
  function gradientMapRegion(
    indices: number[],
    origStart: number,
    origEnd: number,
    newStart: number,
    newEnd: number
  ) {
    if (indices.length === 0) return;
    const origRange = origEnd - origStart;
    const newRange = newEnd - newStart;

    if (origRange < 0.01) {
      for (const idx of indices) pos.set(canonicals[idx], newStart);
      return;
    }

    if (newRange >= origRange - 0.5) {
      for (const idx of indices) {
        const c = canonicals[idx];
        pos.set(c, newStart + ((c - origStart) / origRange) * newRange);
      }
      return;
    }

    const analysis = analyzeRegionIntervals(indices);
    const totalCompression = origRange - newRange;

    if (analysis.totalWeight < 0.01) {
      for (const idx of indices) {
        const c = canonicals[idx];
        pos.set(c, newStart + ((c - origStart) / origRange) * newRange);
      }
      return;
    }

    const newSizes: number[] = [];
    let totalNewSize = 0;

    for (const iv of analysis.intervals) {
      let compressionShare =
        iv.weight > 0
          ? totalCompression * (iv.weight / analysis.totalWeight)
          : 0;

      const maxCompression = Math.max(0, iv.size - iv.minSize);
      compressionShare = Math.min(compressionShare, maxCompression);

      const ns = iv.size - compressionShare;
      newSizes.push(ns);
      totalNewSize += ns;
    }

    // Scale to fit
    if (Math.abs(totalNewSize - newRange) > 0.5 && totalNewSize > 0.01) {
      const scale = newRange / totalNewSize;
      for (let k = 0; k < newSizes.length; k++) newSizes[k] *= scale;
    }

    const regionCanonicals = indices.map((i) => canonicals[i]);
    let cursor = newStart;
    pos.set(regionCanonicals[0], newStart);
    for (let k = 0; k < analysis.intervals.length; k++) {
      cursor += newSizes[k];
      pos.set(analysis.intervals[k].hi, cursor);
    }
    pos.set(regionCanonicals[regionCanonicals.length - 1], newEnd);
  }

  // Partition indices
  const leftIndices: number[] = [];
  const insideIndices: number[] = [];
  const rightIndices: number[] = [];

  for (let i = 0; i <= idxLo; i++) leftIndices.push(i);
  for (let i = idxLo; i <= idxHi; i++) insideIndices.push(i);
  for (let i = idxHi; i < n; i++) rightIndices.push(i);

  // Map regions
  gradientMapRegion(leftIndices, canonicals[0], hovLo, vbLo, newHovLo);

  // Inside (hovered tile) - proportional scaling
  {
    const origRange = hovHi - hovLo;
    const newRange = newHovHi - newHovLo;
    for (const idx of insideIndices) {
      const c = canonicals[idx];
      if (origRange < 0.01) {
        pos.set(c, newHovLo);
      } else {
        pos.set(c, newHovLo + ((c - hovLo) / origRange) * newRange);
      }
    }
  }

  gradientMapRegion(rightIndices, hovHi, canonicals[n - 1], newHovHi, vbHi);

  // Lock hovered tile edges
  pos.set(hovLo, newHovLo);
  pos.set(hovHi, newHovHi);

  const lockedCanonicals = new Set([hovLo, hovHi]);

  // MIN enforcement iterations
  for (let iter = 0; iter < 50; iter++) {
    let anyFixed = false;

    for (const [tLo, tHi] of tileSpans) {
      const curLo = pos.get(tLo);
      const curHi = pos.get(tHi);
      if (curLo === undefined || curHi === undefined) continue;

      const origSpan = tHi - tLo;
      const effectiveMin = Math.min(MIN, origSpan);
      const span = curHi - curLo;
      if (span >= effectiveMin - 0.5) continue;

      const midpoint = (curLo + curHi) / 2;
      let desiredLo = midpoint - effectiveMin / 2;
      let desiredHi = midpoint + effectiveMin / 2;

      if (desiredLo < vbLo) {
        desiredLo = vbLo;
        desiredHi = vbLo + effectiveMin;
      }
      if (desiredHi > vbHi) {
        desiredHi = vbHi;
        desiredLo = vbHi - effectiveMin;
      }

      if (lockedCanonicals.has(tLo) && lockedCanonicals.has(tHi)) continue;
      if (lockedCanonicals.has(tLo)) {
        desiredLo = curLo;
        desiredHi = curLo + effectiveMin;
        if (desiredHi > vbHi) desiredHi = vbHi;
      }
      if (lockedCanonicals.has(tHi)) {
        desiredHi = curHi;
        desiredLo = curHi - effectiveMin;
        if (desiredLo < vbLo) desiredLo = vbLo;
      }

      if (
        !lockedCanonicals.has(tLo) &&
        Math.abs((pos.get(tLo) ?? curLo) - desiredLo) > 0.5
      ) {
        pos.set(tLo, desiredLo);
        anyFixed = true;
      }
      if (
        !lockedCanonicals.has(tHi) &&
        Math.abs((pos.get(tHi) ?? curHi) - desiredHi) > 0.5
      ) {
        pos.set(tHi, desiredHi);
        anyFixed = true;
      }
    }

    if (!anyFixed) break;
  }

  // Monotonicity enforcement
  const sortedPositions = canonicals.map((c) => pos.get(c) ?? c);
  for (let i = 1; i < sortedPositions.length; i++) {
    if (sortedPositions[i] < sortedPositions[i - 1]) {
      if (!lockedCanonicals.has(canonicals[i])) {
        sortedPositions[i] = sortedPositions[i - 1];
        pos.set(canonicals[i], sortedPositions[i]);
      }
    }
  }

  return pos;
}

// ============ Calculate Ripple Layout ============

export function calculateRippleLayout(
  originalLayout: TileLayout[],
  splitLineStructure: SplitLineStructure,
  hoveredIndex: number,
  W: number,
  H: number,
  targetW: number,
  targetH: number
): TileLayout[] {
  const hoveredTile = originalLayout[hoveredIndex];

  // Expand if tile width < targetW OR height < targetH
  // This ensures tiles that are narrow OR short will expand
  const needsWidthExpand = hoveredTile.width < targetW;
  const needsHeightExpand = hoveredTile.height < targetH;

  if (!needsWidthExpand && !needsHeightExpand) {
    return originalLayout;
  }

  const hovL = splitLineStructure.vLineMap.get(hoveredTile.x);
  const hovR = splitLineStructure.vLineMap.get(hoveredTile.x + hoveredTile.width);
  const hovT = splitLineStructure.hLineMap.get(hoveredTile.y);
  const hovB = splitLineStructure.hLineMap.get(hoveredTile.y + hoveredTile.height);

  if (hovL === undefined || hovR === undefined || hovT === undefined || hovB === undefined) {
    return originalLayout;
  }

  const VB_L = BORDER;
  const VB_R = W - BORDER;
  const VB_T = BORDER;
  const VB_B = H - BORDER;

  const vTileSpans = buildTileSpans(originalLayout, splitLineStructure, "v");
  const hTileSpans = buildTileSpans(originalLayout, splitLineStructure, "h");

  const vLinePos = elasticRedistribute(
    splitLineStructure.vCanonicals,
    hovL,
    hovR,
    targetW,
    VB_L,
    VB_R,
    vTileSpans
  );

  const hLinePos = elasticRedistribute(
    splitLineStructure.hCanonicals,
    hovT,
    hovB,
    targetH,
    VB_T,
    VB_B,
    hTileSpans
  );

  return originalLayout.map((tile) => {
    const tileL = splitLineStructure.vLineMap.get(tile.x) ?? tile.x;
    const tileR = splitLineStructure.vLineMap.get(tile.x + tile.width) ?? (tile.x + tile.width);
    const tileT = splitLineStructure.hLineMap.get(tile.y) ?? tile.y;
    const tileB = splitLineStructure.hLineMap.get(tile.y + tile.height) ?? (tile.y + tile.height);

    const nL = vLinePos.get(tileL) ?? tileL;
    const nR = vLinePos.get(tileR) ?? tileR;
    const nT = hLinePos.get(tileT) ?? tileT;
    const nB = hLinePos.get(tileB) ?? tileB;

    return {
      ...tile,
      x: nL,
      y: nT,
      width: nR - nL,
      height: nB - nT,
    };
  });
}

// ============ Main Hook ============

export function useMarketHeatmapLayout(
  data: MarketHeatmapItem[],
  width: number,
  height: number
): { layout: TileLayout[]; splitLineStructure: SplitLineStructure | null } {
  return useMemo(() => {
    if (data.length === 0 || width <= 0 || height <= 0) {
      return { layout: [], splitLineStructure: null };
    }

    const vW = width - 2 * BORDER;
    const vH = height - 2 * BORDER;

    if (vW <= 0 || vH <= 0) {
      return { layout: [], splitLineStructure: null };
    }

    // Preserve the source squarified geometry while keeping the runtime contract flat.
    type HeatmapHierarchyDatum = {
      item?: MarketHeatmapItem;
      flatChildren?: HeatmapHierarchyDatum[];
      value?: number;
    };
    const flatData: HeatmapHierarchyDatum[] = data.map((item) => ({
      item,
      value: Math.pow(item.weight, 0.8),
    }));

    // Only the synthetic root owns children; runtime items cannot create drill-down nodes.
    const root = hierarchy<HeatmapHierarchyDatum>(
        { flatChildren: flatData },
        (d) => d.flatChildren
      )
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    // Stretch virtual height to bias tiles toward horizontal (width > height)
    treemap<unknown>()
      .size([vW, vH * S])
      .padding(2)
      .tile(treemapSquarify.ratio(1))(root as HierarchyNode<unknown>);

    // Scale the source layout back from its horizontal-bias coordinate space.
    const directChildren = (root.children ?? []) as HierarchyRectangularNode<unknown>[];
    const layout: TileLayout[] = directChildren.map((d) => ({
      data: (d.data as HeatmapHierarchyDatum).item as MarketHeatmapItem,
      x: d.x0 + BORDER,
      y: d.y0 / S + BORDER,
      width: d.x1 - d.x0,
      height: (d.y1 - d.y0) / S,
    }));

    const splitLineStructure = buildSplitLineStructure(layout);

    return { layout, splitLineStructure };
  }, [data, width, height]);
}

// ============ Adaptive Styles ============

export function getAdaptiveStyles(
  width: number,
  height: number,
  name: string,
  maxArea: number,
  minArea: number
) {
  const area = width * height;
  const minDim = Math.min(width, height);

  // sqrt normalization
  const t =
    maxArea > minArea
      ? (Math.sqrt(area) - Math.sqrt(minArea)) /
        (Math.sqrt(maxArea) - Math.sqrt(minArea))
      : 0.5;
  const tClamped = clamp(t, 0, 1);

  const isVertical = height > width * 1.2;
  const pad = lerp(4, 16, tClamped);

  // Name size with width constraint
  let nameSize = lerp(9, 28, tClamped);
  const charCount = name.length;
  const textFlowDim = isVertical ? height - 2 * pad : width - 2 * pad;
  const maxNameSize = (0.5 * textFlowDim) / Math.max(charCount, 1);
  nameSize = Math.min(nameSize, Math.max(9, maxNameSize));

  const nameWeight = Math.round(lerp(400, 700, tClamped));
  const valueSize = lerp(8, 13, tClamped);
  const badgeSize = lerp(7, 12, tClamped);

  // Badge prominence gradient
  const badgeBgAlpha = lerp(0.03, 0.15, tClamped);
  const badgeBorderAlpha = lerp(0.06, 0.25, tClamped);
  const badgeShadowAlpha = lerp(0.05, 0.3, tClamped);
  const badgePadV = lerp(2, 4.5, tClamped);
  const badgePadH = lerp(4, 6, tClamped);

  // Visibility
  const hideValue = minDim < 50;
  const hideBadge = minDim < 50;

  return {
    nameSize,
    nameWeight,
    valueSize,
    badgeSize,
    pad,
    isVertical,
    hideValue,
    hideBadge,
    badgeBgAlpha,
    badgeBorderAlpha,
    badgeShadowAlpha,
    badgePadV,
    badgePadH,
    minDim,
    area,
  };
}

// ============ Corner Detection (Binance-style) ============

export function getBorderRadius(
  x: number,
  y: number,
  width: number,
  height: number,
  W: number,
  H: number,
  R = 16,
  tol = 3
): string {
  const touchLeft = x - BORDER < tol;
  const touchTop = y - BORDER < tol;
  const touchRight = x + width > W - BORDER - tol;
  const touchBottom = y + height > H - BORDER - tol;

  const tl = touchLeft && touchTop ? R + "px" : "0";
  const tr = touchRight && touchTop ? R + "px" : "0";
  const bl = touchLeft && touchBottom ? R + "px" : "0";
  const br = touchRight && touchBottom ? R + "px" : "0";

  return `${tl} ${tr} ${br} ${bl}`;
}

// ============ Target Size Calculator ============

export function getTargetSize(
  W: number,
  H: number,
  entityCount: number
): { targetW: number; targetH: number } {
  const d = Math.min(4, Math.sqrt(entityCount));
  return {
    targetW: W / d,
    targetH: H / d,
  };
}
