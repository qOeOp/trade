"""Market scan with the validated daily trend rule (trend-v1 T0, long only). Information only: no orders, no account.

Universe: the 150 Binance USDT perpetuals with the highest 24h volume that also trade as Binance spot USDT pairs
(this drops tokenized stocks and commodities) and are not stablecoins. Daily bars from TradingView's Binance perpetual
feed, closed days only. For each coin:
- status: "new signal" (entry signal on the last closed day: buy at the next open), "in trend" (an entry since the last
  exit, still open), or "flat";
- for an open trend: entry day and price, the 2 ATR(20) stop, the exit level (lowest close of the prior 20 days) and the
  open result in R;
- for a flat coin: the entry trigger (highest close of the prior 50 days) and the distance to it.
Writes scan/scan_<date>.csv and scan/scan_<date>.txt.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from tv_prices import fetch  # noqa: E402

TOP, ENTRY_N, EXIT_N, STOP_ATR = 150, 50, 20, 2.0
STABLE = {"USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "EUR", "EURI", "USD1", "XUSD", "BFUSD", "RLUSD", "PYUSD"}


def scanner(kind, n):
    body = {"filter": [{"left": "exchange", "operation": "equal", "right": "BINANCE"},
                       {"left": "currency", "operation": "equal", "right": "USDT"},
                       {"left": "type", "operation": "equal", "right": kind}],
            "columns": ["name", "24h_vol|5"], "sort": {"sortBy": "24h_vol|5", "sortOrder": "desc"}, "range": [0, n]}
    req = urllib.request.Request("https://scanner.tradingview.com/crypto/scan", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return [(x["d"][0], x["d"][1]) for x in json.load(r)["data"]]


def atr(h, l, c, n=20):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def state(d):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    a = atr(h, l, c)
    pos, last_signal = None, None
    for i in range(ENTRY_N, len(c)):
        if pos is not None and i >= pos["e"]:
            if l[i] <= pos["stop"] or c[i] < c[i - EXIT_N:i].min():
                pos = None
            continue
        if pos is None and c[i] > c[i - ENTRY_N:i].max():
            last_signal = i
            entry = o[i + 1] if i + 1 < len(c) else np.nan
            pos = dict(e=i + 1, entry=entry, stop=entry - STOP_ATR * a[i] if i + 1 < len(c) else c[i] - STOP_ATR * a[i],
                       day=d.index[i + 1] if i + 1 < len(c) else None, atr=a[i])
    row = dict(last_close=c[-1], trigger=c[-ENTRY_N:].max(), exit_level=c[-EXIT_N:].min(), atr20=a[-1])
    if pos is None:
        row.update(status="flat", to_trigger=row["trigger"] / c[-1] - 1)
    elif last_signal == len(c) - 1:
        row.update(status="new signal", stop_if_entered_at_close=pos["stop"])
    else:
        risk = pos["entry"] - pos["stop"]
        row.update(status="in trend", entry_day=pos["day"].date(), entry=pos["entry"], stop=pos["stop"],
                   open_R=(c[-1] - pos["entry"]) / risk, days=len(c) - pos["e"])
    return row


def main():
    now = pd.Timestamp(datetime.now(timezone.utc))
    spot = {name[:-4] for name, _ in scanner("spot", 1500) if name.endswith("USDT")}
    perps = [(name[:-6], vol) for name, vol in scanner("swap", 600) if name.endswith("USDT.P")]
    universe = [(b, v) for b, v in perps if b in spot and b not in STABLE][:TOP]
    rows = []
    for base, vol in universe:
        for k in range(3):
            try:
                bars, _err = fetch(f"BINANCE:{base}USDT.P", "1D", 400)
                break
            except Exception:
                bars = []
                time.sleep(2)
        d = pd.DataFrame([(t, *v) for t, v in bars], columns=["time", "open", "high", "low", "close"])
        d = d[d.time + 86400 <= now.timestamp()]
        if len(d) < ENTRY_N + 30:
            continue
        d.index = pd.to_datetime(d.time, unit="s", utc=True)
        rows.append(dict(coin=base, vol_24h_musd=vol / 1e6, history_days=len(d), last_day=d.index[-1].date(), **state(d)))
    z = pd.DataFrame(rows)
    day = z.last_day.max()
    z.to_csv(os.path.join(HERE, f"scan_{day}.csv"), index=False, float_format="%.6g")
    out = [f"Daily trend scan (50-day closing-high breakout, 2 ATR stop, 20-day closing-low exit; long only), closes of {day}",
           f"universe: {len(z)} Binance USDT perpetuals with spot pairs, top {TOP} by 24h volume; information only", ""]
    new = z[z.status == "new signal"].sort_values("vol_24h_musd", ascending=False)
    out.append(f"NEW SIGNALS ({len(new)}): entry at the next daily open")
    for r in new.itertuples():
        out.append(f"  {r.coin:<10} close {r.last_close:<12.6g} stop if filled near close {r.stop_if_entered_at_close:<12.6g} "
                   f"exit level {r.exit_level:<12.6g} 24h vol ${r.vol_24h_musd:,.0f}M")
    held = z[z.status == "in trend"].sort_values("vol_24h_musd", ascending=False)
    out.append(f"\nIN TREND ({len(held)}): entered earlier, still open")
    for r in held.itertuples():
        out.append(f"  {r.coin:<10} since {r.entry_day} ({r.days:3.0f}d) entry {r.entry:<10.6g} close {r.last_close:<10.6g} "
                   f"open {r.open_R:+5.1f}R  stop {r.stop:<10.6g} exit level {r.exit_level:<10.6g} 24h vol ${r.vol_24h_musd:,.0f}M")
    near = z[(z.status == "flat") & (z.to_trigger <= 0.05)].sort_values("to_trigger")
    out.append(f"\nWITHIN 5% OF THE TRIGGER ({len(near)})")
    for r in near.itertuples():
        out.append(f"  {r.coin:<10} close {r.last_close:<12.6g} trigger {r.trigger:<12.6g} ({r.to_trigger:+.1%}) 24h vol ${r.vol_24h_musd:,.0f}M")
    out.append(f"\nflat and more than 5% below the trigger: {int(((z.status == 'flat') & (z.to_trigger > 0.05)).sum())}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, f"scan_{day}.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
