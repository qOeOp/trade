import json, yt
CH="UCWRAtzLosbGhVt4-fDDSNPw"
vids=[]; seen=set()
def collect(o):
    for lv in yt.find(o,"lockupViewModel"):
        vid=lv.get("contentId")
        if not vid or vid in seen: continue
        seen.add(vid)
        md=lv.get("metadata",{}).get("lockupMetadataViewModel",{})
        rows=[p.get("text",{}).get("content") for row in md.get("metadata",{}).get("contentMetadataViewModel",{}).get("metadataRows",[]) for p in row.get("metadataParts",[])]
        vids.append(dict(id=vid,title=md.get("title",{}).get("content"),rel=rows[-1] if rows else None,views=rows[0] if rows else None))
    for v in yt.find(o,"videoRenderer"):
        vid=v.get("videoId")
        if vid in seen: continue
        seen.add(vid); vids.append(dict(id=vid,title="".join(x.get("text","") for x in v.get("title",{}).get("runs",[])),rel=v.get("publishedTimeText",{}).get("simpleText"),views=None))
def next_token(o):
    for ci in yt.find(o,"continuationItemRenderer"):
        t=ci.get("continuationEndpoint",{}).get("continuationCommand",{}).get("token")
        if t: return t
r=yt.post("browse",{"browseId":CH,"params":"EgZ2aWRlb3PyBgQKAjoA"}); collect(r)
for page in range(200):
    t=next_token(r)
    if not t: break
    r=yt.post("browse",{"continuation":t}); n0=len(vids); collect(r)
    if len(vids)==n0: break
json.dump(vids,open("yt/videos.json","w"),ensure_ascii=False,indent=0)
print(len(vids),"videos"); print(vids[-1])
from collections import Counter
print(Counter(v["rel"].split('前')[0][-3:] if v["rel"] else None for v in vids).most_common(12))
