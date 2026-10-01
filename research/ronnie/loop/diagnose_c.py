"""Amendment-4 diagnosis of loop C-4 (no rule change): case review, competing explanations H1-H3, ablation.
H1 market still crashing: losers show a larger concurrent BTC drop and more coins signalling together.
H2 longs not flushed: losers show positive funding at the signal.
H3 idiosyncratic collapse: losers show a larger coin-minus-BTC drop.
Writes loop/diagnose_c.txt; ablation runs are logged in the census as stage 'ablation'."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_c as FC  # noqa: E402


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "C-4_iteration.csv.gz"), parse_dates=["time"])
    z["edge"] = z.R - z.control
    btc = E.bars("BTC")["1d"].close
    fund = pd.concat([pd.read_csv(os.path.join(E.ROOT, "carry", "daily.csv.gz"), index_col=0, parse_dates=True)
                      .reset_index().rename(columns={"index": "date"})[["date", "coin", "fund"]],
                      pd.read_csv(os.path.join(HERE, ".cache", "funding_ext.csv.gz"), parse_dates=["date"])])
    fund = fund.set_index(["coin", "date"]).fund.sort_index()
    rows = []
    for t in z.itertuples():
        day = t.time.tz_convert(None).normalize() - pd.Timedelta(days=1)  # the signal day
        d = E.bars(t.coin)["1d"].close
        d.index = d.index.tz_convert(None)
        b = btc.copy()
        b.index = b.index.tz_convert(None)
        k = d.index.get_loc(day)
        coin_drop = min(d.iloc[k] / d.iloc[k - j] - 1 for j in range(1, 6))
        kb = b.index.get_loc(day)
        btc3 = b.iloc[kb] / b.iloc[kb - 3] - 1
        same = int(((z.time - t.time).abs() <= pd.Timedelta(days=1)).sum())
        try:
            f3 = fund.loc[t.coin].loc[day - pd.Timedelta(days=2):day].sum() if t.coin in fund.index.get_level_values(0) else np.nan
            has = len(fund.loc[t.coin].loc[day - pd.Timedelta(days=2):day]) > 0 if t.coin in fund.index.get_level_values(0) else False
            f3 = f3 if has else np.nan
        except KeyError:
            f3 = np.nan
        rows.append(dict(btc3=btc3, cluster=same, fund3=f3, idio=coin_drop - btc3, drop=coin_drop))
    z = pd.concat([z, pd.DataFrame(rows)], axis=1)
    z["stopped"] = z.R <= -0.9
    out = ["Diagnosis of C-4 (76 trades; stopped = R <= -0.9R)", ""]
    cols = ["coin", "time", "R", "edge", "drop", "btc3", "idio", "cluster", "fund3"]
    fmt = lambda q: q[cols].assign(time=q.time.dt.date).round(3).to_string(index=False)  # noqa: E731
    out += ["worst 20 by R:", fmt(z.nsmallest(20, "R")), "", "best 20 by R:", fmt(z.nlargest(20, "R")), ""]
    out.append("competing explanations: stopped vs not stopped (means; funding where available)")
    for col, h in (("btc3", "H1 BTC 3-day return"), ("cluster", "H1 coins signalling within a day"),
                   ("fund3", "H2 3-day funding sum"), ("idio", "H3 coin drop minus BTC 3-day return")):
        a, b = z[z.stopped][col].dropna(), z[~z.stopped][col].dropna()
        out.append(f"  {h:<38} stopped {a.mean():+.4f} (n {len(a)})   not stopped {b.mean():+.4f} (n {len(b)})")
    out.append("")
    out.append("edge by explanation split:")
    for col, cut, lab in (("btc3", -0.10, "BTC 3-day return <= -10%"), ("cluster", 3, "3+ coins signalling within a day"),
                          ("fund3", 0.0, "3-day funding < 0"), ("idio", -0.15, "idiosyncratic drop <= -15%")):
        m = (z[col] <= cut) if col in ("btc3", "idio") else (z[col] >= cut) if col == "cluster" else (z[col] < cut)
        k = z[col].notna()
        out.append(f"  {lab:<34} yes: edge {z.edge[m & k].mean():+.3f} (n {int((m & k).sum())}), stopped {z.stopped[m & k].mean():.0%}   "
                   f"no: edge {z.edge[~m & k].mean():+.3f} (n {int((~m & k).sum())}), stopped {z.stopped[~m & k].mean():.0%}")
    # ablation: drop one condition at a time (logged as trials)
    out.append("")
    out.append("ablation (each condition removed in turn, iteration tier extended):")
    for name, cfg in (("no volume condition", dict(FC.LOOPS["C-4"], volx=0.0)),
                      ("no close-in-upper-half condition", dict(FC.LOOPS["C-4"], upper=0.0))):
        fn, _ = make_ablation(cfg)
        za = E.run(f"C-4 ablation: {name}", fn, "1d", 10, ("iterx",))
        passed, st = E.iteration_gate(za)
        E.log("C-4", f"ablation: {name}", "ablation", st, passed)
        out.append(f"  {name:<34} {E.fmt(st)}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "diagnose_c.txt"), "w").write(text + "\n")


def make_ablation(cfg):
    OS = FC.OS

    def fn(d1, d4):
        d = d1
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        a = E.MT.atr_of(h, l, c, 20)
        vm = pd.Series(v).shift(1).rolling(20).mean().values
        hh = pd.Series(h).shift(1).rolling(OS.LOOK).max().values
        out, last = [], -99
        for i in range(210, len(c) - 1):
            rg = h[i] - l[i]
            drop = min(c[i] / c[i - k] - 1 for k in range(1, 6)) <= OS.DROP3
            vol_ok = vm[i] > 0 and v[i] >= cfg.get("volx", OS.VOLX) * vm[i]
            up_ok = rg > 0 and (c[i] - l[i]) / rg >= cfg.get("upper", 0.5)
            if not (drop and vol_ok and up_ok):
                continue
            stop, entry, tgt = l[i] - OS.PAD * a[i], o[i + 1], c[i] + 0.5 * (hh[i] - c[i])
            risk = entry - stop
            if risk <= 0 or risk > OS.MAX_STOP * a[i] or tgt - entry < risk or i - last < OS.SPACING:
                continue
            out.append((i + 1, 1, entry, stop, tgt))
            last = i
        return out
    return fn, {}


if __name__ == "__main__":
    main()
