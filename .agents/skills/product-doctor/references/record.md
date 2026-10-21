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
| Findings by action | fix … / remove … / skill … / authority … / measure … / none … |
| Recurred items | ids, or none |
| Found by the user first | count; ids, or none |
| Skill size | words per skill against the previous record; the reason for any growth |

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
section with the commit. A second table lists the doctor misses: problems the user pointed out
before a diagnosis found them, each with the date, the lens that should have caught it and its
status. A finding id is the date plus a number, written `<yyyymmdd>-<number>`.
