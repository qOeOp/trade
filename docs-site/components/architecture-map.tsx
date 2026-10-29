'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { isLocale, type Locale } from '@/lib/i18n';
import {
  advanceStableFrame,
  flowFrameReady,
  focusViewport,
  viewportTargetChanged,
} from '@/lib/viewport-gate.mjs';
import type { ArchitectureNodeData, DiagramNodeData, OwnerNodeData, ArchitectureEdgeData } from '@/lib/architecture-map';
import { productArchitectureNodes, productArchitectureEdges } from '@/lib/product-architecture';
import { createArchitectureLayout } from '@/lib/architecture-layout';

type PinHandle = {
  id: string;
  type: 'source' | 'target';
  position: Position;
  offset: number;
};

const pinPosition = {
  left: Position.Left,
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
} as const;
const pinGap = 18;

function allocateEdgePins(edges: Edge[]) {
  const groups = new Map<string, Array<{
    edgeId: string;
    endpoint: 'source' | 'target';
    nodeId: string;
    baseHandle: string;
    side: keyof typeof pinPosition;
    order: number;
  }>>();

  for (const edge of edges) {
    for (const endpoint of ['source', 'target'] as const) {
      const baseHandle = endpoint === 'source' ? edge.sourceHandle : edge.targetHandle;
      if (!baseHandle) continue;
      const side = baseHandle.split('-').at(-1) as keyof typeof pinPosition;
      if (!(side in pinPosition)) throw new Error(`Unknown pin side: ${baseHandle}`);
      const nodeId = endpoint === 'source' ? edge.source : edge.target;
      const groupKey = `${nodeId}:${side}`;
      const group = groups.get(groupKey) ?? [];
      const order = Number(edge.data?.pinOrder ?? 0);
      group.push({ edgeId: edge.id, endpoint, nodeId, baseHandle, side, order });
      groups.set(groupKey, group);
    }
  }

  const assigned = new Map<string, string>();
  const handlesByNode = new Map<string, PinHandle[]>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order || `${a.edgeId}:${a.endpoint}`.localeCompare(`${b.edgeId}:${b.endpoint}`));
    group.forEach((entry, index) => {
      const id = `${entry.baseHandle}-${index + 1}`;
      const handles = handlesByNode.get(entry.nodeId) ?? [];
      handles.push({
        id,
        type: entry.endpoint,
        position: pinPosition[entry.side],
        offset: (index - (group.length - 1) / 2) * pinGap,
      });
      handlesByNode.set(entry.nodeId, handles);
      assigned.set(`${entry.edgeId}:${entry.endpoint}`, id);
    });
  }

  return {
    edges: edges.map((edge) => ({
      ...edge,
      sourceHandle: assigned.get(`${edge.id}:source`) ?? edge.sourceHandle,
      targetHandle: assigned.get(`${edge.id}:target`) ?? edge.targetHandle,
    })),
    handlesByNode,
  };
}

const pinnedArchitecture = allocateEdgePins(productArchitectureEdges);

function NodePins({ nodeId, activeHandles }: { nodeId: string; activeHandles?: string[] }) {
  const active = new Set(activeHandles);
  return (pinnedArchitecture.handlesByNode.get(nodeId) ?? []).map(pin => {
    const horizontal = pin.position === Position.Top || pin.position === Position.Bottom;
    return <Handle key={pin.id} id={pin.id} type={pin.type} position={pin.position}
      className={active.has(pin.id) ? 'is-connected' : undefined}
      style={horizontal ? { left: `calc(50% + ${pin.offset}px)` } : { top: `calc(50% + ${pin.offset}px)` }} />;
  });
}

function ArchitectureNode({ id, data, selected }: NodeProps<Node<ArchitectureNodeData>>) {
  const { locale } = useI18n();
  const language = locale === 'zh' ? 'zh' : 'en';
  return <button type="button" className={`docs-map-node docs-map-${data.variant ?? 'module'}${selected ? ' is-selected' : ''}`}
    data-importance={data.importance ?? 'normal'} aria-label={data.title}>
    <span className="docs-map-node-copy"><strong data-architecture-title>{data.title}</strong>
      {data.subtitle ? <span className="docs-map-node-subtitle">{data.subtitle[language]}</span> : null}
    </span>
    <NodePins nodeId={id} activeHandles={data.activeHandles} />
  </button>;
}

function OwnerGroup({ id, data, selected }: NodeProps<Node<OwnerNodeData>>) {
  return <button type="button" className={`docs-owner-group${selected ? ' is-selected' : ''}`}
    data-owner-role={data.role} data-has-badge={Boolean(data.badge)} aria-label={`${data.label}, ${data.badge ?? data.roleLabel}`}>
    <header><span>{data.label}</span>{data.badge ? <span className="docs-owner-badge">{data.badge}</span> : null}</header>
    <NodePins nodeId={id} activeHandles={data.activeHandles} />
  </button>;
}

const nodeTypes = { architectureNode: ArchitectureNode, ownerGroup: OwnerGroup, boundaryGroup: OwnerGroup };

const EdgeInteractionContext = createContext({
  enter: (_edgeId: string) => {},
  leave: (_edgeId: string) => {},
  select: (_edgeId: string) => {},
});

type RoutePoint = [number, number];

function extendPoint(x: number, y: number, side: Position): RoutePoint {
  const direction = {
    [Position.Left]: [-1, 0],
    [Position.Right]: [1, 0],
    [Position.Top]: [0, -1],
    [Position.Bottom]: [0, 1],
  }[side];
  return [x + direction[0] * 12, y + direction[1] * 12];
}

function roundRoute(points: RoutePoint[]) {
  // React Flow measures handles with tiny floating-point differences. Snap those
  // differences before removing redundant points, so the straight runs stay level.
  const route: RoutePoint[] = [];
  for (const point of points) {
    const previous = route.at(-1);
    const current: RoutePoint = [...point];
    if (previous) {
      if (Math.abs(current[0] - previous[0]) < 0.01) current[0] = previous[0];
      if (Math.abs(current[1] - previous[1]) < 0.01) current[1] = previous[1];
      if (current[0] === previous[0] && current[1] === previous[1]) continue;
    }
    while (route.length > 1) {
      const before = route[route.length - 2], corner = route[route.length - 1];
      const vertical = before[0] === corner[0] && corner[0] === current[0];
      const horizontal = before[1] === corner[1] && corner[1] === current[1];
      if (!(vertical || horizontal)) break;
      route.pop();
    }
    const tail = route.at(-1);
    if (tail && tail[0] === current[0] && tail[1] === current[1]) continue;
    route.push(current);
  }
  let path = `M ${route[0][0]} ${route[0][1]}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const before = route[index - 1], corner = route[index], after = route[index + 1];
    const incoming = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
    const outgoing = Math.hypot(after[0] - corner[0], after[1] - corner[1]);
    const radius = Math.min(12, incoming / 2, outgoing / 2);
    const entry = corner.map((value, axis) => value + (before[axis] - value) * radius / incoming);
    const exit = corner.map((value, axis) => value + (after[axis] - value) * radius / outgoing);
    path += ` L ${entry[0]} ${entry[1]} Q ${corner[0]} ${corner[1]} ${exit[0]} ${exit[1]}`;
  }
  const last = route.at(-1)!;
  return `${path} L ${last[0]} ${last[1]}`;
}

function ArchitectureEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, markerStart, data }: EdgeProps) {
  const interaction = useContext(EdgeInteractionContext);
  const { locale } = useI18n();
  const edge = data as ArchitectureEdgeData;
  const [smoothPath, smoothX, smoothY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 22 });
  let path = smoothPath;
  let captionX = smoothX, captionY = smoothY;
  if (edge.route) {
    const from = edge.leadPoints?.source ?? extendPoint(sourceX, sourceY, sourcePosition);
    const to = edge.leadPoints?.target ?? extendPoint(targetX, targetY, targetPosition);
    const route = edge.route;
    const corridor: RoutePoint[] = 'via' in route ? route.via : route.axis === 'x' ? [[route.at, from[1]], [route.at, to[1]]] : [[from[0], route.at], [to[0], route.at]];
    path = roundRoute([[sourceX, sourceY], from, ...corridor, to, [targetX, targetY]]);
    if ('axis' in route) {
      captionX = route.axis === 'x' ? route.at : (from[0] + to[0]) / 2;
      captionY = route.axis === 'y' ? route.at : (from[1] + to[1]) / 2;
    }
  }
  const main = edge.emphasis === 'main';
  const width = main ? 2.2 : 1.2;
  return <>
    <BaseEdge id={id} path={path} interactionWidth={0} markerEnd={markerEnd} markerStart={markerStart}
      className={main ? 'docs-primary-flow' : 'docs-supporting-flow'}
      style={{ stroke: main ? 'var(--map-edge)' : 'var(--map-edge-muted)', strokeWidth: edge.isHighlighted ? width + 0.9 : width,
        filter: edge.isHighlighted ? 'drop-shadow(0 0 3px var(--map-edge))' : undefined,
        transition: 'opacity 90ms ease, stroke-width 90ms ease, filter 90ms ease',
        opacity: edge.isHighlighted ? 1 : edge.isDimmed ? 0.1 : main ? 0.9 : edge.isRelated ? 0.78 : 0.32 }} />
    {edge.caption ? <EdgeLabelRenderer><span className="docs-edge-caption" style={{ transform: `translate(-50%, -100%) translate(${captionX}px, ${captionY - 4}px)`, opacity: edge.isHighlighted ? 1 : 0 }}>{edge.caption[locale === 'zh' ? 'zh' : 'en']}</span></EdgeLabelRenderer> : null}
    <path d={path} className="docs-edge-hit-area" fill="none" stroke="transparent" strokeWidth={10} pointerEvents="stroke"
      onPointerEnter={() => interaction.enter(id)} onPointerLeave={() => interaction.leave(id)} onPointerCancel={() => interaction.leave(id)}
      onClick={event => { event.stopPropagation(); interaction.select(id); }} />
  </>;
}

const edgeTypes = { architectureEdge: ArchitectureEdge };
type DiagramNode = Node<DiagramNodeData>;

export function ArchitectureMap({ locale: initialLocale }: { locale: Locale }) {
  const { locale: contextLocale } = useI18n();
  const locale: Locale = contextLocale && isLocale(contextLocale) ? contextLocale : initialLocale;
  const { resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const layout = useMemo(() => createArchitectureLayout(
    productArchitectureNodes, pinnedArchitecture.edges, pinnedArchitecture.handlesByNode, canvasSize,
  ), [canvasSize]);
  const renderedNodeCatalog = layout.nodes;
  const visibleEdges = layout.edges;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [minimumZoom, setMinimumZoom] = useState(0.08);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.08 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasReadyRef = useRef(false);
  const fittedViewportRef = useRef<Viewport | null>(null);
  const revealFrameRef = useRef<number | null>(null);
  const expectedEdgeIdsRef = useRef(visibleEdges.map(edge => edge.id).sort());
  const selectedData = renderedNodeCatalog.find(node => node.id === selectedId)?.data;
  const selectedDescription = selectedData?.nodeType === 'architecture' ? selectedData.description[locale] : selectedData?.label;
  const selectedRoute = selectedData?.docsRoute;
  const focusedEdgeId = hoveredEdgeId ?? selectedEdgeId;
  const edgeData = visibleEdges.find(edge => edge.id === focusedEdgeId)?.data as ArchitectureEdgeData | undefined;
  const canPan = viewport.zoom > minimumZoom + 0.01;
  const edgeInteraction = useMemo(() => ({
    enter: (id: string) => setHoveredEdgeId(id),
    leave: (id: string) => setHoveredEdgeId(current => current === id ? null : current),
    select: (id: string) => { setSelectedId(null); setSelectedEdgeId(current => current === id ? null : id); },
  }), []);
  useEffect(() => setThemeMounted(true), []);
  useEffect(() => {
    const clear = () => { setHoveredEdgeId(null); setHoveredNodeId(null); };
    window.addEventListener('blur', clear);
    document.addEventListener('mouseleave', clear);
    return () => { window.removeEventListener('blur', clear); document.removeEventListener('mouseleave', clear); };
  }, []);
  const renderedEdges = useMemo(() => visibleEdges.map(edge => ({ ...edge, data: { ...edge.data,
    isRelated: edge.source === hoveredNodeId || edge.target === hoveredNodeId,
    isHighlighted: edge.id === focusedEdgeId, isDimmed: focusedEdgeId !== null && edge.id !== focusedEdgeId },
    zIndex: edge.id === focusedEdgeId ? 10 : undefined })), [focusedEdgeId, hoveredNodeId, visibleEdges]);
  const visibleNodes = useMemo(() => {
    const focusedEdge = visibleEdges.find(edge => edge.id === focusedEdgeId);
    const focusedIds = new Set<string>();
    if (focusedEdge) {
      focusedIds.add(focusedEdge.source); focusedIds.add(focusedEdge.target);
      // A container endpoint includes its children, and highlighted children keep their ancestors visible.
      for (const node of renderedNodeCatalog) {
        let parent = node.parentId;
        while (parent) {
          if (parent === focusedEdge.source || parent === focusedEdge.target) focusedIds.add(node.id);
          parent = renderedNodeCatalog.find(candidate => candidate.id === parent)?.parentId;
        }
      }
      for (const id of [...focusedIds]) {
        let parent = renderedNodeCatalog.find(node => node.id === id)?.parentId;
        while (parent) { focusedIds.add(parent); parent = renderedNodeCatalog.find(node => node.id === parent)?.parentId; }
      }
    }
    const activeHandles = new Map<string, string[]>();
    for (const edge of focusedEdge ? [focusedEdge] : visibleEdges) {
      if (edge.sourceHandle) activeHandles.set(edge.source, [...(activeHandles.get(edge.source) ?? []), edge.sourceHandle]);
      if (edge.targetHandle) activeHandles.set(edge.target, [...(activeHandles.get(edge.target) ?? []), edge.targetHandle]);
    }
    return renderedNodeCatalog.map(node => ({ ...node, selected: node.id === selectedId,
      data: { ...node.data, activeHandles: activeHandles.get(node.id) ?? [] },
      style: { ...node.style, opacity: !focusedEdge || focusedIds.has(node.id) ? 1 : 0.16 } }));
  }, [focusedEdgeId, selectedId, renderedNodeCatalog, visibleEdges]);
  useEffect(() => {
    if (!canvasRef.current) return;
    let stableFrame = { signature: null as string | null, count: 0 };

    const waitForStableFlow = () => {
      revealFrameRef.current = requestAnimationFrame(() => {
        revealFrameRef.current = null;
        const canvas = canvasRef.current;
        const target = fittedViewportRef.current;
        const viewportElement = canvas?.querySelector<HTMLElement>('.react-flow__viewport');
        const edgeElements = canvas?.querySelectorAll<SVGGElement>('.react-flow__edge');
        if (!canvas || !target || !viewportElement || !edgeElements) {
          stableFrame = advanceStableFrame(stableFrame, '', false);
          waitForStableFlow();
          return;
        }

        const bounds = canvas.getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(getComputedStyle(viewportElement).transform);
        const applied = { x: matrix.m41, y: matrix.m42, zoom: matrix.m11 };
        const renderedEdgePaths = [...edgeElements].map((edge) => ({
          id: edge.dataset.id ?? '',
          path: edge.querySelector<SVGPathElement>('.react-flow__edge-path')?.getAttribute('d') ?? '',
        }));
        const expectedEdgeIds = expectedEdgeIdsRef.current;
        const signature = [bounds.width, bounds.height, applied.x, applied.y, applied.zoom]
          .map((value) => Number(value).toFixed(3))
          .join(':') + `:${renderedEdgePaths
            .map((edge) => `${edge.id}:${edge.path}`)
            .sort()
            .join('|')}`;
        const frameReady = flowFrameReady(applied, target, renderedEdgePaths, expectedEdgeIds);
        stableFrame = advanceStableFrame(
          stableFrame,
          signature,
          frameReady,
        );
        if (stableFrame.count >= 2) {
          canvasReadyRef.current = true;
          setCanvasReady(true);
          return;
        }
        waitForStableFlow();
      });
    };

    const refit = () => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return;
      if (!canvasSize || Math.abs(canvasSize.width - bounds.width) > 0.5 || Math.abs(canvasSize.height - bounds.height) > 0.5) {
        canvasReadyRef.current = false;
        setCanvasReady(false);
        setCanvasSize({ width: bounds.width, height: bounds.height });
        return;
      }
      const fitted = layout.viewport;
      if (!viewportTargetChanged(fittedViewportRef.current, fitted)) {
        if (!canvasReadyRef.current && revealFrameRef.current === null) waitForStableFlow();
        return;
      }
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = null;
      }
      stableFrame = { signature: null, count: 0 };
      canvasReadyRef.current = false;
      setCanvasReady(false);
      fittedViewportRef.current = fitted;
      setMinimumZoom(fitted.zoom);
      setViewport(fitted);
      waitForStableFlow();
    };
    refit();
    window.addEventListener('resize', refit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
    if (observer && canvasRef.current) observer.observe(canvasRef.current);
    return () => {
      window.removeEventListener('resize', refit);
      observer?.disconnect();
      if (revealFrameRef.current !== null) {
        cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = null;
      }
    };
  }, [canvasSize, layout]);

  const restoreFit = useCallback(() => {
    const fitted = fittedViewportRef.current;
    if (fitted) setViewport(fitted);
  }, []);

  const focusGroup = (node: DiagramNode) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const width = Number(node.width ?? node.style?.width ?? 0);
    const height = Number(node.height ?? node.style?.height ?? 0);
    if (!bounds || width <= 0 || height <= 0) return;
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    const visited = new Set([node.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = renderedNodeCatalog.find((entry) => entry.id === parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    setViewport(focusViewport(bounds, {
      x,
      y,
      width,
      height,
    }, minimumZoom));
  };

  useEffect(() => {
    const restoreOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedId(null);
      setHoveredEdgeId(null);
      setSelectedEdgeId(null);
      restoreFit();
    };
    window.addEventListener('keydown', restoreOnEscape);
    return () => window.removeEventListener('keydown', restoreOnEscape);
  }, [restoreFit]);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    const data = node.data as DiagramNodeData;
    if (data.nodeType === 'architecture') {
      setSelectedEdgeId(null);
      setSelectedId(node.id);
      if ((canvasRef.current?.clientWidth ?? 0) < 800) focusGroup(node as DiagramNode);
      return;
    }
    setSelectedEdgeId(null);
    setSelectedId(node.id);
    focusGroup(node as DiagramNode);
  };

  return <section className="docs-architecture-shell" aria-label={locale === 'zh' ? '产品架构' : 'Product architecture'}>
    <div className="docs-architecture" style={{ '--map-owner-font': `${Math.max(16, 9 / viewport.zoom)}px`, '--map-badge-font': `${Math.max(12.5, 7 / viewport.zoom)}px` } as CSSProperties}><div className="docs-architecture-body">
      <div ref={canvasRef} className={`docs-flow-canvas${canvasReady ? ' is-ready' : ''}${canPan ? ' is-zoomed' : ''}`}
        aria-busy={!canvasReady} onPointerLeave={() => setHoveredEdgeId(null)} onPointerCancel={() => setHoveredEdgeId(null)}>
        <EdgeInteractionContext.Provider value={edgeInteraction}>
          <ReactFlow<DiagramNode, Edge> suppressHydrationWarning nodes={visibleNodes} edges={renderedEdges} nodeTypes={nodeTypes}
            edgeTypes={edgeTypes} onNodeClick={handleNodeClick}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)} onNodeMouseLeave={() => setHoveredNodeId(null)} onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); setHoveredEdgeId(null); setHoveredNodeId(null); restoreFit(); }}
            viewport={viewport} onViewportChange={setViewport} minZoom={minimumZoom} maxZoom={1.8} nodesDraggable={false}
            nodesConnectable={false} zoomOnDoubleClick={false} zoomOnScroll={false} preventScrolling={false} panOnDrag={canPan} panOnScroll={false}
            colorMode={themeMounted ? resolvedTheme === 'dark' ? 'dark' : 'light' : undefined} proOptions={{ hideAttribution: true }} />
        </EdgeInteractionContext.Provider>
        <button type="button" className="docs-map-fit" aria-label={locale === 'zh' ? '适应画布' : 'Fit diagram'} title={locale === 'zh' ? '适应画布' : 'Fit diagram'}
          onClick={() => { setSelectedId(null); setSelectedEdgeId(null); setHoveredEdgeId(null); setHoveredNodeId(null); restoreFit(); }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg><span>{locale === 'zh' ? '全图' : 'Overview'}</span>
        </button>
        {!selectedId && !focusedEdgeId ? <span className="docs-map-hint">{locale === 'zh' ? '点区域放大，点组件查看' : 'Tap a region to zoom, a component for details'}</span> : null}
        {selectedDescription || edgeData?.description ? <div className="docs-map-detail" aria-live="polite">
          <p>{selectedDescription ?? edgeData?.description?.[locale]}</p>
          <Link href={`/${locale}/docs/${selectedRoute ?? edgeData?.docsRoute}`} onClick={event => event.stopPropagation()}>
            {locale === 'zh' ? '查看文档 →' : 'Read docs →'}
          </Link>
        </div> : null}
      </div>
    </div></div>
  </section>;
}
