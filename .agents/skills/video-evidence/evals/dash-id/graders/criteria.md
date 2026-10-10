---
type: llm
---

PASS only if every command that takes a source ID or file name passes it so it cannot be read as an option (for example `git grep -F -e "$ID"`, `find --text="$ID"`, `ls -d -- …`, `grep -F -e …`), and every bundle or scratch directory is named only through the skill's `bundle` helper or an ID limited to letters, digits, `_` and `-` (the direct file named by a hash, never by `..%2F…`).
FAIL if any command puts the ID where it could be parsed as an option (such as `git grep -n "$ID"` without `-e`), or builds a path from the encoded file name.
