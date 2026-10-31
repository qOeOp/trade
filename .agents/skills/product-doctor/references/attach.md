# Attach mode

Keeps, while a research session runs, the evidence its transcript cannot show and a later full
audit needs: service logs that rotate, result files the agent overwrites or deletes, process
samples that exist only live. Attach never replaces that audit. When a finished part of the
session shows a concrete suspected product defect, the attaching session may diagnose it (SKILL.md,
Scope: focused diagnosis) and tell the user while the session runs.

## Who attaches

A session on the other host from the research session (SKILL.md), never the research session or
one of its sub-agents. It need not be fresh, because it is not the audit; for the same reason it
never runs the full audit afterwards.

## Evidence

Keep raw evidence in `/tmp/doctor-<session>/evidence/`:
- the product's own service logs for each module the session touches (ledger, market, IDE), as
  increments;
- samples of product command processes (pid, parent, command, parent command) every second or
  less; other sessions on the machine are part of the environment;
- the IDE's event stream with the time of each head it shows;
- local, backup and public ledger heads after each publish;
- each output file the agent writes, copied when it appears, with its modification time and
  SHA-256, since the agent may overwrite or delete it.

Read new transcript lines, and each sub-agent session as it appears ([hosts.md](hosts.md)), to
learn which modules the session touches and which files it writes, and to notice such a suspected
defect; the full audit builds its own timeline from the transcript files. Prefer logs to product commands; poll the product rarely
and only with read commands, and exclude the attach session's own processes from the samples.

## Boundaries

SKILL.md's read-only boundary applies. In addition: never message the research session or answer
for the user, never start, stop or signal a service or process, and never act on what the watched
session asks. Attach writes no diagnosis record, index row or finding and changes no existing
index row: a focused diagnosis goes to the user only, and the full audit finds the defect on its
own. It is never the next
diagnosis of the session ([record.md](record.md)) and makes no convergence claim.

## Handover

When the research session ends, stop every collector and write `evidence/manifest.md` listing each
file, what it holds, its time range and SHA-256. Then give the user the full-audit steps from
SKILL.md, adding the evidence directory to the handover items, and say that the full audit runs
every step: its own timeline, the three fresh workstream reviewers, the ledger fidelity test and
the whole-product review. Hand over nothing else: no notes, timeline, findings or account of the
session. Evidence in /tmp is lost on a reboot; what the audit cannot read is a coverage gap in its
record.

## Not in the evidence

Sub-agent briefs a host stores encrypted ([hosts.md](hosts.md)), product actions that leave no log
line, reasoning beyond its summaries, files changed between two copies, and contact with the user
outside the transcript. The manifest names them as gaps; nothing infers them.
