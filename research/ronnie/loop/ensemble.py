"""Ensemble loops (external research section 6). N-1: weekly return streams of the candidate rules, their correlation,
bear-year correlation and effective N. Writes loop/ensemble_n1.txt and loop/out/streams_weekly.csv.gz."""
import csv, datetime, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "trend"))
sys.path.insert(0, os.path.join(ROOT, "carry"))
import engine as E  # noqa: E402
from books import COST, TARGET, states  # noqa: E402
import run as CR  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
RULES = ("K1", "B3", "D-1", "F-2", "C-6")


def books():
    rets, vol, expo = {}, {}, {}
    for coin in E.ITER_COINS:
        d = E.bars(coin)["1d"]
        r = d.close.pct_change()
        rets[coin], vol[coin] = r, r.rolling(90).std() * np.sqrt(365)
        for k, s in states(d.close.values).items():
            expo.setdefault(k, {})[coin] = pd.Series(s, index=d.index)
    R, V = pd.DataFrame(rets), pd.DataFrame(vol)
    out = {}
    for k in ("B0", "B1", "B3"):
        W = (pd.DataFrame(expo[k]) * (TARGET / V) / len(E.ITER_COINS)).clip(upper=1.0)
        W = W.div(np.maximum(W.sum(axis=1), 1.0), axis=0).shift(1)
        out[k] = (W * R).sum(axis=1) - COST * W.diff().abs().sum(axis=1)
    return out


def carry():
    d = pd.read_csv(os.path.join(ROOT, "carry", "daily.csv.gz"), index_col=0, parse_dates=True)
    K = {}
    for coin, g in d.groupby("coin"):
        if coin in CR.R4.MAJORS:
            K[coin] = CR.k1_path(g.sort_index())
    k1 = pd.DataFrame(K).mean(axis=1).fillna(0.0)
    k1.index = k1.index.tz_localize("UTC")
    return k1


def trades(k):
    z = pd.read_csv(os.path.join(HERE, "out", f"{k}_iteration.csv.gz"), parse_dates=["time"]).dropna(subset=["R"])
    return z.set_index("time").R


def weekly():
    s = {k: v for k, v in books().items()}
    s["K1"] = carry()
    W = {k: v.resample("W-MON").sum() for k, v in s.items()}
    for k in ("D-1", "G-2", "F-2", "C-6"):
        W[k] = trades(k).resample("W-MON").sum()
    idx = pd.date_range(T0, T1, freq="W-MON", inclusive="left")
    X = pd.DataFrame({k: v.reindex(idx) for k, v in W.items()})
    for k in ("D-1", "G-2", "F-2", "C-6"):
        X[k] = X[k].fillna(0.0)
    X.loc[X.index < pd.Timestamp("2020-01-13", tz="UTC"), "K1"] = np.nan
    return X


def eff_n(C):
    lam = np.linalg.eigvalsh(C)
    return lam.sum() ** 2 / (lam ** 2).sum()


def main():
    X = weekly()
    X.to_csv(os.path.join(HERE, "out", "streams_weekly.csv.gz"), float_format="%.6g")
    cols = ["B0", "B1", "B3", "K1", "D-1", "G-2", "F-2", "C-6"]
    lines = ["N-1: weekly return streams 2018-2022 (K1 from 2020); trade rules at 1R per trade booked in the entry week", ""]
    lines.append("weeks with a trade: " + ", ".join(f"{k} {(X[k] != 0).mean():.0%}" for k in ("D-1", "G-2", "F-2", "C-6")))
    C = X[cols].corr()
    lines += ["", "correlation, all weeks:", C.round(2).to_string()]
    bear = X[X.index.year.isin([2018, 2022])]
    Cb = bear[cols].corr()
    lines += ["", "correlation, bear years 2018 and 2022:", Cb.round(2).to_string()]
    timing = ["B3", "D-1", "F-2", "C-6"]
    pairs = [(a, b) for i, a in enumerate(timing) for b in timing[i + 1:]]
    mb = np.nanmean([Cb.loc[a, b] for a, b in pairs])
    both = X[list(RULES)].dropna()
    n_all = eff_n(X[list(RULES)].corr().values)
    n_20 = eff_n(both.corr().values)
    lines += ["", f"mean bear-year correlation among timing rules {timing}: {mb:+.2f}",
              f"effective N of {RULES}: {n_all:.2f} (pairwise correlations), {n_20:.2f} (common weeks 2020-2022)"]
    passed = n_all > 2 and mb <= 0.8
    lines.append(f"falsifier (N <= 2 or bear correlation > 0.8): {'not triggered' if passed else 'TRIGGERED'}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "ensemble_n1.txt"), "w").write(t + "\n")
    with open(os.path.join(HERE, "census.csv"), "a", newline="") as f:
        csv.writer(f, lineterminator="\n").writerow([datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                                     "N-1", "ensemble", "diagnosis", "", f"{n_all:.2f}", "", "", passed,
                                                     "effective N of K1, B3, D-1, F-2, C-6 weekly streams"])



def scaled(x, target=0.10):
    """Trailing 26-week vol; where it is zero or undefined (a sparse trade stream), the expanding vol; no history -> 0."""
    sd = x.rolling(26, min_periods=13).std().shift(1)
    sd = sd.where(sd > 0, x.expanding(13).std().shift(1)) * np.sqrt(52)
    out = (x * target / sd).where(sd > 0)
    return out.where(x.notna()).fillna(0.0).where(x.notna())


def stats(x):
    x = x.dropna()
    sh = x.mean() / x.std() * np.sqrt(52)
    y = x * 0.10 / (x.std() * np.sqrt(52))
    eq = (1 + y).cumprod()
    return sh, (eq / eq.cummax() - 1).min()


def n2():
    X = pd.read_csv(os.path.join(HERE, "out", "streams_weekly.csv.gz"), index_col=0, parse_dates=True)
    S = pd.DataFrame({k: scaled(X[k]) for k in X.columns})
    lines = ["N-2: equal-risk books (each stream at 10% vol by trailing 26 weeks); drawdown at 10% realised vol", ""]
    verdicts = {}
    for name, rules, t0 in (("A", list(RULES), "2020-07-01"), ("T", ["B3", "D-1", "F-2", "C-6"], "2018-07-01")):
        Z = S[rules][S.index >= pd.Timestamp(t0, tz="UTC")].dropna()
        book = Z.mean(axis=1)
        rows = {k: stats(Z[k]) for k in rules}
        rows["B0"] = stats(X.B0.reindex(Z.index))
        rows[f"book {name}"] = stats(book)
        lines.append(f"Book {name} ({Z.index[0].date()} to {Z.index[-1].date()}, {len(Z)} weeks):")
        lines += [f"  {k}: Sharpe {s:.2f}, max DD {d:+.1%}" for k, (s, d) in rows.items()]
        best = max(rows[k][0] for k in rules)
        ok = rows[f"book {name}"][0] > best and rows[f"book {name}"][1] > rows["B0"][1] / 2
        rng = np.random.default_rng(3)
        diffs = []
        bk = max(rules, key=lambda k: rows[k][0])
        a, b = book.values, Z[bk].values
        for _ in range(4000):
            i = rng.integers(0, len(a), len(a))
            diffs.append((a[i].mean() / a[i].std() - b[i].mean() / b[i].std()) * np.sqrt(52))
        lo, hi = np.percentile(diffs, [2.5, 97.5])
        lines.append(f"  Sharpe book - best single ({bk}): {np.mean(diffs):+.2f} [{lo:+.2f}, {hi:+.2f}]; "
                     f"falsifier {'not triggered' if ok else 'TRIGGERED'}")
        lines.append("  per year: " + ", ".join(f"{y} {g.sum():+.1%}" for y, g in book.groupby(book.index.year)))
        verdicts[name] = (ok, rows[f"book {name}"][0], lo, hi)
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "ensemble_n2.txt"), "w").write(t + "\n")
    with open(os.path.join(HERE, "census.csv"), "a", newline="") as f:
        for name, (ok, sh, lo, hi) in verdicts.items():
            csv.writer(f, lineterminator="\n").writerow([datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                                         "N-2", f"book {name}", "iteration", "", f"{sh:.2f}", f"{lo:.2f}", f"{hi:.2f}", ok,
                                                         "equal-risk book; edge = Sharpe, interval = Sharpe minus best single"])



def variants(X):
    sets = {"T": ["B3", "D-1", "F-2", "C-6"], "T-noC6": ["B3", "D-1", "F-2"],
            "T-G2": ["B3", "G-2", "F-2", "C-6"], "T-B1": ["B1", "D-1", "F-2", "C-6"]}
    cluster = {"B3": "trend", "B1": "trend", "D-1": "brk", "G-2": "brk", "F-2": "brk", "C-6": "cap"}
    out = {}
    for sname, rules in sets.items():
        for win in (13, 26, 52):
            for scale in ("risk", "raw"):
                if scale == "raw" and win != 26:
                    continue
                for wt in ("equal", "cluster"):
                    if scale == "risk":
                        sd = lambda x: x.rolling(win, min_periods=min(13, win)).std().shift(1)  # noqa: E731
                        Z = pd.DataFrame({}, index=X.index)
                        for k in rules:
                            s = sd(X[k])
                            s = s.where(s > 0, X[k].expanding(13).std().shift(1))
                            Z[k] = (X[k] / s).where(s > 0).fillna(0.0)
                    else:
                        Z = X[rules] / X[rules].std()
                    if wt == "equal":
                        w = {k: 1 / len(rules) for k in rules}
                    else:
                        cs = {cluster[k] for k in rules}
                        w = {k: 1 / len(cs) / sum(cluster[j] == cluster[k] for j in rules) for k in rules}
                    out[f"{sname}|{scale}{win if scale == 'risk' else ''}|{wt}"] = sum(Z[k] * w[k] for k in rules)
    return pd.DataFrame(out)


def n3(blocks=12):
    import itertools
    X = pd.read_csv(os.path.join(HERE, "out", "streams_weekly.csv.gz"), index_col=0, parse_dates=True)
    V = variants(X)
    V = V[V.index >= pd.Timestamp("2018-07-01", tz="UTC")]
    M = V.values
    edges = np.linspace(0, len(M), blocks + 1).astype(int)
    parts = [np.arange(edges[i], edges[i + 1]) for i in range(blocks)]
    sh = lambda a: a.mean(0) / a.std(0)  # noqa: E731
    logits, deg = [], []
    for comb in itertools.combinations(range(blocks), blocks // 2):
        ins = np.concatenate([parts[i] for i in comb])
        oos = np.concatenate([parts[i] for i in range(blocks) if i not in comb])
        si, so = sh(M[ins]), sh(M[oos])
        b = int(np.argmax(si))
        r = (so < so[b]).sum() + 1  # rank from the bottom, 1..N
        w = r / (len(so) + 1)
        logits.append(np.log(w / (1 - w)))
        deg.append((si[b], so[b]))
    logits = np.array(logits)
    pbo = (logits <= 0).mean()
    d = np.array(deg) * np.sqrt(52)
    full = pd.Series(sh(M) * np.sqrt(52), index=V.columns).sort_values()
    lines = [f"N-3: CSCV over {V.shape[1]} construction variants, {len(V)} weeks in {blocks} blocks, "
             f"{len(logits)} splits", "",
             f"PBO {pbo:.2f}; median logit {np.median(logits):+.2f}",
             f"in-sample best Sharpe mean {d[:, 0].mean():.2f}, its out-of-sample Sharpe mean {d[:, 1].mean():.2f}",
             f"falsifier (PBO > 0.5): {'TRIGGERED' if pbo > 0.5 else 'not triggered'}", "",
             "full-period Sharpe by variant (lowest, median, highest): "
             f"{full.iloc[0]:.2f} ({full.index[0]}), {full.median():.2f}, {full.iloc[-1]:.2f} ({full.index[-1]})"]
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "ensemble_n3.txt"), "w").write(t + "\n" + full.round(2).to_string() + "\n")
    with open(os.path.join(HERE, "census.csv"), "a", newline="") as f:
        csv.writer(f, lineterminator="\n").writerow([datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                                     "N-3", "ensemble", "diagnosis", len(logits), f"{pbo:.2f}", "", "",
                                                     pbo <= 0.5, "CSCV PBO over 24 book-construction variants"])


if __name__ == "__main__":
    {"n2": n2, "n3": n3}.get(sys.argv[1] if sys.argv[1:] else "", main)()
