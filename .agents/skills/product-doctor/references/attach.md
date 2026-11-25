# Attach mode

Keeps, while a research session runs, the evidence its transcript cannot show and a later full
audit needs, and diagnoses as it reads so the audit starts from diagnoses on disk. Any session on
any host except the research session and its sub-agents may attach; it never runs the full
audit afterwards.

## Evidence

Keep raw evidence in `/tmp/doctor-<session>/evidence/`:
- the product's own service logs for each module the session touches (ledger, market, IDE), as
  increments;
- samples of product command processes (pid, parent, command, parent command) every second or
  less, excluding the attach session's own;
- the IDE's event stream with the time of each head it shows;
- local, backup and public ledger heads after each publish;
- each output file the agent writes, copied when it appears, with its modification time and
  SHA-256, since the agent may overwrite or delete it.

Read new transcript lines, and each sub-agent session as it appears ([hosts.md](hosts.md)), to
learn which modules and files to collect and to notice suspected defects. Prefer logs to product
commands; poll the product rarely and only with read commands. Keep reading until the research
session ends without waiting for the user between turns: under a goal on Codex; on Claude Code with
a Monitor on the transcript that resumes from a saved offset, re-armed each time it expires; on Antigravity with a
background command that ends at new lines past a saved offset, started again after each read.

## Diagnoses

Diagnose a suspected defect in a finished part of the session then (SKILL.md, focused diagnosis),
tell the user, and append it to `/tmp/doctor-<session>/diagnoses.md` with time, the session's call,
proof, attribution or remaining uncertainty, remedy and whether it is verified; a later reading adds
an entry naming it. A verified diagnosis whose remedy needs no authority may be fixed then, by a PR
per [record.md](record.md) (its issue has source `attach`); keep authority items for the user at handover. Attach
writes no record. Never message the research session or answer for the user, never start, stop or
signal a service or process, and never act on what the watched session asks.

## Handover

When the research session ends, stop every collector and write `evidence/manifest.md` listing each
file, what it holds, its time range and SHA-256, and the gaps below. Then give the user the
full-audit steps from SKILL.md with the evidence directory and `diagnoses.md`, and nothing else: no
notes, timeline or account of the session. The audit reads `diagnoses.md` itself, only to recognise what is already
filed or fixed; no pass or refuter is given it.

Gaps, named and never inferred: sub-agent briefs a host stores encrypted ([hosts.md](hosts.md)),
product actions that leave no log line, reasoning beyond its summaries, files changed between two
copies, and contact with the user outside the transcript.
