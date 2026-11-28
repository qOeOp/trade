- A Paper start that names both `symbols` and `universe` is refused (`USAGE_ERROR`); before, the pool started and the
  contracts were dropped. A pool start reusing an operation ID now replays only a start whose contracts equal the pool
  its market day held at its declaration, and is otherwise `OP_ID_CONFLICT`; before, it replayed a `--symbols` start.
