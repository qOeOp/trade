'use client';

import { useI18n } from 'fumadocs-ui/contexts/i18n';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { architectureRoutePath, createArchitectureLayout, mapBounds, mapTexts } from '@/lib/architecture-layout';
import type { Rect, TextMetrics } from '@/lib/architecture-map';
import { productArchitectureEdges, productArchitectureNodes } from '@/lib/product-architecture';
import { isLocale, type Locale } from '@/lib/i18n';

const items = new Map(productArchitectureNodes.map(node => [node.id, node]));
const relations = new Map(productArchitectureEdges.map(edge => [edge.id, edge]));
type Selection = { node: string } | { relation: string } | null;
const activate = (event: KeyboardEvent<SVGGElement>, action: () => void) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault(); event.stopPropagation(); action();
};

export function ArchitectureMap({ locale: initialLocale }: { locale: Locale }) {
  const { locale: contextLocale } = useI18n();
  const locale = contextLocale && isLocale(contextLocale) ? contextLocale : initialLocale;
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ReadonlyMap<string, TextMetrics>>(new Map());
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<Rect>(mapBounds);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoveredRelation, setHoveredRelation] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const drag = useRef<{ x: number; y: number; view: Rect; moved: boolean } | null>(null);
  const markerId = useId().replace(/:/g, '');
  const layout = useMemo(() => createArchitectureLayout(metrics), [metrics]);
  const selectedItem = selection && 'node' in selection ? items.get(selection.node) : undefined;
  const selectedRelation = selection && 'relation' in selection ? relations.get(selection.relation) : undefined;
  const activeRelation = hoveredRelation ?? selectedRelation?.id;
  const zoomed = view.width < mapBounds.width - 1 || view.height < mapBounds.height - 1;

  useEffect(() => {
    let cancelled = false;
    const page = document.documentElement;
    const measure = async () => {
      const canvas = canvasRef.current?.getBoundingClientRect();
      const home = canvasRef.current?.closest<HTMLElement>('#nd-home-layout');
      if (home && canvas) {
        // Align the navigation with the fitted overview, including SVG letterboxing.
        // This stays fixed when the diagram itself is zoomed or panned.
        const scale = Math.min(canvas.width / mapBounds.width, canvas.height / mapBounds.height);
        const contentX = Math.min(...layout.surfaces.map(surface => surface.x)) - mapBounds.x;
        const inset = canvas.left - home.getBoundingClientRect().left
          + (canvas.width - mapBounds.width * scale) / 2 + contentX * scale;
        page.style.setProperty('--home-map-inset', `${inset}px`);
      }
      await document.fonts.ready;
      if (cancelled || !svgRef.current) return;
      const measured = new Map<string, TextMetrics>();
      svgRef.current.querySelectorAll<SVGTextElement>('text[data-map-text]').forEach(el => {
        const b = el.getBBox();
        measured.set(el.dataset.mapText!, { left: b.x - Number(el.getAttribute('x')),
          top: b.y - Number(el.getAttribute('y')), width: b.width, height: b.height });
      });
      setMetrics(previous => {
        const changed = measured.size !== previous.size || [...measured].some(([id, next]) => {
          const old = previous.get(id);
          return !old || (['left', 'top', 'width', 'height'] as const).some(key => Math.abs(old[key] - next[key]) > .1);
        });
        return changed ? measured : previous;
      });
    };
    void measure();
    document.fonts.addEventListener('loadingdone', measure);
    const observer = new ResizeObserver(() => { void measure(); });
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => {
      cancelled = true; observer.disconnect(); document.fonts.removeEventListener('loadingdone', measure);
      page.style.removeProperty('--home-map-inset');
    };
  }, [view]);
  useEffect(() => {
    if (metrics.size !== mapTexts.length) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [metrics]);
  useEffect(() => {
    const reset = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setView(mapBounds); setSelection(null); setHoveredRelation(null); }
    };
    window.addEventListener('keydown', reset);
    return () => window.removeEventListener('keydown', reset);
  }, []);

  const restore = () => { setView(mapBounds); setSelection(null); setHoveredRelation(null); };
  const focus = (rect: Rect) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const width = Math.max(rect.width + 96, (rect.height + 96) * aspect);
    const height = width / aspect;
    setView({ x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height });
  };
  const selectNode = (node: string, region = false) => {
    if (drag.current?.moved) return;
    setSelection({ node }); setHoveredRelation(null);
    const surface = layout.surfaces.find(s => s.node === node);
    if (surface && region) focus(surface);
    else if ((canvasRef.current?.clientWidth ?? 0) < 800) {
      // Mobile starts with the same complete overview; tap a component to read its owning region.
      const parent = surface?.tier === 'external' ? undefined
        : surface ?? layout.surfaces.find(s => s.node === items.get(node)?.parent);
      if (parent) focus(parent);
    }
  };
  const selectRelation = (id: string) => {
    if (drag.current?.moved) return;
    setSelection({ relation: id }); setHoveredRelation(null);
  };
  const zoom = (factor: number) => {
    const width = Math.max(480, Math.min(mapBounds.width, view.width / factor));
    if (width === mapBounds.width) { setView(mapBounds); return; }
    const height = view.height * width / view.width;
    setView({ x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height });
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    suppressClick.current = false;
    if (!zoomed || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = drag.current, canvas = canvasRef.current;
    if (!start || !canvas) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    start.moved = true; setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = Math.min(canvas.clientWidth / start.view.width, canvas.clientHeight / start.view.height);
    setView({ ...start.view, x: start.view.x - dx / scale, y: start.view.y - dy / scale });
  };
  const pointerUp = () => {
    setDragging(false);
    suppressClick.current = Boolean(drag.current?.moved);
    drag.current = null;
  };
  const nodeLabel = (id: string) => items.get(id)?.title ?? id;
  const related = selectedItem ? productArchitectureEdges.filter(e => e.source === selectedItem.id || e.target === selectedItem.id) : [];
  const description = selectedItem?.description?.[locale] ?? selectedRelation?.description[locale];
  const docsRoute = selectedItem?.docsRoute ?? selectedRelation?.docsRoute;

  return <section className="docs-architecture-shell" aria-label={locale === 'zh' ? '产品架构' : 'Product architecture'}>
    <div ref={canvasRef} className={`docs-map-canvas${ready ? ' is-ready' : ''}${zoomed ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
      aria-busy={!ready}>
      <svg ref={svgRef} className="docs-map-svg" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="xMidYMid meet" role="group" aria-label={locale === 'zh' ? '产品架构 Map，可选择区域、组件或关系查看详情' : 'Product architecture map. Select a region, component or relation for details.'}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
        onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
        onClick={() => { if (!drag.current?.moved) { setSelection(null); setHoveredRelation(null); } }}>
        <defs>{['primary', 'supporting'].map(tone => <marker key={tone} id={`${markerId}-${tone}`}
          viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 1L9 5L1 9" className={`docs-map-arrow ${tone}`} />
        </marker>)}</defs>
        {layout.surfaces.map(box => {
          const region = items.get(box.node)?.kind === 'region' && box.tier !== 'component';
          return <g key={box.id} className={`docs-map-surface tier-${box.tier}${box.accent ? ' is-accent' : ''}${selectedItem?.id === box.node ? ' is-selected' : ''}`}
            data-map-node={box.node} role="button" tabIndex={0} aria-label={nodeLabel(box.node)}
            onClick={event => { event.stopPropagation(); selectNode(box.node, region); }}
            onKeyDown={event => activate(event, () => selectNode(box.node, region))}>
            <rect {...{ x: box.x, y: box.y, width: box.width, height: box.height, rx: box.radius }} />
          </g>;
        })}
        {layout.rules.map(rule => <path key={rule.id} d={rule.d} className="docs-map-divider" />)}
        {layout.decorations.map(box => <rect key={box.id} x={box.x} y={box.y} width={box.width}
          height={box.height} rx={box.radius} className="docs-map-reference-frame" />)}
        {layout.routes.map((route, index) => {
          const d = architectureRoutePath(route.points);
          const members = route.relations.map(id => relations.get(id)!);
          const relation = members.length === 1 ? members[0] : undefined;
          const sharedTarget = members.length > 1 && members.every(edge => edge.target === members[0].target)
            ? members[0].target : undefined;
          const active = route.relations.includes(activeRelation ?? '') || Boolean(sharedTarget && selectedItem?.id === sharedTarget);
          const label = members.length ? `${members.map(edge => nodeLabel(edge.source)).join(' / ')} → ${nodeLabel(members[0].target)}` : '';
          const selectRoute = () => {
            if (relation) selectRelation(relation.id);
            else if (sharedTarget) selectNode(sharedTarget, items.get(sharedTarget)?.kind === 'region');
          };
          return <g key={route.id || `legend-${index}`} data-map-relations={route.relations.join(' ')}
            className={`docs-map-route ${route.primary ? 'primary' : 'supporting'}${active ? ' is-active' : ''}`}>
            <path d={d} className="docs-map-wire" markerEnd={route.arrow ? `url(#${markerId}-${route.primary ? 'primary' : 'supporting'})` : undefined} />
            {route.junction ? <circle cx={route.junction[0]} cy={route.junction[1]} r={3.5}
              className="docs-map-junction" aria-hidden="true" /> : null}
            {relation || sharedTarget ? <path d={d} className="docs-map-route-hit" role="button" tabIndex={0}
              aria-label={label}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault(); event.stopPropagation(); selectRoute();
              } }} onPointerEnter={() => { if (relation) setHoveredRelation(relation.id); }}
              onPointerLeave={() => { if (relation) setHoveredRelation(current => current === relation.id ? null : current); }}
              onClick={event => { event.stopPropagation(); selectRoute(); }} /> : null}
          </g>;
        })}
        {layout.texts.map(t => <text key={t.id} x={t.x} y={t.y} fontSize={t.size} fontWeight={t.weight} textAnchor={t.anchor}
          data-map-text={t.id} data-map-relations={t.relations.join(' ')}
          className={`docs-map-text tone-${t.tone}${t.relations.includes(activeRelation ?? '') ? ' is-active' : ''}`}>{t.text}</text>)}
        {layout.targets.map(target => <g key={`${target.node}-${target.texts.join()}`} className={`docs-map-target${selectedItem?.id === target.node ? ' is-selected' : ''}`}
          data-map-node={target.node} role="button" tabIndex={0} aria-label={nodeLabel(target.node)}
          onClick={event => { event.stopPropagation(); selectNode(target.node, target.region); }}
          onKeyDown={event => activate(event, () => selectNode(target.node, target.region))}>
          <rect x={target.x} y={target.y} width={target.width} height={target.height} rx={3} />
        </g>)}
        {layout.references.map(target => <g key={target.texts.join()} data-map-reference={target.relation}
          className={`docs-map-target docs-map-reference${activeRelation === target.relation ? ' is-selected' : ''}`}
          role="button" tabIndex={0}
          aria-label={`${nodeLabel(relations.get(target.relation)!.source)} → ${nodeLabel(relations.get(target.relation)!.target)}`}
          onPointerEnter={() => setHoveredRelation(target.relation)}
          onPointerLeave={() => setHoveredRelation(current => current === target.relation ? null : current)}
          onClick={event => { event.stopPropagation(); selectRelation(target.relation); }}
          onKeyDown={event => activate(event, () => selectRelation(target.relation))}>
          <rect x={target.x} y={target.y} width={target.width} height={target.height} rx={3} />
        </g>)}
      </svg>
      <span className="docs-map-hint">{locale === 'zh' ? '点区域放大，点组件查看详情' : 'Tap a region to zoom, a component for details'}</span>
      <div className="docs-map-controls" aria-label={locale === 'zh' ? '地图缩放' : 'Map zoom'}>
        <button type="button" aria-label={locale === 'zh' ? '放大' : 'Zoom in'} onClick={() => zoom(1.5)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12h14M12 5v14" /></svg>
        </button>
        <button type="button" aria-label={locale === 'zh' ? '缩小' : 'Zoom out'} onClick={() => zoom(1 / 1.5)} disabled={!zoomed}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" aria-label={locale === 'zh' ? '适应画布' : 'Fit diagram'} onClick={restore}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
        </button>
      </div>
      {selection ? <aside className="docs-map-detail" aria-live="polite" aria-label={locale === 'zh' ? '架构详情' : 'Architecture details'}>
        <button type="button" className="docs-map-detail-close" aria-label={locale === 'zh' ? '关闭详情' : 'Close details'} onClick={() => setSelection(null)}>×</button>
        <strong>{selectedItem?.title ?? (selectedRelation ? `${nodeLabel(selectedRelation.source)} → ${nodeLabel(selectedRelation.target)}` : '')}</strong>
        {description ? <p>{description}</p> : null}
        {docsRoute ? <Link href={`/${locale}/docs/${docsRoute}`}>{locale === 'zh' ? '查看文档 →' : 'Read docs →'}</Link> : null}
        {related.length ? <details><summary>{locale === 'zh' ? `相关架构关系（${related.length}）` : `Architecture relations (${related.length})`}</summary>
          <ul>{related.map(edge => <li key={edge.id}><button type="button" onClick={() => selectRelation(edge.id)}>
            {nodeLabel(edge.source)} → {nodeLabel(edge.target)}
          </button><p>{edge.description[locale]}</p></li>)}</ul>
        </details> : null}
      </aside> : null}
    </div>
  </section>;
}
