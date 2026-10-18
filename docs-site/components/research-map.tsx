'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import {
  LANE_SPAN,
  NODE_HEIGHT,
  NODE_WIDTH,
  lanes,
  mapChapters,
  mapCopy,
  mapEdges,
  type MapChapter,
  type Side,
} from '@/lib/research-map';

const sides: Record<Side, Position> = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left };

type ChapterData = { chapter: MapChapter; locale: Locale; dim: boolean; active: boolean };
type LaneData = { title: string };

function Handles() {
  return (
    <>
      {(Object.keys(sides) as Side[]).map((side) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={sides[side]} className="!opacity-0" isConnectable={false} />
      ))}
      {(Object.keys(sides) as Side[]).map((side) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={sides[side]} className="!opacity-0" isConnectable={false} />
      ))}
    </>
  );
}

function ChapterNode({ data }: NodeProps<Node<ChapterData>>) {
  const { chapter, locale, dim, active } = data;
  const foundation = chapter.lane === 'foundation';
  return (
    <Link
      href={`/${locale}/docs/${chapter.slug}`}
      className={[
        'rd-map-node flex h-full w-full flex-col justify-center rounded-lg border px-3 no-underline transition-opacity',
        foundation ? 'border-dashed' : '',
        active ? 'border-fd-primary' : 'border-fd-border',
        dim ? 'opacity-35' : 'opacity-100',
      ].join(' ')}
    >
      <Handles />
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-xs font-semibold text-fd-primary">{chapter.prefix}</span>
        <span className="text-sm font-semibold text-fd-foreground">{chapter.title[locale]}</span>
      </span>
      <span className="mt-0.5 text-xs leading-snug text-fd-muted-foreground">{chapter.role[locale]}</span>
    </Link>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return (
    <div className="rd-map-lane h-full w-full rounded-xl border border-fd-border/60">
      <span className="absolute left-3 top-2 text-xs font-medium tracking-wide text-fd-muted-foreground">{data.title}</span>
    </div>
  );
}

const nodeTypes = { chapter: ChapterNode, lane: LaneNode };

const edgeColor = { loop: 'var(--color-fd-primary)', evidence: 'var(--color-fd-muted-foreground)', user: 'var(--rd-map-user)' };

export function ResearchMapHeader({ locale }: { locale: Locale }) {
  return (
    <div className="flex flex-col gap-2 border-b border-fd-border px-4 py-3 md:flex-row md:flex-wrap md:items-center md:gap-x-6">
      <div className="md:min-w-0 md:flex-1">
        <h1 className="text-base font-semibold text-fd-foreground">{mapCopy.title[locale]}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-fd-muted-foreground">{mapCopy.intro[locale]}</p>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fd-muted-foreground">
        <li className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-fd-primary" />{mapCopy.legend.loop[locale]}</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-fd-muted-foreground" />{mapCopy.legend.evidence[locale]}</li>
        <li className="flex items-center gap-1.5"><span className="rd-map-dash inline-block h-0.5 w-5" />{mapCopy.legend.user[locale]}</li>
      </ul>
      <div className="flex gap-2 text-sm">
        <Link href={`/${locale}/docs`} className="rounded-md bg-fd-primary px-3 py-1.5 font-medium text-fd-primary-foreground no-underline">{mapCopy.read[locale]}</Link>
        <Link href={`/${locale}/docs/concepts`} className="rounded-md border border-fd-border px-3 py-1.5 text-fd-foreground no-underline">{mapCopy.concepts[locale]}</Link>
      </div>
    </div>
  );
}

export function ResearchMap({ locale }: { locale: Locale }) {
  const { resolvedTheme } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  const linked = useMemo(() => {
    if (!hovered) return null;
    const ids = new Set<string>([hovered]);
    for (const e of mapEdges) {
      if (e.source === hovered) ids.add(e.target);
      if (e.target === hovered) ids.add(e.source);
    }
    return ids;
  }, [hovered]);

  const nodes = useMemo<Node[]>(() => {
    const laneNodes: Node<LaneData>[] = lanes.map((lane) => ({
      id: `lane-${lane.id}`,
      type: 'lane',
      position: { x: LANE_SPAN.x, y: lane.y - 54 },
      data: { title: lane.title[locale] },
      style: { width: LANE_SPAN.width, height: LANE_SPAN.height },
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1,
    }));
    const chapterNodes: Node<ChapterData>[] = mapChapters.map((chapter) => ({
      id: chapter.prefix,
      type: 'chapter',
      position: { x: chapter.x, y: chapter.y },
      data: { chapter, locale, dim: !!linked && !linked.has(chapter.prefix), active: hovered === chapter.prefix },
      style: { width: chapter.width ?? NODE_WIDTH, height: NODE_HEIGHT },
      width: chapter.width ?? NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      selectable: false,
    }));
    return [...laneNodes, ...chapterNodes];
  }, [locale, linked, hovered]);

  const edges = useMemo<Edge[]>(
    () =>
      mapEdges.map((e) => {
        const on = !hovered || e.source === hovered || e.target === hovered;
        const color = edgeColor[e.kind];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: `s-${e.from}`,
          targetHandle: `t-${e.to}`,
          type: 'smoothstep',
          label: e.label[locale],
          animated: !!hovered && on,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: { stroke: color, strokeWidth: e.kind === 'loop' ? 1.8 : 1.2, strokeDasharray: e.kind === 'user' ? '6 4' : undefined, opacity: on ? 1 : 0.15 },
          labelStyle: { fontSize: 11, fill: 'var(--color-fd-muted-foreground)', opacity: on ? 1 : 0.2 },
          labelBgStyle: { fill: 'var(--color-fd-background)' },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [locale, hovered],
  );

  return (
    <div className="rd-map relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.12}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, node) => node.type === 'chapter' && setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
