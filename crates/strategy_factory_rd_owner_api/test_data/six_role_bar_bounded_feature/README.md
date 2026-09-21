# The six-role BAR Design and the meaning declared against it

`first_cycle_design_crosses_publish_bindings_and_declare_over_http`, in `src/main.rs`, sends these
two documents across the three routes a first-cycle Design crosses: it publishes the Design's R&D
role intent, admits Market Data binding custody from that intent, and declares the meaning against
the custody.

They are committed rather than built here because their producers,
`six_role_bar_bounded_feature_design_v1` and `six_role_bar_bounded_feature_meaning_v1`, live in
`vibe-strategy-factory` behind `#[cfg(all(test, feature = ...))]`. They exist only in that crate's
test build, so no dependent crate can call them, and widening them reaches a whole test module:
the Design is grown from `program_host_v2::six_role_bar_design` and six `BAR_*` constants that are
themselves test-only.

Regenerate with `six_role_bar_bounded_feature_design_v1()` and `six_role_bar_bounded_feature_meaning_v1(&design)`
serialized by `serde_json::to_vec_pretty`.

## What guards these against drifting from their producers

Nothing pins them byte for byte, and that is a choice rather than an omission. A pin would have to
see those producers, so it would have to be built with the acceptance feature, and a test behind
that feature runs only when the ordered chain selects it by name. A pin that never runs guards
nothing.

The consumer guards them instead. Owner binding custody is issued for the six role identities this
Design carries, so a Design that drifted from its producer would carry identities the custody was
not issued for, and the entry above would fail. The cost is that it fails at the declaration rather
than saying the corpus is stale.
