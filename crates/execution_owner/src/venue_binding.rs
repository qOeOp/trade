//! Which venue an effect may reach, for one Execution Scope, and under what bounds.
//!
//! This module answers one question and refuses the rest. Given an Execution Scope's current
//! adapter binding it yields the effect namespace, the simulator endpoint, the capability set and
//! the reduce-only policy that binding carries. It mints no binding, contacts no venue, and
//! carries no credential: the handle stays inside this Owner and is resolved at effect time.
//!
//! The resolution has no caller today. No Order Engine, Effect Journal or Trade Intent exists, so
//! nothing asks it for a venue. It is built now because it is the one part of the adapter boundary
//! that depends on nothing further upstream, and because a gate built before the thing that must
//! pass through it is cheaper than one retrofitted onto a path that already flows.

use crate::adapter_binding::{
    AdmittedPaperAdapterBinding, PaperAdapterCapability, PaperMode, ReduceOnlyPolicy,
};

/// The venue an effect may reach under one admitted `PAPER` adapter binding.
///
/// Carries no credential. The binding's opaque credential handle stays inside this Owner; a
/// holder of this type learns which binding fact authorises the effect, never how to authenticate
/// as it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoundPaperVenue {
    execution_scope_identity: String,
    mode: PaperMode,
    account_namespace: String,
    effect_namespace: String,
    simulator_endpoint_identity: String,
    capabilities: Vec<PaperAdapterCapability>,
    reduce_only_policy: ReduceOnlyPolicy,
    binding_fact_identity: String,
    binding_generation: u64,
}

impl BoundPaperVenue {
    /// Execution Scope this venue is bound to.
    #[must_use]
    pub fn execution_scope_identity(&self) -> &str {
        &self.execution_scope_identity
    }

    /// Typed mode the binding admitted.
    #[must_use]
    pub const fn mode(&self) -> PaperMode {
        self.mode
    }

    /// Account namespace the binding opened.
    #[must_use]
    pub fn account_namespace(&self) -> &str {
        &self.account_namespace
    }

    /// Effect namespace every effect under this venue belongs to.
    #[must_use]
    pub fn effect_namespace(&self) -> &str {
        &self.effect_namespace
    }

    /// Simulator endpoint the binding admitted.
    #[must_use]
    pub fn simulator_endpoint_identity(&self) -> &str {
        &self.simulator_endpoint_identity
    }

    /// Exact capability set the binding carries, in the binding's own order.
    #[must_use]
    pub fn capabilities(&self) -> &[PaperAdapterCapability] {
        &self.capabilities
    }

    /// Reduce-only policy the binding carries.
    #[must_use]
    pub const fn reduce_only_policy(&self) -> ReduceOnlyPolicy {
        self.reduce_only_policy
    }

    /// Exact binding fact this venue was projected from.
    ///
    /// An effect records this rather than the venue's own coordinates, so that a later reader can
    /// ask this Owner which admission the effect ran under.
    #[must_use]
    pub fn binding_fact_identity(&self) -> &str {
        &self.binding_fact_identity
    }

    /// Generation of the binding fact this venue was projected from.
    #[must_use]
    pub const fn binding_generation(&self) -> u64 {
        self.binding_generation
    }

    /// Whether the binding admitted an exact capability.
    #[must_use]
    pub fn permits(&self, capability: PaperAdapterCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

/// Projects the venue an effect may reach from one admitted binding.
///
/// Takes [`AdmittedPaperAdapterBinding`], whose only constructor refuses every non-admitted state,
/// so this projection cannot be reached for a superseded, revoked or incompatible binding. Those
/// refuse earlier and under their own names, and the absent case refuses as
/// [`crate::adapter_binding::AdapterBindingError::FactNotFound`].
///
/// A non-`PAPER` mode is not a case this projection can encounter. `PaperMode` carries a single
/// variant and the stored binding's mode column carries `CHECK (mode = 'PAPER')`, so no admitted
/// path produces one. Those two facts are what would have to change first, and the day either
/// changes is the day this needs a refusal rather than a projection.
#[must_use]
pub fn bind_paper_venue(binding: &AdmittedPaperAdapterBinding) -> BoundPaperVenue {
    BoundPaperVenue {
        execution_scope_identity: binding.execution_scope_identity().to_owned(),
        mode: binding.mode(),
        account_namespace: binding.account_namespace().to_owned(),
        effect_namespace: binding.effect_namespace().to_owned(),
        simulator_endpoint_identity: binding.simulator_endpoint_identity().to_owned(),
        capabilities: binding.capabilities().to_vec(),
        reduce_only_policy: binding.reduce_only_policy(),
        binding_fact_identity: binding.locator().fact_identity.clone(),
        binding_generation: binding.generation(),
    }
}
