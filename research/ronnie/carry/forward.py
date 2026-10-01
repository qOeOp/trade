"""Forward record of carry K1 (cash-and-carry: long spot, short perpetual), frozen as validated. No orders.

Usage: python carry/forward.py          decide today's K1 state per coin and append changes to carry/forward/events.csv
       python carry/forward.py score    score the closed and open hedges with real funding, where archived

Decision data: Binance publishes funding archives monthly, so the daily decision uses funding estimated from the
1h premium-index klines (daily archives): per 8 hours, F = P + clamp(0.01% - P, -0.05%, +0.05%), P the mean premium.
On August 2026 the estimate agreed with real funding on the K1 entry condition 97-100% of the time (BTC, SOL, DOGE).
Rule (unchanged): open when the trailing 7-day mean funding per 8 hours is at least 0.01%; close when the trailing
3-day mean is below 0. Universe: the 17 majors and the 20 large caps of the holdout. Each run appends only state
changes, dated by the last complete UTC day, and rewrites carry/forward/state.csv; the commit time is the proof.
Scoring uses real funding from the monthly archives plus spot and perpetual daily closes, with 0.30% per open and
close, per unit of notional.
"""
import csv, importlib.util, io, os, subprocess, sys, zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
_spec2 = importlib.util.spec_from_file_location("carry_run", os.path.join(HERE, "run.py"))
C = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(C)

COINS = R4.MAJORS + R4.LARGE
START = pd.Timestamp("2026-10-01")
OUT = os.path.join(HERE, "forward")
EVENTS, STATE = os.path.join(OUT, "events.csv"), os.path.join(OUT, "state.csv")


def _zip_rows(url):
    b = subprocess.run(["curl", "-s", "--max-time", "30", url], capture_output=True).stdout
    try:
        z = zipfile.ZipFile(io.BytesIO(b))
    except zipfile.BadZipFile:
        return []
    return [line.split(",") for line in z.read(z.namelist()[0]).decode().splitlines() if line[:1].isdigit()]


def est_funding(sym, last_day, days=10):
    """Estimated funding per 8h settlement over the last `days` complete UTC days."""
    rows = []
    for d in pd.date_range(last_day - pd.Timedelta(days=days - 1), last_day):
        rows += _zip_rows(f"{C.BASE}/futures/um/daily/premiumIndexKlines/{sym}/1h/{sym}-1h-{d:%Y-%m-%d}.zip")
    if not rows:
        return pd.Series(dtype=float)
    p = pd.Series([(float(x[1]) + float(x[4])) / 2 for x in rows], index=pd.to_datetime([int(x[0]) // 1000 for x in rows], unit="s"))
    P = p.resample("8h", label="right", closed="left").mean().dropna()
    return P + np.clip(0.0001 - P, -0.0005, 0.0005)


def decide():
    os.makedirs(OUT, exist_ok=True)
    last_day = (pd.Timestamp.now(tz="UTC").tz_localize(None).normalize() - pd.Timedelta(days=1))
    prev = pd.read_csv(STATE).set_index("coin").held.to_dict() if os.path.exists(STATE) else {}
    new_events, state = [], []
    for coin in COINS:
        sym = C.PERP.get(coin, f"{coin}USDT")
        f = est_funding(sym, last_day)
        if len(f) < 21:
            state.append(dict(coin=coin, day=last_day.date(), f7=np.nan, f3=np.nan, held=bool(prev.get(coin, False)), note="no data"))
            continue
        f7, f3 = f.iloc[-21:].mean(), f.iloc[-9:].mean()
        held = bool(prev.get(coin, False))
        if not held and f7 >= C.K1_IN:
            held = True
            new_events.append(dict(day=last_day.date(), coin=coin, action="open", f7=f7, f3=f3))
        elif held and f3 < C.K1_OUT:
            held = False
            new_events.append(dict(day=last_day.date(), coin=coin, action="close", f7=f7, f3=f3))
        state.append(dict(coin=coin, day=last_day.date(), f7=f7, f3=f3, held=held, note=""))
        print(f"{coin}: f7 {f7:+.5f} f3 {f3:+.5f} {'HELD' if held else 'flat'}", flush=True)
    new = not os.path.exists(EVENTS)
    with open(EVENTS, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["day", "coin", "action", "f7", "f3"], lineterminator="\n")
        if new:
            w.writeheader()
        w.writerows(new_events)
    pd.DataFrame(state).to_csv(STATE, index=False, float_format="%.6g")
    print(f"{last_day.date()}: {len(new_events)} state changes, {sum(s['held'] for s in state)} hedges held")


def score():
    ev = pd.read_csv(EVENTS, parse_dates=["day"]) if os.path.exists(EVENTS) else pd.DataFrame()
    if ev.empty:
        print("no events yet")
        return
    rets = []
    for coin, g in ev.groupby("coin"):
        d = C.coin_daily(coin)
        if d is None:
            continue
        held = pd.Series(np.nan, index=d.index)
        for r in g.itertuples():
            held[d.index > r.day] = 1.0 if r.action == "open" else 0.0
        held = held.ffill().fillna(0.0)
        r = d.hedge * held
        changes = held.diff().abs().fillna(held)
        rets.append((r - changes * C.OPEN_CLOSE / 2).rename(coin))
    R = pd.concat(rets, axis=1)
    R = R[R.index >= START]
    if R.empty:
        print("no archived funding after the start yet (the monthly archive lags)")
        return
    port = R.where(R != 0).mean(axis=1).fillna(0.0)
    print(f"K1 forward: {R.index[0].date()} to {R.index[-1].date()}, {port.mean() * 365:+.1%} a year per unit of notional, "
          f"cumulative {port.sum():+.2%}")


if __name__ == "__main__":
    score() if len(sys.argv) > 1 and sys.argv[1] == "score" else decide()
