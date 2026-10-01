"""Amendment-4 diagnosis of loop E-1 (4h box fade), iteration tier only; no rule change.
H1 regime: fades against the daily trend lose (signature: edge by alignment of the fade with the daily trend).
H2 entry timing: fades after a sweep beyond the edge win (signature: signal bar's wick beyond the edge).
H3 box quality: more touches and longer-lived boxes hold (signature: edge by touches of the faded edge and box age).
H4 stop hunts: price returns inside the box soon after the stop (signature: re-entry within 6 bars of the stop).
Plus case review, beta check and ablations (logged as 'ablation'). Writes loop/diagnose_e.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402

R2 = E.R2


def context(z):
    rows = []
    cache = {}
    for t in z.itertuples():
        if t.coin not in cache:
            d = E.bars(t.coin)["4h"][["open", "high", "low", "close"]]
            top, bot, a = R2.boxes(d)
            d1 = E.bars(t.coin)["1d"].close
            trend = np.sign(d1 - d1.rolling(50).mean())
            trend.index = trend.index + pd.Timedelta(days=1)
            cache[t.coin] = (d, top, bot, a, trend.reindex(d.index, method="ffill").values)
        d, top, bot, a, tr = cache[t.coin]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        e = d.index.get_loc(t.time)
        i = e - 1
        tp, bt, ai = top[i], bot[i], a[i - 1]
        edge = bt if t.side == 1 else tp
        swept = (l[i] < bt) if t.side == 1 else (h[i] > tp)
        win = (l[i - R2.W:i], h[i - R2.W:i])
        touches = R2.touches(win[0], edge, ai, False) if t.side == 1 else R2.touches(win[1], edge, ai, True)
        age = 0
        while i - age - 1 > 0 and not np.isnan(top[i - age - 1]) and abs(top[i - age - 1] - tp) < 0.25 * ai and abs(bot[i - age - 1] - bt) < 0.25 * ai:
            age += 1
        stop = edge - t.side * R2.PAD * ai
        reentry = np.nan
        for j in range(e, min(e + 30, len(c))):
            if (l[j] <= stop) if t.side == 1 else (h[j] >= stop):
                back = [(c[k] > bt) if t.side == 1 else (c[k] < tp) for k in range(j + 1, min(j + 7, len(c)))]
                reentry = float(any(back))
                break
        rows.append(dict(align=t.side * tr[i], swept=bool(swept), touches=touches, box_age=age, reentry=reentry))
    return pd.concat([z.reset_index(drop=True), pd.DataFrame(rows)], axis=1)


def split(z, m, lab):
    return (f"  {lab:<44} yes: edge {z.edge[m].mean():+.3f} (n {int(m.sum())}), stopped {z.stopped[m].mean():.0%}   "
            f"no: edge {z.edge[~m].mean():+.3f} (n {int((~m).sum())}), stopped {z.stopped[~m].mean():.0%}")


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "E-1_iteration.csv.gz"), parse_dates=["time"])
    z = context(z)
    z["edge"] = z.R - z.control
    z["stopped"] = z.R <= -0.9
    out = ["Diagnosis of E-1 (4h box fade, iteration tier)", ""]
    cols = ["coin", "time", "side", "R", "edge", "target_R", "align", "swept", "touches", "box_age", "reentry"]
    fmt = lambda q: q[cols].assign(time=q.time.dt.strftime("%Y-%m-%d %H")).round(2).to_string(index=False)  # noqa: E731
    out += ["worst 20:", fmt(z.nsmallest(20, "R")), "", "best 20:", fmt(z.nlargest(20, "R")), ""]
    out.append("competing explanations:")
    out.append(split(z, z["align"] > 0, "H1 fade with the daily trend"))
    out.append(split(z, z.swept, "H2 signal bar swept beyond the edge"))
    out.append(split(z, z.touches >= 3, "H3 faded edge touched 3+ times"))
    out.append(split(z, z.box_age >= z.box_age.median(), f"H3 box age at least the median ({z.box_age.median():.0f} bars)"))
    st = z[z.stopped]
    out.append(f"  H4 stopped trades whose price closed back inside the box within 6 bars: {st.reentry.mean():.0%} (n {st.reentry.notna().sum()})")
    out.append(attrib.beta_check(z, "btc_trend", E.ITER_COINS, "4h", hold=30, stop_atr=1.5, target_r=2.0, step=6))
    out.append("")
    out.append("ablation (iteration tier):")
    for name, mode in (("target at the box middle", "mid"), ("stop 1.5 ATR beyond the edge", "wide"),
                       ("no close-in-outer-half condition", "noclose")):
        fn = ablation(mode)
        za = E.run(f"E-1 ablation: {name}", fn, "4h", 30, ("iter",))
        passed, s = E.iteration_gate(za)
        E.log("E-1", f"ablation: {name}", "ablation", s, passed)
        out.append(f"  {name:<38} {E.fmt(s)}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "diagnose_e.txt"), "w").write(text + "\n")


def ablation(mode):
    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        top, bot, a = R2.boxes(d)
        out, last = [], {1: -99, -1: -99}
        for i in range(R2.W + 20, len(c) - 1):
            if np.isnan(top[i]):
                continue
            t, b, ai = top[i], bot[i], a[i - 1]
            for side, edge, far in ((1, b, t), (-1, t, b)):
                pad = 1.5 if mode == "wide" else R2.PAD
                stop = edge - side * pad * ai
                tgt = (t + b) / 2 if mode == "mid" else far - side * R2.TP_PAD * ai
                rg = h[i] - l[i]
                if rg <= 0 or i - last[side] < R2.SPACING:
                    continue
                near = (l[i] <= edge + R2.TOUCH * ai) if side == 1 else (h[i] >= edge - R2.TOUCH * ai)
                closeok = True if mode == "noclose" else (((c[i] - l[i]) / rg >= 0.5) if side == 1 else ((h[i] - c[i]) / rg >= 0.5))
                if near and closeok and (o[i + 1] - stop) * side > 0:
                    out.append((i + 1, side, o[i + 1], stop, tgt))
                    last[side] = i
        return out
    return fn


if __name__ == "__main__":
    main()
