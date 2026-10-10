"""Recompute a video evidence bundle's identity bindings from its bytes; print JSON; exit 1 on any failed check.

usage: python3 -I check_bundle.py BUNDLE --media-dir DIR [--recompute K] [--restored]
Writes nothing and imports nothing from this repository; needs ffmpeg and ffprobe on PATH. Layout and checks:
services/video-evidence/README.md. "checks" decide "ok" (identity and hash binding, recomputation from the bytes);
"flags" are ASR heuristics for a reader and never decide "ok". --restored accepts grid rows whose uncited PNG
was not retained (those rows are still recomputed by sample).
"""
import argparse, hashlib, json, re, subprocess, sys, threading, unicodedata
from pathlib import Path

TIMEOUT = 600  # seconds per subprocess
FF = ["-hide_banner", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe"]
LEAK = re.compile(r'[?&/](ip|oi|mid|buvid|upsig|sig|expire)[=/]|"(http_headers|cookies?)"\s*:|cookie:\s', re.I)
CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"}
MEDIA_EXT = {".mp4", ".m4a", ".m4v", ".mov", ".webm", ".mkv", ".ts", ".flv", ".3gp", ".wav", ".mp3", ".aac", ".flac", ".opus"}
NUMERAL = re.compile(r"\d|[〇零二两三四五六七八九十百千万亿]|一[点十百千万]|[十百千万]一")
NUMBER_TOKEN = re.compile(r"\d[\d.,:%]*|[〇零一二两三四五六七八九十百千万亿点]+")
BAD_SPAN = ("loops", "too_dense", "too_sparse", "empty_or_outside")
BANNED_ASR_FLAGS = ("--initial-prompt", "--hallucination-silence-threshold", "--clip-timestamps")
EXPLICITNESS = ("spoken", "visible_only", "inferred")
MAX_SIDE = 8192  # the retired service's source ceilings: side 8192, pixels 8192 * 8192
HEX64 = re.compile(r"[0-9a-f]{64}")
GEOMETRY = re.compile(r"(\d+)x(\d+)\+(\d+)\+(\d+)")
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
    """Strict JSON, as the retired service read it: duplicate keys and NaN/Infinity are refused."""
    def pairs(items):
        if len({k for k, _ in items}) != len(items):
            raise ValueError("duplicate key")
        return dict(items)

    def constant(name):
        raise ValueError("non-finite number " + name)
    try:
        value = json.loads(path.read_text(), object_pairs_hook=pairs, parse_constant=constant)
        if isinstance(value, dict):
            return value
        raise ValueError("not an object")
    except (OSError, ValueError, UnicodeDecodeError) as error:
        check("bundle", f"readable_json:{path.relative_to(b)}", False, str(error)[:200])
        return {}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def exact(value):
    """'n*num/den' -> (n, num, den); None when malformed."""
    m = re.fullmatch(r"(-?\d+)\*(\d+)/(\d+)", str(value).strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m and int(m[2]) and int(m[3]) else None


def seconds(key):
    return key[0] * key[1] / key[2]


def probe(path):
    text = run(["ffprobe", *FF[2:], "-show_entries", "format=format_name,duration:stream=codec_type,width,height",
                "-of", "json", str(path)])
    try:
        return json.loads(text or "{}")
    except ValueError:
        return {}


def last_pts(path):
    rows = run(["ffprobe", *FF[2:], "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0",
                str(path)]).split()
    return max((float(r.strip(",")) for r in rows if r.strip(",") not in ("", "N/A")), default=None)


def framehash_rows(text):
    return [r.replace(" ", "").split(",") for r in text.splitlines() if r and not r.startswith("#")]


def frame_hashes(path, key, geometries):
    """One decode at key: [decoded-frame hash, its rgb24 hash, rgb24 hash per crop]; None if no frame has that pts."""
    sel = f"select='gte(t\\,{seconds(key) - 0.0005:.6f})',trim=end_frame=1"
    chains = [f"[0:v:0]{sel}[o0]", f"[0:v:0]{sel},format=rgb24[o1]"]  # separate chains keep the decoder's format
    chains += [f"[0:v:0]{sel},format=rgb24,crop={w}:{h}:{x}:{y}[o{i + 2}]" for i, (w, h, x, y) in enumerate(geometries)]
    maps = [arg for i in range(len(chains)) for arg in ("-map", f"[o{i}]")]
    text = run(["ffmpeg", *FF, "-ss", f"{max(0.0, seconds(key) - 1):.6f}", "-t", "2", "-copyts", "-i", str(path), "-an",
                "-filter_complex", ";".join(chains), *maps, "-fps_mode", "passthrough", "-enc_time_base", "demux",
                "-c:v", "rawvideo", "-f", "framehash", "-hash", "sha256", "-"])
    tb = re.search(r"#tb 0: (\d+)/(\d+)", text)
    rows = {int(r[0]): r for r in framehash_rows(text)}
    if not tb or 0 not in rows or int(rows[0][2]) * int(tb[1]) * key[2] != key[0] * key[1] * int(tb[2]):
        return None
    return [rows[i][5] if i in rows else None for i in range(len(chains))]


def png_rgb(path):
    rows = framehash_rows(run(["ffmpeg", *FF, "-i", str(path), "-map", "0:v:0", "-pix_fmt", "rgb24", "-c:v", "rawvideo",
                               "-f", "framehash", "-hash", "sha256", "-"]))
    return rows[0][5] if len(rows) == 1 else None


def pcm(path):
    """SHA-256 and seconds of the 16 kHz mono s16le PCM that the ASR recipe feeds the engine, streamed."""
    proc = subprocess.Popen(["ffmpeg", *FF, "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
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
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", str(text)).casefold())


def media_checks(b, a, ident):
    """Identity files listed in SHA256SUMS: bytes, container, ceilings, completeness and declared size."""
    videos, audios, digests = {}, {}, set()
    receipt = load(b / "media/receipt.json", b) if (b / "media/receipt.json").exists() else None
    if receipt is not None and ident is not None:
        check("media", "receipt_matches_probe", all(receipt.get(k) == ident.get(k) for k in ("id", "webpage_url")))
    formats = {str(f.get("format_id")): f for f in (receipt or {}).get("requested_formats") or [receipt or {}] if isinstance(f, dict)}
    page = (receipt or {}).get("declared")  # generic pages only: a duration the page itself declares
    declared = (ident or {}).get("duration") or (page.get("duration") if isinstance(page, dict) else None)
    sums = b / "media/SHA256SUMS"
    for line in sums.read_text().splitlines() if sums.is_file() else []:
        digest, _, name = line.partition("  ")
        if not check("media", "sums_line", HEX64.fullmatch(digest) and name and "/" not in name, line[:120]):
            continue
        path = a.media_dir / f"{digest}{Path(name).suffix}"
        digests.add(digest)
        if not check("media", "present:" + name, path.is_file() and not path.is_symlink(), path.name):
            continue
        check("media", "sha256:" + name, sha(path) == digest)
        info = probe(path)
        kind = info.get("format", {}).get("format_name")
        if not check("media", "container:" + name, kind in CONTAINERS, kind):
            continue  # never decode anything else (concat, hls, text)
        streams = {s.get("codec_type"): s for s in info.get("streams", [])}
        if "video" in streams:
            w, h = streams["video"].get("width") or 0, streams["video"].get("height") or 0
            check("media", "max_side_pixels:" + name, 0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE, f"{w}x{h}")
            check("media", "hd_floor:" + name, min(w, h) >= 720 and w * h >= 1280 * 720, f"{w}x{h}")
            videos[digest] = path
        if "audio" in streams:
            audios[digest] = path
        if receipt is None:
            continue  # a local file: nothing was downloaded or declared
        length = float(info.get("format", {}).get("duration") or 0)
        check("media", "not_truncated:" + name, number(declared) and length >= declared - 1, f"{length} vs {declared or 'undeclared'}")
        fid = re.fullmatch(r"source\.f([^.]+)\.[^.]+", name)
        fid = fid[1] if fid else str(receipt.get("format_id"))
        if check("media", "format_known:" + name, fid in formats, fid) and number(formats[fid].get("filesize")):
            size = path.stat().st_size
            check("media", "exact_size:" + name, size == formats[fid]["filesize"], f"{size} vs {formats[fid]['filesize']}")
    return videos, audios, digests


def asr_checks(b, audios):
    """The transcript's input is the bundle's audio identity file; returns (segments, indexes flagged unreadable)."""
    doc, run_doc = load(b / "asr/transcript.json", b), load(b / "asr/run.json", b)
    schema = asr_schema(doc)
    check("asr", "schema_known", schema, "whisper keys (segments with compression_ratio, words with word/probability)")
    segs = doc["segments"] if schema else []
    check("asr", "transcript_nonempty", doc.get("language") and segs)
    argv, model = run_doc.get("argv"), run_doc.get("model")
    check("asr", "run_identity", HEX64.fullmatch(str(run_doc.get("pcm_sha256"))) and isinstance(run_doc.get("detected_language"), str)
          and isinstance(run_doc.get("versions"), dict) and isinstance(model, dict) and all(model.get(k) for k in ("repo", "revision", "weights_sha256"))
          and isinstance(argv, list) and argv and all(isinstance(x, str) for x in argv))
    banned = [x for x in argv or [] if str(x).split("=")[0] in BANNED_ASR_FLAGS]
    check("asr", "argv_allowed", not banned, banned)
    check("asr", "detected_language", run_doc.get("detected_language") == doc.get("language"),
          f"{run_doc.get('detected_language')} detected vs {doc.get('language')} transcribed")
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
    for d in sorted(d for d in b.glob("frames/*") if d.is_dir()):
        grid = [r.split("\t") for r in (d / "grid.tsv").read_text().splitlines() if r] if (d / "grid.tsv").is_file() else []
        check("frames", "has_grid_tsv:" + d.name, grid)
        absent = 0
        for row in grid:
            key, where = exact(row[1]) if len(row) == 4 else None, f"{d.name}/{row[0]}"
            if not check("frames", "row_shape:" + where, key and HEX64.fullmatch(row[2]) and HEX64.fullmatch(row[3])):
                continue
            if key in rows:  # the same frame listed in two directories must agree
                check("frames", "rows_agree:" + where, rows[key]["decoded"] == row[2], rows[key]["where"])
            entry = rows.setdefault(key, {"decoded": row[2], "pngs": [], "where": where})
            if (d / row[0]).is_file() and not (d / row[0]).is_symlink():
                if check("frames", "png_sha256:" + where, sha(d / row[0]) == row[3]):
                    entry["pngs"].append(d / row[0])
            elif a.restored:
                absent += 1
            else:
                check("frames", "png_present:" + where, False)
        check("frames", "pngs_have_rows:" + d.name, all(p.name in {r[0] for r in grid} for p in d.glob("*.png")))
        out["flags"].setdefault("png_not_retained", {})[d.name] = absent
        ends = [seconds(k) for k in (exact(r[1]) for r in grid if len(r) == 4) if k]
        if d.name == "grid" and ends:
            tail = last_pts(videos[vsha])
            check("frames", "tail_frame_kept", tail is not None and max(ends) >= tail - 1e-3, f"last packet {tail}")
    return rows


def crop_rows(b, a, vsha, rows):
    """crops/crops.tsv: file, SHA-256, parent media, parent n*num/den, parent decoded SHA-256, WxH+X+Y (unscaled)."""
    crops, need = {}, {}
    for line in (b / "crops/crops.tsv").read_text().splitlines() if (b / "crops/crops.tsv").is_file() else []:
        row = line.split("\t")
        key, geo = (exact(row[3]), GEOMETRY.fullmatch(row[5])) if len(row) == 6 else (None, None)
        if not check("crops", "row_shape:" + row[0], key and geo and HEX64.fullmatch(row[1])):
            continue
        path = b / "crops" / row[0]
        crops[row[1]] = (key, path if path.is_file() and not path.is_symlink() else None)
        if crops[row[1]][1] or not a.restored:
            check("crops", "crop_sha256:" + row[0], crops[row[1]][1] and sha(path) == row[1])
        if check("crops", "parent_is_frame:" + row[0], row[2] == vsha and key in rows and rows[key]["decoded"] == row[4]):
            need.setdefault(key, []).append((tuple(int(g) for g in geo.groups()), row[1]))
    return crops, need


def claims_checks(b, segs, bad, rows, crops, vsha):
    """claims.json {transcript_sha256, claims[]}: claim i is C<i+1>. Returns the frame keys the claims cite."""
    cited, groups = set(), {}
    if not (b / "claims.json").exists():
        return cited
    top = load(b / "claims.json", b)
    tsha = sha(b / "asr/transcript.json") if (b / "asr/transcript.json").exists() else None
    probe_files = {sha(p) for p in b.glob("probe/*.json")}
    for i, c in enumerate(top.get("claims") if isinstance(top.get("claims"), list) else []):
        where, c = f"C{i + 1}", c if isinstance(c, dict) else {}
        ev = c.get("evidence") if isinstance(c.get("evidence"), dict) else {}
        named, frames, cut, side = (ev.get(k) if isinstance(ev.get(k), list) else [] for k in ("segments", "frames", "crops", "sidecars"))
        ids = [int(e[1:]) - 1 for e in named if re.fullmatch(r"E\d+", str(e))]
        check("cite", "segments_exist:" + where, len(ids) == len(named) and all(0 <= j < len(segs) for j in ids))
        if ids:
            check("cite", "transcript_bound:" + where, top.get("transcript_sha256") == tsha)
        check("cite", "has_evidence:" + where, ids or frames or cut or side)
        check("cite", "sidecars_exist:" + where, all(isinstance(s, dict) and s.get("sha256") in probe_files and s.get("json_path") for s in side))
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
        spans, mode = [segs[j] for j in ids if 0 <= j < len(segs)], c.get("explicitness")
        check("cite", "explicitness:" + where, mode in EXPLICITNESS and (mode != "spoken" or ids)
              and (mode != "visible_only" or frames or cut or side), mode)
        lo, hi = (min(s["start"] for s in spans) - 0.5, max(s["end"] for s in spans) + 0.5) if spans else (None, None)
        inside = [p for p in pts if spans and lo <= p <= hi]
        if mode != "visible_only" and pts:
            check("cite", "frame_in_cited_span:" + where, spans and len(inside) == len(pts), f"span {lo}..{hi}, frames {pts}")
        spoken = "".join(s["text"] for s in spans)
        if c.get("quote"):
            check("cite", "quote_in_segments:" + where, norm(c["quote"]) in norm(spoken))
        if NUMERAL.search(f"{c.get('quote') or spoken} {c.get('value') or ''}"):
            confirming = (pts if mode == "visible_only" else inside) or side or c.get("asr_only") is True
            check("cite", "number_has_frame_or_label:" + where, confirming, "an in-span frame or crop, a sidecar, or asr_only")
        if bad & set(ids):
            out["flags"].setdefault("claims_citing_flagged", {})[where] = [f"E{j + 1:03d}" for j in sorted(bad & set(ids))]
        if c.get("exclusive_group") is not None:
            groups.setdefault(str(c["exclusive_group"]), []).append(where)
    for name, members in sorted(groups.items()):
        check("cite", "exclusive_group:" + name, len(members) >= 2, members)
    return cited


def body(a):
    b = a.bundle
    for stage in ("probe", "media", "asr", "frames", "crops"):
        failed = b / stage / "FAILED"
        out["stages"][stage] = ("failed: " + failed.read_text(errors="replace").strip()[:300]) if failed.exists() \
            else ("present" if (b / stage).is_dir() else "absent")
    check("bundle", "no_incomplete_stage", not list(b.glob(".stage*")), [p.name for p in b.glob(".stage*")])
    ident = load(b / "probe/identity.json", b) if (b / "probe/identity.json").exists() else None
    if check("probe", "identity_present", ident is not None, "probe/identity.json"):
        check("probe", "identity_keys", all(ident.get(k) for k in ("id", "webpage_url", "extractor_key")))
        check("probe", "single_finite_video", ident.get("_type", "video") == "video" and ident.get("live_status") in (None, "not_live", "was_live")
              and (not re.search(r"_p\d+$", str(ident.get("id"))) or re.search(r"[?&]p=\d+", str(ident.get("webpage_url")))))
    for f in sorted({*b.glob("probe/*.json"), *b.glob("media/*.json"), *b.glob("asr/run.json"), *b.glob("*/FAILED")}):
        hit = LEAK.search(f.read_text(errors="replace"))
        check("probe", f"no_signed_url_or_cookie:{f.parent.name}/{f.name}", not hit, hit and hit.group(0))
    videos, audios, digests = media_checks(b, a, ident)
    segs, bad = asr_checks(b, audios) if (b / "asr/transcript.json").exists() else ([], set())
    vsha = next(iter(videos)) if len(videos) == 1 else None  # frames bind to the bundle's single video identity file
    if any(d.is_dir() for d in b.glob("frames/*")):
        check("frames", "bound_to_video_identity", vsha, f"{len(videos)} video identity files in SHA256SUMS")
    rows = frame_rows(b, a, vsha, videos) if vsha else {}
    crops, crop_need = crop_rows(b, a, vsha, rows)
    cited = claims_checks(b, segs, bad, rows, crops, vsha)
    for key in sorted(cited | set(crop_need)):
        check("frames", f"png_present:cited@{key[0]}*{key[1]}/{key[2]}", rows[key]["pngs"], rows[key]["where"])
    must = cited | set(crop_need)
    if rows:  # plus the first and last grid rows and a sample chosen by the media hash, not by the author
        keys = sorted(rows, key=seconds)
        grid = [k for k in keys if rows[k]["where"].startswith("grid/")] or keys
        must |= {grid[0], grid[-1]} | {keys[int(vsha[8 * i:8 * i + 8], 16) % len(keys)] for i in range(min(a.recompute, 8))}
    for key in sorted(must):
        need = crop_need.get(key, [])
        got = frame_hashes(videos[vsha], key, [g for g, _ in need])
        check("frames", f"recomputed:{vsha[:12]}@{key[0]}*{key[1]}/{key[2]}", got and got[0] == rows[key]["decoded"], rows[key]["where"])
        for png in rows[key]["pngs"]:
            check("frames", f"png_pixels:{png.parent.name}/{png.name}", got and png_rgb(png) == got[1])
        for i, (_, crop_sha) in enumerate(need):
            if crops[crop_sha][1]:
                check("crops", "crop_pixels:" + crops[crop_sha][1].name, got and png_rgb(crops[crop_sha][1]) == got[i + 2])
    files = sorted(p for p in b.rglob("*") if p.name != "check.json")
    check("bundle", "no_symlink", not [p for p in files if p.is_symlink()], [str(p.relative_to(b)) for p in files if p.is_symlink()])
    out["files"] = [{"path": str(p.relative_to(b)), "sha256": sha(p), "bytes": p.stat().st_size}
                    for p in files if p.is_file() and not p.is_symlink()]
    big = [f["path"] for f in out["files"] if f["sha256"] in digests or f["bytes"] >= 8 << 20 or Path(f["path"]).suffix.lower() in MEDIA_EXT]
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
    try:
        out["ffmpeg"] = run(["ffmpeg", "-version"]).split("\n")[0]
        body(a)
    except Exception as error:  # a named failure, never a traceback
        check("checker", "internal_error", False, f"{type(error).__name__}: {error}"[:300])
    out["ok"] = all(c["ok"] for c in out["checks"])
    print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
