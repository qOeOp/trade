//! The Owner-sealed W3 admission that turns a Design's declared roles into binding declarations.
//!
//! A Design names input roles; it never names a snapshot, a member, a frame or a digest. So the
//! only thing this port accepts is the Composer locator of an attestation R&D already wrote in its
//! own transaction. Market Data reads that attestation through R&D's exact-locator read function,
//! and then resolves its own PIT, Universe Selection, Source Binding, Instrument Master and Market
//! Semantics authorities before any declaration is stored.
//!
//! Reading the attestation and writing the declaration are deliberately not the same principal.
//! `market_data_reader` may execute the Composer resolver and holds nothing in
//! `market_data_private`; `market_data_owner` writes the Owner's custody and is denied that
//! resolver. The composition root proves both halves of that separation before it returns a port,
//! so a single compromised role cannot both invent an attestation and register against it.
//!
//! Admission is idempotent because the declarations are write-once: re-admitting one locator
//! re-derives every binding from live native dependencies and rejoins the stored bytes, or fails
//! closed on a conflict. A lost commit acknowledgement is therefore safe to retry.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::Serialize;

use super::{
    source_binding::BindingDigest, strategy_design_role_set::StrategyDesignRoleSetLocatorV1,
};

/// What one admitted Design's declarations amount to.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyInputBindingAdmissionTerminalV1 {
    design_identity: BindingDigest,
    research_request_identity: BindingDigest,
    pit_request_identity: BindingDigest,
    decision_cut: u64,
    role_count: u64,
}

impl StrategyInputBindingAdmissionTerminalV1 {
    pub(crate) const fn seal(
        design_identity: BindingDigest,
        research_request_identity: BindingDigest,
        pit_request_identity: BindingDigest,
        decision_cut: u64,
        role_count: u64,
    ) -> Self {
        Self {
            design_identity,
            research_request_identity,
            pit_request_identity,
            decision_cut,
            role_count,
        }
    }

    /// The Design whose roles were declared.
    #[must_use]
    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    /// The Research request the Design answers.
    #[must_use]
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    /// The PIT request every role of this Design resolved to.
    ///
    /// This is the coordinate `resolve_pit_request_for_strategy_design_v1` will return.
    #[must_use]
    pub const fn pit_request_identity(&self) -> BindingDigest {
        self.pit_request_identity
    }

    /// The Owner decision cut the coordinate was frozen at.
    #[must_use]
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    /// How many roles were declared. A role set is admitted whole or not at all.
    #[must_use]
    pub const fn role_count(&self) -> u64 {
        self.role_count
    }
}

/// Why an admission reached no declaration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyInputBindingAdmissionErrorV1 {
    /// The locator is malformed, or names no attestation R&D has written.
    UnknownAttestation,
    /// The attestation's own digest does not authenticate its bytes.
    AttestationUntrusted,
    /// A role is not a first-vertical exact-instrument market role this Owner can resolve.
    UnsupportedRole,
    /// No snapshot of this Owner answers a role at or before its decision cut.
    NoMatchingSnapshot,
    /// More than one lineage answers a role at the selected cut, so nothing is chosen.
    AmbiguousSnapshot,
    /// The roles of one Design resolved to different PIT requests.
    SplitCoordinate,
    /// A declaration is already bound to different content.
    RequestConflict,
    /// A native dependency refused the re-derivation the registration requires.
    BindingUnavailable,
    /// The Owner store, or the Composer reader, is unreachable.
    StoreUnavailable,
}

impl Display for StrategyInputBindingAdmissionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::UnknownAttestation => "the locator names no Composer attestation",
            Self::AttestationUntrusted => "the attestation does not authenticate its own bytes",
            Self::UnsupportedRole => "a role is outside the roles this Owner resolves",
            Self::NoMatchingSnapshot => "no snapshot answers a role at its decision cut",
            Self::AmbiguousSnapshot => "more than one lineage answers a role at that cut",
            Self::SplitCoordinate => "the Design's roles resolved to different PIT requests",
            Self::RequestConflict => "a declaration is bound to different content",
            Self::BindingUnavailable => "a native dependency refused the re-derivation",
            Self::StoreUnavailable => "the Market Data store is unavailable",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for StrategyInputBindingAdmissionErrorV1 {}

/// The sealed production admission for Strategy Input Binding declarations.
#[async_trait]
pub trait StrategyInputBindingAdmissionV1: Send + Sync + sealed::Sealed {
    /// Declares every input role of the Design one Composer attestation authenticates.
    ///
    /// # Errors
    ///
    /// Returns a bounded category. A role set is declared whole or not at all, and re-admitting
    /// the same locator rejoins the same declarations.
    async fn admit(
        &self,
        locator: StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyInputBindingAdmissionTerminalV1, StrategyInputBindingAdmissionErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Strategy Input Binding admission.
///
/// The deployment configuration root chooses both principals: `MARKET_DATA_OWNER_DATABASE_URL`
/// writes the Owner's custody and `MARKET_DATA_RD_ROLE_SET_DATABASE_URL` reads the Composer
/// attestation. Their capabilities are proved to be disjoint before a port is returned.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn strategy_input_binding_admission_from_environment_v1()
-> Result<Arc<dyn StrategyInputBindingAdmissionV1>, StrategyInputBindingAdmissionErrorV1> {
    super::postgres::strategy_input_binding_admission_from_environment_v1().await
}
