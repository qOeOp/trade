'use client';

import {
  BaseEdge,
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
  useUpdateNodeInternals,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isLocale, type Locale } from '@/lib/i18n';
import {
  advanceStableFrame,
  fitViewport,
  flowFrameReady,
  focusViewport,
  viewportTargetChanged,
} from '@/lib/viewport-gate.mjs';
import {
  architectureDetails,
  architectureNodes,
  fullArchitectureEdges,
  moduleActiveInScenario,
  ownerGroupActiveInScenario,
  relationRoleInScenario,
  relationVisibleInScenario,
  scenarios,
  type ArchitectureNodeData,
  type DiagramNodeData,
  type OwnerNodeData,
  type ScenarioId,
} from '@/lib/architecture-map';

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
const pinGap = 28;

function allocateEdgePins(edges: Edge[]) {
  const groups = new Map<string, Array<{
    edgeId: string;
    endpoint: 'source' | 'target';
    nodeId: string;
    baseHandle: string;
    side: keyof typeof pinPosition;
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
      group.push({ edgeId: edge.id, endpoint, nodeId, baseHandle, side });
      groups.set(groupKey, group);
    }
  }

  const assigned = new Map<string, string>();
  const handlesByNode = new Map<string, PinHandle[]>();
  for (const group of groups.values()) {
    group.sort((a, b) => `${a.edgeId}:${a.endpoint}`.localeCompare(`${b.edgeId}:${b.endpoint}`));
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

const pinnedArchitecture = allocateEdgePins(fullArchitectureEdges);

function NodePins({ nodeId, activeHandles }: { nodeId: string; activeHandles?: string[] }) {
  const active = new Set(activeHandles);
  const pins = pinnedArchitecture.handlesByNode.get(nodeId) ?? [];
  const activeOffsets = new Map<string, number>();
  const activeBySide = new Map<Position, PinHandle[]>();
  for (const pin of pins) {
    if (!active.has(pin.id)) continue;
    const group = activeBySide.get(pin.position) ?? [];
    group.push(pin);
    activeBySide.set(pin.position, group);
  }
  for (const group of activeBySide.values()) {
    group.forEach((pin, index) => {
      activeOffsets.set(pin.id, (index - (group.length - 1) / 2) * pinGap);
    });
  }

  const updateNodeInternals = useUpdateNodeInternals();
  const activeKey = activeHandles?.join('|') ?? '';
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [activeKey, nodeId, updateNodeInternals]);

  return pins.map((pin) => {
    const horizontal = pin.position === Position.Top || pin.position === Position.Bottom;
    const offset = activeOffsets.get(pin.id) ?? pin.offset;
    const style = horizontal
      ? { left: `calc(50% + ${offset}px)` }
      : { top: `calc(50% + ${offset}px)` };
    return (
      <Handle
        key={pin.id}
        className={active.has(pin.id) ? 'is-connected' : undefined}
        id={pin.id}
        type={pin.type}
        position={pin.position}
        style={style}
      />
    );
  });
}

function ArchitectureNode({ id, data, selected }: NodeProps<Node<ArchitectureNodeData>>) {
  const labelSize = data.title.length >= 17 ? 'tight' : data.title.length >= 15 ? 'compact' : data.title.length >= 9 ? 'medium' : 'regular';
  return (
    <button
      type="button"
      className={`docs-map-node docs-map-${data.kind} docs-map-${data.variant ?? data.emphasis}${selected ? ' is-selected' : ''}`}
      data-label-size={labelSize}
      aria-label={data.title}
    >
      <span className="docs-map-node-copy">
        {data.displayRole ? <small className="docs-map-node-role">{data.displayRole}</small> : null}
        <strong data-architecture-title>{data.title}</strong>
        {data.eventLines ? (
          <span className="docs-map-bus-events" aria-label="Accepted events">
            {data.eventLines.map((line) => <span key={line}>{line}</span>)}
          </span>
        ) : null}
      </span>
      <NodePins nodeId={id} activeHandles={data.activeHandles} />
    </button>
  );
}

function OwnerGroup({ id, data, selected }: NodeProps<Node<OwnerNodeData>>) {
  return (
    <button
      type="button"
      className={`docs-owner-group owner-${data.tone}${selected ? ' is-selected' : ''}`}
      data-owner-id={id}
      data-owner-role={data.role}
      data-module-count={data.count}
      aria-label={`${data.label} ${data.roleLabel} ${data.count} modules`}
    >
      <header>
        <span>{data.label}</span>
        {data.badge ? <i className="docs-owner-badge" data-owner-badge={data.badge}>{data.badge}</i> : null}
        <small>{data.roleLabel}</small>
      </header>
      {id === 'group-rd' ? (
        <span className="docs-rd-lanes" aria-hidden="true">
          <span data-lane-label="RESEARCH" />
          <span data-lane-label="DEVELOP" />
        </span>
      ) : null}
      <NodePins nodeId={id} activeHandles={data.activeHandles} />
    </button>
  );
}

const nodeTypes = { architectureNode: ArchitectureNode, ownerGroup: OwnerGroup, boundaryGroup: OwnerGroup };

const EdgeInteractionContext = createContext({
  enter: (_edgeId: string) => {},
  leave: (_edgeId: string) => {},
  select: (_edgeId: string) => {},
});

function ArchitectureEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeInteraction = useContext(EdgeInteractionContext);
  const laneOffset = (data as { laneOffset?: number } | undefined)?.laneOffset ?? 0;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 22,
    centerY: laneOffset === 0 ? undefined : (sourceY + targetY) / 2 + laneOffset,
  });
  const edgeData = data as {
    relation?: 'request' | 'proposal' | 'policy' | 'intent' | 'command' | 'handoff' | 'fact' | 'effect' | 'event' | 'read-model';
    relationKind?: 'owner' | 'stage';
    weight?: 'standard' | 'light';
    description?: Record<Locale, string>;
    isHighlighted?: boolean;
    isDimmed?: boolean;
    scenarioRole?: 'primary' | 'supporting';
  } | undefined;
  const relation = edgeData?.relation ?? 'fact';
  const isStage = edgeData?.relationKind === 'stage';
  const isEvent = relation === 'event';
  const isEffect = relation === 'effect';
  const isLight = edgeData?.weight === 'light';
  const isHighlighted = edgeData?.isHighlighted === true;
  const isDimmed = edgeData?.isDimmed === true;
  const scenarioRole = edgeData?.scenarioRole ?? 'supporting';
  const isPrimary = scenarioRole === 'primary';
  const isSupporting = scenarioRole === 'supporting';
  const edgeStroke = isStage ? 'var(--map-stage-edge)' : 'var(--map-edge)';
  const baseStrokeWidth = isPrimary
    ? 3.25
    : isSupporting
      ? isEvent || isLight ? 1.1 : 1.3
      : isStage ? 1.85 : isEffect ? 2.65 : 2.3;
  const baseOpacity = isPrimary ? 0.96 : isSupporting ? 0.34 : isStage ? 0.72 : 0.82;
  const edgeClassName = [
    isStage ? 'docs-stage-edge' : '',
    `docs-scenario-edge-${scenarioRole}`,
  ].filter(Boolean).join(' ');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={0}
        markerEnd={markerEnd}
        className={edgeClassName}
        style={{
          stroke: edgeStroke,
          strokeWidth: isHighlighted ? baseStrokeWidth + 1.35 : baseStrokeWidth,
          strokeDasharray: isEvent ? '5 7' : undefined,
          opacity: isHighlighted ? 1 : isDimmed ? 0.1 : baseOpacity,
          filter: isHighlighted ? `drop-shadow(0 0 5px ${edgeStroke})` : undefined,
          transition: 'opacity 90ms ease, stroke-width 90ms ease, filter 90ms ease',
        }}
      />
      <path
        d={path}
        className="docs-edge-hit-area"
        fill="none"
        stroke="var(--map-edge)"
        strokeOpacity={0.001}
        strokeWidth={14}
        pointerEvents="stroke"
        onPointerEnter={() => edgeInteraction.enter(id)}
        onPointerLeave={() => edgeInteraction.leave(id)}
        onPointerCancel={() => edgeInteraction.leave(id)}
        onClick={(event) => {
          event.stopPropagation();
          edgeInteraction.select(id);
        }}
      />
    </>
  );
}

const edgeTypes = { architectureEdge: ArchitectureEdge };
type DiagramNode = Node<DiagramNodeData>;

const overviewCue: Record<Locale, string> = {
  en: 'Qualification → eligibility · Governance → deployment/capital · Trade Intent → Risk · Recovery → Execution',
  zh: 'Qualification → 资格 · Governance → 部署/资金 · 交易意图 → Risk · 恢复 → Execution',
};

const architectureBounds = (() => {
  const topLevelNodes = architectureNodes.filter((node) => !node.parentId);
  const left = Math.min(...topLevelNodes.map((node) => node.position.x));
  const top = Math.min(...topLevelNodes.map((node) => node.position.y));
  const right = Math.max(...topLevelNodes.map((node) => node.position.x + (node.width ?? 0)));
  const bottom = Math.max(...topLevelNodes.map((node) => node.position.y + (node.height ?? 0)));
  return { x: left, y: top, width: right - left, height: bottom - top };
})();

export function ArchitectureMap({ locale: initialLocale }: { locale: Locale }) {
  const { locale: contextLocale } = useI18n();
  const locale: Locale = contextLocale && isLocale(contextLocale) ? contextLocale : initialLocale;
  const { resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [minimumZoom, setMinimumZoom] = useState(0.08);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 0.08 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasReadyRef = useRef(false);
  const fittedViewportRef = useRef<Viewport | null>(null);
  const revealFrameRef = useRef<number | null>(null);
  const selectedNode = selectedId ? architectureNodes.find((node) => node.id === selectedId) : undefined;
  const selectedData = selectedNode?.data;
  const selectedDescription = selectedData?.nodeType === 'architecture'
    ? selectedData.description[locale]
    : selectedData
      ? `${selectedData.label} · ${selectedData.roleLabel}`
      : undefined;
  const selectedRoute = selectedData?.docsRoute;
  const selectedInvariantIds = selectedData?.canonicalInvariantIds ?? [];
  const canPan = viewport.zoom > minimumZoom + 0.01;
  const focusedEdgeId = hoveredEdgeId ?? selectedEdgeId;
  const edgeInteraction = useMemo(() => ({
    enter: (edgeId: string) => setHoveredEdgeId(edgeId),
    leave: (edgeId: string) => setHoveredEdgeId((hoveredEdge) => hoveredEdge === edgeId ? null : hoveredEdge),
    select: (edgeId: string) => {
      setSelectedId(null);
      setSelectedEdgeId((selectedEdge) => selectedEdge === edgeId ? null : edgeId);
    },
  }), []);

  useEffect(() => setThemeMounted(true), []);

  useEffect(() => {
    const clearHoveredEdge = () => setHoveredEdgeId(null);
    window.addEventListener('blur', clearHoveredEdge);
    document.addEventListener('mouseleave', clearHoveredEdge);
    return () => {
      window.removeEventListener('blur', clearHoveredEdge);
      document.removeEventListener('mouseleave', clearHoveredEdge);
    };
  }, []);

  const visibleEdges = useMemo(() => pinnedArchitecture.edges.flatMap((current) => {
    const relation = current.data as { scenarios?: ScenarioId[]; overview?: boolean } | undefined;
    const visible = relation?.scenarios && typeof relation.overview === 'boolean'
      ? relationVisibleInScenario({ id: current.id, scenarios: relation.scenarios, overview: relation.overview }, scenario)
      : false;
    return visible ? [{
      ...current,
      data: {
        ...current.data,
        scenarioRole: relationRoleInScenario(current.id, scenario),
      },
    }] : [];
  }), [scenario]);
  const expectedEdgeIdsRef = useRef(visibleEdges.map((edge) => edge.id).sort());
  expectedEdgeIdsRef.current = visibleEdges.map((edge) => edge.id).sort();

  const hoveredEdge = hoveredEdgeId ? visibleEdges.find((current) => current.id === hoveredEdgeId) : undefined;
  const selectedEdge = selectedEdgeId ? visibleEdges.find((current) => current.id === selectedEdgeId) : undefined;
  const edgeDetail = hoveredEdge ?? selectedEdge;
  const edgeData = edgeDetail?.data as {
    description?: Record<Locale, string>;
    authorityId?: string;
    custodianId?: string;
    contractId?: string;
    relation?: string;
    objectId?: string;
    docsRoute?: string;
    sourceRole?: string;
    objectAuthority?: string;
    businessOutcomeOwnerId?: string;
    noBusinessOutcomeBasis?: string;
  } | undefined;
  const edgeDescription = edgeData?.description;
  const edgeBinding = edgeData?.relation && edgeData?.objectId && edgeDetail
    ? `${edgeData.relation.toUpperCase()} · ${edgeData.objectId} · ${edgeDetail.source} → ${edgeDetail.target}`
    : undefined;

  const renderedEdges = useMemo(() => visibleEdges.map((current) => ({
    ...current,
    data: {
      ...current.data,
      isHighlighted: current.id === focusedEdgeId,
      isDimmed: focusedEdgeId !== null && current.id !== focusedEdgeId,
    },
    zIndex: current.id === focusedEdgeId ? 10 : current.zIndex,
  })), [focusedEdgeId, visibleEdges]);
  const renderedNodeCatalog = architectureNodes;

  const visibleNodes = useMemo(() => {
    const activeOwners = new Set(renderedEdges.flatMap((current) => [current.source, current.target]));
    const focusedEdge = focusedEdgeId
      ? renderedEdges.find((current) => current.id === focusedEdgeId)
      : undefined;
    const focusedNodeIds = new Set<string>();
    if (focusedEdge) {
      for (const endpointId of [focusedEdge.source, focusedEdge.target]) {
        focusedNodeIds.add(endpointId);
        const endpoint = renderedNodeCatalog.find((node) => node.id === endpointId);
        if (endpoint?.parentId) focusedNodeIds.add(endpoint.parentId);
      }
    }
    const activeHandles = new Map<string, Set<string>>();
    for (const current of focusedEdge ? [focusedEdge] : renderedEdges) {
      if (current.sourceHandle) {
        const handles = activeHandles.get(current.source) ?? new Set<string>();
        handles.add(current.sourceHandle);
        activeHandles.set(current.source, handles);
      }
      if (current.targetHandle) {
        const handles = activeHandles.get(current.target) ?? new Set<string>();
        handles.add(current.targetHandle);
        activeHandles.set(current.target, handles);
      }
    }
    return renderedNodeCatalog.map((node) => {
      const isGroup = node.data.nodeType === 'owner' || node.data.nodeType === 'boundary';
      const active = node.data.nodeType === 'architecture'
        ? moduleActiveInScenario(node.data, scenario)
        : ownerGroupActiveInScenario(node.id, node.data.role, node.data.memberGroupIds, activeOwners);
      const opacity = scenario === 'overview'
        ? 1
        : active ? 1 : isGroup ? node.data.nodeType === 'owner' ? 0.32 : 0.2 : 0.12;
      const belongsToFocusedEdge = focusedEdge === undefined
        || focusedNodeIds.has(node.id)
        || (isGroup && focusedNodeIds.has(node.id));
      return {
        ...node,
        data: node.data.nodeType === 'architecture'
          ? { ...node.data, activeHandles: [...(activeHandles.get(node.id) ?? [])] }
          : { ...node.data, activeHandles: [...(activeHandles.get(node.id) ?? [])] },
        selected: node.id === selectedId,
        className: scenario === 'overview' || active ? 'is-scenario-active' : undefined,
        style: { ...node.style, opacity: focusedEdge ? belongsToFocusedEdge ? 1 : 0.12 : opacity },
      };
    });
  }, [focusedEdgeId, scenario, selectedId, renderedEdges, renderedNodeCatalog]);

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
      const fitted = fitViewport(bounds, architectureBounds);
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
  }, [scenario]);

  const restoreFit = useCallback(() => {
    const fitted = fittedViewportRef.current;
    if (fitted) setViewport(fitted);
  }, []);

  const focusGroup = (node: DiagramNode) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const width = Number(node.width ?? node.style?.width ?? 0);
    const height = Number(node.height ?? node.style?.height ?? 0);
    if (!bounds || width <= 0 || height <= 0) return;
    setViewport(focusViewport(bounds, {
      x: node.position.x,
      y: node.position.y,
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
      return;
    }
    setSelectedEdgeId(null);
    setSelectedId(node.id);
    focusGroup(node as DiagramNode);
  };

  const handleScenario = (nextScenario: ScenarioId) => {
    if (nextScenario === scenario) return;
    canvasReadyRef.current = false;
    setCanvasReady(false);
    setScenario(nextScenario);
    setSelectedId(null);
    setHoveredEdgeId(null);
    setSelectedEdgeId(null);
    restoreFit();
  };

  const scenarioMeta = scenarios.find((entry) => entry.id === scenario) ?? scenarios[0];
  const executionMode = scenario === 'overview'
    ? 'PAPER · LIVE'
    : scenario === 'paper'
      ? 'PAPER'
      : scenario === 'live'
        ? 'LIVE'
        : undefined;

  return (
    <section className="docs-architecture-shell" aria-label={locale === 'zh' ? 'Trader 系统全景' : 'Trader system map'}>
      <div className="docs-architecture">
        <div className="docs-architecture-body">
          {executionMode ? (
            <span className="docs-execution-mode-cue" aria-label={`${executionMode} execution mode`}>
              {executionMode}
            </span>
          ) : null}
          <div
            ref={canvasRef}
            className={`docs-flow-canvas${canvasReady ? ' is-ready' : ''}${canPan ? ' is-zoomed' : ''}`}
            data-scenario={scenario}
            aria-busy={!canvasReady}
            onPointerLeave={() => setHoveredEdgeId(null)}
            onPointerCancel={() => setHoveredEdgeId(null)}
          >
            <EdgeInteractionContext.Provider value={edgeInteraction}>
            <ReactFlow<DiagramNode, Edge>
              suppressHydrationWarning
              nodes={visibleNodes}
              edges={renderedEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={handleNodeClick}
              onPaneClick={() => {
                setSelectedId(null);
                setSelectedEdgeId(null);
                restoreFit();
              }}
              viewport={viewport}
              onViewportChange={setViewport}
              minZoom={minimumZoom}
              maxZoom={1.8}
              nodesDraggable={false}
              nodesConnectable={false}
              zoomOnDoubleClick={false}
              panOnDrag={canPan}
              panOnScroll={false}
              colorMode={themeMounted ? resolvedTheme === 'dark' ? 'dark' : 'light' : undefined}
              proOptions={{ hideAttribution: true }}
            >
            </ReactFlow>
            </EdgeInteractionContext.Provider>
            <div
              className="docs-scenario-brief"
              data-detail={selectedDescription || edgeDescription ? 'true' : undefined}
              data-overview-cue={scenario === 'overview' && !selectedDescription && !edgeDescription ? 'true' : undefined}
              aria-live="polite"
            >
              {selectedDescription ? (
                <span className="docs-selected-detail">
                  <b>{selectedDescription}</b>
                  <span className="docs-detail-meta">
                    <code>{selectedInvariantIds.length > 0 ? `${selectedInvariantIds.length} canonical invariants` : 'canonical owner surface'}</code>
                    <Link href={`/${locale}/docs/${selectedRoute}`} onClick={(event) => event.stopPropagation()}>
                      {selectedRoute}
                    </Link>
                  </span>
                </span>
              ) : edgeDescription ? (
                <span className="docs-edge-detail">
                  <b>{edgeDescription[locale]}</b>
                  <span className="docs-detail-meta">
                    {edgeBinding ? <code>{edgeBinding}</code> : null}
                    {edgeData?.docsRoute ? (
                      <Link href={`/${locale}/docs/${edgeData.docsRoute}`} onClick={(event) => event.stopPropagation()}>
                        {edgeData.docsRoute}
                      </Link>
                    ) : null}
                  </span>
                </span>
              ) : (
                <>
                  <b>{scenarioMeta.description[locale]}</b>
                  <small className="docs-overview-cues">
                    {scenario === 'overview'
                      ? overviewCue[locale]
                      : `${scenarioMeta.entry[locale]} → ${scenarioMeta.proof[locale]}`}
                  </small>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="docs-scenario-tabs" role="tablist" aria-label={locale === 'zh' ? '使用场景' : 'Usage scenarios'}>
        {scenarios.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={scenario === entry.id}
            className={scenario === entry.id ? 'is-active' : ''}
            onClick={() => handleScenario(entry.id)}
          >
            {entry.label[locale]}
          </button>
        ))}
      </div>
    </section>
  );
}
