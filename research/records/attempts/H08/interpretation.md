# H08 retrospective interpretation

H08's full rising-line support-entry rule failed its registered BTC/LINK
source-date positive checks and did not receive an annual economic run. Its
`ConfirmedLineSupportTouches` helper computes confirmed rising-line state.
H18a later reused only that state calculation to test a different action:
cancel still-unfilled H15a entry tiers after a post-entry line break. Reuse
of the helper does not turn H08's failed entry hypothesis into an H18a parent.
The original case and file identity are in `RD_EXPERIMENTS.md` and `attempt.json`.
