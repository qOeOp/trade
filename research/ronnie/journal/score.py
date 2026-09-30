"""Score a forward journal of hand-drawn trades against random entries.

Usage: python journal/score.py [journal/journal.csv]

One row per drawing, written and committed before price reaches the entry (columns in journal.csv, filled example in
EXAMPLE.csv): id, drawn_at_utc (ISO, UTC), symbol (TradingView symbol, e.g. BINANCE:BTCUSDT, FX:EURUSD, OANDA:XAUUSD),
timeframe (1h, 4h, 1D or 1W: the chart the lines were drawn on), side (long/short), entry_type (market/limit), entry
(limit price; empty for market), stop, target1, target2 (optional), max_bars (optional horizon in chart bars, default
30), lines, note, screenshot.

Prices: TradingView's feed, hourly bars where it serves them (roughly the last 7-10 months), else daily bars. Fill model
as tv_trades.simulate: market entries at the last price before drawn_at, limits only when traded through and cancelled
if target1 trades first, the stop wins when both are touched in one bar, gross of costs. Result in R (stop distance).
Control per row: 200 market entries at random hours within the 10 chart bars after drawn_at, same side, with the same
stop and target distances. A row whose horizon has not passed and which has not exited is reported as open.
Hindsight check: when the file is in git, each row's commit time is compared with drawn_at_utc; rows committed more
than an hour later are flagged and excluded from the summary.
"""
import csv, os, subprocess, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from tv_prices import fetch  # noqa: E402
from tv_trades import simulate  # noqa: E402

TF_H = {"1h": 1, "4h": 4, "1D": 24, "1W": 168}
CONTROLS = 200
RNG = np.random.default_rng(3)


def bars(symbol, tf):
    b, err = fetch(symbol, tf, 5000)
    if not b:
        raise RuntimeError(f"{symbol}: no bars ({err})")
    d = pd.DataFrame([(t, *v) for t, v in b], columns=["time", "open", "high", "low", "close"])
    return d


def commit_times(path):
    """{line number (1-based): commit unix time or None if uncommitted}; {} when the file is not in git."""
    try:
        out = subprocess.run(["git", "blame", "--line-porcelain", os.path.basename(path)], cwd=os.path.dirname(os.path.abspath(path)),
                             capture_output=True, text=True, check=True).stdout
    except Exception:
        return {}
    times, sha, line, t = {}, None, None, None
    for x in out.splitlines():
        p = x.split()
        if x.startswith("\t"):
            times[line] = None if sha == "0" * 40 else t
        elif len(p) >= 3 and len(p[0]) == 40 and p[1].isdigit():
            sha, line = p[0], int(p[2])
        elif p and p[0] == "committer-time":
            t = int(p[1])
    return times


def atr_at(d, t_end, tf_h):
    """ATR(14) of the chart timeframe, from hourly or daily bars closed before t_end."""
    x = d[d.time < t_end].copy()
    x.index = pd.to_datetime(x.time, unit="s", utc=True)
    rule = {1: "1h", 4: "4h", 24: "1D", 168: "W-MON"}[tf_h]
    y = x.resample(rule, label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    tr = np.maximum(y.high - y.low, np.maximum(abs(y.high - y.close.shift()), abs(y.low - y.close.shift())))
    return float(tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1])


def score_row(r, cache):
    tf_h = TF_H[r["timeframe"]]
    t_drawn = int(datetime.fromisoformat(r["drawn_at_utc"]).replace(tzinfo=timezone.utc).timestamp())
    for res, tf, per_bar in (("hourly", "60", tf_h), ("daily", "1D", max(1, tf_h // 24) if tf_h >= 24 else None)):
        if per_bar is None:
            continue
        key = (r["symbol"], tf)
        if key not in cache:
            cache[key] = bars(r["symbol"], tf)
        d = cache[key]
        if d.time.iloc[0] < t_drawn - 20 * 86400:
            break
    else:
        return dict(id=r["id"], status="no data far enough back")
    t, o, h, l, c = (d[k].values for k in ("time", "open", "high", "low", "close"))
    side = 1 if r["side"].lower().startswith("l") else -1
    i0 = int(np.searchsorted(t, t_drawn, side="left" if res == "hourly" else "right"))
    if i0 >= len(t) or i0 == 0:
        return dict(id=r["id"], status="drawn after the last bar")
    E = c[i0 - 1]
    limit = float(r["entry"]) if r["entry_type"].lower() == "limit" and r["entry"] else None
    stop, tp = float(r["stop"]), float(r["target1"])
    ref = limit if limit is not None else E
    if side * (ref - stop) <= 0 or side * (tp - ref) <= 0:
        return dict(id=r["id"], status="stop or target on the wrong side")
    cap = int(float(r["max_bars"] or 30)) * per_bar
    z = simulate(o, h, l, c, i0, side, E, tp, stop, cap, limit)
    finished = i0 + cap < len(c)
    row = dict(id=r["id"], symbol=r["symbol"], tf=r["timeframe"], res=res, side=side, lines=r["lines"])
    if not z.get("filled"):
        row["status"] = "not filled" if finished or z["why"] == "tp_before_fill" else "open"
        return row
    if z["why"] == "time" and not finished:
        row["status"] = "open"
        return row
    risk = abs(z["entry"] - stop)
    row.update(status="closed", why=z["why"], R=side * (z["exit"] - z["entry"]) / risk,
               stop_atr=abs(ref - stop) / atr_at(d, t_drawn, tf_h))
    cand = np.arange(i0 + 1, min(i0 + 10 * per_bar + 1, len(c) - cap - 1))
    if len(cand) >= 5:
        dsl, dtp = abs(ref - stop), abs(tp - ref)
        rs = []
        for i in RNG.choice(cand, CONTROLS):
            e = o[i]
            zz = simulate(o, h, l, c, i, side, e, e + side * dtp, e - side * dsl, cap)
            rs.append(side * (zz["exit"] - e) / dsl)
        row["R_random"] = float(np.mean(rs))
    return row


def main(path):
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    ctimes = commit_times(path)
    cache, out = {}, []
    for n, r in enumerate(rows, start=2):  # line 1 is the header
        if not r.get("id"):
            continue
        t_drawn = datetime.fromisoformat(r["drawn_at_utc"]).replace(tzinfo=timezone.utc).timestamp()
        late = ctimes.get(n) is not None and ctimes[n] > t_drawn + 3600
        try:
            s = score_row(r, cache)
        except Exception as e:
            s = dict(id=r["id"], status=f"error: {e}")
        s["committed_late"] = late if ctimes.get(n) is not None else None  # None: not committed yet
        out.append(s)
    df = pd.DataFrame(out)
    df.to_csv(os.path.join(HERE, "scored.csv"), index=False)
    ok = df[(df.status == "closed") & (df.committed_late != True)]  # noqa: E712
    lines = [f"{len(df)} rows: " + ", ".join(f"{k} {v}" for k, v in df.status.value_counts().items())]
    if (df.committed_late == True).any():  # noqa: E712
        lines.append(f"excluded, committed more than an hour after drawn_at: {', '.join(df.id[df.committed_late == True])}")  # noqa: E712
    if len(ok):
        v = ok.R.values
        b = RNG.choice(v, size=(2000, len(v))).mean(1)
        lines.append(f"closed and on time: {len(ok)}; win {np.mean(v > 0):.0%}; avgR {v.mean():+.2f} [95% {np.percentile(b, 2.5):+.2f}, {np.percentile(b, 97.5):+.2f}]")
        if "R_random" in ok:
            dd = (ok.R - ok.R_random).dropna().values
            if len(dd) >= 3:
                bd = RNG.choice(dd, size=(2000, len(dd))).mean(1)
                lines.append(f"random entries with the same stops and targets: avgR {ok.R_random.mean():+.2f}; "
                             f"yours minus random {dd.mean():+.2f} [95% {np.percentile(bd, 2.5):+.2f}, {np.percentile(bd, 97.5):+.2f}]")
        sd = max(v.std(ddof=1) if len(v) > 1 else 1.2, 0.5)
        need = int(np.ceil((1.96 * sd / 0.2) ** 2))
        lines.append(f"to tell a +0.2R edge from zero at this spread (sd {sd:.2f}R) takes about {need} closed trades; you have {len(ok)}")
    text = "\n".join(lines)
    print(text)
    open(os.path.join(HERE, "score.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "journal.csv"))
