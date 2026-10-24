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

## Graph (`research-graph/1`)

One research line from one source: the line and its targets, candidate versions with parent,
change, duties, hypothesis, predictions and outcomes, registration, control, trials with
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
| `lineage/2` | `targets`, `axis` (trial positions: `min`, `max`, `ticks`, `scope_start`), `rows` (lineage depth first), `nodes` (id, row, `x` at the first trial, `status`, `prediction`, `change`, `reading`), `edges`, `trail` (one segment per stretch where the recommendation stayed on one version, with its judgments) |
| `progress/1` | `targets`, `axis` (the lineage's `min`, `max`, `scope_start`), `points` (research runs' returns by trial) and `recommended` (the versions the trail passed through) |
| `scatter/1` | `targets` and `points` (research runs: annual return, max drawdown, eligibility, status) |
| `table/1` | `targets` and `rows`: one per version with its role, status, prediction, first trial, research-run count and the last run's readings |
| `notes/1` | `items`: plain notes (the graph's `gaps`) |
| `candidate-detail/1` | `default` and `items`: the graph's candidate records with `status_class` and `prediction_class` |

`status` is one of `recommended`, `meets_targets`, `below_targets`, `masked`, `precheck_failed`,
`unrun`; `prediction` one of `held`, `failed`, `mixed`, `none`. A new kind of chart is a new widget
type; a changed widget is a new version of its type.

## Renderers

A renderer is a package under `research_graph/renderers/` whose `render.py` defines
`render(view: dict, out_dir: Path) -> Path` and reads nothing but the view model. There is one,
`web`: a self-contained HTML page built from [`web/`](web/) (React, React Flow, Tailwind, Radix
primitives, TanStack Table, visx, cmdk; Inter and JetBrains Mono, Latin subsets only; its own npm
toolchain), laid out like an IDE. The lineage is one figure on the trial axis at a fixed scale: a
canvas that pans but never zooms, with each version's role shown by its mark's shape, parent-to-child
lines drawn as git graphs draw them, and events as washes rather than marks: a violet band where a
version stayed recommended and a red wrap on a version that lost eligibility; a ruler of trial numbers
above marks the trial under the pointer. A title bar carries the current recommendation's
readout, a resizable bottom panel holds the research progress on the canvas's x (research-run returns,
as bars from zero, against the target), the return/drawdown scatter (with the
non-dominated frontier), the version table and the data gaps, and an inspector on the right holds the selected version.
Hovering any mark highlights its version everywhere; `⌘K` jumps to a version or runs a command; `Home`
goes back to the start of the axis; `#<version>` in the address opens on that version. Panel sizes
and the theme are kept in browser storage when it is available. The renderer injects `view.json`
into the built page and rebuilds it whenever the sources under `web/` differ from the ones it was
built from (`dist/source.sha256`), reinstalling first when the lockfile changed. The page needs
JavaScript, so it opens in a browser. A new widget type is a component registered in `web/src/widgets/registry.tsx`
with the region it lives in (bar, canvas, drawer or dock); a type the page does not know becomes a
dock tab that names it.
