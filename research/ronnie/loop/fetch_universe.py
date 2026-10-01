"""Point-in-time universe data (survivorship control, external research section 2): list every Binance spot USDT pair in
the public archive (delisted pairs included), download its monthly 1d klines 2017-08 to 2026-08 in parallel, and build
loop/.cache/universe_1d.csv.gz (symbol, time, open, high, low, close, quote_volume)."""
import glob, io, os, re, subprocess, zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, ".cache", "universe")
S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/spot/monthly/klines/"


def list_pairs():
    pairs, marker = [], ""
    while True:
        x = subprocess.run(["curl", "-s", "--max-time", "60", S3 + (f"&marker={marker}" if marker else "")], capture_output=True, text=True).stdout
        found = re.findall(r"<Prefix>data/spot/monthly/klines/([A-Z0-9]+)/</Prefix>", x)
        pairs += found
        if "<IsTruncated>true</IsTruncated>" not in x or not found:
            break
        marker = f"data/spot/monthly/klines/{found[-1]}/"
    return sorted({p for p in pairs if p.endswith("USDT") and not re.search(r"(UP|DOWN|BULL|BEAR)USDT$", p)
                   and p not in ("USDCUSDT", "BUSDUSDT", "TUSDUSDT", "USDPUSDT", "FDUSDUSDT", "DAIUSDT", "PAXUSDT", "EURUSDT",
                                 "GBPUSDT", "AUDUSDT", "USTUSDT", "SUSDUSDT", "USDSUSDT", "USDSBUSDT", "AEURUSDT", "EURIUSDT")})


def main():
    pairs = list_pairs()
    print(len(pairs), "USDT pairs", flush=True)
    jobs = []
    for p in pairs:
        for m in pd.date_range("2017-08-01", "2026-08-01", freq="MS"):
            f = os.path.join(D, f"{p}-{m:%Y-%m}.zip")
            if not os.path.exists(f):
                jobs.append(f"https://data.binance.vision/data/spot/monthly/klines/{p}/1d/{p}-1d-{m:%Y-%m}.zip {f}")
    lst = os.path.join(D, "jobs.txt")
    open(lst, "w").write("\n".join(jobs))
    subprocess.run(f"cat {lst} | xargs -P 8 -n 2 sh -c 'curl -s -f --max-time 30 -o \"$1\" \"$0\" || true'", shell=True)
    rows = []
    for f in glob.glob(os.path.join(D, "*.zip")):
        sym = os.path.basename(f).rsplit("-", 2)[0]
        try:
            z = zipfile.ZipFile(f)
            for line in z.read(z.namelist()[0]).decode().splitlines():
                x = line.split(",")
                if x[0].isdigit():
                    t = int(x[0])
                    t = t // 1000 if t < 10**14 else t // 10**6
                    rows.append((sym, t, float(x[1]), float(x[2]), float(x[3]), float(x[4]), float(x[7])))
        except Exception:
            continue
    U = pd.DataFrame(rows, columns=["symbol", "time", "open", "high", "low", "close", "quote_volume"])
    U["time"] = pd.to_datetime(U.time, unit="s", utc=True)
    U = U.drop_duplicates(["symbol", "time"]).sort_values(["symbol", "time"])
    U.to_csv(os.path.join(HERE, ".cache", "universe_1d.csv.gz"), index=False)
    print(U.symbol.nunique(), "symbols,", len(U), "rows")


if __name__ == "__main__":
    main()
