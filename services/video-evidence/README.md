# video-evidence checker

`check_bundle.py` recomputes a video evidence bundle's bindings from its bytes, prints JSON and exits
1 when any check fails. It writes nothing, needs only Python 3 and `ffmpeg`/`ffprobe`, imports
nothing from this repository and bounds every subprocess with a timeout. It is the trust boundary of
the [`video-evidence` skill](../../.agents/skills/video-evidence/SKILL.md): the Agent that builds a
bundle never certifies its own hashes, timestamps, ASR input or citations.

    python3 -I services/video-evidence/check_bundle.py BUNDLE --media-dir "$ROOT/sha256" [--restored]

`--restored` accepts grid rows whose uncited PNG was not retained; those rows are still recomputed by
sample, and cited frames and crops must be present. A reviewer runs the committed copy: the output's
`checker_git_blob` equals `git rev-parse origin/main:services/video-evidence/check_bundle.py`, and
`ffmpeg` names the build that recomputed the frames (pixel checks fail closed on another build).

## Bundle layout (the contract shared with the skill)

    $ROOT/sha256/<sha256>.<ext>       identity files (raw server bytes), content-addressed, 0600
    $ROOT/bundles/<key>/
      probe/identity.json             allowlist projection of the metadata probe (assets/identity.jq)
      probe/page.json                 generic pages: the one page record giving author, time, duration
      media/receipt.json              allowlist projection of the download (assets/receipt.jq)
      media/SHA256SUMS                "<sha256>  <downloaded name>" per identity file
      asr/transcript.json, run.json   raw ASR output; {pcm_sha256, detected_language, versions, model, argv}
      frames/<dir>/*.png, grid.tsv    file, pts n*num/den, decoded-frame SHA-256, PNG SHA-256
      crops/*.png, crops.tsv          file, SHA-256, parent media, parent pts, parent decoded SHA-256, WxH+X+Y
      <stage>/FAILED                  the verbatim error line (query strings removed) and the command
      claims.json                     {transcript_sha256, claims[]}; claim i is C<i+1> (research-round)
      note.md, check.json             an optional note (never read); this checker's output
    .stage-*                          a stage still being built: fails the check

## Checks (decide `ok`)

- Bundle: no `.stage-*`, no symlink, strict JSON (no duplicate keys or NaN), no media file, no copy
  of an identity file and no file of 8 MiB or more.
- Probe and receipt: `probe/identity.json` present with its identity keys; one finite video with an
  explicit part; the receipt names the probed `id` and `webpage_url`; no signed URL, IP, account ID
  or cookie in `probe/`, `media/`, `asr/run.json` or any `FAILED` file.
- Media, per identity file: SHA-256; container `mov,mp4,m4a,3gp,3g2,mj2` or `matroska,webm` (nothing
  else is decoded); each side at most 8192 pixels and the HD floor (shorter side at least 720, at
  least 1280×720 pixels); duration at least the declared one minus 1 s (`undeclared` fails); the
  format named in the receipt and its exact size when declared.
- ASR: a known transcript schema (Whisper: `compression_ratio` and `words` on every segment); the
  input is the one audio identity file, whose 16 kHz mono PCM is recomputed against `pcm_sha256`;
  the transcript language equals `detected_language`; `argv` holds no banned flag.
- Frames: every directory binds the single video identity file; row shape, rows agreeing across
  directories, PNG SHA-256 and the tail frame kept. At every cited frame, crop parent, first and last
  grid row and a sample seeded by the media hash, one decode recomputes the decoded-frame hash, the
  PNG pixels (rgb24) and each crop's pixels.
- Claims: segments exist and contain the quote; `transcript_sha256` binds them; frames are grid rows
  by identity; crops and sidecars exist; `explicitness` is consistent; cited frames and crops lie in
  the cited speech span ±0.5 s unless `visible_only`; a quote or value with a numeral (Arabic or
  Chinese) has an in-span frame or crop, a sidecar or `asr_only`; an `exclusive_group` has 2+ claims.

## Flags (heuristics, never decide `ok`)

`tail_gap_s`, `gaps_over_3s`, `loops` (compression ratio over 2.4), `repeats`, `too_dense` (over 20
characters/s), `too_sparse` (over 8 s at under 1.5 characters/s), `empty_or_outside`,
`numbers_to_verify`, `claims_citing_flagged` and `png_not_retained`. The checker does not judge
meaning (does the frame show the value, is the role right): the reviewer does.

Tests: `tests/video_evidence/test_check_bundle.py` builds a synthetic bundle with the same ffmpeg.
