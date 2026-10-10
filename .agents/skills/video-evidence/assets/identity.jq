# probe/identity.json from `yt-dlp -J`: an allowlist, so a new upstream field can never leak. webpage_url is
# canonical (share and tracking parameters dropped; Bilibili keeps only ?p=). The generic extractors name the
# domain as uploader and take timestamp from HTTP headers: dropped; the page record gives author and date.
(.extractor_key | IN("Generic", "HTML5MediaEmbed")) as $generic
| {_type, id, extractor_key, title, uploader, uploader_id, channel, channel_id, timestamp, upload_date,
   release_timestamp, duration, live_status, yt_dlp: ._version.version,
   webpage_url: (if .extractor_key == "Youtube" then "https://www.youtube.com/watch?v=\(.id)"
     elif .extractor_key == "BiliBili" then "https://www.bilibili.com/video/\(.id | sub("_p[0-9]+$"; ""))"
       + ((.webpage_url // "" | capture("[?&]p=(?<p>[0-9]+)").p // null) as $p | if $p then "?p=\($p)" else "" end)
     else (.webpage_url // "" | sub("[?#].*$"; "") | gsub(";[^/]*"; "")) end)}
| if $generic then del(.uploader, .timestamp, .upload_date, .release_timestamp) else . end
| with_entries(select(.value != null and .value != ""))
