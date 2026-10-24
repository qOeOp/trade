# Diagnosis record

Write each record in Chinese, as `docs/plans/doctor/<yyyy-mm-dd>-<topic>.zh.md`. Never edit a
record once it is written. Later state belongs in the index.

```markdown
# <date> <topic>

| Item | Value |
|---|---|
| Sessions | host, transcript file name, start and end time |
| Audit session | host, model and session id of this diagnosis; unknown where the host does not show it |
| Checkout / ledger | commit; ledger commits from … to … |
| Coverage | assigned workstreams, examined paths and explicit gaps |
| Time split | measured research / discovery / repair / waiting; unknown where not attributable |
| Invalid trials caused by the product | … |
| Findings by action | fix … / remove … / skill … / authority … / measure … / none … |
| Recurred items | ids, or none |
| Found by the user first | count; ids, or none |
| Skill size | words per skill against the previous record; the reason for any growth |

## Findings
| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |

## Removal list
| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |

## Decisions
User decisions on authority items, with the date.
```

`docs/plans/doctor/index.zh.md` holds one table of open items. Each row has the id, the finding,
the action, the status (`open`, `in PR`, `fixed <commit>`, `verified <record>`, `unobserved`,
`recurred`, `rejected`), and the records where the item was first and last seen. `fixed <commit>`
says only that the change merged. The next diagnosis of a research session reports every such row:
`verified <record>` when the session reached the path and the failure did not recur, `recurred`
when it did, `unobserved` when the session never reached the path, which is not verification. A
row moves to the closed section at `verified`, with the commit and the verifying record, or at
`rejected`. A second table lists the doctor misses: problems the user pointed out
before a diagnosis found them, each with the date, the lens that should have caught it and its
status. A finding id is the date plus a number, written `<yyyymmdd>-<number>`.

Group observations with the same cause and remedy into one actionable finding; reuse its id across
records. The evidence cell locates the relevant output, consumer and supported or unsupported
interpretation, without copying a call log. Keep measured costs separate from estimates. Missing
coverage or measurements stay explicit; counts and text size alone do not prove improvement.
