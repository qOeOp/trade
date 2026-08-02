# Plan Projection

Load this shape only after the Frame projection is active and Plan has decision-changing content.
Quote or navigate the current Frame projection instead of repeating it. The Plan projection extends
the Frame; it adds no authority, identity, lifecycle state, or durable record.

Use ordinary prose when it is clearer. Keep only populated, decision-changing lines; combine fields
when that is shorter and omit empty dependencies or boilerplate.

```text
Plan projection
Owner / path: <existing owner and exact entry or change paths>
Boundary: <affected consumers, contracts, and frozen write surface>
Candidate: <smallest admitted responsibility and behavior shape>
Verification: <real consumer, owner regressions, final gate, and unavailable evidence>
Dependencies / action bindings: <direct prerequisites plus owner, effect, authority, and capability or fail-closed gate>
```

If a changed Frame field can affect a Plan line or slice, invalidate it until Plan re-admits the
dependency. Do not repair the projection by copying the full transcript.
