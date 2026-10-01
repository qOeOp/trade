"""TrialFamily events-v1: skip filters for FOMC, CPI, month-turn, year-end and development-chosen month windows,
tested against random skips of the same trades. See INTENT.md. Writes events/result.txt.
"""
import importlib.util, os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("range2_run", os.path.join(ROOT, "range2", "run.py"))
R2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R2)
PERMS = 2000
HALVINGS = (pd.Timestamp("2020-05-11"), pd.Timestamp("2024-04-20"))


def logs():
    def rd(p):
        return pd.read_csv(os.path.join(ROOT, p), parse_dates=["time"])
    t = rd("trend/trades.csv.gz").assign(score=lambda z: z.R - z.control)
    x = rd("exits/trades.csv.gz")
    f = rd("range6/events.csv.gz").assign(score=lambda z: z.R - z.control)
    o = rd("oversold/events.csv.gz")
    o = o[o.variant == "O3"].assign(score=lambda z: z.R - z.control)
    s = rd("short/events.csv.gz")
    s = s[s.variant.isin(["S0", "S1", "S2"])].assign(score=lambda z: z.R - z.control)
    out = {"TREND": t, "B1": x[x.kind == "B1"].assign(score=lambda z: z.X0), "BOX": x[x.kind == "BOX"].assign(score=lambda z: z.X0),
           "FADE": f, "O3": o, "SHORT": s}
    return {k: v[["set", "coin", "time", "score"]].dropna().reset_index(drop=True) for k, v in out.items()}


def windows(cal):
    fomc = pd.to_datetime(cal[cal.event == "FOMC"].date)
    cpi = pd.to_datetime(cal[cal.event == "CPI"].date)
    days = lambda ds, offs: set(d + pd.Timedelta(days=k) for d in ds for k in offs)  # noqa: E731
    return {"E1 FOMC +-1 day": days(fomc, (-1, 0, 1)), "E2 CPI day and next": days(cpi, (0, 1))}


def flags(day, name, sets):
    if name in sets:
        return day.isin(sets[name]).values
    if name.startswith("E3"):
        return ((day.dt.day <= 2) | (day.dt.days_in_month - day.dt.day <= 1)).values
    if name.startswith("E4"):
        return (((day.dt.month == 12) & (day.dt.day >= 20)) | ((day.dt.month == 1) & (day.dt.day <= 5))).values
    raise KeyError(name)


def perm_test(score, flag, coin, rng):
    """Gain of skipping flagged trades, and one-sided p-values against within-coin shuffles of the flags."""
    s = score.values
    if flag.sum() == 0 or flag.all():
        return np.nan, np.nan, np.nan
    gain = s[~flag].mean() - s.mean()
    groups = [np.flatnonzero(coin.values == c) for c in coin.unique()]
    null = np.empty(PERMS)
    for k in range(PERMS):
        f = np.zeros(len(s), bool)
        for g in groups:
            f[g] = flag[rng.permutation(g)]
        null[k] = s[~f].mean() - s.mean()
    return gain, (np.sum(null >= gain) + 1) / (PERMS + 1), (np.sum(null <= gain) + 1) / (PERMS + 1)


def main():
    rng = np.random.default_rng(83)
    cal = pd.read_csv(os.path.join(HERE, "calendar.csv"))
    sets = windows(cal)
    L = logs()
    names = list(sets) + ["E3 month turn (2+2 days)", "E4 year end (Dec 20-Jan 5)", "M1 worst 2 months on dev"]
    out = ["events-v1 (INTENT.md): skip trades entered inside each window; gain = mean score kept minus mean score all;",
           "p = one-sided, against 2,000 within-coin shuffles of the window flags (p_skip: skipping helps; p_in: window trades better)", ""]
    adopted, rescued = [], []
    for strat, z in L.items():
        day = z.time.dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize() if z.time.dt.tz is not None else z.time.dt.normalize()
        dev = z.set == "dev"
        mq = z[dev].groupby(day[dev].dt.month).score.mean()
        worst = list(mq.nsmallest(2).index)
        out.append(f"{strat}: dev n {dev.sum()} mean {z[dev].score.mean():+.3f} | holdout n {(~dev).sum()} mean {z[~dev].score.mean():+.3f}"
                   f"   (M1 months chosen on dev: {worst})")
        for name in names:
            flag_all = day.dt.month.isin(worst).values if name.startswith("M1") else flags(day, name, sets)
            ps = []
            cells = []
            for s in ("dev", "holdout"):
                m = (z.set == s).values
                zz, fl = z[m], flag_all[m]
                gain, p_skip, p_in = perm_test(zz.score, fl, zz.coin, rng)
                ps.append((gain, p_skip))
                cells.append(f"{s} in {fl.sum():4d} ({fl.mean():4.0%}) in {zz.score[fl].mean():+.3f} out {zz.score[~fl].mean():+.3f} "
                             f"gain {gain:+.3f} p_skip {p_skip:.3f} p_in {p_in:.3f}")
            out.append(f"  {name:<27} " + " | ".join(cells))
            if all(g > 0 and p < 0.05 for g, p in ps):
                adopted.append(f"{strat}: {name}")
                kept = z[(z.set == "holdout").values & ~flag_all]
                lo, hi = R2.coin_boot(kept.assign(R=kept.score, control=0.0))
                if lo > 0:
                    rescued.append(f"{strat}: {name} (holdout kept {kept.score.mean():+.3f} [{lo:+.3f}, {hi:+.3f}])")
        hv = np.zeros(len(z), bool)
        for h in HALVINGS:
            hv |= ((day >= h - pd.Timedelta(days=30)) & (day <= h + pd.Timedelta(days=30))).values
        out.append(f"  halving +-30 days (descriptive, all sets): in {hv.sum()} mean {z.score[hv].mean():+.3f}, out {z.score[~hv].mean():+.3f}")
        out.append("")
    out.append("decision, skip filters adopted (gain > 0 with p < 0.05 on development and on the holdout): " + ("; ".join(adopted) or "none"))
    out.append("decision, falsified strategies rescued: " + ("; ".join(r for r in rescued if r.split(":")[0] in ("FADE", "SHORT")) or "none"))
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
