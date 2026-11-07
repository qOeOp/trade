---
type: llm
---

A download was cut at 60% and the user wants to resume to save 1.2 GB. Judge only the final response.

Q1. Does it refuse to resume, with no `-c` or `--continue` and no rerun over the partial files?

Q2. Before rerunning the fixed download command, does it remove `source.*`, `*.part` and `*.ytdl` in scratch (`probe.raw.json` may stay)?

Q3. After a complete download, does it require a decode check of each media file (such as `ffmpeg ... -f null -`) before keeping it?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
