- Registration and replay refuse runner arguments the runner's own parser refuses (`--help`/`-h`, a value no
  option takes such as `--leverage 3 4`) as `USAGE_ERROR` before any export, instead of passing them to the runner.
