- Command line (`USAGE_ERROR`): a command line the parser refuses now lists that command's usage line and options
  under `expected`, so the rerun needs no `--help` first. Unrecognized arguments on a command that takes runner
  arguments, without `--`, add "runner arguments go after --"; `--line` on a command whose registration binds the
  line (`replay run`, `hypothesis compare`, `research comparison`) says so. Both stay refused.
