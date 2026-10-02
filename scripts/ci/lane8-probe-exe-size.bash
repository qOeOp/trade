#!/usr/bin/env bash
# LANE8 PROBE, NOT FOR MERGE: how large the member test and binary executables rust-cache drops are.
set -uo pipefail
python3 - << 'PY'
import os, subprocess
from pathlib import Path
deps = Path(os.environ["CARGO_TARGET_DIR"]) / "ci-pr" / "deps"
exes = sorted(
    p for p in deps.iterdir()
    if p.is_file() and "." not in p.name and not p.name.startswith("lib") and os.access(p, os.X_OK)
)
total = sum(p.stat().st_size for p in exes)
tar = subprocess.Popen(["tar", "-cf", "-", *map(str, exes)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
zstd = subprocess.run(["zstd", "-T0", "--long=30", "-q", "-c"], stdin=tar.stdout, capture_output=True, check=True)
print(f"LANE8-X member executables in ci-pr/deps: {len(exes)}, {total} bytes, {len(zstd.stdout)} bytes as zstd --long=30")
for p in sorted(exes, key=lambda p: -p.stat().st_size)[:10]:
    print(f"LANE8-X largest {p.stat().st_size} {p.name}")
PY
