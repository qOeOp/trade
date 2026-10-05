//! B6: Market Data's resident process. One sequential tick, not per-job tasks - the adapter's
//! shared rate limiter would serialize parallel REST calls anyway, so nothing is gained by
//! running jobs concurrently, and a shared tick is simpler to reason about and test.
//!
//! No durable "last run" state is kept on purpose: a restart's empty in-memory state makes every
//! gate fire again on its next tick, and every job underneath is already idempotent (B1's
//! rejoin, B6a's `ON CONFLICT DO NOTHING`), so the duplicate work it does is absorbed, never
//! double-written. That is this process's whole restart story.

pub mod scheduling;
pub mod tick;
