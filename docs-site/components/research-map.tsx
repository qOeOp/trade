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
  CAP_GAP, CAP_H, CAP_W, COL_GAP, COMP_GAP, COMP_HEAD, COMP_PAD, FN_GAP, FN_HEAD, FN_PAD, FN_W, LABEL_H, ROW_GAP,
  data, flowEdges, flows, grid, mapCopy,
  type MapCapability, type MapChapter, type MapComponent, type MapFunction, type Side,
} from '@/lib/research-map';

const sides: Record<Side, Position> = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left };
const SIDE_KEYS = Object.keys(sides) as Side[];
const anchorOf = (path: string) => path.replace(/\./g, '-');

function Handles() {
  return (
    <>
      {SIDE_KEYS.map((s) => <Handle key={`s-${s}`} id={`s-${s}`} type="source" position={sides[s]} className="rd-handle" isConnectable={false} />)}
      {SIDE_KEYS.map((s) => <Handle key={`t-${s}`} id={`t-${s}`} type="target" position={sides[s]} className="rd-handle" isConnectable={false} />)}
    </>
  );
}

const fnIndex = new Map<string, { fn: MapFunction; chapter: MapChapter }>();
const capFn = new Map<string, string>();
for (const ch of data.chapters) for (const fn of ch.functions) {
  fnIndex.set(fn.path, { fn, chapter: ch });
  for (const comp of fn.components) for (const cap of comp.caps) capFn.set(cap.path, fn.path);
}

type LabelData = { chapter: MapChapter; locale: Locale };
type FnData = { fn: MapFunction; slug: string; locale: Locale; state: string; outside?: number; compact?: boolean };
type CompData = { comp: MapComponent };
type CapData = { cap: MapCapability; slug: string; locale: Locale; state: string };

function ChapterLabelNode({ data: d }: NodeProps<Node<LabelData>>) {
  return (
    <Link href={`/${d.locale}/docs/${d.chapter.slug}/`} className="rd-col-label">
      <span className="rd-box-id">{d.chapter.prefix}</span>
      <span>{d.chapter.title}</span>
    </Link>
  );
}

function FunctionNode({ data: d }: NodeProps<Node<FnData>>) {
  return (
    <div className={`rd-func rd-func-${d.state} ${d.compact ? 'rd-func-compact' : ''}`}>
      <Handles />
      <Link href={`/${d.locale}/docs/${d.slug}/#${anchorOf(d.fn.path)}`} className="rd-func-head">
        <span className="rd-box-id">{d.fn.path}</span>
        <span className="rd-func-title">{d.fn.title}</span>
      </Link>
      {d.outside ? <span className="rd-func-out">{mapCopy.outside[d.locale]} {d.outside}</span> : null}
    </div>
  );
}

function ComponentNode({ data: d }: NodeProps<Node<CompData>>) {
  return (
    <div className="rd-comp">
      <div className="rd-comp-head"><span className="rd-fn-id">{d.comp.path}</span><span>{d.comp.title}</span></div>
    </div>
  );
}

function CapabilityNode({ data: d }: NodeProps<Node<CapData>>) {
  return (
    <Link href={`/${d.locale}/docs/${d.slug}/#${anchorOf(d.cap.path)}`} className={`rd-cap-card rd-cap-${d.cap.kind} rd-fn-${d.state}`} title={d.cap.title}>
      <Handles />
      <span className="rd-fn-id">{d.cap.path}</span>
      <span className="rd-cap-title">{d.cap.title}</span>
    </Link>
  );
}

const nodeTypes = { label: ChapterLabelNode, func: FunctionNode, comp: ComponentNode, cap: CapabilityNode };

const compHeight = (comp: MapComponent) => COMP_HEAD + comp.caps.length * CAP_H + (comp.caps.length - 1) * CAP_GAP + COMP_PAD;
const fnHeight = (fn: MapFunction) => FN_HEAD + fn.components.reduce((h, c) => h + compHeight(c), 0) + (fn.components.length - 1) * COMP_GAP + FN_PAD;
const COMPACT_H = 52;
const base = { draggable: false, selectable: false } as const;

// Overview: every function as a compact card in its chapter column, with the main flow edges.
function overviewNodes(locale: Locale): Node[] {
  const nodes: Node[] = [];
  const colX = (col: number) => col * (FN_W + COL_GAP);
  const height = (ch: MapChapter) => LABEL_H + ch.functions.length * (COMPACT_H + FN_GAP);
  const chapters = data.chapters.filter((ch) => grid[ch.prefix]);
  const rowTop = [0, 0, 0];
  rowTop[1] = Math.max(...chapters.filter((ch) => grid[ch.prefix].row === 0).map(height)) + ROW_GAP / 2;
  rowTop[2] = rowTop[1] + Math.max(...chapters.filter((ch) => grid[ch.prefix].row === 1).map(height)) + ROW_GAP / 2;
  for (const ch of chapters) {
    const { row, col } = grid[ch.prefix];
    let y = rowTop[row];
    nodes.push({ id: `label-${ch.prefix}`, type: 'label', position: { x: colX(col), y }, data: { chapter: ch, locale }, style: { width: FN_W, height: LABEL_H - 6 }, ...base });
    y += LABEL_H;
    ch.functions.forEach((fn, i) => {
      const pos = row === 2 ? { x: colX(col) + i * (FN_W + COL_GAP / 2), y } : { x: colX(col), y: y + i * (COMPACT_H + FN_GAP) };
      nodes.push({ id: fn.path, type: 'func', position: pos, data: { fn, slug: ch.slug, locale, state: 'idle', compact: true }, style: { width: FN_W, height: COMPACT_H }, width: FN_W, height: COMPACT_H, ...base });
    });
  }
  return nodes;
}

// A flow: its functions side by side, each expanded to components and capabilities.
function flowNodes(fnPaths: string[], locale: Locale, outside: Map<string, number>): Node[] {
  const nodes: Node[] = [];
  fnPaths.forEach((path, i) => {
    const entry = fnIndex.get(path);
    if (!entry) return;
    const { fn, chapter } = entry;
    const h = fnHeight(fn);
    nodes.push({ id: fn.path, type: 'func', position: { x: i * (FN_W + COL_GAP), y: 0 }, data: { fn, slug: chapter.slug, locale, state: 'idle', outside: outside.get(fn.path) }, style: { width: FN_W, height: h }, width: FN_W, height: h, zIndex: 0, ...base });
    let cy = FN_HEAD;
    for (const comp of fn.components) {
      const ch2 = compHeight(comp);
      nodes.push({ id: `comp-${comp.path}`, type: 'comp', parentId: fn.path, extent: 'parent', position: { x: FN_PAD, y: cy }, data: { comp }, style: { width: FN_W - 2 * FN_PAD, height: ch2 }, width: FN_W - 2 * FN_PAD, height: ch2, zIndex: 1, ...base });
      comp.caps.forEach((cap, k) => {
        nodes.push({ id: cap.path, type: 'cap', parentId: `comp-${comp.path}`, extent: 'parent', position: { x: COMP_PAD, y: COMP_HEAD + k * (CAP_H + CAP_GAP) }, data: { cap, slug: chapter.slug, locale, state: 'idle' }, style: { width: CAP_W, height: CAP_H }, width: CAP_W, height: CAP_H, zIndex: 2, ...base });
      });
      cy += ch2 + COMP_GAP;
    }
  });
  return nodes;
}

export function ResearchMap({ locale }: { locale: Locale }) {
  const { resolvedTheme } = useTheme();
  const [tab, setTab] = useState<string>('overview');
  const [hovered, setHovered] = useState<string | null>(null);
  const flow = flows.find((f) => f.id === tab);

  const { baseNodes, links } = useMemo(() => {
    if (!flow) return { baseNodes: overviewNodes(locale), links: [] as [string, string][] };
    const inFlow = new Set(flow.functions);
    const order = new Map(flow.functions.map((p, i) => [p, i]));
    const inside: [string, string][] = [];
    const outside = new Map<string, number>();
    for (const [a, b] of data.links) {
      const fa = capFn.get(a)!, fb = capFn.get(b)!;
      if (inFlow.has(fa) && inFlow.has(fb)) inside.push([a, b]);
      else if (inFlow.has(fa)) outside.set(fa, (outside.get(fa) ?? 0) + 1);
      else if (inFlow.has(fb)) outside.set(fb, (outside.get(fb) ?? 0) + 1);
    }
    inside.sort((x, y) => (order.get(capFn.get(x[0])!)! - order.get(capFn.get(y[0])!)!));
    return { baseNodes: flowNodes(flow.functions, locale, outside), links: inside };
  }, [flow, locale]);

  const lit = useMemo(() => {
    if (!hovered) return null;
    const ids = new Set<string>([hovered]);
    const isFn = fnIndex.has(hovered);
    for (const [a, b] of links) {
      const hit = isFn ? capFn.get(a) === hovered || capFn.get(b) === hovered : a === hovered || b === hovered;
      if (hit) { ids.add(a); ids.add(b); }
    }
    for (const e of flowEdges) if (e.source === hovered || e.target === hovered) { ids.add(e.source); ids.add(e.target); }
    return ids;
  }, [hovered, links]);

  const nodes = useMemo(() => baseNodes.map((n) => {
    if (n.type !== 'cap' && n.type !== 'func') return n;
    const state = !lit ? 'idle' : lit.has(n.id) || (n.type === 'func' && hovered === n.id) ? 'on' : n.type === 'cap' ? 'dim' : 'idle';
    return { ...n, data: { ...n.data, state } };
  }), [baseNodes, lit, hovered]);

  const edges = useMemo<Edge[]>(() => {
    const present = new Set(baseNodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const e of flowEdges) {
      if (!present.has(e.source) || !present.has(e.target) || flow) continue;
      const loop = e.kind === 'loop';
      const on = !hovered || e.source === hovered || e.target === hovered;
      out.push({
        id: `flow-${e.source}-${e.target}`, source: e.source, target: e.target, sourceHandle: `s-${e.from ?? 'r'}`, targetHandle: `t-${e.to ?? 'l'}`,
        type: 'smoothstep', className: loop ? 'rd-edge-loop' : 'rd-edge-flow', label: e.label[locale], zIndex: 3,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: loop ? 'var(--rd-stage-edge)' : 'var(--rd-edge)' },
        style: { opacity: on ? 1 : 0.12 }, labelStyle: { opacity: on ? 1 : 0.12 }, labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
      });
    }
    if (flow) {
      const order = new Map(flow.functions.map((p, i) => [p, i]));
      for (const [a, b] of links) {
        const forward = order.get(capFn.get(b)!)! > order.get(capFn.get(a)!)!;
        const on = !lit || (lit.has(a) && lit.has(b));
        out.push({
          id: `link-${a}-${b}`, source: a, target: b, sourceHandle: forward ? 's-r' : 's-l', targetHandle: forward ? 't-l' : 't-r',
          type: 'default', className: 'rd-edge-link', zIndex: 4,
          markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11, color: 'var(--rd-link)' },
          style: { opacity: on ? 0.9 : 0.06 },
        });
      }
    }
    return out;
  }, [baseNodes, flow, links, hovered, lit, locale]);

  return (
    <div className="rd-map h-full w-full">
      <ReactFlow
        key={tab}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.08}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, node) => (node.type === 'cap' || node.type === 'func') && setHovered(node.id)}
        onNodeMouseLeave={(_, node) => (node.type === 'cap' || node.type === 'func') && setHovered(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <div className="rd-tabs" role="tablist" aria-label={mapCopy.overview[locale]}>
        {[{ id: 'overview', title: mapCopy.overview }, ...flows].map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={tab === f.id} onClick={() => { setTab(f.id); setHovered(null); }}>
            {f.title[locale]}
          </button>
        ))}
      </div>
      <p className="rd-map-hint">{mapCopy.hover[locale]}</p>
    </div>
  );
}
