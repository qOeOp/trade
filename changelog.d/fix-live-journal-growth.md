- Live page: a run's journals (`events.jsonl`, `lifecycle.jsonl`, `account.jsonl`) are read on from where the last
  read of the same file ended, when the bytes before that point are unchanged, instead of parsed and hashed whole on
  every request: a year of minute rows (72 MB) took about 1 s per read, twice per request; a read after one appended
  row now takes under 1 ms.
