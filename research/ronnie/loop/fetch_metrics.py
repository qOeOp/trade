"""Download Binance USDT-M daily 'metrics' archives (5-minute open interest, long/short ratios, taker volume ratio) for the
17 majors, 2020-09 to 2022-12, with parallel curl, then aggregate to 4h rows per coin:
loop/.cache/metrics_4h.csv.gz (coin, time, oi, oi_value, ls_top, ls_global, taker_ratio), each the last value of the bar
except taker_ratio (mean)."""
import glob, io, os, subprocess, sys, zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

D = os.path.join(HERE, ".cache", "metrics")
urls = []
for coin in E.ITER_COINS:
    for day in pd.date_range("2020-09-01", "2022-12-31"):
        f = os.path.join(D, f"{coin}USDT-{day:%Y-%m-%d}.zip")
        if not os.path.exists(f):
            urls.append(f"https://data.binance.vision/data/futures/um/daily/metrics/{coin}USDT/{coin}USDT-metrics-{day:%Y-%m-%d}.zip {f}")
lst = os.path.join(D, "urls.txt")
open(lst, "w").write("\n".join(urls))
if urls:
    subprocess.run(f"cat {lst} | xargs -P 8 -n 2 sh -c 'curl -s -f --max-time 30 -o \"$1\" \"$0\" || true'", shell=True)
rows = []
for f in glob.glob(os.path.join(D, "*.zip")):
    try:
        z = zipfile.ZipFile(f)
        df = pd.read_csv(io.BytesIO(z.read(z.namelist()[0])))
    except Exception:
        continue
    rows.append(df)
M = pd.concat(rows)
M["time"] = pd.to_datetime(M.create_time)
M["coin"] = M.symbol.str.replace("USDT", "", regex=False)
M = M.drop_duplicates(["coin", "time"]).sort_values(["coin", "time"])
agg = M.set_index("time").groupby("coin").resample("4h").agg(
    {"sum_open_interest": "last", "sum_open_interest_value": "last", "sum_toptrader_long_short_ratio": "last",
     "count_long_short_ratio": "last", "sum_taker_long_short_vol_ratio": "mean"}).reset_index()
agg.columns = ["coin", "time", "oi", "oi_value", "ls_top", "ls_global", "taker_ratio"]
agg.to_csv(os.path.join(HERE, ".cache", "metrics_4h.csv.gz"), index=False)
print(agg.groupby("coin").time.agg(["min", "max", "count"]))
