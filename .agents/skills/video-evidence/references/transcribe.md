# Transcribe (local, Apple Silicon)

Engine: `mlx-whisper==0.4.3`, `mlx==0.32.3`, `mlx-metal==0.32.3` in a Python 3.12 venv at `$MLX_VENV`, model
`mlx-community/whisper-large-v3-mlx` at a pinned revision; one MLX job at a time, about 10 times real time.
The checker's `engine_pinned` and `argv_is_recipe` hold these pins and the exact argv below, so another engine
or flag is a checker change. Setup installs packages and downloads about 3 GB, so it needs the user (an
existing venv with these pins can be named by `MLX_VENV`):

    uv venv --python 3.12 "$MLX_VENV" && uv pip install --python "$MLX_VENV/bin/python" 'mlx-whisper==0.4.3' 'mlx==0.32.3' 'mlx-metal==0.32.3'
    "$MLX_VENV/bin/python" -I -c 'from huggingface_hub import snapshot_download as d; d("mlx-community/whisper-large-v3-mlx", revision="49e6aa286ad60c14352c404340ded53710378a11")'

MODEL, Language, Transcript and run.json below are one recipe (one `bash` block, after the checker passed
on the media stage). MODEL resolves the pinned snapshot offline; a repo ID instead would fetch an unpinned one:

    REV=49e6aa286ad60c14352c404340ded53710378a11; export HF_HUB_OFFLINE=1
    MODEL=$("$MLX_VENV/bin/python" -I -c "from huggingface_hub import snapshot_download as d; print(d('mlx-community/whisper-large-v3-mlx', revision='$REV', local_files_only=True))")

## Language (mandatory)

Detect the spoken language on two 30 s windows. If they disagree, or differ from a language the user
named, stop and ask: a wrong `--language` makes Whisper write a fluent translation and exit 0.

    mkdir -p "$W"; MEDIA=${MEDIA:-$ROOT/sha256}
    for h in $(cut -c1-64 "$B/media/SHA256SUMS"); do f=$(ls "$MEDIA/$h".*)
      if ffprobe -v error "${FMT[@]}" -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then AUDIO=$f; fi; done
    ffmpeg -nostdin -v error "${FMT[@]}" -i "$AUDIO" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$W/audio.wav"
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/audio.wav")
    for k in 1 2; do
      ffmpeg -nostdin -v error -ss "$(awk -v d="$DUR" -v k=$k 'BEGIN{printf "%.6f", d*k/3}')" -t 30 -i "$W/audio.wav" -c copy "$W/lang$k.wav"
      "$MLX_VENV/bin/mlx_whisper" "$W/lang$k.wav" --model "$MODEL" --task transcribe --temperature 0 \
        --output-format json --output-dir "$W" --output-name "lang$k" --verbose False > /dev/null 2>&1
    done
    DETECTED=$(jq -rs 'map(.language) | unique | if length == 1 then .[0] else error("windows disagree: \(.)") end' "$W"/lang[12].json)

## Transcript

    S=${S:-$B/.stage-asr}; mkdir "$S"
    ARGV=("$MLX_VENV/bin/mlx_whisper" "$W/audio.wav" --model "$MODEL" --language "$DETECTED" --task transcribe
      --temperature 0 --condition-on-previous-text False --word-timestamps True
      --output-format json --output-dir "$S" --output-name transcript --verbose False)
    "${ARGV[@]}" > "$W/asr.stdout" 2> "$W/asr.stderr" || true
    if ! { test -s "$S/transcript.json" && ! grep -q '^Skipping' "$W/asr.stdout" && jq -e '.segments | length > 0' "$S/transcript.json" > /dev/null; }; then
      { grep -h -m1 -E '^Skipping|Error' "$W/asr.stdout" "$W/asr.stderr" | sed -E 's/[?][^ ]*//g'; echo "${ARGV[*]}" | sed "s|$HOME|~|g"; } > "$S/FAILED"
      mv "$S" "$B/asr"; exit 1; fi

The `if` is the success gate. Then record `run.json`: `argv` is the array that ran, with the model path as
`repo@revision` and scratch paths shortened; `pcm_sha256` hashes the samples the engine read.

    printf '%s\n' "${ARGV[@]}" | jq -R . | jq -s --arg m "$MODEL" --arg w "$W/" --arg s "$S" --arg id "mlx-community/whisper-large-v3-mlx@$REV" \
      'map(if . == $m then $id elif . == $s then "." else ltrimstr($w) end) | .[0] |= sub(".*/"; "")' > "$W/argv.json"
    "$MLX_VENV/bin/python" -I -c 'import sys, json; from importlib.metadata import version as v; print(json.dumps({p: v(p) for p in ["mlx-whisper", "mlx", "mlx-metal", "numpy"]} | {"python": sys.version.split()[0]}))' > "$W/versions.json"
    jq -n --arg pcm "$(ffmpeg -nostdin -v error -i "$W/audio.wav" -f s16le - | shasum -a 256 | cut -c1-64)" \
      --arg lang "$DETECTED" --arg ff "$(ffmpeg -version | head -1)" --arg rev "$REV" \
      --arg wt "$(shasum -a 256 "$MODEL/weights.npz" | cut -c1-64)" --slurpfile v "$W/versions.json" --slurpfile a "$W/argv.json" \
      '{pcm_sha256: $pcm, detected_language: $lang, versions: ($v[0] + {ffmpeg: $ff}), argv: $a[0],
        model: {repo: "mlx-community/whisper-large-v3-mlx", revision: $rev, weights_sha256: $wt}}' > "$S/run.json"
    mv "$S" "$B/asr" && rm -rf "$W"

Never pass `--initial-prompt` (it reaches only the first window and plants words in the evidence),
`--hallucination-silence-threshold` (it drops speech at window edges), `--clip-timestamps` or any other
flag, abbreviated or not: `argv_is_recipe` accepts only the argv above, and the reviewer reruns that argv.

## Reading view and flags (after the checker has run; flagged spans are marked)

    jq -r --slurpfile c "$B/check.json" '
      ($c[0].flags | [to_entries[] | select(.key | IN("loops", "too_dense", "too_sparse", "empty_or_outside")) | .key as $k | .value[] | {key: ., value: $k}] | from_entries) as $bad
      | .segments | to_entries[] | (.key + 1 | tostring) as $n | ("E" + ("00"[0:([3 - ($n | length), 0] | max)]) + $n) as $id
      | "\($id) \(.value.start | floor)-\(.value.end | ceil) \(if $bad[$id] then "[NOT EVIDENCE: \($bad[$id])] " else "" end)\(.value.text)"' "$B/asr/transcript.json"

| Checker flag (a heuristic) | Action |
|---|---|
| `loops`, `too_dense`, `too_sparse`, `empty_or_outside` | Not evidence: label the span; never quote or summarize it. A claim citing one fails `flagged_span_limited` unless it records the limitation. |
| `gaps_over_3s`, `tail_gap_s` over 10 | Look at the frames there; label silence, music or "not transcribed". |
| `repeats` | A loop only together with a flag above. |
| `numbers_to_verify` | A number you rely on needs a frame in its span or the label ASR-only. |

Whisper writes Mandarin numbers as Arabic or Chinese numerals (`12.5`, `十二点五`, `两小时`) and homophones hide
digits: read both forms. Thresholds were tuned on one Mandarin speaker; another Whisper is not an independent check.

## Reviewer rerun (after the checker passed on the restored `B`)

Set `B` to the restored bundle, `MEDIA` to the backup's `sha256/`, `W` to an empty scratch directory and
`S="$W/rerun"`, then run MODEL (with `run.json`'s revision), Language and Transcript above, never the recorded
argv. `DETECTED` must equal `run.json`'s `detected_language` and `cmp "$S/transcript.json"
"$B/asr/transcript.json"` must be silent; any difference is reported, never repaired.
