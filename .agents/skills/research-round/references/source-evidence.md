# Source evidence

A source tells you what an author said or showed; it fixes a rule, never a result. Whether the rule
trades well is decided by native replays and confirmation, so a misread source can only make a
candidate fail, not pass. Read sources at the start of a goal and keep one source note per goal.

## Collect

- Videos: build each bundle with the `video-evidence` skill, with `VIDEO_EVIDENCE_ROOT` set to a new
  directory under `/tmp` and `VIDEO_EVIDENCE_TEMPORARY=1`. Media files are working copies: delete
  them after the bundle is built. The bundle keeps the URL, the media SHA-256 and everything
  derived from the media; to recheck, download again and compare the SHA-256 (a removed video can
  no longer be rechecked).
- Papers and data: follow the `research-sources` skill.
- Dedupe by the bare platform ID in every form before acquiring (video-evidence `acquire.md`); a
  source already in an earlier round's note is reused and cited, never counted as new support.
- Run the local checker on every video bundle (`check_bundle.py`, written into `check.json`) and
  name each failed check as a limitation. No clean-context review is required for research.

## Store

Store each video bundle directory and the goal's note as evidence bundles in the open round:

```bash
uv run --frozen python -m research.records.cli evidence add --bundle youtube-ID "$VIDEO_EVIDENCE_ROOT/bundles/youtube-ID"
uv run --frozen python -m research.records.cli evidence add --bundle sources /tmp/RUNDIR/sources
```

The `sources` directory holds `claims.json` (the note) and may hold short supporting text. A freeze
cites the note with `--source-bundle`. A later addition is a new bundle with a new name.

## The note (`claims.json`, format in `services/video-evidence/README.md`)

One claim per asset, timeframe and statement, never merged; claim i is `C<i+1>`. Besides the
checker's fields (`quote`, `value`, `evidence`, `explicitness`, `asr_only`, `limitations`,
`exclusive_group`), a research claim adds when the source states them:

- `source`: the evidence bundle and, for a paper, its identifier;
- `asset`, `timeframe`, `role` (support, resistance, line, zone, Fibonacci level, stop, target, ...),
  `market` (spot, perpetual or unknown), `position` (existing position or new order);
- `seen`: `first_visible` (a bracket shows the appearance in the video) or `retrospective`.

Leave a key out when the source does not state it. Strategy source and freeze notes cite claims as
`C<n>`; a rule derived from claims names them and every choice the source left open.
