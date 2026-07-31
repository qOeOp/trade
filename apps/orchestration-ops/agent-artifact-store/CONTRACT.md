# Agent Artifact Store Contract

## Responsibility

- Persist bounded Agent Run instructions, context packs, structured outputs, patches, and test summaries as immutable content-addressed text.
- Resolve only `agent-artifact://durable/<sha256>` and `agent-artifact://temporary/<sha256>` refs beneath fixed repository roots while rechecking bytes, media type, and digest.
- Provide the materialization seam shared by direct Codex, OpenClaw, and R&D Agent Run adapters.

## Boundaries

- The store owns bytes, not Planner/Developer/Reviewer meaning, lifecycle admission, workspace execution, merge, deployment, strategy state, or trade authority.
- Durable bytes live under `data/artifacts/agent-runs`; temporary bytes live under `tmp/agent-runs/artifacts`. Callers cannot choose arbitrary paths.
- Secret-like text, absolute refs, hash drift, symlinked store roots, content collisions, binary payloads, and oversize outputs fail closed.
- Deletion remains artifact-owner GC work and is not exposed here.
