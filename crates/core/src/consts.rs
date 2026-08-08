//! Core constants.

/// The VibeTrader string constant.
pub static VIBE_TRADER: &str = "VibeTrader";

/// The VibeTrader version string embedded at compile time.
pub static VIBE_VERSION: &str = env!("VIBE_VERSION");

/// The VibeTrader common User-Agent string including the current version at compile time.
pub static VIBE_USER_AGENT: &str = env!("VIBE_USER_AGENT");

/// Prefix for log messages outside the main logging subsystem.
pub static VIBE_PREFIX: &str = "[VIBE]";
