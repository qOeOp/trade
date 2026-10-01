"""Amendment-4 diagnosis of loop D-1 (4h box break), iteration tier only; no rule change.
H1 the edge lives in the exit and the target cuts winners: target hits keep running (MFE over the full 30 bars).
H2 false breaks: stopped trades come from narrow boxes or small breakout bars.
H3 beta: the edge sits in longs during strong BTC trends, and random entries show the same.
Plus case review (20 worst, 20 best) and ablations of the exit and stop (logged as 'ablation' trials).
Writes loop/diagnose_d.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_d as FD  # noqa: E402


def context(z):
    rows = []
    for t in z.itertuples():
        d = E.bars(t.coin)["4h"]
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        a = E.MT.atr_of(h, l, c)
        top, bot, _ = FD.R3.R2.boxes(d[["open", "high", "low", "close"]])
        e = d.index.get_loc(t.time)
        i = e - 1
        width = (top[i - 1] - bot[i - 1]) / a[i - 1]
        body = abs(c[i] - o[i]) / a[i - 1]
        entry = o[e]
        risk = t.stop_atr * a[e - 1]
        tgt = entry + t.side * t.target_R * risk
        hit_t, mfe30 = None, 0.0
        for j in range(e, min(e + 30, len(c))):
            fav = ((h[j] - entry) if t.side == 1 else (entry - l[j])) / risk
            mfe30 = max(mfe30, fav)
            if hit_t is None and j > e and ((h[j] >= tgt) if t.side == 1 else (l[j] <= tgt)):
                hit_t = j - e
        rows.append(dict(width=width, body=body, hit_target=hit_t is not None, mfe30=mfe30, vol=v[i] / np.nanmean(v[max(0, i - 20):i])))
    return pd.concat([z.reset_index(drop=True), pd.DataFrame(rows)], axis=1)


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "D-1_iteration.csv.gz"), parse_dates=["time"])
    z = context(z)
    z["edge"] = z.R - z.control
    z["stopped"] = z.R <= -0.9
    out = ["Diagnosis of D-1 (iteration tier, 126 trades)", ""]
    cols = ["coin", "time", "side", "R", "edge", "target_R", "width", "body", "vol", "btc_trend", "mfe30"]
    fmt = lambda q: q[cols].assign(time=q.time.dt.strftime("%Y-%m-%d %H")).round(2).to_string(index=False)  # noqa: E731
    out += ["worst 20:", fmt(z.nsmallest(20, "R")), "", "best 20:", fmt(z.nlargest(20, "R")), ""]
    th = z[z.hit_target]
    out.append(f"H1: {len(th)} trades hit the target (median target {th.target_R.median():.2f}R); their median MFE over the full "
               f"30 bars is {th.mfe30.median():.2f}R, {np.mean(th.mfe30 >= 2 * th.target_R):.0%} reached twice the target")
    for col, lab in (("width", "box width (ATR)"), ("body", "breakout bar body (ATR)"), ("vol", "breakout bar volume / 20-bar mean")):
        a, b = z[z.stopped][col], z[~z.stopped][col]
        out.append(f"H2 {lab:<34} stopped median {a.median():.2f} (n {len(a)})   not stopped {b.median():.2f} (n {len(b)})")
    for sd in (1, -1):
        k = z[z.side == sd]
        out.append(f"H3 side {sd:+d}: n {len(k)}, edge {k.edge.mean():+.3f}")
    out.append(attrib.beta_check(z, "btc_trend", E.ITER_COINS, "4h", hold=30, stop_atr=2.0, target_r=1.0, step=6))
    out.append("")
    out.append("ablation (iteration tier):")
    for name, mode in (("time exit only (no target, 30 bars)", "notarget"), ("stop 1 ATR beyond the broken edge", "edgestop"),
                       ("no entry-beyond-middle condition", "nomid")):
        fn = ablation(mode)
        za = E.run(f"D-1 ablation: {name}", fn, "4h", 30, ("iter",))
        passed, st = E.iteration_gate(za)
        E.log("D-1", f"ablation: {name}", "ablation", st, passed)
        out.append(f"  {name:<38} {E.fmt(st)}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "diagnose_d.txt"), "w").write(text + "\n")


def ablation(mode):
    R3 = FD.R3

    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        o, c = d.open.values, d.close.values
        top, bot, a = R3.R2.boxes(d)
        out, used = [], set()
        for i in range(R3.R2.W + 21, len(c) - 1):
            t, b = top[i - 1], bot[i - 1]
            if np.isnan(t):
                continue
            for side, edge in ((1, t), (-1, b)):
                key = (round(t, 10), round(b, 10), side)
                if key in used or (c[i] - edge) * side <= 0:
                    continue
                used.add(key)
                mid, width = (t + b) / 2, t - b
                entry = o[i + 1]
                if mode != "nomid" and (entry - mid) * side <= 0:
                    continue
                stop = edge - side * a[i - 1] if mode == "edgestop" else mid
                if (entry - stop) * side <= 0:
                    continue
                tgt = entry + side * (1e6 if mode == "notarget" else width)
                if mode == "notarget":
                    tgt = entry + side * 1000 * abs(entry - stop)
                out.append((i + 1, side, entry, stop, tgt))
        return out
    return fn


if __name__ == "__main__":
    main()
