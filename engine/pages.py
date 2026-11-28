"""The Paper runner's memory in base pages: no transparent huge pages (#3782).

With THP ``always``, as on the release host and Docker Desktop's Linux VM, the kernel backs the runner's heap with
2 MiB pages at fault time, and khugepaged later collapses sparse 2 MiB ranges into whole huge pages (with
``max_ptes_none`` 511 one touched page is enough), so the resident set grows over hours with no data held. A
6-contract run's container used 279 MiB after its warm-up with THP and 182 MiB without it.

PR_SET_THP_DISABLE marks the whole process for every later fault and collapse; children (Paper's Redis) inherit it
across fork and exec.
"""

from __future__ import annotations

import ctypes
import os
import sys

PR_SET_THP_DISABLE = 41


def base_pages_only() -> None:
    """Linux only; elsewhere nothing changes. A kernel that refuses leaves the run as it was, said on stderr."""
    if sys.platform != "linux":
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_THP_DISABLE, 1, 0, 0, 0) != 0:
        print(f"transparent huge pages stay on: prctl: {os.strerror(ctypes.get_errno())}", file=sys.stderr)
