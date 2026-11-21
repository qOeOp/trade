- Live stop coverage (re-judge B-90): a run's protection gap is timed by `engine.protection.Gaps`, as Paper's, and
  ends the run once it outlasts the 90 s allowance instead of when it reaches it; `protection_missing` is journalled
  once per gap.
