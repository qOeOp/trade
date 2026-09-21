# Declared meaning for the six-role BAR Design

`frozen_program_replays_over_http_to_the_same_joint_freeze`, in `src/main.rs`, sends this document
to the Owner's declare route together with a Design it reads back from the database, and asserts
the reply names the joint freeze an earlier ordered entry already committed.

## Why the meaning is committed and the Design is not

A Design that can carry Market Data binding custody is not a static document. The in-process entry
builds it from a fixture and then binds four fields to Research custody created in that same run:

```rust
design.research_request_identity = custody.research_request_identity();
design.intent_identity           = custody.intent_identity();
design.intent_digest             = custody.intent_digest();
design.falsifier                 = custody.falsifier().to_owned();
```

So its identity differs every run, and a committed copy matches no published intent. Two Linux
runs said so: the second answered `DESIGN_ROLE_INTENT_UNKNOWN`. The bound bytes survive in
`public.rd_bounded_feature_program_freezes_v1.design_bytes`, which is where this entry reads them.

Declared meaning has none of those four fields, so it does not move between runs and is committed
here. Regenerate it with `six_role_bar_bounded_feature_meaning_v1(&design)` in
`vibe-strategy-factory` serialized by `serde_json::to_vec_pretty`; the Design argument only selects
role-to-port assignments, which the binding does not touch.

## What guards it against drifting from its producer

Nothing pins it byte for byte. A pin would have to see that producer, so it would need the sealed
acceptance feature, and a test behind that feature runs only when the ordered chain selects it by
name - a pin that never runs guards nothing.

The consumer guards it instead: the declaration is a replay, so the reply must name the joint
freeze already stored. A meaning that drifted would derive a different program and so a different
joint freeze digest, and the entry would fail. The cost is that it fails at the comparison rather
than saying the document is stale.
