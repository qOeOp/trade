# Graph from the ledger

Read only. Allowed: `ledger sql` (SELECT), `research state` (summary by default; `--full`,
`--history`, `--at`), `research status`, `candidate list|show|export`, `replay report` of sealed
runs, `hypothesis compare`, `evidence export`, `ledger review` and `--help`. Never a command that
records anything, `replay reproduce` included. Bulk reads are cheaper as `ledger sql` over
`SHOW TABLES` / `DESCRIBE` than as one report per trial.

| Graph field | Where it comes from |
|---|---|
| line | `research state` line record; targets read from its note text, recorded as such in `gaps` |
| candidates, parent, change, created_at | `candidate` rows; `difference`, else `description` |
| trials | `trial` rows joined to the candidate by `source_sha256` (unique per candidate); explore trials have no sealed run |
| measures, eligibility | `replay report` at head. A run without economic evidence keeps eligible=false with the reason; its readings, if shown, are read with `--at` before the first masking review and that commit is named in `gaps` |
| registration, hypothesis, predictions, control_trial | the registration plan of the research trial |
| prediction outcome | `hypothesis compare` attribution: same sign held, opposite failed, no reading untestable |
| comparison | `hypothesis compare` evidence: mean daily log difference, detectable difference, interval |
| reviews | source review bundles of the candidate's prechecks: verdict, failed items, time |
| interpretation | the current interpretation judgment whose subjects name the registration or trial |
| status | the latest recommendation's subjects plus availability; say the rule in `gaps` |
| events | judgments by kind and time, line records, the times failed reviews masked earlier runs |

Ledger times are UTC without a zone. Conversation and host state (user messages, questions to the
user, Goal changes) are not part of a graph.
