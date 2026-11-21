- Host files: the membership months a run's inputs hold (`market.universe.write_months`) are now written through
  `shared.files.atomic_write` (synced file, rename, synced directory); they were not synced before. The Paper host's
  recovery identity and STOP file use the same write in place of the engine's own.
