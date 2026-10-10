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
3. Probe metadata only, `material retain` `probe/identity.json` (dry run first), and publish the
   pending attempt naming the bare ID and that `review_evidence:SHA256` in `contract.scope`.

## Claims (`claims.json` in the bundle)

`{"transcript_sha256": "...", "claims": [...]}`; claim i is `C<i+1>`. One claim per asset, timeframe
and statement, never merged:

- `quote` (the author's words, verbatim ASR), `value` (the number as shown or said, when it differs)
  and `evidence`: `segments`, `frames` (identity objects), `crops` (SHA-256), `sidecars`
  (`[{sha256, json_path}]` into a `probe/` file such as published drawing anchors, cited before pixels).
- `asset`, `timeframe`, `role` (support, resistance, line, zone, Fibonacci level, stop, target, ...),
  `market` (spot, perpetual or unknown), `position` (existing position or new order) when it applies.
- `seen`: `first_visible` (a bracket shows the appearance in this video) or `retrospective`.
- `explicitness`: `spoken`, `visible_only` (any frame outside the cited speech span) or `inferred`.
  Mutually exclusive conditional paths are separate claims sharing an `exclusive_group`.
- `asr_only` when a number has no confirming frame; `limitations` only for defects the bundle cannot
  show (an unproven venue, an ambiguous referent).

Leave a key out when the source does not state it. The decision cites claims as
`<claims review_evidence ID>:C<n>` and does not restate them; a rule derived from claims names their
IDs and every choice the source left open, in the attempt plan or the strategy source.

## Custody

Cite media only by content address: each identity file is an attempt top-level evidence ref
`{"kind": "source_gate", "path": "artifact://source_media/sha256/<sha>.<ext>", "sha256": "<sha>"}`,
and `show <attempt> --brief` must report `evidence_status: verified`. Never cite a bundle path. Retain
with `material retain` (dry run first) and cite the returned `review_evidence:SHA256` IDs in
`decision.basis` (`mode: source`): `probe/identity.json`, `probe/page.json`, `media/receipt.json`,
`media/SHA256SUMS`, `asr/transcript.json`, `asr/run.json`, `claims.json`, `check.json`, and each cited
directory's `grid.tsv`, cited PNG, crop and `crops.tsv`. Never retain media, uncited frames, sheets,
notes or raw info JSON; no `review_evidence` ID may equal a media SHA-256. A `FAILED` file is a result.

## Review (every source a decision relies on)

A clean-context reviewer gets the attempt and claim IDs only, then:

1. restores `check.json` (its `files` list maps each retained SHA-256 to its path) and those files
   into an empty directory with `material restore`; media come from the backup `sha256/`;
2. runs `git show origin/main:services/video-evidence/check_bundle.py` with `--restored`, and its
   `checker_git_blob` must equal `git rev-parse origin/main:services/video-evidence/check_bundle.py`;
3. reruns `asr/run.json` `argv` (model `repo@revision` resolved to its snapshot) on the WAV made from
   the audio identity file: `transcript.json` must be byte-identical, or no claim stands;
4. opens every cited frame and crop: does it show the value, are role and timeframe what the author
   said, is inference labeled `inferred`, is a restatement by the same author counted once? The
   decision records accepted and rejected claims.
