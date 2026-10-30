import type { MapTarget, Point, Rect, TextMetrics } from './architecture-map';
import { mapDecorations, mapRoutes, mapRules, mapSurfaces, mapTexts, referenceTargets, textTargets } from './architecture-scene';

export { mapBounds, mapTexts } from './architecture-scene';

const union = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x,
    height: Math.max(...rects.map(r => r.y + r.height)) - y };
};

/** Keep the approved geometry fixed; measure the product font only for text hit areas. */
export function createArchitectureLayout(metrics: ReadonlyMap<string, TextMetrics>) {
  const glyphs = new Map(mapTexts.map(t => {
    const measured = metrics.get(t.id), width = t.text.length * t.size * .6;
    const left = t.anchor === 'middle' ? -width / 2 : t.anchor === 'end' ? -width : 0;
    return [t.id, { x: t.x + (measured?.left ?? left), y: t.y + (measured?.top ?? -t.size / 2),
      width: measured?.width ?? width, height: measured?.height ?? t.size }] as const;
  }));
  const hitArea = (ids: string[], padding: number): Rect => {
    const r = union(ids.map(id => glyphs.get(id)!));
    return { x: r.x - padding, y: r.y - padding, width: r.width + padding * 2, height: r.height + padding * 2 };
  };
  const targets: MapTarget[] = textTargets.map(t => ({ ...t, ...hitArea(t.texts, 8), region: false }));
  const references = referenceTargets.map(t => ({ ...t, ...hitArea(t.texts, 6) }));
  return { texts: mapTexts, surfaces: mapSurfaces, routes: mapRoutes, rules: mapRules,
    decorations: mapDecorations, targets, references, glyphs };
}

/** Rounded orthogonal corners retain room for the straight approach to each port. */
export function architectureRoutePath(chunks: Point[][]): string {
  return chunks.filter(points => points.length > 1).map(points => {
    let d = `M${points[0].join(' ')}`;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const before = Math.hypot(b[0] - a[0], b[1] - a[1]), after = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (!before || !after) continue;
      const radius = Math.min(12, before / 2, after / 2);
      const entry = b.map((v, axis) => v - (v - a[axis]) * radius / before);
      const exit = b.map((v, axis) => v + (c[axis] - v) * radius / after);
      d += `L${entry.join(' ')}Q${b.join(' ')} ${exit.join(' ')}`;
    }
    return `${d}L${points.at(-1)!.join(' ')}`;
  }).join(' ');
}
