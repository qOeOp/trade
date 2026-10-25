# research-graph

Draws one research line as a graph and compares graphs built from different sources. Used by the
`research-graph` skill. Checking, layout and comparison use the standard library; rendering needs
node and npm:

```bash
python3 services/research-graph/graph.py check GRAPH.json
python3 services/research-graph/graph.py render GRAPH.json --out /tmp/research-graph-X/out
python3 services/research-graph/graph.py compare LEDGER.json SESSION.json --until 2026-10-23T01:50:20Z [--json]
```

## Stages

| Stage | Input → output | Owns | Module |
|---|---|---|---|
| Extract | ledger → `graph.json` | what the ledger holds about one line | the product command `research graph` (a session graph for product-doctor's fidelity test is built by an agent) |
| Contract | `graph.json` → problems | the shape of a graph | `research_graph/contract.py`, `schema/graph.schema.json` |
| Layout | `graph.json` → `view.json` | what to draw and where, in research units | `research_graph/layout.py` |
| Render | `view.json` → files | pixels, colours, labels, interaction | `research_graph/renderers/<name>/` |
| Compare | two `graph.json` → differences | which facts differ | `research_graph/compare.py` |

Stages hand over only through these files, so each can be replaced alone.

## Graph (`research-graph/2`)

One research line from one source: the line and its targets, candidate versions with parent,
change, complete strategy source, duties, hypothesis, predictions and outcomes, registration, control, trials with
readings and eligibility, comparison, source reviews, interpretation and status; timed events
(judgments, line changes, eligibility changes); and `gaps`. It holds no conversation or host state.
Unknown values are null. The schema is authoritative.

## View model (`research-graph-view/1`)

Written next to every render as `view.json`: a manifest (`line`, `targets`, `counts`) and
`widgets`. Each widget is self-contained, with an `id`, a versioned `type`, a `slot` (`top`, `main` or
`side`) and an optional `title`, so each can be drawn, cached or sent on its own. Positions are in
research units, never pixels.

| Type | Content |
|---|---|
| `summary/1` | the current recommendation, its reading against the targets, how many research runs and recommendation judgments it has held through, version and run counts, masked runs |
| `lineage/2` | `targets`, `axis` (trial positions: `min`, `max`, `ticks`, `scope_start`), `rows` (lineage depth first), `nodes` (id, row, `x` at the first research run or else the first trial, `status`, `prediction`, `change`, `reading`), `edges`, `trail` (one segment per stretch where the recommendation stayed on one version, with its judgments), `trials` (each trial with its version and purpose) |
| `progress/1` | `targets`, `axis` (the lineage's `min`, `max`, `scope_start`), `points` (research runs' returns by trial) and `recommended` (the versions the trail passed through) |
| `scatter/1` | `targets` and `points` (research runs: annual return, max drawdown, eligibility, status) |
| `table/1` | `targets` and `rows`: one per version with its role, status, prediction, first trial, research-run count and the last run's readings |
| `notes/1` | `items`: plain notes (the graph's `gaps`) |
| `candidate-detail/1` | `default` and `items`: the graph's candidate records (without their source) with `status_class` and `prediction_class` |
| `sources/1` | `items`: each version's `id`, `parent` (null when it is not in the graph) and `source` (null when the graph holds none), by id |

`status` is one of `recommended`, `meets_targets`, `below_targets`, `masked`, `precheck_failed`,
`unrun`; `prediction` one of `held`, `failed`, `mixed`, `none`. A new kind of chart is a new widget
type; a changed widget is a new version of its type.

## Renderers

A renderer is a package under `research_graph/renderers/` whose `render.py` defines
`render(view: dict, out_dir: Path) -> Path` and reads nothing but the view model. There is one,
`web`: a self-contained HTML page built from [`web/`](web/) (React, React Flow, Tailwind, Radix
primitives, TanStack Table, visx, cmdk, CodeMirror; PP Supply Mono from `web/fonts/` for every Latin letter and digit, Inter's Latin subset for the few symbols it lacks; its own npm
toolchain), laid out like an IntelliJ IDE with the Islands theme: regions are rounded islands 4px apart on the
window frame, following the design rules in
[`docs/plans/research-graph-design-spec.zh.md`](../../docs/plans/research-graph-design-spec.zh.md): warm low-chroma
OKLCH neutrals, two heading sizes (18px for the version name, 16px for card groups) in weight 600, one monospace face (Supply) for
letters and digits alike, so a reading's digits, point and % share a height, one shadow for popups, a blue ring for
keyboard focus, and short ease-out motion on hover and tooltips only. The lineage is one figure on the trial axis at a fixed scale: a
canvas that pans but never zooms and only as far as its content (trial 0 and the first row at its top-left, the
last row at its bottom, and on the right no further than the longest-reaching version name, so it never opens on
empty trials; focusing a version centres it only as far as that allows, and opening or closing a side
leaves the canvas where it is), with each version's role shown by its mark's shape, parent-to-child
lines drawn as git graphs draw them (recessive, except the selected version's lineage: root to it and on to its
children), no gridlines or row stripes (the ruler gives the trials), a brand-blue underline where a version stayed
recommended, and a version that lost eligibility faded to 40% with no badge and only its mark in red; a ruler above numbers
every trial (the trial where a version sits in the text colour, the rest faint), puts the trials that ran one version on a rounded
tinted block, and inverts the trial under the pointer. Over the canvas the pointer is a crosshair as in
TradingView's magnet mode: faint dashed lines on the nearest trial and version row, sparser near a small reticle, drawn under
the versions and lines. The charts follow the design spec: solid hairline gridlines along the value axis only, no tick marks,
a dotted line only for the crosshair (target lines are solid), grey data with colour kept for what the chart is about,
labels in text colours (a coloured mark beside them gives identity), headroom above the data and readouts as pills on
the axes that the tick labels make way for; each chart's SVG is layered in named groups (plot bands, grid, series, plot
lines, axis labels) in paint order. In Progress bars fill 70% of a trial (at most 24px), flat, rounded only at their far
end, under a thin solid target line; the crosshair's trial is a shaded column behind the
bars, and the hovered run's return is read out on the value axis. In Return vs drawdown the dominated runs
are light grey, the frontier a blue line with its ends and the recommendation named above their points, the corner
meeting both targets a green band, its thresholds stated in the legend (no axis titles on either chart: the panel names them); where runs crowd, the wheel zooms in around the pointer, a drag
pans and a double-click (or Reset zoom) shows them all again. Hovering a mark dims every other
version mark to 30% (the light grey bars to 55%); Tab reaches either chart and the arrow keys step from run to run (Enter selects, Escape lets go).
Reading badges
are as wide as their numbers, with the same padding to the edges and to the divider. The main toolbar carries IntelliJ-style
widgets (Research line, Ledger commit and Recommended, whose menu lists every version the recommendation rested on), the
recommendation's readout, search and settings (theme, layout reset), its controls the size of the stripe buttons and its ends
in line with them; the status bar shows the path to the selected
version (line › ancestors › version, each clickable; the middle of a long path folds into a … step whose menu lists
it) and the version under the pointer. The editor keeps at least 45% of the width, so a narrower window shrinks the
sides first. As in IntelliJ, a stripe on each side opens tool windows, one per side:
Versions (the versions as a tree by lineage) and Sources (one `<version>.py` file per version, a strategy with several
revisions a folder of them) on the left, Details (the selected version as cards in groups: long text in paragraphs and
lists, folded to its first paragraph or sentence with the rest behind Show more, a registration as a chip cut in the middle that copies on click) on the right, and
Progress (research-run returns as bars from zero on the canvas's x), Return vs drawdown (the scatter with the non-dominated
frontier), Version table and Data gaps at the bottom, switched by the stripe as on the sides; each island has the same header with its actions (locate, expand
all, collapse all, hide). `⌥1`–`⌥7` toggle the tool windows, `⌘B` and `⌘J` the right and bottom sides, `⇧Esc` hides the
active one. Hovering any mark highlights its version everywhere; `⌘K` jumps to a version or runs a command; `Home` goes
back to the start of the axis; `#<version>` in the address opens on that version and follows the selection. The editor
follows the left tool window last chosen: with Versions it shows the lineage, with Sources the open files in tabs.
Double-clicking a version anywhere (canvas, Versions, Sources, or Enter in Sources), or Open source in its context menu,
switches the left side to Sources and opens the version's source, or brings its tab to the front when it is open:
read-only Python in CodeMirror with line numbers and IntelliJ's syntax colours, the island scrolling it; Compare with parent
opens its unified diff against its parent's source (deleted lines red and plain, inserted green, long unchanged stretches
folded). Right-clicking a version anywhere (canvas, trees, table) offers Locate in graph (back to Versions and the
lineage), Show in details, Open source, Copy version name and Copy link. Tool-window sides, sizes
and the theme are kept in browser storage when it is available. The renderer injects `view.json`
into the built page and rebuilds it whenever the sources under `web/` differ from the ones it was
built from (`dist/source.sha256`), reinstalling first when the lockfile changed. The page needs
JavaScript, so it opens in a browser. A new widget type is a renderer in `web/src/widgets/registry.ts` and a tool window in
`web/src/shell/toolWindows.ts`; a type the page does not know becomes a bottom tool window that names it.

### Code layout and rules (`web/src`)

| Folder | Holds | May import |
|---|---|---|
| `theme/` | `tokens.css` (the only colour literals: IntelliJ Islands surfaces, four validated data hues and IntelliJ's Python colours), `base.css`, `code.css` (the source view), `roles.ts` (role names, `v()`, `wash()`, `textClass()`) | nothing |
| `lib/` | pure helpers: formatting, guarded storage, key bindings, ranges | nothing |
| `model/` | view types, semantics (roles, predictions, targets), the view context, the lineage tree | lib |
| `icons/` | the icon registry (Lucide), `Icon`, `RoleMark`, `PredictionMark` | theme, model |
| `state/` | small atoms: hover linking, focus requests, axis, crosshair, selection (mirrored in `#<version>`), theme, shell | lib, model |
| `components/` | every control and shared view part (`IconButton`, `Tip`, `DataTable`, `ReadingBadge`, `VersionLine`, ...) | theme, icons, lib, model, state |
| `widgets/` | one renderer per view-model widget type (`registry.ts`) | the above |
| `shell/` | the window: islands, toolbar, status bar, command palette | the above and widgets |

`npm run check` runs `tsc` and `scripts/check-rules.mjs`, which fails the build on: a colour literal outside
`tokens.css`, `var(--…)` in TypeScript outside `roles.ts` (role classes and `v()` instead), `<svg>` outside icons and the
chart widgets, a `<button>` or colour inline style outside `components/`, arbitrary `text-[…]`/`rounded-[…]` classes,
storage outside `lib/storage.ts`, an import against the table above, a file over 200 lines, data hues that differ from
the validated set. `scripts/verify.mjs <page>
<out> [#version]` screenshots a rendered page in light and dark and checks that islands are 10px-rounded and 4px apart,
the canvas and the bottom island share their left edge and width, canvas nodes are vertically centred, and every
`VersionLine` keeps fixed gaps between its parts with each badge number the same padding from the edges and divider;
in a 1000px window every island stays inside it and hovering tree rows never moves one; and an island's scrollbar is a
2px overlay line on its edge (OverlayScrollbars, `components/ScrollArea.tsx`), with no native bar inside an island.
There it also drives the tree's arrow keys and its header's Collapse all and Expand all, the folded path's menu, a canvas version's context menu (5 items),
double-click opening its source and `⌥1` bringing the lineage back, the wheel panning the canvas to its edges, and a Sources file opening as highlighted source
that the island scrolls, opened once however often it is double-clicked, then as its diff, and its menu's Locate in graph
bringing Versions and the lineage back.

Icons are [Lucide](https://lucide.dev)'s line icons (npm `lucide-static`, version pinned), drawn in the text colour
with strokes that draw one pixel wide at every size (2 units at 12px, 1.5 at 16px, 1.2 at 20px). ISC License, © Lucide Icons and Contributors; icons derived from Feather are MIT,
© Cole Bemis. The licence text and a notice are in `web/src/icons/`.
