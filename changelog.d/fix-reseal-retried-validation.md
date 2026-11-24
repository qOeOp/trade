- `replay reseal` is refused (`RETRY_NOT_ALLOWED`) when the new reading would make a validation attempt that was
  already retried count beside its retry; the old reading stays. Before, the reseal was written (#3626).
