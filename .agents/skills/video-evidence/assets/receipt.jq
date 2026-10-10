# media/receipt.json from the download's --write-info-json: what was fetched, never how (no URL query,
# header or cookie). Generic pages keep media_url without its query, plus an optional
# --argjson declared '{"duration": SECONDS, "from": "<page JSON path>"}' taken from the page record.
(.extractor_key | IN("Generic", "HTML5MediaEmbed")) as $generic
| {id, webpage_url, format_id, protocol, filesize, yt_dlp: ._version.version,
   requested_formats: [(.requested_formats // [])[] | {format_id, protocol, filesize}]}
  + (if $generic then {media_url: ((.url // "") | sub("[?#].*$"; ""))} else {} end)
  + (if ($ARGS.named.declared // null) != null then {declared: $ARGS.named.declared} else {} end)
| with_entries(select(.value != null and .value != "" and .value != []))
