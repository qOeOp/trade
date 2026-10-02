"""Forward record of R-1, Ronnie's role-reversal retest (loop P-4; stage 2 passed on 2026-10-02): after a large-bodied
daily close through a confirmed daily pivot high (low) in the daily trend's direction, a limit order at the broken level,
valid 10 days; stop 0.25 ATR beyond the zone; target 2R; at most 60 days. Records only: no orders, no exchange account.

R-1x (added 2026-10-02): the same orders with the X-R1 plateau exit (zone cap 0.5 ATR, buffer 0.5 ATR, target 1.5R),
scored as a paired comparison against R-1.

Usage: python roleflip/forward.py          log new resting limit orders armed at the last closed UTC day
                                           (roleflip/forward/orders.csv; the commit is the timestamp proof)
       python roleflip/forward.py score    fills after logging, then stop / target / 60-day exit, in R; fee 0.06% a side

Universe, fixed on 2026-10-02: the 17 majors and the 20 large caps of the loop's validation tier (37 coins).
"""
import csv, os, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "loop"))
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
from tv_prices import fetch  # noqa: E402

COINS = tuple(E.ITER_COINS) + tuple(E.VAL_COINS)
START = pd.Timestamp("2026-10-02", tz="UTC")
OUT = os.path.join(HERE, "forward", "orders.csv")
FIELDS = ["logged_at", "coin", "side", "break_day", "limit", "stop", "target", "valid_until", "code", "stop_x", "target_x"]
CAP_X, BUF_X, TGT_X = 0.5, 0.5, 1.5  # R-1x, the X-R1 plateau choice (loop/LOG.md)
FEE = 0.0006


def daily(coin, now):
    b = []
    for _ in range(4):
        try:
            b, _err = fetch(f"BINANCE:{coin}USDT", "1D", 500)
            if b:
                break
        except Exception:
            b = []
    d = pd.DataFrame([(t, *v) for t, v in b], columns=["time", "open", "high", "low", "close"])
    d.index = pd.to_datetime(d.time, unit="s", utc=True)
    d["volume"] = 1.0
    return d[d.index < now.floor("1D")][["open", "high", "low", "close", "volume"]].astype(float)


def armed(d):
    """Orders armed by a break on the last closed day (the same rule as family_r.signals for R-1)."""
    S = FR.state(d)
    last = len(S["c"]) - 1
    out = []
    for i, kind, p in S["events"]:
        if i != last or kind not in ("break_high", "break_low"):
            continue
        side = 1 if kind == "break_high" else -1
        if S["trend"][i] != side or np.isnan(S["a"][i]):
            continue
        lvl, edge, a = p[1], p[2], S["a"][i]
        lower = max(edge, lvl - a) if side == 1 else min(edge, lvl + a)
        stop = lower - side * FR.BUF * a
        risk = abs(lvl - stop)
        lower_x = max(edge, lvl - CAP_X * a) if side == 1 else min(edge, lvl + CAP_X * a)
        stop_x = lower_x - side * BUF_X * a
        out.append(dict(side=side, break_day=str(d.index[i].date()), limit=lvl, stop=stop,
                        target=lvl + side * 2 * risk, valid_until=str((d.index[i] + pd.Timedelta(days=FR.VALID)).date()),
                        stop_x=stop_x, target_x=lvl + side * TGT_X * abs(lvl - stop_x)))
    return out


def log(now):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    seen = set()
    if os.path.exists(OUT):
        seen = {(r["coin"], r["break_day"], r["side"], r["limit"]) for r in csv.DictReader(open(OUT))}
    new = []
    for coin in COINS:
        try:
            d = daily(coin, now)
        except Exception as ex:
            print(f"{coin}: no data ({type(ex).__name__})")
            continue
        if len(d) < 60 or d.index[-1] < START:
            continue
        for o in armed(d):
            row = dict(logged_at=now.isoformat(), coin=coin, code="R-1", **{k: (f"{v:.8g}" if isinstance(v, float) else v) for k, v in o.items()})
            key = (coin, row["break_day"], str(row["side"]), row["limit"])
            if key not in seen:
                new.append(row)
    header = not os.path.exists(OUT)
    with open(OUT, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        if header:
            w.writeheader()
        w.writerows(new)
    print(f"logged {len(new)} new R-1 orders" if new else "no new R-1 orders")


def score(now):
    if not os.path.exists(OUT):
        print("no orders yet")
        return
    rows, cache = [], {}
    for r in csv.DictReader(open(OUT)):
        coin, side = r["coin"], int(r["side"])
        lim, stop, tgt = float(r["limit"]), float(r["stop"]), float(r["target"])
        if coin not in cache:
            cache[coin] = daily(coin, now)
        d = cache[coin]
        start = pd.Timestamp(r["logged_at"]).floor("1D") + pd.Timedelta(days=1)  # only days after logging can fill
        win = d[(d.index >= start) & (d.index <= pd.Timestamp(r["valid_until"], tz="UTC"))]
        fill = None
        for t, b in win.iterrows():
            if (side == 1 and b.low <= lim) or (side == -1 and b.high >= lim):
                fill = (t, min(b.open, lim) if side == 1 else max(b.open, lim))
                break
        if fill is None:
            rows.append(dict(coin=coin, status="unfilled" if win.index.max() is not pd.NaT and len(win) >= FR.VALID else "pending"))
            continue
        t0, px = fill
        path = d[d.index >= t0].iloc[:FR.HOLD]
        risk, R, status = abs(px - stop), None, "open"
        for t, b in path.iterrows():
            hit_s = b.low <= stop if side == 1 else b.high >= stop
            hit_t = b.high >= tgt if side == 1 else b.low <= tgt
            if hit_s:
                R, status = (stop - px) * side / risk, "stop"
                break
            if hit_t and t > t0:
                R, status = (tgt - px) * side / risk, "target"
                break
        if R is None and len(path) >= FR.HOLD:
            R, status = (path.close.iloc[-1] - px) * side / risk, "time"
        if R is not None:
            R -= 2 * FEE * px / risk
        rows.append(dict(coin=coin, status=status, R=R, fill_day=t0))
    z = pd.DataFrame(rows)
    # the tested rule holds one trade per coin per 60 days from each fill, even after an early exit (loop/LOG.md, the
    # R-1 slot note); fills inside a coin's slot are reported as the untested "unlocked" variant only
    if "fill_day" in z:
        z["slot_ok"] = True
        for coin, g in z.dropna(subset=["fill_day"]).sort_values("fill_day").groupby("coin"):
            until = None
            for ix, r in g.iterrows():
                if until is not None and r.fill_day < until:
                    z.loc[ix, "slot_ok"] = False
                else:
                    until = r.fill_day + pd.Timedelta(days=FR.HOLD)
    print(z.status.value_counts().to_dict())
    done = z.dropna(subset=["R"]) if "R" in z else z.iloc[0:0]
    if len(done):
        ok = done[done.slot_ok] if "slot_ok" in done else done
        print(f"R-1 as tested (one slot per coin per 60 days): closed {len(ok)}, mean R {ok.R.mean():+.3f}" if len(ok) else "R-1 as tested: none closed")
        print(f"unlocked variant (every order, untested): closed {len(done)}, mean R {done.R.mean():+.3f}")


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    score(now) if sys.argv[1:] == ["score"] else log(now)
