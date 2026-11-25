- A runner time that is not ISO-8601 UTC is refused as `WINDOW_INVALID` instead of ending with a traceback; a runner
  argument error no longer blames `--start` and `--end`, and every `USAGE_ERROR` of a command carries `expected`.
