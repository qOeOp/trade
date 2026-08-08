//! Live-node plug-in support.
//!
//! The OSS live crate does not host dynamic plug-ins directly. Public
//! `vibe-plugin` is the guest SDK; host-side loading, vtables, bridge
//! adapters, and server policy belong to the host-side plug-in integration.

#[derive(Debug, Default)]
pub(crate) struct NodePlugins;

impl NodePlugins {
    #[expect(
        clippy::unnecessary_wraps,
        clippy::unused_self,
        reason = "compatibility stub preserves the host-owned lifecycle contract"
    )]
    pub(crate) fn start_controllers(&self) -> anyhow::Result<()> {
        Ok(())
    }

    #[expect(
        clippy::unnecessary_wraps,
        clippy::unused_self,
        reason = "compatibility stub preserves the host-owned lifecycle contract"
    )]
    pub(crate) fn stop_controllers(&self) -> anyhow::Result<()> {
        Ok(())
    }
}
