- A Paper HTTP start that names no contracts and reuses an `op_id` replays the earlier run only when its contracts are
  those of a research replay of the candidate's source (or the research ledger holds none), and otherwise answers
  `OP_ID_CONFLICT`, as a pool retry does; it used to replay any earlier start (#3821).
