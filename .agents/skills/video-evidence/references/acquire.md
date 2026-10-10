# Acquire

Needs `yt-dlp` with `yt-dlp-ejs` and `deno` (YouTube's JS solver), `ffmpeg`, `jq` and `rsync`. The
receipt records the yt-dlp version; upgrading yt-dlp and yt-dlp-ejs (together) is the user's call.

Run `yt-dlp` only with the flags these recipes use: always `--ignore-config --no-plugin-dirs
--no-playlist` and `--` before the quoted URL, never `python -m yt_dlp`. Any other flag needs the
user, above all those that run programs or change how yt-dlp connects or what it trusts, such as
`--exec`, `--use-postprocessor`, `--postprocessor-args`, `--netrc-cmd`, `--ffmpeg-location`,
`--downloader`, `--downloader-args`, `--js-runtimes` with a path, `--config-locations`,
`--plugin-dirs`, `--cookies-from-browser`, `--no-check-certificates`, `--prefer-insecure`,
`--proxy`, `--enable-file-urls` and `--remote-components`.

## Dedupe before acquiring

`ID` is the bare platform ID in each form a source has: a YouTube video ID, a Bilibili BV ID (and
part), a page's own record ID (such as a TradingView idea UUID) and a direct file's name stem.

    ls -d "$ROOT"/bundles/*"$ID"* 2>/dev/null || true
    # research, from the repository root:
    uv run --frozen python -m research.records.cli find --text "$ID"
    git grep -n "$ID" "$(jq -r .git_commit research/records/history.json)" -- research/

A hit means the source is held or was used: reuse its bundle and records. The same bytes, the same
ID or the same author restating it is never independent support. Name sources by the bare ID.

## Probe and gate (metadata only)

`KEY` is `<site>-<ID>` (`youtube-<ID>`, `bilibili-<BV>_p<N>`, a page's site and record ID);
`W="$ROOT/work/$KEY"` starts empty; `B="$ROOT/bundles/$KEY"`.

    mkdir -p "$W" && cd "$W"
    yt-dlp --ignore-config --no-plugin-dirs --no-playlist -J -- "$URL" > probe.raw.json 2> probe.err
    S="$B/.stage-probe"; mkdir -p "$B" && mkdir "$S"
    jq -f "$A/identity.jq" probe.raw.json > "$S/identity.json"
    jq -e '(._type == "video") and ((.live_status // "not_live") | IN("not_live", "was_live"))
      and ((.id | test("_p[0-9]+$") | not) or (.webpage_url | test("[?&]p=[0-9]+")))' "$S/identity.json"

When the gate fails on a playlist, channel or multi-part video, list it with `-J --flat-playlist -I
1:50` and the fixed flags, then pick one entry explicitly (Bilibili `?p=N`); stop on live or upcoming.

**Generic pages** (extractor `Generic` or `HTML5MediaEmbed`) choose what yt-dlp fetches:
`jq -r -f "$A/host_check.jq" probe.raw.json` must print nothing. These extractors know no author,
publication time or duration; take them only from the page's own structured data (JSON-LD, `og:`
tags, a page-state block such as `<script type="application/prs.init-data+json">`), read with
`curl -fsSL --proto '=https' --proto-redir '=https' --max-filesize 20M -- "$URL"`. Keep exactly one
record, the one whose video URL equals the probe's `url` without its query, as `$S/page.json`; with
none or several, they stay unknown. A direct file's `http_last_modified` is when its server copy
changed, not publication. Then `mv "$S" "$B/probe"`.

## Download

    cd "$W" && yt-dlp --ignore-config --no-plugin-dirs --no-playlist \
      -f '(b[height>=?720][protocol=https])/(bv[height>=720][protocol=https]+ba[protocol=https])' \
      -S 'res:1080,vcodec:avc,acodec:m4a' -k --fixup never --write-info-json \
      --max-filesize 2G --no-progress -o 'source.%(ext)s' -- "$URL" > download.log 2>&1

The selector is atomic: one progressive file of at least 720p, else a 720p+ video part plus an audio
part, else `Requested format is not available`; never the comma form `bv,ba`. `--fixup never` keeps
the server bytes and `-k` keeps the parts. After an interrupt run `pgrep -fl '[y]t-dlp|[f]fmpeg'`,
then delete `*.part` and `*.ytdl`. Then keep the bytes: [custody.md](custody.md).

## Failures (verbatim line, query strings removed, into `<stage>/FAILED`)

| Symptom | Action |
|---|---|
| YouTube `HTTP Error 403: Forbidden` | Rerun the same command at most twice, then ask the user. |
| `Requested format is not available` | `-F` with the fixed flags. Only storyboards or m3u8: the JS solver or a PO token, ask the user. Every real format below 720p: stop. |
| `This video is unavailable`, `live stream recording is not available`, `only available for registered users` | Stop. |
| `Unsupported URL` after `Falling back on generic information extractor` | Stop: the page holds no video. |
| Bilibili `deleted or geo-restricted` | Stop: invalid ID or blocked region. |
| Bilibili `412`, `rate limit`, `Request is blocked` | Wait and rerun once; cookies or another network path need the user. |
| `Format(s) ... are missing; you have to become a premium member` | Ignore when 720p+ was selected. |
| `only the preview will be extracted`, `Only preview format` | The checker's `not_truncated` fails: not the source. |
