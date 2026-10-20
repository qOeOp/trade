# Diagnosis record

Write each record in Chinese, as `docs/plans/doctor/<yyyy-mm-dd>-<topic>.zh.md`. Never edit a
record once it is written. Later state belongs in the index.

```markdown
# <date> <topic>

| Item | Value |
|---|---|
| Sessions | host, transcript file name, start and end time |
| Checkout / ledger | commit; ledger commits from … to … |
| Time split | research …%, discovery …%, repair …%, waiting …% |
| Invalid trials caused by the product | … |
| Findings by action | fix … / skill … / authority … / measure … / none … |
| Recurred items | ids, or none |

## Findings
| id | Finding | Evidence (session; product) | Action | Cost | Status |

## Removal list
| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |

## Decisions
User decisions on authority items, with the date.
```

`docs/plans/doctor/index.zh.md` holds one table of open items. Each row has the id, the finding,
the action, the status (`open`, `in PR`, `fixed <commit>`, `rejected`, `recurred`), and the
records where the item was first and last seen. When an item is fixed, its row moves to the closed
section with the commit. A finding id is the date plus a number, such as `20261020-03`.
