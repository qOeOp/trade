# Diagnosis record

Every finding is a row of `docs/plans/doctor/index.zh.md`; its header defines the columns, ids,
status words and how rows close, and status lives only there. A single finding with one root cause
and one remedy is that row alone: its finding cell names the proof (file:line chain, probe sizes and
readings, reproduction), its action cell the remedy and who decided it when, and the fix PR carries
the full reproduction. A rejected or `none` row says why in one clause.

Write a record file only for an audit or a diagnosis of several rows, or when a row's proof does
not fit its cell: in Chinese, as `docs/plans/doctor/<yyyy-mm-dd>-<topic>.zh.md`. Never edit it once
written; later state belongs in the index. Once none of its rows is open, the user may have it
deleted; index links to it become permalinks at its last commit.

```markdown
# <date> <topic>

| Item | Value |
|---|---|
| Sessions | host, transcript file name, start and end time |
| Audit session | host, model, session id, worktree and any PR this session itself wrote; unknown where the host does not show it |
| Checkout / ledger | commit; ledger commits from … to … |
| Coverage | each item of the full-audit list (lenses.md, Assignment) with its workstream, other examined paths and explicit gaps |
| Cost | time split (research / discovery / repair / waiting), tokens, invalid trials caused by the product, and this audit's own time and tokens; unknown where not measured |
| Net change | mechanisms, branches, rules and skill words the proposals add and remove; why any growth was unavoidable |

## Findings
| id | Finding | Probe (current product) | Session or norm; consumer and decision | Action | Cost |

## Removal list
| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |

## Decisions
User decisions on authority items, with the date.
```
