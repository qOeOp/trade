import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  advanceStableFrame,
  edgePathsMatch,
  fitViewport,
  flowFrameReady,
  focusViewport,
  viewportTargetChanged,
} from '../lib/viewport-gate.mjs';
import { validateCanonicalProjectionContract } from './prepare-content.mjs';
import { RECOVERY_TRIGGER_BRANCH_ORACLE } from './lib/scenario-relation-oracle.mjs';

const root = new URL('../', import.meta.url);

test('keeps the home page simple and scenario-led', async () => {
  const [home, controls, provider, map, styles] = await Promise.all([
    readFile(new URL('components/home-page.tsx', root), 'utf8'),
    readFile(new URL('components/site-controls.tsx', root), 'utf8'),
    readFile(new URL('components/provider.tsx', root), 'utf8'),
    readFile(new URL('components/architecture-map.tsx', root), 'utf8'),
    readFile(new URL('app/global.css', root), 'utf8'),
  ]);

  assert.match(home, /<ArchitectureMap locale=\{locale\}/);
  assert.match(home, /max-w-\(--fd-layout-width\) px-4/);
  assert.doesNotMatch(home, /sm:px-6/);
  assert.doesNotMatch(home, /<h1|homeContent|Get started|开始使用/);
  assert.doesNotMatch(home, /github|page\.sections|sections\.map/i);
  assert.match(controls, /const isDocsRoute = pathname\.split\('\/'\)\.includes\('docs'\)/);
  assert.match(controls, /const inheritedClassName = isDocsRoute \? undefined : className/);
  assert.match(controls, /isDocsRoute \? 'docs-site-controls' : inheritedClassName/);
  assert.match(controls, /!isDocsRoute && \(/);
  assert.match(controls, /href=\{`\/\$\{locale\}\/docs\/guide`\}/);
  assert.match(controls, /locale === 'zh' \? '开始使用' : 'Get started'/);
  assert.doesNotMatch(controls, /site-controls-glass/);
  assert.match(controls, /shrink-0 flex-nowrap/);
  assert.match(controls, /shrink-0 items-center whitespace-nowrap rounded-full bg-fd-primary/);
  assert.doesNotMatch(styles, /\.site-controls-glass/);
  assert.match(styles, /aside \[class~="bg-fd-secondary\/50"\]\[class~="empty:hidden"\]\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent/);
  assert.match(provider, /isLocaleHomePath\(pathname\)/);
  assert.match(provider, /window\.history\.pushState\(null, '', localeHomeUrl\(nextLocale\)\)/);
  assert.match(provider, /onLocaleChange: switchHomeLocale/);
  assert.match(provider, /window\.addEventListener\('popstate', syncFromLocation\)/);
  assert.match(styles, /\.docs-home-container\s*\{[\s\S]*?height: calc\(100dvh - 4rem\)/);
  assert.match(map, /role="tablist"/);
  assert.match(map, /<ReactFlow/);
  assert.doesNotMatch(map, /<Background|BackgroundVariant/);
  assert.match(map, /useTheme/);
  assert.match(map, /const \{ locale: contextLocale \} = useI18n\(\)/);
  assert.match(map, /const locale: Locale = contextLocale && isLocale\(contextLocale\) \? contextLocale : initialLocale/);
  assert.match(map, /selectedData\.description\[locale\]/);
  assert.match(map, /const \[themeMounted, setThemeMounted\] = useState\(false\)/);
  assert.match(map, /const \[canvasReady, setCanvasReady\] = useState\(false\)/);
  assert.match(map, /useEffect\(\(\) => setThemeMounted\(true\), \[\]\)/);
  assert.match(map, /colorMode=\{themeMounted \? resolvedTheme === 'dark' \? 'dark' : 'light' : undefined\}/);
  assert.doesNotMatch(map, /docs-map-node-dot/);
  assert.doesNotMatch(map, /docs-architecture-heading/);
  assert.match(map, /panOnDrag=\{canPan\}/);
  assert.match(map, /minZoom=\{minimumZoom\}/);
  assert.match(map, /onPaneClick=\{\(\) => \{[\s\S]*?setSelectedEdgeId\(null\)/);
  assert.match(map, /fitViewport\(bounds, architectureBounds\)/);
  assert.match(map, /viewport=\{viewport\}/);
  assert.match(map, /onViewportChange=\{setViewport\}/);
  assert.match(map, /typeof ResizeObserver === 'undefined' \? null : new ResizeObserver\(refit\)/);
  assert.match(map, /fittedViewportRef\.current = fitted;[\s\S]*?setViewport\(fitted\)/);
  assert.doesNotMatch(map, /setViewport\(fitted\);\s*setCanvasReady\(true\)/);
  assert.doesNotMatch(map, /handleViewportChange/);
  assert.match(map, /requestAnimationFrame\(\(\) => \{[\s\S]*?new DOMMatrixReadOnly\(getComputedStyle\(viewportElement\)\.transform\)/);
  assert.match(map, /flowFrameReady\(applied, target, renderedEdgePaths, expectedEdgeIds\)/);
  assert.match(map, /const expectedEdgeIdsRef = useRef\(visibleEdges\.map\(\(edge\) => edge\.id\)\.sort\(\)\)/);
  assert.match(map, /edge\.dataset\.id[\s\S]*?react-flow__edge-path[\s\S]*?edge\.id}:\$\{edge\.path}/);
  assert.doesNotMatch(map, /const expectedEdges = visibleEdges\.length/);
  assert.match(map, /if \(stableFrame\.count >= 2\) \{[\s\S]*?setCanvasReady\(true\)/);
  assert.match(map, /if \(!viewportTargetChanged\(fittedViewportRef\.current, fitted\)\) \{[\s\S]*?!canvasReadyRef\.current && revealFrameRef\.current === null[\s\S]*?waitForStableFlow\(\)/);
  assert.match(map, /return \(\) => \{[\s\S]*?cancelAnimationFrame\(revealFrameRef\.current\);[\s\S]*?revealFrameRef\.current = null;/);
  assert.match(map, /if \(!viewportTargetChanged\(fittedViewportRef\.current, fitted\)\) \{[\s\S]*?return;[\s\S]*?setCanvasReady\(false\);[\s\S]*?fittedViewportRef\.current = fitted/);
  assert.match(map, /canvasReady \? ' is-ready' : ''/);
  assert.match(map, /if \(nextScenario === scenario\) return;[\s\S]*?canvasReadyRef\.current = false;[\s\S]*?setCanvasReady\(false\);[\s\S]*?setScenario\(nextScenario\)/);
  assert.match(map, /window\.addEventListener\('resize', refit\);[\s\S]*?\}, \[scenario\]\);/);
  assert.match(styles, /\.docs-flow-canvas \.react-flow\s*\{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none/);
  assert.match(styles, /\.docs-flow-canvas\.is-ready \.react-flow\s*\{[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto/);
  assert.match(map, /data-detail=\{selectedDescription \|\| edgeDescription \? 'true' : undefined\}/);
  assert.match(map, /selectedDescription/);
  assert.match(map, /edgeDescription\[locale\]/);
  assert.match(map, /const edgeBinding = edgeData\?\.relation && edgeData\?\.objectId/);
  assert.match(map, /\$\{edgeData\.relation\.toUpperCase\(\)\} · \$\{edgeData\.objectId\} · \$\{edgeDetail\.source\} → \$\{edgeDetail\.target\}/);
  assert.match(map, /<span className="docs-edge-detail">[\s\S]*?<span className="docs-detail-meta">[\s\S]*?<code>\{edgeBinding\}<\/code>/);
  assert.doesNotMatch(map, /owner=\$\{edgeData\.|custodian=\$\{edgeData\.|business outcome owner=|no business outcome=|sourceRole=|objectAuthority=/);
  assert.doesNotMatch(map, /data-contract=/);
  assert.match(styles, /\.docs-edge-detail,[\s\S]*?\.docs-selected-detail\s*\{[\s\S]*?display: grid/);
  assert.match(styles, /\.docs-detail-meta\s*\{[\s\S]*?display: flex;[\s\S]*?max-width: 100ch/);
  assert.match(styles, /\.docs-edge-detail code,[\s\S]*?\.docs-selected-detail code\s*\{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.doesNotMatch(map, /data-admission|scenarioMeta\.admission|<i>/);
  assert.doesNotMatch(map, /docs-node-detail|kindLabels|detail-\$\{/);
  assert.doesNotMatch(styles, /\.docs-node-detail/);
  assert.match(map, /docs-architecture-shell[\s\S]+docs-architecture[\s\S]+docs-scenario-tabs/);
  assert.match(styles, /\.docs-scenario-tabs\s*\{[\s\S]*?position: relative;/);
  assert.match(styles, /\.docs-scenario-tabs\s*\{[\s\S]*?margin: 0\.65rem auto 0\.75rem;/);
  assert.match(styles, /\.docs-scenario-tabs\s*\{[\s\S]*?background: oklch\(1 0 0 \/ 60%\);[\s\S]*?backdrop-filter: blur\(4px\)/);
  assert.match(styles, /\.docs-scenario-tabs button\.is-active\s*\{[\s\S]*?background: #2d2d2d;[\s\S]*?color: #fff/);
  assert.match(map, /renderedNodeCatalog\.map/);
  assert.match(map, /pinnedArchitecture\.edges\.flatMap/);
  assert.doesNotMatch(map, /architectureScenes/);
  assert.match(map, /<BaseEdge/);
  assert.doesNotMatch(map, /EdgeLabelRenderer|docs-edge-label/);
  assert.doesNotMatch(styles, /\.docs-edge-label/);
  assert.match(map, /const edgeStroke = isStage \? 'var\(--map-stage-edge\)' : 'var\(--map-edge\)'/);
  assert.match(map, /const baseStrokeWidth = isPrimary[\s\S]*?\? 3\.25[\s\S]*?isSupporting[\s\S]*?1\.1 : 1\.3/);
  assert.match(map, /const baseOpacity = isPrimary \? 0\.96 : isSupporting \? 0\.34/);
  assert.match(map, /`docs-scenario-edge-\$\{scenarioRole\}`/);
  assert.match(map, /opacity: isHighlighted \? 1 : isDimmed \? 0\.1 : baseOpacity/);
  assert.match(map, /interactionWidth=\{0\}/);
  assert.match(map, /className="docs-edge-hit-area"/);
  assert.match(map, /strokeWidth=\{14\}/);
  assert.match(map, /strokeOpacity=\{0\.001\}/);
  assert.match(map, /pointerEvents="stroke"/);
  assert.match(map, /markerEnd=\{markerEnd\}/);
  assert.match(map, /className=\{edgeClassName\}/);
  assert.match(styles, /--map-edge: #1d4ed8/);
  assert.match(styles, /--map-edge: #3b82f6/);
  assert.match(styles, /--map-stage-edge: #8b5cf6/);
  assert.match(styles, /--map-stage-edge: #a78bfa/);
  assert.match(styles, /\.react-flow__edge-path\.docs-stage-edge\s*\{[\s\S]*?stroke-dasharray: none;[\s\S]*?animation: none;/);
  assert.doesNotMatch(map + styles, /isInternal|docs-internal-edge|map-internal-edge/);
  assert.match(map, /nodes=\{visibleNodes\}/);
  assert.match(map, /moduleActiveInScenario\(node\.data, scenario\)/);
  assert.match(map, /ownerGroupActiveInScenario\(node\.id, node\.data\.role, node\.data\.memberGroupIds, activeOwners\)/);
  assert.match(map, /relationVisibleInScenario\(\{ id: current\.id, scenarios: relation\.scenarios, overview: relation\.overview \}, scenario\)/);
  assert.match(map, /scenarioRole: relationRoleInScenario\(current\.id, scenario\)/);
  assert.doesNotMatch(map, /tone:.*muted/);
  assert.doesNotMatch(map, /<animateMotion/);
  assert.match(map, /activeHandles: \[\.\.\.\(activeHandles\.get\(node\.id\)/);
  assert.match(map, /function allocateEdgePins\(edges: Edge\[\]\)/);
  assert.match(map, /const groupKey = `\$\{nodeId\}:\$\{side\}`/);
  assert.match(map, /const pinGap = 28/);
  assert.match(map, /offset: \(index - \(group\.length - 1\) \/ 2\) \* pinGap/);
  assert.match(map, /sourceHandle: assigned\.get\(`\$\{edge\.id\}:source`\)/);
  assert.match(map, /targetHandle: assigned\.get\(`\$\{edge\.id\}:target`\)/);
  assert.match(map, /const pinnedArchitecture = allocateEdgePins\(fullArchitectureEdges\)/);
  assert.match(map, /const activeBySide = new Map<Position, PinHandle\[\]>\(\)/);
  assert.match(map, /activeOffsets\.set\(pin\.id, \(index - \(group\.length - 1\) \/ 2\) \* pinGap\)/);
  assert.match(map, /const offset = activeOffsets\.get\(pin\.id\) \?\? pin\.offset/);
  assert.match(map, /updateNodeInternals\(nodeId\)/);
  assert.match(map, /<NodePins nodeId=\{id\} activeHandles=\{data\.activeHandles\} \/>/);
  assert.doesNotMatch(map, /id="(?:source|target)-(?:left|top|right|bottom)"/);
  assert.doesNotMatch(map, /showNodeDetails|is-detail-zoom/);
  assert.doesNotMatch(map, /onlyRenderVisibleElements/);
  assert.match(styles, /\.react-flow__handle\.is-connected/);
  assert.match(styles, /@keyframes docs-edge-flow/);
  assert.doesNotMatch(styles, /\.docs-flow-canvas\.is-detail-zoom/);
  assert.doesNotMatch(map, /<Controls|\bControls,/);
  assert.match(styles, /--map-canvas: var\(--color-fd-background\)/);
  assert.match(styles, /\.docs-flow-canvas\s*\{[\s\S]*?background: transparent/);
  assert.doesNotMatch(styles, /react-flow__controls/);
  assert.match(styles, /\.docs-map-node\s*\{[\s\S]*?justify-content: center;[\s\S]*?text-align: center;/);
  assert.match(map, /data-label-size=\{labelSize\}/);
  assert.match(map, /data\.eventLines\.map/);
  assert.match(styles, /\.docs-map-bus-events\s*\{[\s\S]*?display: grid;[\s\S]*?line-height: 1\.35/);
  assert.match(map, /data\.title\.length >= 15 \? 'compact' : data\.title\.length >= 9 \? 'medium'/);
  assert.match(styles, /\.docs-map-node\[data-label-size="compact"\]/);
  assert.match(map, /const renderedNodeCatalog = architectureNodes/);
  assert.match(map, /isHighlighted: current\.id === focusedEdgeId/);
  assert.match(map, /isDimmed: focusedEdgeId !== null && current\.id !== focusedEdgeId/);
  assert.match(map, /focusedEdge \? belongsToFocusedEdge \? 1 : 0\.12 : opacity/);
  assert.match(styles, /\.docs-edge-hit-area\s*\{[\s\S]*?cursor: pointer/);
  assert.doesNotMatch(styles, /:has\(/);
  assert.match(map, /const EdgeInteractionContext = createContext/);
  assert.match(map, /onPointerEnter=\{\(\) => edgeInteraction\.enter\(id\)\}/);
  assert.match(map, /onPointerLeave=\{\(\) => edgeInteraction\.leave\(id\)\}/);
  assert.match(map, /onPointerCancel=\{\(\) => edgeInteraction\.leave\(id\)\}/);
  assert.match(map, /leave: \(edgeId: string\) => setHoveredEdgeId\(\(hoveredEdge\) => hoveredEdge === edgeId \? null : hoveredEdge\)/);
  assert.match(map, /onPointerLeave=\{\(\) => setHoveredEdgeId\(null\)\}/);
  assert.match(map, /onPointerCancel=\{\(\) => setHoveredEdgeId\(null\)\}/);
  assert.match(map, /window\.addEventListener\('blur', clearHoveredEdge\)/);
  assert.match(map, /document\.addEventListener\('mouseleave', clearHoveredEdge\)/);
  assert.match(map, /window\.removeEventListener\('blur', clearHoveredEdge\)/);
  assert.match(map, /document\.removeEventListener\('mouseleave', clearHoveredEdge\)/);
  assert.match(map, /select: \(edgeId: string\) => \{[\s\S]*?setSelectedEdgeId/);
  assert.match(map, /const focusedEdgeId = hoveredEdgeId \?\? selectedEdgeId;/);
  assert.match(map, /const edgeDetail = hoveredEdge \?\? selectedEdge/);
  assert.match(map, /<EdgeInteractionContext\.Provider value=\{edgeInteraction\}>/);
  assert.match(map, /scenario === 'overview'[\s\S]+?\? 1[\s\S]+?active \? 1/);
  assert.doesNotMatch(map, /node\.id === 'event-rail' \? 0\.84 : 0\.48/);
  assert.match(map, /data-scenario=\{scenario\}/);
  assert.doesNotMatch(map, /activeStageOwners/);
  assert.doesNotMatch(map, /node\.parentId \? .*\.has\(node\.parentId\)/);
  assert.match(map, /className: scenario === 'overview' \|\| active \? 'is-scenario-active' : undefined/);
  assert.match(styles, /\.docs-flow-canvas \.react-flow__node\.is-scenario-active \.docs-map-node-copy strong\s*\{[\s\S]*?color: var\(--map-node-text\)/);
  assert.match(map, /docs-scenario-brief/);
  assert.match(map, /<small>\{data\.roleLabel\}<\/small>/);
  assert.match(map, /data-module-count=\{data\.count\}/);
  assert.match(map, /\$\{selectedInvariantIds\.length\} canonical invariants/);
  assert.doesNotMatch(map, /docs-map-node-owner|data\.displayRole \?\? data\.owner/);
  const architectureNodeRenderer = map.slice(map.indexOf('function ArchitectureNode'), map.indexOf('function OwnerGroup'));
  assert.doesNotMatch(architectureNodeRenderer, /data\.owner/, 'module cards must not repeat their owner name');
  assert.match(architectureNodeRenderer, /data\.displayRole \? <small className="docs-map-node-role">/);
  assert.doesNotMatch(styles, /\.docs-map-node-owner/);
  assert.doesNotMatch(map, /selectedSourceRole|selectedObjectAuthority/);
  assert.match(map, /import Link from 'next\/link'/);
  assert.match(map, /<Link href=\{`\/\$\{locale\}\/docs\/\$\{selectedRoute\}`\}/);
  assert.match(map, /<Link href=\{`\/\$\{locale\}\/docs\/\$\{edgeData\.docsRoute\}`\}/);
  assert.doesNotMatch(map, /<a href=\{`\/\$\{locale\}\/docs\/\$\{(?:selectedRoute|edgeData\.docsRoute)\}`\}/);
  assert.match(map, /const focusGroup = \(node: DiagramNode\)/);
  assert.match(map, /setViewport\(focusViewport\(bounds/);
  assert.match(map, /event\.key !== 'Escape'[\s\S]*?restoreFit\(\)/);
  assert.match(map, /onPaneClick=\{\(\) => \{[\s\S]*?restoreFit\(\)/);
  assert.match(styles, /\.docs-flow-canvas \.react-flow__viewport\s*\{[\s\S]*?transition: none !important/);
  assert.match(styles, /\.docs-map-node-copy strong\s*\{[\s\S]*?white-space: normal/);
  assert.match(styles, /--map-node-text: #59616b/);
  assert.match(styles, /--map-node-text: #b3bac2/);
  assert.match(styles, /\.docs-map-node-copy strong\s*\{[\s\S]*?font-size: 1rem;[\s\S]*?font-weight: 520;[\s\S]*?letter-spacing: 0\.01em/);
  assert.match(styles, /\.docs-map-node-copy strong\s*\{[\s\S]*?line-height: 1\.24/);
  assert.match(styles, /\.docs-map-node\[data-label-size="medium"\][\s\S]*?font-size: 1rem/);
  assert.match(styles, /\.docs-map-node\[data-label-size="compact"\][\s\S]*?font-size: 1rem/);
  assert.match(styles, /\.docs-map-node\[data-label-size="tight"\][\s\S]*?font-size: 1rem;[\s\S]*?line-height: 1\.24/);
  assert.match(styles, /\.docs-owner-group header\s*\{[\s\S]*?height: 1\.16rem;[\s\S]*?border-radius: 999px;[\s\S]*?font-size: 0\.76rem;[\s\S]*?font-weight: 620/);
  assert.match(styles, /\.docs-flow-canvas \.react-flow__node\.is-scenario-active \.docs-map-node:not\(\.docs-map-bus\)\s*\{[\s\S]*?background: var\(--map-node-active\)/);
  assert.match(styles, /\.docs-map-authority \{ --node-kind-accent:/);
  assert.match(styles, /\.docs-map-adapter \{ --node-kind-accent:/);
  assert.match(styles, /\.docs-map-protected \{ --node-kind-accent:/);
  assert.match(styles, /\.docs-map-safety \{ --node-kind-accent:/);
  assert.doesNotMatch(map, /const scenarioMode:|docs-map-scenario-mode/);
  assert.match(map, /scenario === 'overview'[\s\S]*?\? 'PAPER · LIVE'/);
  assert.match(map, /scenario === 'paper'[\s\S]*?\? 'PAPER'[\s\S]*?scenario === 'live'[\s\S]*?\? 'LIVE'/);
  assert.match(map, /className="docs-execution-mode-cue"/);
  assert.match(styles, /\.docs-execution-mode-cue\s*\{[\s\S]*?position: absolute;[\s\S]*?font-size: 0\.55rem/);
  assert.match(map, /const overviewCue: Record<Locale, string>/);
  assert.match(map, /Qualification → eligibility · Governance → deployment\/capital · Trade Intent → Risk · Recovery → Execution/);
  assert.match(map, /Qualification → 资格 · Governance → 部署\/资金 · 交易意图 → Risk · 恢复 → Execution/);
  assert.match(map, /data-overview-cue=\{scenario === 'overview'/);
  assert.match(map, /className="docs-overview-cues"/);
  assert.match(styles, /\.docs-scenario-brief\s*\{[\s\S]*?width: fit-content;[\s\S]*?max-width: min\(100ch, calc\(100% - 2rem\)\);[\s\S]*?font-size: 0\.55rem/);
  assert.match(styles, /\.docs-scenario-brief b\s*\{[\s\S]*?-webkit-line-clamp: 2/);
  assert.match(styles, /\.docs-scenario-brief\[data-overview-cue="true"\]\s*\{[\s\S]*?width: fit-content;[\s\S]*?max-width: min\(100ch, calc\(100% - 2rem\)\);[\s\S]*?padding-block: 0\.2rem;[\s\S]*?line-height: 1\.2/);
  assert.match(styles, /\.docs-overview-cues\s*\{[\s\S]*?display: block;[\s\S]*?font-size: 0\.55rem;[\s\S]*?white-space: normal/);
  assert.match(styles, /\.docs-map-node-role\s*\{[\s\S]*?font-size: 0\.8rem/);
  assert.match(styles, /\.docs-map-bus-events\s*\{[\s\S]*?font-size: 0\.75rem/);
  assert.match(map, /data-owner-id=\{id\}/);
  assert.match(map, /id === 'group-rd'[\s\S]*?className="docs-rd-lanes"[\s\S]*?data-lane-label="RESEARCH"[\s\S]*?data-lane-label="DEVELOP"/);
  assert.match(styles, /\.docs-rd-lanes\s*\{[\s\S]*?inset: 2\.09375rem 0\.53125rem;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 4\.25rem/);
  assert.match(styles, /\.docs-rd-lanes > span::before\s*\{[\s\S]*?content: attr\(data-lane-label\)[\s\S]*?border-radius: 999px;[\s\S]*?font-size: 0\.64rem/);
  assert.match(styles, /\.docs-owner-group\[data-owner-role="shell"\]/);
  assert.match(styles, /--map-factory-fill: rgb\(139 92 246 \/ 2\.5%\)/);
  assert.match(styles, /--map-factory-fill: rgb\(167 139 250 \/ 3\.5%\)/);
  assert.match(styles, /\.docs-owner-group\[data-owner-role="factory"\][\s\S]+?background: var\(--map-factory-fill\)/);
  assert.match(styles, /\.docs-owner-group\[data-owner-role="factory"\][\s\S]+?border-width: 1px;[\s\S]+?border-style: dotted/);
  assert.match(styles, /\.docs-owner-group\[data-owner-role="stage"\][\s\S]+?border-style: dotted/);
  assert.match(styles, /\.docs-owner-group\s*\{[\s\S]*?cursor: zoom-in;[\s\S]*?pointer-events: auto/);
  assert.match(styles, /\.docs-owner-group \*\s*\{[\s\S]*?pointer-events: none/);
  assert.doesNotMatch(map + styles, /react-flow__controls|<Controls|BackgroundVariant/);

  const fittedAtGate = fitViewport(
    { width: 1280, height: 620 },
    { x: 30, y: -10, width: 1942, height: 995 },
  );
  assert.ok(1 * 16 * fittedAtGate.zoom >= 8, 'compact owner and module titles must remain at least about 8px at the fixed viewport gate');
  // Browser gate: the user explicitly selected the compact two-step type scale.
  // Keep the essential labels legible and prove bottom copy stays outside the
  // fitted transform at roughly 9px rather than re-inflating the whole map.
  const fittedAtExactViewport = fitViewport(
    { width: 1248, height: 583.640625 },
    { x: 30, y: -10, width: 1942, height: 995 },
  );
  assert.ok(1 * 16 * fittedAtExactViewport.zoom >= 8, 'compact titles must remain at least 8px at the real browser gate');
  assert.ok(0.55 * 16 >= 8, 'scenario detail text must remain at least 8px outside the fitted canvas transform');
  assert.ok(0.55 * 16 >= 8, 'the overview cue must remain at least 8px outside the fitted canvas transform');
});

test('fails closed when canonical projection fields are mutated or omitted', async () => {
  const contract = JSON.parse(await readFile(new URL('lib/architecture-contract.json', root), 'utf8'));
  assert.doesNotThrow(() => validateCanonicalProjectionContract(contract));

  const missingSurfaceLabel = structuredClone(contract);
  delete missingSurfaceLabel.authorityOwners[0].label;
  assert.throws(() => validateCanonicalProjectionContract(missingSurfaceLabel), /label/);

  const missingObjectIdentity = structuredClone(contract);
  missingObjectIdentity.architectureObjects[0].identityBinds = [];
  assert.throws(() => validateCanonicalProjectionContract(missingObjectIdentity), /identityBinds/);

  const mismatchedInvariantRoute = structuredClone(contract);
  mismatchedInvariantRoute.developmentChunkContract.authorityLocalInvariants[0].docsRoute = 'owners/rd';
  assert.throws(() => validateCanonicalProjectionContract(mismatchedInvariantRoute), /docs route diverges/);

  const missingScenarioSupport = structuredClone(contract);
  missingScenarioSupport.scenarios[0].supportingRelationIds = [];
  assert.throws(() => validateCanonicalProjectionContract(missingScenarioSupport), /supportingRelationIds/);

  const recovery = contract.scenarios.find((scenario) => scenario.id === 'recovery');
  assert.ok(recovery);

  const missingRecoverySelection = structuredClone(contract);
  delete missingRecoverySelection.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranchSelectionRule;
  assert.throws(() => validateCanonicalProjectionContract(missingRecoverySelection), /triggerBranchSelectionRule/);

  const missingRecoveryBranch = structuredClone(contract);
  missingRecoveryBranch.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranches = [];
  assert.throws(() => validateCanonicalProjectionContract(missingRecoveryBranch), /triggerBranches/);

  const incompleteRecoveryBranch = structuredClone(contract);
  delete incompleteRecoveryBranch.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranches[0].applicability;
  assert.throws(() => validateCanonicalProjectionContract(incompleteRecoveryBranch), /applicability/);

  const assumedRecoveryEvidence = structuredClone(contract);
  assumedRecoveryEvidence.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranches[0].forbiddenEvidenceAssumptions = [];
  assert.throws(() => validateCanonicalProjectionContract(assumedRecoveryEvidence), /forbiddenEvidenceAssumptions/);

  const crossRoleRecoveryRelation = structuredClone(contract);
  const crossRoleBranch = crossRoleRecoveryRelation.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranches[0];
  crossRoleBranch.supportingRelationIds.push(crossRoleBranch.primaryRelationIds[0]);
  assert.throws(() => validateCanonicalProjectionContract(crossRoleRecoveryRelation), /across PRIMARY and SUPPORTING/);

  const foreignRecoveryRelation = structuredClone(contract);
  foreignRecoveryRelation.scenarios.find((scenario) => scenario.id === 'recovery').triggerBranches[0].primaryRelationIds.push('product-rd');
  assert.throws(() => validateCanonicalProjectionContract(foreignRecoveryRelation), /outside Recovery visibility/);

  for (const branchId of ['RUNTIME_INCIDENT', 'RECONCILIATION_DRIFT']) {
    const missingSourceObject = structuredClone(contract);
    delete missingSourceObject.scenarios.find((scenario) => scenario.id === 'recovery')
      .triggerBranches.find((branch) => branch.id === branchId).sourceObjectId;
    assert.throws(() => validateCanonicalProjectionContract(missingSourceObject), /sourceObjectId/);

    const missingSourceDisposition = structuredClone(contract);
    delete missingSourceDisposition.scenarios.find((scenario) => scenario.id === 'recovery')
      .triggerBranches.find((branch) => branch.id === branchId).admissionDispositionObjectId;
    assert.throws(() => validateCanonicalProjectionContract(missingSourceDisposition), /admissionDispositionObjectId/);

    const missingSourceCaseRule = structuredClone(contract);
    delete missingSourceCaseRule.scenarios.find((scenario) => scenario.id === 'recovery')
      .triggerBranches.find((branch) => branch.id === branchId).caseCreationRule;
    assert.throws(() => validateCanonicalProjectionContract(missingSourceCaseRule), /caseCreationRule/);

    const borrowedSourceRelation = structuredClone(contract);
    borrowedSourceRelation.scenarios.find((scenario) => scenario.id === 'recovery')
      .triggerBranches.find((branch) => branch.id === branchId).primaryRelationIds = [
        branchId === 'RUNTIME_INCIDENT' ? 'execution-risk-drift-fence' : 'runtime-risk-incident-fence',
      ];
    assert.throws(() => validateCanonicalProjectionContract(borrowedSourceRelation), /source relation path mismatch/);
  }

  const fabricatedIncidentSemantics = structuredClone(contract);
  fabricatedIncidentSemantics.scenarios.find((scenario) => scenario.id === 'recovery')
    .triggerBranches.find((branch) => branch.id === 'RUNTIME_NOT_READY').admissionDispositionObjectId = 'recovery-admission-disposition';
  assert.throws(() => validateCanonicalProjectionContract(fabricatedIncidentSemantics), /incident-only admission semantics/);

  const partialRelationBranch = structuredClone(contract);
  const relationWithLocalSemantics = partialRelationBranch.relations.find((relation) => relation.semantics);
  delete relationWithLocalSemantics.semantics.replay;
  assert.throws(() => validateCanonicalProjectionContract(partialRelationBranch), /semantics|replay|branch/i);
});

test('projects every canonical surface object relation scenario and local invariant', async () => {
  const contract = JSON.parse(await readFile(new URL('lib/architecture-contract.json', root), 'utf8'));
  const readProjection = async (route, locale = 'en') => readFile(
    new URL(`content/docs/${route}${locale === 'zh' ? '.zh' : ''}.mdx`, root),
    'utf8',
  );
  const surfaces = [...contract.authorityOwners, ...contract.boundaries, ...contract.channels];
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));

  for (const surface of surfaces) {
    const english = await readProjection(surface.docsRoute);
    assert.ok(english.includes(`- **${surface.label}** — \`${surface.id}\``), `${surface.id} label is not projected`); // unicode-typography: allow
    assert.ok(english.includes(`  - module count: \`${surface.modules?.length ?? 0}\``), `${surface.id} module count is not projected`);
    for (const module of surface.modules ?? []) {
      assert.ok(english.includes(`\`${module.label}\` (\`${module.id}\`)`), `${module.id} label is not projected`);
    }
  }

  for (const object of contract.architectureObjects) {
    const authority = object.authorityId ?? object.custodianId;
    const english = await readProjection(surfaceById.get(authority).docsRoute);
    assert.ok(english.includes(`- **object \`${object.id}\`** — \`${object.label}\``), `${object.id} label is not projected`); // unicode-typography: allow
    assert.ok(english.includes('identity binds `identityBinds`:'), `${object.id} identity is not projected`);
    assert.ok(english.includes('invariants `invariants`:'), `${object.id} invariants are not projected`);
    for (const key of Object.keys(object).filter((key) => !['id', 'label', 'authorityId', 'custodianId', 'visibility'].includes(key))) {
      assert.ok(english.includes(`\`${key}\`:`), `${object.id}.${key} is not projected`);
    }
  }

  for (const relation of contract.relations) {
    const english = await readProjection(relation.docsRoute);
    assert.ok(english.includes(`- **relation \`${relation.id}\`**`), `${relation.id} is not projected`);
    assert.ok(english.includes(`  - **accepted**:`), `${relation.id} accepted branch is not projected`);
    assert.ok(english.includes(relation.businessOutcomeOwnerId
      ? `business outcome owner \`${relation.businessOutcomeOwnerId}\``
      : `no business outcome: ${relation.noBusinessOutcomeBasis}`), `${relation.id} business outcome is not projected`);
  }

  for (const scenario of contract.scenarios) {
    const [english, chinese] = await Promise.all([
      readProjection(scenario.docsRoute),
      readProjection(scenario.docsRoute, 'zh'),
    ]);
    if (scenario.id === 'recovery') {
      assert.ok(english.includes(`trigger selection rule: ${scenario.triggerBranchSelectionRule}`));
      assert.ok(chinese.includes(`触发分支选择规则: ${scenario.triggerBranchSelectionRule}`));
      assert.ok(english.includes(`entry: ${scenario.entry.en}`));
      assert.ok(chinese.includes(`入口: ${scenario.entry.zh}`));
      const aggregatePrimary = `aggregate Flow PRIMARY coverage (not one conjunctive executable path): ${scenario.primaryRelationIds.map((id) => `\`${id}\``).join(', ')}`;
      const aggregateSupporting = `aggregate Flow SUPPORTING coverage (not one conjunctive executable path): ${scenario.supportingRelationIds.map((id) => `\`${id}\``).join(', ')}`;
      assert.ok(english.includes(aggregatePrimary));
      assert.ok(english.includes(aggregateSupporting));
      assert.ok(chinese.includes(`Flow 聚合 PRIMARY 覆盖（不是一条全部必经的可执行路径）: ${scenario.primaryRelationIds.map((id) => `\`${id}\``).join(', ')}`));
      assert.ok(chinese.includes(`Flow 聚合 SUPPORTING 覆盖（不是一条全部必经的可执行路径）: ${scenario.supportingRelationIds.map((id) => `\`${id}\``).join(', ')}`));
      assert.ok(
        english.indexOf('trigger selection rule:') < english.indexOf('aggregate Flow PRIMARY coverage'),
        'Recovery must select and explain a trigger branch before showing aggregate Flow coverage',
      );
      assert.doesNotMatch(
        english,
        /\n  - PRIMARY relations:/,
        'Recovery aggregate coverage must never be presented as one conjunctive PRIMARY path',
      );
      for (const trigger of scenario.triggerBranches) {
        const branchPrimary = trigger.primaryRelationIds.map((id) => `\`${id}\``).join(', ');
        const branchSupporting = trigger.supportingRelationIds.map((id) => `\`${id}\``).join(', ');
        assert.ok(english.includes(`branch executable PRIMARY path: ${branchPrimary}`));
        assert.ok(english.includes(`branch SUPPORTING context: ${branchSupporting}`));
        assert.ok(chinese.includes(`分支可执行 PRIMARY 路径: ${branchPrimary}`));
        assert.ok(chinese.includes(`分支 SUPPORTING 上下文: ${branchSupporting}`));
        if (['RUNTIME_INCIDENT', 'RECONCILIATION_DRIFT'].includes(trigger.id)) {
          assert.ok(english.includes(`admission disposition: \`${trigger.admissionDispositionObjectId}\``));
          assert.ok(english.includes(`case creation rule: ${trigger.caseCreationRule}`));
          assert.ok(chinese.includes(`准入结论: \`${trigger.admissionDispositionObjectId}\``));
          assert.ok(chinese.includes(`Recovery Case 创建规则: ${trigger.caseCreationRule}`));
        } else {
          assert.equal(Object.hasOwn(trigger, 'admissionDispositionObjectId'), false);
          assert.equal(Object.hasOwn(trigger, 'caseCreationRule'), false);
        }
        for (const projection of [english, chinese]) {
          assert.ok(projection.includes(`\`${trigger.id}\``));
          assert.ok(projection.includes(trigger.applicability));
          for (const assumption of trigger.forbiddenEvidenceAssumptions) assert.ok(projection.includes(assumption));
          for (const relationId of [...trigger.primaryRelationIds, ...trigger.supportingRelationIds]) {
            assert.ok(projection.includes(`\`${relationId}\``));
          }
        }
      }
    } else {
      assert.ok(english.includes(`PRIMARY relations: ${scenario.primaryRelationIds.map((id) => `\`${id}\``).join(', ')}`));
      assert.ok(english.includes(`SUPPORTING relations: ${scenario.supportingRelationIds.map((id) => `\`${id}\``).join(', ')}`));
    }
  }

  const [observabilityEnglish, observabilityChinese] = await Promise.all([
    readProjection(contract.documentationProjection.observabilityProjection.docsRoute),
    readProjection(contract.documentationProjection.observabilityProjection.docsRoute, 'zh'),
  ]);
  for (const projection of [observabilityEnglish, observabilityChinese]) {
    assert.ok(projection.includes('"backtestDisclosurePolicy"'));
    for (const field of contract.observabilityContract.backtestDisclosurePolicy.protectedForbiddenFields) {
      assert.ok(projection.includes(field), `Observability projection omits protected field prohibition ${field}`);
    }
    assert.ok(projection.includes(contract.observabilityContract.backtestDisclosurePolicy.protectedAggregationRule));
    assert.ok(projection.includes(contract.observabilityContract.backtestDisclosurePolicy.custodyRule));
  }

  for (const invariant of contract.developmentChunkContract.authorityLocalInvariants) {
    const [english, chinese] = await Promise.all([
      readProjection(invariant.docsRoute),
      readProjection(invariant.docsRoute, 'zh'),
    ]);
    for (const projection of [english, chinese]) {
      assert.ok(projection.includes(`\`${invariant.id}\``), `${invariant.id} locator is not projected`);
      assert.ok(projection.includes(`\`${invariant.observableConsumerId}\``), `${invariant.id} consumer is not projected`);
      for (const guarantee of invariant.requiredGuarantees) assert.ok(projection.includes(`\`${guarantee}\``));
      for (const branch of Object.values(invariant.semantics)) assert.ok(projection.includes(branch));
    }
  }
});

test('keeps the flow hidden until its transform and edges are stable', () => {
  const initialTarget = { x: 80, y: 40, zoom: 0.5 };
  const changedTarget = { x: 64, y: 32, zoom: 0.42 };
  const overviewIds = ['data-runtime', 'runtime-risk'];
  const overviewPaths = [
    { id: 'data-runtime', path: 'M0 0L10 10' },
    { id: 'runtime-risk', path: 'M10 10L20 20' },
  ];
  let target = initialTarget;
  let canvasReady = true;

  if (viewportTargetChanged(target, changedTarget)) {
    canvasReady = false;
    target = changedTarget;
  }

  assert.equal(canvasReady, false);
  assert.equal(flowFrameReady(initialTarget, target, overviewPaths, overviewIds), false);
  assert.equal(edgePathsMatch(overviewPaths, overviewIds), true);
  assert.equal(edgePathsMatch(overviewPaths, ['data-runtime', 'wrong-edge']), false);
  assert.equal(edgePathsMatch([{ id: 'data-runtime', path: '' }, overviewPaths[1]], overviewIds), false);
  assert.equal(flowFrameReady(changedTarget, target, overviewPaths, overviewIds), true);

  let stable = advanceStableFrame({ signature: null, count: 0 }, 'frame-a', true);
  assert.equal(stable.count, 1);
  stable = advanceStableFrame(stable, 'frame-b', true);
  assert.equal(stable.count, 1);
  stable = advanceStableFrame(stable, 'frame-b', true);
  assert.equal(stable.count, 2);
});

test('computes an exact fit and a readable owner focus without animation state', () => {
  const canvas = { width: 1280, height: 620 };
  const content = { x: 30, y: -10, width: 1942, height: 995 };
  const owner = { x: 996, y: 770, width: 400, height: 215 };
  const fitted = fitViewport(canvas, content);
  const focused = focusViewport(canvas, owner, fitted.zoom);

  assert.ok(fitted.zoom > 0.5 && fitted.zoom < 0.6);
  assert.ok(focused.zoom > fitted.zoom);
  assert.ok(focused.zoom <= 1.15);
  assert.deepEqual(fitViewport(canvas, content), fitted, 'blank-canvas and Escape restore the exact same fit');
});

test('keeps architecture labels, topology, and ids compact', async () => {
  const [source, renderer] = await Promise.all([
    readFile(new URL('lib/architecture-map.ts', root), 'utf8'),
    readFile(new URL('components/architecture-map.tsx', root), 'utf8'),
  ]);
  const architecture = await import(new URL('lib/architecture-map.ts', root).href);
  const contract = JSON.parse(await readFile(new URL('lib/architecture-contract.json', root), 'utf8'));
  const groups = [...contract.authorityOwners, ...contract.boundaries];
  const modules = groups.flatMap((group) => group.modules);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const relationById = new Map(contract.relations.map((relation) => [relation.id, relation]));
  const renderedGroups = new Map(architecture.architectureNodes
    .filter((node) => node.data.nodeType === 'owner' || node.data.nodeType === 'boundary')
    .map((node) => [node.id, node.data]));

  assert.equal(contract.schemaVersion, 28, 'Windmill Product Edge capability and unattended-operation contract is canonical');
  assert.match(source, /\['runtime-risk-incident-fence', \{ sourceHandle: 'source-bottom', targetHandle: 'target-top', laneOffset: -20 \}\]/);
  assert.match(source, /\['execution-risk-drift-fence', \{ sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: 20 \}\]/);
  assert.equal(groups.length, 13);
  assert.equal(contract.scenarios.length, 7);
  assert.equal(contract.architectureObjects.length, 89, 'R65 adds two contract-only objects without adding Flow nodes');
  assert.ok(groups.every((group) => group.modules.length <= 5));
  assert.ok(groups.every((group) => typeof group.docsRoute === 'string' && group.docsRoute.length > 0));
  assert.ok(contract.channels.every((channel) => typeof channel.docsRoute === 'string' && channel.docsRoute.length > 0));
  assert.ok(contract.relations.every((relation) => relation.sourceRole && relation.objectAuthority && relation.docsRoute));
  assert.ok(contract.relations.every((relation) => (
    (typeof relation.businessOutcomeOwnerId === 'string' && relation.businessOutcomeOwnerId.length > 0)
    !== (typeof relation.noBusinessOutcomeBasis === 'string' && relation.noBusinessOutcomeBasis.length > 0)
  )), 'every relation must project exactly one explicit business outcome binding');
  assert.equal(contract.relations.some((relation) => relation.id === 'data-product'), false);
  assert.equal(contract.architectureObjects.some((object) => object.id === 'market-view'), false);

  for (const group of groups) {
    const rendered = renderedGroups.get(group.groupId);
    assert.ok(rendered, `${group.id} must have one Flow group`);
    assert.equal(rendered.label, group.label, `${group.id} Flow label must derive from the contract`);
    assert.equal(rendered.count, group.modules.length, `${group.id} Flow module count must derive from the contract`);
    const expectedInvariants = contract.developmentChunkContract.authorityLocalInvariants
      .filter((invariant) => (invariant.authorityId ?? invariant.custodianId) === group.id)
      .map((invariant) => invariant.id);
    assert.deepEqual(rendered.canonicalInvariantIds, expectedInvariants, `${group.id} must expose exact canonical invariant locators`);
  }
  assert.equal(renderedGroups.get('group-factory').roleLabel, 'VALUE STREAM · NOT AN OWNER');
  assert.equal(renderedGroups.get('group-rd').roleLabel, 'OWNER');
  assert.equal(
    architecture.ownerGroupActiveInScenario(
      'group-factory',
      'factory',
      renderedGroups.get('group-factory').memberGroupIds,
      new Set(['group-rd']),
    ),
    true,
    'Strategy Factory must be active when one declared member stage is active',
  );
  assert.equal(
    architecture.ownerGroupActiveInScenario(
      'group-factory',
      'factory',
      renderedGroups.get('group-factory').memberGroupIds,
      new Set(['group-risk']),
    ),
    false,
    'Strategy Factory must not borrow activity from non-members',
  );
  assert.equal(architecture.architectureDetails.get('event-rail').displayRole, 'CHANNEL · NOT AN OWNER');

  for (const group of groups) {
    assert.equal(typeof group.label, 'string', `${group.id} must use one canonical Canvas label`);
    assert.match(group.label, /^[\x20-\x7e]+$/, `${group.id} Canvas label must remain canonical English`);
  }
  for (const channel of contract.channels) {
    assert.equal(typeof channel.label, 'string', `${channel.id} must use one canonical Canvas label`);
    assert.match(channel.label, /^[\x20-\x7e]+$/, `${channel.id} Canvas label must remain canonical English`);
  }
  for (const module of modules) {
    assert.equal(typeof module.label, 'string', `${module.id} must use one canonical Canvas label`);
    assert.match(module.label, /^[\x20-\x7e]+$/, `${module.id} Canvas label must remain canonical English`);
  }
  for (const scenario of contract.scenarios) {
    assert.deepEqual(Object.keys(scenario.label).sort(), ['en', 'zh']);
    assert.deepEqual(Object.keys(scenario.description).sort(), ['en', 'zh']);
    assert.ok(scenario.label.en && scenario.label.zh, `${scenario.id} must have bilingual tab labels`);
    assert.ok(scenario.description.en && scenario.description.zh, `${scenario.id} must have bilingual descriptions`);
  }
  const renderedRecoveryScenario = architecture.scenarios.find((scenario) => scenario.id === 'recovery');
  const canonicalRecoveryScenario = contract.scenarios.find((scenario) => scenario.id === 'recovery');
  assert.equal(renderedRecoveryScenario.triggerBranchSelectionRule, canonicalRecoveryScenario.triggerBranchSelectionRule);
  assert.deepEqual(renderedRecoveryScenario.triggerBranches, canonicalRecoveryScenario.triggerBranches);
  assert.match(source, /triggerBranchSelectionRule: scenario\.triggerBranchSelectionRule \?\? null/);
  assert.match(source, /triggerBranches: scenario\.triggerBranches \?\? \[\]/);

  assert.equal(modules.length, 40, 'topology should expose the compact 40-node capability map');
  assert.equal(new Set(modules.map((module) => module.id)).size, modules.length);
  for (const module of modules) {
    assert.ok(module.label.split(/\s+/).length <= 2, `label exceeds two words: ${module.label}`);
    assert.doesNotMatch(module.label, /\b[RN]\d+\b/);
    assert.ok(module.description.zh.length >= 12, `Chinese node description is too short: ${module.id}`);
    assert.ok(module.description.zh.length <= 150, `Chinese node description is too long: ${module.id}`);
    const lines = module.description.zh.split('\n');
    assert.ok(lines.length <= 3, `Chinese node description has too many lines: ${module.id}`);
    assert.ok(lines.every((line) => line.length <= 50), `Chinese node description line is too long: ${module.id}`);
  }

  assert.equal(moduleById.get('instrument-master').label, 'Instrument Master');
  assert.match(moduleById.get('instrument-master').description.en, /canonical instrument identities/);
  assert.equal(moduleById.has('universe'), false);
  assert.match(moduleById.get('strategy-loader').description.en, /Reads deployable ArtifactRefs/);
  assert.match(moduleById.get('market-snapshot').description.en, /Derives symbols fields windows and quality needs/);
  assert.match(moduleById.get('strategy-matcher').description.en, /Runs each activation rule/);
  assert.match(moduleById.get('proposal-builder').description.en, /without starting Runtime/);
  assert.match(moduleById.get('lifecycle').description.en, /permitted capital share/);
  assert.match(moduleById.get('capital-tier').description.en, /Never starts strategies or creates order commands/);
  assert.match(moduleById.get('native-strategy').description.en, /approved risk permit/);
  assert.match(moduleById.get('native-strategy').description.en, /no order lifecycle fill account effect or persistence authority/i);
  assert.match(moduleById.get('portfolio').description.en, /current market valuation/);
  assert.match(moduleById.get('risk-engine').description.en, /decision and reservation or rejects terminally/);
  assert.equal(moduleById.has('paper-run'), false);
  assert.equal(moduleById.has('runtime-state'), false);
  assert.deepEqual(
    contract.authorityOwners.find((owner) => owner.id === 'runtime').modules.map((module) => module.id),
    ['native-strategy', 'runtime-readiness'],
  );
  assert.match(moduleById.get('trade-clients').description.en, /simulated or live venue boundary/);
  assert.match(moduleById.get('protected-test').description.en, /without research feedback/);
  assert.match(moduleById.get('candidate').description.en, /Correlates one review request to one intake receipt/);
  assert.match(moduleById.get('candidate').description.en, /Checks cross-family ancestry and feedback frontier/);
  assert.match(moduleById.get('candidate').description.en, /Reserves cumulative holdout only after admission/);
  assert.match(moduleById.get('capacity').description.en, /Risk alone derives usage and remaining capacity/);
  assert.match(moduleById.get('capacity').description.en, /gross/i);
  assert.match(moduleById.get('capacity').description.en, /candidate neutral/i);
  assert.doesNotMatch(moduleById.get('capacity').description.en, /headroom/i);
  assert.match(moduleById.get('order-engine').description.en, /Validates normal permits or active fenced recovery scope/);
  assert.match(moduleById.get('effect-record').description.en, /Rejected risk decisions create no journal entry/);
  assert.match(moduleById.get('runtime-readiness').description.en, /Never opens closes or commands a Recovery Case/);
  assert.doesNotMatch(moduleById.get('runtime-readiness').description.en, /CREATE|REPLACE|INCREASE|ACTIVATE|RESUME/i);

  const acceptedTitles = new Map([
    ['lifecycle', 'Lifecycle Manager'], ['capital-tier', 'Capital Policy'],
    ['capacity', 'Capacity View'], ['artifact', 'Strategy Artifact'],
    ['code-sandbox', 'Development Sandbox'], ['candidate', 'Candidate Intake'],
    ['protected-test', 'Protected Evaluation'], ['eligibility', 'Eligibility State'],
    ['native-strategy', 'Strategy Instance'],
    ['runtime-readiness', 'Readiness Gate'], ['headroom', 'Risk Reservation'],
    ['effect-record', 'Effect Journal'], ['trade-clients', 'Execution Adapters'],
    ['reconcile', 'Reconciler'], ['order-engine', 'Order Engine'],
    ['risk-engine', 'Risk Engine'], ['kill-switch', 'Kill Switch'],
  ]);
  for (const [id, title] of acceptedTitles) {
    assert.equal(moduleById.get(id).label, title);
  }

  assert.match(source, /const fullPlacements:/);
  assert.match(source, /'OWNER' \| 'BOUNDARY' \| 'CHANNEL' \| 'VALUE STREAM · NOT AN OWNER' \| 'STAGE · RESEARCH'/);
  assert.match(source, /displayRole: 'CHANNEL · NOT AN OWNER'/);
  assert.match(source, /Overlapping full architecture nodes/);
  assert.match(source, /Owner gap below 48px/);
  assert.match(source, /Dangling full architecture edge/);
  assert.doesNotMatch(source, /architectureScenes|\bitem\(|const items:|coreNodeIds|supportNodeIds/);
  assert.match(source, /architectureContract\.scenarios as ContractScenario\[\]\)\.map/);
  assert.match(source, /primaryRelationIds: scenario\.primaryRelationIds/);
  assert.match(source, /supportingRelationIds: scenario\.supportingRelationIds/);
  assert.match(source, /relationRoleInScenario/);
  assert.match(source, /Scenario primary and supporting relations must be disjoint/);
  assert.match(source, /Scenario primary and supporting relations must completely partition visibility/);
  assert.match(source, /architectureContract\.authorityOwners/);
  assert.match(source, /architectureContract\.boundaries/);
  assert.doesNotMatch(source, /NodeStatus|\bstatus:|\badmission:|'current'|'pilot'|'target'|'later'|'mixed'|'not-admitted'/);

  const localeIndependentNodes = renderer.slice(
    renderer.indexOf('const renderedNodeCatalog = architectureNodes'),
    renderer.indexOf('useEffect(() => {', renderer.indexOf('const renderedNodeCatalog = architectureNodes')),
  );
  assert.doesNotMatch(localeIndependentNodes, /\blocale\b/, 'locale changes must not rebuild node identity');
  assert.match(localeIndependentNodes, /\}, \[focusedEdgeId, scenario, selectedId, renderedEdges, renderedNodeCatalog\]\);/);
  assert.match(renderer, /<b>\{selectedDescription\}<\/b>/);
  assert.match(renderer, /<b>\{scenarioMeta\.description\[locale\]\}<\/b>/);
  assert.match(renderer, /\}, \[scenario\]\);/, 'locale changes must not refit the viewport');

  const placementsSource = source.slice(source.indexOf('const fullPlacements:'), source.indexOf('const group ='));
  const placementRecords = [...placementsSource.matchAll(/place\('([^']+)', (-?\d+), (-?\d+), (\d+), (\d+), '[^']+'\)/g)].map((match) => ({
    id: match[1],
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5]),
  }));
  const placementIds = placementRecords.map((placement) => placement.id);
  const placementById = new Map(placementRecords.map((placement) => [placement.id, placement]));
  assert.equal(placementIds.length, modules.length + 1, 'full topology must place every catalog module plus Event Rail');
  assert.deepEqual(new Set(placementIds), new Set([...modules.map((module) => module.id), 'event-rail']));
  assert.match(placementsSource, /place\('workspace', 50, 25, 210, 52, 'client'\)/);
  assert.match(placementsSource, /place\('agent-shell', 50, 92, 210, 52, 'client'\)/);
  assert.match(placementsSource, /place\('strategy-registry', 348, 45, 145, 68, 'engine'\)/);
  assert.match(placementsSource, /place\('telemetry-gateway', 1451, 30, 267, 52, 'client'\)/);
  assert.match(placementsSource, /place\('dashboard-api', 1728, 94, 267, 52, 'client'\)/);
  assert.match(placementsSource, /place\('event-rail', 408, 594, 1146, 104, 'bus'\)/);
  assert.match(
    placementsSource,
    /place\('eligibility', 1622, 410, 325, 65, 'engine'\)/,
    'Eligibility State needs enough fixed-width title space at the 1280 fit scale',
  );
  assert.doesNotMatch(placementsSource, /place\('revoke'/);
  assert.doesNotMatch(placementsSource, /place\('paper-run'|place\('runtime-state'/);
  assert.match(placementsSource, /place\('native-strategy', 538, 815, 390, 58, 'engine'\)/);
  assert.match(placementsSource, /place\('runtime-readiness', 538, 895, 390, 52, 'strategy'\)/);
  assert.match(placementsSource, /place\('kill-switch', 1016, 815, 175, 58, 'strategy'\)/);
  assert.match(placementsSource, /place\('headroom', 1016, 895, 360, 52, 'client'\)/);

  const groupsSource = source.slice(source.indexOf('const groupLayouts'), source.indexOf('const fullItemNodes'));
  const groupIds = [...groupsSource.matchAll(/\['(group-[^']+)', \{/g)].map((match) => match[1]);
  assert.equal(groupIds.length, contract.limits.groupCount);
  assert.deepEqual(new Set(groupIds), new Set(groups.map((group) => group.groupId)));
  assert.doesNotMatch(groupsSource, /badge:/, 'group layout must not shadow contract-owned interaction badges');
  assert.equal(groups.find((group) => group.groupId === 'group-product')?.badge, 'SKILL');
  assert.equal(groups.find((group) => group.groupId === 'group-program')?.badge, 'EXE');
  assert.match(groupsSource, /\['group-factory', \{ x: 388, y: 250, width: 1600, height: 290/);
  assert.match(groupsSource, /\['group-product', \{ x: 30, y: -10, width: 250, height: 170/);
  assert.match(groupsSource, /\['group-observability', \{ x: 1439, y: -10, width: 569, height: 170/);
  assert.match(groupsSource, /const fullGroups: Node<OwnerNodeData>\[\] = contractGroups\.map/);
  assert.doesNotMatch(groupsSource, /'Product Edge'|'Develop'|'Build Stage'|'Strategy Factory'|'Scanner'/);

  const layoutByGroupId = new Map(
    [...groupsSource.matchAll(/\['(group-[^']+)', \{([^}]+)\}\]/g)].map((match) => {
      const value = match[2];
      const number = (name) => Number(value.match(new RegExp(`${name}: (-?\\d+)`))?.[1]);
      return [match[1], {
        x: number('x'),
        y: number('y'),
        width: number('width'),
        height: number('height'),
      }];
    }),
  );
  const factory = contract.boundaries.find((boundary) => boundary.role === 'factory');
  assert.ok(factory, 'one factory boundary must exist');
  assert.equal(factory.memberGroupIds.length, 3, 'Strategy Factory must declare R&D, Backtest, and Qualification');
  assert.equal(new Set(factory.memberGroupIds).size, factory.memberGroupIds.length, 'factory membership cannot repeat');
  assert.ok(factory.memberGroupIds.every((groupId) => layoutByGroupId.has(groupId)), 'every factory member must have a layout');
  const factoryRect = layoutByGroupId.get(factory.groupId);
  assert.ok(factoryRect, 'Strategy Factory must have a layout');

  const assertTwoRowInnerFrame = (groupId, rows, expected) => {
    const layout = layoutByGroupId.get(groupId);
    assert.ok(layout, `${groupId} must have a layout`);
    const resolvedRows = rows.map((row) => row.map((id) => {
      const placement = placementById.get(id);
      assert.ok(placement, `${id} must have a placement`);
      return placement;
    }).sort((left, right) => left.x - right.x));
    for (const row of resolvedRows) {
      const first = row[0];
      const last = row.at(-1);
      assert.equal(first.x - layout.x, expected.inlineInset, `${groupId} left inset must match its inner frame`);
      assert.equal(layout.x + layout.width - (last.x + last.width), expected.inlineInset, `${groupId} right inset must match its inner frame`);
      for (let index = 1; index < row.length; index += 1) {
        assert.equal(row[index].x - (row[index - 1].x + row[index - 1].width), expected.columnGap, `${groupId} column gaps must be uniform`);
      }
    }
    const top = resolvedRows[0];
    const bottom = resolvedRows.at(-1);
    const topY = Math.min(...top.map((placement) => placement.y));
    const topBottom = Math.max(...top.map((placement) => placement.y + placement.height));
    const bottomY = Math.min(...bottom.map((placement) => placement.y));
    const bottomBottom = Math.max(...bottom.map((placement) => placement.y + placement.height));
    assert.equal(topY - layout.y, expected.blockInset, `${groupId} top inset must match its inner frame`);
    assert.equal(layout.y + layout.height - bottomBottom, expected.blockInset, `${groupId} bottom inset must match its inner frame`);
    assert.equal(bottomY - topBottom, expected.rowGap, `${groupId} row gap must be uniform`);
  };

  assertTwoRowInnerFrame('group-data', [
    ['data-clients', 'data-engine'],
    ['pit-catalog', 'instrument-master'],
  ], { inlineInset: 20, blockInset: 45, columnGap: 15, rowGap: 20 });
  assertTwoRowInnerFrame('group-qualification', [
    ['candidate', 'protected-test'],
    ['eligibility'],
  ], { inlineInset: 20, blockInset: 45, columnGap: 15, rowGap: 20 });
  assertTwoRowInnerFrame('group-rd', [
    ['source-intake', 'artifact'],
    ['research-intent', 'code-sandbox'],
  ], { inlineInset: 20, blockInset: 45, columnGap: 88, rowGap: 20 });

  const rdLayout = layoutByGroupId.get('group-rd');
  const rdLaneWidth = (rdLayout.width - 2 * 10 - 68) / 2;
  const assertRdLaneFrame = (laneIndex, moduleIds) => {
    const laneLeft = rdLayout.x + 10 + laneIndex * (rdLaneWidth + 68);
    const laneTop = rdLayout.y + 35;
    const laneBottom = rdLayout.y + rdLayout.height - 35;
    const placements = moduleIds.map((id) => placementById.get(id));
    assert.ok(placements.every(Boolean), `R&D lane ${laneIndex} modules must be placed`);
    for (const placement of placements) {
      assert.equal(placement.x - laneLeft, 10, `R&D lane ${laneIndex} left padding must be 10px`);
      assert.equal(laneLeft + rdLaneWidth - (placement.x + placement.width), 10, `R&D lane ${laneIndex} right padding must be 10px`);
    }
    assert.equal(Math.min(...placements.map((placement) => placement.y)) - laneTop, 10, `R&D lane ${laneIndex} top padding must be 10px`);
    assert.equal(laneBottom - Math.max(...placements.map((placement) => placement.y + placement.height)), 10, `R&D lane ${laneIndex} bottom padding must be 10px`);
  };
  assertRdLaneFrame(0, ['source-intake', 'research-intent']);
  assertRdLaneFrame(1, ['artifact', 'code-sandbox']);

  const containsWithPadding = (outer, inner, padding) => (
    inner.x - outer.x >= padding
    && inner.y - outer.y >= padding
    && outer.x + outer.width - (inner.x + inner.width) >= padding
    && outer.y + outer.height - (inner.y + inner.height) >= padding
  );
  const overlaps = (a, b) => (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
  const geometricMembers = [...layoutByGroupId]
    .filter(([groupId, layout]) => groupId !== factory.groupId && containsWithPadding(factoryRect, layout, 16))
    .map(([groupId]) => groupId);
  assert.deepEqual(new Set(geometricMembers), new Set(factory.memberGroupIds), 'factory geometry must project exact contract membership');
  for (const [groupId, layout] of layoutByGroupId) {
    if (groupId === factory.groupId) continue;
    assert.equal(
      overlaps(factoryRect, layout),
      factory.memberGroupIds.includes(groupId),
      `${groupId} must overlap the factory exactly when declared as a member`,
    );
  }
  const nonFactoryLayouts = [...layoutByGroupId].filter(([groupId]) => groupId !== factory.groupId);
  for (let index = 0; index < nonFactoryLayouts.length; index += 1) {
    const [leftId, left] = nonFactoryLayouts[index];
    for (const [rightId, right] of nonFactoryLayouts.slice(index + 1)) {
      assert.equal(overlaps(left, right), false, `owner layouts must not overlap: ${leftId}, ${rightId}`);
    }
  }

  assert.equal(relationById.get('data-runtime').objectId, 'market-stream');
  assert.equal(relationById.get('portfolio-risk').objectId, 'portfolio-risk-evidence-bundle');
  assert.equal(relationById.get('runtime-risk').relation, 'intent');
  assert.equal(relationById.get('risk-runtime').objectId, 'risk-decision-reservation');
  assert.deepEqual(Object.keys(relationById.get('runtime-execution').semantics), ['accepted', 'rejected', 'unknown', 'replay']);
  assert.equal(Object.hasOwn(relationById.get('runtime-execution'), 'profileId'), false);
  assert.equal(relationById.get('execution-risk').objectId, 'execution-risk-facts');
  assert.equal(relationById.get('risk-execution-claim').objectId, 'reservation-claim-result');
  assert.deepEqual(relationById.get('program-governance').scenarios, ['scan']);
  assert.equal(relationById.get('program-governance').relation, 'fact');
  assert.equal(relationById.get('program-product').objectId, 'scanner-receipt');
  assert.equal(contract.architectureObjects.some((object) => object.id === 'scan-proposal-view'), false);
  assert.equal(relationById.get('governance-risk').relation, 'policy');
  assert.equal(relationById.has('risk-execution'), false);
  assert.equal(relationById.has('program-runtime'), false);
  assert.equal(relationById.get('runtime-risk').scenarios.includes('recovery'), false);
  assert.equal(relationById.get('runtime-execution').scenarios.includes('recovery'), false);
  assert.equal(relationById.get('events-governance').description.en, 'Event Rail wakes Governance to read committed owner facts');

  const objectById = new Map(contract.architectureObjects.map((object) => [object.id, object]));
  const dOnlyDisposition = objectById.get('d-only-repair-disposition');
  assert.ok(dOnlyDisposition, 'R&D needs one bounded terminal D-only repair disposition');
  assert.equal(dOnlyDisposition.authorityId, 'rd');
  assert.equal(dOnlyDisposition.visibility, 'contract-only');
  assert.deepEqual(dOnlyDisposition.states, [
    'D0_COMPLETED_NO_ARTIFACT',
    'D1_VALIDATED',
    'D1_VALIDATION_FAILED',
    'D1_BUILD_FAILED',
    'REJECTED_NOT_D_ONLY',
    'OUTCOME_UNKNOWN',
  ]);
  assert.deepEqual(Object.keys(dOnlyDisposition.stateBindings), dOnlyDisposition.states);
  assert.match(dOnlyDisposition.replayJoinRule, /new explicit user request successor admission and successor attempt identity/);
  const rdView = objectById.get('rd-view');
  assert.deepEqual(rdView.crossBindObjectIds, ['d-only-repair-disposition']);
  assert.ok(rdView.identityBinds.includes('d-only-repair-disposition-identity-state-and-source-frontier-when-requested'));
  assert.match(relationById.get('rd-product').semantics.accepted, /optional bounded D-only Repair Disposition/);

  const exploratoryResult = objectById.get('exploratory-result');
  const protectedRunResult = objectById.get('protected-run-result');
  const iterationDecision = objectById.get('research-iteration-decision');
  const operationalEvidence = [
    'backtest-operational-profile-identity-and-version',
    'backtest-run-attempt-identity',
    'runner-service-readiness-backpressure-resource-exhaustion-and-outage-evidence-cut',
    'time-evidence-identity-clock-epoch-and-valid-through',
  ];
  for (const result of [exploratoryResult, protectedRunResult]) {
    assert.ok(result.diagnosticCategories.includes('BACKTEST_OPERATIONAL'));
    for (const binding of operationalEvidence) assert.ok(result.identityBinds.includes(binding), `${result.id} omits ${binding}`);
  }
  assert.deepEqual(exploratoryResult.backtestOperationalDiagnosisContract, {
    category: 'BACKTEST_OPERATIONAL',
    requiredBindings: [
      'backtest-operational-profile-identity-and-version',
      'backtest-run-attempt-identity',
      'runner-service-readiness-evidence',
      'backpressure-resource-exhaustion-or-outage-evidence',
      'time-evidence-identity-clock-epoch-and-valid-through',
    ],
    targetOwnerId: 'backtest',
    targetSurfaceId: 'native-replay',
    targetServiceRole: 'BACKTEST_RUNNER_SERVICE',
    misroutingRule: 'BACKTEST_OPERATIONAL is Backtest runner or service evidence and cannot be relabeled as RUNTIME_KERNEL SIMULATOR or economic failure',
    economicInterpretationGate: 'CLOSED_UNTIL_BACKTEST_OPERATIONAL_AND_ALL_OTHER_EXECUTION_DEFECTS_ARE_EXCLUDED',
  });
  assert.equal(protectedRunResult.qualificationDispositionByDiagnosticCategory.BACKTEST_OPERATIONAL, 'DIAGNOSTIC_INVALID');
  assert.equal(protectedRunResult.diagnosticClassificationContract.protectedVisibility, 'QUALIFICATION_ONLY');
  assert.ok(iterationDecision.repairCategories.includes('BACKTEST_OPERATIONAL'));
  assert.deepEqual(iterationDecision.repairCategoryTargets.BACKTEST_OPERATIONAL, {
    targetOwnerId: 'backtest',
    targetSurfaceId: 'native-replay',
    targetServiceRole: 'BACKTEST_RUNNER_SERVICE',
    allowedAction: 'REPAIR_RUNNER_SERVICE_AND_REPLAY_WITH_NEW_OPERATIONAL_PROFILE',
  });

  const nativeRepairRequest = objectById.get('native-repair-request');
  assert.equal(nativeRepairRequest.authorityId, 'rd');
  assert.deepEqual(nativeRepairRequest.repairCategories, ['RUNTIME_KERNEL', 'SIMULATOR', 'BACKTEST_OPERATIONAL']);
  assert.deepEqual(nativeRepairRequest.targetOwnerByRepairCategory.RUNTIME_KERNEL, {
    targetOwnerId: 'runtime',
    targetSurfaceId: 'strategy-instance',
  });
  assert.equal(nativeRepairRequest.targetOwnerByRepairCategory.BACKTEST_OPERATIONAL.targetServiceRole, 'BACKTEST_RUNNER_SERVICE');
  for (const [relationId, targetId] of [
    ['rd-runtime-native-repair-request', 'group-runtime'],
    ['rd-backtest-native-repair-request', 'group-backtest'],
  ]) {
    const relation = relationById.get(relationId);
    assert.equal(relation.relation, 'handoff', `${relationId} must remain a request handoff`);
    assert.equal(relation.objectId, 'native-repair-request');
    assert.equal(relation.objectAuthority, 'rd');
    assert.equal(relation.targetId, targetId);
    assert.ok(contract.scenarios.find((scenario) => scenario.id === 'research').supportingRelationIds.includes(relationId));
  }
  for (const resultId of ['runtime-kernel-repair-result', 'simulator-repair-result']) {
    const result = objectById.get(resultId);
    assert.deepEqual(result.crossBindObjectIds, ['native-repair-request']);
    assert.deepEqual(Object.keys(result.researchConsumptionByResultState), ['REPAIRED', 'UNAVAILABLE', 'OUTCOME_UNKNOWN']);
    assert.match(result.researchConsumptionByResultState.OUTCOME_UNKNOWN, /no stop retry successor Intent Selection Artifact or Replay Request/);
  }

  const recoveryAdmission = objectById.get('recovery-admission-disposition');
  assert.equal(recoveryAdmission.authorityId, 'execution');
  assert.deepEqual(recoveryAdmission.sourceBranches, ['RUNTIME_INCIDENT', 'RECONCILIATION_DRIFT']);
  assert.deepEqual(recoveryAdmission.states, ['RECOVERY_ADMITTED', 'NO_RECOVERY_REQUIRED', 'UNRESOLVED_NO_CASE']);
  assert.deepEqual(Object.keys(recoveryAdmission.stateBindings), recoveryAdmission.states);
  for (const state of ['NO_RECOVERY_REQUIRED', 'UNRESOLVED_NO_CASE']) {
    assert.ok(recoveryAdmission.stateBindings[state].forbidden.includes('recovery-case-identity'));
  }

  const disclosure = contract.observabilityContract.backtestDisclosurePolicy;
  assert.ok(disclosure.exploratoryAllowedFields.includes('exploratory-diagnostic-category-set'));
  assert.deepEqual(disclosure.protectedAllowedFields, ['bounded-public-terminal-outcome', 'non-dereferenceable-result-reference', 'source-frontier-observed-at-valid-through-completeness-and-lag']);
  assert.ok(disclosure.protectedForbiddenFields.includes('protected-bounded-phase'));
  assert.ok(disclosure.protectedForbiddenFields.includes('protected-run-latency-or-terminal-timing'));
  assert.ok(disclosure.protectedForbiddenFields.includes('protected-diagnostic-category'));
  assert.ok(disclosure.protectedForbiddenFields.includes('protected-internal-terminal-disposition-or-negative-reason'));
  assert.match(disclosure.protectedAggregationRule, /every negative terminal maps to CLOSED_NOT_QUALIFIED/);
  assert.match(disclosure.custodyRule, /Qualification-only/);

  const lifecycleEvidence = objectById.get('portfolio-lifecycle-evidence-receipt');
  assert.deepEqual(
    Object.keys(lifecycleEvidence.categoryEvidenceContract.namedCategories),
    lifecycleEvidence.degradationCategories.filter((category) => category !== 'MULTI_CAUSE_UNRESOLVED'),
  );
  for (const evidence of Object.values(lifecycleEvidence.categoryEvidenceContract.namedCategories)) {
    assert.ok(evidence.sourceOwnerObjectIds.length > 0);
    assert.ok(evidence.requiredEvidence.length > 0);
    assert.ok(evidence.exclusionRule.length > 0);
  }

  const riskDecision = objectById.get('risk-decision-reservation');
  assert.deepEqual(new Set(riskDecision.rejectionCategoryPrecedence), new Set(riskDecision.rejectionCategories));
  assert.equal(riskDecision.rejectionCategoryPrecedence[0], 'STALE_OR_MISSING_AUTHORIZATION');
  assert.equal(riskDecision.rejectionSetContract.supportedCategorySet, 'UNIQUE_NON_EMPTY_SUBSET_OF_REJECTION_CATEGORIES');
  assert.match(riskDecision.rejectionSetContract.primarySelectionRule, /first supported member in rejectionCategoryPrecedence/);
  assert.match(riskDecision.rejectionSetContract.preservationRule, /Every independently supported rejection category/);

  const ownerRelations = contract.relations.filter((relation) => relation.class === 'owner');
  const stageRelations = contract.relations.filter((relation) => relation.class === 'stage');
  assert.equal(contract.relations.length, 72, 'Flow must project both native repair requests and both Recovery source-to-Risk fence facts');
  assert.equal(ownerRelations.length, 68, 'R68 adds exactly two non-overview owner fact relations into Risk');
  assert.equal(stageRelations.length, 4, 'R62 must retain exactly four stage relations');
  assert.equal(
    contract.relations.length,
    ownerRelations.length + stageRelations.length,
    'every canonical relation must declare the owner or stage projection class',
  );
  assert.ok(ownerRelations.length > 0, 'the architecture must retain owner interactions');
  assert.deepEqual(stageRelations.map((relation) => relation.id), ['rd-backtest-artifact', 'rd-backtest-request', 'backtest-rd', 'rd-qualification']);
  for (const relation of contract.relations) {
    assert.ok(relation.description.zh.length <= 50, `${relation.id} Chinese edge description exceeds 50 characters`);
  }

  const groupAndChannelIds = new Set([...groups.map((group) => group.groupId), ...contract.channels.map((channel) => channel.id)]);
  const moduleIds = new Set(modules.map((module) => module.id));
  for (const scenario of contract.scenarios) {
    assert.ok(Array.isArray(scenario.primaryRelationIds) && scenario.primaryRelationIds.length > 0, `${scenario.id} needs an explicit primary path`);
    assert.ok(Array.isArray(scenario.supportingRelationIds) && scenario.supportingRelationIds.length > 0, `${scenario.id} needs explicit supporting context`);
    assert.equal(new Set(scenario.primaryRelationIds).size, scenario.primaryRelationIds.length, `${scenario.id} primary path must not repeat`);
    assert.equal(new Set(scenario.supportingRelationIds).size, scenario.supportingRelationIds.length, `${scenario.id} supporting context must not repeat`);
    assert.ok(
      scenario.primaryRelationIds.every((relationId) => !scenario.supportingRelationIds.includes(relationId)),
      `${scenario.id} primary and supporting relations must be disjoint`,
    );
    const visibleRelations = contract.relations.filter((relation) => (
      scenario.id === 'overview' ? relation.overview === true : relation.scenarios.includes(scenario.id)
    ));
    const visibleIds = new Set(visibleRelations.map((relation) => relation.id));
    assert.ok(scenario.primaryRelationIds.every((relationId) => visibleIds.has(relationId)), `${scenario.id} primary path must be visible`);
    assert.ok(scenario.supportingRelationIds.every((relationId) => visibleIds.has(relationId)), `${scenario.id} supporting context must be visible`);
    assert.deepEqual(
      new Set([...scenario.primaryRelationIds, ...scenario.supportingRelationIds]),
      visibleIds,
      `${scenario.id} explicit roles must completely partition the visible relations`,
    );
    if (scenario.id === 'overview') {
      assert.ok(visibleRelations.every((relation) => groupAndChannelIds.has(relation.sourceId) && groupAndChannelIds.has(relation.targetId)));
      assert.ok(visibleRelations.every((relation) => !moduleIds.has(relation.sourceId) && !moduleIds.has(relation.targetId)), 'Overview must not render module-internal edges');
    }
  }
  const recoveryScenario = contract.scenarios.find((scenario) => scenario.id === 'recovery');
  assert.equal(recoveryScenario.triggerBranchSelectionRule, RECOVERY_TRIGGER_BRANCH_ORACLE.selectionRule);
  assert.deepEqual(
    recoveryScenario.triggerBranches.map((branch) => branch.id),
    Object.keys(RECOVERY_TRIGGER_BRANCH_ORACLE.branches),
    'Recovery trigger order and membership must match the independent product-story oracle',
  );
  for (const branch of recoveryScenario.triggerBranches) {
    const oracle = RECOVERY_TRIGGER_BRANCH_ORACLE.branches[branch.id];
    assert.ok(oracle, `${branch.id} must have an independent Recovery trigger oracle`);
    assert.equal(branch.applicability, oracle.applicability, `${branch.id} applicability drifted`);
    assert.equal(branch.sourceObjectId, oracle.sourceObjectId, `${branch.id} source object drifted`);
    assert.equal(branch.admissionDispositionObjectId, oracle.admissionDispositionObjectId, `${branch.id} admission disposition drifted`);
    assert.equal(branch.caseCreationRule, oracle.caseCreationRule, `${branch.id} case creation rule drifted`);
    assert.deepEqual(branch.forbiddenEvidenceAssumptions, oracle.forbiddenEvidenceAssumptions, `${branch.id} evidence assumptions drifted`);
    assert.deepEqual(branch.primaryRelationIds, oracle.primary, `${branch.id} primary path drifted`);
    assert.deepEqual(branch.supportingRelationIds, oracle.supporting, `${branch.id} supporting context drifted`);
  }
  const mutatedRecoveryBranch = structuredClone(recoveryScenario.triggerBranches[0]);
  mutatedRecoveryBranch.primaryRelationIds = mutatedRecoveryBranch.primaryRelationIds.slice(1);
  assert.notDeepEqual(
    mutatedRecoveryBranch.primaryRelationIds,
    RECOVERY_TRIGGER_BRANCH_ORACLE.branches[mutatedRecoveryBranch.id].primary,
    'the independent branch oracle must reject a flat-scenario-preserving Recovery mutation',
  );
  for (const [branchId, foreignSourceRelation] of [
    ['RUNTIME_INCIDENT', 'execution-risk-drift-fence'],
    ['RECONCILIATION_DRIFT', 'runtime-risk-incident-fence'],
  ]) {
    const widened = structuredClone(recoveryScenario.triggerBranches.find((branch) => branch.id === branchId));
    widened.primaryRelationIds.push(foreignSourceRelation);
    assert.notDeepEqual(widened.primaryRelationIds, RECOVERY_TRIGGER_BRANCH_ORACLE.branches[branchId].primary, `${branchId} borrowed the other source branch`);
  }
  assert.ok(moduleById.get('trade-clients').scenarios.includes('paper'));
  assert.ok(moduleById.get('trade-clients').scenarios.includes('live'));
  const researchScenario = contract.scenarios.find((scenario) => scenario.id === 'research');
  assert.ok(researchScenario);
  assert.equal(
    relationById.get('runtime-rd-successor-feedback')?.overview,
    false,
    'runtime-rd-successor-feedback should be a non-overview relation in research scenario',
  );
  assert.ok(
    researchScenario.supportingRelationIds.includes('runtime-rd-successor-feedback'),
    'runtime-rd-successor-feedback should be in research supporting relations',
  );
  assert.ok(
    !researchScenario.primaryRelationIds.includes('runtime-rd-successor-feedback'),
    'runtime-rd-successor-feedback should not be in research primary relations',
  );
  const snapshotRequest = relationById.get('rd-data-snapshot-request');
  assert.ok(snapshotRequest, 'Research must have one canonical PIT snapshot request relation');
  assert.equal(snapshotRequest.sourceId, 'group-rd');
  assert.equal(snapshotRequest.targetId, 'group-data');
  assert.deepEqual(snapshotRequest.scenarios, ['research']);
  assert.equal(snapshotRequest.overview, false);
  assert.ok(
    researchScenario.supportingRelationIds.includes('rd-data-snapshot-request'),
    'rd-data-snapshot-request must be Research supporting context',
  );
  assert.ok(
    !researchScenario.primaryRelationIds.includes('rd-data-snapshot-request'),
    'rd-data-snapshot-request must not enter the Research primary path',
  );
  for (const scenario of contract.scenarios.filter((current) => current.id !== 'research')) {
    assert.ok(
      !scenario.primaryRelationIds.includes('rd-data-snapshot-request')
      && !scenario.supportingRelationIds.includes('rd-data-snapshot-request'),
      `rd-data-snapshot-request must not enter ${scenario.id}`,
    );
  }

  const edgeVisualSource = source.slice(source.indexOf('const edgeVisuals'), source.indexOf('export const architectureNodes'));
  const visualIds = [...edgeVisualSource.matchAll(/\['([^']+)', \{/g)].map((match) => match[1]);
  assert.equal(visualIds.length, contract.relations.length);
  assert.deepEqual(new Set(visualIds), new Set(contract.relations.map((relation) => relation.id)));
  for (const relationId of [
    'portfolio-governance-capacity-scope',
    'execution-governance-adapter-binding',
    'rd-data-snapshot-request',
    'rd-data-repair',
    'runtime-rd-successor-feedback',
    'rd-runtime-native-repair-request',
    'rd-backtest-native-repair-request',
  ]) {
    assert.ok(visualIds.includes(relationId), `${relationId} needs a supporting visual route`);
  }
  assert.match(source, /architectureContract\.relations\.map/);
  assert.match(source, /businessOutcomeOwnerId,/);
  assert.match(source, /noBusinessOutcomeBasis,/);
  assert.match(source, /Architecture relation must declare one business outcome binding/);
  assert.doesNotMatch(source, /ownerEdge\(|factoryStageEdge\(|const edgeDescriptions/);
  assert.doesNotMatch(source, /relationKind: 'internal'|internalEdge\(|lobehub-openclaw|loader-matcher|snapshot-matcher|matcher-proposal/);
  assert.match(source, /color: stage \? '#8b5cf6' : '#2563eb'/);
  assert.match(source, /width: stage \? 10 : 11/);
  assert.match(source, /height: stage \? 10 : 11/);
  assert.match(source, /fullArchitectureEdges: Edge\[\] = architectureContract\.relations\.map/);
});

test('keeps Scanner descriptions detailed and bounded', async () => {
  const contract = JSON.parse(await readFile(new URL('lib/architecture-contract.json', root), 'utf8'));
  const scanner = contract.authorityOwners.find((owner) => owner.id === 'scanner');
  assert.ok(scanner);
  assert.deepEqual(scanner.modules.map((module) => module.id), [
    'strategy-loader', 'market-snapshot', 'strategy-matcher', 'proposal-builder',
  ]);

  for (const module of scanner.modules) {
    for (const description of [module.description.en, module.description.zh]) {
      const lines = description.split('\n');
      assert.equal(lines.length, 3, `${module.id} must use three substantive description lines`);
      assert.ok(lines.every((line) => [...line].length <= 50), `${module.id} has a line longer than 50 characters`);
      assert.ok([...lines.join('')].length > 50, `${module.id} should not stretch a short description across three lines`);
      assert.doesNotMatch(description, /[，。；：,.;:]/, `${module.id} descriptions use spaces and line breaks only`);
    }
  }
});

test('Research highlights every existing successor-feedback producer without inventing a node', async () => {
  const contract = JSON.parse(await readFile(new URL('lib/architecture-contract.json', root), 'utf8'));
  const moduleById = new Map(
    [...contract.authorityOwners, ...contract.boundaries]
      .flatMap((group) => group.modules)
      .map((module) => [module.id, module]),
  );
  const expectedResearchProducerModules = ['performance', 'runtime-readiness', 'reconcile'];
  for (const moduleId of expectedResearchProducerModules) {
    assert.ok(moduleById.get(moduleId)?.scenarios.includes('research'), `${moduleId} must be active in Research`);
  }
  for (const moduleId of ['exposure', 'native-strategy', 'order-engine']) {
    assert.ok(!moduleById.get(moduleId)?.scenarios.includes('research'), `${moduleId} is not a Research feedback producer`);
  }
  assert.equal(contract.authorityOwners.length + contract.boundaries.length, 13);
  assert.equal(moduleById.size, 40);
  assert.equal(contract.architectureObjects.length, 89);
  assert.equal(contract.relations.length, 72);
});
