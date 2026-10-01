"""Forward record of the frozen crypto entries: log each new signal before its outcome can be known. No orders.

Usage: python combo/forward.py          append new signals to combo/forward/signals.csv
       python combo/forward.py score    score the logged signals whose horizon has passed

Strategies: B1 (S2b breakout), trendline_break_strong and line_break_ridge, plus (from 2026-10-01) B1 with the time-only
exit (b1_time), the 4h box breakout (box_break), oversold O3 (oversold_o3) and, from 2026-10-02, the R&D loop's
idiosyncratic capitulation C-6 (oversold_idio) and the time-exit trend-line break F-2 (trendline_time), frozen as committed (their sha256 is
logged with every signal). Coins: BTC, ETH and the 15 coins of altcoins-v1, against USDT on Binance. Bars: Binance
public hourly klines for history, plus TradingView's feed for the latest bars. The 4h bar still forming is dropped.
Clean by construction, whatever the run frequency: each logged signal enters at the first 4h open after it was
logged, never at its own next open. The signal's stop, target and time limit are kept. A signal whose stop or target
has already traded by logging time is recorded as "void". The commit that adds a row is its timestamp proof. Scoring
uses the harness fill model and random controls; rows committed later than logged_at + 1 hour are excluded.
"""
import csv, hashlib, os, subprocess, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (HERE, os.path.join(HERE, "candidates"), ROOT):
    sys.path.insert(0, p)
import b1_time as C4  # noqa: E402
import box_break as C5  # noqa: E402
import harness as H  # noqa: E402
import line_break_ridge as C3  # noqa: E402
import oversold_idio as C7  # noqa: E402
import oversold_o3 as C6  # noqa: E402
import trendline_break_strong as C2  # noqa: E402
import trendline_time as C8  # noqa: E402
import tv_hourly  # noqa: E402
from portfolio import b1_signals  # noqa: E402
from tv_prices import fetch  # noqa: E402

COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
LOG = os.path.join(HERE, "forward", "signals.csv")
FIELDS = ["logged_at", "coin", "strategy", "signal_time", "side", "stop", "target", "max_bars", "entry_time", "status",
          "last_price", "code_sha"]
LOOKBACK = pd.Timedelta(days=7)
STRATS = {"B1": (b1_signals, os.path.join(ROOT, "ronnie_bt.py")),
          "trendline": (C2.signals, os.path.join(HERE, "candidates", "trendline_break_strong.py")),
          "ridge": (C3.signals, os.path.join(HERE, "candidates", "line_break_ridge.py")),
          "b1_time": (C4.signals, os.path.join(HERE, "candidates", "b1_time.py")),
          "box_break": (C5.signals, os.path.join(HERE, "candidates", "box_break.py")),
          "oversold_o3": (C6.signals, os.path.join(HERE, "candidates", "oversold_o3.py")),
          "oversold_idio": (C7.signals, os.path.join(HERE, "candidates", "oversold_idio.py")),
          "trendline_time": (C8.signals, os.path.join(HERE, "candidates", "trendline_time.py"))}
CALENDAR = os.path.join(ROOT, "events", "calendar.csv")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def hourly(coin, now):
    t0 = int(pd.Timestamp("2017-07-01").value // 10**9)
    a = tv_hourly.binance(f"{coin}USDT", t0, int(now.timestamp()), volume=True)
    b, _err = fetch(f"BINANCE:{coin}USDT", "60", 5000, volume=True)
    r = pd.DataFrame([(t, *v) for t, v in b], columns=["time", "open", "high", "low", "close", "volume"])
    h = pd.concat([a, r]).drop_duplicates("time", keep="last").sort_values("time")
    # keep whole 4h bars only: the 4h bar still forming is dropped with all its hours (daily and weekly lines are
    # read only once closed, by construction of the candidates)
    h = h[h.time < int(now.floor("4h").timestamp())]
    gap = h.time[h.time >= h.time.iloc[-1] - 400 * 86400].diff().max()
    if gap > 12 * 3600 or h.time.iloc[-1] + 5 * 3600 < now.timestamp():
        raise RuntimeError(f"{coin}: hourly bars incomplete (largest gap {gap / 3600:.0f}h, last bar {h.time.iloc[-1]})")
    h.index = pd.to_datetime(h.time, unit="s", utc=True)
    return h


def next_4h_open(t):
    return (t.floor("4h") + pd.Timedelta(hours=4)).tz_convert("UTC")


def log_new(now):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    seen = set()
    if os.path.exists(LOG):
        with open(LOG) as f:
            seen = {(r["coin"], r["strategy"], r["signal_time"], r["side"]) for r in csv.DictReader(f)}
    new = []
    for coin in COINS:
        bars = H._resample(hourly(coin, now))
        d1h = bars["1h"]
        last = float(d1h.close.iloc[-1])
        for name, (fn, path) in STRATS.items():
            for s in fn(bars):
                if s.time < now - LOOKBACK:
                    continue
                key = (coin, name, str(s.time), str(s.side))
                if key in seen:
                    continue
                after = d1h[d1h.index + pd.Timedelta(hours=1) > s.time]
                hit_stop = ((after.low <= s.stop) if s.side == 1 else (after.high >= s.stop)).any()
                hit_tgt = ((after.high >= s.target) if s.side == 1 else (after.low <= s.target)).any()
                new.append(dict(logged_at=now.isoformat(), coin=coin, strategy=name, signal_time=str(s.time), side=s.side,
                                stop=s.stop, target=s.target, max_bars=s.max_bars, entry_time=str(next_4h_open(now)),
                                status="void" if hit_stop or hit_tgt else "open", last_price=last, code_sha=sha(path)))
        print(f"{coin}: bars to {d1h.index[-1]}", flush=True)
    write_header = not os.path.exists(LOG)
    with open(LOG, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        if write_header:
            w.writeheader()
        w.writerows(new)
    print(f"logged {len(new)} new signals ({sum(r['status'] == 'open' for r in new)} open, "
          f"{sum(r['status'] == 'void' for r in new)} void)")


def commit_times():
    try:
        out = subprocess.run(["git", "blame", "--line-porcelain", os.path.basename(LOG)], cwd=os.path.dirname(LOG),
                             capture_output=True, text=True, check=True).stdout
    except Exception:
        return {}
    times, sha_, line, t = {}, None, None, None
    for x in out.splitlines():
        p = x.split()
        if x.startswith("\t"):
            times[line] = None if sha_ == "0" * 40 else t
        elif len(p) >= 3 and len(p[0]) == 40 and p[1].isdigit():
            sha_, line = p[0], int(p[2])
        elif p and p[0] == "committer-time":
            t = int(p[1])
    return times


def score(now):
    rows = list(csv.DictReader(open(LOG)))
    ct = commit_times()
    out, cache = [], {}
    for n, r in enumerate(rows, start=2):
        if r["status"] != "open":
            continue
        logged = pd.Timestamp(r["logged_at"])
        if ct.get(n) is None or ct[n] > logged.timestamp() + 3600:
            continue  # not committed yet, or committed too late to prove it preceded the outcome
        if r["coin"] not in cache:
            cache[r["coin"]] = H._resample(hourly(r["coin"], now))
        bars = cache[r["coin"]]
        entry = pd.Timestamp(r["entry_time"])
        # score as a signal on the 4h bar that closes at the entry time
        sig = H.Signal(entry, int(r["side"]), float(r["stop"]), float(r["target"]), int(r["max_bars"]))
        df = H.score(bars, [sig], seed=n)
        if not df.empty:
            out.append(df.assign(coin=r["coin"], strategy=r["strategy"]))
    if not out:
        print("no matured, committed signals yet")
        return
    ev = pd.concat(out)
    for name, g in ev.groupby("strategy"):
        print(H.summary(g, f"forward {name}"))
    # events-v1 observations: entries on CPI day or the next, and within a day of an FOMC decision
    cal = pd.read_csv(CALENDAR, parse_dates=["date"])
    day = pd.to_datetime(ev.time).dt.tz_convert(None).dt.normalize()
    near = lambda name, offs: day.isin({d + pd.Timedelta(days=k) for d in cal[cal.event == name].date for k in offs})  # noqa: E731
    for label, m in (("CPI day or next", near("CPI", (0, 1))), ("FOMC +-1 day", near("FOMC", (-1, 0, 1)))):
        for name, g in ev[m.values].groupby("strategy"):
            print(f"  {label}: {name} n {len(g)} avg R {g.R.mean():+.3f} (rest {ev[(~m.values) & (ev.strategy == name)].R.mean():+.3f})")


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    score(now) if len(sys.argv) > 1 and sys.argv[1] == "score" else log_new(now)
