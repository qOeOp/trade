- A cached market export no longer reads bar files to find where contracts stopped trading, and one not in the cache
  reads each contract's LAST and MARK bars together. The exported files are unchanged; cached exports are written once
  more. The cache key now covers the whole months after the window through the market day.
