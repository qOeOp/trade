"""
Read frozen R-1 daily trend at already documented Ronnie video decisions.

This is a source-fidelity diagnostic over native Catalog bars. It does not create
signals, orders, fills, account returns, or a replacement backtest.

"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from statistics import median

from audit_daily_signal_counts import DAY_NS
from audit_daily_signal_counts import MILLISECOND_NS
from audit_daily_signal_counts import Daily

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_COMMIT = "0725a7b3f89902e27cd421a18b4b879a13268534"
SOURCE_ARCHIVE = f"{SOURCE_COMMIT}:research/ronnie/tv/video_ideas.jsonl.gz"
CASES = (
    ("C01", "BTC", "4Kpsuq0K"),
    ("C07", "DOGE", "MZNspcsN"),
    ("C09", "BTC", "MZNspcsN"),
    ("C03", "ETH", "O2oRgivi"),
    ("C10", "AAVE", "daIJgg2k"),
    ("C08", "ETH", "Zlp57IP3"),
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        name = path.relative_to(root).as_posix().encode()
        digest.update(len(name).to_bytes(4, "big"))
        digest.update(name)
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _source_ideas() -> tuple[dict, str]:
    git_executable = shutil.which("git")
    if git_executable is None:
        raise RuntimeError("git executable is required for frozen source identity")
    raw = subprocess.check_output([git_executable, "show", SOURCE_ARCHIVE])
    wanted = {uuid for _, _, uuid in CASES}
    ideas = {}
    for line in gzip.decompress(raw).splitlines():
        idea = json.loads(line)
        if idea.get("uuid") in wanted:
            if idea["uuid"] in ideas or (idea.get("user") or {}).get("username") != "Ronnie_Dong":
                raise RuntimeError("source idea identity is ambiguous")
            ideas[idea["uuid"]] = idea
    if set(ideas) != wanted:
        raise RuntimeError("missing selected source ideas")
    return ideas, hashlib.sha256(raw).hexdigest()


def _days(daily_root: Path, coin: str, publication_ns: int) -> tuple[list[Daily], str]:
    root = daily_root / coin / "daily"
    completion = json.loads((root / "r1-daily-download-complete.json").read_text())
    instrument = completion["instrument"]
    catalog = ParquetDataCatalog(str(root))
    expected = BarType.from_str(f"{instrument}-1-DAY-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([instrument])
            if bar.bar_type == expected and bar.ts_event + MILLISECOND_NS <= publication_ns
        ),
        key=lambda bar: bar.ts_event,
    )
    if len(bars) < 200:
        raise RuntimeError(f"{coin}: insufficient closed daily warmup")
    days = [
        Daily(
            bar.ts_event + MILLISECOND_NS,
            float(bar.open),
            float(bar.high),
            float(bar.low),
            float(bar.close),
        )
        for bar in bars
    ]
    expected_close = publication_ns // DAY_NS * DAY_NS
    if days[-1].available_ns != expected_close or any(
        b.available_ns - a.available_ns != DAY_NS for a, b in pairwise(days[-200:])
    ):
        raise RuntimeError(f"{coin}: source-date daily close coverage is incomplete")
    return days, instrument


def _last_pivot(pivots: list[tuple[int, int, float]]) -> dict | None:
    if not pivots:
        return None
    pivot_ns, confirmed_ns, price = pivots[-1]
    return {
        "pivot_available_ns": pivot_ns,
        "confirmed_available_ns": confirmed_ns,
        "price": price,
    }


def _trend_state(days: list[Daily], pivot_order: int) -> dict:
    """
    Apply the frozen pivot/body/trend rule at one registered pivot scale.
    """
    highs = [day.high for day in days]
    lows = [day.low for day in days]
    opens = [day.open for day in days]
    closes = [day.close for day in days]
    pivot_highs: list[tuple[int, int, float]] = []
    pivot_lows: list[tuple[int, int, float]] = []
    trend = 0
    flip_ns = None
    for i in range(2 * pivot_order + 21, len(days)):
        j = i - pivot_order
        window = slice(j - pivot_order, j + pivot_order + 1)
        if highs[j] == max(highs[window]):
            pivot_highs.append((days[j].available_ns, days[i].available_ns, highs[j]))
        if lows[j] == min(lows[window]):
            pivot_lows.append((days[j].available_ns, days[i].available_ns, lows[j]))
        prior_body = median(abs(closes[k] - opens[k]) for k in range(i - 20, i))
        big = abs(closes[i] - opens[i]) >= 1.5 * prior_body
        big2 = abs(closes[i] - opens[i - 1]) >= 3 * prior_body
        strong_up = (closes[i] > opens[i] and big) or (closes[i] > opens[i - 1] and big2)
        strong_down = (closes[i] < opens[i] and big) or (closes[i] < opens[i - 1] and big2)
        if pivot_highs and strong_up and closes[i] > pivot_highs[-1][2] and trend != 1:
            trend = 1
            flip_ns = days[i].available_ns
        elif pivot_lows and strong_down and closes[i] < pivot_lows[-1][2] and trend != -1:
            trend = -1
            flip_ns = days[i].available_ns
    return {
        "pivot_order": pivot_order,
        "trend": trend,
        "last_flip_ns": flip_ns,
        "last_confirmed_pivot_high": _last_pivot(pivot_highs),
        "last_confirmed_pivot_low": _last_pivot(pivot_lows),
        "last_closed_daily_ns": days[-1].available_ns,
        "last_closed_daily_close": days[-1].close,
        "daily_bars_used": len(days),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--pivot-order", type=int, choices=(3, 20), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.input_identity.read_text())
    if Path(identity["daily_catalog_root"]) != args.daily_root:
        raise RuntimeError("daily Catalog identity root differs")
    digests = {row["coin"]: row["daily_catalog"]["sha256"] for row in identity["coins"]}
    ideas, archive_sha = _source_ideas()
    rows = []
    for case, coin, uuid in CASES:
        idea = ideas[uuid]
        published = datetime.fromisoformat(idea["created_at"])
        publication_ns = int(published.timestamp() * 1_000_000_000)
        days, instrument = _days(args.daily_root, coin, publication_ns)
        catalog_hash = _tree_digest(args.daily_root / coin / "daily")
        if catalog_hash != digests[coin]:
            raise RuntimeError(f"{coin}: daily Catalog changed from registered input")
        rows.append(
            {
                "case": case,
                "coin": coin,
                "instrument": instrument,
                "idea_uuid": uuid,
                "video_url": idea["video"]["video_filename"],
                "published_utc": idea["created_at"],
                "daily_catalog_sha256": catalog_hash,
                **_trend_state(days, args.pivot_order),
            },
        )
    result = {
        "source_archive": SOURCE_ARCHIVE,
        "source_archive_sha256": archive_sha,
        "input_identity_sha256": _sha(args.input_identity),
        "strategy_sha256": _sha(Path(__file__).with_name("strategy.py")),
        "daily_audit_sha256": _sha(Path(__file__).with_name("audit_daily_signal_counts.py")),
        "scope": "Read-only daily state at source publication; no fills, PnL, or later bars.",
        "cases": rows,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
