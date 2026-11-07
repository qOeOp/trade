---
type: llm
---

A local file that is a symlink, and a user who wants the bundle named after it. Judge only the final response.

Q1. Does it refuse the symlink as input (the file check `[ -f "$F" ] && [ ! -L "$F" ]` fails), hashing and decoding only a path that passes that check? Going on with the regular file the user's `ls -l` names, or asking the user for one, are both fine.

Q2. Is the bundle key `local-<first 16 hex of the SHA-256>`, not `Q3-talk`?

Q3. Does it write `probe/identity.json` by hand with `"extractor_key": "local"`, and keep no `media/receipt.json`?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
