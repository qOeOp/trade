# media/receipt.json from the download's --write-info-json: what was fetched, never how (no query, path token,
# header or cookie). That file has no requested_formats, so each part comes from .formats by its format_id.
# Generic pages keep media_url: query, fragment and ;params removed, host only if a path segment holds = or ~.
. as $i
| {id, format_id, protocol, filesize, yt_dlp: ._version.version,
   requested_formats: [(.format_id // "" | split("+"))[] as $f | ($i.formats // [])[] | select(.format_id == $f)
     | {format_id, protocol, filesize}]}
  + if $i.extractor_key | IN("Generic", "HTML5MediaEmbed") then {media_url: ($i.url // "" | sub("[?#].*$"; "")
      | gsub(";[^/]*"; "") | if test("^[a-z]+://[^/]+(/[^/=~]*)*$") then . else (capture("^(?<h>[a-z]+://[^/]+)").h // "") end)}
    else {} end
| with_entries(select(.value != null and .value != "" and .value != []))
