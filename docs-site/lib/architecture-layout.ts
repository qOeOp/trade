import { Position, type Edge, type Node, type Viewport } from '@xyflow/react';
import type { ArchitectureEdgeData, DiagramNodeData } from './architecture-map';
import { fitViewport } from './viewport-gate.mjs';

type DiagramNode = Node<DiagramNodeData>;
type Point = [number, number];
type Rect = { x: number; y: number; width: number; height: number };
type Canvas = { width: number; height: number };
type Handle = { id: string; position: Position; offset: number };
type Handles = ReadonlyMap<string, readonly Handle[]>;
type Anchor = { point: Point; side: Position };

function absoluteRects(nodes: readonly DiagramNode[]) {
  const index = new Map(nodes.map(node => [node.id, node]));
  const rects = new Map<string, Rect>();
  const resolve = (node: DiagramNode): Rect => {
    const known = rects.get(node.id);
    if (known) return known;
    const parent = node.parentId ? index.get(node.parentId) : undefined;
    const origin = parent ? resolve(parent) : { x: 0, y: 0 };
    const rect = {
      x: origin.x + node.position.x, y: origin.y + node.position.y,
      width: Number(node.width ?? node.measured?.width ?? node.style?.width ?? 0),
      height: Number(node.height ?? node.measured?.height ?? node.style?.height ?? 0),
    };
    rects.set(node.id, rect);
    return rect;
  };
  for (const node of nodes) resolve(node);
  return rects;
}

function rootBounds(nodes: readonly DiagramNode[], rects: ReadonlyMap<string, Rect>): Rect {
  const roots = nodes.filter(node => !node.parentId).map(node => rects.get(node.id)!);
  if (roots.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...roots.map(rect => rect.x));
  const y = Math.min(...roots.map(rect => rect.y));
  return {
    x, y,
    width: Math.max(...roots.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...roots.map(rect => rect.y + rect.height)) - y,
  };
}

function pad(bounds: Rect, x: number, y: number): Rect {
  return { x: bounds.x - x, y: bounds.y - y, width: bounds.width + 2 * x, height: bounds.height + 2 * y };
}

/** Every high/low root pair must fit; each extent is affine in the axis scale. */
function maximumScale(nodes: readonly DiagramNode[], rects: ReadonlyMap<string, Rect>, axis: 'x' | 'y', target: number) {
  const size = axis === 'x' ? 'width' : 'height';
  const extents = nodes.filter(node => !node.parentId).map(node => {
    const rect = rects.get(node.id)!;
    if (node.data.nodeType !== 'architecture') {
      return { low: [rect[axis], 0], high: [rect[axis] + rect[size], 0] };
    }
    const center = rect[axis] + rect[size] / 2;
    return { low: [center, -rect[size] / 2], high: [center, rect[size] / 2] };
  });
  let scale = 2;
  for (const high of extents) for (const low of extents) {
    const slope = high.high[0] - low.low[0];
    if (slope > 0) scale = Math.min(scale, (target - high.high[1] + low.low[1]) / slope);
  }
  return Math.max(1, scale);
}

function anchor(rect: Rect, handle: Handle): Anchor {
  const { position: side, offset } = handle;
  switch (side) {
    case Position.Top: return { side, point: [rect.x + rect.width / 2 + offset, rect.y] };
    case Position.Bottom: return { side, point: [rect.x + rect.width / 2 + offset, rect.y + rect.height] };
    case Position.Left: return { side, point: [rect.x, rect.y + rect.height / 2 + offset] };
    case Position.Right: return { side, point: [rect.x + rect.width, rect.y + rect.height / 2 + offset] };
  }
}

function lead({ point: [x, y], side }: Anchor): Point {
  switch (side) {
    case Position.Top: return [x, y - 12];
    case Position.Bottom: return [x, y + 12];
    case Position.Left: return [x - 12, y];
    case Position.Right: return [x + 12, y];
  }
}

const vertical = (side: Position) => side === Position.Top || side === Position.Bottom;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Spend desktop whitespace on separation while keeping leaf text and port spacing unchanged. */
export function createArchitectureLayout(
  nodes: readonly DiagramNode[], edges: readonly Edge[], handles: Handles, canvas: Canvas | null,
): { nodes: DiagramNode[]; edges: Edge[]; bounds: Rect; viewport: Viewport } {
  const base = absoluteRects(nodes);
  const originalBounds = rootBounds(nodes, base);
  if (!canvas || canvas.width < 960 || canvas.height <= 0) {
    const bounds = {
      x: originalBounds.x - 45, y: originalBounds.y - 10,
      width: originalBounds.width + 75, height: originalBounds.height + 20,
    };
    return {
      nodes: [...nodes], edges: [...edges], bounds,
      viewport: canvas ? fitViewport(canvas, bounds, 0.025) : { x: 0, y: 0, zoom: 0.08 },
    };
  }

  const inner = { width: Math.max(1, canvas.width - 24), height: Math.max(1, canvas.height - 24) };
  const padded = pad(originalBounds, 16, 12);
  const zoom = Math.min(0.73, inner.width / padded.width, inner.height / padded.height);
  const sx = maximumScale(nodes, base, 'x', inner.width / zoom - 32);
  const sy = maximumScale(nodes, base, 'y', inner.height / zoom - 24);
  const expanded = new Map<string, Rect>();
  for (const node of nodes) {
    const rect = base.get(node.id)!;
    expanded.set(node.id, node.data.nodeType === 'architecture'
      ? { x: (rect.x + rect.width / 2) * sx - rect.width / 2,
        y: (rect.y + rect.height / 2) * sy - rect.height / 2, width: rect.width, height: rect.height }
      : { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy });
  }

  const layoutNodes = nodes.map(node => {
    const rect = expanded.get(node.id)!;
    const parent = node.parentId ? expanded.get(node.parentId) : undefined;
    return {
      ...node, position: { x: rect.x - (parent?.x ?? 0), y: rect.y - (parent?.y ?? 0) },
      width: rect.width, height: rect.height, style: { ...node.style, width: rect.width, height: rect.height },
    };
  });
  const layoutEdges = edges.map(edge => {
    const sourceHandle = handles.get(edge.source)?.find(handle => handle.id === edge.sourceHandle);
    const targetHandle = handles.get(edge.target)?.find(handle => handle.id === edge.targetHandle);
    if (!sourceHandle || !targetHandle) return edge;
    const source = anchor(base.get(edge.source)!, sourceHandle);
    const target = anchor(base.get(edge.target)!, targetHandle);
    const newSource = anchor(expanded.get(edge.source)!, sourceHandle);
    const newTarget = anchor(expanded.get(edge.target)!, targetHandle);
    const projectPoint = (point: Point): Point => {
      let x = point[0] * sx, y = point[1] * sy;
      for (const [original, current] of [[source, newSource], [target, newTarget]]) {
        if (vertical(original.side) && near(point[0], original.point[0])) x = current.point[0];
        if (!vertical(original.side) && near(point[1], original.point[1])) y = current.point[1];
      }
      return [x, y];
    };
    const sourceLead = lead(source), targetLead = lead(target);
    const data = edge.data as ArchitectureEdgeData | undefined;
    const route = data?.route;
    const via: Point[] | undefined = !route ? undefined : 'via' in route ? route.via : route.axis === 'x'
      ? [[route.at, sourceLead[1]], [route.at, targetLead[1]]]
      : [[sourceLead[0], route.at], [targetLead[0], route.at]];
    return {
      ...edge,
      data: {
        ...edge.data, route: via ? { via: via.map(projectPoint) } : undefined,
        leadPoints: { source: projectPoint(sourceLead), target: projectPoint(targetLead) },
      },
    };
  });
  const bounds = pad(rootBounds(layoutNodes, expanded), 16, 12);
  return {
    nodes: layoutNodes, edges: layoutEdges, bounds,
    viewport: { x: canvas.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: canvas.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom },
  };
}
