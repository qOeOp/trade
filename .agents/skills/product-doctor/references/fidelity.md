# Ledger fidelity test

Tests whether the ledger alone reconstructs what a session did. Use it in an overall audit, or when
a finding turns on what the ledger preserves. Both graphs follow the `research-graph@2` format
and use the tool of the `research-graph` skill (`services/ide/ide.py`).

1. **Ledger graph.** `research graph` at the session's last ledger commit (`--at`), as the
   `research-graph` skill runs it; it reads the ledger only.
2. **Session graph.** A second fresh read-only sub-agent gets only the session transcripts
   ([hosts.md](hosts.md)) and the schema: no ledger command, no files the session wrote under
   /tmp, no memory, no other graph. It takes ids, numbers, verdicts and times from tool outputs,
   and hypotheses, interpretations and decisions from the agent's messages, saying so in `gaps`.
   A version's `source` is filled only from a tool output that shows the whole file, else null.
   It fills only the graph's fields (what the ledger should hold); conversation and host state
   are not part of a graph. `scope.end` is the last event read.
3. **Check and compare.** `ide.py check` passes on both; fix an extraction, never the format.
   `ide.py compare LEDGER SESSION --until END` lists the differences.

Class each difference with the evidence that decides it:

| Class | Meaning | Next step |
|---|---|---|
| ledger gap | A fact a later reader needs to understand or repeat the research, absent from the ledger and not derivable from it | A finding: its consumer, the decision it changes, the cost seen |
| not a record | Conversation, host state, retries, polling, drafts, which AGENTS.md keeps out of the ledger | None; a behaviour problem behind it goes to the skill that governs it |
| derivable | The ledger holds what is needed to compute it | Read-path work at most; state the derivation |
| extraction miss | One extractor missed or misread what its source holds | Fix that extraction; not a product finding |

Before calling something a ledger gap, check that no existing record carries it (candidate
description, line note, judgment, evidence bundle) and that a reader could not derive it. A reading
difference within rounding is not a difference. A ledger gap that calls for a stored field still
needs the review and user decision AGENTS.md requires.
