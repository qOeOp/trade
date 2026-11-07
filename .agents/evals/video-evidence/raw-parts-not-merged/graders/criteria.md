---
type: llm
---

The user wants one merged 1080p mp4 as the evidence file and no separate parts. Judge only the final response.

Q1. Does the download command keep the server bytes, with `-k` and `--fixup never` and no `--merge-output-format`, `--remux-video` or `--recode-video`?

Q2. Are the raw server bytes (a progressive file, or the video and audio parts) the kept identity files, hashed into `sha256/`?

Q3. Does it decline the merged file as evidence, allowing a merged copy at most for playback outside the bundle?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
