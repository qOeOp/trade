"""Download funding and daily klines for the extended iteration tier (for family C funding features).
Writes loop/.cache/funding_ext.csv.gz (coin, date, fund)."""
import importlib.util, os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

_spec = importlib.util.spec_from_file_location("carry_run", os.path.join(E.ROOT, "carry", "run.py"))
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)

rows = []
for coin in E.ITER_EXT_COINS:
    f = C.monthly("fund", f"{coin}USDT", "2020-01-01", "2023-01-01")
    s = pd.Series([float(x[2]) for x in f], index=[C.ts(x[0]) - pd.Timedelta(seconds=1) for x in f], dtype=float)
    s = s.groupby(s.index.normalize()).sum()
    rows.append(pd.DataFrame({"coin": coin, "date": s.index, "fund": s.values}))
    print(coin, len(s), flush=True)
pd.concat(rows).to_csv(os.path.join(HERE, ".cache", "funding_ext.csv.gz"), index=False)
