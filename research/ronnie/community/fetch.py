"""Fetch a fixed sample of other traders' TradingView ideas on the forward coins, with their drawings.

community/listing.jsonl.gz   every listed idea (up to 1000 per symbol): id, uuid, author, publish time, interval
community/ideas.jsonl.gz     the sampled ideas: the same fields plus the chart symbol and interval
community/drawings.jsonl.gz  their horizontal and trend-line drawings (tv_fetch.drawings rows)
Re-runs reuse community/.cache (ignored). The sample (150 per coin, seed 11) is drawn from the listing only.
"""
import gzip, json, os, random, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from tv_fetch import drawings, get, idea_record  # noqa: E402

COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
KEEP = {"LineToolHorzLine", "LineToolHorzRay", "LineToolTrendLine", "LineToolRay", "LineToolRectangle"}
PER_COIN, SEED = 150, 11
CACHE = os.path.join(HERE, ".cache")


def listing(sym):
    path = os.path.join(CACHE, f"list_{sym.replace(':', '_')}.json")
    if os.path.exists(path):
        return json.load(open(path))
    url, rows = f"https://www.tradingview.com/api/v1/ideas/?symbol={sym}&page=1", []
    while url:
        d = json.loads(get(url))
        rows += [dict(id=r["id"], uuid=r["image_url"], author=r["user"]["username"], ts=r["date_timestamp"],
                      interval=r.get("interval"), chart_url=r["chart_url"], is_video=r.get("is_video"),
                      is_education=r.get("is_education"), symbol=sym) for r in d["results"]]
        url = d["next"]
        time.sleep(1)
    json.dump(rows, open(path, "w"))
    return rows


def record(it):
    path = os.path.join(CACHE, f"idea_{it['uuid']}.json.gz")
    if not os.path.exists(path):
        try:
            rec = idea_record(it["chart_url"])
            rec = {k: rec.get(k) for k in ("created_at", "interval", "content")}
            if rec["content"]:  # drop the bars and study payloads: only the drawings and symbols are read
                c = json.loads(rec["content"])
                for ch in c.get("charts") or [c]:
                    for p in ch.get("panes", []):
                        p["sources"] = [{k: v for k, v in x.items() if k not in ("bars", "data", "nsData")}
                                        for x in p.get("sources", []) if x.get("type", "").startswith(("LineTool", "MainSeries"))]
                c.pop("studyMetaInfoMap", None)
                rec["content"] = json.dumps(c)
        except Exception as e:  # deleted or private ideas
            rec = {"error": repr(e)}
        with gzip.open(path, "wt") as f:
            json.dump(rec, f)
        time.sleep(1)
    with gzip.open(path, "rt") as f:
        return json.load(f)


def main():
    os.makedirs(CACHE, exist_ok=True)
    lst, sample = [], []
    for coin in COINS:
        rows = listing(f"BINANCE:{coin}USDT")
        lst += rows
        pool = sorted((r for r in rows if not r["is_video"]), key=lambda r: r["id"])
        sample += random.Random(f"{SEED}-{coin}").sample(pool, min(PER_COIN, len(pool)))
        print(f"{coin}: listed {len(rows)}", flush=True)
    with ThreadPoolExecutor(2) as ex:
        recs = list(ex.map(record, sample))
    ideas, draws = [], []
    for it, rec in zip(sample, recs):
        if "error" in rec or not rec.get("content"):
            continue
        content = json.loads(rec["content"])
        charts = content.get("charts") or [content]  # newer layouts nest one or more charts
        syms = []
        for n, ch in enumerate(charts):
            main_src = next((s for p in ch.get("panes", []) for s in p.get("sources", []) if s.get("type") == "MainSeries"), {})
            st = main_src.get("state", {})
            syms.append((st.get("symbol"), st.get("interval")))
            draws += [{**d, "chart": n, "chart_symbol": st.get("symbol"), "chart_interval": st.get("interval")}
                      for d in drawings(it["uuid"], ch, rec.get("interval")) if d["type"] in KEEP]
        ideas.append({**{k: it[k] for k in ("id", "uuid", "author", "ts", "symbol", "is_education")},
                      "created_at": rec.get("created_at"), "interval": rec.get("interval"), "charts": syms})
    for name, rows in (("listing", lst), ("ideas", ideas), ("drawings", draws)):
        with gzip.GzipFile(os.path.join(HERE, f"{name}.jsonl.gz"), "wb", mtime=0) as f:
            f.write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows).encode())
    print(f"{len(lst)} listed, {len(ideas)} ideas with charts, {len(draws)} line drawings")


if __name__ == "__main__":
    main()
