---
name: research-graph
description: Draws a research line from the research ledger as a graph - the lineage of strategy versions over trial numbers with their replays, predictions, source reviews, recommendations and eligibility changes - rendered as a local page. Use whenever the user asks to draw, chart, visualize or show as a graph or diagram (画图、图、可视化、谱系) a research line's history, progress or decision path.
---

# Research graph

The tool is `python3 services/research-graph/graph.py` (standard library only). Stages hand over
through files: a graph (`research-graph/1`,
[services/research-graph/schema/graph.schema.json](../../../services/research-graph/schema/graph.schema.json))
becomes a view model of widgets (`research-graph-view/1`), which a renderer draws. Work in
`/tmp/research-graph-<line>/`; graphs and pages are working copies, never ledger records.

## Draw a line

- Build the graph from the ledger with a fresh read-only sub-agent given the line, the schema and
  [ledger.md](references/ledger.md). Unknown values stay null; every derivation that is not a
  direct read, and every read that failed, goes into `gaps`.
- `graph.py check GRAPH` must pass. Fix the extraction; never loosen the format to fit.
- `graph.py render GRAPH --out DIR` writes `view.json` and the page. `--renderer web` (an
  interactive canvas, for a browser) is the page to hand the user; `--renderer static` (no script)
  is for previews that block scripts. Give the user the page path and what the graph shows,
  including its gaps.

## Change the tool

- A new renderer is a package `services/research-graph/research_graph/renderers/<name>/` whose
  `render.py` defines `render(view, out_dir) -> Path` and reads only the view model.
- A new chart is a new widget type in the layout; a changed widget is a new version of its type.
- A new fact in the graph is a new graph format version, changed together in the schema,
  [ledger.md](references/ledger.md), the layout, the comparison and product-doctor's fidelity test.
