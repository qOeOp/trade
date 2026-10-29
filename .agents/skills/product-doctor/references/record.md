# Diagnosis record

Write each record in Chinese, as `docs/plans/doctor/<yyyy-mm-dd>-<topic>.zh.md`. Never edit a
record once it is written. Later state belongs in the index.

```markdown
# <date> <topic>

| Item | Value |
|---|---|
| Sessions | host, transcript file name, start and end time |
| Audit session | host, model, session id, worktree and any PR this session itself wrote; unknown where the host does not show it |
| Checkout / ledger | commit; ledger commits from … to … |
| Coverage | assigned workstreams, examined paths and explicit gaps |
| Cost | time split (research / discovery / repair / waiting), tokens, invalid trials caused by the product, and this audit's own time and tokens; unknown where not measured |
| Net change | mechanisms, branches, rules and skill words the proposals add and remove; skill words against the previous record; why any growth was unavoidable |

## Findings
| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |

## Removal list
| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |

## Decisions
User decisions on authority items, with the date.
```

`docs/plans/doctor/index.zh.md` holds an open table (id, finding, action, source, cost class,
status, first and last record) and a closed table (id, finding, source, cost class, status).

- Source: `doctor`, `user` or `attach`; for `user` (the user pointed it out before a diagnosis
  did), also the [lenses.md](lenses.md) workstream that should have caught it, by its name there.
- Cost class, measured: `none`, `minutes`, `hours` (hours of session time or a blocked research
  line), `wrong output`; `unknown` where nothing was measured.
- Status: one state word plus the link to the record that set it (`in PR` links the PR); the
  history lives in the records. `open`, `in PR`, `fixed <commit>` (the change merged, no more),
  `verified` (a later research session reached the path and the failure did not recur),
  `recurred`, `unobserved` (no later session reached the path, which is not verification),
  `rejected`. The next diagnosis of a research session reports the rows whose state changes; a
  row moves to the closed table at `verified` or `rejected`.

A finding id is the date plus a number, `<yyyymmdd>-<number>`. Group observations with the same
cause and remedy into one finding and reuse its id across records. The evidence cell locates the
output, consumer and supported or unsupported interpretation without copying a call log, and says
when the user found the problem first and which workstream missed it. Keep measured costs separate
from estimates.
