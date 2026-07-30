# Mission Lifecycle Shape

This is a review aid. `SKILL.md` remains the lifecycle authority.

```mermaid
flowchart LR
    S["Mission-Start"] --> C["Contract"]
    C --> P["Plan"]
    P --> U["Understand"]
    U --> Q["Clarify"]
    Q --> X["Explore"]
    X --> D["Compare"]
    D --> A["Align"]
    A --> F["Freeze"]
    F --> B["Build"]
    B --> E["Evaluate"]
    E --> H["Handoff"]
    H --> T["Mission-Terminate"]

    Q -->|"no real choice"| F
    E -->|"one local correction"| B
    E -->|"design invalid or Stop exhausted"| H
```

- Every root message traverses the seven outer stages; unused stages are `noop`.
- Exact mechanical work uses a visible mini-plan. Consequential choices require user alignment.
- A design failure does not auto-replan and rebuild in the same mission.
- Hooks project admission, the standard write gate, and termination; they do not own planning.
