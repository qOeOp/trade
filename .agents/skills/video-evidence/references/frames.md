# Frames

Decode only the video identity file. ffmpeg exits 0 when it wrote nothing or left a stale file, so
every output goes into a new staging directory (delete one an interrupted block left), and a frame
exists only if `framehash.txt` has its row. Frame identity is the media SHA-256, the exact pts `n*num/den` and the decoded-frame SHA-256,
which threads, SIMD and remuxing do not change; the PNG SHA-256 only names the file.

    for h in $(cut -c1-64 "$B/media/SHA256SUMS"); do f=$(ls "$ROOT/sha256/$h".*)
      if ffprobe -v error -select_streams v -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then IN=$f; vsha=$h; fi; done
    LAST=$(ffprobe -v error -select_streams v:0 -show_entries packet=pts_time -of csv=p=0 "$IN" | sort -n | tail -1)

## Coverage grid: the first frame of each STEP-second bucket plus the last frame, one decode

    STEP=6; D="$B/.stage-grid"; mkdir "$D"
    ffmpeg -hide_banner -nostdin -v error -copyts -i "$IN" -an -filter_complex \
      "[0:v:0]select='isnan(prev_t)+gt(floor(t/$STEP)\,floor(prev_t/$STEP))+gte(t\,$LAST-0.0005)',split=2[p][h]" \
      -map "[p]" -fps_mode passthrough "$D/frame_%04d.png" \
      -map "[h]" -fps_mode passthrough -enc_time_base:v demux -f framehash -hash sha256 "$D/framehash.txt"
    awk -F', *' '/^#tb/ {split($0, a, ": "); tb = a[2]; next} /^#/ {next}
      {i++; printf "frame_%04d.png\t%s*%s\t%s\n", i, $3, tb, $6}' "$D/framehash.txt" > "$D/rows.tsv"
    ( cd "$D" && shasum -a 256 frame_*.png | awk '{print $2 "\t" $1}' ) | join -t "$(printf '\t')" "$D/rows.tsv" - > "$D/grid.tsv"
    test "$(ls "$D"/frame_*.png | wc -l)" -eq "$(wc -l < "$D/grid.tsv")"
    rm "$D/rows.tsv" "$D/framehash.txt"; mkdir -p "$B/frames" && mv "$D" "$B/frames/grid"

`grid.tsv` columns: file, `pts*num/den`, decoded-frame SHA-256, PNG SHA-256. Seconds are
`awk -F'\t' '{split($2, p, "[*/]"); print $1, p[1] * p[2] / p[3]}'`.

## Exact frames and brackets (one decode)

`T` is the target time and `H` the half-width (one frame interval gives the frame on screen at `T`).
Bracket at the end of every segment that points at the screen or narrates drawing or moving before
citing what the screen shows; narrow a first appearance with repeated brackets.

    NAME="t$(printf '%09.3f' "$T" | tr -d .)"; D="$B/.stage-$NAME"; mkdir "$D"
    lo=$(awk -v t="$T" -v h="$H" 'BEGIN{print t - h}'); hi=$(awk -v t="$T" -v h="$H" 'BEGIN{print t + h}')
    SS=$(awk -v t="$T" -v h="$H" 'BEGIN{s = t - h - 1; print (s < 0 ? 0 : s)}'); DUR=$(awk -v h="$H" 'BEGIN{print 2 * h + 2}')
    X="(isnan(prev_t)+lt(prev_t\\,%s))*gte(t\\,%s)"; SEL=$(printf "$X+$X+$X" "$lo" "$lo" "$T" "$T" "$hi" "$hi")
    ffmpeg -hide_banner -nostdin -v error -ss "$SS" -t "$DUR" -copyts -i "$IN" -an -filter_complex \
      "[0:v:0]select='$SEL',split=2[p][h]" -map "[p]" -fps_mode passthrough -frames:v 3 "$D/f_%d.png" \
      -map "[h]" -fps_mode passthrough -frames:v 3 -enc_time_base:v demux -f framehash -hash sha256 "$D/framehash.txt"

Build `grid.tsv` as above (with `f_*.png` and `f_%d.png`), delete the intermediates and
`mv "$D" "$B/frames/$NAME"`. Citable identities:
`awk -F'\t' -v m="$vsha" '{printf "{\"media_sha256\":\"%s\",\"pts\":\"%s\",\"decoded_sha256\":\"%s\"}\n", m, $2, $3}' "$B/frames/$NAME/grid.tsv"`.
Fewer than 3 rows means a target fell past `LAST` or inside one frame interval.

## Contact sheets (for finding frames; about one sheet per minute at a 6 s step)

    args=(); while IFS=$'\t' read -r f x _; do args+=(-label "t=$(awk -v x="$x" 'BEGIN{split(x, p, "[*/]"); printf "%.1f", p[1] * p[2] / p[3]}')s" "$B/frames/grid/$f"); done < "$B/frames/grid/grid.tsv"
    magick montage -font "/System/Library/Fonts/Hiragino Sans GB.ttc" -pointsize 16 "${args[@]}" \
      -tile 4x3 -geometry 480x+4+4 -strip "$W/sheet-%d.png"

Without an explicit font that covers the labels' script, montage drops labels silently. Never read a
value from a sheet; open the PNGs or crops you cite.

## Crops (cited unscaled, from a hashed PNG)

    P="$B/frames/$DIR/$PNG"; row=$(awk -F'\t' -v f="$PNG" '$1 == f' "$B/frames/$DIR/grid.tsv"); mkdir -p "$B/crops"
    ffmpeg -nostdin -v error -i "$P" -vf "crop=$CW:$CH:$CX:$CY" -update 1 "$B/crops/$NAME.png"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$NAME.png" "$(shasum -a 256 "$B/crops/$NAME.png" | cut -c1-64)" "$vsha" \
      "$(cut -f2 <<< "$row")" "$(cut -f3 <<< "$row")" "${CW}x${CH}+${CX}+${CY}" >> "$B/crops/crops.tsv"

`crops.tsv`: file, SHA-256, parent media, parent `pts*num/den`, parent decoded SHA-256, geometry.
The checker re-crops the media frame and compares pixels. Enlarge for reading or OCR outside the
bundle, never cited: `magick "$B/crops/$NAME.png" -filter Lanczos -resize 300% -strip "$W/$NAME-x3.png"`.

## Optional

- Same pictures across two containers: the grid command with `STEP=1` and only the framehash output,
  then `grep -v '^#' F | awk -F', *' '{print $6}' | shasum -a 256`. Equal digests mean the same
  decoded pictures; unequal is inconclusive.
- OCR (macOS): `swift "$A/ocr.swift" CROP.png` prints `x y w h confidence text`. Confidence is not
  evidence. For an axis value: keep labels in the axis's exact format, fit value = a*y + b (log axis:
  log value), drop the worst label while its residual exceeds 1.5 px, need at least 3 labels, and
  accept only when fits on the 200% and 300% enlargements agree within 1 px.
