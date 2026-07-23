# Forward Evidence Runner

Owns incremental post-freeze session execution. It validates the Research-admitted certified source binding、no-backfill and watermark constraints, delegates simulator semantics to the Replay Trial Runner, and returns auditable Forward Result evidence whose fingerprint includes the exact certified binding hash and candidate source revision.

It cannot rewrite a Draft Strategy, decide `accept_for_shadow_candidate`, call an exchange, or publish paper events as account facts.
