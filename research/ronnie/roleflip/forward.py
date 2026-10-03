"""Forward record of R-1, Ronnie's role-reversal retest (loop P-4; stage 2 passed on 2026-10-02): after a large-bodied
daily close through a confirmed daily pivot high (low) in the daily trend's direction, a limit order at the broken level,
valid 10 days; stop 0.25 ATR beyond the zone; target 2R; at most 60 days. Records only: no orders, no exchange account.

R-1x (added 2026-10-02): the same orders with the X-R1 plateau exit (zone cap 0.5 ATR, buffer 0.25 ATR, target 1.5R; buffer 0.5 before the fill-order fix),
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
FIELDS = ["logged_at", "coin", "side", "break_day", "limit", "stop", "target", "valid_until", "code", "stop_x", "target_x",
          "impulse", "dsup"]  # dsup: the "double support" tag of loop L-5c (a broken, retested trend line at the level)
CAP_X, BUF_X, TGT_X = 0.5, 0.25, 1.5  # R-1x, the X-R1 plateau choice after the fill-order fix (loop/LOG.md)
FEE = 0.0006


def daily(coin, now):
    b = []
    for _ in range(4):
        try:
            b, _err = fetch(f"BINANCE:{coin}USDT", "1D", 5000)  # full history: R-1 breaks pivots years old, as the backtest sees them
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
    import family_dr as DR  # noqa: E402 (L-5c tag)
    S = FR.state(d)
    last = len(S["c"]) - 1
    k5 = DR.L2.K
    hi5 = pd.Series(S["h"]).rolling(2 * k5 + 1, center=True).max().values == S["h"]
    lo5 = pd.Series(S["l"]).rolling(2 * k5 + 1, center=True).min().values == S["l"]
    piv_h5, piv_l5 = list(np.flatnonzero(hi5)), list(np.flatnonzero(lo5))
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
        # R-1s: the breakout impulse, from the last confirmed order-3 pivot low (high for shorts) to the extreme since
        h, l = S["h"], S["l"]
        piv = [j for j in range(FR.K, i - FR.K + 1)
               if (side == 1 and l[j] == l[j - FR.K:j + FR.K + 1].min()) or (side == -1 and h[j] == h[j - FR.K:j + FR.K + 1].max())]
        impulse = float("nan")
        if piv:
            ja = piv[-1]
            impulse = (h[ja:i + 1].max() - l[ja]) if side == 1 else (h[ja] - l[ja:i + 1].min())
        lower_x = max(edge, lvl - CAP_X * a) if side == 1 else min(edge, lvl + CAP_X * a)
        stop_x = lower_x - side * BUF_X * a
        out.append(dict(side=side, break_day=str(d.index[i].date()), limit=lvl, stop=stop,
                        target=lvl + side * 2 * risk, valid_until=str((d.index[i] + pd.Timedelta(days=FR.VALID)).date()),
                        stop_x=stop_x, target_x=lvl + side * TGT_X * abs(lvl - stop_x), impulse=impulse,
                        dsup=int(any(sd == side and abs(y - lvl) <= 0.5 * a for sd, y in
                                     DR.broken_lines(S["h"], S["l"], S["c"], S["a"], i, piv_h5, piv_l5)))))
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


def split_exit(path, t0, side, px, stop, impulse):
    """R-1s: half at 2R; half at max(2R, one impulse length), its stop moved to the entry once the first half is out."""
    risk = abs(px - stop)
    try:
        imp = float(impulse)
    except (TypeError, ValueError):
        imp = float("nan")
    t1 = px + side * 2 * risk
    t2 = px + side * (max(2 * risk, imp) if imp == imp else 2 * risk)
    legs, s2 = [None, None], stop
    for t, b in path.iterrows():
        lo_hit = (lambda lvl: b.low <= lvl) if side == 1 else (lambda lvl: b.high >= lvl)
        hi_hit = (lambda lvl: b.high >= lvl) if side == 1 else (lambda lvl: b.low <= lvl)
        if legs[0] is None:
            if lo_hit(stop):
                return (stop - px) * side / risk - 2 * FEE * px / risk
            if t > t0 and hi_hit(t1):
                legs[0], s2 = 2.0, px
        if legs[0] is not None and legs[1] is None:
            if lo_hit(s2) and t > t0:
                legs[1] = (s2 - px) * side / risk
            elif t > t0 and hi_hit(t2):
                legs[1] = (t2 - px) * side / risk
        if legs[1] is not None:
            return (legs[0] + legs[1]) / 2 - 2 * FEE * px / risk
    if len(path) >= FR.HOLD:
        last = (path.close.iloc[-1] - px) * side / risk
        a = legs[0] if legs[0] is not None else last
        return (a + last) / 2 - 2 * FEE * px / risk
    return None


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
        exit_t = pd.NaT
        for t, b in path.iterrows():
            hit_s = b.low <= stop if side == 1 else b.high >= stop
            hit_t = b.high >= tgt if side == 1 else b.low <= tgt
            if hit_s:
                R, status, exit_t = (stop - px) * side / risk, "stop", t
                break
            if hit_t and t > t0:
                R, status, exit_t = (tgt - px) * side / risk, "target", t
                break
        if R is None and len(path) >= FR.HOLD:
            R, status = (path.close.iloc[-1] - px) * side / risk, "time"
        if R is not None:
            R -= 2 * FEE * px / risk
        Rs = split_exit(path, t0, side, px, stop, r.get("impulse"))
        rows.append(dict(coin=coin, status=status, R=R, R_split=Rs, fill_day=t0, exit_day=exit_t, dsup=r.get("dsup")))
    z = pd.DataFrame(rows)
    # one open R-1 trade per coin: a fill while the coin's previous trade is still open is outside the rule (R-1u,
    # loop/LOG.md); such fills are reported only in the "every order" line
    if "fill_day" in z:
        z["slot_ok"] = True
        for coin, g in z.dropna(subset=["fill_day"]).sort_values("fill_day").groupby("coin"):
            until = None
            for ix, r in g.iterrows():
                if until is not None and r.fill_day <= until:  # a fill on the exit day is not taken, as in the backtest
                    z.loc[ix, "slot_ok"] = False
                else:
                    until = r.exit_day if pd.notna(r.exit_day) else r.fill_day + pd.Timedelta(days=FR.HOLD)
    print(z.status.value_counts().to_dict())
    done = z.dropna(subset=["R"]) if "R" in z else z.iloc[0:0]
    if len(done):
        ok = done[done.slot_ok] if "slot_ok" in done else done
        print(f"R-1u (one open trade per coin): closed {len(ok)}, mean R {ok.R.mean():+.3f}" if len(ok) else "R-1u: none closed")
        if len(ok) and "dsup" in ok:
            tg = ok.dsup.astype(str) == "1"
            print(f"L-5c double support tag (decision 2027-10-01): tagged {tg.sum()} mean R {ok.R[tg].mean():+.3f}, "
                  f"untagged {(~tg).sum()} mean R {ok.R[~tg].mean():+.3f}")
        print(f"every logged order (diagnostic): closed {len(done)}, mean R {done.R.mean():+.3f}")
        sp = ok.dropna(subset=["R_split"]) if "R_split" in ok else ok.iloc[0:0]
        if len(sp):
            print(f"R-1s split exit on the same trades: closed {len(sp)}, mean R {sp.R_split.mean():+.3f}, "
                  f"paired difference vs R-1u {(sp.R_split - sp.R).mean():+.3f}")


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    score(now) if sys.argv[1:] == ["score"] else log(now)
