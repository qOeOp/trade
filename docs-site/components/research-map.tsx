'use client';

import {
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
  CAP_GAP, CAP_H, COMP_GAP, COMP_HEAD, COMP_PAD, FN_HEAD, FN_PAD, FN_W,
  data, outsideLabel,
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

const functions = new Set<string>();
const capFn = new Map<string, string>();
for (const ch of data.chapters) for (const fn of ch.functions) {
  functions.add(fn.path);
  for (const comp of fn.components) for (const cap of comp.caps) capFn.set(cap.path, fn.path);
}

type FnData = { fn: MapFunction; slug: string; locale: Locale; state: string; outside?: number };
type CompData = { comp: MapComponent };
type CapData = { cap: MapCapability; slug: string; locale: Locale; state: string };

function FunctionNode({ data: d }: NodeProps<Node<FnData>>) {
  return (
    <div className={`rd-func rd-func-${d.state}`}>
      <Handles />
      <Link href={`/${d.locale}/docs/${d.slug}/#${anchorOf(d.fn.path)}`} className="rd-func-head">
        <span className="rd-box-id">{d.fn.label}</span>
        <span className="rd-func-title">{d.fn.title}</span>
      </Link>
      {d.outside ? <span className="rd-func-out">{outsideLabel[d.locale]} {d.outside}</span> : null}
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

const nodeTypes = { func: FunctionNode, comp: ComponentNode, cap: CapabilityNode };

const OUTER_GAP = 26;
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

// A chapter: its functions as bento tiles; big functions take two columns and lay their components out side by side.
function chapterLayout(chapter: MapChapter, locale: Locale, outside: Map<string, number>, aspect: number) {
  const sized = chapter.functions.map((fn) => {
    const units = unitsFor(fn);
    const width = units * FN_W + (units - 1) * OUTER_GAP;
    return { fn, units, width, inner: functionLayout(fn, width, units) };
  });
  const board = packToAspect(sized.map((s) => ({ id: s.fn.path, units: s.units, height: s.inner.height })), FN_W, OUTER_GAP, aspect);
  const nodes: Node[] = [];
  const rects = new Map<string, Rect>();
  for (const p of board.placed) {
    const s = sized.find((x) => x.fn.path === p.id)!;
    nodes.push({ id: s.fn.path, type: 'func', position: { x: p.x, y: p.y }, data: { fn: s.fn, slug: chapter.slug, locale, state: 'idle', outside: outside.get(s.fn.path) }, style: { width: p.width, height: p.height }, width: p.width, height: p.height, zIndex: -1, ...base });
    rects.set(s.fn.path, { x: p.x, y: p.y, w: p.width, h: p.height });
    for (const cp of s.inner.packed.placed) {
      const comp = s.fn.components.find((c) => c.path === cp.id)!;
      const cx = FN_PAD + cp.x, cy = FN_HEAD + cp.y;
      nodes.push({ id: `comp-${comp.path}`, type: 'comp', parentId: s.fn.path, extent: 'parent', position: { x: cx, y: cy }, data: { comp }, style: { width: cp.width, height: cp.height }, width: cp.width, height: cp.height, zIndex: 1, ...base });
      comp.caps.forEach((cap, k) => {
        const capW = cp.width - 2 * COMP_PAD;
        const y = COMP_HEAD + k * (CAP_H + CAP_GAP);
        nodes.push({ id: cap.path, type: 'cap', parentId: `comp-${comp.path}`, extent: 'parent', position: { x: COMP_PAD, y }, data: { cap, slug: chapter.slug, locale, state: 'idle' }, style: { width: capW, height: CAP_H }, width: capW, height: CAP_H, zIndex: 3, ...base });
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

// One chapter's functions, components and capabilities; `interactive` enables pan and zoom.
export function ResearchMap({ locale, chapter, interactive = true }: { locale: Locale; chapter: string; interactive?: boolean }) {
  const { resolvedTheme } = useTheme();
  const [hovered, setHovered] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1.8);
  const box = useRef<HTMLDivElement>(null);

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
    const ch = data.chapters.find((c) => c.prefix === chapter)!;
    const inChapter = new Set(ch.functions.map((f) => f.path));
    const inside: [string, string][] = [];
    const outside = new Map<string, number>();
    for (const [a, b] of data.links) {
      const fa = capFn.get(a)!, fb = capFn.get(b)!;
      if (inChapter.has(fa) && inChapter.has(fb)) inside.push([a, b]);
      else if (inChapter.has(fa)) outside.set(fa, (outside.get(fa) ?? 0) + 1);
      else if (inChapter.has(fb)) outside.set(fb, (outside.get(fb) ?? 0) + 1);
    }
    const l = chapterLayout(ch, locale, outside, aspect);
    return { baseNodes: l.nodes, rects: l.rects, links: inside };
  }, [chapter, locale, aspect]);

  const lit = useMemo(() => {
    if (!hovered) return null;
    const ids = new Set<string>([hovered]);
    const isFn = functions.has(hovered);
    for (const [a, b] of links) {
      const hit = isFn ? capFn.get(a) === hovered || capFn.get(b) === hovered : a === hovered || b === hovered;
      if (hit) { ids.add(a); ids.add(b); }
    }
    return ids;
  }, [hovered, links]);

  const nodes = useMemo(() => baseNodes.map((n) => {
    if (n.type !== 'cap' && n.type !== 'func') return n;
    const state = !lit ? 'idle' : lit.has(n.id) || (n.type === 'func' && hovered === n.id) ? 'on' : n.type === 'cap' ? 'dim' : 'idle';
    return { ...n, data: { ...n.data, state } };
  }), [baseNodes, lit, hovered]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const [a, b] of links) {
      const ra = rects.get(a), rb = rects.get(b);
      if (!ra || !rb) continue;
      const f = facing(ra, rb);
      const on = !lit || (lit.has(a) && lit.has(b));
      out.push({
        id: `link-${a}-${b}`, source: a, target: b, sourceHandle: `s-${f.from}`, targetHandle: `t-${f.to}`, type: 'smoothstep', pathOptions: { borderRadius: 10, offset: 18 }, className: 'rd-edge-flow',
        // the edge layer sits between the boxes and the cards (global.css), so a line never runs through a card
        zIndex: 0,
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--rd-edge)' },
        style: { opacity: !hovered ? 0.35 : on ? 1 : 0.06 },
      } as Edge);
    }
    return out;
  }, [links, rects, hovered, lit]);

  return (
    <div className="rd-map flex h-full w-full flex-col">
      <div ref={box} className="min-h-0 flex-1">
      <ReactFlow
        key={Math.round(aspect * 4)}
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
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        preventScrolling={interactive}
        onNodeMouseEnter={(_, node) => (node.type === 'cap' || node.type === 'func') && setHovered(node.id)}
        onNodeMouseLeave={(_, node) => (node.type === 'cap' || node.type === 'func') && setHovered(null)}
      >
        {interactive ? <Controls showInteractive={false} position="bottom-right" /> : null}
      </ReactFlow>
      </div>
    </div>
  );
}
