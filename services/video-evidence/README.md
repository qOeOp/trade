# video-evidence checker

`check_bundle.py` recomputes a video evidence bundle's bindings from its bytes, prints JSON and exits
1 when any check fails. It writes nothing, needs only Python 3 and `ffmpeg`/`ffprobe`, imports
nothing from this repository and bounds every subprocess with a timeout. It is the trust boundary of
the [`video-evidence` skill](../../.agents/skills/video-evidence/SKILL.md): the Agent that builds a
bundle never certifies its own hashes, timestamps, durations, ASR input or citations.

    python3 -I services/video-evidence/check_bundle.py BUNDLE --media-dir "$ROOT/sha256" [--restored]

`--restored` accepts grid rows whose uncited PNG was not retained; those rows are still recomputed by
sample, and cited frames and crops must be present. A reviewer runs the committed copy: the output's
`checker_git_blob` equals `git rev-parse origin/main:services/video-evidence/check_bundle.py` (before
the first merge, the PR head), and `ffmpeg` names the build that recomputed the frames plus the SHA-256
prefixes of the `ffmpeg` and `ffprobe` executables found on `PATH` (pixel checks fail closed on
another build). `"ok": true` says that what the bundle holds is consistent, not that it is complete:
`stages` shows which of probe, media, asr, frames and crops are present, failed or absent.

## Bundle layout (the contract shared with the skill; an allowlist)

    $ROOT/sha256/<sha256>.<ext>       identity files (raw server bytes), content-addressed, 0600
    $ROOT/bundles/<key>/              <key> is <site>-<ID>, ID in [A-Za-z0-9_-]
      probe/identity.json             allowlist projection of the metadata probe (assets/identity.jq)
      probe/page.json                 generic pages and direct files: the page record (assets/page_record.py)
      media/receipt.json              allowlist projection of the download (assets/receipt.jq)
      media/SHA256SUMS                "<sha256>  <downloaded name>" per identity file
      asr/transcript.json, run.json   raw ASR output; {pcm_sha256, detected_language, versions, model, argv}
      frames/<dir>/*.png, grid.tsv    file, pts n*num/den, decoded-frame SHA-256, PNG SHA-256 (grid/ required)
      crops/*.png, crops.tsv          file, SHA-256, parent media, parent pts, parent decoded SHA-256, WxH+X+Y
      <stage>/FAILED                  the verbatim error line (query strings removed) and the command
      claims.json                     the claims below
      note.md, check.json             an optional note (never read); this checker's output
    .stage-*                          a stage still being built: fails the check

A retained bundle (`--restored`) is `probe/*.json`, `media/receipt.json`, `media/SHA256SUMS`,
`asr/*.json`, `claims.json`, `check.json`, `frames/grid/grid.tsv` (coverage is checked from it), each cited
directory's `grid.tsv` and cited PNGs, and the cited crops with `crops.tsv`; media come from the backup `sha256/`.

## Claims (`claims.json`)

`{"transcript_sha256": "<SHA-256 of asr/transcript.json>", "claims": [...]}`; claim i is `C<i+1>`.

    {"quote": "这里是 42.5 的阻力", "value": "42.5", "explicitness": "spoken",
     "evidence": {"segments": ["E041", "E042"],
                  "frames": [{"media_sha256": "<video sha>", "pts": "1260000*1/15360", "decoded_sha256": "<row's>"}],
                  "crops": ["<crop sha>"], "sidecars": [{"sha256": "<probe/page.json sha>", "json_path": ".video.anchors[0].price"}]},
     "asr_only": false, "limitations": ["..."], "exclusive_group": "a"}

`quote` is verbatim ASR inside consecutive cited segments; `value` is the number as shown or said;
`explicitness` is `spoken`, `visible_only` (a frame outside the cited speech span) or `inferred`.
Research claims add the keys in `research-round/references/source-evidence.md`.

## Checks (decide `ok`)

- Bundle: only directories and regular files (no link or FIFO; checked before anything is read); every
  path in the layout above; JSON strict (no duplicate keys, NaN or overflowing numbers); PNGs plain (image
  chunks only, at most 4 KiB of metadata, IDAT inflating to exactly the pixels); other files UTF-8 text;
  no copy of an identity file and no file of 8 MiB or more; no `.stage-*`.
- Probe and receipt: `probe/identity.json` with its identity keys; one finite video with an explicit
  part; the receipt names the probed `id` and is present unless the source is a local file; generic
  sources name HTTPS hosts on 443 that are public by name; no signed or tokenized URL, IP-bearing URL,
  local home path or secret key in `probe/`, `media/`, `asr/run.json` or `claims.json`, and no IP or
  cookie header in any `FAILED`.
- Media, per identity file: SHA-256; container `mov,mp4,m4a,3gp,3g2,mj2` or `matroska,webm` (every
  ffmpeg input is restricted to these); at most one video and one audio stream; each side at most 8192
  pixels and the HD floor (shorter side at least 720, at least 1280×720 pixels); at most 2 GiB and 96
  minutes; the last packet the demuxer reaches at least the declared duration minus 1 s (`undeclared`
  fails; generic sources take it from the page record object holding `media_url`, which must exist); the
  format named in the receipt and its exact size when declared.
- ASR: a known transcript schema (Whisper: `compression_ratio` and `words` on every segment); the pinned
  engine and model; `argv` exactly the recipe's with `detected_language`, which equals the transcript
  language; the input is the one audio identity file, whose 16 kHz mono PCM is recomputed against
  `pcm_sha256`.
- Frames: `frames/grid` exists and has a row in every 6 s that holds a frame, plus the tail frame; every
  directory binds the single video identity file; row shape, rows agreeing across directories and PNG
  SHA-256. At every cited frame, crop parent, first and last grid row and at least 3 rows sampled from the
  media hash, one decode recomputes the decoded-frame hash, the PNG pixels (rgb24) and each crop's pixels.
- Claims: the bundle lists media; segments exist and a quote lies in consecutive ones; `transcript_sha256`
  binds them; frames are grid rows by identity; crops exist; sidecars resolve in `probe/page.json`;
  `explicitness` is consistent; cited frames and crops lie in the cited speech span ±0.5 s unless
  `visible_only`; a quote or value with a numeral (Arabic, Chinese or English words) has an in-span frame
  or crop, a sidecar or `asr_only`, and without a frame its value is in the sidecar or the speech; a claim
  citing a flagged span records a limitation; an `exclusive_group` has 2+ claims.

## Flags (heuristics for a reader)

`tail_gap_s`, `gaps_over_3s`, `loops` (compression ratio over 2.4), `repeats`, `too_dense` (over 20
characters/s), `too_sparse` (over 8 s at under 1.5 characters/s), `empty_or_outside`,
`numbers_to_verify`, `claims_citing_flagged` and `png_not_retained`. The checker does not judge
meaning (does the frame show the value, is the role right): the reviewer does.

Tests: `tests/video_evidence/test_check_bundle.py` builds a synthetic bundle with the same ffmpeg and
tampers with it once per check, including each finding of the 2026-10-10 review.
