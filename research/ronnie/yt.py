import json, urllib.request, base64, re, sys, time
CTX={"client":{"clientName":"WEB","clientVersion":"2.20250101.00.00","hl":"zh-CN","gl":"US"}}
def post(ep, body, tries=3):
    for k in range(tries):
        try:
            req=urllib.request.Request(f"https://youtubei.googleapis.com/youtubei/v1/{ep}?prettyPrint=false", data=json.dumps({"context":CTX,**body}).encode(), headers={"Content-Type":"application/json"})
            return json.load(urllib.request.urlopen(req, timeout=40))
        except Exception as e:
            err=e; time.sleep(2*(k+1))
    raise err
def find(o, key):
    if isinstance(o,dict):
        for k,v in o.items():
            if k==key: yield v
            yield from find(v,key)
    elif isinstance(o,list):
        for v in o: yield from find(v,key)
def meta(vid):
    r=post("player",{"videoId":vid})
    mf=r.get("microformat",{}).get("playerMicroformatRenderer",{})
    vd=r.get("videoDetails",{})
    caps=[(t.get("languageCode"),t.get("kind")) for t in r.get("captions",{}).get("playerCaptionsTracklistRenderer",{}).get("captionTracks",[])]
    return dict(id=vid,title=vd.get("title"),publish=mf.get("publishDate"),upload=mf.get("uploadDate"),len=vd.get("lengthSeconds"),desc=vd.get("shortDescription","")[:300],caps=caps)
def transcript(vid):
    r=post("next",{"videoId":vid})
    ps=[p for p in find(r,"getTranscriptEndpoint")]
    if not ps: return None
    t=post("get_transcript",{"params":ps[0]["params"]})
    segs=[]
    for s in find(t,"transcriptSegmentRenderer"):
        ms=int(s.get("startMs",0)); txt="".join(x.get("text","") for x in s.get("snippet",{}).get("runs",[]))
        segs.append((ms,txt))
    return segs
if __name__=="__main__":
    vid=sys.argv[1]
    print(json.dumps(meta(vid),ensure_ascii=False,indent=1))
    tr=transcript(vid)
    print("segments:", None if tr is None else len(tr))
    if tr: print("".join(x for _,x in tr[:60])[:1500])
