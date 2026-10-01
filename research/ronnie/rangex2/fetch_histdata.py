"""HistData.com free 1-minute bars for gold, silver and Brent, 2018-01 to 2026-08, resampled to UTC hours.

HistData timestamps are Eastern Standard Time without daylight saving (UTC-5). Complete years come as one file per
year, the current year as one file per month. Writes rangex2/data/<SYMBOL>_1h.csv.gz (ignored by git).
"""
import gzip, http.cookiejar, io, os, re, time, urllib.parse, urllib.request, zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data")
SYMBOLS = ("XAUUSD", "XAGUSD", "BCOUSD")
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(op, symbol, year, month=None):
    page = f"https://www.histdata.com/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/{symbol.lower()}/{year}"
    page += f"/{month}" if month else ""
    html = op.open(urllib.request.Request(page, headers=UA), timeout=60).read().decode("utf-8", "ignore")
    form = dict(re.findall(r'<input type="hidden" name="(\w+)" id="\w+" value="([^"]*)"', html))
    if "tk" not in form:
        return None
    req = urllib.request.Request("https://www.histdata.com/get.php", data=urllib.parse.urlencode(form).encode(),
                                 headers={**UA, "Referer": page})
    z = zipfile.ZipFile(io.BytesIO(op.open(req, timeout=180).read()))
    name = next(n for n in z.namelist() if n.endswith(".csv"))
    d = pd.read_csv(z.open(name), sep=";", header=None, names=["t", "open", "high", "low", "close", "v"])
    d.index = pd.to_datetime(d.t, format="%Y%m%d %H%M%S") + pd.Timedelta(hours=5)
    return d[["open", "high", "low", "close"]]


def main():
    os.makedirs(OUT, exist_ok=True)
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    for symbol in SYMBOLS:
        parts = []
        for year in range(2018, 2026):
            parts.append(fetch(op, symbol, year))
            time.sleep(1)
        for month in range(1, 9):
            parts.append(fetch(op, symbol, 2026, month))
            time.sleep(1)
        m1 = pd.concat([p for p in parts if p is not None]).sort_index()
        m1 = m1[~m1.index.duplicated()]
        h1 = m1.resample("1h", label="left", closed="left").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
        h1.index = h1.index.tz_localize("UTC")
        with gzip.open(os.path.join(OUT, f"{symbol}_1h.csv.gz"), "wt") as f:
            h1.to_csv(f)
        print(f"{symbol}: {len(m1)} minutes -> {len(h1)} hours, {h1.index[0]} .. {h1.index[-1]}", flush=True)


if __name__ == "__main__":
    main()
