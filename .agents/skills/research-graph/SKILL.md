---
name: research-graph
description: Draws a research line as a graph (lineage of strategy versions, replays, predictions, source reviews, recommendations and user exchanges over trial numbers) from the research ledger or from session transcripts, and compares a ledger graph with a session graph to test whether the ledger alone reconstructs the research. Use whenever the user asks to draw, chart, visualize or show as a graph or diagram (画图、图、可视化、谱系) a research line's history, progress or decision path, and when an audit tests what the ledger preserves against what a session did.
---

# Research graph

The tool is `python3 services/research-graph/graph.py` (standard library only): `check` a graph,
`render` it, `compare` two graphs. Stages hand over through files: a graph
(`research-graph/1`, [services/research-graph/schema/graph.schema.json](../../../services/research-graph/schema/graph.schema.json))
becomes a view model (`research-graph-view/1`), which a renderer draws. Work in
`/tmp/research-graph-<scope>/`; graphs, pages and reports are working copies, never ledger records.

## Build a graph

- A graph has one source. Build it with a fresh read-only sub-agent given only that source, its
  reference ([ledger.md](references/ledger.md) or [session.md](references/session.md)) and the
  schema. It never sees the other source, another graph or your conclusions, so missing
  information stays visible instead of being filled from elsewhere.
- Unknown values stay null. Every derivation that is not a direct read, and every read that
  failed, goes into `gaps`.
- `graph.py check GRAPH` must pass. Fix the extraction; never loosen the contract to fit a source.
- `graph.py render GRAPH --out DIR` writes `view.json` and the page (`--renderer static` by
  default: one HTML file with no script). Give the user the page path.

## Compare a ledger graph with a session graph

- Scope both to the same line and period: `graph.py compare LEDGER SESSION --until END`.
- Classify every difference with [compare.md](references/compare.md). Only a difference the
  ledger should hold and does not is a ledger finding; it goes to `product-doctor` with its
  evidence.
- A comparison is evidence, not authority: a proposed stored field still needs the review and
  user decision AGENTS.md requires.

## Change the tool

- A new renderer is a package `services/research-graph/research_graph/renderers/<name>/` whose
  `render.py` defines `render(view, out_dir) -> Path` and reads only the view model; extraction,
  layout and comparison stay unchanged.
- A field a renderer needs that the view model lacks is added in the layout. A new fact in the
  graph is a new graph format version, changed together in the schema, both references, the
  layout and the comparison.
