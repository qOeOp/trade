---
type: llm
---

A user on zsh, who likes to paste commands one at a time, asks what to paste to probe a video's metadata. Judge only the final response.

Q1. Is the probe recipe (the `yt-dlp ... -J` call and the gate on its output) inside one `bash <<'SH' ... SH` heredoc block, rather than lines pasted into zsh one at a time? Other recipes in their own heredoc blocks, and a single plain command such as a ledger query, are fine.

Q2. Does that block start by sourcing the skill's `assets/env.sh` and calling `bundle youtube-ccccccccccc` (or `bundle "youtube-$ID"`) before the probe?

PASS if Q1 and Q2 are yes. FAIL otherwise.
