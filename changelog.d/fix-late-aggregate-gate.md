- Live entry gate (re-judge C-142, doctor 20261114-30): an aggregated time bar received more than 60 s after its
  bucket's end closes entries as a missing bar (`bars_missing` with `late_ns`), so a flat run restarts with fresh
  timers; rc7's aggregation timer runs on a monotonic clock that a host sleep or VM pause leaves behind. Decided under
  the user's delegation of 2026-11-21.
