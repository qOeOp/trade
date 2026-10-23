# research-graph

Draws one research line as a graph and compares graphs built from different sources. Used by the
`research-graph` skill. Standard library only:

```bash
python3 services/research-graph/graph.py check GRAPH.json
python3 services/research-graph/graph.py render GRAPH.json --out /tmp/research-graph-X/out [--renderer static]
python3 services/research-graph/graph.py compare LEDGER.json SESSION.json --until 2026-10-23T01:50:20Z [--json]
```

## Stages

| Stage | Input → output | Owns | Module |
|---|---|---|---|
| Extract | ledger or transcripts → `graph.json` | what happened, from one source | agents, per the skill's references |
| Contract | `graph.json` → problems | the shape of a graph | `research_graph/contract.py`, `schema/graph.schema.json` |
| Layout | `graph.json` → `view.json` | what to draw and where, in research units | `research_graph/layout.py` |
| Render | `view.json` → files | pixels, colours, labels, interaction | `research_graph/renderers/<name>/` |
| Compare | two `graph.json` → differences | which facts differ | `research_graph/compare.py` |

Stages hand over only through these files, so each can be replaced alone.

## Graph (`research-graph/1`)

One research line from one source: the line and its targets, candidate versions with parent,
change, duties, hypothesis, predictions and outcomes, registration, control, trials with
readings and eligibility, comparison, source reviews, interpretation and status; timed events
(judgments, user messages, questions to the user, Goal changes, eligibility changes); and `gaps`.
Unknown values are null. The schema is authoritative.

## View model (`research-graph-view/1`)

Written next to every render as `view.json`: a manifest (`line`, `targets`, `counts`) and
`widgets`. Each widget is self-contained, with an `id`, a versioned `type`, a `slot` (`main` or
`side`) and an optional `title`, so each can be drawn, cached or sent on its own. Positions are in
research units, never pixels.

| Type | Content |
|---|---|
| `lineage/1` | `axis` (trial positions: `min`, `max`, `ticks`, `scope_start`), `rows` (lineage depth first), `nodes` (id, row, `x` at the first trial, `status`, `prediction`, `change`, `reading`), `edges`, `bands` (spans where one recommendation held), `lanes` (events by kind with trial positions) |
| `scatter/1` | `targets` and `points` (research runs: annual return, max drawdown, eligibility, status) |
| `notes/1` | `items`: plain notes (the graph's `gaps`) |
| `candidate-detail/1` | `default` and `items`: the graph's candidate records with `status_class` and `prediction_class` |

`status` is one of `recommended`, `meets_targets`, `below_targets`, `masked`, `precheck_failed`,
`unrun`; `prediction` one of `held`, `failed`, `mixed`, `none`. A new kind of chart is a new widget
type; a changed widget is a new version of its type.

## Renderers

`static` writes one HTML file with inline SVG and no script, so it opens in previews that block
scripts. A renderer is a package under `research_graph/renderers/` whose `render.py` defines
`render(view: dict, out_dir: Path) -> Path`, reads nothing but the view model, draws each widget
type it knows and names the ones it does not. A richer renderer (for example React components,
one per widget type, served by a web server that receives widget documents over HTTP) reads the
same widgets; the server only serves views and never reads or writes the ledger. The static
renderer stays as the dependency-free fallback.
