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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import {
  CAP_GAP, CAP_H, CAP_W, COL_GAP, COMP_GAP, COMP_HEAD, COMP_PAD, FN_GAP, FN_HEAD, FN_PAD, FN_W, LABEL_H, ROW_GAP,
  data, flowEdges, flows, grid, mapCopy,
  type MapCapability, type MapChapter, type MapComponent, type MapFunction, type Side,
} from '@/lib/research-map';
import { packSkyline, packToAspect } from '@/lib/bento';

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
type FnData = { fn: MapFunction; slug: string; locale: Locale; state: string; outside?: number; compact?: boolean; chapter?: string };
type CompData = { comp: MapComponent };
type CapData = { cap: MapCapability; slug: string; locale: Locale; state: string };

function ChapterLabelNode({ data: d }: NodeProps<Node<LabelData>>) {
  return (
    <Link href={`/${d.locale}/docs/${d.chapter.slug}/`} className="rd-col-label">
      <span className="rd-box-id">{d.chapter.num}</span>
      <span>{d.chapter.title}</span>
    </Link>
  );
}

function FunctionNode({ data: d }: NodeProps<Node<FnData>>) {
  return (
    <div className={`rd-func rd-func-${d.state} ${d.compact ? 'rd-func-compact' : ''}`}>
      <Handles />
      <Link href={`/${d.locale}/docs/${d.slug}/#${anchorOf(d.fn.path)}`} className="rd-func-head">
        {d.chapter ? <span className="rd-chip">{d.chapter}</span> : null}
        <span className="rd-box-id">{d.fn.label}</span>
        <span className="rd-func-title">{d.fn.title}</span>
      </Link>
      {d.outside ? <span className="rd-func-out">{mapCopy.outside[d.locale]} {d.outside}</span> : null}
    </div>
  );
}

function ComponentNode({ data: d }: NodeProps<Node<CompData>>) {
  return (
    <div className="rd-comp">
      <div className="rd-comp-head"><span>{d.comp.title}</span></div>
    </div>
  );
}

function CapabilityNode({ data: d }: NodeProps<Node<CapData>>) {
  return (
    <Link href={`/${d.locale}/docs/${d.slug}/#${anchorOf(d.cap.path)}`} className={`rd-cap-card rd-cap-${d.cap.kind} rd-fn-${d.state}`} title={d.cap.title}>
      <Handles />
      <span className="rd-cap-title">{d.cap.title}</span>
    </Link>
  );
}

function TileNode({ data: d }: NodeProps<Node<LabelData>>) {
  return (
    <div className="rd-tile">
      <Link href={`/${d.locale}/docs/${d.chapter.slug}/`} className="rd-col-label rd-tile-head">
        <span className="rd-box-id">{d.chapter.num}</span>
        <span>{d.chapter.title}</span>
      </Link>
    </div>
  );
}

const nodeTypes = { label: ChapterLabelNode, tile: TileNode, func: FunctionNode, comp: ComponentNode, cap: CapabilityNode };

const COMPACT_H = 48;
const OUTER_GAP = 26;
const TILE_PAD = 12;
const base = { draggable: false, selectable: false } as const;
type Rect = { x: number; y: number; w: number; h: number };

function capsOf(fn: MapFunction) {
  return fn.components.reduce((n, c) => n + c.caps.length, 0);
}
const compHeight = (comp: MapComponent) => COMP_HEAD + comp.caps.length * CAP_H + (comp.caps.length - 1) * CAP_GAP + COMP_PAD;

// Inner bento: a function's components packed into one or two columns.
function functionLayout(fn: MapFunction, width: number, units: number) {
  const colW = (width - 2 * FN_PAD - (units - 1) * COMP_GAP) / units;
  const packed = packSkyline(fn.components.map((c) => ({ id: c.path, units: 1, height: compHeight(c) })), units, colW, COMP_GAP);
  return { colW, packed, height: FN_HEAD + packed.height + FN_PAD };
}

function unitsFor(fn: MapFunction) {
  return capsOf(fn) > 7 && fn.components.length > 1 ? 2 : 1;
}

// Overview: each chapter is a tile holding compact function cards in one or two columns.
function overviewLayout(locale: Locale, aspect: number) {
  const chapters = data.chapters;
  const cols = (ch: MapChapter) => (ch.functions.length > 3 ? 2 : 1);
  const tileH = (ch: MapChapter) => LABEL_H + Math.ceil(ch.functions.length / cols(ch)) * (COMPACT_H + FN_GAP / 2) + TILE_PAD;
  const board = packToAspect(chapters.map((ch) => ({ id: ch.prefix, units: cols(ch), height: tileH(ch) })), FN_W, OUTER_GAP, aspect);
  const nodes: Node[] = [];
  const rects = new Map<string, Rect>();
  for (const p of board.placed) {
    const ch = chapters.find((c) => c.prefix === p.id)!;
    nodes.push({ id: `tile-${ch.prefix}`, type: 'tile', position: { x: p.x, y: p.y }, data: { chapter: ch, locale }, style: { width: p.width, height: p.height }, width: p.width, height: p.height, zIndex: 0, ...base });
    const k = cols(ch);
    const cardW = (p.width - 2 * TILE_PAD - (k - 1) * TILE_PAD) / k;
    ch.functions.forEach((fn, i) => {
      const x = TILE_PAD + (i % k) * (cardW + TILE_PAD);
      const y = LABEL_H + Math.floor(i / k) * (COMPACT_H + FN_GAP / 2);
      nodes.push({ id: fn.path, type: 'func', parentId: `tile-${ch.prefix}`, extent: 'parent', position: { x, y }, data: { fn, slug: ch.slug, locale, state: 'idle', compact: true }, style: { width: cardW, height: COMPACT_H }, width: cardW, height: COMPACT_H, zIndex: 1, ...base });
      rects.set(fn.path, { x: p.x + x, y: p.y + y, w: cardW, h: COMPACT_H });
    });
  }
  return { nodes, rects };
}

// A flow: its functions as bento tiles; big functions take two columns and lay their components out side by side.
function flowLayout(fnPaths: string[], locale: Locale, outside: Map<string, number>, aspect: number) {
  const entries = fnPaths.map((p) => fnIndex.get(p)).filter(Boolean) as { fn: MapFunction; chapter: MapChapter }[];
  const sized = entries.map(({ fn }) => {
    const units = unitsFor(fn);
    const width = units * FN_W + (units - 1) * OUTER_GAP;
    return { fn, units, width, inner: functionLayout(fn, width, units) };
  });
  const board = packToAspect(sized.map((s) => ({ id: s.fn.path, units: s.units, height: s.inner.height })), FN_W, OUTER_GAP, aspect);
  const nodes: Node[] = [];
  const rects = new Map<string, Rect>();
  for (const p of board.placed) {
    const s = sized.find((x) => x.fn.path === p.id)!;
    const { chapter } = fnIndex.get(p.id)!;
    nodes.push({ id: s.fn.path, type: 'func', position: { x: p.x, y: p.y }, data: { fn: s.fn, slug: chapter.slug, chapter: chapter.prefix, locale, state: 'idle', outside: outside.get(s.fn.path) }, style: { width: p.width, height: p.height }, width: p.width, height: p.height, zIndex: 0, ...base });
    rects.set(s.fn.path, { x: p.x, y: p.y, w: p.width, h: p.height });
    for (const cp of s.inner.packed.placed) {
      const comp = s.fn.components.find((c) => c.path === cp.id)!;
      const cx = FN_PAD + cp.x, cy = FN_HEAD + cp.y;
      nodes.push({ id: `comp-${comp.path}`, type: 'comp', parentId: s.fn.path, extent: 'parent', position: { x: cx, y: cy }, data: { comp }, style: { width: cp.width, height: cp.height }, width: cp.width, height: cp.height, zIndex: 1, ...base });
      comp.caps.forEach((cap, k) => {
        const capW = cp.width - 2 * COMP_PAD;
        const y = COMP_HEAD + k * (CAP_H + CAP_GAP);
        nodes.push({ id: cap.path, type: 'cap', parentId: `comp-${comp.path}`, extent: 'parent', position: { x: COMP_PAD, y }, data: { cap, slug: chapter.slug, locale, state: 'idle' }, style: { width: capW, height: CAP_H }, width: capW, height: CAP_H, zIndex: 2, ...base });
        rects.set(cap.path, { x: p.x + cx + COMP_PAD, y: p.y + cy + y, w: capW, h: CAP_H });
      });
    }
  }
  return { nodes, rects };
}

// Pick the handle pair that faces the other end, so curves leave and enter on the near sides.
function facing(a: Rect, b: Rect): { from: Side; to: Side } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' };
  return dy >= 0 ? { from: 'b', to: 't' } : { from: 't', to: 'b' };
}

export function ResearchMap({ locale }: { locale: Locale }) {
  const { resolvedTheme } = useTheme();
  const [tab, setTab] = useState<string>('overview');
  const [hovered, setHovered] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1.8);
  const box = useRef<HTMLDivElement>(null);
  const flow = flows.find((f) => f.id === tab);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => { if (el.clientHeight > 0) setAspect(Math.max(0.5, Math.min(3, el.clientWidth / el.clientHeight))); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { baseNodes, rects, links } = useMemo(() => {
    if (!flow) {
      const o = overviewLayout(locale, aspect);
      return { baseNodes: o.nodes, rects: o.rects, links: [] as [string, string][] };
    }
    const inFlow = new Set(flow.functions);
    const inside: [string, string][] = [];
    const outside = new Map<string, number>();
    for (const [a, b] of data.links) {
      const fa = capFn.get(a)!, fb = capFn.get(b)!;
      if (inFlow.has(fa) && inFlow.has(fb)) inside.push([a, b]);
      else if (inFlow.has(fa)) outside.set(fa, (outside.get(fa) ?? 0) + 1);
      else if (inFlow.has(fb)) outside.set(fb, (outside.get(fb) ?? 0) + 1);
    }
    const l = flowLayout(flow.functions, locale, outside, aspect);
    return { baseNodes: l.nodes, rects: l.rects, links: inside };
  }, [flow, locale, aspect]);

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
    const out: Edge[] = [];
    const curve = (id: string, a: string, b: string, cls: string, color: string, on: boolean, label?: string): Edge | null => {
      const ra = rects.get(a), rb = rects.get(b);
      if (!ra || !rb) return null;
      const f = facing(ra, rb);
      return ({
        id, source: a, target: b, sourceHandle: `s-${f.from}`, targetHandle: `t-${f.to}`, type: 'smoothstep', pathOptions: { borderRadius: 10, offset: 18 }, className: cls, zIndex: 4,
        // labels only for the edges of what is hovered; at rest the curves stay quiet
        label: hovered && on ? label : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        style: { opacity: !hovered ? 0.45 : on ? 1 : 0.06 }, labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
      }) as Edge;
    };
    if (!flow) {
      for (const e of flowEdges) {
        const loop = e.kind === 'loop';
        const on = !hovered || e.source === hovered || e.target === hovered;
        const edge = curve(`flow-${e.source}-${e.target}`, e.source, e.target, loop ? 'rd-edge-loop' : 'rd-edge-flow', loop ? 'var(--rd-stage-edge)' : 'var(--rd-edge)', on, e.label[locale]);
        if (edge) out.push(edge);
      }
    } else {
      for (const [a, b] of links) {
        const on = !lit || (lit.has(a) && lit.has(b));
        const edge = curve(`link-${a}-${b}`, a, b, 'rd-edge-flow', 'var(--rd-edge)', on);
        if (edge) out.push(edge);
      }
    }
    return out;
  }, [flow, links, rects, hovered, lit, locale]);

  return (
    <div className="rd-map flex h-full w-full flex-col">
      <div ref={box} className="min-h-0 flex-1">
      <ReactFlow
        key={`${tab}-${Math.round(aspect * 4)}`}
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
      </div>
      <div className="docs-scenario-tabs" role="tablist" aria-label={mapCopy.overview[locale]}>
        {[{ id: 'overview', title: mapCopy.overview }, ...flows].map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={tab === f.id} className={tab === f.id ? 'is-active' : ''} onClick={() => { setTab(f.id); setHovered(null); }}>
            {f.title[locale]}
          </button>
        ))}
      </div>
      <p className="rd-map-hint">{mapCopy.hover[locale]}</p>
    </div>
  );
}
