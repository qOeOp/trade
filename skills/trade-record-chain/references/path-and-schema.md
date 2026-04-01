# Trade Record Path And Schema

## Path Convention

### New trade case

```text
records/trades/YYYY/YYYY-MM-DD-<slug>/
├── meta.md
└── events/
```

Example:

```text
records/trades/2026/2026-04-01-btc-breakout-long/
```

### Daily note

```text
records/daily/YYYY/YYYY-MM-DD.md
```

## `meta.md`

Keep this file stable and focused on case identity plus slow metadata. Do not treat it as lifecycle truth.

Suggested frontmatter:

```yaml
---
schema_version: trade-case.v1
case_id: 2026-04-01-btc-breakout-long
symbol: BTC
created_at: 2026-04-01T09:30:00+08:00
timezone: Asia/Shanghai
timeframe: intraday
thesis_family: breakout
initial_bias: long
status: open
source_note_refs: []
tags:
  - breakout
  - btc
---
```

Recommended sections:

- `Case`
- `Why This Exists`
- `Linked Notes`

Additional rules:

- `events/` is the canonical lifecycle truth for the trade.
- `status` is a convenience snapshot and does not replace appending an event.

## Event File Naming

Use four digits and append only:

- `0001-decision.md`
- `0002-update.md`
- `0003-execution.md`
- `0004-close.md`

If you start from a type stub inside `templates/trade-case/events/`, rename it to the next real `NNNN-<event-type>.md` before saving.

## Event Frontmatter

```yaml
---
schema_version: trade-event.v1
case_id: 2026-04-01-btc-breakout-long
event_id: 0002
event_type: update
recorded_at: 2026-04-01T11:05:00+08:00
actor: codex
case_status_after: open
source_refs:
  - records/daily/2026/2026-04-01.md
derived_from:
  - 0001
summary: Narrowed long trigger after weak rejection
---
```

## Event Body Sections

Prefer these sections when relevant:

- `Context`
- `What Changed`
- `Levels`
- `Risk`
- `Next Trigger`
- `Result`
- `Reflection`

Additional rules:

- `case_id` stays stable across the whole case.
- `source_refs` should point to upstream facts whenever possible.
- `derived_from` should only reference earlier notes or events.
- The authoritative workspace-level schema lives in `records/schema.md`.

The goal is not literary polish. The goal is auditability.
