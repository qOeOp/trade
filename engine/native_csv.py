"""One CSV parsing contract for native reports inside the image and on the host."""

from __future__ import annotations

import csv
from collections.abc import Iterable


# Nautilus serializes a position's complete events and funding adjustments into single cells.
# Keep the existing ledger acceptance range for every reader, including fresh stage processes.
FIELD_SIZE_LIMIT = 2**31 - 1


def dict_reader(stream: Iterable[str]) -> csv.DictReader[str]:
    csv.field_size_limit(FIELD_SIZE_LIMIT)
    return csv.DictReader(stream)
