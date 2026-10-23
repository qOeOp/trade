---
type: llm
---

The user asks for a research line's history drawn as a graph. The case has no shell, so the agent may be unable to run the tool; judge its plan or what it did. Judge only the final response.

1. Does it build, or plan to build, the graph from one source (the ledger, or session transcripts) with the research-graph tool (`services/research-graph/graph.py`) and render it to a page?
2. Does it avoid inventing numbers or versions that it has not read from a source?

PASS if both are yes. FAIL otherwise.
