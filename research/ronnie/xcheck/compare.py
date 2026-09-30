"""Compare the repository BacktestEngine's fills (xcheck/out) with Python's own outcomes (xcheck/work/python.csv).

Per order: exit role (TP, SL, TIME), gross R from the engine's entry and exit fills over the planned stop distance,
against Python's gross R. Grouped by study, market group and engine bar resolution, then by setup. Writes
xcheck/result.txt and xcheck/matched.csv.gz.
"""
import glob, gzip, os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    py = pd.read_csv(f"{HERE}/work/python.csv")
    rows = []
    for f in glob.glob(f"{HERE}/out/*.csv"):
        key = os.path.basename(f)[:-4]
        res = key.split("_")[2]
        e = pd.read_csv(f)
        e["res"] = res
        rows.append(e)
    en = pd.concat(rows)
    en["en_R"] = np.where(en.status == "CLOSED",
                          en.side * (en.exit_px - en.entry_px) / (en.entry_px - en.stop).abs(), np.nan)
    en["en_role"] = en.exit_role.fillna("")
    m = en.merge(py, on="id", how="left")
    with gzip.GzipFile(f"{HERE}/matched.csv.gz", "wb", mtime=0) as fh:
        fh.write(m[["id", "study", "market", "setup", "res", "status", "py_R", "en_R", "py_role", "en_role"]].to_csv(index=False).encode())
    m["group"] = m.study + " " + np.where(m.study == "setups", m.market, np.where(m.study == "fxrevert", "9 FX", "15 coins")) + " " + m.res
    out = ["Repository BacktestEngine vs the Python simulators, gross R per order (engine fills over the planned stop)"]
    expected = py.groupby("study").size()
    out.append("orders exported: " + ", ".join(f"{k} {v}" for k, v in expected.items()) + f"; engine outcomes: {len(en)}; "
               f"not closed by the engine: {int((en.status != 'CLOSED').sum())} ({', '.join(f'{k} {v}' for k, v in en.status.value_counts().items() if k != 'CLOSED')})")
    out.append(f"{'group':<30} {'n':>5} {'same exit':>10} {'|dR|<=0.1':>10} {'mean |dR|':>10} {'py avgR':>9} {'engine avgR':>12}")
    for g, z in m[m.status == "CLOSED"].groupby("group"):
        d = (z.en_R - z.py_R).abs()
        out.append(f"{g:<30} {len(z):5d} {np.mean(z.en_role == z.py_role):10.1%} {np.mean(d <= 0.1):10.1%} {d.mean():10.3f} "
                   f"{z.py_R.mean():+9.3f} {z.en_R.mean():+12.3f}")
    out.append("")
    out.append("by setup (closed orders): python avgR -> engine avgR")
    for (g, s), z in m[m.status == "CLOSED"].groupby(["group", "setup"]):
        out.append(f"  {g:<30} {s:<3} n={len(z):5d}  {z.py_R.mean():+.3f} -> {z.en_R.mean():+.3f}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
