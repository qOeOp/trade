import json, re, yt, concurrent.futures as cf
vids=json.load(open("yt/videos.json"))
btc=[v for v in vids if re.search(r"比特币|BTC|btc|大饼|比特幣",v["title"] or "")]
print(len(btc),"BTC videos of",len(vids))
def exact(v):
    try:
        n=yt.post("next",{"videoId":v["id"]})
        fs=[(f.get("value",{}).get("simpleText") or "")+" "+(f.get("label",{}).get("simpleText") or "") for f in yt.find(n,"factoidRenderer")]
        d=[x for x in fs if "年" in x]
        return v["id"], d[0] if d else None
    except Exception as e:
        return v["id"], None
with cf.ThreadPoolExecutor(8) as ex:
    res=dict(ex.map(exact,btc))
def norm(s):
    if not s: return None
    m=re.match(r"(\d+)月(\d+)日\s*(\d{4})年",s)
    if m: return f"{m[3]}-{int(m[1]):02d}-{int(m[2]):02d}"
    m=re.match(r"(\d{4})年(\d+)月(\d+)日",s)
    if m: return f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}"
    return s
for v in btc: v["published"]=norm(res.get(v["id"]))
json.dump(btc,open("yt/btc_videos.json","w"),ensure_ascii=False,indent=0)
print(sum(1 for v in btc if v["published"] and re.match(r"\d{4}-",v["published"])),"with exact date")
print([ (v["published"],v["title"][:40]) for v in btc[:3]], [(v["published"],v["title"][:40]) for v in btc[-3:]])
