- A new line's first ledger start that is killed while it publishes no longer leaves a ledger that starts but can never
  publish, and the container is not healthy before the new ledger is on `main`. Every killed first start is now
  `BOOTSTRAP_REFUSED` until the documented reset.
