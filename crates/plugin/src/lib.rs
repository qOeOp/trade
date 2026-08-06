//! Plug-in artifact identity and boundary primitives for VibeTrader.
//!
//! This crate provides the public contract that lets an independently compiled
//! Rust cdylib identify itself to a Vibe host. It defines versioned build
//! metadata, allocator-safe boundary values, opaque host tokens, and the
//! `vibe_plugin!` macro for exporting the standard entry symbol and
//! manifest.

#![warn(clippy::pedantic)]

/// ABI version of the public plug-in metadata contract.
///
/// The host refuses to load a plug-in whose
/// [`PluginManifest::abi_version`](crate::manifest::PluginManifest::abi_version)
/// does not match this value.
pub const VIBE_PLUGIN_ABI_VERSION: u32 = 1;

/// Schema version for [`manifest::PluginBuildId`].
pub const PLUGIN_BUILD_ID_VERSION: u32 = 1;

/// Name of the single `extern "C"` entry symbol every plug-in cdylib exports.
pub const VIBE_PLUGIN_INIT_SYMBOL: &[u8] = b"vibe_plugin_init";

pub mod boundary;
pub mod host;
pub mod manifest;
pub mod panic;

mod macros;

pub use boundary::{BorrowedStr, OwnedBytes, PluginError, PluginErrorCode, PluginResult, Slice};
pub use host::{HostContext, HostVTable};
pub use manifest::{PluginBuildId, PluginInitFn, PluginManifest};

/// Re-exports that plug-in crates typically want in scope.
pub mod prelude {
    pub use crate::{
        BorrowedStr, HostContext, HostVTable, PluginBuildId, PluginError, PluginErrorCode,
        PluginManifest, PluginResult, Slice, VIBE_PLUGIN_ABI_VERSION,
    };
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn init_symbol_matches_exported_entrypoint() {
        assert_eq!(VIBE_PLUGIN_INIT_SYMBOL, b"vibe_plugin_init");
    }
}
