# templates/

Pick the closest fit, then fill every section in order. Default to `handoff.md`.

- [handoff.md](handoff.md) — general-purpose handoff (use unless a variant fits better).
- [handoff-coding.md](handoff-coding.md) — building a feature mid-flight (acceptance criteria, tests).
- [handoff-debugging.md](handoff-debugging.md) — an in-progress investigation (hypotheses, ruled-out).

Token convention: `{{placeholder}}` markers are filled in; remove any line you cannot fill rather
than leaving an empty placeholder. The `<read-files>` / `<modified-files>` tags are populated from
your tool history, not from memory.
