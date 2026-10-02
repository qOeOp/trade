"""R-1 replay for one coin over a date window (information only, not advice; no orders): every order the rule armed,
what happened to it (filled, expired, void because the coin's slot was taken, or skipped), and every trade's exit.
Rules as loop/family_r.py (R-1u): daily, order-3 pivots, large-body close breaks in the trend direction arm a limit at
the broken pivot for 10 days, stop 0.25 ATR beyond the zone (cap 1 ATR), 2R target, 60-day hold, one trade per coin with
the slot freed at the exit. R-1x (cap 0.5, buffer 0.5, 1.5R) is shown beside each filled order.
Usage: python roleflip/replay.py LIT 2026-09-01 2026-09-30
       python roleflip/replay.py BINANCE:LITUSDT.P 2026-09-01 2026-09-30   (any TradingView symbol)"""
import sys
from datetime import datetime, timezone

import pandas as pd

import forward as F

FR = F.FR


def replay(coin, t0, t1):
    now = pd.Timestamp(datetime.now(timezone.utc))
    if ":" in coin:  # a full TradingView symbol, e.g. a perpetual
        b, _err = F.fetch(coin, "1D", 1000)
        d = pd.DataFrame([v for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s", utc=True),
                         columns=["open", "high", "low", "close"]).astype(float)
        d = d[d.index < now.floor("1D")]
    else:
        d = F.daily(coin, now)
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    day = lambda k: str(d.index[k].date())  # noqa: E731
    print(f"{coin} daily, {day(0)} to {day(len(c) - 1)}; window {t0} to {t1}")
    for i, kind, p in S["events"]:
        if kind.startswith("flip") and t0 <= d.index[i].strftime("%Y-%m-%d") <= t1:
            print(f"  {day(i)} trend flips {'up' if kind == 'flip_up' else 'down'} (close {c[i]:.6g})")
    busy = -1
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low"):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        k, px = FR.fill(S, i + 1, side, lvl) if i + 1 < len(c) else (None, None)
        status, ex = None, None
        if k is None:
            status = "open order" if i + FR.VALID >= len(c) - 1 else "expired unfilled"
        elif (px - stop) * side <= 0:
            status = "skipped (gap through the stop)"
        elif k <= busy:
            status = f"void (slot taken until {day(min(busy, len(c) - 1))})"
        else:
            tgt = px + side * 2 * abs(px - stop)
            ex = FR.exit_bar(S, k, side, stop, tgt)
            busy = ex
        inwin = t0 <= d.index[i].strftime("%Y-%m-%d") <= t1 or (k is not None and t0 <= day(k) <= t1)
        if not inwin and not (ex is not None and ex < len(c) and t0 <= day(ex) <= t1):
            continue
        sd = "long" if side == 1 else "short"
        head = (f"  armed {day(i)} {sd}: break of the {day(p[0])} pivot {lvl:.6g} (close {c[i]:.6g}, ATR {a[i]:.4g}); "
                f"limit {lvl:.6g}, stop {stop:.6g}, 2R {lvl + side * 2 * abs(lvl - stop):.6g}")
        if ex is None:
            print(head + f" -> {status}")
            continue
        tgt = px + side * 2 * abs(px - stop)
        if ex >= len(c):
            res = f"still open at {c[-1]:.6g} ({(c[-1] - px) * side / abs(px - stop):+.2f}R)"
        elif (side == 1 and l[ex] <= stop) or (side == -1 and h[ex] >= stop):
            res = f"stopped {day(ex)} (-1R)"
        elif (side == 1 and h[ex] >= tgt) or (side == -1 and l[ex] <= tgt):
            res = f"target hit {day(ex)} (+2R)"
        else:
            res = f"time exit {day(ex)} at {c[ex]:.6g} ({(c[ex] - px) * side / abs(px - stop):+.2f}R)"
        lx = max(edge, lvl - F.CAP_X * a[i]) if side == 1 else min(edge, lvl + F.CAP_X * a[i])
        sx = lx - side * F.BUF_X * a[i]
        print(head + f" -> FILLED {day(k)} at {px:.6g}; {res}  | R-1x: stop {sx:.6g}, 1.5R {px + side * 1.5 * abs(px - sx):.6g}")
    t = {1: "up", -1: "down", 0: "none"}[int(tr[-1])]
    print(f"  now: trend {t}, close {c[-1]:.6g}, ATR {a[-1]:.4g} ({a[-1] / c[-1]:.1%})")


if __name__ == "__main__":
    replay(sys.argv[1], sys.argv[2], sys.argv[3])
