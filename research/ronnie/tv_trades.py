"""Quality of Ronnie's declared entries and exits: is the shortfall in where he gets in, or in his stops and targets?

Trades: tv/trades_annot.csv (hand-annotated from each idea's title, text and drawings; one row per idea, blank side =
no unconditional trade). Prices: tv/hourly/<uuid>.csv.gz (tv_hourly.py). Unit: ATR(14) of the chart he drew on, at
publish. Horizon: 30 bars of that chart (hourly bars counted as traded: 1W = 168 crypto / 120 FX hourly bars).

Fill model (conservative): market entries at his chart's last price at publish, evaluated from the next full hour;
limits fill only when traded through, at the limit or a better open, and are cancelled if TP1 trades first; on the fill
bar only the stop is checked; when stop and target share a bar the stop wins. Gross of costs.

Decomposition, mean result per trade:
                  his exits   hold 30 bars   hold 10 bars
  his entry           A            B              C
  random entry        A0           B0             C0
Random entries: same symbol, same side, a random hour in the 90 days before he published, with his target and stop
distances (in ATR) carried over. Entry effect = A - A0 (and B - B0); exit effect = A - B.
"""
import csv, gzip, os, sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tv_calibrate import load_ideas  # noqa: E402

CAP = 30
BAR_H = {"60": 1, "240": 4, "1D": 24}
RANDOM_N = 200
RNG = np.random.default_rng(11)
CRYPTO_SRC = ("bitstamp", "binance")


def bar_hours(interval, crypto):
    return BAR_H.get(interval) or (168 if crypto else 120)


def arrow_extreme(I, side):
    ends = [d["anchors"][-1]["price"] for d in I["draws"] if d["type"] == "LineToolArrow" and len(d["anchors"]) >= 2]
    if not ends:
        return None
    return max(ends) if side == 1 else min(ends)


def level(v, I, side, E):
    if v in ("", None):
        return None
    if v == "A":
        return arrow_extreme(I, side)
    if v.startswith("E+"):
        return E + float(v[2:])
    return float(v)


def simulate(o, h, l, c, i0, side, E, tp, sl, cap, limit=None):
    """-> dict(filled, entry, exit, why, i_fill, i_exit, mfe, mae) in price; i0 = first bar after publish."""
    n = len(c)
    end = min(n - 1, i0 + cap)
    i_fill, entry = None, None
    if limit is None:
        i_fill, entry = i0, E
        fresh = False  # market entry happened before bar i0 opened: bar i0 is a normal bar
    else:
        for i in range(i0, end + 1):
            if tp is not None and (side == 1 and h[i] >= tp or side == -1 and l[i] <= tp):
                return dict(filled=False, why="tp_before_fill")
            if side == 1 and l[i] < limit or side == -1 and h[i] > limit:
                i_fill, entry = i, (min(limit, o[i]) if side == 1 else max(limit, o[i]))
                break
        if i_fill is None:
            return dict(filled=False, why="never_filled")
        fresh = True
    mfe = mae = 0.0
    for i in range(i_fill, end + 1):
        hit_sl = sl is not None and (side == 1 and l[i] <= sl or side == -1 and h[i] >= sl)
        hit_tp = tp is not None and not (fresh and i == i_fill) and (side == 1 and h[i] >= tp or side == -1 and l[i] <= tp)
        fav = (h[i] - entry) if side == 1 else (entry - l[i])
        adv = (entry - l[i]) if side == 1 else (h[i] - entry)
        if hit_sl:
            px = sl if (fresh and i == i_fill) else (min(sl, o[i]) if side == 1 else max(sl, o[i]))
            mae = max(mae, adv)
            return dict(filled=True, entry=entry, exit=px, why="sl", i_fill=i_fill, i_exit=i, mfe=mfe, mae=mae)
        mfe, mae = max(mfe, fav), max(mae, adv)
        if hit_tp:
            px = max(tp, o[i]) if side == 1 else min(tp, o[i])
            return dict(filled=True, entry=entry, exit=px, why="tp", i_fill=i_fill, i_exit=i, mfe=mfe, mae=mae)
    return dict(filled=True, entry=entry, exit=c[end], why="time", i_fill=i_fill, i_exit=end, mfe=mfe, mae=mae)


def load():
    ideas = {I["it"]["uuid"]: I for I in load_ideas()}
    scale = pd.read_csv(f"{HERE}/tv/hourly/scale.csv").set_index("uuid")
    out = []
    for r in csv.DictReader(open(f"{HERE}/tv/trades_annot.csv")):
        if not r["side"]:
            continue
        path = f"{HERE}/tv/hourly/{r['uuid']}.csv.gz"
        if not os.path.exists(path):
            continue
        I = ideas[r["uuid"]]
        d = pd.read_csv(gzip.open(path, "rt"))
        side = 1 if r["side"] == "L" else -1
        E = I["c"][-1]
        crypto = str(scale.loc[r["uuid"], "source"]).startswith(CRYPTO_SRC)
        m = bar_hours(I["it"]["interval"], crypto)
        pub = int(pd.Timestamp(I["it"]["created_at"]).value // 10**9)
        out.append(dict(r=r, I=I, side=side, E=E, atr=I["atr"], m=m, cap=CAP * m, pub=pub, crypto=crypto,
                        t=d.time.values, o=d.open.values, h=d.high.values, l=d.low.values, c=d.close.values,
                        i0=int(np.searchsorted(d.time.values, pub, side="left")),
                        limit=float(r["limit"]) if r["limit"] else None, now=r["now"] == "1"))
    return out


def trade_rows(T):
    rows = []
    for x in T:
        r, I, s, E, a = x["r"], x["I"], x["side"], x["E"], x["atr"]
        o, h, l, c, i0, cap = x["o"], x["h"], x["l"], x["c"], x["i0"], x["cap"]
        if i0 + cap >= len(c):
            continue
        tp1, tpf, sl = level(r["tp1"], I, s, E), level(r["tp_final"], I, s, E), level(r["sl"], I, s, E)
        decl_limit = x["limit"] if not x["now"] else None  # his primary instruction
        res = lambda tp, sl_, lim=None, cap_=cap: simulate(o, h, l, c, i0, s, E, tp, sl_, cap_, lim)  # noqa: E731
        R = lambda z: s * (z["exit"] - z["entry"]) / a if z.get("filled") else np.nan  # noqa: E731
        his = res(tp1, sl, decl_limit)
        row = dict(uuid=r["uuid"], date=I["it"]["created_at"][:10], symbol=I["it"]["short"], tf=I["it"]["interval"],
                   side=s, crypto=x["crypto"], entry_kind="limit" if decl_limit else "market",
                   tp1_atr=s * (tp1 - (decl_limit or E)) / a if tp1 else np.nan, sl_atr=s * ((decl_limit or E) - sl) / a if sl else np.nan,
                   tp_src=r["tp_src"], has_sl=sl is not None, filled=his["filled"], why=his["why"], A=R(his),
                   self_label=next((u["value"] for u in I["it"]["updates"] if u["type"] != "comment" and u["value"] != "active"), ""))
        row["A_final"] = R(res(tpf, sl, decl_limit))
        # hold from his entry (same fill), no stop or target
        hold = res(None, None, decl_limit)
        row["B"] = R(hold)
        hold10 = res(None, None, decl_limit, 10 * x["m"])
        row["C"] = R(hold10)
        # market entry at publish with his exits: isolates what waiting for his limit did
        mkt = res(tp1, sl)
        row["A_mkt"], row["B_mkt"] = R(mkt), R(res(None, None))
        # forward returns from a market entry at publish, in ATR, and excursions
        for k in (1, 3, 5, 10, 20):
            j = i0 + k * x["m"] - 1
            row[f"fwd{k}"] = s * (c[j] - E) / a
        seg = slice(i0, i0 + 10 * x["m"])
        row["mfe10"] = (h[seg].max() - E) / a if s == 1 else (E - l[seg].min()) / a
        row["mae10"] = (E - l[seg].min()) / a if s == 1 else (h[seg].max() - E) / a
        # diagnostics on his own exits
        if his.get("filled"):
            k0, k1 = his["i_fill"], his["i_exit"]
            end = min(len(c) - 1, k0 + cap)
            if his["why"] == "sl" and tp1 is not None:
                after = slice(k1, end + 1)
                row["stopped_then_tp"] = bool(h[after].max() >= tp1) if s == 1 else bool(l[after].min() <= tp1)
            if his["why"] == "tp":
                after = slice(k1, end + 1)
                row["beyond_tp_atr"] = (h[after].max() - tp1) / a if s == 1 else (tp1 - l[after].min()) / a
            if his["why"] == "time" and tp1 is not None:
                row["mfe_share_of_tp"] = his["mfe"] / abs(tp1 - his["entry"])
        # random-time control entries: market, same side, same tp/sl distances
        lo_t = x["pub"] - 90 * 86400
        cand = np.where((x["t"] >= lo_t) & (x["t"] < x["pub"] - 3600))[0]
        cand = cand[cand + cap < len(c)]
        if len(cand) >= 20:
            picks = RNG.choice(cand, size=min(RANDOM_N, len(cand)), replace=len(cand) < RANDOM_N)
            dtp = s * (tp1 - (decl_limit or E)) if tp1 else None
            dsl = s * ((decl_limit or E) - sl) if sl else None
            acc = defaultdict(list)
            for i in picks:
                e = o[i]
                z = simulate(o, h, l, c, i, s, e, e + s * dtp if dtp else None, e - s * dsl if dsl else None, cap)
                acc["A0"].append(s * (z["exit"] - e) / a)
                acc["B0"].append(s * (c[i + cap] - e) / a)
                acc["C0"].append(s * (c[i + 10 * x["m"]] - e) / a)
                for k in (1, 3, 5, 10, 20):
                    acc[f"fwd{k}_0"].append(s * (c[i + k * x["m"] - 1] - e) / a)
                acc["tp_rate0"].append(z["why"] == "tp")
            row.update({k: float(np.mean(v)) for k, v in acc.items()})
        rows.append(row)
    return pd.DataFrame(rows)


def mean_ci(v, n_boot=2000):
    v = np.asarray(v, float)
    v = v[~np.isnan(v)]
    if len(v) < 3:
        return f"{np.nanmean(v) if len(v) else np.nan:+.2f} (n={len(v)})"
    b = RNG.choice(v, size=(n_boot, len(v))).mean(1)
    return f"{v.mean():+.2f} [{np.percentile(b, 2.5):+.2f},{np.percentile(b, 97.5):+.2f}] n={len(v)}"


def report(df):
    out = [f"{len(df)} declared trades with hourly prices ({(df.entry_kind == 'limit').sum()} limit, "
           f"{(df.entry_kind == 'market').sum()} market; {df.has_sl.sum()} with a stated stop)", ""]
    f = df[df.filled]
    out.append("Decomposition (mean ATR per trade, 95% bootstrap interval), filled trades with controls:")
    g = f.dropna(subset=["A0"])
    for k, lab in (("A", "his entry + his exits"), ("B", "his entry + hold 30 bars"), ("C", "his entry + hold 10 bars"),
                   ("A0", "random entry + his exits"), ("B0", "random entry + hold 30 bars"), ("C0", "random entry + hold 10 bars")):
        out.append(f"  {lab:<30} {mean_ci(g[k])}")
    out.append(f"  entry effect under his exits  A-A0 {mean_ci(g.A - g.A0)}")
    out.append(f"  entry effect under holding    B-B0 {mean_ci(g.B - g.B0)}")
    out.append(f"  exit effect on his entries    A-B  {mean_ci(g.A - g.B)}")
    out.append(f"  exit effect on random entries A0-B0 {mean_ci(g.A0 - g.B0)}")
    gm = g[g.entry_kind == "market"]
    out.append(f"  market entries only (n={len(gm)}): A {gm.A.mean():+.2f}  B {gm.B.mean():+.2f}  A0 {gm.A0.mean():+.2f}  B0 {gm.B0.mean():+.2f}"
               f"  entry effect A-A0 {mean_ci(gm.A - gm.A0)}")
    out.append("")
    lab = df[df.self_label != ""]
    if len(lab):
        out.append("His own closing labels vs the prices (TP1 within 30 bars, stop checked first):")
        for v, z in lab.groupby("self_label"):
            out.append(f"  labelled {v:<15} n={len(z):2d}: simulated TP1 {np.mean(z.why == 'tp'):.0%}, stop {np.mean(z.why == 'sl'):.0%}, "
                       f"time {np.mean(z.why == 'time'):.0%}, not filled {np.mean(~z.filled):.0%}")
        out.append(f"  unlabelled trades n={(df.self_label == '').sum()}: simulated TP1 {np.mean(df[df.self_label == ''].why == 'tp'):.0%}")
        out.append("")
    out.append("Entry timing, market entry at publish for every trade (signed forward return in ATR):")
    h = df.dropna(subset=["fwd1_0"])
    for k in (1, 3, 5, 10, 20):
        out.append(f"  after {k:>2} bars: his {mean_ci(h[f'fwd{k}'])}   random {h[f'fwd{k}_0'].mean():+.2f}   "
                   f"his-random {mean_ci(h[f'fwd{k}'] - h[f'fwd{k}_0'])}   his > 0: {np.mean(h[f'fwd{k}'] > 0):.0%}")
    out.append(f"  first 10 bars: max favourable {df.mfe10.median():.2f} ATR, max adverse {df.mae10.median():.2f} ATR (medians)")
    out.append("")
    lim = df[df.entry_kind == "limit"]
    if len(lim):
        out.append(f"Limit entries ({len(lim)}): filled {lim.filled.mean():.0%}; not filled because TP traded first "
                   f"{(lim.why == 'tp_before_fill').mean():.0%}, never reached {(lim.why == 'never_filled').mean():.0%}")
        out.append(f"  with his exits: limit {mean_ci(lim.A.fillna(0))} (unfilled = 0)  vs market at publish {mean_ci(lim.A_mkt)}")
        out.append(f"  holding 30 bars: limit {mean_ci(lim.B.fillna(0))} vs market {mean_ci(lim.B_mkt)}")
        out.append("")
    out.append("His exits on his own entries:")
    out.append(f"  outcome: TP1 {np.mean(f.why == 'tp'):.0%}, stop {np.mean(f.why == 'sl'):.0%}, time {np.mean(f.why == 'time'):.0%}"
               f"  (random entries with the same distances reach TP1 {g.tp_rate0.mean():.0%})")
    out.append(f"  TP1 distance median {f.tp1_atr.median():.1f} ATR (quartiles {f.tp1_atr.quantile(.25):.1f}-{f.tp1_atr.quantile(.75):.1f});"
               f" stated stop distance median {f.sl_atr.median():.1f} ATR over {f.has_sl.sum()} trades")
    if "stopped_then_tp" in f:
        s_ = f.stopped_then_tp.dropna()
        out.append(f"  stopped out, then TP1 traded within the horizon: {s_.mean():.0%} of {len(s_)} stops")
    if "beyond_tp_atr" in f:
        b = f.beyond_tp_atr.dropna()
        out.append(f"  after TP1: price went a further {b.median():.1f} ATR (median) beyond it within the horizon; "
                   f"more than 2 ATR in {np.mean(b > 2):.0%}")
    if "mfe_share_of_tp" in f:
        m = f.mfe_share_of_tp.dropna()
        out.append(f"  timed out: best excursion reached {m.median():.0%} of the TP1 distance (median) over {len(m)} trades")
    out.append(f"  TP1 vs final target: {mean_ci(f.A)} vs {mean_ci(f.A_final)}")
    out.append("")
    out.append("By group (A = his entry + his exits; B = hold 30 bars; A0 = random entry + his exits):")
    for name, mask in (("crypto", f.crypto), ("FX/metals/oil/index", ~f.crypto), ("1D/1W charts", f.tf.isin(["1D", "1W"])),
                       ("4h/1h charts", f.tf.isin(["240", "60"])), ("stated stop", f.has_sl), ("no stated stop", ~f.has_sl),
                       ("2018", f.date < "2019"), ("2019-2021", f.date >= "2019")):
        z = f[mask]
        out.append(f"  {name:<20} n={len(z):3d}  A {z.A.mean():+.2f}  B {z.B.mean():+.2f}  A0 {z.A0.mean():+.2f}  B0 {z.B0.mean():+.2f}")
    return out


if __name__ == "__main__":
    df = trade_rows(load())
    df.to_csv(f"{HERE}/results/tv_trades.csv", index=False)
    text = "\n".join(x.rstrip() for x in report(df))
    print(text)
    open(f"{HERE}/results/tv_trades.txt", "w").write(text + "\n")
