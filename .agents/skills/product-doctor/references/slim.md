# Slimming

1. From the need (SKILL.md step 5), propose at most five restatements, merges or removals, tests included, each run
   on a scratch copy with the product's checks and, where behavior must stay, AGENTS.md's paired replay. State
   branches, mechanisms and tests before and after; moved code is no removal.
2. Whoever keeps a part shows its use: a caller in normal use, a transcript, an incident or a user decision. "By
   design" or its own test alone keeps nothing. A test stays that alone catches a wrong product (show it by a
   mutant) or holds a refusal.
3. A trust boundary, refusal, audit, stored record or order safety is slimmed only as `authority`.
4. One issue per object, action `remove`. Nothing worth removing is a result.
