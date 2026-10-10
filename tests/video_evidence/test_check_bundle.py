"""If this fails, the video evidence checker no longer binds frames, crops, ASR input or citations to the media bytes."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "services/video-evidence/check_bundle.py"
RECEIPT_JQ = ROOT / ".agents/skills/video-evidence/assets/receipt.jq"
FF = ["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y"]
MODEL = "mlx-community/whisper-large-v3-mlx@49e6aa286ad60c14352c404340ded53710378a11"
ARGV = ["mlx_whisper", "audio.wav", "--model", MODEL, "--language", "zh", "--task", "transcribe", "--temperature", "0",
        "--condition-on-previous-text", "False", "--word-timestamps", "True", "--output-format", "json", "--output-dir", ".",
        "--output-name", "transcript", "--verbose", "False"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frames(src, out, select, count=None):
    """The skill's frame recipe: PNGs plus decoded-frame hashes with true pts, then grid.tsv (file, pts, decoded, png)."""
    out.mkdir(parents=True)
    limit = ["-frames:v", str(count)] if count else []
    subprocess.run([*FF, "-copyts", "-i", str(src), "-an", "-filter_complex", f"[0:v:0]select='{select}',split=2[p][h]",
                    "-map", "[p]", "-fps_mode", "passthrough", *limit, str(out / "f_%04d.png"), "-map", "[h]", "-fps_mode",
                    "passthrough", *limit, "-enc_time_base:v", "demux", "-f", "framehash", "-hash", "sha256",
                    str(out / "framehash.txt")], check=True)
    lines = (out / "framehash.txt").read_text().splitlines()
    tb = next(line for line in lines if line.startswith("#tb")).split(": ")[1]
    rows = [r.replace(" ", "").split(",") for r in lines if not r.startswith("#")]
    (out / "framehash.txt").unlink()
    grid = [f"f_{i:04d}.png\t{r[2]}*{tb}\t{r[5]}\t{sha(out / f'f_{i:04d}.png')}" for i, r in enumerate(rows, 1)]
    (out / "grid.tsv").write_text("\n".join(grid) + "\n")
    return [row.split("\t") for row in grid]


def edit_json(path, change):
    doc = json.loads(path.read_text())
    change(doc)
    path.write_text(json.dumps(doc, ensure_ascii=False))


def rebind(b):
    """Claims follow an edited transcript, as an author would."""
    edit_json(b / "claims.json", lambda d: d.update(transcript_sha256=sha(b / "asr/transcript.json")))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe")
class CheckBundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        video, audio, media = cls.tmp / "v.mp4", cls.tmp / "a.m4a", cls.tmp / "media"
        subprocess.run([*FF, "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=10:duration=13", "-f", "lavfi", "-i",
                        "sine=frequency=440:duration=13", "-map", "0:v", "-c:v", "mpeg4", "-q:v", "8", str(video),
                        "-map", "1:a", "-c:a", "aac", str(audio)], check=True)
        cls.vsha, cls.asha = sha(video), sha(audio)
        media.mkdir()
        shutil.copy(video, media / f"{cls.vsha}.mp4")
        shutil.copy(audio, media / f"{cls.asha}.m4a")
        b = cls.bundle = cls.tmp / "bundle"
        for d in ("probe", "media", "asr", "crops"):
            (b / d).mkdir(parents=True)
        (b / "probe/identity.json").write_text(json.dumps({"_type": "video", "id": "synthetic01", "extractor_key": "Youtube",
                                                           "webpage_url": "https://www.youtube.com/watch?v=synthetic01",
                                                           "title": "How to set a Cookie: header /ip=1", "duration": 13}))
        cls.info = {"id": "synthetic01", "extractor_key": "Youtube", "format_id": "137+140", "protocol": "https+https",
                    "_version": {"version": "2026.08.19"}, "url": None, "formats": [
                        {"format_id": "136", "protocol": "https", "filesize": 1, "url": "https://cdn.example/v?ip=203.0.113.7"},
                        {"format_id": "137", "protocol": "https", "filesize": video.stat().st_size, "url": "https://cdn.example/v?sig=1"},
                        {"format_id": "140", "protocol": "https", "filesize": audio.stat().st_size, "url": "https://cdn.example/a?sig=2"}]}
        (b / "media/receipt.json").write_text(json.dumps({"id": "synthetic01", "format_id": "137+140", "requested_formats": [
            {"format_id": "137", "protocol": "https", "filesize": video.stat().st_size},
            {"format_id": "140", "protocol": "https", "filesize": audio.stat().st_size}]}))
        (b / "media/SHA256SUMS").write_text(f"{cls.vsha}  source.f137.mp4\n{cls.asha}  source.f140.m4a\n")
        last = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of",
                               "csv=p=0", str(video)], capture_output=True, text=True).stdout.split()
        cls.grid = frames(video, b / "frames/grid", f"isnan(prev_t)+gt(floor(t/1)\\,floor(prev_t/1))+gte(t\\,{max(map(float, last)) - 0.0005})")
        x = "(isnan(prev_t)+lt(prev_t\\,{0}))*gte(t\\,{0})"
        cls.bracket = frames(video, b / "frames/t0001500", "+".join(x.format(t) for t in (1.4, 1.5, 1.6)), count=3)
        parent = cls.grid[3]  # t = 3.0 s
        subprocess.run([*FF, "-i", str(b / "frames/grid" / parent[0]), "-vf", "crop=320:180:40:60", "-update", "1",
                        str(b / "crops/c1.png")], check=True)
        (b / "crops/crops.tsv").write_text("\t".join(["c1.png", sha(b / "crops/c1.png"), cls.vsha, parent[1], parent[2], "320x180+40+60"]) + "\n")
        pcm = subprocess.run([*FF, "-i", str(audio), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
        segment = lambda start, end, text: {"start": start, "end": end, "text": text, "compression_ratio": 1.1,
                                            "words": [{"word": text, "start": start, "end": end, "probability": 0.9}]}
        (b / "asr/transcript.json").write_text(json.dumps({"language": "zh", "segments": [
            segment(1.0, 2.0, "price 52.8"), segment(2.0, 3.5, "在四小时图上"), segment(3.5, 3.9, "不会")]}, ensure_ascii=False))
        (b / "asr/run.json").write_text(json.dumps({
            "pcm_sha256": hashlib.sha256(pcm).hexdigest(), "detected_language": "zh", "versions": {"mlx-whisper": "0.4.3"},
            "model": {"repo": MODEL.split("@")[0], "revision": MODEL.split("@")[1], "weights_sha256": "1" * 64}, "argv": ARGV}))
        frame = cls.bracket[1]  # t = 1.5 s
        claims = [{"quote": "52.8", "explicitness": "spoken", "evidence": {"segments": ["E001"], "frames": [
                       {"media_sha256": cls.vsha, "pts": frame[1], "decoded_sha256": frame[2]}]}},
                  {"quote": "四小时", "explicitness": "spoken", "evidence": {"segments": ["E002"], "crops": [sha(b / "crops/c1.png")]}}]
        (b / "claims.json").write_text(json.dumps({"transcript_sha256": sha(b / "asr/transcript.json"), "claims": claims},
                                                  ensure_ascii=False))
        cls.generic = cls.variant(cls, lambda g: (
            edit_json(g / "probe/identity.json", lambda d: (d.update(extractor_key="HTML5MediaEmbed", id="a1B2c3D4-1",
                                                                     webpage_url="https://www.example.org/chart/a1B2c3D4/"), d.pop("duration"))),
            edit_json(g / "media/receipt.json", lambda d: d.update(id="a1B2c3D4-1", media_url="https://cdn.example.org/1/a%20b.mp4")),
            (g / "probe/page.json").write_text(json.dumps({"created_at": "2025-06-09T04:15:43+00:00", "video": {
                "video_filename": "https://cdn.example.org/1/a b.mp4?x=1", "duration": "PT13S"}, "related": [{"video": {
                    "video_filename": "https://cdn.example.org/1/other.mp4", "video_duration": 506.0}}]}))))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_checker(self, bundle, *extra, media=None):
        done = subprocess.run([sys.executable, "-I", str(CHECKER), str(bundle), "--media-dir", str(media or self.tmp / "media"), *extra],
                              capture_output=True, timeout=120)
        self.assertEqual(done.stderr, b"")
        return done.returncode, done.stdout

    def failed(self, bundle, *extra, media=None):
        rc, stdout = self.run_checker(bundle, *extra, media=media)
        return rc, {c["check"].split(":")[0] for c in json.loads(stdout)["checks"] if not c["ok"]}

    def in_parallel(self, calls):
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            return list(pool.map(lambda call: call(), calls))

    def variant(self, edit, base=None):
        copy = Path(tempfile.mkdtemp(dir=self.tmp)) / "bundle"
        shutil.copytree(base or self.bundle, copy)
        edit(copy)
        return copy

    def media_with(self, name, make):
        """A media directory holding the test media plus one more file, named by its SHA-256."""
        media = self.tmp / f"media-{name}"
        if not media.exists():
            shutil.copytree(self.tmp / "media", media)
            path = make(media / "new")
            path.rename(media / f"{sha(path)}{path.suffix}")
        return media, next(p for p in media.iterdir() if p.stem not in (self.vsha, self.asha))

    def truncated_mkv(self, path):
        """A Matroska file whose header still says 13 s but whose packets stop near 6 s, as a broken resume leaves."""
        full = path.with_suffix(".full.mkv")
        subprocess.run([*FF, "-i", str(self.tmp / "v.mp4"), "-c", "copy", str(full)], check=True)
        path.with_suffix(".mkv").write_bytes(full.read_bytes()[:full.stat().st_size // 2])
        full.unlink()
        return path.with_suffix(".mkv")

    def test_clean_bundles_pass_byte_identically(self):
        first, second, generic = self.in_parallel([lambda: self.run_checker(self.bundle)] * 2 + [lambda: self.run_checker(self.generic)])
        self.assertEqual(first[0], 0, [c for c in json.loads(first[1])["checks"] if not c["ok"]])
        self.assertEqual(first, second)
        self.assertEqual(generic[0], 0, [c for c in json.loads(generic[1])["checks"] if not c["ok"]])

    @unittest.skipUnless(shutil.which("jq"), "needs jq")
    def test_receipt_projection_of_a_cleaned_info_json_binds_part_sizes(self):
        info = self.tmp / "source.info.json"  # yt-dlp's --write-info-json drops requested_formats
        info.write_text(json.dumps(self.info))
        receipt = subprocess.run(["jq", "-f", str(RECEIPT_JQ), str(info)], capture_output=True, text=True, check=True).stdout
        self.assertNotIn("cdn.example", receipt)
        bundle = self.variant(lambda b: (b / "media/receipt.json").write_text(receipt))
        rc, stdout = self.run_checker(bundle)
        checks = {c["check"]: c["ok"] for c in json.loads(stdout)["checks"]}
        self.assertEqual(rc, 0)
        self.assertTrue(checks["exact_size:source.f137.mp4"] and checks["exact_size:source.f140.m4a"])

    def test_tampering_fails_on_the_named_check(self):
        last, bracket, crop = self.grid[-1], self.bracket[1], sha(self.bundle / "crops/c1.png")
        replace = lambda rel, old, new: lambda b: (b / rel).write_text((b / rel).read_text().replace(old, new))
        claim = lambda i, change: lambda b: edit_json(b / "claims.json", lambda d: change(d["claims"][i]))
        speech = lambda i, text: lambda b: (edit_json(b / "asr/transcript.json", lambda d: d["segments"][i].update(text=text)), rebind(b))
        run_json = lambda change: lambda b: edit_json(b / "asr/run.json", change)
        both = lambda *edits: lambda b: [edit(b) for edit in edits]
        concat, concat_file = self.media_with("concat", lambda p: (p.with_suffix(".mp4").write_text(
            f"ffconcat version 1.0\nfile {self.vsha}.mp4\n"), p.with_suffix(".mp4"))[1])
        cut, cut_file = self.media_with("cut", self.truncated_mkv)
        two, two_file = self.media_with("twotrack", lambda p: (subprocess.run([*FF, "-i", str(self.tmp / "v.mp4"), "-f", "lavfi", "-i",
            "testsrc=size=1280x720:rate=10:duration=13", "-map", "0:v", "-map", "1:v", "-c:v", "mpeg4", str(p.with_suffix(".mp4"))],
            check=True), p.with_suffix(".mp4"))[1])
        mp4_bytes = (self.tmp / "v.mp4").read_bytes()

        def payload_png(b):  # a cited PNG carrying the audio identity file in a private chunk
            png = b / "frames/t0001500" / bracket[0]
            raw, data = png.read_bytes(), b"prVt" + (self.tmp / "a.m4a").read_bytes()
            chunk = struct.pack(">I", len(data) - 4) + data + struct.pack(">I", zlib.crc32(data))
            png.write_bytes(raw[:-12] + chunk + raw[-12:])
            replace("frames/t0001500/grid.tsv", bracket[3], sha(png))(b)

        def mp4_crop(b):  # a cited crop that is really an MP4
            (b / "crops/c1.png").write_bytes(mp4_bytes)
            new = sha(b / "crops/c1.png")
            replace("crops/crops.tsv", crop, new)(b)
            claim(1, lambda c: c["evidence"].update(crops=[new]))(b)

        def drop_grid_bucket(b):  # no row between 6 s and 12 s
            rows = (b / "frames/grid/grid.tsv").read_text().splitlines()
            (b / "frames/grid/grid.tsv").write_text("\n".join(r for r in rows if r.split("\t")[0] not in [g[0] for g in self.grid[6:12]]) + "\n")
            [(b / "frames/grid" / g[0]).unlink() for g in self.grid[6:12]]

        cases = {
            "png_sha256": (lambda b: (b / "frames/grid/f_0002.png").write_bytes((b / "frames/grid/f_0003.png").read_bytes()), None),
            "recomputed": (replace("frames/grid/grid.tsv", last[2], "0" * 64), None),
            "png_pixels": (lambda b: (shutil.copy(b / "frames/grid/f_0001.png", b / "frames/t0001500/f_0002.png"),
                                      replace("frames/t0001500/grid.tsv", bracket[3], self.grid[0][3])(b)), None),
            "crop_pixels": (replace("crops/crops.tsv", "320x180+40+60", "320x180+48+60"), None),
            "bound_to_video_identity": (replace("media/SHA256SUMS", f"{self.vsha}  source.f137.mp4\n", ""), None),
            "pcm_recomputed": (run_json(lambda d: d.update(pcm_sha256="2" * 64)), None),
            "schema_known": (lambda b: edit_json(b / "asr/transcript.json", lambda d: d["segments"][0].pop("compression_ratio")), None),
            "detected_language": (run_json(lambda d: d.update(detected_language="en")), None),
            "number_has_frame_or_label": (claim(0, lambda c: c["evidence"].pop("frames")), None),
            "frame_in_cited_span": (claim(0, lambda c: c["evidence"].update(frames=[
                {"media_sha256": self.vsha, "pts": last[1], "decoded_sha256": last[2]}])), None),
            "container": (replace("media/SHA256SUMS", self.vsha, concat_file.stem), concat),
            "no_signed_url_or_cookie": (lambda b: edit_json(b / "media/receipt.json",
                                                            lambda d: d.update(media_url="https://cdn.example/v.mp4?ip=1.2.3.4")), None),
            "no_media_or_large_file_in_bundle": (lambda b: shutil.copy(self.tmp / "media" / f"{self.vsha}.mp4", b / "media/FAILED"), None),
        }
        more = {  # the review findings of 2026-10-10, one regression each
            "number_has_frame_or_label (Chinese numeral)": claim(1, lambda c: c["evidence"].pop("crops")),
            "number_has_frame_or_label (一 before a unit)": both(speech(1, "在一小时图上"), claim(1, lambda c: (c.update(quote="一小时"), c["evidence"].pop("crops")))),
            "number_has_frame_or_label (English)": both(speech(1, "on the four hour chart"), claim(1, lambda c: (c.update(quote="four hour"), c["evidence"].pop("crops")))),
            "number_has_frame_or_label (value 0)": claim(1, lambda c: (c.update(quote="图上", value=0), c["evidence"].pop("crops"))),
            "not_truncated (undeclared)": lambda b: edit_json(b / "probe/identity.json", lambda d: d.pop("duration")),
            "receipt_matches_probe": lambda b: edit_json(b / "media/receipt.json", lambda d: d.update(id="other")),
            "receipt_present": lambda b: (b / "media/receipt.json").unlink(),
            "argv_is_recipe (abbreviated flag)": run_json(lambda d: d["argv"].extend(["--initial-p", "比特币十万", "--clip=0,30"])),
            "argv_is_recipe (output name)": run_json(lambda d: d["argv"].__setitem__(-3, "settings")),
            "engine_pinned": run_json(lambda d: d["versions"].update({"mlx-whisper": "0.4.4"})),
            "quote_in_segments (decimal shift)": claim(0, lambda c: c.update(quote="5.28", asr_only=True)),
            "quote_in_segments (sign and percent)": claim(0, lambda c: c.update(quote="price -52%8")),
            "quote_in_segments (splice)": claim(0, lambda c: c.update(quote="不会 price 52.8", evidence={"segments": ["E003", "E001"]}, asr_only=True)),
            "value_in_evidence": claim(1, lambda c: (c.update(value="100000", asr_only=True), c["evidence"].pop("crops"))),
            "sidecars_resolve": claim(0, lambda c: c["evidence"].update(sidecars=[{"sha256": sha(self.bundle / "probe/identity.json"), "json_path": ".id"}])),
            "flagged_span_limited": both(lambda b: edit_json(b / "asr/transcript.json", lambda d: d["segments"][0].update(compression_ratio=3.0)), rebind),
            "claims_have_media": lambda b: (b / "media/SHA256SUMS").unlink(),
            "layout (self-written probe file)": lambda b: (b / "probe/anchors.json").write_text("{}"),
            "layout (nested check.json)": lambda b: (b / "frames/grid/check.json").write_text("{}"),
            "readable_json (media as page.json)": lambda b: (b / "probe/page.json").write_bytes(mp4_bytes[:4096]),
            "readable_json (non-finite)": replace("asr/transcript.json", '"end": 2.0', '"end": 1e999'),
            "png_plain (payload chunk)": payload_png,
            "png_plain (MP4 as crop)": mp4_crop,
            "row_shape (path traversal)": replace("frames/grid/grid.tsv", self.grid[1][0], "../../crops/c1.png"),
            "regular_files_only (symlink)": lambda b: ((b / "probe/identity.json").unlink(), (b / "probe/identity.json").symlink_to("/etc/hosts")),
            "regular_files_only (FIFO)": lambda b: os.mkfifo(b / "media/FAILED"),
            "no_signed_url_or_cookie (path token)": lambda b: edit_json(b / "media/receipt.json", lambda d: d.update(
                media_url="https://cdn.example/hdntl=exp=1~acl=%2f*~hmac=ab/v.mp4")),
            "no_signed_url_or_cookie (IP and home path in FAILED)": lambda b: (b / "asr/FAILED").write_text(
                "ERROR: connect to 203.0.113.7 failed\nmlx_whisper /Users/someone/x.wav\n"),
            "has_grid": lambda b: (b / "frames/grid").rename(b / "frames/g"),
            "grid_covers_6s": drop_grid_bucket,
        }
        asr_only = lambda i, cited, **change: claim(i, lambda c: (c.update(change, asr_only=True), c["evidence"].pop(cited)))
        more.update({  # the recheck of 2026-10-10: E001 says "price 52.8"; a number is compared as a whole token
            "quote_in_segments (prefix of a number)": asr_only(0, "frames", quote="price 5", value="5"),
            "quote_in_segments (suffix of a number)": asr_only(0, "frames", quote="2.8", value="2.8"),
            "quote_in_segments (digit inside a decimal)": asr_only(0, "frames", quote="8"),
            "quote_in_segments (prefix, the cut number said elsewhere)": both(speech(0, "price 52.8 or 5"),
                                                                             asr_only(0, "frames", quote="price 5")),
            "quote_in_segments (Chinese numeral cut)": both(speech(1, "在三十二点五附近"), asr_only(1, "crops", quote="二点五附近")),
            "value_in_evidence (part of the quoted number)": asr_only(0, "frames", quote="price 52.8", value="2.8"),
            "value_in_evidence (percent is not the number)": asr_only(0, "frames", quote="price 52.8", value="52.8%"),
            "value_in_evidence (digit inside a decimal)": claim(1, lambda c: c.update(
                quote="在四小时图上", value="2", asr_only=True, evidence={"segments": ["E001", "E002"]})),
        })
        cases.update({name: (edit, None) for name, edit in more.items()})
        cases["one_stream_per_kind"] = (replace("media/SHA256SUMS", self.vsha, two_file.stem), two)
        cases["not_truncated (header says 13 s, packets stop at 6 s)"] = (
            replace("media/SHA256SUMS", f"{self.vsha}  source.f137.mp4", f"{cut_file.stem}  source.f137.mkv"), cut)
        generic = {  # on the generic-page bundle
            "public_https_host": lambda b: edit_json(b / "probe/identity.json", lambda d: d.update(webpage_url="https://0x7f.1./talk")),
            "page_holds_media": lambda b: edit_json(b / "probe/page.json", lambda d: d.pop("video")),
            "not_truncated (page declares 1 h)": lambda b: edit_json(b / "probe/page.json", lambda d: d["video"].update(duration="PT1H")),
        }
        variants = {name: (self.variant(edit), media) for name, (edit, media) in cases.items()}
        variants.update({name: (self.variant(edit, self.generic), None) for name, edit in generic.items()})
        results = self.in_parallel([lambda v=v: self.failed(v[0], media=v[1]) for v in variants.values()])
        for name, (rc, failed) in zip(variants, results):
            with self.subTest(name):
                self.assertEqual(rc, 1)
                self.assertIn(name.split(" ")[0], failed)

    def test_stage_by_stage_and_whole_numbers_pass(self):
        drop = lambda *rels: lambda b: [shutil.rmtree(b / r) if (b / r).is_dir() else (b / r).unlink() for r in rels]
        whole = lambda c, cited, **change: (c.update(change, asr_only=True), c["evidence"].pop(cited))
        bundles = {  # ok means consistent, not complete: a stage is checked before the next one exists
            "after media": self.variant(drop("asr", "frames", "crops", "claims.json")),
            "after asr": self.variant(drop("frames", "crops", "claims.json")),
            "asr-only whole numbers": self.variant(lambda b: edit_json(b / "claims.json", lambda d: (
                whole(d["claims"][0], "frames", quote="price 52.8", value="52.80"),
                whole(d["claims"][1], "crops", quote="四小时", value="四")))),
        }
        for name, result in zip(bundles, self.in_parallel([lambda b=b: self.failed(b) for b in bundles.values()])):
            with self.subTest(name):
                self.assertEqual(result, (0, set()))

    def test_restored_bundle_without_uncited_pngs(self):
        keep = {("grid", self.grid[3][0]), ("t0001500", self.bracket[1][0])}  # the crop parent and the cited frame

        def strip(b):
            for png in b.glob("frames/*/*.png"):
                if (png.parent.name, png.name) not in keep:
                    png.unlink()
        restored = self.variant(strip)
        lenient, strict = self.in_parallel([lambda: self.failed(restored, "--restored"), lambda: self.failed(restored)])
        self.assertEqual(lenient, (0, set()))
        self.assertIn("png_present", strict[1])


if __name__ == "__main__":
    unittest.main()
