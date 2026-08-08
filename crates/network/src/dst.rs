//! Deterministic simulation testing (DST) seam for network async primitives.
//!
//! Re-exports time-related async primitives so every call site in
//! `vibe-network` routes through one cfg-gated location. Under
//! `simulation` + `cfg(madsim)`, re-exports from `madsim::time` so waits and
//! timeouts advance with madsim's virtual clock. Otherwise re-exports from
//! `tokio::time`.
//!
//! `Instant` is routed the same way so that `now()` reads and `sleep`/`timeout`
//! waits share a single clock base. Using `tokio::time::Instant` on normal
//! builds keeps the seam compatible with `#[tokio::test(start_paused = true)]`
//! tests that drive time via `tokio::time::advance`.
//!
//! `vibe-network` sits below `vibe-common` in the dependency graph and
//! cannot import from `vibe_common::live::dst`, which is why this module
//! is crate-local.

pub mod time {
    pub use std::time::Duration;

    #[cfg(all(feature = "simulation", madsim))]
    pub use madsim::time::{Instant, sleep, sleep_until, timeout};
    #[cfg(not(all(feature = "simulation", madsim)))]
    pub use tokio::time::{Instant, sleep, sleep_until, timeout};
}

#[cfg(test)]
mod tests {
    use super::*;

    // Under madsim, `time::Instant` and `time::sleep` both run on the virtual
    // clock with sub-ms scheduling epsilon. If the cfg gate fell through to
    // real tokio, `sleep` would block on the OS scheduler with ~5-15ms of
    // jitter and the tight upper bound would fail.
    #[cfg(all(feature = "simulation", madsim))]
    #[madsim::test]
    async fn test_dst_sleep_uses_virtual_time() {
        let start = time::Instant::now();
        time::sleep(time::Duration::from_millis(100)).await;
        let elapsed = start.elapsed();
        assert!(elapsed >= time::Duration::from_millis(100));
        assert!(
            elapsed < time::Duration::from_millis(101),
            "virtual sleep showed real-tokio jitter: {elapsed:?}"
        );
    }

    // Mirror under real tokio (paused clock) to keep both routes exercised.
    #[cfg(not(all(feature = "simulation", madsim)))]
    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn test_dst_sleep_advances_paused_clock() {
        let start = time::Instant::now();
        time::sleep(time::Duration::from_mins(1)).await;
        assert!(start.elapsed() >= time::Duration::from_mins(1));
    }

    #[cfg(all(feature = "simulation", madsim))]
    #[madsim::test]
    async fn test_dst_timeout_fires_in_virtual_time() {
        let result = time::timeout(
            time::Duration::from_millis(10),
            std::future::pending::<()>(),
        )
        .await;
        assert!(
            result.is_err(),
            "timeout should fire on a never-completing future"
        );
    }
}
