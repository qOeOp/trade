# Custody and receipt

Run after a completed download, in the same `W`, `B` and `KEY` as [acquire.md](acquire.md). Identity
files are the raw server bytes: `source.f<format_id>.*` per part when `format_id` holds `+`, else
`source.<ext>`. The receipt is an allowlist projection, never the raw info JSON.

    S="$B/.stage-media"; mkdir "$S"; I="$W/source.info.json"
    jq -f "$A/receipt.jq" "$I" > "$S/receipt.json"   # generic: --argjson declared "$(jq -c '{duration: .<path>, from: "page.json:.<path>"}' "$B/probe/page.json")"
    ! grep -Eiq '[?&/](ip|oi|mid|buvid|upsig|sig|expire)[=/]|cookie' "$S/receipt.json"
    jq -e -n --slurpfile i "$I" --slurpfile r "$S/receipt.json" '$i[0].webpage_url == $r[0].webpage_url and $i[0].format_id == $r[0].format_id' > /dev/null
    fids=$(jq -r .format_id "$I")
    if [[ $fids == *+* ]]; then files=$(for f in ${fids//+/ }; do ls "$W"/source.f"$f".*; done); else files="$W/source.$(jq -r .ext "$I")"; fi
    for F in $files; do
      sha=$(shasum -a 256 "$F" | cut -c1-64); dst="$ROOT/sha256/$sha.${F##*.}"
      if [ -e "$dst" ]; then echo "already held: $dst"
      else cp "$F" "$ROOT/sha256/.stage-$sha" && echo "$sha  $ROOT/sha256/.stage-$sha" | shasum -a 256 -c --status \
        && mv -n "$ROOT/sha256/.stage-$sha" "$dst"; fi
      echo "$sha  $(basename "$F")" >> "$S/SHA256SUMS"
    done
    mv "$S" "$B/media" && rm -rf "$W"

"already held" means the same bytes as an earlier source. A local file skips the download: check
`[ -f "$F" ] && [ ! -L "$F" ]`, hash it into `sha256/` the same way, list it as `source.<ext>`, use
`KEY=local-<first 16 hex of its SHA-256>` and write `probe/identity.json` as `{"_type": "video", "id":
"<16 hex>", "extractor_key": "local", "webpage_url": "<origin the user gave, or unknown>"}`.

Backup (research custody, or whenever `VIDEO_EVIDENCE_BACKUP` is set); the loop must print nothing:

    BK=${VIDEO_EVIDENCE_BACKUP:?set VIDEO_EVIDENCE_BACKUP to a second directory}; mkdir -p "$BK/sha256"
    rsync -a --ignore-existing "$ROOT/sha256/" "$BK/sha256/" && rsync -a "$ROOT/bundles" "$BK/"
    for r in "$ROOT" "$BK"; do for f in "$r"/sha256/*.*; do echo "$(basename "${f%.*}")  $f" | shasum -a 256 -c --status || echo "BAD $f"; done; done

Cookies: only a file the user supplied for this, only for Bilibili, passed as a temporary copy
(`--cookies .cookies.tmp`; yt-dlp rewrites it). Before deleting the copy, check
`! grep -F -f <(awk -F'\t' 'NF==7{print $7}' .cookies.tmp) "$S/receipt.json"`; never record its path.

