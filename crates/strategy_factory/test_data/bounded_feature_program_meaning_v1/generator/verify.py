"""
Checks that this generator's output is byte-identical to a reference set.
"""

import pathlib
import sys


ref = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
names = sorted({f.name.rsplit("-", 1)[0] for f in ref.glob("*-design.json")})
ok = bad = missing = 0
for n in names:
    for kind in ("design", "proposal"):
        a = ref / f"{n}-{kind}.json"
        b = out / f"{n}-{kind}.json"
        if not b.exists():
            print(f"  missing    {n}-{kind}")
            missing += 1
            continue
        if a.read_bytes() == b.read_bytes():
            ok += 1
        else:
            # zip misaligns wholesale on an insertion or deletion and reports a false count,
            # so a real diff algorithm is required.
            import difflib

            al, bl = a.read_text().split("\n"), b.read_text().split("\n")
            diff = sum(
                1
                for d in difflib.unified_diff(al, bl, n=0)
                if d[:1] in "+-" and d[:3] not in ("+++", "---")
            )
            print(f"  differs    {n}-{kind}  {diff} lines")
            bad += 1
print(f"identical {ok} / differing {bad} / missing {missing}   (of {len(names) * 2})")
sys.exit(1 if bad or missing else 0)
