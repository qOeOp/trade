# Source evidence

Before proposing an economic research hypothesis, follow `research-sources`: study relevant papers
and credible community practice, reuse applicable retained originals, and search the mechanism gap.
A source establishes what an author studied or said, never success in this repository. Native
account audit does not establish source fidelity, causal mechanism or independent generalization.
Technical API/constructor/clock repair instead uses technical docs and native engineering prechecks.

## Basis in existing rationale, sources and notes

Use three explicit prose categories in the hypothesis and its chain, without a new ledger schema:

- **External basis:** retained bundle/DOI or original post/code/docs, section/table/page, reading
  extent and search/access log. State source type and market, data window, frequency, costs and
  validation conditions. Identify whether it supports the economic mechanism, a specific rule or
  parameter, or only the inference method. Unknown conditions remain unknown. Community practice,
  a template and a method paper are not empirical parameter backing.
- **Local diagnosis:** fixed run ID, ledger commit and evidence bundle, with the exact observed
  activity/economics or source fault and scope. An internal diagnostic note is not a paper.
- **Agent conjecture:** the proposed causal explanation, observable prediction/falsifier and
  unproven transfer to this market, window, signal/execution frequency and cost model.

Keep these as prose/retained originals in existing rationale/sources/notes, not new fields,
source scores or citation-count ranking. Explain priority with local information value, uncertainty
and applicability. No supporting paper permits low-priority exploration; unsuccessful access means
not searched/read, not no prior research. Later material is a new subsequent bundle with its date;
never backfill an old registration or promote an old conjecture into prior external support.

For example, a daily spot momentum paper may motivate a continuation mechanism. It does not
calibrate hourly perpetual RSI28/35/65 or establish profitability net of this runner's costs. A
block-bootstrap paper supports an inference method, not those trading parameters. Cite the exact
source scope and label the proposed transfer and parameter choices as conjectures.

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

Store retained source originals/excerpts, query logs and the note as evidence bundles in the open
round before using them in a new registration. For video bundles:

```bash
uv run --frozen python -m research.records.cli evidence add --bundle youtube-ID "$VIDEO_EVIDENCE_ROOT/bundles/youtube-ID"
uv run --frozen python -m research.records.cli evidence add --bundle sources /tmp/RUNDIR/sources
```

For video claims, the `sources` directory holds `claims.json` (the note) and supporting text.
For literature/practice, use readable source notes with the three categories above and originals. A freeze
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
