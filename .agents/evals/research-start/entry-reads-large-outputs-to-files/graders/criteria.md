---
type: llm
---

A new research-start session must read the ledger before anything else. The outputs of `candidate list`, `research state` and `research status` are large JSON documents. Judge only the final response.

1. Does it run `candidate list`, `research state` and `research status` (through the product CLI, `python -m cli.main ...`)?
2. Is the output of each of these three commands redirected to a file (for example `> /tmp/state.json`) rather than printed to the conversation?
3. Does it then read only selected keys or fields from those files (for example with `jq`, a short Python script, or `Read` of specific parts), such as the open lines, a line's record, targets, gates, the latest recommendation or unreviewed trials?
4. Does any step put one of the three outputs into the conversation in full: the command run without redirection, `cat` or `Read` of the whole file, or `jq '.'` of the whole file? Listing keys (`jq 'keys'`), selecting fields, a truncated peek (`head`), or redirecting another read (such as `research state --line ... --full`) to a file is not this.

PASS if 1–3 are yes and 4 is no. FAIL otherwise.
