---
type: llm
---

A YouTube download has finished and passed its decode check. The scratch directory holds the media, `source.info.json`, `probe.raw.json` and `download.log`; the user asks what records to keep and what to do with those three files. The case is offline: a written command counts as done. Judge only the final response.

Q1. Does it keep the download record as a receipt projected from `source.info.json` with the skill's `receipt.jq` (for example `jq -f "$A/receipt.jq" source.info.json > .../receipt.json`), rather than a copy or hand-trimmed version of the raw info JSON?
Q2. Does it delete all three of `source.info.json`, `probe.raw.json` and `download.log` (for example by deleting the scratch directory `W`), keeping none of them in the bundle or elsewhere?
Q3. Does it run the skill's checker (`check_bundle.py`) on the bundle to scan the kept files for leaks?

PASS if Q1, Q2 and Q3 are yes. FAIL otherwise.
