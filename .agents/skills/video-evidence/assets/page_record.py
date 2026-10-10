"""usage: python3 -I page_record.py PAGE.html MEDIA_URL > page.json   (stdlib only; reads, never fetches)

Prints the page's one record for MEDIA_URL from its JSON-LD and JSON page-state <script> blocks: the smallest
object holding MEDIA_URL as a value (query and fragment ignored) that also names a creation or publication time,
else the smallest object holding it. Every URL inside loses its query and fragment. Exit 1 with none or several.
"""
import json, re, sys
from urllib.parse import unquote

TIME_KEYS = {"created_at", "createdAt", "dateCreated", "datePublished", "uploadDate", "published_at", "publishedAt", "pubdate"}
BLOCK = re.compile(r"<script[^>]*type=[\"']application/(?:ld\+json|json|[\w.-]+\+json)[\"'][^>]*>(.*?)</script>", re.S | re.I)
bare = lambda url: unquote(re.sub(r"[?#].*", "", url))


def holders(value, chain):
    """(object chain from the block root) for every object holding the media URL as a direct value."""
    if isinstance(value, dict):
        chain = chain + [value]
        if any(isinstance(v, str) and bare(v) == want for v in value.values()):
            yield chain
    for child in value.values() if isinstance(value, dict) else value if isinstance(value, list) else []:
        yield from holders(child, chain)


def clean(value):
    if isinstance(value, str):
        return re.sub(r"[?#].*", "", value) if re.match(r"[a-z][a-z0-9+.-]*://", value, re.I) else value
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    return [clean(v) for v in value] if isinstance(value, list) else value


page, want = open(sys.argv[1], encoding="utf-8", errors="replace").read(), bare(sys.argv[2])
records = {}
for text in BLOCK.findall(page):
    try:
        doc = json.loads(text)
    except ValueError:
        continue
    for chain in holders(doc, []):
        record = next((o for o in reversed(chain) if TIME_KEYS & set(o)), chain[-1])
        records[json.dumps(record, sort_keys=True)] = record
if len(records) != 1:
    sys.exit(f"page records holding the media URL: {len(records)}")
print(json.dumps(clean(next(iter(records.values()))), ensure_ascii=False, indent=1))
