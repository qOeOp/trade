# Forward Evidence Runner

Owns incremental post-freeze session execution，以及 certified source admission、market-data demand、owner candle-slice manifest/CSV/content hash 的逐段复核和 OHLCV-only Dataset Candidate 的 immutable materialization。Resident workers advance only these bounded forward-evidence states. Session path validates the Research-admitted certified source binding、no-backfill and watermark constraints, delegates simulator semantics to the Replay Trial Runner, and returns auditable Forward Result evidence whose fingerprint includes the exact certified binding hash and candidate source revision.

It cannot rewrite a Draft Strategy, decide `accept_for_shadow_candidate`, call an exchange, or publish paper events as account facts.
