# Acquire

Needs `yt-dlp` with `yt-dlp-ejs` and `deno` (YouTube's JS solver), `ffmpeg`, `jq`, `curl` and `rsync`; the
receipt records the yt-dlp version, and upgrading yt-dlp and yt-dlp-ejs (together) is the user's call.

Run `yt-dlp` only with the flags these recipes use: always `--ignore-config --no-plugin-dirs` and `--no-playlist`
(`--yes-playlist` only in the metadata-only part listing), the URL quoted after `--` (a generic download reads
`--load-info-json` instead), never `python -m yt_dlp`. Any other flag needs the user, above all those that run
programs or change how yt-dlp connects or what it trusts: `--exec`, `--use-postprocessor`, `--postprocessor-args`,
`--netrc-cmd`, `--ffmpeg-location`, `--downloader`, `--downloader-args`, `--js-runtimes` with a path,
`--config-locations`, `--plugin-dirs`, `--cookies-from-browser`, `--no-check-certificates`, `--prefer-insecure`,
`--proxy`, `--enable-file-urls` and `--remote-components`.

## Name and dedupe before acquiring

`ID` is the bare platform ID: a YouTube video ID, a Bilibili BV ID (`<BV>_p<N>` for one part of a
multi-part video), a page's record ID taken from its URL before probing (a TradingView idea's), or for a
direct file (site `direct`) `printf %s "${URL%%[?#]*}" | shasum -a 256 | cut -c1-16`. `bundle "<site>-<ID>"`
(env.sh) refuses anything outside `[A-Za-z0-9_-]` and sets `KEY`, `W` and `B`: source text never becomes a
path. Search every form a source has (IDs and a media file's name stem `STEM`), as fixed strings:

    for s in "$ID" ${STEM:+"$STEM"}; do ls -d -- "$ROOT"/bundles/*"$s"* 2>/dev/null || true
      grep -l -F -e "$s" -- "$ROOT"/bundles/*/media/receipt.json "$ROOT"/bundles/*/probe/page.json 2>/dev/null || true; done
    # research, from the repository root:
    uv run --frozen python -m research.records.cli find --text="$ID"
    git grep -n -F -e "$ID" "$(jq -r .git_commit research/records/history.json)" -- research/ || true

A hit means the source is held or was used: reuse its bundle and records (a hit recording only a failed attempt
is cited as history; acquisition proceeds). The same bytes, ID or author restating it is never independent support.

## Probe and gate (metadata only)

    bundle "<site>-<ID>"; rm -rf "$W"; mkdir -p "$W" "$B"; cd "$W"; S="$B/.stage-probe"; mkdir "$S"
    yt-dlp --ignore-config --no-plugin-dirs --no-playlist -J -- "$URL" > probe.raw.json 2> probe.err || true
    jq -f "$A/identity.jq" probe.raw.json > "$S/identity.json" || true; [ -s "$S/identity.json" ] || rm "$S/identity.json"
    gate=$(jq '(._type == "video") and ((.live_status // "not_live") | IN("not_live", "was_live"))
      and ((.id | test("_p[0-9]+$") | not) or (.webpage_url | test("[?&]p=[0-9]+")))' "$S/identity.json" 2>&1 || true)
    hosts=$(jq -r -f "$A/host_check.jq" probe.raw.json 2>&1 || true)
    if [ "$gate" != true ] || [ -n "$hosts" ]; then printf 'gate: %s %s %s\nyt-dlp -J %s\n' "${gate:-no metadata}" "$hosts" \
      "$(grep -m1 ERROR probe.err | sed -E 's/[?#][^ ]*//g')" "${URL%%[?#]*}" > "$S/FAILED"; fi
    mv "$S" "$B/probe"; [ ! -e "$B/probe/FAILED" ] || { rm -rf "$W"; exit 1; }   # a refused gate stops; raw JSON goes

A playlist, channel or multi-part video fails the gate: list it (metadata only), pick one entry explicitly
(Bilibili `?p=N`) and probe that; stop on live or upcoming. Never script repeated search or API calls (`412`).

    yt-dlp --ignore-config --no-plugin-dirs --yes-playlist --flat-playlist -I 1:50 -J -- "$URL" | jq -r '.entries[].url'

**Generic pages and direct files** (extractor `Generic` or `HTML5MediaEmbed`): the gate needs `host_check.jq`
silent. These extractors know no author, time or duration (HTTP Last-Modified is not publication); the page's
own record gives them. `PAGE` is the page the user named, or for a direct file the page that links it, never a
media URL. Without exactly one record, they stay unknown and `not_truncated` reports `undeclared`.

    bundle "<site>-<ID>"; cd "$W"; curl -fsSL --proto '=https' --proto-redir '=https' --max-filesize 20M -o page.html -- "$PAGE"
    python3 -I "$A/page_record.py" page.html "$(jq -r .url probe.raw.json)" > page.tmp && mv page.tmp "$B/probe/page.json"

## Download

    cd "$W"; case $(jq -r .extractor_key "$B/probe/identity.json") in
      Generic | HTML5MediaEmbed) SRC=(--load-info-json probe.raw.json) ;; *) SRC=(-- "$URL") ;; esac
    ulimit -f 2097152; yt-dlp --ignore-config --no-plugin-dirs --no-playlist \
      -f '(b[height>=?720][protocol=https])/(bv[height>=720][protocol=https]+ba[protocol=https])' \
      -S 'res:1080,vcodec:avc,acodec:m4a' -k --fixup never --write-info-json \
      --max-filesize 2G --no-progress -o 'source.%(ext)s' "${SRC[@]}" > download.log 2>&1

The selector is atomic: one progressive file of at least 720p, else a 720p+ video part plus an audio
part, else `Requested format is not available`; never the comma form `bv,ba`. `--fixup never` keeps
the server bytes and `-k` keeps the parts. `ulimit -f` (KiB) stops any file at 2 GiB, also a stream of
unknown length (`File too large`: stop). A generic download reads the probed formats and never
re-extracts the page. yt-dlp's own retries resume a cut part with `Range`, which can join bytes from two
CDN copies; the decode check in custody is what refuses such a file. Before any rerun, and after an interrupt
(`pgrep -fl '[y]t-dlp|[f]fmpeg'`), delete `*.part` and `*.ytdl`. Then keep the bytes: [custody.md](custody.md).

## Failures (verbatim line, query strings removed, into `<stage>/FAILED`; to stop, `rm -rf "$W"`)

| Symptom | Action |
|---|---|
| YouTube `HTTP Error 403: Forbidden` | Rerun the same command at most twice, then ask the user. |
| `Got error: ... more expected`, `Read timed out`, `Giving up after 10 retries` | The CDN cut the transfer: delete the partial files, wait a minute, rerun at most twice; then ask the user about the network path. |
| `Requested format is not available` | `-F` with the fixed flags. Only storyboards or m3u8: the JS solver or a PO token, ask the user. Every real format below 720p: stop. |
| `This video is unavailable`, `live stream recording is not available`, `only available for registered users` | Stop. |
| `Unsupported URL` after `Falling back on generic information extractor` | Stop: the page holds no video. |
| Bilibili `deleted or geo-restricted` | Stop: invalid ID or blocked region. |
| Bilibili `412`, `rate limit`, `Request is blocked` | Wait and rerun once; cookies or another network path need the user. |
| `Format(s) ... are missing; you have to become a premium member` | Ignore when 720p+ was selected. |
| `only the preview will be extracted`, `Only preview format` | The checker's `not_truncated` fails: not the source. |
