# Custody and receipt

Run after a completed download, with the same `bundle "<KEY>"` as [acquire.md](acquire.md). Identity files
are the raw server bytes: `source.f<format_id>.*` per part when `format_id` holds `+`, else `source.<ext>`.
Each must decode without an error (a resumed or cut transfer does not), and the receipt is an allowlist
projection, never the raw info JSON.

    cd "$W"; S="$B/.stage-media"; mkdir "$S"; I="$W/source.info.json"; fids=$(jq -r .format_id "$I")
    if [[ $fids == *+* ]]; then files=$(for f in ${fids//+/ }; do ls source.f"$f".*; done); else files="source.$(jq -r .ext "$I")"; fi
    for F in $files; do err=$(ffmpeg -nostdin -v error "${FMT[@]}" -i "$F" -f null - 2>&1 | head -2 || true)
      if [ -n "$err" ]; then printf 'decode: %s\n%s\n' "$err" "ffmpeg -i $F -f null -" > "$S/FAILED"; mv "$S" "$B/media"; exit 1; fi; done
    jq -f "$A/receipt.jq" "$I" > "$S/receipt.json"
    jq -e -n --slurpfile i "$I" --slurpfile p "$B/probe/identity.json" '$i[0].id == $p[0].id' > /dev/null
    if grep -Eiq '[?&/;~,](ip|oi|mid|buvid|upsig|sig|expires?|exp|hmac|token)[=/~]|cookie' "$S/receipt.json"; then
      echo "leak in receipt.json" >&2; exit 1; fi
    for F in $files; do
      sha=$(shasum -a 256 "$F" | cut -c1-64); dst="$ROOT/sha256/$sha.${F##*.}"
      if [ -e "$dst" ]; then echo "already held: $dst"
      else cp "$F" "$ROOT/sha256/.stage-$sha" && echo "$sha  $ROOT/sha256/.stage-$sha" | shasum -a 256 -c --status \
        && mv -n "$ROOT/sha256/.stage-$sha" "$dst"; fi
      echo "$sha  $F" >> "$S/SHA256SUMS"
    done
    mv "$S" "$B/media" && rm -rf "$W"

"already held" means the same bytes as an earlier source. A local file skips the download: check
`[ -f "$F" ] && [ ! -L "$F" ]`, decode-check and hash it into `sha256/` the same way, list it as
`source.<ext>`, use `bundle "local-<first 16 hex of its SHA-256>"` and write `probe/identity.json` as
`{"_type": "video", "id": "<16 hex>", "extractor_key": "local", "webpage_url": "<origin the user gave, or
unknown>"}`; only a local file has no receipt.

Backup (research custody, or whenever `VIDEO_EVIDENCE_BACKUP` is set) after the last stage and after every
change to `claims.json`; the loop must print nothing:

    BK=${VIDEO_EVIDENCE_BACKUP:?set VIDEO_EVIDENCE_BACKUP to a second directory}; mkdir -p "$BK/sha256"
    rsync -a --ignore-existing "$ROOT/sha256/" "$BK/sha256/" && rsync -a "$ROOT/bundles" "$BK/"
    for r in "$ROOT" "$BK"; do for f in "$r"/sha256/*.*; do echo "$(basename "${f%.*}")  $f" | shasum -a 256 -c --status || echo "BAD $f"; done; done

Cookies: only a file the user supplied for this, only for Bilibili, passed as a temporary copy
(`--cookies .cookies.tmp`; yt-dlp rewrites it); never record its path. Before `mv "$S" "$B/media"`, no
cookie value may be in a kept file (values under 8 characters are too common to test):

    awk -F'\t' 'NF == 7 && length($7) >= 8 {print $7}' .cookies.tmp > .cookie-values
    if [ -s .cookie-values ] && grep -rlF -f .cookie-values "$S" "$B/probe"; then echo "cookie value kept" >&2; exit 1; fi
