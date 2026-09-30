"""TrialFamily filters-v2: tight-stop, agreement and busy-market filters on 20 unused coins. See INTENT.md.

Writes filters2/events.csv.gz and filters2/result.txt.
"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo"), os.path.join(ROOT, "combo", "candidates")):
    sys.path.insert(0, p)
import harness as H  # noqa: E402
import line_break_ridge as C3  # noqa: E402
import trendline_break_strong as C2  # noqa: E402
from evaluate import holdout_bars  # noqa: E402
from portfolio import b1_signals  # noqa: E402

COINS = ("NEAR", "UNI", "AAVE", "ALGO", "VET", "ICP", "SAND", "MANA", "AXS", "EGLD", "THETA", "XTZ", "NEO", "ZEC", "DASH",
         "CHZ", "GRT", "CRV", "HBAR", "QTUM")
START, END = pd.Timestamp("2021-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
STRATS = {"B1": b1_signals, "trendline": C2.signals, "ridge": C3.signals}
MIN_STOP = 0.02


def boot(ev, col, level=95, seed=11):
    """Coin-then-signal bootstrap interval of the mean of ev[col]."""
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in ev[col].groupby(ev.coin)]
    b = []
    for _ in range(4000):
        pick = [groups[k] for k in rng.integers(0, len(groups), len(groups))]
        b.append(np.concatenate([g[rng.integers(0, len(g), len(g))] for g in pick]).mean())
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def diff_boot(ev, mask, level=95, seed=12):
    """Coin-then-signal bootstrap of edge(kept) - edge(dropped)."""
    rng = np.random.default_rng(seed)
    groups = [(g.edge.values, mask[g.index].values) for _, g in ev.groupby("coin")]
    b = []
    for _ in range(4000):
        e, m = [], []
        for k in rng.integers(0, len(groups), len(groups)):
            ge, gm = groups[k]
            s = rng.integers(0, len(ge), len(ge))
            e.append(ge[s])
            m.append(gm[s])
        e, m = np.concatenate(e), np.concatenate(m)
        b.append(e[m].mean() - e[~m].mean())
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rows = []
    for n, coin in enumerate(COINS):
        bars = holdout_bars(coin)
        d4 = bars["4h"]
        close_t = d4.index + pd.Timedelta(hours=4)
        for k, (name, fn) in enumerate(STRATS.items()):
            sigs = [s for s in fn(bars) if START <= s.time < END]
            df = H.score(bars, sigs, seed=100 * n + k)
            if df.empty:
                continue
            e = close_t.searchsorted(pd.DatetimeIndex(df.time)) + 1
            entry = d4.open.values[e]
            stops = {pd.Timestamp(s.time): s.stop for s in sigs}
            df["stop_pct"] = np.abs(entry - df.time.map(stops).values) / entry
            rows.append(df.assign(coin=coin, strat=name))
        print(f"{coin}: history from {d4.index[0].date()}, {sum(len(r) for r in rows if r.coin.iloc[0] == coin)} signals",
              flush=True)
    ev = pd.concat(rows, ignore_index=True).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    ev["agree"] = ev.groupby(["coin", "side", "time"]).strat.transform("nunique")
    # F3: universe-wide signals in the prior 30 days vs the median of that count over the prior 365 days
    day = pd.date_range(ev.time.min().floor("D") - pd.Timedelta(days=400), ev.time.max().ceil("D"), freq="D")
    daily = ev.groupby(ev.time.dt.floor("D")).size().reindex(day, fill_value=0)
    c30 = daily.rolling(30).sum().shift(1)  # days strictly before
    med = c30.rolling(365, min_periods=180).median().shift(1)
    key = ev.time.dt.floor("D")
    ev["busy"] = (c30.reindex(key).values > med.reindex(key).values)
    masks = {"F1 stop >= 2% of price": ev.stop_pct >= MIN_STOP, "F2 two or three strategies agree": ev.agree >= 2,
             "F3 not a busy market": ~ev.busy & med.reindex(key).notna().values}
    masks["F4 F1 and F2"] = masks["F1 stop >= 2% of price"] & masks["F2 two or three strategies agree"]
    ev.to_csv(os.path.join(HERE, "events.csv.gz"), index=False, float_format="%.6g")
    lo, hi = boot(ev, "edge")
    out = [f"filters-v2 (INTENT.md): 20 unused coins, {ev.time.min().date()} to {ev.time.max().date()}, {len(ev)} scored signals",
           f"Base, all signals: avg R {ev.R.mean():+.3f}, control {ev.control.mean():+.3f}, edge {ev.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]"]
    for s, g in ev.groupby("strat"):
        lo, hi = boot(g, "edge")
        out.append(f"  {s:<10} n {len(g):5d}  avg R {g.R.mean():+.3f}  edge {g.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
    out.append("")
    for name, m in masks.items():
        kept, dropped = ev[m], ev[~m]
        klo, khi = boot(kept, "edge")
        dlo, dhi = diff_boot(ev, m)
        ok = klo > 0 and dlo > 0
        out.append(f"{name}: kept {len(kept)} ({len(kept) / len(ev):.0%}), avg R {kept.R.mean():+.3f}, edge {kept.edge.mean():+.3f} "
                   f"[{klo:+.3f}, {khi:+.3f}]; dropped edge {dropped.edge.mean():+.3f}; kept minus dropped "
                   f"{kept.edge.mean() - dropped.edge.mean():+.3f} [{dlo:+.3f}, {dhi:+.3f}] -> {'HOLDS' if ok else 'fails'}")
    out.append("")
    out.append("By year, all signals: " + ", ".join(f"{y} {g.edge.mean():+.3f} (n {len(g)})" for y, g in ev.groupby(ev.time.dt.year)))
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
