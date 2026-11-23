- `replay run --registration N` without `--runtime` runs the image the registration pins, as it already reads the
  registration's market day; it resolved the main tag, so a tag that moved since registration was refused
  (`EXECUTION_MISMATCH`).
