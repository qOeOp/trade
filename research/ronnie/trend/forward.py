"""Forward record of long-only daily trend following on the 17 majors (trend-v1 T0, long side). Records only: no orders,
no exchange account.

Usage: python trend/forward.py         append newly known events to trend/forward/events.csv, rewrite state.csv (status,
                                       entry trigger and exit level per coin)
       python trend/forward.py score   paper book from the forward start: 1% risk per trade, spot, 0.1% per side

The book starts flat on START. Daily bars come from TradingView's Binance feed (UTC days); the day still forming is
dropped. Rules: a close above the prior 50-day closing high signals an entry at the next open with a stop 2 ATR(20)
below; the position exits at the close below the prior 20-day closing low, or at the stop (gaps fill at the open).
Events: "signal" (known at the signal day's close), "entry" (the next open), "exit" (stop or close). Each event is
appended once, the run it first becomes known; the commit that adds it is its timestamp proof.
"""
import csv, hashlib, os, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from tv_prices import fetch  # noqa: E402

COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
START = pd.Timestamp("2026-10-01", tz="UTC")  # first day whose close can signal
ENTRY_N, EXIT_N, STOP_ATR, RISK, FEE = 50, 20, 2.0, 0.01, 0.001
DIR = os.path.join(HERE, "forward")
EVENTS, STATE = os.path.join(DIR, "events.csv"), os.path.join(DIR, "state.csv")
FIELDS = ["logged_at", "coin", "event", "day", "price", "stop", "detail", "code_sha"]


def bars(coin, now):
    for k in range(4):
        try:
            b, err = fetch(f"BINANCE:{coin}USDT", "1D", 400)
            if b:
                break
        except Exception:  # the feed drops connections now and then
            b = []
    if not b:
        raise RuntimeError(f"{coin}: no daily bars")
    d = pd.DataFrame([(t, *v) for t, v in b], columns=["time", "open", "high", "low", "close"])
    d = d[d.time + 86400 <= now.timestamp()]  # closed days only
    d.index = pd.to_datetime(d.time, unit="s", utc=True)
    return d


def atr(h, l, c, n=20):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def events_for(coin, d):
    """All events from START on, in order, from closed daily bars."""
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    a = atr(h, l, c)
    days = d.index
    out, pos = [], None
    for i in range(ENTRY_N, len(c)):
        if days[i] < START:
            continue
        if pos is not None and i >= pos["e"]:
            if i == pos["e"]:
                out.append(dict(coin=coin, event="entry", day=days[i], price=o[i], stop=pos["stop"], detail="next open"))
            if l[i] <= pos["stop"]:
                px = min(o[i], pos["stop"]) if i > pos["e"] else pos["stop"]
                out.append(dict(coin=coin, event="exit", day=days[i], price=px, stop=pos["stop"], detail="stop"))
                pos = None
            elif c[i] < c[i - EXIT_N:i].min():
                out.append(dict(coin=coin, event="exit", day=days[i], price=c[i], stop=pos["stop"], detail="close below 20-day low"))
                pos = None
            continue
        if pos is None and c[i] > c[i - ENTRY_N:i].max():
            stop = (o[i + 1] if i + 1 < len(c) else c[i]) - STOP_ATR * a[i]
            out.append(dict(coin=coin, event="signal", day=days[i], price=c[i], stop=np.nan,
                            detail=f"buy at next open; stop = open - {STOP_ATR * a[i]:.6g}"))
            pos = dict(e=i + 1, stop=stop)
    status = "flat" if pos is None else "long" if pos["e"] < len(c) else "pending entry"
    state = dict(coin=coin, status=status, stop=pos["stop"] if status == "long" else np.nan,
                 entry_trigger=c[-ENTRY_N:].max(), exit_level=c[-EXIT_N:].min(), last_close=c[-1], last_day=days[-1].date())
    return out, state


def code_sha():
    return hashlib.sha256(open(os.path.abspath(__file__), "rb").read()).hexdigest()[:16]


def log(now):
    os.makedirs(DIR, exist_ok=True)
    seen = set()
    if os.path.exists(EVENTS):
        with open(EVENTS) as f:
            seen = {(r["coin"], r["event"], r["day"]) for r in csv.DictReader(f)}
    new, states = [], []
    for coin in COINS:
        evs, st = events_for(coin, bars(coin, now))
        for e in evs:
            key = (coin, e["event"], str(e["day"].date()))
            if key not in seen:
                new.append(dict(logged_at=now.isoformat(timespec="seconds"), **{**e, "day": str(e["day"].date())}, code_sha=code_sha()))
        states.append(st)
    write_header = not os.path.exists(EVENTS)
    with open(EVENTS, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n", extrasaction="ignore")
        if write_header:
            w.writeheader()
        for r in new:
            w.writerow({k: (f"{v:.8g}" if isinstance(v, float) else v) for k, v in r.items()})
    pd.DataFrame(states).to_csv(STATE, index=False, float_format="%.8g")
    held = sum(s_["status"] != "flat" for s_ in states)
    print(f"{now:%Y-%m-%d %H:%M} UTC: {len(new)} new events, {held} open or pending positions")
    for r in new:
        print(f"  {r['day']} {r['coin']:<5} {r['event']:<6} {r['price']:.6g}  {r['detail']}")


def score(now):
    ev = pd.read_csv(EVENTS)
    trades = []
    for coin, g in ev.groupby("coin"):
        g = g.sort_values(["day", "event"], key=lambda s: s.map({"signal": 0, "entry": 1, "exit": 2}) if s.name == "event" else s)
        cur = None
        for r in g.itertuples():
            if r.event == "entry":
                cur = dict(coin=coin, t_in=r.day, px_in=r.price, stop=r.stop)
            elif r.event == "exit" and cur:
                trades.append({**cur, "t_out": r.day, "px_out": r.price})
                cur = None
    if not trades:
        print("no closed trades yet")
        return
    t = pd.DataFrame(trades)
    t["R"] = (t.px_out - t.px_in) / (t.px_in - t.stop) - FEE * (t.px_in + t.px_out) / (t.px_in - t.stop)
    print(f"{len(t)} closed trades since {START.date()}: avg R {t.R.mean():+.3f}, win {np.mean(t.R > 0):.0%}, "
          f"sum R {t.R.sum():+.2f} (at {RISK:.0%} risk per trade, about {t.R.sum() * RISK:+.1%} of equity before compounding)")


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    score(now) if len(sys.argv) > 1 and sys.argv[1] == "score" else log(now)
