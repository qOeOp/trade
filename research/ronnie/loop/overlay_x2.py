"""Loop X-2: funding-extreme crash overlay on BTC (external research section 5, hypothesis 3). Writes loop/overlay_x2.txt."""
import csv, datetime, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import ensemble as N  # noqa: E402


def flag():
    d = pd.read_csv(os.path.join(ROOT, "carry", "daily.csv.gz"), index_col=0, parse_dates=True)
    f = d[d.coin == "BTC"].fund.sort_index()
    f7 = f.rolling(7).mean()
    p90 = f7.rolling(365, min_periods=300).quantile(0.9)
    M = pd.read_csv(os.path.join(HERE, ".cache", "metrics_4h.csv.gz"), parse_dates=["time"])
    oi = M[M.coin == "BTC"].set_index("time").oi.resample("1D").last()
    oi14 = oi / oi.shift(14) - 1
    x = pd.DataFrame({"f7": f7, "p90": p90, "oi14": oi14}).dropna()
    x["flag"] = (x.f7 > x.p90) & (x.oi14 > 0.20)
    x.index = x.index.tz_localize("UTC")
    return x


def main():
    x = flag()
    c = E.bars("BTC")["1d"].close
    fwd = (c.shift(-30) / c - 1).reindex(x.index)
    x = x.assign(fwd=fwd).dropna(subset=["fwd"])
    on, off = x[x.flag], x[~x.flag]
    days = on.index
    episodes = int((pd.Series(days).diff() > pd.Timedelta(days=14)).sum() + (len(days) > 0))
    lines = [f"X-2: flag from {x.index[0].date()} to {x.index[-1].date()}; flagged {len(on)} of {len(x)} days, "
             f"{episodes} episodes: " + ", ".join(str(t.date()) for t in days[pd.Series(days).diff().fillna(pd.Timedelta(days=99)).values > pd.Timedelta(days=14)])]
    for name, g in (("flagged", on), ("unflagged", off), ("all", x)):
        lines.append(f"  {name}: next-30-day BTC mean {g.fwd.mean():+.1%}, 5th percentile {g.fwd.quantile(0.05):+.1%}, n {len(g)}")
    worse = on.fwd.mean() < x.fwd.mean() and on.fwd.quantile(0.05) < x.fwd.quantile(0.05)
    lines.append(f"  falsifier (flagged no worse than unconditional): {'not triggered' if worse else 'TRIGGERED'}")
    b3 = N.books()["B3"]
    b3 = b3[(b3.index >= x.index[0]) & (b3.index <= x.index[-1])]
    cut = b3.where(~x.flag.reindex(b3.index).shift(1).fillna(False).astype(bool), 0.0)
    for name, s in (("B3", b3), ("B3 with overlay", cut)):
        eq = (1 + s).cumprod()
        lines.append(f"  {name}: Sharpe {s.mean() / s.std() * np.sqrt(365):.2f}, return {eq.iloc[-1] - 1:+.1%}, "
                     f"max DD {(eq / eq.cummax() - 1).min():+.1%}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "overlay_x2.txt"), "w").write(t + "\n")
    with open(os.path.join(HERE, "census.csv"), "a", newline="") as fh:
        csv.writer(fh, lineterminator="\n").writerow([datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                                      "X-2", "overlay", "iteration", episodes, f"{on.fwd.mean() - x.fwd.mean():+.4f}",
                                                      "", "", worse, "funding-extreme flag; edge = flagged minus all next-30-day BTC mean"])


if __name__ == "__main__":
    main()
