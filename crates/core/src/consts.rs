//! Core constants.

/// The VibeTrading string constant.
pub static VIBE_TRADING: &str = "VibeTrading";

/// The VibeTrading version string embedded at compile time.
pub static VIBE_VERSION: &str = env!("VIBE_VERSION");

/// The VibeTrading common User-Agent string including the current version at compile time.
pub static VIBE_USER_AGENT: &str = env!("VIBE_USER_AGENT");

/// Prefix for log messages outside the main logging subsystem.
pub static VIBE_PREFIX: &str = "[VIBE]";
