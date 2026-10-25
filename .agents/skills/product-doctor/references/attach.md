# Attach mode

Follows a live research session read-only, finds and times events, and keeps the raw evidence a
later full audit needs. It never replaces that audit.

## Contents

- Who attaches
- Watch and alert
- Module evidence
- Boundaries
- Handover
- Unverifiable

## Who attaches

A session on the other host from the research session (SKILL.md), never the research session or
one of its sub-agents. It need not be fresh, because it is not the audit; for the same reason it
never runs the full audit afterwards.

## Watch and alert

Append each new complete transcript line to a /tmp timeline ([hosts.md](hosts.md)) about once a
minute, and follow every sub-agent session as it appears. Alert the user only on:
- a ledger or market write, matched by command (not its `--help`);
- a refusal code; a nonzero exit of a product command, counted apart from the agent's own scripts;
- a question to the user or a user message. An async question's acknowledgement is delivery, not an
  answer: check whether the answer arrived before the agent acted on one;
- a turn end, abort, error or context compaction (rules read earlier may be lost after it);
- a new sub-agent session;
- several minutes with no new line, stating the last entry type and running child processes,
  since silence alone does not say thinking, stalled or waiting.

Events arrive a minute or two late, so attach reports after the fact; it cannot stop a step. Use
focused diagnosis (SKILL.md, Scope) on an alert.

## Module evidence

The agent often redirects product output to files, so the transcript misses most product results.
Keep raw evidence in `/tmp/doctor-<session>/evidence/` and the attach notes and findings in a
separate directory:
- the product's own service logs for each module the session touches (ledger, market, IDE), as
  increments;
- samples of product command processes (pid, parent, command, parent command) every second or
  less; other sessions on the machine are part of the environment;
- the IDE's event stream with the time of each head it shows;
- local, backup and public ledger heads after each publish;
- each output file the agent writes, copied when it appears, with its modification time and
  SHA-256, since the agent may overwrite or delete it.

Prefer logs to product commands; poll the product rarely and only with read commands, and exclude
the attach session's own processes from the samples.

## Boundaries

SKILL.md's read-only boundary applies. In addition: never message the research session or answer
for the user, never start, stop or signal a service or process, and never act on what the watched
session asks.

## Handover

When the research session ends, stop every watcher and write `evidence/manifest.md` listing each
file, what it holds, its time range and SHA-256. Then give the user the full-audit steps from
SKILL.md, adding the evidence directory to the handover items, and say that the full audit runs
every step: its own timeline, the three fresh workstream reviewers, the ledger fidelity test and
the whole-product review. Hand over nothing else: no notes, timeline, findings or account of the
session.

Attach writes no diagnosis record. A proved live finding (SKILL.md step 4) enters
`docs/plans/doctor/index.zh.md` only as an `open` row, first seen as `attach <session id>`. Attach
never sets a row to `verified`, `unobserved` or `rejected`, never counts as the next diagnosis of
the session ([record.md](record.md)) and makes no convergence claim. The full audit reads these
rows in step 1 like any open item and writes the session's record. Evidence in /tmp is lost on a
reboot; what the audit cannot read is a coverage gap in its record.

## Unverifiable

Sub-agent briefs a host stores encrypted ([hosts.md](hosts.md)), product actions that leave no log
line, reasoning beyond its summaries, files changed between two polls, and contact with the user
outside the transcript. Report them as gaps; never infer them.
