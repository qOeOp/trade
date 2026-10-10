"""If this fails, the video evidence checker no longer binds frames, crops, ASR input or citations to the media bytes."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).resolve().parents[2] / "services/video-evidence/check_bundle.py"
FF = ["ffmpeg", "-hide_banner", "-nostdin", "-v", "error"]


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


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe")
class CheckBundleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        video, audio, media = cls.tmp / "v.mp4", cls.tmp / "a.m4a", cls.tmp / "media"
        subprocess.run([*FF, "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=10:duration=4", "-f", "lavfi", "-i",
                        "sine=frequency=440:duration=4", "-map", "0:v", "-c:v", "mpeg4", "-q:v", "8", str(video),
                        "-map", "1:a", "-c:a", "aac", str(audio)], check=True)
        cls.vsha, cls.asha = sha(video), sha(audio)
        media.mkdir()
        shutil.copy(video, media / f"{cls.vsha}.mp4")
        shutil.copy(audio, media / f"{cls.asha}.m4a")
        b = cls.bundle = cls.tmp / "bundle"
        for d in ("probe", "media", "asr", "crops"):
            (b / d).mkdir(parents=True)
        url = "https://www.youtube.com/watch?v=synthetic01"
        (b / "probe/identity.json").write_text(json.dumps({"_type": "video", "id": "synthetic01", "extractor_key": "Youtube",
                                                           "webpage_url": url, "duration": 4}))
        (b / "media/receipt.json").write_text(json.dumps({"id": "synthetic01", "webpage_url": url, "format_id": "137+140",
            "requested_formats": [{"format_id": "137", "filesize": video.stat().st_size, "protocol": "https"},
                                  {"format_id": "140", "filesize": audio.stat().st_size, "protocol": "https"}]}))
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
            segment(1.0, 2.0, "price 79.4"), segment(2.0, 3.5, "在四小时图上")]}, ensure_ascii=False))
        (b / "asr/run.json").write_text(json.dumps({
            "pcm_sha256": hashlib.sha256(pcm).hexdigest(), "detected_language": "zh", "versions": {"engine": "synthetic"},
            "model": {"repo": "example/model", "revision": "0" * 40, "weights_sha256": "1" * 64},
            "argv": ["mlx_whisper", "audio.wav", "--language", "zh", "--temperature", "0"]}))
        frame = cls.bracket[1]  # t = 1.5 s
        claims = [{"quote": "79.4", "explicitness": "spoken", "evidence": {"segments": ["E001"], "frames": [
                       {"media_sha256": cls.vsha, "pts": frame[1], "decoded_sha256": frame[2]}]}},
                  {"quote": "四小时", "explicitness": "spoken", "evidence": {"segments": ["E002"], "crops": [sha(b / "crops/c1.png")]}}]
        (b / "claims.json").write_text(json.dumps({"transcript_sha256": sha(b / "asr/transcript.json"), "claims": claims},
                                                  ensure_ascii=False))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_checker(self, bundle, *extra, media=None):
        done = subprocess.run([sys.executable, "-I", str(CHECKER), str(bundle), "--media-dir", str(media or self.tmp / "media"), *extra],
                              capture_output=True)
        self.assertEqual(done.stderr, b"")
        return done.returncode, done.stdout

    def failed(self, bundle, *extra, media=None):
        rc, stdout = self.run_checker(bundle, *extra, media=media)
        return rc, {c["check"].split(":")[0] for c in json.loads(stdout)["checks"] if not c["ok"]}

    def in_parallel(self, calls):
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            return list(pool.map(lambda call: call(), calls))

    def variant(self, edit):
        copy = Path(tempfile.mkdtemp(dir=self.tmp)) / "bundle"
        shutil.copytree(self.bundle, copy)
        edit(copy)
        return copy

    @staticmethod
    def edit_json(path, change):
        doc = json.loads(path.read_text())
        change(doc)
        path.write_text(json.dumps(doc, ensure_ascii=False))

    def test_clean_bundle_passes_byte_identically(self):
        first, second = self.in_parallel([lambda: self.run_checker(self.bundle)] * 2)
        self.assertEqual(first[0], 0, [c for c in json.loads(first[1])["checks"] if not c["ok"]])
        self.assertEqual(first, second)

    def test_tampering_fails_on_the_named_check(self):
        last, bracket = self.grid[-1], self.bracket[1]
        replace = lambda rel, old, new: lambda b: (b / rel).write_text((b / rel).read_text().replace(old, new))
        claim = lambda i, change: lambda b: self.edit_json(b / "claims.json", lambda d: change(d["claims"][i]))
        concat = self.tmp / "concat-media"
        if not concat.exists():
            shutil.copytree(self.tmp / "media", concat)
            text = concat / "list.txt"
            text.write_text(f"ffconcat version 1.0\nfile {self.vsha}.mp4\n")
            text.rename(concat / f"{sha(text)}.mp4")
        concat_sha = next(p.stem for p in concat.glob("*.mp4") if p.stem != self.vsha)
        cases = {
            "png_sha256": (lambda b: (b / "frames/grid/f_0002.png").write_bytes(b"x"), None),
            "recomputed": (replace("frames/grid/grid.tsv", last[2], "0" * 64), None),
            "png_pixels": (lambda b: (shutil.copy(b / "frames/grid/f_0001.png", b / "frames/t0001500/f_0002.png"),
                                      replace("frames/t0001500/grid.tsv", bracket[3], self.grid[0][3])(b)), None),
            "crop_pixels": (replace("crops/crops.tsv", "320x180+40+60", "320x180+48+60"), None),
            "bound_to_video_identity": (replace("media/SHA256SUMS", f"{self.vsha}  source.f137.mp4\n", ""), None),
            "pcm_recomputed": (lambda b: self.edit_json(b / "asr/run.json", lambda d: d.update(pcm_sha256="2" * 64)), None),
            "schema_known": (lambda b: self.edit_json(b / "asr/transcript.json", lambda d: d["segments"][0].pop("compression_ratio")), None),
            "detected_language": (lambda b: self.edit_json(b / "asr/run.json", lambda d: d.update(detected_language="en")), None),
            "number_has_frame_or_label": (claim(0, lambda c: c["evidence"].pop("frames")), None),
            "frame_in_cited_span": (claim(0, lambda c: c["evidence"].update(frames=[
                {"media_sha256": self.vsha, "pts": last[1], "decoded_sha256": last[2]}])), None),
            "container": (replace("media/SHA256SUMS", self.vsha, concat_sha), concat),
            "no_signed_url_or_cookie": (lambda b: self.edit_json(b / "media/receipt.json",
                                                                 lambda d: d.update(media_url="https://cdn.example/v.mp4?ip=1.2.3.4")), None),
            "no_media_or_large_file_in_bundle": (lambda b: shutil.copy(self.tmp / "media" / f"{self.vsha}.mp4", b / "media/copy.bin"), None),
        }
        cases["number_has_frame_or_label (Chinese numeral)"] = (claim(1, lambda c: c["evidence"].pop("crops")), None)
        cases["not_truncated (undeclared)"] = (lambda b: self.edit_json(b / "probe/identity.json", lambda d: d.pop("duration")), None)
        cases["receipt_matches_probe"] = (lambda b: self.edit_json(b / "media/receipt.json", lambda d: d.update(id="other")), None)
        variants = {name: (self.variant(edit), media) for name, (edit, media) in cases.items()}
        results = self.in_parallel([lambda v=v: self.failed(v[0], media=v[1]) for v in variants.values()])
        for name, (rc, failed) in zip(variants, results):
            with self.subTest(name):
                self.assertEqual(rc, 1)
                self.assertIn(name.split(" ")[0], failed)

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
