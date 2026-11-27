"""Tests for Dimension 7 (IDE/font/route/loopback HTTP security surface) and Dimension 9
(skill burden ratchet, eval coverage, multi-session skill firing, and Wilson 95% CI eval stats)."""

from __future__ import annotations

from contextlib import redirect_stdout, suppress
import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / ".agents/skills/product-doctor/assets"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ASSETS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


doctor = _load("doctor")
ssa = _load("surface_skill_audit")
telemetry = _load("telemetry")


class _RawLoopbackServer:
    """Minimal raw-socket loopback TCP server for deterministic adversarial HTTP/1.1 tests."""

    def __init__(self, mode: str = "hardened") -> None:
        self.mode = mode
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self.port: int = self._sock.getsockname()[1]
        self.trusted_host = f"127.0.0.1:{self.port}"
        self._sock.listen(16)
        self._sock.settimeout(0.2)
        self._stop = threading.Event()
        self._crashed = False
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2.0)
        self._sock.close()

    def _serve(self) -> None:
        while not self._stop.is_set():
            if self._crashed:
                self._stop.wait(0.05)
                continue
            try:
                conn, _ = self._sock.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            with conn:
                conn.settimeout(1.0)
                try:
                    raw = conn.recv(8192)
                except OSError:
                    continue
                if not raw:
                    continue
                reply = self._handle(raw)
                if reply is not None:
                    with suppress(OSError):
                        conn.sendall(reply)

    def _handle(self, raw: bytes) -> bytes | None:
        head = raw.split(b"\r\n\r\n", 1)[0].decode("latin-1", errors="replace")
        lines = head.split("\r\n")
        parts = lines[0].split(" ") if lines else []
        method = parts[0] if len(parts) >= 1 else ""
        target = parts[1] if len(parts) >= 2 else ""

        headers: list[tuple[str, str]] = []
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers.append((k.strip().lower(), v.strip()))

        if self.mode == "drop_malformed" and target.startswith("//"):
            return None
        if self.mode == "crash_on_malformed" and target.startswith("//"):
            self._crashed = True
            return None

        te_values = [v for k, v in headers if k == "transfer-encoding"]
        cl_values = [v for k, v in headers if k == "content-length"]
        if len(te_values) > 1 or any(not v.isdigit() for v in cl_values):
            return self._json_resp(400, {"code": "BAD_REQUEST"})

        hosts = [v for k, v in headers if k == "host"]
        if len(hosts) != 1 or hosts[0] != self.trusted_host:
            return self._json_resp(403, {"code": "FORBIDDEN"})

        if target.startswith("//") or "\\" in target or not target.startswith("/"):
            return self._json_resp(400, {"code": "BAD_URL"})

        if method != "GET":
            return self._json_resp(405, {"code": "METHOD_NOT_ALLOWED"})

        if target == "/api/overview/health":
            return self._json_resp(200, {"ok": True})
        return self._json_resp(404, {"code": "NOT_FOUND"})

    @staticmethod
    def _json_resp(status: int, body: dict) -> bytes:
        payload = json.dumps(body).encode("utf-8")
        return (
            f"HTTP/1.1 {status} TEST\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(payload)}\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii") + payload


class Dimension7SurfaceAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()

    def _build_clean_repo(self) -> Path:
        repo = self.home / "clean_repo"
        for rel in ssa.REQUIRED_FONT_ASSETS:
            p = repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"OTTO-FAKE-SUPPLY-FONT-DATA")
        (repo / "ide/web/src/theme").mkdir(parents=True, exist_ok=True)
        (repo / "ide/web/src/theme/base.css").write_text(
            '@font-face { font-family: "Supply"; src: url("../../fonts/Supply-Regular.otf"); }\n'
            '@font-face { font-family: "Supply"; src: url("../../fonts/Supply-Medium.otf"); }\n'
            '@font-face { font-family: "Supply"; src: url("../../fonts/Supply-Bold.otf"); }\n',
            encoding="utf-8",
        )
        (repo / "ide/web/src/theme/tokens.css").write_text(
            ':root { --font-sans: "Supply", "Inter Variable", sans-serif; --font-mono: "Supply", monospace; }\n',
            encoding="utf-8",
        )
        (repo / "docs-site/app").mkdir(parents=True, exist_ok=True)
        (repo / "docs-site/app/global.css").write_text(
            '@font-face { font-family: "Supply"; src: url("/trade/fonts/Supply-Regular.otf"); }\n'
            '@font-face { font-family: "Supply"; src: url("/trade/fonts/Supply-Medium.otf"); }\n'
            '@font-face { font-family: "Supply"; src: url("/trade/fonts/Supply-Bold.otf"); }\n'
            '@theme { --font-sans: "Supply", monospace; --font-mono: "Supply", monospace; }\n',
            encoding="utf-8",
        )
        (repo / "ide/web/src/state").mkdir(parents=True, exist_ok=True)
        (repo / "ide/web/src/state/market.ts").write_text(
            'export async function load() { await fetch("/api/overview/health"); await fetch("/api/overview/snapshot"); }\n',
            encoding="utf-8",
        )
        (repo / "ide/overview/src").mkdir(parents=True, exist_ok=True)
        (repo / "ide/overview/src/app.ts").write_text(
            "export function app(hosts: Set<string>) {\n"
            "  return (req: any, res: any) => {\n"
            '    if (!hosts.has(req.headers.host ?? "")) return res.end("403");\n'
            '    let url; try { url = new URL(req.url ?? "/", "http://overview"); } catch { return res.end("400"); }\n'
            '    if (url.pathname === "/api/overview/health") return res.end("ok");\n'
            '    if (url.pathname === "/api/overview/snapshot") return res.end("snap");\n'
            "  };\n"
            "}\n",
            encoding="utf-8",
        )
        return repo

    def test_real_repo_font_integrity_and_route_parity_pass(self):
        fonts = ssa.audit_font_integrity(ROOT)
        self.assertTrue(fonts["ok"], fonts["triggers"])
        self.assertEqual(fonts["triggers"], [])

        routes = ssa.audit_overview_route_parity(ROOT)
        self.assertTrue(routes["ok"], routes["triggers"])
        self.assertEqual(routes["missing_in_overview"], [])
        self.assertIn("/api/overview/health", routes["overview_routes"])
        self.assertIn("/api/overview/minutes", routes["overview_routes"])

        sec = ssa.audit_ide_security_patterns(ROOT)
        # Icon.tsx static SVG maps are audited static sinks, not false-positive findings.
        icon_findings = [f for f in sec["findings"] if f["file"] == "ide/web/src/icons/Icon.tsx"]
        self.assertEqual(icon_findings, [])
        self.assertEqual(len(sec["audited_static_sinks"]), 2)

    def test_clean_temp_repo_passes_all_static_surface_checks(self):
        repo = self._build_clean_repo()
        res = ssa.run_surface_audit(repo_root=repo)
        self.assertTrue(res["ok"], res["triggers"])
        self.assertEqual(res["triggers"], [])

    def test_negative_font_route_and_dangerous_sink_detection(self):
        repo = self._build_clean_repo()
        # Break PP Supply Mono asset + primary font order
        (repo / "ide/web/fonts/Supply-Bold.otf").unlink()
        (repo / "ide/web/src/theme/tokens.css").write_text(
            ':root { --font-sans: "Inter Variable", sans-serif; --font-mono: "Supply", monospace; }\n',
            encoding="utf-8",
        )
        # Break route parity
        (repo / "ide/web/src/state/market.ts").write_text(
            'export async function load() { await fetch("/api/overview/nonexistent"); }\n',
            encoding="utf-8",
        )
        # Inject dangerous sinks + secret reads
        (repo / "ide/web/src/state/bad.tsx").write_text(
            'const x = eval("1+1");\n'
            "el.innerHTML = userInput;\n"
            'const el2 = <div dangerouslySetInnerHTML={{ __html: userInput }} />;\n'
            'const s1 = readFile(".env");\n'
            'const s2 = readFile("/data/dolt/service.json");\n',
            encoding="utf-8",
        )
        # Break overview app Host-before-URL order
        (repo / "ide/overview/src/app.ts").write_text(
            "export function app(hosts: Set<string>) {\n"
            "  return (req: any, res: any) => {\n"
            '    const url = new URL(req.url ?? "/", "http://overview");\n'
            '    if (!hosts.has(req.headers.host ?? "")) return res.end("403");\n'
            '    if (url.pathname === "/api/overview/health") return res.end("ok");\n'
            "  };\n"
            "}\n",
            encoding="utf-8",
        )

        res = ssa.run_surface_audit(repo_root=repo)
        self.assertFalse(res["ok"])
        joined = "\n".join(res["triggers"])
        self.assertIn("font_asset_missing", joined)
        self.assertIn("font_family_order_changed", joined)
        self.assertIn("overview_route_contract_mismatch", joined)
        self.assertIn("direct_eval", joined)
        self.assertIn("unsanitized_html_sink", joined)
        self.assertIn("secret_file_reference", joined)
        self.assertIn("host_check_after_url_parse", joined)
        self.assertIn("unguarded_url_parse", joined)

    def test_loopback_http_probe_passes_against_hardened_server(self):
        srv = _RawLoopbackServer(mode="hardened")
        srv.start()
        self.addCleanup(srv.stop)

        probe = ssa.probe_http_surface(f"127.0.0.1:{srv.port}")
        self.assertTrue(probe["ok"], probe)
        self.assertTrue(probe["liveness_ok"])
        self.assertEqual(probe["triggers"], [])
        self.assertEqual(len(probe["checks"]), 9)

        # Also exercise CLI integration via doctor.py surface
        repo = self._build_clean_repo()
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main(["surface", "--root", str(repo), "--http-target", f"127.0.0.1:{srv.port}"])
        cli_report = json.loads(out.getvalue())
        self.assertTrue(cli_report["ok"], cli_report["triggers"])
        self.assertTrue(cli_report["http_probe"]["ok"])

    def test_loopback_http_probe_detects_vulnerable_disconnect_and_dos(self):
        srv_drop = _RawLoopbackServer(mode="drop_malformed")
        srv_drop.start()
        self.addCleanup(srv_drop.stop)
        probe_drop = ssa.probe_http_surface(f"127.0.0.1:{srv_drop.port}")
        self.assertFalse(probe_drop["ok"])
        self.assertTrue(any("http_probe_dos_disconnect" in t for t in probe_drop["triggers"]))

        srv_crash = _RawLoopbackServer(mode="crash_on_malformed")
        srv_crash.start()
        self.addCleanup(srv_crash.stop)
        probe_crash = ssa.probe_http_surface(f"127.0.0.1:{srv_crash.port}", timeout=0.3)
        self.assertFalse(probe_crash["ok"])
        self.assertFalse(probe_crash["liveness_ok"])
        self.assertTrue(any("http_probe_dos_liveness_failed" in t for t in probe_crash["triggers"]))

    def test_non_loopback_http_target_strictly_refused(self):
        for bad_target in ("10.0.0.1:8768", "example.com:80", "0.0.0.0:8768", "192.168.1.5:8768", "https://127.0.0.1:8768"):
            with self.subTest(target=bad_target):
                with self.assertRaises(ValueError):
                    ssa.probe_http_surface(bad_target)
        # Valid loopback parsing
        self.assertEqual(ssa.parse_loopback_http_target("127.0.0.1:8768"), ("127.0.0.1", 8768))
        self.assertEqual(ssa.parse_loopback_http_target("localhost:8768"), ("localhost", 8768))
        self.assertEqual(ssa.parse_loopback_http_target("[::1]:8768"), ("::1", 8768))
        # CLI refuses non-loopback with SystemExit
        with self.assertRaises(SystemExit):
            doctor.main(["surface", "--http-target", "10.0.0.1:8768"])


class Dimension9SkillsEvalAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()

    def test_real_repo_skill_inventory_passes(self):
        inv = ssa.audit_skill_inventory(ROOT)
        self.assertTrue(inv["ok"], inv["triggers"])
        self.assertEqual(inv["skills_count"], 6)
        self.assertIn("product-doctor", inv["skills"])
        self.assertGreaterEqual(inv["skills"]["product-doctor"]["eval_case_count"], 40)
        self.assertEqual(inv["triggers"], [])

    def test_skill_burden_ratchet_and_eval_coverage_triggers(self):
        repo = self.home / "skills_repo"
        # Skill 1: bloated frontmatter (>120) and bloated body (>2500) + 0 evals
        s1 = repo / ".agents/skills/bloated-skill"
        s1.mkdir(parents=True)
        fm_words = " ".join(f"w{i}" for i in range(130))
        body_words = " ".join(f"b{i}" for i in range(2550))
        (s1 / "SKILL.md").write_text(f"---\nname: bloated-skill\ndescription: {fm_words}\n---\n{body_words}\n", encoding="utf-8")

        # Skill 2: compact skill with broken eval symlink and missing criteria.md
        s2 = repo / ".agents/skills/broken-eval-skill"
        s2.mkdir(parents=True)
        (s2 / "SKILL.md").write_text("---\nname: broken-eval-skill\ndescription: short\n---\nconcise body\n", encoding="utf-8")
        case_dir = repo / ".agents/evals/broken-eval-skill/case-a/graders"
        case_dir.mkdir(parents=True)
        (repo / ".agents/evals/broken-eval-skill/case-a/prompt.md").write_text("prompt\n", encoding="utf-8")
        (case_dir / "skill-fired.md").symlink_to("../../does-not-exist.md")

        inv = ssa.audit_skill_inventory(repo)
        self.assertFalse(inv["ok"])
        joined = "\n".join(inv["triggers"])
        self.assertIn("skill_md_bloat", joined)
        self.assertIn("frontmatter_bloat", joined)
        self.assertIn("missing_eval_coverage", joined)
        self.assertIn("malformed_eval_case", joined)
        self.assertIn("broken_symlink:graders/skill-fired.md", joined)
        self.assertIn("missing:graders/criteria.md", joined)

    def test_multi_session_transcript_skill_firing_and_missed_triggers(self):
        tx1 = self.home / "tx1.jsonl"
        tx1.write_text(
            "\n".join([
                json.dumps({
                    "type": "PLANNER_RESPONSE",
                    "tool_calls": [
                        {"name": "read_file", "args": {"Path": "/repo/.agents/skills/product-doctor/SKILL.md"}},
                        {"name": "run_command", "args": {"CommandLine": "python .agents/skills/product-doctor/assets/doctor.py scan"}},
                    ],
                }),
                json.dumps({"type": "GENERIC", "status": "ERROR", "content": "Command exited with code 1"}),
            ]) + "\n",
            encoding="utf-8",
        )
        tx2 = self.home / "tx2.jsonl"
        tx2.write_text(
            "\n".join([
                json.dumps({
                    "message": {
                        "content": [
                            {"type": "tool_use", "name": "Bash", "input": {"command": "python -m cli.main research status"}},
                            {"type": "tool_result", "is_error": False},
                        ]
                    }
                }),
            ]) + "\n",
            encoding="utf-8",
        )
        res = ssa.audit_transcript_skill_firing([tx1, tx2], {"product-doctor", "research-round"})
        self.assertFalse(res["ok"])
        self.assertEqual(res["per_skill"]["product-doctor"]["sessions_loaded"], 1)
        self.assertEqual(res["per_skill"]["product-doctor"]["tool_error_rate"], 0.5)
        self.assertEqual(res["per_skill"]["research-round"]["sessions_loaded"], 0)
        self.assertEqual(res["per_skill"]["research-round"]["related_command_sessions"], 1)
        self.assertTrue(any("missed_skill_triggers (research-round:" in t for t in res["triggers"]))

    def test_wilson_ci_math_flaky_undersampled_and_baseline_regression(self):
        # Exact analytical Wilson 95% CI values
        lo10, hi10 = ssa.wilson_ci(10, 12)
        self.assertAlmostEqual(lo10, 0.5519, places=3)
        self.assertAlmostEqual(hi10, 0.9531, places=3)
        lo12, hi12 = ssa.wilson_ci(12, 12)
        self.assertAlmostEqual(lo12, 0.7575, places=3)
        self.assertAlmostEqual(hi12, 1.0, places=4)
        lo0, hi0 = ssa.wilson_ci(0, 12)
        self.assertAlmostEqual(lo0, 0.0, places=4)
        self.assertAlmostEqual(hi0, 0.2425, places=3)
        self.assertEqual(ssa.wilson_ci(0, 0), (0.0, 1.0))

        # Combine per-run format and aggregated count format across two eval JSON files
        eval_a = self.home / "eval_a.json"
        eval_a.write_text(
            json.dumps([
                {"case": "stable-pass", "pass_count": 12, "total": 12},
                {"case": "flaky-case", "pass_count": 6, "total": 12},
                {"case": "undersampled-case", "pass_count": 5, "total": 8},
                {"case": "regressed-case", "pass_count": 6, "total": 20},
                {"case": "small-drop-ok", "pass_count": 10, "total": 12},
            ]),
            encoding="utf-8",
        )
        eval_b = self.home / "eval_b.json"
        eval_b.write_text(
            json.dumps({
                "results": [
                    {"case": "per-run-case", "passed": True},
                    {"case": "per-run-case", "passed": True},
                    {"case": "per-run-case", "passed": True},
                ]
            }),
            encoding="utf-8",
        )
        baseline = self.home / "baseline.json"
        baseline.write_text(
            json.dumps([
                {"case": "regressed-case", "pass_count": 18, "total": 20},
                {"case": "small-drop-ok", "pass_count": 11, "total": 12},
            ]),
            encoding="utf-8",
        )

        stats = ssa.analyze_eval_results([eval_a, eval_b], baseline_path=baseline)
        self.assertFalse(stats["ok"])
        self.assertIn("flaky-case", stats["flaky_cases"])
        self.assertIn("undersampled-case", stats["flaky_cases"])
        self.assertNotIn("stable-pass", stats["flaky_cases"])
        self.assertEqual(stats["under_sampled_cases"], ["undersampled-case"])
        self.assertEqual(stats["cases"]["per-run-case"]["pass_count"], 3)
        self.assertEqual(stats["cases"]["per-run-case"]["total"], 3)
        self.assertEqual([r["case"] for r in stats["regressions"]], ["regressed-case"])
        self.assertTrue(stats["regressions"][0]["non_overlapping_ci"])
        self.assertLess(stats["regressions"][0]["p_value"], 0.05)

        # Exercise CLI doctor.py skills-audit end-to-end
        out = io.StringIO()
        with redirect_stdout(out):
            doctor.main([
                "skills-audit",
                "--root", str(ROOT),
                "--eval-json", str(eval_a), str(eval_b),
                "--eval-baseline", str(baseline),
            ])
        cli_report = json.loads(out.getvalue())
        self.assertTrue(cli_report["inventory"]["ok"])
        self.assertEqual(cli_report["eval_stats"]["summary"]["regression_count"], 1)

    def test_all_product_doctor_assets_keep_cognitive_budget(self):
        for py_file in sorted(ASSETS.glob("*.py")):
            analysis = telemetry.analyze_python_source(py_file.read_text(encoding="utf-8"))
            self.assertLessEqual(
                analysis["max_cognitive"],
                47,
                f"{py_file.name} exceeded max_cognitive <= 47: {analysis['hot_functions'][:3]}",
            )


if __name__ == "__main__":
    unittest.main()
