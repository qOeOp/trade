"""Recompute a video evidence bundle's identity bindings from its bytes; print JSON; exit 1 on any failed check.

usage: python3 -I check_bundle.py BUNDLE --media-dir DIR [--recompute K] [--restored]
Writes nothing and imports nothing from this repository; needs ffmpeg and ffprobe on PATH. Layout and checks:
services/video-evidence/README.md. "checks" decide "ok" (identity and hash binding, recomputation from the bytes);
"flags" are ASR heuristics for a reader. --restored accepts grid rows whose uncited PNG was not retained (those
rows are still recomputed by sample).
"""
import argparse, hashlib, json, math, os, re, shutil, stat, struct, subprocess, sys, threading, unicodedata, zlib
from functools import lru_cache
from pathlib import Path
from urllib.parse import unquote, urlsplit

TIMEOUT = 600  # seconds per subprocess
FF = ["-hide_banner", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe"]
MEDIA = ["-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm"]  # before every media input: no concat, HLS, text
CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"}
CEILING = {"side": 8192, "bytes": 2 << 30, "seconds": 96 * 60}  # the retired service's source limits
ASR = {"repo": "mlx-community/whisper-large-v3-mlx", "revision": "49e6aa286ad60c14352c404340ded53710378a11", "mlx-whisper": "0.4.3"}
NAME = r"[A-Za-z0-9_-][A-Za-z0-9_.-]*"
LAYOUT = re.compile(rf"probe/(identity|page)\.json|media/(receipt\.json|SHA256SUMS)|asr/(transcript|run)\.json|claims\.json"
                    rf"|note\.md|frames/{NAME}/({NAME}\.png|grid\.tsv)|crops/({NAME}\.png|crops\.tsv)|(probe|media|asr|crops|frames(/{NAME})?)/FAILED")
PNG_CHUNKS = {b"IHDR", b"PLTE", b"tRNS", b"sRGB", b"gAMA", b"cHRM", b"cICP", b"cLLI", b"mDCV", b"pHYs", b"sBIT", b"IDAT", b"IEND"}
URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s\"'<>\\]+", re.I)
URL_SECRET = re.compile(r"[?&/;~,](ip|oi|mid|buvid|upsig|sig|signature|expires?|exp|hmac|token|policy|key-pair-id|acl|hdnts"
                        r"|jsessionid|vd_source|si|spm_id_from|session|auth)[=/~]|^[a-z0-9+.-]+://[^/?#]*@", re.I)
IPV4 = re.compile(r"(?<![\d.])((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])")
HOME = re.compile(r"(?<![\w/.-])/(Users|home)/[^/\s\"]+")
FAILED_SECRET = re.compile(r"cookie:|set-cookie|authorization:", re.I)
SECRET_KEYS = {"http_headers", "cookies", "cookie", "set-cookie", "authorization"}
EN = ("zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen"
      "|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|percent")
CN = "〇零二两三四五六七八九十百千万亿半俩仨廿卅壹贰叁肆伍陆柒捌玖拾佰仟"
NUMERAL = re.compile(rf"\d|[{CN}]|一[点十百千万亿个只根成倍半手块分秒小天日周月年次]|[十百千万亿]一|\b({EN})\b", re.I)
NUMBER_TOKEN = re.compile(rf"\d[\d.,:%]*|[{CN}一点]+|\b(?:{EN})\b", re.I)
BAD_SPAN = ("loops", "too_dense", "too_sparse", "empty_or_outside")
EXPLICITNESS = ("spoken", "visible_only", "inferred")
HEX64 = re.compile(r"[0-9a-f]{64}")
GEOMETRY = re.compile(r"(\d+)x(\d+)\+(\d+)\+(\d+)")
JSON_STEP = re.compile(r'\.([A-Za-z_]\w*)|\[(\d+)\]|\["([^"\\]*)"\]', re.A)
MISSING = object()
out = {"checks": [], "flags": {}, "stages": {}}


def check(stage, name, ok, detail=None):
    out["checks"].append({"stage": stage, "check": name, "ok": bool(ok), **({"detail": detail} if detail else {})})
    return bool(ok)


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT).stdout
    except subprocess.TimeoutExpired:
        check("checker", "deadline:" + cmd[0], False, f"{TIMEOUT} s")
    except OSError as error:
        check("checker", "tool:" + cmd[0], False, str(error)[:200])
    return ""


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load(path, b):
    """Strict JSON, as the retired service read it: duplicate keys and non-finite numbers are refused."""
    def pairs(items):
        if len({k for k, _ in items}) != len(items):
            raise ValueError("duplicate key")
        return dict(items)

    def finite(text):
        if not math.isfinite(float(text)):
            raise ValueError("non-finite number " + text)
        return float(text)
    try:
        value = json.loads(path.read_text(), object_pairs_hook=pairs, parse_float=finite, parse_constant=finite)
        if isinstance(value, dict):
            return value
        raise ValueError("not an object")
    except (OSError, ValueError, UnicodeDecodeError) as error:
        check("bundle", f"readable_json:{path.relative_to(b).as_posix()}", False, str(error)[:200])
        return {}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def exact(value):
    """'n*num/den' -> (n, num, den); None when malformed."""
    m = re.fullmatch(r"(-?\d+)\*(\d+)/(\d+)", str(value).strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m and int(m[2]) and int(m[3]) else None


def seconds(key):
    return key[0] * key[1] / key[2]


def walk(value):
    """Every JSON object inside value, value first."""
    if isinstance(value, dict):
        yield value
    for child in value.values() if isinstance(value, dict) else value if isinstance(value, list) else []:
        yield from walk(child)


def resolve(doc, path):
    """A jq-style path (.a.b[0]["c d"]) into doc; MISSING when it does not resolve."""
    steps = list(JSON_STEP.finditer(str(path)))
    if not steps or "".join(m[0] for m in steps) != path:
        return MISSING
    for m in steps:
        if m[2] is not None:
            doc = doc[int(m[2])] if isinstance(doc, list) and int(m[2]) < len(doc) else MISSING
        else:
            key = m[1] if m[1] is not None else m[3]
            doc = doc[key] if isinstance(doc, dict) and key in doc else MISSING
        if doc is MISSING:
            return MISSING
    return doc


def bare(url):
    return unquote(re.sub(r"[?#].*", "", str(url)))


def page_media(page, url):
    """(page record holds the media URL, the one duration declared beside it): seconds or ISO 8601 (PT5M32S)."""
    held, found = False, set()
    for obj in walk(page):
        if url and any(isinstance(v, str) and bare(v) == bare(url) for v in obj.values()):
            held = True
            for k in (k for k in ("duration", "video_duration") if k in obj):
                m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", str(obj.get(k)))
                found.add(float(obj[k]) if number(obj.get(k)) else
                          sum(float(g or 0) * f for g, f in zip(m.groups(), (86400, 3600, 60, 1))) if m and any(m.groups()) else None)
    return held, (found.pop() if len(found) == 1 else None)


def public_https(url):
    """The generic-page host rule of assets/host_check.jq: HTTPS on 443 to a public name, no userinfo or IP literal."""
    try:
        p = urlsplit(re.sub(r"[\t\r\n]", "", str(url)))
        host, port = (p.hostname or "").rstrip("."), p.port
    except ValueError:
        return False
    return (p.scheme == "https" and p.username is None and port in (None, 443)
            and re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*", host) is not None
            and not re.search(r"(^|\.)(localhost|local|lan|internal|test|invalid|home\.arpa)$", host))


def leaks(text, doc=None, failed=False):
    """Signed or tokenized URLs, IP-bearing URLs, local home paths and secret keys; FAILED text also any IP or header."""
    hits = [u for u in URL.findall(text) if URL_SECRET.search(u) or IPV4.search(u)] + [m[0] for m in HOME.finditer(text)]
    hits += [m[0] for r in (FAILED_SECRET, IPV4) for m in r.finditer(text)] if failed else []
    return hits + [k for o in walk(doc or {}) for k in o if k.casefold() in SECRET_KEYS]


def png_plain(path):
    """None when the PNG holds only an image: allowed chunks, little metadata, IDAT inflating to exactly the pixels."""
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR" or len(raw) < 33:
        return "not a PNG"
    w, h, depth, kind, _, _, interlace = struct.unpack(">IIBBBBB", raw[16:29])
    pos, idat, meta, last = 8, [], 0, b""
    while pos + 12 <= len(raw):
        n, last = struct.unpack(">I4s", raw[pos:pos + 8])
        if last not in PNG_CHUNKS or pos + 12 + n > len(raw):
            return f"chunk {last!r}"
        idat += [raw[pos + 8:pos + 8 + n]] if last == b"IDAT" else []
        meta, pos = meta + (0 if last == b"IDAT" else n), pos + 12 + n
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(kind)
    if last != b"IEND" or pos != len(raw) or meta > 4096 or not channels or interlace or not (0 < w <= CEILING["side"] and 0 < h <= CEILING["side"]):
        return "chunk layout"
    size, inflate = h * (1 + (w * channels * depth + 7) // 8), zlib.decompressobj()
    try:
        pixels = inflate.decompress(b"".join(idat), size + 1)
    except zlib.error as error:
        return str(error)
    return None if len(pixels) == size and inflate.eof and not inflate.unused_data else "IDAT is not exactly the image"


def probe(path):
    text = run(["ffprobe", *FF[2:], *MEDIA, "-show_entries", "format=format_name:stream=codec_type,width,height"
                ":stream_disposition=attached_pic", "-of", "json", str(path)])
    try:
        return json.loads(text or "{}")
    except ValueError:
        return {}


@lru_cache(maxsize=None)
def packets(path, stream):
    """((num, den) time base, pts of every packet the demuxer keeps) for stream, e.g. 'v:0'."""
    text = run(["ffprobe", *FF[2:], *MEDIA, "-select_streams", stream, "-show_entries", "stream=time_base:packet=pts,flags",
                "-of", "json", str(path)])
    try:
        doc = json.loads(text or "{}")
    except ValueError:
        return None, []
    tb = re.fullmatch(r"(\d+)/(\d+)", str((doc.get("streams") or [{}])[0].get("time_base")))
    pts = [p["pts"] for p in doc.get("packets", []) if isinstance(p.get("pts"), int) and "D" not in str(p.get("flags"))]
    return ((int(tb[1]), int(tb[2])) if tb and int(tb[2]) else None), pts


def framehash_rows(text):
    return [r.replace(" ", "").split(",") for r in text.splitlines() if r and not r.startswith("#")]


def frame_hashes(path, key, geometries):
    """One decode at key: [decoded-frame hash, its rgb24 hash, rgb24 hash per crop]; None if no frame has that pts."""
    sel = f"select='gte(t\\,{seconds(key) - 0.0005:.6f})',trim=end_frame=1"
    chains = [f"[0:v:0]{sel}[o0]", f"[0:v:0]{sel},format=rgb24[o1]"]  # separate chains keep the decoder's format
    chains += [f"[0:v:0]{sel},format=rgb24,crop={w}:{h}:{x}:{y}[o{i + 2}]" for i, (w, h, x, y) in enumerate(geometries)]
    maps = [arg for i in range(len(chains)) for arg in ("-map", f"[o{i}]")]
    text = run(["ffmpeg", *FF, "-ss", f"{max(0.0, seconds(key) - 1):.6f}", "-t", "2", "-copyts", *MEDIA, "-i", str(path), "-an",
                "-filter_complex", ";".join(chains), *maps, "-fps_mode", "passthrough", "-enc_time_base", "demux",
                "-c:v", "rawvideo", "-f", "framehash", "-hash", "sha256", "-"])
    tb = re.search(r"#tb 0: (\d+)/(\d+)", text)
    rows = {int(r[0]): r for r in framehash_rows(text)}
    if not tb or 0 not in rows or int(rows[0][2]) * int(tb[1]) * key[2] != key[0] * key[1] * int(tb[2]):
        return None
    return [rows[i][5] if i in rows else None for i in range(len(chains))]


def png_rgb(path):
    rows = framehash_rows(run(["ffmpeg", *FF, "-f", "png_pipe", "-i", str(path), "-map", "0:v:0", "-pix_fmt", "rgb24",
                               "-c:v", "rawvideo", "-f", "framehash", "-hash", "sha256", "-"]))
    return rows[0][5] if len(rows) == 1 else None


def pcm(path):
    """SHA-256 and seconds of the 16 kHz mono s16le PCM that the ASR recipe feeds the engine, streamed."""
    proc = subprocess.Popen(["ffmpeg", *FF, *MEDIA, "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    timer, digest, size = threading.Timer(TIMEOUT, proc.kill), hashlib.sha256(), 0
    timer.start()
    for block in iter(lambda: proc.stdout.read(1 << 20), b""):
        digest.update(block)
        size += len(block)
    proc.wait()
    timer.cancel()
    if proc.returncode != 0:
        check("asr", "pcm_decoded", False, f"ffmpeg exit {proc.returncode} (killed after {TIMEOUT} s if negative)")
        return None, 0.0
    return digest.hexdigest(), size / 32000


def whisper_argv(language):
    """The argv transcribe.md runs, as run.json records it; the reviewer reruns this, never the recorded one."""
    return ["mlx_whisper", "audio.wav", "--model", f"{ASR['repo']}@{ASR['revision']}", "--language", str(language),
            "--task", "transcribe", "--temperature", "0", "--condition-on-previous-text", "False", "--word-timestamps",
            "True", "--output-format", "json", "--output-dir", ".", "--output-name", "transcript", "--verbose", "False"]


def asr_schema(doc):
    """Name the transcript schema; never default a missing key. Whisper: compression_ratio and words on every segment."""
    segs = doc.get("segments")
    if isinstance(segs, list) and segs and all(
            isinstance(s, dict) and number(s.get("start")) and number(s.get("end")) and isinstance(s.get("text"), str)
            and number(s.get("compression_ratio")) and isinstance(s.get("words"), list)
            and all(isinstance(w, dict) and isinstance(w.get("word"), str) and number(w.get("start"))
                    and number(w.get("end")) and number(w.get("probability")) for w in s["words"]) for s in segs):
        return "whisper"
    return None


def asr_flags(segs, dur):
    words = [w for s in segs for w in s["words"]]
    n = lambda text: len(re.sub(r"\s", "", text))
    eid = lambda i: f"E{i + 1:03d}"
    flags = {
        "tail_gap_s": round(dur - max((w["end"] for w in words), default=0), 2),
        "gaps_over_3s": [[a["end"], b["start"]] for a, b in zip(words, words[1:]) if b["start"] - a["end"] > 3],
        "loops": [i for i, s in enumerate(segs) if s["compression_ratio"] > 2.4],
        "repeats": [i for i in range(2, len(segs))
                    if n(segs[i]["text"]) >= 2 and segs[i]["text"] == segs[i - 1]["text"] == segs[i - 2]["text"]],
        "too_dense": [i for i, s in enumerate(segs) if n(s["text"]) >= 6 and n(s["text"]) / max(s["end"] - s["start"], 0.1) > 20],
        "too_sparse": [i for i, s in enumerate(segs) if s["end"] - s["start"] > 8 and n(s["text"]) / (s["end"] - s["start"]) < 1.5],
        "empty_or_outside": [i for i, s in enumerate(segs) if n(s["text"]) == 0 or s["end"] <= s["start"] or s["end"] > dur + 0.5],
        "numbers_to_verify": [[eid(i), s["start"], [t for t in NUMBER_TOKEN.findall(s["text"]) if NUMERAL.search(t)]]
                              for i, s in enumerate(segs) if NUMERAL.search(s["text"])],
    }
    return {k: ([eid(i) for i in v] if k in BAD_SPAN + ("repeats",) else v) for k, v in flags.items()}


def norm(text):
    """NFKC and casefold; keeps letters, digits and the signs that change a number (12.5, -5, 12%, 1,000, 4:30)."""
    s, kept = unicodedata.normalize("NFKC", str(text)).casefold(), []
    for i, ch in enumerate(s):
        before, after = s[i - 1:i].isdigit(), s[i + 1:i + 2].isdigit()
        if (ch.isalnum() and ch != "_") or (ch in ".,:/" and before and after) or (ch in "+-" and after) or (ch == "%" and before):
            kept.append(ch)
    return "".join(kept)


def media_checks(b, a, docs):
    """Identity files listed in SHA256SUMS: bytes, container, streams, ceilings, completeness and declared size."""
    ident, receipt, page = (docs.get(k) for k in ("probe/identity.json", "media/receipt.json", "probe/page.json"))
    videos, audios, digests, sums = {}, {}, set(), b / "media/SHA256SUMS"
    if sums.is_file() and (ident or {}).get("extractor_key") != "local":
        check("media", "receipt_present", receipt is not None, "media/receipt.json (only a local file has none)")
    if receipt is not None and ident is not None:
        check("media", "receipt_matches_probe", receipt.get("id") == ident.get("id"))
    formats = {str(f.get("format_id")): f for f in (receipt or {}).get("requested_formats") or [receipt or {}] if isinstance(f, dict)}
    declared = (ident or {}).get("duration")
    if page is not None and receipt is not None:  # a generic page or direct file: duration from the page record
        held, found = page_media(page, receipt.get("media_url"))
        check("media", "page_holds_media", held, "probe/page.json holds media/receipt.json media_url")
        declared = declared if number(declared) else found
    for line in sums.read_text().splitlines() if sums.is_file() else []:
        digest, _, name = line.partition("  ")
        if not check("media", "sums_line", HEX64.fullmatch(digest) and re.fullmatch(NAME, name), line[:120]):
            continue
        path = a.media_dir / f"{digest}{Path(name).suffix}"
        digests.add(digest)
        if not check("media", "present:" + name, path.is_file() and not path.is_symlink(), path.name):
            continue
        check("media", "sha256:" + name, sha(path) == digest)
        check("media", "max_bytes:" + name, path.stat().st_size <= CEILING["bytes"], path.stat().st_size)
        info = probe(path)
        kind = info.get("format", {}).get("format_name")
        if not check("media", "container:" + name, kind in CONTAINERS, kind):
            continue  # never decode anything else (concat, hls, text)
        vids, auds = ([s for s in info.get("streams", []) if s.get("codec_type") == t] for t in ("video", "audio"))
        check("media", "one_stream_per_kind:" + name, len(vids) <= 1 and len(auds) <= 1, f"{len(vids)} video, {len(auds)} audio")
        real = [s for s in vids[:1] if not (s.get("disposition") or {}).get("attached_pic")]  # what [0:v:0] decodes
        if real:
            w, h = real[0].get("width") or 0, real[0].get("height") or 0
            check("media", "max_side_pixels:" + name, 0 < w <= CEILING["side"] and 0 < h <= CEILING["side"], f"{w}x{h}")
            check("media", "hd_floor:" + name, min(w, h) >= 720 and w * h >= 1280 * 720, f"{w}x{h}")
            videos[digest] = path
        if auds:
            audios[digest] = path
        tb, pts = packets(path, "v:0" if real else "a:0")
        end = max(pts) * tb[0] / tb[1] if tb and pts else None  # the last packet the demuxer reaches, not the header
        check("media", "duration_ceiling:" + name, end is not None and end <= CEILING["seconds"], end)
        if receipt is None:
            continue  # a local file: nothing was downloaded or declared
        check("media", "not_truncated:" + name, number(declared) and end is not None and end >= declared - 1,
              f"last packet {end} vs {declared if number(declared) else 'undeclared'}")
        fid = re.fullmatch(r"source\.f([^.]+)\.[^.]+", name)
        fid = fid[1] if fid else str(receipt.get("format_id"))
        if check("media", "format_known:" + name, fid in formats, fid) and number(formats[fid].get("filesize")):
            size = path.stat().st_size
            check("media", "exact_size:" + name, size == formats[fid]["filesize"], f"{size} vs {formats[fid]['filesize']}")
    return videos, audios, digests


def asr_checks(docs, audios):
    """The transcript's input is the bundle's audio identity file; returns (segments, indexes flagged unreadable)."""
    doc, run_doc = docs.get("asr/transcript.json") or {}, docs.get("asr/run.json") or {}
    schema = asr_schema(doc)
    check("asr", "schema_known", schema, "whisper keys (segments with compression_ratio, words with word/probability)")
    segs = doc["segments"] if schema else []
    check("asr", "transcript_nonempty", doc.get("language") and segs)
    model, versions, lang = (run_doc.get(k) if isinstance(run_doc.get(k), d) else d() for k, d in
                             (("model", dict), ("versions", dict), ("detected_language", str)))
    check("asr", "run_identity", HEX64.fullmatch(str(run_doc.get("pcm_sha256"))) and lang and isinstance(run_doc.get("argv"), list)
          and all(model.get(k) for k in ("repo", "revision", "weights_sha256")))
    check("asr", "engine_pinned", (model.get("repo"), model.get("revision"), versions.get("mlx-whisper")) == tuple(ASR.values()),
          f"{model.get('repo')}@{model.get('revision')}, mlx-whisper {versions.get('mlx-whisper')}")
    check("asr", "argv_is_recipe", run_doc.get("argv") == whisper_argv(lang), "transcribe.md argv with detected_language")
    check("asr", "detected_language", lang == doc.get("language"), f"{lang} detected vs {doc.get('language')} transcribed")
    if not check("asr", "input_is_audio_identity_file", len(audios) == 1, f"{len(audios)} audio-bearing identity files"):
        return segs, set()
    pcm_sha, length = pcm(next(iter(audios.values())))  # recompute the ASR input from the identity file
    check("asr", "pcm_recomputed", pcm_sha and pcm_sha == run_doc.get("pcm_sha256"), f"{length:.3f} s")
    if schema != "whisper" or not pcm_sha:
        return segs, set()
    out["flags"].update(asr_flags(segs, length))
    return segs, {int(e[1:]) - 1 for k in BAD_SPAN for e in out["flags"][k]}


def frame_rows(b, a, vsha, videos):
    """frames/<dir>/grid.tsv rows: (n, num, den) -> {decoded, pngs, where}."""
    rows = {}
    check("frames", "has_grid", (b / "frames/grid").is_dir(), "frames/grid, the coverage grid")
    for d in sorted(d for d in b.glob("frames/*") if d.is_dir()):
        grid = [r.split("\t") for r in (d / "grid.tsv").read_text().splitlines() if r] if (d / "grid.tsv").is_file() else []
        check("frames", "has_grid_tsv:" + d.name, grid)
        absent = 0
        for row in grid:
            key, where = exact(row[1]) if len(row) == 4 else None, f"{d.name}/{row[0]}"
            if not check("frames", "row_shape:" + where, key and re.fullmatch(NAME + r"\.png", row[0])
                         and HEX64.fullmatch(row[2]) and HEX64.fullmatch(row[3])):
                continue
            if key in rows:  # the same frame listed in two directories must agree
                check("frames", "rows_agree:" + where, rows[key]["decoded"] == row[2], rows[key]["where"])
            entry = rows.setdefault(key, {"decoded": row[2], "pngs": [], "where": where})
            if (d / row[0]).is_file():
                if check("frames", "png_sha256:" + where, sha(d / row[0]) == row[3]):
                    entry["pngs"].append(d / row[0])
            elif a.restored:
                absent += 1
            else:
                check("frames", "png_present:" + where, False)
        check("frames", "pngs_have_rows:" + d.name, all(p.name in {r[0] for r in grid} for p in d.glob("*.png")))
        out["flags"].setdefault("png_not_retained", {})[d.name] = absent
        keys = [k for k in (exact(r[1]) for r in grid if len(r) == 4) if k]
        if d.name == "grid" and keys:
            tb, pts = packets(videos[vsha], "v:0")
            tail = max(pts) * tb[0] / tb[1] if tb and pts else None
            check("frames", "tail_frame_kept", tail is not None and max(map(seconds, keys)) >= tail - 1e-3, f"last packet {tail}")
            missing = sorted({p * tb[0] // (tb[1] * 6) for p in pts if p >= 0} - {n * num // (den * 6) for n, num, den in keys}) if tb else [0]
            check("frames", "grid_covers_6s", not missing, missing and f"no row in the 6 s from {missing[0] * 6} s ({len(missing)} such)")
    return rows


def crop_rows(b, a, vsha, rows):
    """crops/crops.tsv: file, SHA-256, parent media, parent n*num/den, parent decoded SHA-256, WxH+X+Y (unscaled)."""
    crops, need = {}, {}
    for line in (b / "crops/crops.tsv").read_text().splitlines() if (b / "crops/crops.tsv").is_file() else []:
        row = line.split("\t")
        key, geo = (exact(row[3]), GEOMETRY.fullmatch(row[5])) if len(row) == 6 else (None, None)
        if not check("crops", "row_shape:" + row[0], key and geo and HEX64.fullmatch(row[1]) and re.fullmatch(NAME + r"\.png", row[0])):
            continue
        path = b / "crops" / row[0]
        crops[row[1]] = (key, path if path.is_file() else None)
        if crops[row[1]][1] or not a.restored:
            check("crops", "crop_sha256:" + row[0], crops[row[1]][1] and sha(path) == row[1])
        if check("crops", "parent_is_frame:" + row[0], row[2] == vsha and key in rows and rows[key]["decoded"] == row[4]):
            need.setdefault(key, []).append((tuple(int(g) for g in geo.groups()), row[1]))
    return crops, need


def claims_checks(b, docs, segs, bad, rows, crops, vsha):
    """claims.json {transcript_sha256, claims[]}: claim i is C<i+1>. Returns the frame keys the claims cite."""
    cited, groups = set(), {}
    if not (b / "claims.json").exists():
        return cited
    top, page = docs.get("claims.json") or {}, docs.get("probe/page.json")
    check("cite", "claims_have_media", (b / "media/SHA256SUMS").is_file(), "claims cite a bundle whose media is listed")
    tsha = sha(b / "asr/transcript.json") if (b / "asr/transcript.json").exists() else None
    page_sha = sha(b / "probe/page.json") if page is not None else None
    for i, c in enumerate(top.get("claims") if isinstance(top.get("claims"), list) else []):
        where, c = f"C{i + 1}", c if isinstance(c, dict) else {}
        ev = c.get("evidence") if isinstance(c.get("evidence"), dict) else {}
        named, frames, cut, side = (ev.get(k) if isinstance(ev.get(k), list) else [] for k in ("segments", "frames", "crops", "sidecars"))
        ids = [int(e[1:]) - 1 for e in named if re.fullmatch(r"E\d+", str(e))]
        check("cite", "segments_exist:" + where, len(ids) == len(named) and all(0 <= j < len(segs) for j in ids))
        if ids:
            check("cite", "transcript_bound:" + where, top.get("transcript_sha256") == tsha)
        check("cite", "has_evidence:" + where, ids or frames or cut or side)
        values = [resolve(page, s.get("json_path")) if isinstance(s, dict) and s.get("sha256") == page_sha else MISSING for s in side]
        check("cite", "sidecars_resolve:" + where, MISSING not in values, "{sha256 of probe/page.json, json_path that resolves}")
        pts = []
        for f in frames:
            key = exact(f.get("pts")) if isinstance(f, dict) else None
            if check("cite", f"frame_tuple:{where}:{f.get('pts') if isinstance(f, dict) else f}",
                     key and f.get("media_sha256") == vsha and key in rows and rows[key]["decoded"] == f.get("decoded_sha256"),
                     "must be a {media_sha256, pts, decoded_sha256} row of a frames/*/grid.tsv"):
                cited.add(key)
                pts.append(seconds(key))
        if check("cite", "crops_exist:" + where, all(x in crops and crops[x][1] for x in cut)):
            pts += [seconds(crops[x][0]) for x in cut]
        spans, mode = [segs[j] for j in sorted(set(ids)) if 0 <= j < len(segs)], c.get("explicitness")
        check("cite", "explicitness:" + where, mode in EXPLICITNESS and (mode != "spoken" or ids)
              and (mode != "visible_only" or frames or cut or side), mode)
        lo, hi = (min(s["start"] for s in spans) - 0.5, max(s["end"] for s in spans) + 0.5) if spans else (None, None)
        inside = [p for p in pts if spans and lo <= p <= hi]
        if mode != "visible_only" and pts:
            check("cite", "frame_in_cited_span:" + where, spans and len(inside) == len(pts), f"span {lo}..{hi}, frames {pts}")
        spoken, runs = "".join(s["text"] for s in spans), []
        for j in sorted(set(ids)):  # a quote lies inside one run of consecutive segments, in transcript order
            runs[-1:] = [runs[-1] + [j]] if runs and runs[-1][-1] == j - 1 else runs[-1:] + [[j]]
        if c.get("quote"):
            check("cite", "quote_in_segments:" + where, any(norm(c["quote"]) in norm("".join(segs[j]["text"] for j in r))
                                                          for r in runs if all(0 <= j < len(segs) for j in r)))
        value = "" if c.get("value") is None else str(c["value"])
        if NUMERAL.search(f"{c.get('quote') or spoken} {value}"):
            by_frame = pts if mode == "visible_only" else inside
            check("cite", "number_has_frame_or_label:" + where, by_frame or side or c.get("asr_only") is True,
                  "an in-span frame or crop, a page sidecar, or asr_only")
            tokens = [norm(t) for t in NUMBER_TOKEN.findall(value) if NUMERAL.search(t)]
            if tokens and not by_frame:  # no picture confirms it: the number must be in the speech or the page data
                texts = [norm(json.dumps(v, ensure_ascii=False)) for v in values if v is not MISSING]
                texts += [norm(spoken)] if c.get("asr_only") is True else []
                check("cite", "value_in_evidence:" + where, all(any(t in x for x in texts) for t in tokens), value)
        if bad & set(ids):
            flagged = [f"E{j + 1:03d}" for j in sorted(bad & set(ids))]
            out["flags"].setdefault("claims_citing_flagged", {})[where] = flagged
            check("cite", "flagged_span_limited:" + where, c.get("limitations"), f"{flagged} are flagged; record a limitation")
        if c.get("exclusive_group") is not None:
            groups.setdefault(str(c["exclusive_group"]), []).append(where)
    for name, members in sorted(groups.items()):
        check("cite", "exclusive_group:" + name, len(members) >= 2, members)
    return cited


def body(a):
    b = a.bundle
    entries = [Path(r, n) for r, ds, fs in os.walk(b) for n in ds + fs]  # never follows a link
    special = [p.relative_to(b).as_posix() for p in entries if not (stat.S_ISDIR(p.lstat().st_mode) or stat.S_ISREG(p.lstat().st_mode))]
    if not check("bundle", "regular_files_only", not special, special):
        return  # a link or FIFO could redirect or block every read below
    files = sorted(p for p in entries if p.is_file() and p.relative_to(b).as_posix() != "check.json")
    for stage in ("probe", "media", "asr", "frames", "crops"):
        failed = b / stage / "FAILED"
        out["stages"][stage] = ("failed: " + " ".join(failed.read_text(errors="replace").split())[:300]) if failed.exists() \
            else ("present" if (b / stage).is_dir() else "absent")
    check("bundle", "no_incomplete_stage", not list(b.glob(".stage*")), [p.name for p in b.glob(".stage*")])
    docs = {}
    for p in files:  # the layout is an allowlist: strict JSON, plain PNG or UTF-8 text, nothing else
        rel = p.relative_to(b).as_posix()
        if not check("bundle", "layout:" + rel, LAYOUT.fullmatch(rel)) or p.stat().st_size >= 8 << 20:
            continue
        if p.suffix == ".json":
            docs[rel] = load(p, b)
        elif p.suffix == ".png":
            problem = png_plain(p)
            check("bundle", "png_plain:" + rel, not problem, problem)
        else:
            raw = p.read_bytes()
            check("bundle", "text_file:" + rel, b"\0" not in raw and not raw.decode("utf-8", "replace").count("\ufffd"))
    for rel in sorted(r for r in docs if r.startswith(("probe/", "media/")) or r in ("asr/run.json", "claims.json")) + \
            sorted(p.relative_to(b).as_posix() for p in files if p.name == "FAILED"):
        hit = leaks((b / rel).read_text(errors="replace"), docs.get(rel), rel.endswith("FAILED"))
        check("probe", f"no_signed_url_or_cookie:{rel}", not hit, hit[:3])
    ident = docs.get("probe/identity.json")
    if check("probe", "identity_present", ident is not None, "probe/identity.json"):
        check("probe", "identity_keys", all(ident.get(k) for k in ("id", "webpage_url", "extractor_key")))
        check("probe", "single_finite_video", ident.get("_type", "video") == "video" and ident.get("live_status") in (None, "not_live", "was_live")
              and (not re.search(r"_p\d+$", str(ident.get("id"))) or re.search(r"[?&]p=\d+", str(ident.get("webpage_url")))))
        if ident.get("extractor_key") in ("Generic", "HTML5MediaEmbed"):
            urls = [ident.get("webpage_url"), (docs.get("media/receipt.json") or {}).get("media_url")]
            check("probe", "public_https_host", all(public_https(u) for u in urls if u), "HTTPS on 443 to a public name")
    videos, audios, digests = media_checks(b, a, docs)
    segs, bad = asr_checks(docs, audios) if (b / "asr/transcript.json").exists() else ([], set())
    vsha = next(iter(videos)) if len(videos) == 1 else None  # frames bind to the bundle's single video identity file
    if any(d.is_dir() for d in b.glob("frames/*")):
        check("frames", "bound_to_video_identity", vsha, f"{len(videos)} video identity files in SHA256SUMS")
    rows = frame_rows(b, a, vsha, videos) if vsha else {}
    crops, crop_need = crop_rows(b, a, vsha, rows)
    cited = claims_checks(b, docs, segs, bad, rows, crops, vsha)
    for key in sorted(cited | set(crop_need)):
        check("frames", f"png_present:cited@{key[0]}*{key[1]}/{key[2]}", rows[key]["pngs"], rows[key]["where"])
    must = cited | set(crop_need)
    if rows:  # plus the first and last grid rows and at least 3 rows sampled deterministically from the media hash
        keys = sorted(rows, key=seconds)
        grid = [k for k in keys if rows[k]["where"].startswith("grid/")] or keys
        must |= {grid[0], grid[-1]} | {keys[int(vsha[8 * i:8 * i + 8], 16) % len(keys)] for i in range(min(max(a.recompute, 3), 8))}
    for key in sorted(must):
        need = crop_need.get(key, [])
        got = frame_hashes(videos[vsha], key, [g for g, _ in need])
        check("frames", f"recomputed:{vsha[:12]}@{key[0]}*{key[1]}/{key[2]}", got and got[0] == rows[key]["decoded"], rows[key]["where"])
        for png in rows[key]["pngs"]:
            check("frames", f"png_pixels:{png.parent.name}/{png.name}", got and png_rgb(png) == got[1])
        for i, (_, crop_sha) in enumerate(need):
            if crops[crop_sha][1]:
                check("crops", "crop_pixels:" + crops[crop_sha][1].name, got and png_rgb(crops[crop_sha][1]) == got[i + 2])
    out["files"] = [{"path": p.relative_to(b).as_posix(), "sha256": sha(p), "bytes": p.stat().st_size} for p in files]
    big = [f["path"] for f in out["files"] if f["sha256"] in digests or f["bytes"] >= 8 << 20]
    check("retain", "no_media_or_large_file_in_bundle", not big, big)


def main():
    class Args(argparse.ArgumentParser):
        def error(self, message):
            print(json.dumps({"ok": False, "checks": [{"stage": "checker", "check": "usage", "ok": False, "detail": message}]}))
            sys.exit(2)
    ap = Args(description=__doc__.split("\n")[0])
    ap.add_argument("bundle", type=Path)
    ap.add_argument("--media-dir", type=Path, required=True)
    ap.add_argument("--recompute", type=int, default=3)
    ap.add_argument("--restored", action="store_true")
    a = ap.parse_args()
    raw = Path(__file__).read_bytes()
    out.update(checker_sha256=hashlib.sha256(raw).hexdigest(),
               checker_git_blob=hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest())
    try:  # the build that recomputed the frames, and which executables PATH resolved
        tools = [shutil.which(t) for t in ("ffmpeg", "ffprobe")]
        out["ffmpeg"] = run(["ffmpeg", "-version"]).split("\n")[0] + "; sha256 " + ", ".join(
            f"{t} {sha(p)[:16] if p else 'missing'}" for t, p in zip(("ffmpeg", "ffprobe"), tools))
        body(a)
    except Exception as error:  # a named failure, never a traceback
        check("checker", "internal_error", False, f"{type(error).__name__}: {error}"[:300])
    out["ok"] = all(c["ok"] for c in out["checks"])
    print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
