# Source evidence

A source claim is L1 evidence: what an author said or showed. It is checked apart from L2 (the code
matches the rule) and L3/L4 (what the market and the native engine did); none stands in for another,
and a source case is not an economic sample. Build each video source with the `video-evidence` skill,
with `VIDEO_EVIDENCE_ROOT=$TRADE_RESEARCH_ARTIFACT_ROOT/source_media` and `VIDEO_EVIDENCE_BACKUP` set
to `source_media` under the artifact backup root.

## Before reading content

1. Choose sources from first-party catalogs or platform metadata at a fixed reference; titles are clues.
2. Dedupe by the bare platform ID in every form (video-evidence `acquire.md`); a prior use is reused
   and cited, never counted as new independent support.
3. Probe metadata only, `material retain` `probe/identity.json` (dry run first; `--expected-version` is
   the ledger's current version, and a wrong one is refused with the observed value), and publish the
   pending attempt naming the bare ID and that `review_evidence:SHA256` in `contract.scope`.

## Claims (`claims.json` in the bundle; format in `services/video-evidence/README.md`)

One claim per asset, timeframe and statement, never merged; claim i is `C<i+1>`:

- `quote` (verbatim ASR), `value` (the number as shown or said, when it differs) and `evidence`:
  `segments`, `frames` (identity objects), `crops` (SHA-256), `sidecars` (`[{sha256, json_path}]` into
  `probe/page.json`, such as published drawing anchors, cited before pixels).
- `asset`, `timeframe`, `role` (support, resistance, line, zone, Fibonacci level, stop, target, ...),
  `market` (spot, perpetual or unknown), `position` (existing position or new order) when it applies.
- `seen`: `first_visible` (a bracket shows the appearance in this video) or `retrospective`.
- `explicitness`: `spoken`, `visible_only` (any frame outside the cited speech span) or `inferred`.
  Mutually exclusive conditional paths are separate claims sharing an `exclusive_group`.
- `asr_only` when a number has no confirming frame; `limitations` for defects the bundle cannot show
  (an unproven venue, an ambiguous referent) and for any cited span the checker flags.

Leave a key out when the source does not state it. The decision cites claims as
`<claims review_evidence ID>:C<n>` and does not restate them; a rule derived from claims names their
IDs and every choice the source left open, in the attempt plan or the strategy source.

## Custody

Cite media only by content address: each identity file is an attempt top-level evidence ref
`{"kind": "source_gate", "path": "artifact://source_media/sha256/<sha>.<ext>", "sha256": "<sha>"}`,
and `show <attempt> --brief` must report `evidence_status: verified`. Never cite a bundle path. Retain
with `material retain` (dry run first) and cite the returned `review_evidence:SHA256` IDs in `decision.basis`
(`mode: source`): the retained bundle listed in the checker README. Never retain media, uncited frames, sheets,
notes, page HTML or raw info JSON; no ID may equal a media SHA-256. A `FAILED` file is a result.

## Review (every source a decision relies on)

A clean-context reviewer gets the attempt and claim IDs only, then:

1. restores `check.json` and, with `material restore`, each file its `files` list names into an empty
   directory, refusing any path outside the checker README's layout; media come from the backup `sha256/`;
2. runs `git show origin/main:services/video-evidence/check_bundle.py` (before its first merge, the PR
   head) with `--restored` and `PATH=/usr/bin:/bin:/opt/homebrew/bin`; its `checker_git_blob` must equal
   that file's `git rev-parse`;
3. reruns the probe through `identity.jq` (and the page record) and compares with the retained files, then
   reruns language detection and the transcript as video-evidence `transcribe.md` "Reviewer rerun" says:
   the language must match and `transcript.json` be byte-identical, or no claim stands;
4. opens every cited frame and crop: does it show the value, are role and timeframe what the author
   said, is inference labeled `inferred`, is a restatement by the same author counted once? The
   decision records accepted and rejected claims.
