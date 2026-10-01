"""Daily premium-index klines (Binance USDT-M, monthly archives) for the carry coins. Writes carry/premium.csv.gz
(coin, date, open, high, low, close of the premium index, a fraction of the index price)."""
import io, os, sys, zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run as C  # noqa: E402
import tv_hourly  # noqa: E402

COINS = sys.argv[1].split(",") if len(sys.argv) > 1 else list(C.R4.MAJORS)
T0, T1 = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else ("2020-01-01", "2023-01-01")


def main():
    out = os.path.join(HERE, "premium.csv.gz")
    old = pd.read_csv(out) if os.path.exists(out) else pd.DataFrame()
    rows = []
    for coin in COINS:
        sym = C.PERP.get(coin, f"{coin}USDT")
        n = 0
        for m in pd.date_range(T0, T1, freq="MS", inclusive="left"):
            b = tv_hourly.get(f"{C.BASE}/futures/um/monthly/premiumIndexKlines/{sym}/1d/{sym}-1d-{m:%Y-%m}.zip", tries=3)
            if not b:
                continue
            z = zipfile.ZipFile(io.BytesIO(b))
            for line in z.read(z.namelist()[0]).decode().splitlines():
                x = line.split(",")
                if x[0].isdigit():
                    rows.append(dict(coin=coin, date=C.ts(x[0]).normalize(), open=float(x[1]), high=float(x[2]),
                                     low=float(x[3]), close=float(x[4])))
                    n += 1
        print(coin, n, flush=True)
    df = pd.concat([old, pd.DataFrame(rows)]).drop_duplicates(["coin", "date"], keep="last") if len(old) else pd.DataFrame(rows)
    df.to_csv(out, index=False)


if __name__ == "__main__":
    main()
