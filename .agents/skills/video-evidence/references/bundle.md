# Bundle contract and checker

`assets/check_bundle.py` recomputes a video evidence bundle's bindings from its bytes, prints JSON and exits
1 when any check fails. It writes nothing, needs only Python 3 and `ffmpeg`/`ffprobe`, imports
nothing from this repository and bounds every subprocess with a timeout. It is the trust boundary of
this skill: the Agent that builds a
bundle never certifies its own hashes, timestamps, durations, ASR input or citations.

    python3 -I "$CHECK" BUNDLE --media-dir "$ROOT/sha256" [--restored]

`--restored` accepts grid rows whose uncited PNG was not retained; those rows are still recomputed by
sample, and cited frames and crops must be present. The output's `ffmpeg` names the build that
recomputed the frames plus the SHA-256
prefixes of the `ffmpeg` and `ffprobe` executables found on `PATH` (pixel checks fail closed on
another build). `stages` shows which of probe, media, asr, frames and crops are present, failed or absent.

## Bundle layout (an allowlist)

    $ROOT/sha256/<sha256>.<ext>       identity files (raw server bytes), content-addressed, 0600
    $ROOT/bundles/<key>/              <key> is <site>-<ID>, ID in [A-Za-z0-9_-]
      probe/identity.json             allowlist projection of the metadata probe (assets/identity.jq)
      probe/page.json                 generic pages and direct files: the page record (assets/page_record.py)
      media/receipt.json              allowlist projection of the download (assets/receipt.jq)
      media/SHA256SUMS                "<sha256>  <downloaded name>" per identity file
      asr/transcript.json, run.json   raw ASR output; {pcm_sha256, detected_language, user_language, versions, model, argv}
      frames/<dir>/*.png, grid.tsv    file, pts n*num/den, decoded-frame SHA-256, PNG SHA-256 (grid/ once any)
      crops/*.png, crops.tsv          file, SHA-256, parent media, parent pts, parent decoded SHA-256, WxH+X+Y
      <stage>/FAILED                  the verbatim error line (query strings removed) and the command
      claims.json                     the claims below
      note.md, check.json             an optional note (never read); this checker's output
    .stage-*                          a stage still being built: fails the check

A retained bundle (`--restored`) is the subset [custody.md](custody.md) copies.

## Claims (`claims.json`)

`{"transcript_sha256": "<SHA-256 of asr/transcript.json>", "claims": [...]}`; claim i is `C<i+1>`.

    {"quote": "这里是 42.5 的阻力", "value": "42.5", "explicitness": "spoken",
     "evidence": {"segments": ["E041", "E042"],
                  "frames": [{"media_sha256": "<video sha>", "pts": "1260000*1/15360", "decoded_sha256": "<row's>"}],
                  "crops": ["<crop sha>"], "sidecars": [{"sha256": "<probe/page.json sha>", "json_path": ".video.anchors[0].price"}]},
     "asr_only": false, "limitations": ["..."], "exclusive_group": "a"}

`quote` is verbatim ASR inside consecutive cited segments; `value` is the number as shown or said;
`explicitness` is `spoken`, `visible_only` (a frame outside the cited speech span) or `inferred`.

## Checks (decide `ok`)

Each failure prints its stage, name and detail; the recipes produce what passes. Limits to know before a
download: at most one video and one audio stream; container `mov,mp4,m4a,3gp,3g2,mj2` or `matroska,webm`; each
side at most 8192 pixels and the HD floor (shorter side at least 720, at least 1280×720 pixels); at most 2 GiB and
96 minutes; a duration the receipt declares (a generic source's from the page record object holding `media_url`);
no other file of 8 MiB or more in the bundle.

What a claim must satisfy: the bundle lists media; segments exist and a quote lies in consecutive ones without
cutting a number (numbers compare as whole tokens: 2.8 is not in 52.8); `transcript_sha256` binds them; frames are
grid rows by identity; crops exist; sidecars resolve in `probe/page.json`; `explicitness` is consistent; cited
frames and crops lie in the cited speech span ±0.5 s unless `visible_only`; a quote or value with a numeral (Arabic,
Chinese or English words) has an in-span frame or crop, a sidecar or `asr_only`, and without a frame each number of
its value is a whole number of the sidecar or the speech; a claim citing a flagged span records a limitation; an
`exclusive_group` has 2+ claims.

## Flags (heuristics for a reader)

[transcribe.md](transcribe.md) says what to do with a flag. The checker does not judge meaning (does the frame show
the value, is the role right): the reviewer does.
