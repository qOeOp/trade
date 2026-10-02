"""R-1 replay for one coin over a date window (information only, not advice; no orders): every order the rule armed,
what happened to it (filled, expired, void because the coin's slot was taken, or skipped), and every trade's exit.
Rules as loop/family_r.py (R-1u): daily, order-3 pivots, large-body close breaks in the trend direction arm a limit at
the broken pivot for 10 days, stop 0.25 ATR beyond the zone (cap 1 ATR), 2R target, 60-day hold, one trade per coin with
the slot freed at the exit. R-1x (cap 0.5, buffer 0.25, 1.5R) is shown beside each filled order.
Usage: python roleflip/replay.py LIT 2026-09-01 2026-09-30
       python roleflip/replay.py BINANCE:LITUSDT.P 2026-09-01 2026-09-30   (any TradingView symbol)"""
import sys
from datetime import datetime, timezone

import pandas as pd

import forward as F

FR = F.FR


def load(coin, until=None):
    """Closed daily bars up to (not including) `until`, default today; `coin` is a Binance base or a TradingView symbol."""
    until = pd.Timestamp(until, tz="UTC") if until else pd.Timestamp(datetime.now(timezone.utc)).floor("1D")
    b, _err = F.fetch(coin if ":" in coin else f"BINANCE:{coin}USDT", "1D", 5000)
    d = pd.DataFrame([v for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s", utc=True),
                     columns=["open", "high", "low", "close"]).astype(float)
    return d[d.index < until]


def plan(S):
    """Every R-1 order in bar order: arming bar i, side, broken pivot, zone, limit/stop/2R, fill bar k and price, exit bar
    ex (len(c) or more while open), status and result. Mirrors family_r.signals for R-1."""
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    out = []
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low"):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        r = dict(i=i, side=side, pivot=p[0], lvl=lvl, zone=lower, stop=stop, tgt=lvl + side * 2 * abs(lvl - stop),
                 a=a[i], edge=edge, k=None, px=None, ex=None, res=None)
        k, px = FR.fill(S, i + 1, side, lvl) if i + 1 < len(c) else (None, None)
        if k is None:
            r["status"] = "open order" if i + FR.VALID >= len(c) - 1 else "expired unfilled"
        elif (px - stop) * side <= 0:
            r["status"] = "skipped (gap through the stop)"
        else:
            r.update(status="fill", k=k, px=px)
        out.append(r)
    busy = -1
    for r in sorted((r for r in out if r["status"] == "fill"), key=lambda r: r["k"]):  # the first fill takes the slot
        k, px, side, stop = r["k"], r["px"], r["side"], r["stop"]
        if k <= busy:
            r.update(status="void", busy_until=busy)
            continue
        tgt = px + side * 2 * abs(px - stop)
        ex = FR.exit_bar(S, k, side, stop, tgt)
        busy = ex
        r.update(status="filled", tgt=tgt, ex=ex)
        if ex >= len(c):
            r["res"] = ("open", (c[-1] - px) * side / abs(px - stop))
        elif (side == 1 and l[ex] <= stop) or (side == -1 and h[ex] >= stop):
            r["res"] = ("stop", -1.0)
        elif (side == 1 and h[ex] >= tgt) or (side == -1 and l[ex] <= tgt):
            r["res"] = ("target", 2.0)
        else:
            r["res"] = ("time", (c[ex] - px) * side / abs(px - stop))
    return out


def replay(coin, t0, t1):
    d = load(coin)
    S = FR.state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    day = lambda k: str(d.index[min(k, len(c) - 1)].date())  # noqa: E731
    inw = lambda k: k is not None and k < len(c) and t0 <= day(k) <= t1  # noqa: E731
    print(f"{coin} daily, {day(0)} to {day(len(c) - 1)}; window {t0} to {t1}")
    for i, kind, p in S["events"]:
        if kind.startswith("flip") and inw(i):
            print(f"  {day(i)} trend flips {'up' if kind == 'flip_up' else 'down'} (close {c[i]:.6g})")
    for r in plan(S):
        if not (inw(r["i"]) or inw(r["k"]) or inw(r["ex"])):
            continue
        i, side, lvl, stop = r["i"], r["side"], r["lvl"], r["stop"]
        head = (f"  armed {day(i)} {'long' if side == 1 else 'short'}: break of the {day(r['pivot'])} pivot {lvl:.6g} "
                f"(close {c[i]:.6g}, ATR {a[i]:.4g}); limit {lvl:.6g}, stop {stop:.6g}, 2R {lvl + side * 2 * abs(lvl - stop):.6g}")
        if r["status"] == "void":
            print(head + f" -> void (slot taken until {day(r['busy_until'])})")
            continue
        if r["status"] != "filled":
            print(head + f" -> {r['status']}")
            continue
        kind, R = r["res"]
        res = {"open": f"still open at {c[-1]:.6g} ({R:+.2f}R)", "stop": f"stopped {day(r['ex'])} (-1R)",
               "target": f"target hit {day(r['ex'])} (+2R)", "time": f"time exit {day(r['ex'])} ({R:+.2f}R)"}[kind]
        lx = max(r["edge"], lvl - F.CAP_X * a[i]) if side == 1 else min(r["edge"], lvl + F.CAP_X * a[i])
        sx = lx - side * F.BUF_X * a[i]
        print(head + f" -> FILLED {day(r['k'])} at {r['px']:.6g}; {res}  | R-1x: stop {sx:.6g}, "
                     f"1.5R {r['px'] + side * 1.5 * abs(r['px'] - sx):.6g}")
    t = {1: "up", -1: "down", 0: "none"}[int(tr[-1])]
    print(f"  now: trend {t}, close {c[-1]:.6g}, ATR {a[-1]:.4g} ({a[-1] / c[-1]:.1%})")


if __name__ == "__main__":
    replay(sys.argv[1], sys.argv[2], sys.argv[3])
