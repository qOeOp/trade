- Breaking (deployment): every release replaces the standalone Agent; the branch that kept it when no Agent path
  changed is gone, since each version's `pyproject.toml` bump already counted as an Agent change. The release journal
  always names `agent_before`, and a journal without it is refused. An Agent replaced by someone else while a release
  waits now leaves the journal for the operator instead of being rolled back. The cleanup of `paper-failed/`, which no
  version since 0.3.1 writes, is removed.
