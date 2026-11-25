- A release interrupted after its Web commit no longer leaves the data generation journal at `done`, which made a later
  release's rollback skip its checks of the previous version: every tick ends it once a version that reads the new
  generation is routed.
