"""Daily bars 2017-2022 for every symbol Ronnie's TradingView ideas were drawn on, from TradingView's own feed.

tv/prices/<EXCHANGE>_<SYMBOL>.csv.gz (time UTC, open, high, low, close). The unauthenticated feed serves daily bars back
to 2007 but intraday bars only for the last few years, so intraday ordering comes from tv_hourly.py instead.
"""
import gzip, json, os, random, re, string, sys, time

import websocket  # pip install websocket-client

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/tv/prices"
FROM, TO = 1483228800, 1672531200  # 2017-01-01 .. 2023-01-01


def _msg(f, p):
    s = json.dumps({"m": f, "p": p})
    return f"~m~{len(s)}~m~{s}"


def fetch(symbol, tf="1D", n=5000, volume=False):
    ws = websocket.create_connection("wss://data.tradingview.com/socket.io/websocket",
                                     header=["Origin: https://www.tradingview.com"], timeout=60)
    cs = "cs_" + "".join(random.choices(string.ascii_lowercase, k=12))
    ws.send(_msg("set_auth_token", ["unauthorized_user_token"]))
    ws.send(_msg("chart_create_session", [cs, ""]))
    ws.send(_msg("resolve_symbol", [cs, "s1", "=" + json.dumps({"symbol": symbol, "adjustment": "splits"})]))
    ws.send(_msg("create_series", [cs, "sds_1", "s1", "s1", tf, n, ""]))
    buf = ""
    try:
        while True:
            r = ws.recv()
            buf += r
            for h in re.findall(r"~h~\d+", r):
                ws.send(f"~m~{len(h)}~m~{h}")
            if re.search(r"symbol_error|critical_error|series_error|series_completed", r):
                break
    finally:
        ws.close()
    err = re.findall(r"(symbol_error|critical_error|series_error)", buf)
    bars = {}
    for v in re.findall(r'"v":\[([^\]]*)\]', buf):
        x = [float(a) for a in v.split(",")[:6 if volume else 5]]
        bars[int(x[0])] = x[1:]
    return sorted(bars.items()), err


def main(symbols):
    os.makedirs(OUT, exist_ok=True)
    for s in symbols:
        path = f"{OUT}/{s.replace(':', '_')}.csv.gz"
        if os.path.exists(path):
            continue
        for k in range(4):
            try:
                bars, err = fetch(s)
                break
            except Exception as e:  # the feed drops connections now and then
                bars, err = [], [repr(e)]
                time.sleep(3 * (k + 1))
        keep = [(t, *v) for t, v in bars if FROM <= t < TO]
        if not keep:
            print(f"{s}: no bars {err}")
            continue
        with gzip.GzipFile(path, "wb", mtime=0) as f:
            f.write(("time,open,high,low,close\n" + "".join(f"{t},{o},{h},{l},{c}\n" for t, o, h, l, c in keep)).encode())
        print(f"{s}: {len(keep)} daily bars {time.strftime('%Y-%m-%d', time.gmtime(keep[0][0]))}.."
              f"{time.strftime('%Y-%m-%d', time.gmtime(keep[-1][0]))}")
        time.sleep(1)


if __name__ == "__main__":
    ideas = [json.loads(x) for x in open(f"{HERE}/tv/ideas.jsonl")]
    main(sorted({i["chart_symbol"] or i["symbol"] for i in ideas}) if len(sys.argv) < 2 else sys.argv[1:])
