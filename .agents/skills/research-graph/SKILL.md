---
name: research-graph
description: Draws a research line from the research ledger as a graph - the lineage of strategy versions over trial numbers with their replays, predictions, source reviews, recommendations and eligibility changes - rendered as a local page. Use whenever the user asks to draw, chart, visualize or show as a graph or diagram (画图、图、可视化、谱系) a research line's history, progress or decision path.
---

# Research graph

`research graph` (`--help`) reads a line from the ledger only and prints a `research-graph/2`
document; the same ledger commit always gives the same graph. `python3
services/research-graph/graph.py` checks, renders and compares graphs. Work in
`/tmp/research-graph-<line>/`; graphs and pages are working copies, never ledger records.

## Draw a line

- `research graph` takes the user's targets in force for the line from the ledger; add `--since
  COMMIT` to shade what came before the period under study. Redirect the output to `graph.json`.
- `graph.py check graph.json`, then `graph.py render graph.json --out DIR`: one HTML page (an
  interactive canvas that needs a browser), rebuilt with npm when its sources changed.
- Give the user the page path, what the graph shows and its `gaps` (what it does not hold).

## Change the tool

- A new renderer is a package `services/research-graph/research_graph/renderers/<name>/` whose
  `render.py` defines `render(view, out_dir) -> Path` and reads only the view model.
- A new chart is a new widget type in the layout; a changed widget is a new version of its type.
- A new fact in the graph is a new graph format version, changed together in the schema,
  `research graph`, the layout, the comparison and product-doctor's fidelity test.
