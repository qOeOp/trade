# Forward Evidence Runner

Owns incremental post-freeze session execution. It validates no-backfill and watermark constraints, delegates simulator semantics to the Replay Trial Runner, and returns auditable Forward Result evidence.

It cannot rewrite a Draft Strategy, decide `accept_for_shadow_candidate`, call an exchange, or publish paper events as account facts.

