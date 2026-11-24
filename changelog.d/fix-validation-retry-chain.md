- `validation registration --retry-of` is refused (`RETRY_NOT_ALLOWED`) when the original's retry chain already holds a
  registration that is unbound or whose attempt is not retryable. Before, a retry could follow one that passed and
  replace its result in the Holm family.
