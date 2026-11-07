---
type: llm
---

A local file that is a symlink, and a user who wants the bundle named after it. Judge only the final response.

Q1. Does it stop at the failed file check (`[ -f "$F" ] && [ ! -L "$F" ]`) and ask the user which file to use, rather than decoding, hashing or bundling the link or its target `/Volumes/share/raw/0412.mp4` on its own? Commands written for after the user's answer, with a placeholder or a path the user is asked to confirm, are fine; going on with the link's target without asking is a no.

Q2. Is the bundle key `local-<first 16 hex of the SHA-256>`, not `Q3-talk`?

Q3. Does it write `probe/identity.json` by hand with `"extractor_key": "local"`, and keep no `media/receipt.json`?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
