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
  CONTAINER_HEADER,
  CONTAINER_PAD,
  FUNCTION_GAP,
  FUNCTION_HEIGHT,
  FUNCTION_WIDTH,
  containers,
  mapEdges,
  type MapContainer,
  type MapFunction,
  type Side,
} from '@/lib/research-map';

const sides: Record<Side, Position> = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left };
const SIDE_KEYS = Object.keys(sides) as Side[];

type FunctionData = { fn: MapFunction; slug: string; locale: Locale; state: 'idle' | 'on' | 'dim' };
type ContainerData = { container: MapContainer; locale: Locale };

function Handles() {
  return (
    <>
      {SIDE_KEYS.map((s) => (
        <Handle key={`s-${s}`} id={`s-${s}`} type="source" position={sides[s]} className="rd-handle" isConnectable={false} />
      ))}
      {SIDE_KEYS.map((s) => (
        <Handle key={`t-${s}`} id={`t-${s}`} type="target" position={sides[s]} className="rd-handle" isConnectable={false} />
      ))}
    </>
  );
}

function FunctionNode({ data }: NodeProps<Node<FunctionData>>) {
  const { fn, slug, locale, state } = data;
  return (
    <Link href={`/${locale}/docs/${slug}/#${fn.path.replace('.', '-')}`} className={`rd-fn rd-fn-${state}`}>
      <Handles />
      <span className="rd-fn-id">{fn.path}</span>
      <span className="rd-fn-title">{fn.title[locale]}</span>
    </Link>
  );
}

function ContainerNode({ data }: NodeProps<Node<ContainerData>>) {
  const { container, locale } = data;
  return (
    <div className={`rd-box rd-box-${container.accent}`}>
      <Link href={`/${locale}/docs/${container.slug}/`} className="rd-box-head">
        <span className="rd-box-id">{container.prefix}</span>
        <span className="rd-box-title">{container.title[locale]}</span>
      </Link>
    </div>
  );
}

const nodeTypes = { fn: FunctionNode, box: ContainerNode };

function boxSize(cont: MapContainer) {
  const n = cont.functions.length;
  if (cont.layout === 'row') {
    return { width: CONTAINER_PAD * 2 + n * FUNCTION_WIDTH + (n - 1) * FUNCTION_GAP * 3, height: CONTAINER_HEADER + FUNCTION_HEIGHT + CONTAINER_PAD };
  }
  return { width: CONTAINER_PAD * 2 + FUNCTION_WIDTH, height: CONTAINER_HEADER + n * FUNCTION_HEIGHT + (n - 1) * FUNCTION_GAP + CONTAINER_PAD };
}

export function ResearchMap({ locale }: { locale: Locale }) {
  const { resolvedTheme } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  const neighbours = useMemo(() => {
    if (!hovered) return null;
    const ids = new Set([hovered]);
    for (const e of mapEdges) {
      if (e.source === hovered) ids.add(e.target);
      if (e.target === hovered) ids.add(e.source);
    }
    return ids;
  }, [hovered]);

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const cont of containers) {
      const size = boxSize(cont);
      out.push({
        id: `box-${cont.prefix}`,
        type: 'box',
        position: { x: cont.x, y: cont.y },
        data: { container: cont, locale },
        style: size,
        width: size.width,
        height: size.height,
        draggable: false,
        selectable: false,
        zIndex: 0,
      });
      cont.functions.forEach((fn, i) => {
        const pos = cont.layout === 'row'
          ? { x: CONTAINER_PAD + i * (FUNCTION_WIDTH + FUNCTION_GAP * 3), y: CONTAINER_HEADER }
          : { x: CONTAINER_PAD, y: CONTAINER_HEADER + i * (FUNCTION_HEIGHT + FUNCTION_GAP) };
        out.push({
          id: fn.path,
          type: 'fn',
          parentId: `box-${cont.prefix}`,
          extent: 'parent',
          position: pos,
          data: { fn, slug: cont.slug, locale, state: !neighbours ? 'idle' : neighbours.has(fn.path) ? 'on' : 'dim' },
          style: { width: FUNCTION_WIDTH, height: FUNCTION_HEIGHT },
          width: FUNCTION_WIDTH,
          height: FUNCTION_HEIGHT,
          draggable: false,
          selectable: false,
          zIndex: 1,
        });
      });
    }
    return out;
  }, [locale, neighbours]);

  const edges = useMemo<Edge[]>(
    () =>
      mapEdges.map((e) => {
        const active = !hovered || e.source === hovered || e.target === hovered;
        const loop = e.kind === 'loop';
        return {
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          sourceHandle: `s-${e.from ?? 'r'}`,
          targetHandle: `t-${e.to ?? 'l'}`,
          type: 'smoothstep',
          className: loop ? 'rd-edge-loop' : 'rd-edge-flow',
          label: e.label[locale],
          zIndex: 2,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: loop ? 'var(--rd-stage-edge)' : 'var(--rd-edge)' },
          style: { opacity: active ? 1 : 0.12 },
          labelStyle: { opacity: active ? 1 : 0.15 },
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [locale, hovered],
  );

  return (
    <div className="rd-map h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.1}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, node) => node.type === 'fn' && setHovered(node.id)}
        onNodeMouseLeave={(_, node) => node.type === 'fn' && setHovered(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
