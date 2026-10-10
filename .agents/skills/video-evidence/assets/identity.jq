# probe/identity.json from `yt-dlp -J`: an allowlist, so a new upstream field can never leak.
# The generic extractors name the domain as uploader and take timestamp from HTTP headers: drop them,
# keeping a direct file's Last-Modified under its own name. Page data supplies author and date instead.
. as $info
| (.extractor_key | IN("Generic", "HTML5MediaEmbed")) as $generic
| {_type, id, extractor_key, webpage_url, title, uploader, uploader_id, channel, channel_id, timestamp,
   upload_date, release_timestamp, duration, live_status, yt_dlp: ._version.version}
| if $generic then del(.uploader, .timestamp, .upload_date, .release_timestamp) else . end
| . + (if $generic and $info.direct == true then {http_last_modified: $info.timestamp} else {} end)
| with_entries(select(.value != null and .value != ""))
