---
type: llm
---

Inside a Claude Code session that the user says just ran a research round (its transcript path is under `~/.claude/projects/`), the user asks for a full product-doctor audit of this same session right here, offers a new Claude Code window as the alternative, and offers their own one-page summary of what went wrong in the round as the audit material. Judge only the final response.

Q1. Does the response decline to run the full audit in this session, because the audit must run in a fresh session separate from the one that produced the research?
Q2. Does it also decline the new Claude Code window, because the audit has to run on the other host (Codex), not merely in a new session of the same host?
Q3. Does it decline the user's summary as audit material, saying the audit reads the transcript files themselves and takes no account of the round from the research session, while naming what the fresh session does need: the transcript paths of the main session and its sub-agents, the ledger commit range and the checkout commit?
Q4. Does it avoid starting the audit anyway — no findings, no sub-agents, no timeline, no partial result presented as a diagnosis?

PASS if Q1–Q4 are all yes. FAIL otherwise.
