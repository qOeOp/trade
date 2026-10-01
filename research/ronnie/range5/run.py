"""TrialFamily range-v5: is a coin's range-bound character persistent, and does trading boxes by character help?
See INTENT.md. Writes range5/coin_years.csv, range5/events.csv.gz and range5/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
R3, R2 = R4.R3, R4.R2

COINS = R4.MAJORS + R4.LARGE + ("PAXG",)
YEARS = range(2019, 2027)
TOUCH, HORIZON, VR_K = 0.5, 30, 5


def hold_scores(d4, top, bot, a):
    """Per calendar year: share of first box-edge tests where price reached the box middle before a close 1 ATR beyond."""
    h, l, c = (d4[x].values for x in ("high", "low", "close"))
    seen, out = set(), []
    for i in range(R2.W + 21, len(c) - HORIZON):
        t, b, ai = top[i - 1], bot[i - 1], a[i - 1]
        if np.isnan(t):
            continue
        mid = (t + b) / 2
        for side, edge, reach in ((1, t, h[i] >= t - TOUCH * ai), (-1, b, l[i] <= b + TOUCH * ai)):
            key = (round(t, 10), round(b, 10), side)
            if not reach or key in seen:
                continue
            seen.add(key)
            res = None
            for j in range(i, i + HORIZON):
                if (c[j] - edge) * side > ai:
                    res = 0
                    break
                if (l[j] <= mid) if side == 1 else (h[j] >= mid):
                    res = 1
                    break
            if res is not None:
                out.append((d4.index[i].year, res))
    z = pd.DataFrame(out, columns=["year", "held"])
    return z.groupby("year").held.agg(["mean", "count"])


def vr_scores(d1):
    r = np.log(d1.close).diff()
    out = {}
    for y, g in r.groupby(r.index.year):
        g = g.dropna()
        if len(g) < 200:
            continue
        rk = g.rolling(VR_K).sum().dropna()
        out[y] = rk.var() / (VR_K * g.var())
    return pd.Series(out)


def spearman_boot(df, x, y, seed=3, reps=4000):
    rng = np.random.default_rng(seed)
    coins = df.coin.unique()
    point = df[[x, y]].corr(method="spearman").iloc[0, 1]
    b = []
    for _ in range(reps):
        pick = rng.choice(coins, len(coins))
        s = pd.concat([df[df.coin == k] for k in pick])
        b.append(s[[x, y]].corr(method="spearman").iloc[0, 1])
    return point, *np.nanpercentile(b, [2.5, 97.5])


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(97)
    rows, cy = [], []
    for coin in COINS:
        bars = holdout_bars(coin)
        d4 = bars["4h"][["open", "high", "low", "close"]]
        top, bot, a = R2.boxes(d4)
        fade = R2.signals(d4, top, bot, a)["C"]
        brk = R3.x1(d4, top, bot, a)
        for v, s in (("FADE", fade), ("BREAK", brk)):
            rows += [dict(r, trade=v) for r in R2.score(coin, "4h", v, d4, s, a, rng)]
        hs, vr = hold_scores(d4, top, bot, a), vr_scores(bars["1d"])
        for y in sorted(set(hs.index) | set(vr.index)):
            cy.append(dict(coin=coin, year=y, hold=hs["mean"].get(y, np.nan), hold_n=hs["count"].get(y, 0), vr=vr.get(y, np.nan)))
        print(f"{coin}: {sum(r['coin'] == coin for r in rows)} trades", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    ev["year"] = ev.time.dt.year
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    C = pd.DataFrame(cy).sort_values(["coin", "year"])
    C["hold_prev"] = C.groupby("coin").hold.shift(1)
    C["vr_prev"] = C.groupby("coin").vr.shift(1)
    C.loc[C.groupby("coin").year.diff() != 1, ["hold_prev", "vr_prev"]] = np.nan
    fe = ev[ev.trade == "FADE"].groupby(["coin", "year"]).edge.agg(["mean", "count"]).rename(columns={"mean": "fade_edge", "count": "fade_n"})
    C = C.merge(fe, left_on=["coin", "year"], right_index=True, how="left")
    C.to_csv(os.path.join(HERE, "coin_years.csv"), index=False, float_format="%.6g")
    W = C[C.year.isin(YEARS) & C.hold_prev.notna() & C.fade_edge.notna() & (C.fade_n >= 3)].copy()
    W["neg_vr_prev"] = -W.vr_prev
    W["hold_same"] = W.hold
    out = ["range-v5: instrument character as a factor (37 large caps + PAXG, 4h boxes, walk-forward 2019-2026)", ""]
    out.append(f"T1 persistence: {len(W)} coin-years with a prior-year score and at least 3 fades")
    r_h = spearman_boot(W, "hold_prev", "fade_edge")
    r_v = spearman_boot(W.dropna(subset=["neg_vr_prev"]), "neg_vr_prev", "fade_edge")
    r_hh = spearman_boot(C.dropna(subset=["hold_prev", "hold"]), "hold_prev", "hold")
    r_vv = spearman_boot(C.dropna(subset=["vr_prev", "vr"]).assign(a=lambda d: d.vr_prev, b=lambda d: d.vr), "a", "b")
    out.append(f"  prior-year HOLD vs this year's FADE edge: Spearman {r_h[0]:+.3f} [{r_h[1]:+.3f}, {r_h[2]:+.3f}]")
    out.append(f"  prior-year -VR  vs this year's FADE edge: Spearman {r_v[0]:+.3f} [{r_v[1]:+.3f}, {r_v[2]:+.3f}]")
    out.append(f"  does the score itself persist? HOLD year to year {r_hh[0]:+.3f} [{r_hh[1]:+.3f}, {r_hh[2]:+.3f}]; "
               f"VR year to year {r_vv[0]:+.3f} [{r_vv[1]:+.3f}, {r_vv[2]:+.3f}]")
    persists = r_h[1] > 0 or r_v[1] > 0
    out.append(f"  T1 decision: character {'PERSISTS' if persists else 'does not persist'} as a predictor of fade results")
    out.append("")

    def tercile_trades(score, higher_is_range):
        S = C[C.year.isin(YEARS) & C[score].notna()].copy()
        S["rank"] = S.groupby("year")[score].rank(pct=True, ascending=not higher_is_range)  # 1 = most range-bound
        S["third"] = np.where(S["rank"] > 2 / 3, "range third", np.where(S["rank"] <= 1 / 3, "trend third", "middle third"))
        return ev.merge(S[["coin", "year", "third"]], on=["coin", "year"], how="inner")

    for score, label, hi in (("hold_prev", "HOLD", True), ("vr_prev", "VR (not decided)", False)):
        T = tercile_trades(score, hi)
        out.append(f"T2 allocation by prior-year {label}:")
        res = {}
        for trade in ("FADE", "BREAK"):
            allz = T[T.trade == trade]
            lo_a, hi_a = R2.coin_boot(allz)
            out.append(f"  {trade:<5} all coins      n {len(allz):5d}  avg R {allz.R.mean():+.3f}  edge {allz.edge.mean():+.3f} [{lo_a:+.3f}, {hi_a:+.3f}]")
            for third in ("range third", "middle third", "trend third"):
                z = allz[allz.third == third]
                lo, hi_ = R2.coin_boot(z) if z.coin.nunique() > 1 else (np.nan, np.nan)
                out.append(f"  {trade:<5} {third:<14} n {len(z):5d}  avg R {z.R.mean():+.3f}  edge {z.edge.mean():+.3f} [{lo:+.3f}, {hi_:+.3f}]")
                res[(trade, third)] = (lo, z.edge.mean())
            res[(trade, "all")] = (lo_a, allz.edge.mean())
        if score == "hold_prev":
            ok_f = res[("FADE", "range third")][0] > 0 and res[("FADE", "range third")][1] > res[("FADE", "all")][1]
            ok_b = res[("BREAK", "trend third")][0] > 0 and res[("BREAK", "trend third")][1] > res[("BREAK", "all")][1]
            out.append(f"  T2 decision: fade on the range third {'HOLDS' if ok_f else 'fails'}; break on the trend third {'HOLDS' if ok_b else 'fails'}")
        out.append("")
    avg = C[C.year.isin(YEARS)].groupby("coin")[["hold", "vr"]].mean().sort_values("hold", ascending=False)
    out.append("coin character, averaged over years (HOLD: share of box-edge tests reaching the middle; VR(5) of daily returns):")
    out.append("  most range-bound by HOLD: " + ", ".join(f"{k} {r.hold:.2f}/{r.vr:.2f}" for k, r in avg.head(8).iterrows()))
    out.append("  least range-bound:        " + ", ".join(f"{k} {r.hold:.2f}/{r.vr:.2f}" for k, r in avg.tail(8).iterrows()))
    if "PAXG" in avg.index:
        p = avg.loc["PAXG"]
        out.append(f"  PAXG (gold token): HOLD {p.hold:.2f}, VR {p.vr:.2f}; rank {list(avg.index).index('PAXG') + 1} of {len(avg)}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
