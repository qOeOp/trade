"""Web renderer: the built page of services/research-graph/web with the view model injected.

The page is one self-contained HTML file (bento widgets, a pannable and zoomable lineage canvas)
that needs JavaScript, so it opens in a browser rather than in previews that block scripts; the
static renderer stays the script-free fallback. The page is built once with npm when missing.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

WEB = Path(__file__).resolve().parents[3] / "web"
PAGE = WEB / "dist" / "index.html"
PLACEHOLDER = "__RESEARCH_GRAPH_VIEW__"


def built_page() -> str:
    """The built page, building it first when it is missing (needs node and npm)."""
    if not PAGE.exists():
        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError(f"{PAGE} is not built and npm is not on PATH; build it with `npm ci && npm run build` in {WEB}")
        install = "ci" if (WEB / "package-lock.json").exists() else "install"
        for argv in ([npm, install, "--no-audit", "--no-fund"], [npm, "run", "build"]):
            subprocess.run(argv, cwd=WEB, check=True, stdout=subprocess.DEVNULL)
    page = PAGE.read_text()
    if page.count(PLACEHOLDER) != 1:
        raise RuntimeError(f"{PAGE} must hold the view placeholder exactly once")
    return page


def render(view: dict, out_dir: Path) -> Path:
    """Write index.html for `view` into `out_dir` and return its path."""
    data = json.dumps(view, ensure_ascii=False).replace("</", "<\\/")
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "index.html"
    target.write_text(built_page().replace(PLACEHOLDER, data))
    return target
