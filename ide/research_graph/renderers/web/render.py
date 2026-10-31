"""Web renderer: the built page of ide/web with the view model injected.

The page is one self-contained HTML file (a pannable and zoomable lineage canvas with a summary
bar, a detail drawer and a dock) that needs JavaScript, so it opens in a browser. It is rebuilt with
npm whenever the web sources differ from the ones it was built from, so a render never shows a
stale page.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

WEB = Path(__file__).resolve().parents[3] / "web"
PAGE = WEB / "dist" / "index.html"
PLACEHOLDER = "__RESEARCH_GRAPH_VIEW__"
BUILT_FROM = "source.sha256"  # beside the page: the digest of the sources it was built from
INSTALLED_FROM = ".research-graph-lock.sha256"  # in node_modules: the digest of the lockfile installed


def digest(paths: list[Path]) -> str:
    """One digest over the files' paths (relative to web/) and contents."""
    sha = hashlib.sha256()
    for path in sorted(paths):
        sha.update(str(path.relative_to(WEB)).encode() + b"\0" + path.read_bytes() + b"\0")
    return sha.hexdigest()


def sources() -> list[Path]:
    """Every file the build reads: src/ and the top-level configuration (no dotfiles)."""
    return [p for p in WEB.rglob("*") if p.is_file() and not p.name.startswith(".")
            and p.relative_to(WEB).parts[0] not in ("node_modules", "dist")]


def stamped(stamp: Path, value: str) -> bool:
    return stamp.exists() and stamp.read_text().strip() == value


def built_page() -> str:
    """The built page, (re)building it first when it is missing or older than the sources."""
    source = digest(sources())
    if not (PAGE.exists() and stamped(PAGE.parent / BUILT_FROM, source)):
        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError(f"{PAGE} is missing or stale and npm is not on PATH; "
                               f"build it with `npm ci && npm run build` in {WEB}")
        lock = digest([WEB / "package-lock.json"])
        installed = WEB / "node_modules" / INSTALLED_FROM
        if not stamped(installed, lock):
            subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=WEB, check=True, stdout=subprocess.DEVNULL)
            installed.write_text(lock + "\n")
        subprocess.run([npm, "run", "build"], cwd=WEB, check=True, stdout=subprocess.DEVNULL)
        (PAGE.parent / BUILT_FROM).write_text(source + "\n")
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
