//! Common test related helper functions.

#[cfg(feature = "live")]
use std::future::Future;
use std::{
    thread,
    time::{Duration, Instant},
};

use vibe_core::UUID4;
use vibe_model::{identifiers::TraderId, stubs::TestDefault};

use crate::logging::{
    init_logging,
    logger::{LogGuard, LoggerConfig},
    writer::FileWriterConfig,
};

/// # Errors
///
/// Returns an error if initializing the logger fails.
pub fn init_logger_for_testing(stdout_level: Option<log::LevelFilter>) -> anyhow::Result<LogGuard> {
    let config = LoggerConfig {
        stdout_level: stdout_level.unwrap_or(log::LevelFilter::Trace),
        ..Default::default()
    };
    init_logging(
        TraderId::test_default(),
        UUID4::new(),
        config,
        FileWriterConfig::default(),
    )
}

/// Repeatedly evaluates a condition with a delay until it becomes true or a timeout occurs.
///
/// # Panics
///
/// This function panics if the timeout duration is exceeded without the condition being met.
///
/// # Examples
///
/// ```
/// use std::time::Duration;
/// use std::thread;
/// use vibe_common::testing::wait_until;
///
/// let start_time = std::time::Instant::now();
/// let timeout = Duration::from_secs(5);
///
/// wait_until(|| {
///     if start_time.elapsed().as_secs() > 2 {
///         true
///     } else {
///         false
///     }
/// }, timeout);
/// ```
///
/// In the above example, the `wait_until` function will block for at least 2 seconds, as that's how long
/// it takes for the condition to be met. If the condition was not met within 5 seconds, it would panic.
pub fn wait_until<F>(mut condition: F, timeout: Duration)
where
    F: FnMut() -> bool,
{
    let start_time = Instant::now(); // dst-ok: test helper timer; uses real time by design

    loop {
        if condition() {
            break;
        }

        assert!(
            start_time.elapsed() <= timeout,
            "Timeout waiting for condition after {:.1}s (limit {:.1}s)",
            start_time.elapsed().as_secs_f64(),
            timeout.as_secs_f64(),
        );

        thread::sleep(Duration::from_millis(100));
    }
}

/// # Panics
///
/// Panics if the timeout duration is exceeded without the condition being met.
#[cfg(feature = "live")]
pub async fn wait_until_async<F, Fut>(condition: F, timeout: Duration)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    wait_until_async_labeled(condition, timeout, "condition").await;
}

/// Waits for `condition`, and says what was being waited for if it never becomes true.
///
/// The condition is a closure returning `bool`, so a timeout here has no way to name what it was
/// waiting for. Without a name, the only thing a reader of a timed-out run can do is run it again.
/// Callers that pass a name get a failure that points somewhere.
///
/// # On choosing `timeout`
///
/// This budget is not hang protection - `.config/nextest.toml` terminates a test after five 120s
/// slow-timeout periods, so a condition that never becomes true is already bounded at ten minutes.
/// What a tight budget here adds is an assertion about *how fast* the condition becomes true, which
/// is a performance property, and one that nothing in these tests declares. On a loaded runner an
/// undeclared performance property is a coin flip: `test_cache_accounts` failed at 3.1s against a
/// 3.0s budget while waiting for a PostgreSQL row to become visible, and nothing was wrong.
///
/// So pick a budget large enough that exceeding it means the condition is genuinely never going to
/// hold, rather than one that tracks how fast the machine happens to be.
///
/// # Panics
///
/// Panics if the timeout duration is exceeded without the condition being met.
#[cfg(feature = "live")]
pub async fn wait_until_async_labeled<F, Fut>(
    mut condition: F,
    timeout: Duration,
    waiting_for: &str,
) where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let start_time = Instant::now(); // dst-ok: test helper timer; uses real time by design

    loop {
        if condition().await {
            break;
        }

        assert!(
            start_time.elapsed() <= timeout,
            "Timeout waiting for {waiting_for} after {:.1}s (limit {:.1}s)",
            start_time.elapsed().as_secs_f64(),
            timeout.as_secs_f64(),
        );

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
