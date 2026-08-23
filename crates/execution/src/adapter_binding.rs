//! Execution-owned PAPER adapter binding facts.
//!
//! This module deliberately stops at owner-local admission and readback. It has no adapter
//! invocation surface and does not access credential material.
//! The production surface is a static, fail-closed prerequisite: it exposes untrusted vocabulary
//! and a read port, but no positive store composition or writer authority.
//!
//! A downstream crate cannot instantiate or commit through the Owner fixture:
//!
//! ```compile_fail
//! use vibe_execution::adapter_binding::{
//!     PaperAdapterBindingDraft, PaperAdapterBindingStore,
//! };
//!
//! let owner = PaperAdapterBindingStore::new("caller-node")?;
//! let proposal: PaperAdapterBindingDraft = todo!();
//! let _ = owner.commit(proposal)?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! Positive readback cannot be constructed outside this module:
//!
//! ```compile_fail
//! use vibe_execution::adapter_binding::AdmittedPaperAdapterBinding;
//!
//! let _forged = AdmittedPaperAdapterBinding {};
//! ```
//!
//! Positive readback also cannot be deserialized from caller-controlled bytes:
//!
//! ```compile_fail
//! use serde::de::DeserializeOwned;
//! use vibe_execution::adapter_binding::AdmittedPaperAdapterBinding;
//!
//! fn requires_deserialize<T: DeserializeOwned>() {}
//! requires_deserialize::<AdmittedPaperAdapterBinding>();
//! ```
//!
//! Implementing the read port over caller-created state cannot mint a positive readback:
//!
//! ```compile_fail
//! use vibe_execution::adapter_binding::{
//!     AdapterBindingError, AdmittedPaperAdapterBinding, PaperAdapterBindingLocator,
//!     PaperAdapterBindingReadPort, PaperAdapterCapability,
//! };
//!
//! struct CallerState;
//!
//! impl PaperAdapterBindingReadPort for CallerState {
//!     fn resolve_admitted(
//!         &self,
//!         _locator: &PaperAdapterBindingLocator,
//!         _capabilities: &[PaperAdapterCapability],
//!     ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError> {
//!         Ok(AdmittedPaperAdapterBinding {})
//!     }
//! }
//! ```
//!
//! The public read port has no caller-controlled time argument:
//!
//! ```compile_fail
//! use vibe_execution::adapter_binding::{
//!     PaperAdapterBindingLocator, PaperAdapterBindingReadPort, PaperAdapterCapability,
//! };
//!
//! fn caller_chooses_now(
//!     port: &dyn PaperAdapterBindingReadPort,
//!     locator: &PaperAdapterBindingLocator,
//!     capabilities: &[PaperAdapterCapability],
//! ) {
//!     let _ = port.resolve_admitted(locator, 1_200, capabilities);
//! }
//! ```

use std::{
    error::Error,
    fmt::{Debug, Display},
};

use sha2::{Digest, Sha256};
#[cfg(test)]
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};

/// Canonical owner identity for all records in this module.
pub const EXECUTION_OWNER: &str = "EXECUTION";
/// Canonical fact kind for PAPER adapter bindings.
pub const PAPER_ADAPTER_BINDING_KIND: &str = "execution-paper-adapter-binding-v1";
/// Canonical outbox kind emitted atomically with each new fact.
pub const PAPER_ADAPTER_BINDING_OUTBOX_KIND: &str = "execution-paper-adapter-binding-outbox-v1";
/// Schema version used by the foundation.
pub const PAPER_ADAPTER_BINDING_SCHEMA_VERSION: u32 = 1;
/// Honest maturity of the public production surface.
pub const PAPER_ADAPTER_BINDING_MATURITY: &str =
    "STATIC_LOCAL_OWNER_CONTRACT_NOT_DEPLOYMENT_ADMISSION_NOT_WORKSPACE_LOCKED";

#[cfg(test)]
const FACT_ID_DOMAIN: &[u8] = b"vibe.execution.paper-adapter-binding.fact-id.v1\0";
#[cfg(test)]
const CONTENT_DIGEST_DOMAIN: &[u8] = b"vibe.execution.paper-adapter-binding.content-digest.v1\0";
#[cfg(test)]
const OUTBOX_ID_DOMAIN: &[u8] = b"vibe.execution.paper-adapter-binding.outbox-id.v1\0";
const PAPER_ACCOUNT_NAMESPACE_DOMAIN: &[u8] =
    b"vibe.execution.paper-adapter-binding.account-namespace.v1\0";
const PAPER_EFFECT_NAMESPACE_DOMAIN: &[u8] =
    b"vibe.execution.paper-adapter-binding.effect-namespace.v1\0";
const PAPER_ACCOUNT_NAMESPACE_PREFIX: &str = "paper.accounts.v1.";
const PAPER_EFFECT_NAMESPACE_PREFIX: &str = "paper.effects.v1.";

/// The only execution mode admitted by this foundation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PaperMode {
    /// Simulated execution with no production venue effect.
    Paper,
}

/// Derives the only valid PAPER account namespace for one Execution Scope.
///
/// The exact form is `paper.accounts.v1.<64 lowercase SHA-256 hex characters>`. This pure helper
/// only forms untrusted proposal vocabulary; it confers no admission or writer authority.
///
/// # Errors
///
/// Returns [`AdapterBindingError::InvalidField`] when the scope identity is malformed.
pub fn derive_paper_account_namespace(
    mode: PaperMode,
    execution_scope_identity: &str,
) -> Result<String, AdapterBindingError> {
    derive_paper_namespace(
        PAPER_ACCOUNT_NAMESPACE_DOMAIN,
        PAPER_ACCOUNT_NAMESPACE_PREFIX,
        mode,
        execution_scope_identity,
    )
}

/// Derives the only valid PAPER effect namespace for one Execution Scope.
///
/// The exact form is `paper.effects.v1.<64 lowercase SHA-256 hex characters>`. This pure helper
/// only forms untrusted proposal vocabulary; it confers no admission or writer authority.
///
/// # Errors
///
/// Returns [`AdapterBindingError::InvalidField`] when the scope identity is malformed.
pub fn derive_paper_effect_namespace(
    mode: PaperMode,
    execution_scope_identity: &str,
) -> Result<String, AdapterBindingError> {
    derive_paper_namespace(
        PAPER_EFFECT_NAMESPACE_DOMAIN,
        PAPER_EFFECT_NAMESPACE_PREFIX,
        mode,
        execution_scope_identity,
    )
}

fn derive_paper_namespace(
    domain: &[u8],
    prefix: &str,
    mode: PaperMode,
    execution_scope_identity: &str,
) -> Result<String, AdapterBindingError> {
    validate_identifier("execution_scope_identity", execution_scope_identity)?;
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update([mode_tag(mode)]);
    hasher.update((execution_scope_identity.len() as u64).to_be_bytes());
    hasher.update(execution_scope_identity.as_bytes());
    Ok(format!("{prefix}{:x}", hasher.finalize()))
}

const fn mode_tag(mode: PaperMode) -> u8 {
    match mode {
        PaperMode::Paper => 1,
    }
}

/// Immutable admission state recorded by Execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum AdapterBindingState {
    /// The binding may resolve while it is current and fresh.
    Admitted,
    /// A successor binding replaced this binding.
    Superseded,
    /// Execution revoked this binding.
    Revoked,
    /// Execution found the binding incompatible with its contract.
    Incompatible,
}

/// Capabilities fixed by an immutable binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PaperAdapterCapability {
    /// Submit an order to the simulator.
    SubmitOrder,
    /// Cancel an order in the simulator.
    CancelOrder,
    /// Read back an authoritative order state.
    OrderReadback,
    /// Read back authoritative account state.
    AccountReadback,
    /// Enforce reduce-only behavior before mutation.
    EnforceableReduceOnly,
    /// Cancel multiple selected orders in one simulator operation.
    BatchCancel,
}

/// The reduce-only enforcement policy fixed by the binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReduceOnlyPolicy {
    /// The simulator must reject any action that could increase or cross exposure.
    SimulatorRejectIncreaseOrCrossZero,
}

/// Opaque identity of a least-privilege credential handle.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct CredentialHandleIdentity(String);

impl CredentialHandleIdentity {
    /// Parses a credential-handle identity without accessing credential material.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::InvalidField`] when the identity is malformed.
    pub fn parse(value: impl Into<String>) -> Result<Self, AdapterBindingError> {
        let value = value.into();
        validate_identifier("credential_handle_identity", &value)?;
        Ok(Self(value))
    }

    #[cfg(test)]
    fn expose_to_owner(&self) -> &str {
        &self.0
    }
}

impl Debug for CredentialHandleIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CredentialHandleIdentity([REDACTED])")
    }
}

/// Caller-supplied proposal validated and normalized before the first owner write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperAdapterBindingDraft {
    /// Schema version. Must equal [`PAPER_ADAPTER_BINDING_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Binding contract version.
    pub binding_version: u32,
    /// Monotonic generation within one Execution Scope.
    pub generation: u64,
    /// Typed PAPER mode.
    pub mode: PaperMode,
    /// Stable Execution Scope identity.
    pub execution_scope_identity: String,
    /// PAPER-only account namespace.
    pub account_namespace: String,
    /// PAPER-only effect namespace.
    pub effect_namespace: String,
    /// Upstream logical account identity.
    pub source_account_identity: String,
    /// Simulator account identity.
    pub simulator_account_identity: String,
    /// Authenticated simulator endpoint identity, never an invocation client.
    pub simulator_endpoint_identity: String,
    /// SHA-256 implementation digest encoded as 64 lowercase hexadecimal characters.
    pub implementation_digest: String,
    /// SHA-256 configuration digest encoded as 64 lowercase hexadecimal characters.
    pub configuration_digest: String,
    /// Complete required capability set; order is normalized by Execution.
    pub required_capabilities: Vec<PaperAdapterCapability>,
    /// Enforceable reduce-only policy.
    pub reduce_only_policy: ReduceOnlyPolicy,
    /// Opaque least-privilege handle identity.
    pub credential_handle_identity: CredentialHandleIdentity,
    /// Trust policy identity and version.
    pub trust_policy_identity: String,
    /// Immutable state.
    pub state: AdapterBindingState,
    /// Inclusive start of the binding interval.
    pub effective_at_epoch_ms: u64,
    /// Owner observation time.
    pub observed_at_epoch_ms: u64,
    /// Exclusive end of the binding interval.
    pub exclusive_valid_through_epoch_ms: u64,
    /// Clock epoch under which the time evidence was observed.
    pub clock_epoch: u64,
}

/// Execution-native fact frontier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeBindingFrontier {
    /// Owner-native stream identity.
    pub stream_identity: String,
    /// Exact committed cut identity.
    pub cut_identity: String,
    /// Nonzero stream sequence.
    pub sequence: u64,
}

/// Untrusted locator. Positive authority exists only after exact native-store resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperAdapterBindingLocator {
    /// Canonical owner identity.
    pub owner_identity: String,
    /// Exact native store node.
    pub owner_node_identity: String,
    /// Canonical fact kind.
    pub fact_kind: String,
    /// Execution Scope identity.
    pub execution_scope_identity: String,
    /// Typed PAPER mode.
    pub mode: PaperMode,
    /// Binding generation.
    pub generation: u64,
    /// Immutable state asserted by the locator.
    pub state: AdapterBindingState,
    /// Domain-separated fact identity.
    pub fact_identity: String,
    /// Domain-separated content digest.
    pub content_digest: String,
    /// Native source frontier.
    pub frontier: NativeBindingFrontier,
    /// Inclusive effective time.
    pub effective_at_epoch_ms: u64,
    /// Owner observation time.
    pub observed_at_epoch_ms: u64,
    /// Exclusive validity bound.
    pub exclusive_valid_through_epoch_ms: u64,
    /// Time-evidence clock epoch.
    pub clock_epoch: u64,
}

/// Whether a commit inserted a fact or joined an exact replay.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AdapterBindingCommitDisposition {
    /// One fact and one outbox record were inserted atomically.
    Inserted,
    /// The exact earlier fact was joined with no successor write.
    ExactReplay,
}

/// Receipt returned by the Execution owner store.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct PaperAdapterBindingCommitReceipt {
    /// Commit disposition.
    disposition: AdapterBindingCommitDisposition,
    /// Untrusted locator for subsequent direct resolution.
    locator: PaperAdapterBindingLocator,
}

/// Errors returned by the PAPER binding owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterBindingError {
    /// A named identifier or fixed version is invalid.
    InvalidField(&'static str),
    /// A named digest is not exactly 32 bytes of lowercase hexadecimal.
    InvalidDigest(&'static str),
    /// The capability set is incomplete or contains duplicates.
    InvalidCapabilities,
    /// Time evidence is zero, unordered, or otherwise invalid.
    InvalidTimeEvidence,
    /// A successor regressed its clock epoch or time interval.
    NonMonotonicSuccessorTime,
    /// A generation did not immediately follow the current head.
    InvalidGeneration { expected: u64, actual: u64 },
    /// The same scope and generation were reused with changed meaning.
    ConflictingReplay,
    /// A retained namespace reservation belongs to another mode, class, or scope.
    NamespaceAlreadyReserved,
    /// The owner store lock was unavailable.
    StoreUnavailable,
    /// No native fact exists for the locator identity.
    FactNotFound,
    /// Caller locator bytes differ from the native record.
    LocatorMismatch,
    /// The located fact is no longer the current head.
    NotCurrentHead,
    /// The current fact is not admitted.
    NotAdmitted,
    /// The requested capability set is not satisfied.
    CapabilityMismatch,
    /// The supplied resolution time is outside the fact's admitted interval.
    TimeMismatch,
}

impl Display for AdapterBindingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidField(field) => write!(formatter, "invalid {field}"),
            Self::InvalidDigest(field) => write!(formatter, "invalid {field}"),
            Self::InvalidCapabilities => formatter.write_str("invalid capability set"),
            Self::InvalidTimeEvidence => formatter.write_str("invalid time evidence"),
            Self::NonMonotonicSuccessorTime => {
                formatter.write_str("non-monotonic successor time evidence")
            }
            Self::InvalidGeneration { expected, actual } => {
                write!(
                    formatter,
                    "invalid generation: expected {expected}, received {actual}"
                )
            }
            Self::ConflictingReplay => formatter.write_str("conflicting binding replay"),
            Self::NamespaceAlreadyReserved => {
                formatter.write_str("binding namespace already reserved")
            }
            Self::StoreUnavailable => formatter.write_str("Execution binding store unavailable"),
            Self::FactNotFound => formatter.write_str("binding fact not found"),
            Self::LocatorMismatch => formatter.write_str("binding locator mismatch"),
            Self::NotCurrentHead => formatter.write_str("binding is not the current head"),
            Self::NotAdmitted => formatter.write_str("binding is not admitted"),
            Self::CapabilityMismatch => formatter.write_str("binding capability mismatch"),
            Self::TimeMismatch => formatter.write_str("binding time evidence mismatch or stale"),
        }
    }
}

impl Error for AdapterBindingError {}

/// Read-only authority boundary injected by the legal Execution composition owner.
///
/// Downstream implementations cannot mint positive results because
/// [`AdmittedPaperAdapterBinding`] has no public constructor.
pub trait PaperAdapterBindingReadPort: Send + Sync {
    /// Resolves one untrusted locator under exact capabilities and Owner-sampled time evidence.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError`] for every unavailable, mismatched, stale, non-current, or
    /// non-admitted representation.
    fn resolve_admitted(
        &self,
        locator: &PaperAdapterBindingLocator,
        required_capabilities: &[PaperAdapterCapability],
    ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BindingMeaning {
    schema_version: u32,
    binding_version: u32,
    generation: u64,
    mode: PaperMode,
    execution_scope_identity: String,
    account_namespace: String,
    effect_namespace: String,
    source_account_identity: String,
    simulator_account_identity: String,
    simulator_endpoint_identity: String,
    implementation_digest: String,
    configuration_digest: String,
    required_capabilities: Vec<PaperAdapterCapability>,
    reduce_only_policy: ReduceOnlyPolicy,
    credential_handle_identity: CredentialHandleIdentity,
    trust_policy_identity: String,
    state: AdapterBindingState,
    effective_at_epoch_ms: u64,
    observed_at_epoch_ms: u64,
    exclusive_valid_through_epoch_ms: u64,
    clock_epoch: u64,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct BindingFactRecord {
    meaning: BindingMeaning,
    locator: PaperAdapterBindingLocator,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct BindingOutboxRecord {
    outbox_identity: String,
    fact_identity: String,
    content_digest: String,
    frontier: NativeBindingFrontier,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy)]
struct TrustedFixtureClock {
    now_epoch_ms: u64,
    clock_epoch: u64,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NamespaceClass {
    Account,
    Effect,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct NamespaceReservation {
    mode: PaperMode,
    namespace_class: NamespaceClass,
    execution_scope_identity: String,
}

#[cfg(test)]
#[derive(Debug)]
struct BindingStoreState {
    facts: BTreeMap<String, BindingFactRecord>,
    slots: BTreeMap<(String, u64), String>,
    heads: BTreeMap<String, String>,
    namespace_reservations: BTreeMap<String, NamespaceReservation>,
    outbox: Vec<BindingOutboxRecord>,
    next_sequence: u64,
    trusted_clock: TrustedFixtureClock,
}

/// Test-only positive Owner fixture; production exposes no construction path.
#[cfg(test)]
#[derive(Debug)]
struct PaperAdapterBindingStore {
    node_identity: String,
    stream_identity: String,
    state: Mutex<BindingStoreState>,
}

#[cfg(test)]
impl PaperAdapterBindingStore {
    /// Creates one Execution-native store node.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::InvalidField`] for a malformed node identity.
    fn new(
        node_identity: impl Into<String>,
        now_epoch_ms: u64,
        clock_epoch: u64,
    ) -> Result<Self, AdapterBindingError> {
        let node_identity = node_identity.into();
        validate_identifier("owner_node_identity", &node_identity)?;

        if now_epoch_ms == 0 || clock_epoch == 0 {
            return Err(AdapterBindingError::InvalidTimeEvidence);
        }
        let stream_identity = format!("execution.paper-adapter-binding.{node_identity}");
        Ok(Self {
            node_identity,
            stream_identity,
            state: Mutex::new(BindingStoreState {
                facts: BTreeMap::new(),
                slots: BTreeMap::new(),
                heads: BTreeMap::new(),
                namespace_reservations: BTreeMap::new(),
                outbox: Vec::new(),
                next_sequence: 1,
                trusted_clock: TrustedFixtureClock {
                    now_epoch_ms,
                    clock_epoch,
                },
            }),
        })
    }

    fn advance_trusted_clock(
        &self,
        now_epoch_ms: u64,
        clock_epoch: u64,
    ) -> Result<(), AdapterBindingError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;

        if now_epoch_ms < state.trusted_clock.now_epoch_ms
            || clock_epoch < state.trusted_clock.clock_epoch
        {
            return Err(AdapterBindingError::InvalidTimeEvidence);
        }
        state.trusted_clock = TrustedFixtureClock {
            now_epoch_ms,
            clock_epoch,
        };
        Ok(())
    }

    /// Validates, normalizes, and atomically records one fact and one outbox record.
    ///
    /// Exact replay joins the earlier record. Changed meaning under the same scope and generation
    /// conflicts before any successor write.
    ///
    /// # Errors
    ///
    /// Returns an [`AdapterBindingError`] when validation, generation, replay, or store custody
    /// fails. All validation failures occur before a write.
    fn commit(
        &self,
        draft: PaperAdapterBindingDraft,
    ) -> Result<PaperAdapterBindingCommitReceipt, AdapterBindingError> {
        let meaning = normalize_draft(draft)?;
        let slot = (meaning.execution_scope_identity.clone(), meaning.generation);
        let mut state = self
            .state
            .lock()
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;

        let proposed_reservations = [
            (
                meaning.account_namespace.clone(),
                NamespaceReservation {
                    mode: meaning.mode,
                    namespace_class: NamespaceClass::Account,
                    execution_scope_identity: meaning.execution_scope_identity.clone(),
                },
            ),
            (
                meaning.effect_namespace.clone(),
                NamespaceReservation {
                    mode: meaning.mode,
                    namespace_class: NamespaceClass::Effect,
                    execution_scope_identity: meaning.execution_scope_identity.clone(),
                },
            ),
        ];

        for (namespace, proposed) in &proposed_reservations {
            if let Some(existing) = state.namespace_reservations.get(namespace)
                && existing != proposed
            {
                return Err(AdapterBindingError::NamespaceAlreadyReserved);
            }
        }

        if let Some(existing_identity) = state.slots.get(&slot) {
            let existing = state
                .facts
                .get(existing_identity)
                .ok_or(AdapterBindingError::StoreUnavailable)?;
            if existing.meaning != meaning {
                return Err(AdapterBindingError::ConflictingReplay);
            }
            return Ok(PaperAdapterBindingCommitReceipt {
                disposition: AdapterBindingCommitDisposition::ExactReplay,
                locator: existing.locator.clone(),
            });
        }

        if meaning.clock_epoch != state.trusted_clock.clock_epoch
            || meaning.observed_at_epoch_ms > state.trusted_clock.now_epoch_ms
        {
            return Err(AdapterBindingError::InvalidTimeEvidence);
        }

        let current_head = state
            .heads
            .get(&meaning.execution_scope_identity)
            .map(|head_identity| {
                state
                    .facts
                    .get(head_identity)
                    .ok_or(AdapterBindingError::StoreUnavailable)
            })
            .transpose()?;
        let expected_generation = match current_head {
            Some(head) => head.meaning.generation.checked_add(1).ok_or(
                AdapterBindingError::InvalidGeneration {
                    expected: u64::MAX,
                    actual: meaning.generation,
                },
            )?,
            None => 1,
        };

        if meaning.generation != expected_generation {
            return Err(AdapterBindingError::InvalidGeneration {
                expected: expected_generation,
                actual: meaning.generation,
            });
        }

        if let Some(head) = current_head
            && (meaning.clock_epoch < head.meaning.clock_epoch
                || meaning.effective_at_epoch_ms < head.meaning.effective_at_epoch_ms
                || meaning.observed_at_epoch_ms <= head.meaning.observed_at_epoch_ms
                || meaning.exclusive_valid_through_epoch_ms
                    < head.meaning.exclusive_valid_through_epoch_ms)
        {
            return Err(AdapterBindingError::NonMonotonicSuccessorTime);
        }

        let sequence = state.next_sequence;
        if sequence == 0 {
            return Err(AdapterBindingError::StoreUnavailable);
        }
        let next_sequence = sequence
            .checked_add(1)
            .ok_or(AdapterBindingError::StoreUnavailable)?;
        let frontier = NativeBindingFrontier {
            stream_identity: self.stream_identity.clone(),
            cut_identity: format!("{}:{sequence}", self.stream_identity),
            sequence,
        };
        let semantic_bytes = canonical_semantic_bytes(&meaning);
        let fact_identity = derive_digest(FACT_ID_DOMAIN, &semantic_bytes);
        let content_digest = derive_digest(CONTENT_DIGEST_DOMAIN, &semantic_bytes);
        let locator = PaperAdapterBindingLocator {
            owner_identity: EXECUTION_OWNER.to_string(),
            owner_node_identity: self.node_identity.clone(),
            fact_kind: PAPER_ADAPTER_BINDING_KIND.to_string(),
            execution_scope_identity: meaning.execution_scope_identity.clone(),
            mode: meaning.mode,
            generation: meaning.generation,
            state: meaning.state,
            fact_identity: fact_identity.clone(),
            content_digest: content_digest.clone(),
            frontier: frontier.clone(),
            effective_at_epoch_ms: meaning.effective_at_epoch_ms,
            observed_at_epoch_ms: meaning.observed_at_epoch_ms,
            exclusive_valid_through_epoch_ms: meaning.exclusive_valid_through_epoch_ms,
            clock_epoch: meaning.clock_epoch,
        };
        let outbox_identity = derive_digest(
            OUTBOX_ID_DOMAIN,
            &canonical_outbox_bytes(&fact_identity, &content_digest, &frontier),
        );
        let fact = BindingFactRecord {
            meaning,
            locator: locator.clone(),
        };
        let outbox = BindingOutboxRecord {
            outbox_identity,
            fact_identity: fact_identity.clone(),
            content_digest,
            frontier,
        };
        debug_assert!(!outbox.outbox_identity.is_empty());
        debug_assert_eq!(outbox.fact_identity, fact.locator.fact_identity);
        debug_assert_eq!(outbox.content_digest, fact.locator.content_digest);
        debug_assert_eq!(outbox.frontier, fact.locator.frontier);

        state.facts.insert(fact_identity.clone(), fact);
        state.slots.insert(slot, fact_identity.clone());
        state
            .heads
            .insert(locator.execution_scope_identity.clone(), fact_identity);

        for (namespace, reservation) in proposed_reservations {
            state
                .namespace_reservations
                .entry(namespace)
                .or_insert(reservation);
        }
        state.outbox.push(outbox);
        state.next_sequence = next_sequence;

        Ok(PaperAdapterBindingCommitReceipt {
            disposition: AdapterBindingCommitDisposition::Inserted,
            locator,
        })
    }

    fn resolve_for_read_port(
        &self,
        locator: &PaperAdapterBindingLocator,
        required_capabilities: &[PaperAdapterCapability],
    ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError> {
        let required = normalize_capabilities(required_capabilities)?;
        let state = self
            .state
            .lock()
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;
        let fact = state
            .facts
            .get(&locator.fact_identity)
            .ok_or(AdapterBindingError::FactNotFound)?;

        if &fact.locator != locator {
            return Err(AdapterBindingError::LocatorMismatch);
        }

        if state.heads.get(&fact.meaning.execution_scope_identity)
            != Some(&fact.locator.fact_identity)
        {
            return Err(AdapterBindingError::NotCurrentHead);
        }

        if fact.meaning.mode != PaperMode::Paper {
            return Err(AdapterBindingError::LocatorMismatch);
        }

        if fact.meaning.state != AdapterBindingState::Admitted {
            return Err(AdapterBindingError::NotAdmitted);
        }

        if !required
            .iter()
            .all(|capability| fact.meaning.required_capabilities.contains(capability))
        {
            return Err(AdapterBindingError::CapabilityMismatch);
        }

        if state.trusted_clock.clock_epoch != fact.meaning.clock_epoch
            || state.trusted_clock.now_epoch_ms < fact.meaning.effective_at_epoch_ms
            || state.trusted_clock.now_epoch_ms < fact.meaning.observed_at_epoch_ms
            || state.trusted_clock.now_epoch_ms >= fact.meaning.exclusive_valid_through_epoch_ms
        {
            return Err(AdapterBindingError::TimeMismatch);
        }
        Ok(AdmittedPaperAdapterBinding {
            locator: fact.locator.clone(),
            meaning: fact.meaning.clone(),
        })
    }

    /// Returns native fact and outbox counts for owner-store auditing.
    ///
    /// # Errors
    ///
    /// Returns [`AdapterBindingError::StoreUnavailable`] if store custody is unavailable.
    fn record_counts(&self) -> Result<(usize, usize), AdapterBindingError> {
        let state = self
            .state
            .lock()
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;
        Ok((state.facts.len(), state.outbox.len()))
    }

    fn namespace_reservation_count(&self) -> Result<usize, AdapterBindingError> {
        let state = self
            .state
            .lock()
            .map_err(|_| AdapterBindingError::StoreUnavailable)?;
        Ok(state.namespace_reservations.len())
    }
}

#[cfg(test)]
impl PaperAdapterBindingReadPort for PaperAdapterBindingStore {
    fn resolve_admitted(
        &self,
        locator: &PaperAdapterBindingLocator,
        required_capabilities: &[PaperAdapterCapability],
    ) -> Result<AdmittedPaperAdapterBinding, AdapterBindingError> {
        self.resolve_for_read_port(locator, required_capabilities)
    }
}

/// Sealed positive native-store readback.
///
/// This type has private fields and intentionally implements neither `Deserialize` nor a public
/// constructor. Possession proves that an injected [`PaperAdapterBindingReadPort`] resolved it.
#[derive(Debug, PartialEq, Eq)]
pub struct AdmittedPaperAdapterBinding {
    locator: PaperAdapterBindingLocator,
    meaning: BindingMeaning,
}

impl AdmittedPaperAdapterBinding {
    /// Returns the exact native locator that was resolved.
    pub fn locator(&self) -> &PaperAdapterBindingLocator {
        &self.locator
    }

    /// Returns the canonical binding schema version.
    pub fn schema_version(&self) -> u32 {
        self.meaning.schema_version
    }

    /// Returns the binding contract version.
    pub fn binding_version(&self) -> u32 {
        self.meaning.binding_version
    }

    /// Returns the monotonic generation within the Execution Scope.
    pub fn generation(&self) -> u64 {
        self.meaning.generation
    }

    /// Returns the typed PAPER mode.
    pub fn mode(&self) -> PaperMode {
        self.meaning.mode
    }

    /// Returns the exact Execution Scope identity.
    pub fn execution_scope_identity(&self) -> &str {
        &self.meaning.execution_scope_identity
    }

    /// Returns the PAPER account namespace.
    pub fn account_namespace(&self) -> &str {
        &self.meaning.account_namespace
    }

    /// Returns the PAPER effect namespace.
    pub fn effect_namespace(&self) -> &str {
        &self.meaning.effect_namespace
    }

    /// Returns the upstream logical account identity.
    pub fn source_account_identity(&self) -> &str {
        &self.meaning.source_account_identity
    }

    /// Returns the mapped simulator account identity.
    pub fn simulator_account_identity(&self) -> &str {
        &self.meaning.simulator_account_identity
    }

    /// Returns the authenticated simulator endpoint identity.
    pub fn simulator_endpoint_identity(&self) -> &str {
        &self.meaning.simulator_endpoint_identity
    }

    /// Returns the immutable adapter implementation digest.
    pub fn implementation_digest(&self) -> &str {
        &self.meaning.implementation_digest
    }

    /// Returns the immutable adapter configuration digest.
    pub fn configuration_digest(&self) -> &str {
        &self.meaning.configuration_digest
    }

    /// Returns the normalized immutable capability set.
    pub fn capabilities(&self) -> &[PaperAdapterCapability] {
        &self.meaning.required_capabilities
    }

    /// Returns the enforceable reduce-only policy.
    pub fn reduce_only_policy(&self) -> ReduceOnlyPolicy {
        self.meaning.reduce_only_policy
    }

    /// Returns the opaque handle identity with redacted `Debug` output.
    pub fn credential_handle_identity(&self) -> &CredentialHandleIdentity {
        &self.meaning.credential_handle_identity
    }

    /// Returns the immutable trust policy identity and version.
    pub fn trust_policy_identity(&self) -> &str {
        &self.meaning.trust_policy_identity
    }

    /// Returns the immutable admission state resolved by Execution.
    pub fn state(&self) -> AdapterBindingState {
        self.meaning.state
    }

    /// Returns the inclusive start of the binding interval.
    pub fn effective_at_epoch_ms(&self) -> u64 {
        self.meaning.effective_at_epoch_ms
    }

    /// Returns the Owner observation time.
    pub fn observed_at_epoch_ms(&self) -> u64 {
        self.meaning.observed_at_epoch_ms
    }

    /// Returns the exclusive end of the binding interval.
    pub fn exclusive_valid_through_epoch_ms(&self) -> u64 {
        self.meaning.exclusive_valid_through_epoch_ms
    }

    /// Returns the clock epoch that owns the resolved time evidence.
    pub fn clock_epoch(&self) -> u64 {
        self.meaning.clock_epoch
    }
}

#[cfg(test)]
fn normalize_draft(draft: PaperAdapterBindingDraft) -> Result<BindingMeaning, AdapterBindingError> {
    if draft.schema_version != PAPER_ADAPTER_BINDING_SCHEMA_VERSION {
        return Err(AdapterBindingError::InvalidField("schema_version"));
    }

    if draft.binding_version == 0 {
        return Err(AdapterBindingError::InvalidField("binding_version"));
    }

    if draft.generation == 0 {
        return Err(AdapterBindingError::InvalidField("generation"));
    }
    validate_identifier("execution_scope_identity", &draft.execution_scope_identity)?;
    validate_identifier("account_namespace", &draft.account_namespace)?;
    validate_identifier("effect_namespace", &draft.effect_namespace)?;
    let expected_account_namespace =
        derive_paper_account_namespace(draft.mode, &draft.execution_scope_identity)?;
    if draft.account_namespace != expected_account_namespace {
        return Err(AdapterBindingError::InvalidField("account_namespace"));
    }

    let expected_effect_namespace =
        derive_paper_effect_namespace(draft.mode, &draft.execution_scope_identity)?;
    if draft.effect_namespace != expected_effect_namespace {
        return Err(AdapterBindingError::InvalidField("effect_namespace"));
    }
    validate_identifier("source_account_identity", &draft.source_account_identity)?;
    validate_identifier(
        "simulator_account_identity",
        &draft.simulator_account_identity,
    )?;
    validate_identifier(
        "simulator_endpoint_identity",
        &draft.simulator_endpoint_identity,
    )?;
    validate_identifier("trust_policy_identity", &draft.trust_policy_identity)?;
    validate_digest("implementation_digest", &draft.implementation_digest)?;
    validate_digest("configuration_digest", &draft.configuration_digest)?;
    let required_capabilities = normalize_capabilities(&draft.required_capabilities)?;

    for required in [
        PaperAdapterCapability::SubmitOrder,
        PaperAdapterCapability::CancelOrder,
        PaperAdapterCapability::OrderReadback,
        PaperAdapterCapability::AccountReadback,
        PaperAdapterCapability::EnforceableReduceOnly,
    ] {
        if !required_capabilities.contains(&required) {
            return Err(AdapterBindingError::InvalidCapabilities);
        }
    }

    if draft.effective_at_epoch_ms == 0
        || draft.observed_at_epoch_ms == 0
        || draft.exclusive_valid_through_epoch_ms == 0
        || draft.clock_epoch == 0
        || draft.effective_at_epoch_ms > draft.observed_at_epoch_ms
        || draft.observed_at_epoch_ms >= draft.exclusive_valid_through_epoch_ms
    {
        return Err(AdapterBindingError::InvalidTimeEvidence);
    }

    Ok(BindingMeaning {
        schema_version: draft.schema_version,
        binding_version: draft.binding_version,
        generation: draft.generation,
        mode: draft.mode,
        execution_scope_identity: draft.execution_scope_identity,
        account_namespace: draft.account_namespace,
        effect_namespace: draft.effect_namespace,
        source_account_identity: draft.source_account_identity,
        simulator_account_identity: draft.simulator_account_identity,
        simulator_endpoint_identity: draft.simulator_endpoint_identity,
        implementation_digest: draft.implementation_digest,
        configuration_digest: draft.configuration_digest,
        required_capabilities,
        reduce_only_policy: draft.reduce_only_policy,
        credential_handle_identity: draft.credential_handle_identity,
        trust_policy_identity: draft.trust_policy_identity,
        state: draft.state,
        effective_at_epoch_ms: draft.effective_at_epoch_ms,
        observed_at_epoch_ms: draft.observed_at_epoch_ms,
        exclusive_valid_through_epoch_ms: draft.exclusive_valid_through_epoch_ms,
        clock_epoch: draft.clock_epoch,
    })
}

#[cfg(test)]
fn normalize_capabilities(
    capabilities: &[PaperAdapterCapability],
) -> Result<Vec<PaperAdapterCapability>, AdapterBindingError> {
    if capabilities.is_empty() {
        return Err(AdapterBindingError::InvalidCapabilities);
    }
    let set = capabilities.iter().copied().collect::<BTreeSet<_>>();
    if set.len() != capabilities.len() {
        return Err(AdapterBindingError::InvalidCapabilities);
    }
    Ok(set.into_iter().collect())
}

fn validate_identifier(field: &'static str, value: &str) -> Result<(), AdapterBindingError> {
    if !(3..=160).contains(&value.len())
        || !value.is_ascii()
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
    {
        return Err(AdapterBindingError::InvalidField(field));
    }
    Ok(())
}

#[cfg(test)]
fn validate_digest(field: &'static str, value: &str) -> Result<(), AdapterBindingError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AdapterBindingError::InvalidDigest(field));
    }
    Ok(())
}

#[cfg(test)]
fn canonical_semantic_bytes(meaning: &BindingMeaning) -> Vec<u8> {
    let mut encoder = CanonicalEncoder::default();
    encoder.string(EXECUTION_OWNER);
    encoder.string(PAPER_ADAPTER_BINDING_KIND);
    encoder.u32(meaning.schema_version);
    encoder.u32(meaning.binding_version);
    encoder.u64(meaning.generation);
    encoder.u8(mode_tag(meaning.mode));
    encoder.string(&meaning.execution_scope_identity);
    encoder.string(&meaning.account_namespace);
    encoder.string(&meaning.effect_namespace);
    encoder.string(&meaning.source_account_identity);
    encoder.string(&meaning.simulator_account_identity);
    encoder.string(&meaning.simulator_endpoint_identity);
    encoder.string(&meaning.implementation_digest);
    encoder.string(&meaning.configuration_digest);
    encoder.u64(meaning.required_capabilities.len() as u64);
    for capability in &meaning.required_capabilities {
        encoder.u8(capability_tag(*capability));
    }
    encoder.u8(reduce_only_policy_tag(meaning.reduce_only_policy));
    encoder.string(meaning.credential_handle_identity.expose_to_owner());
    encoder.string(&meaning.trust_policy_identity);
    encoder.u8(state_tag(meaning.state));
    encoder.u64(meaning.effective_at_epoch_ms);
    encoder.u64(meaning.observed_at_epoch_ms);
    encoder.u64(meaning.exclusive_valid_through_epoch_ms);
    encoder.u64(meaning.clock_epoch);
    encoder.finish()
}

#[cfg(test)]
fn canonical_outbox_bytes(
    fact_identity: &str,
    content_digest: &str,
    frontier: &NativeBindingFrontier,
) -> Vec<u8> {
    let mut encoder = CanonicalEncoder::default();
    encoder.string(EXECUTION_OWNER);
    encoder.string(PAPER_ADAPTER_BINDING_OUTBOX_KIND);
    encoder.string(fact_identity);
    encoder.string(content_digest);
    encoder.string(&frontier.stream_identity);
    encoder.string(&frontier.cut_identity);
    encoder.u64(frontier.sequence);
    encoder.finish()
}

#[cfg(test)]
fn derive_digest(domain: &[u8], canonical: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(canonical);
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
const fn state_tag(state: AdapterBindingState) -> u8 {
    match state {
        AdapterBindingState::Admitted => 1,
        AdapterBindingState::Superseded => 2,
        AdapterBindingState::Revoked => 3,
        AdapterBindingState::Incompatible => 4,
    }
}

#[cfg(test)]
const fn capability_tag(capability: PaperAdapterCapability) -> u8 {
    match capability {
        PaperAdapterCapability::SubmitOrder => 1,
        PaperAdapterCapability::CancelOrder => 2,
        PaperAdapterCapability::OrderReadback => 3,
        PaperAdapterCapability::AccountReadback => 4,
        PaperAdapterCapability::EnforceableReduceOnly => 5,
        PaperAdapterCapability::BatchCancel => 6,
    }
}

#[cfg(test)]
const fn reduce_only_policy_tag(policy: ReduceOnlyPolicy) -> u8 {
    match policy {
        ReduceOnlyPolicy::SimulatorRejectIncreaseOrCrossZero => 1,
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
struct CanonicalEncoder {
    bytes: Vec<u8>,
}

#[cfg(test)]
impl CanonicalEncoder {
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_be_bytes());
    }

    fn string(&mut self, value: &str) {
        self.u64(value.len() as u64);
        self.bytes.extend_from_slice(value.as_bytes());
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Barrier},
        thread,
    };

    use rstest::rstest;

    use super::*;

    fn capabilities() -> Vec<PaperAdapterCapability> {
        vec![
            PaperAdapterCapability::SubmitOrder,
            PaperAdapterCapability::CancelOrder,
            PaperAdapterCapability::OrderReadback,
            PaperAdapterCapability::AccountReadback,
            PaperAdapterCapability::EnforceableReduceOnly,
        ]
    }

    fn draft() -> PaperAdapterBindingDraft {
        let mode = PaperMode::Paper;
        let execution_scope_identity = "paper-scope-alpha".to_string();
        PaperAdapterBindingDraft {
            schema_version: 1,
            binding_version: 1,
            generation: 1,
            mode,
            account_namespace: derive_paper_account_namespace(mode, &execution_scope_identity)
                .unwrap(),
            effect_namespace: derive_paper_effect_namespace(mode, &execution_scope_identity)
                .unwrap(),
            execution_scope_identity,
            source_account_identity: "strategy-account-alpha".to_string(),
            simulator_account_identity: "sim-account-alpha".to_string(),
            simulator_endpoint_identity: "simulator:endpoint:alpha".to_string(),
            implementation_digest: "11".repeat(32),
            configuration_digest: "22".repeat(32),
            required_capabilities: capabilities(),
            reduce_only_policy: ReduceOnlyPolicy::SimulatorRejectIncreaseOrCrossZero,
            credential_handle_identity: CredentialHandleIdentity::parse(
                "credential-handle-paper-alpha",
            )
            .unwrap(),
            trust_policy_identity: "execution-paper-trust-v1".to_string(),
            state: AdapterBindingState::Admitted,
            effective_at_epoch_ms: 1_000,
            observed_at_epoch_ms: 1_100,
            exclusive_valid_through_epoch_ms: 2_000,
            clock_epoch: 7,
        }
    }

    fn retarget_scope(draft: &mut PaperAdapterBindingDraft, execution_scope_identity: &str) {
        draft.execution_scope_identity = execution_scope_identity.to_string();
        draft.account_namespace =
            derive_paper_account_namespace(draft.mode, execution_scope_identity).unwrap();
        draft.effect_namespace =
            derive_paper_effect_namespace(draft.mode, execution_scope_identity).unwrap();
    }

    fn store() -> PaperAdapterBindingStore {
        store_for_node("execution-node-alpha")
    }

    fn store_for_node(node_identity: &str) -> PaperAdapterBindingStore {
        PaperAdapterBindingStore::new(node_identity, 1_200, 7).unwrap()
    }

    fn derived(draft: PaperAdapterBindingDraft) -> (String, String) {
        let meaning = normalize_draft(draft).unwrap();
        derived_meaning(&meaning)
    }

    fn derived_meaning(meaning: &BindingMeaning) -> (String, String) {
        let bytes = canonical_semantic_bytes(meaning);
        (
            derive_digest(FACT_ID_DOMAIN, &bytes),
            derive_digest(CONTENT_DIGEST_DOMAIN, &bytes),
        )
    }

    fn assert_complete_readback(admitted: &AdmittedPaperAdapterBinding, expected: &BindingMeaning) {
        assert_eq!(admitted.schema_version(), expected.schema_version);
        assert_eq!(admitted.binding_version(), expected.binding_version);
        assert_eq!(admitted.generation(), expected.generation);
        assert_eq!(admitted.mode(), expected.mode);
        assert_eq!(
            admitted.execution_scope_identity(),
            expected.execution_scope_identity
        );
        assert_eq!(admitted.account_namespace(), expected.account_namespace);
        assert_eq!(admitted.effect_namespace(), expected.effect_namespace);
        assert_eq!(
            admitted.source_account_identity(),
            expected.source_account_identity
        );
        assert_eq!(
            admitted.simulator_account_identity(),
            expected.simulator_account_identity
        );
        assert_eq!(
            admitted.simulator_endpoint_identity(),
            expected.simulator_endpoint_identity
        );
        assert_eq!(
            admitted.implementation_digest(),
            expected.implementation_digest
        );
        assert_eq!(
            admitted.configuration_digest(),
            expected.configuration_digest
        );
        assert_eq!(admitted.capabilities(), expected.required_capabilities);
        assert_eq!(admitted.reduce_only_policy(), expected.reduce_only_policy);
        assert_eq!(
            admitted.credential_handle_identity(),
            &expected.credential_handle_identity
        );
        assert_eq!(
            admitted.trust_policy_identity(),
            expected.trust_policy_identity
        );
        assert_eq!(admitted.state(), expected.state);
        assert_eq!(
            admitted.effective_at_epoch_ms(),
            expected.effective_at_epoch_ms
        );
        assert_eq!(
            admitted.observed_at_epoch_ms(),
            expected.observed_at_epoch_ms
        );
        assert_eq!(
            admitted.exclusive_valid_through_epoch_ms(),
            expected.exclusive_valid_through_epoch_ms
        );
        assert_eq!(admitted.clock_epoch(), expected.clock_epoch);
    }

    #[rstest]
    fn canonical_golden_vector_is_stable_and_domains_are_distinct() {
        let receipt = store().commit(draft()).unwrap();
        assert_eq!(
            receipt.locator.fact_identity,
            "sha256:88905967ada46b762256e843f750af4a73e11cc8c1d2e6ce9252b2966bfdedd3"
        );
        assert_eq!(
            receipt.locator.content_digest,
            "sha256:5c1229a5035746b18fa5b1ca208df2b6c439ef531eac238d003089018353ed4a"
        );
        assert_ne!(
            receipt.locator.fact_identity,
            receipt.locator.content_digest
        );
    }

    #[rstest]
    fn capability_set_order_is_canonical() {
        let baseline = derived(draft());
        let mut reordered = draft();
        reordered.required_capabilities.reverse();
        assert_eq!(derived(reordered), baseline);
    }

    #[rstest]
    fn semantic_identity_is_stable_across_owner_nodes_and_frontiers() {
        let first = store_for_node("execution-node-alpha")
            .commit(draft())
            .unwrap()
            .locator;
        let restarted = store_for_node("execution-node-beta")
            .commit(draft())
            .unwrap()
            .locator;

        assert_eq!(first.fact_identity, restarted.fact_identity);
        assert_eq!(first.content_digest, restarted.content_digest);
        assert_ne!(first.owner_node_identity, restarted.owner_node_identity);
        assert_ne!(first.frontier, restarted.frontier);
    }

    #[rstest]
    fn every_semantic_field_changes_both_domains() {
        let baseline_meaning = normalize_draft(draft()).unwrap();
        let baseline = derived_meaning(&baseline_meaning);
        let mut variants = Vec::new();

        macro_rules! changed {
            ($field:ident, $value:expr) => {{
                let mut candidate = baseline_meaning.clone();
                candidate.$field = $value;
                variants.push(candidate);
            }};
        }

        changed!(binding_version, 2);
        changed!(generation, 2);
        changed!(execution_scope_identity, "paper-scope-beta".to_string());
        changed!(account_namespace, "paper.accounts.v1.changed".to_string());
        changed!(effect_namespace, "paper.effects.v1.changed".to_string());
        changed!(source_account_identity, "strategy-account-beta".to_string());
        changed!(simulator_account_identity, "sim-account-beta".to_string());
        changed!(
            simulator_endpoint_identity,
            "simulator:endpoint:beta".to_string()
        );
        changed!(implementation_digest, "33".repeat(32));
        changed!(configuration_digest, "44".repeat(32));
        let mut with_extra_capability = baseline_meaning.clone();
        with_extra_capability
            .required_capabilities
            .push(PaperAdapterCapability::BatchCancel);
        variants.push(with_extra_capability);
        changed!(
            credential_handle_identity,
            CredentialHandleIdentity::parse("credential-handle-paper-beta").unwrap()
        );
        changed!(
            trust_policy_identity,
            "execution-paper-trust-v2".to_string()
        );
        changed!(state, AdapterBindingState::Revoked);
        changed!(effective_at_epoch_ms, 1_001);
        changed!(observed_at_epoch_ms, 1_101);
        changed!(exclusive_valid_through_epoch_ms, 2_001);
        changed!(clock_epoch, 8);

        for variant in variants {
            let actual = derived_meaning(&variant);
            assert_ne!(actual.0, baseline.0);
            assert_ne!(actual.1, baseline.1);
        }
    }

    #[rstest]
    fn malformed_inputs_leave_zero_fact_and_outbox_records() {
        let cases: Vec<PaperAdapterBindingDraft> = {
            let mut invalid_id = draft();
            invalid_id.execution_scope_identity = "bad id".to_string();
            let mut implementation_digest = draft();
            implementation_digest.implementation_digest = "ab".repeat(31);
            let mut configuration_digest = draft();
            configuration_digest.configuration_digest = "AB".repeat(32);
            let mut wrong_account_mode = draft();
            wrong_account_mode.account_namespace = "production.accounts.alpha".to_string();
            let mut wrong_effect_mode = draft();
            wrong_effect_mode.effect_namespace = "production.effects.alpha".to_string();
            let mut generation = draft();
            generation.generation = 0;
            let mut missing_capability = draft();
            missing_capability.required_capabilities.pop();
            let mut duplicate_capability = draft();
            duplicate_capability
                .required_capabilities
                .push(PaperAdapterCapability::SubmitOrder);
            let mut invalid_time = draft();
            invalid_time.observed_at_epoch_ms = invalid_time.exclusive_valid_through_epoch_ms;
            vec![
                invalid_id,
                implementation_digest,
                configuration_digest,
                wrong_account_mode,
                wrong_effect_mode,
                generation,
                missing_capability,
                duplicate_capability,
                invalid_time,
            ]
        };

        for invalid in cases {
            let owner = store();
            assert!(owner.commit(invalid).is_err());
            assert_eq!(owner.record_counts().unwrap(), (0, 0));
        }
    }

    #[rstest]
    fn wrong_or_equal_namespace_text_fails_before_any_write() {
        let owner = store();
        let mut wrong = draft();
        wrong.account_namespace = "paper.accounts.v1.manual".to_string();

        assert_eq!(
            owner.commit(wrong),
            Err(AdapterBindingError::InvalidField("account_namespace"))
        );
        assert_eq!(owner.record_counts().unwrap(), (0, 0));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 0);

        let mut equal = draft();
        equal.effect_namespace = equal.account_namespace.clone();
        assert_eq!(
            owner.commit(equal),
            Err(AdapterBindingError::InvalidField("effect_namespace"))
        );
        assert_eq!(owner.record_counts().unwrap(), (0, 0));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 0);
    }

    #[rstest]
    fn same_scope_derives_the_same_domain_separated_pair_after_restart() {
        let scope = "paper-scope-alpha";
        let account = derive_paper_account_namespace(PaperMode::Paper, scope).unwrap();
        let effect = derive_paper_effect_namespace(PaperMode::Paper, scope).unwrap();
        assert_eq!(
            account,
            "paper.accounts.v1.07ba6ab27ec9dd07939a2220c379247091a13a3618af8c67178563b5609ec583"
        );
        assert_eq!(
            effect,
            "paper.effects.v1.32e0cd1e611a390cbadc9d4ca20fcdb7ce4c128418f33a0da06dbe330d20bae0"
        );
        assert!(account.starts_with(PAPER_ACCOUNT_NAMESPACE_PREFIX));
        assert!(effect.starts_with(PAPER_EFFECT_NAMESPACE_PREFIX));
        assert_eq!(account.len(), PAPER_ACCOUNT_NAMESPACE_PREFIX.len() + 64);
        assert_eq!(effect.len(), PAPER_EFFECT_NAMESPACE_PREFIX.len() + 64);
        assert_ne!(account, effect);

        let first = store_for_node("execution-node-alpha")
            .commit(draft())
            .unwrap();
        let restarted = store_for_node("execution-node-beta")
            .commit(draft())
            .unwrap();
        assert_eq!(first.locator.fact_identity, restarted.locator.fact_identity);
        assert_eq!(draft().account_namespace, account);
        assert_eq!(draft().effect_namespace, effect);
    }

    #[rstest]
    fn reconstructed_stores_reject_cross_scope_and_cross_class_namespace_reuse() {
        let original = draft();
        store_for_node("execution-node-alpha")
            .commit(original.clone())
            .unwrap();
        let mut beta = draft();
        retarget_scope(&mut beta, "paper-scope-beta");
        assert_ne!(beta.account_namespace, original.account_namespace);
        assert_ne!(beta.effect_namespace, original.effect_namespace);

        let cases = [
            (
                original.account_namespace.clone(),
                beta.effect_namespace.clone(),
            ),
            (
                beta.account_namespace.clone(),
                original.effect_namespace.clone(),
            ),
            (
                original.effect_namespace.clone(),
                beta.effect_namespace.clone(),
            ),
            (beta.account_namespace.clone(), original.account_namespace),
        ];

        for (account_namespace, effect_namespace) in cases {
            let owner = store_for_node("execution-node-reconstructed");
            let mut forged = beta.clone();
            forged.account_namespace = account_namespace;
            forged.effect_namespace = effect_namespace;
            assert!(matches!(
                owner.commit(forged),
                Err(AdapterBindingError::InvalidField(
                    "account_namespace" | "effect_namespace"
                ))
            ));
            assert_eq!(owner.record_counts().unwrap(), (0, 0));
            assert_eq!(owner.namespace_reservation_count().unwrap(), 0);
        }
    }

    #[rstest]
    fn local_reservation_index_remains_fail_closed_defense_in_depth() {
        let owner = store();
        let proposal = draft();
        owner.state.lock().unwrap().namespace_reservations.insert(
            proposal.account_namespace.clone(),
            NamespaceReservation {
                mode: PaperMode::Paper,
                namespace_class: NamespaceClass::Account,
                execution_scope_identity: "paper-scope-other".to_string(),
            },
        );

        assert_eq!(
            owner.commit(proposal),
            Err(AdapterBindingError::NamespaceAlreadyReserved)
        );
        assert_eq!(owner.record_counts().unwrap(), (0, 0));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 1);
    }

    #[rstest]
    fn concurrent_namespace_collision_has_exactly_one_atomic_winner() {
        let owner = Arc::new(store());
        let barrier = Arc::new(Barrier::new(2));
        let mut competing = draft();
        retarget_scope(&mut competing, "paper-scope-beta");
        competing.account_namespace = draft().account_namespace;

        let workers = [draft(), competing].map(|proposal| {
            let owner = Arc::clone(&owner);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                owner.commit(proposal)
            })
        });
        let results = workers.map(|worker| worker.join().unwrap());

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| {
                    matches!(
                        result,
                        Err(AdapterBindingError::InvalidField("account_namespace"))
                    )
                })
                .count(),
            1
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 2);
    }

    #[rstest]
    fn insert_and_exact_replay_remain_one_fact_and_one_outbox() {
        let owner = store();
        let inserted = owner.commit(draft()).unwrap();
        let replayed = owner.commit(draft()).unwrap();
        assert_eq!(
            inserted.disposition,
            AdapterBindingCommitDisposition::Inserted
        );
        assert_eq!(
            replayed.disposition,
            AdapterBindingCommitDisposition::ExactReplay
        );
        assert_eq!(inserted.locator, replayed.locator);
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 2);
    }

    #[rstest]
    fn lawful_same_scope_successor_reuses_namespace_reservations() {
        let owner = store();
        owner.commit(draft()).unwrap();
        owner.advance_trusted_clock(1_300, 8).unwrap();
        let mut successor = draft();
        successor.generation = 2;
        successor.observed_at_epoch_ms = 1_300;
        successor.exclusive_valid_through_epoch_ms = 2_100;
        successor.clock_epoch = 8;

        assert_eq!(
            owner.commit(successor).unwrap().disposition,
            AdapterBindingCommitDisposition::Inserted
        );
        assert_eq!(owner.record_counts().unwrap(), (2, 2));
        assert_eq!(owner.namespace_reservation_count().unwrap(), 2);
    }

    #[rstest]
    #[allow(
        clippy::needless_collect,
        reason = "eager collection starts every replay worker before any join"
    )]
    fn concurrent_exact_replay_remains_one_fact_and_one_outbox() {
        let owner = Arc::new(store());
        let workers = (0..24)
            .map(|_| {
                let owner = Arc::clone(&owner);
                thread::spawn(move || owner.commit(draft()).unwrap())
            })
            .collect::<Vec<_>>();
        let receipts = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        assert!(
            receipts
                .windows(2)
                .all(|pair| pair[0].locator == pair[1].locator)
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
    }

    #[rstest]
    fn changed_meaning_conflicts_without_successor_write() {
        let owner = store();
        let original = owner.commit(draft()).unwrap();
        let mut conflict = draft();
        conflict.configuration_digest = "55".repeat(32);
        assert_eq!(
            owner.commit(conflict),
            Err(AdapterBindingError::ConflictingReplay)
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
        let resolved = owner
            .resolve_admitted(
                &original.locator,
                &[
                    PaperAdapterCapability::SubmitOrder,
                    PaperAdapterCapability::EnforceableReduceOnly,
                ],
            )
            .unwrap();
        assert_eq!(resolved.locator(), &original.locator);
    }

    #[rstest]
    fn admitted_readback_preserves_complete_immutable_binding_meaning() {
        let proposal = draft();
        let expected = normalize_draft(proposal.clone()).unwrap();
        let owner = store();
        let receipt = owner.commit(proposal).unwrap();
        let admitted = owner
            .resolve_admitted(&receipt.locator, &capabilities())
            .unwrap();

        assert_complete_readback(&admitted, &expected);
    }

    #[rstest]
    fn material_mapping_mutations_fail_closed_and_preserve_original_readback() {
        let original = draft();
        let expected = normalize_draft(original.clone()).unwrap();
        let mut mutations = Vec::new();

        macro_rules! changed {
            ($field:ident, $value:expr, $error:expr) => {{
                let mut candidate = original.clone();
                candidate.$field = $value;
                mutations.push((candidate, $error));
            }};
        }

        changed!(
            account_namespace,
            "paper.accounts.v1.manual".to_string(),
            AdapterBindingError::InvalidField("account_namespace")
        );
        changed!(
            effect_namespace,
            "paper.effects.v1.manual".to_string(),
            AdapterBindingError::InvalidField("effect_namespace")
        );
        changed!(
            source_account_identity,
            "strategy-account-beta".to_string(),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            simulator_account_identity,
            "sim-account-beta".to_string(),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            simulator_endpoint_identity,
            "simulator:endpoint:beta".to_string(),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            implementation_digest,
            "33".repeat(32),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            configuration_digest,
            "44".repeat(32),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            trust_policy_identity,
            "execution-paper-trust-v2".to_string(),
            AdapterBindingError::ConflictingReplay
        );
        changed!(
            exclusive_valid_through_epoch_ms,
            2_001,
            AdapterBindingError::ConflictingReplay
        );

        for (mutation, expected_error) in mutations {
            let owner = store();
            let receipt = owner.commit(original.clone()).unwrap();
            assert_eq!(owner.commit(mutation), Err(expected_error));
            assert_eq!(owner.record_counts().unwrap(), (1, 1));
            let admitted = owner
                .resolve_admitted(&receipt.locator, &capabilities())
                .unwrap();
            assert_complete_readback(&admitted, &expected);
        }

        let owner = store();
        let receipt = owner.commit(original).unwrap();
        let mut missing_reduce_only_enforcement = draft();
        missing_reduce_only_enforcement
            .required_capabilities
            .retain(|capability| *capability != PaperAdapterCapability::EnforceableReduceOnly);
        assert_eq!(
            owner.commit(missing_reduce_only_enforcement),
            Err(AdapterBindingError::InvalidCapabilities)
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
        let admitted = owner
            .resolve_admitted(&receipt.locator, &capabilities())
            .unwrap();
        assert_complete_readback(&admitted, &expected);
    }

    #[rstest]
    fn generation_gaps_leave_existing_atomic_pair_unchanged() {
        let owner = store();
        owner.commit(draft()).unwrap();
        let mut gap = draft();
        gap.generation = 3;
        assert_eq!(
            owner.commit(gap),
            Err(AdapterBindingError::InvalidGeneration {
                expected: 2,
                actual: 3
            })
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));
    }

    #[rstest]
    fn native_zero_sequence_fails_before_atomic_pair() {
        let owner = store();
        owner.state.lock().unwrap().next_sequence = 0;

        assert_eq!(
            owner.commit(draft()),
            Err(AdapterBindingError::StoreUnavailable)
        );
        assert_eq!(owner.record_counts().unwrap(), (0, 0));
    }

    #[rstest]
    fn forged_locator_mutation_matrix_never_resolves_positive() {
        let owner = store();
        let locator = owner.commit(draft()).unwrap().locator;
        let mut forgeries = Vec::new();

        macro_rules! forged {
            ($field:ident, $value:expr) => {{
                let mut candidate = locator.clone();
                candidate.$field = $value;
                forgeries.push(candidate);
            }};
        }

        forged!(owner_identity, "OTHER".to_string());
        forged!(owner_node_identity, "execution-node-beta".to_string());
        forged!(fact_kind, "other-kind".to_string());
        forged!(execution_scope_identity, "paper-scope-beta".to_string());
        forged!(generation, 2);
        forged!(state, AdapterBindingState::Revoked);
        forged!(fact_identity, format!("{}0", locator.fact_identity));
        forged!(content_digest, format!("{}0", locator.content_digest));
        let mut stream = locator.clone();
        stream.frontier.stream_identity.push_str(".forged");
        forgeries.push(stream);
        let mut cut = locator.clone();
        cut.frontier.cut_identity.push_str(":forged");
        forgeries.push(cut);
        let mut sequence = locator.clone();
        sequence.frontier.sequence += 1;
        forgeries.push(sequence);
        forged!(effective_at_epoch_ms, locator.effective_at_epoch_ms + 1);
        forged!(observed_at_epoch_ms, locator.observed_at_epoch_ms + 1);
        forged!(
            exclusive_valid_through_epoch_ms,
            locator.exclusive_valid_through_epoch_ms + 1
        );
        forged!(clock_epoch, locator.clock_epoch + 1);

        for forged in forgeries {
            assert!(owner.resolve_admitted(&forged, &capabilities()).is_err());
        }
    }

    #[rstest]
    fn resolution_requires_capabilities_and_half_open_time() {
        let owner = store();
        let locator = owner.commit(draft()).unwrap().locator;
        assert!(owner.resolve_admitted(&locator, &capabilities()).is_ok());
        owner.advance_trusted_clock(2_000, 7).unwrap();
        assert_eq!(
            owner.resolve_admitted(&locator, &capabilities()),
            Err(AdapterBindingError::TimeMismatch)
        );
        let capability_owner = store();
        let capability_locator = capability_owner.commit(draft()).unwrap().locator;
        assert_eq!(
            capability_owner
                .resolve_admitted(&capability_locator, &[PaperAdapterCapability::BatchCancel]),
            Err(AdapterBindingError::CapabilityMismatch)
        );

        let epoch_owner = store();
        let epoch_locator = epoch_owner.commit(draft()).unwrap().locator;
        epoch_owner.advance_trusted_clock(1_200, 8).unwrap();
        assert_eq!(
            epoch_owner.resolve_admitted(&epoch_locator, &capabilities()),
            Err(AdapterBindingError::TimeMismatch)
        );
    }

    #[rstest]
    fn trusted_clock_and_successor_time_are_monotonic() {
        let owner = store();
        owner.commit(draft()).unwrap();
        assert_eq!(
            owner.advance_trusted_clock(1_199, 7),
            Err(AdapterBindingError::InvalidTimeEvidence)
        );
        assert_eq!(
            owner.advance_trusted_clock(1_200, 6),
            Err(AdapterBindingError::InvalidTimeEvidence)
        );

        let mut regressed_observation = draft();
        regressed_observation.generation = 2;
        assert_eq!(
            owner.commit(regressed_observation),
            Err(AdapterBindingError::NonMonotonicSuccessorTime)
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));

        let mut regressed_interval = draft();
        regressed_interval.generation = 2;
        regressed_interval.observed_at_epoch_ms = 1_200;
        regressed_interval.exclusive_valid_through_epoch_ms = 1_999;
        assert_eq!(
            owner.commit(regressed_interval),
            Err(AdapterBindingError::NonMonotonicSuccessorTime)
        );
        assert_eq!(owner.record_counts().unwrap(), (1, 1));

        owner.advance_trusted_clock(1_300, 8).unwrap();
        let mut successor = draft();
        successor.generation = 2;
        successor.observed_at_epoch_ms = 1_300;
        successor.exclusive_valid_through_epoch_ms = 2_100;
        successor.clock_epoch = 8;
        assert_eq!(
            owner.commit(successor).unwrap().disposition,
            AdapterBindingCommitDisposition::Inserted
        );
        assert_eq!(owner.record_counts().unwrap(), (2, 2));
    }

    #[rstest]
    fn every_non_admitted_state_is_negative() {
        for state in [
            AdapterBindingState::Superseded,
            AdapterBindingState::Revoked,
            AdapterBindingState::Incompatible,
        ] {
            let owner = store();
            let mut candidate = draft();
            candidate.state = state;
            let locator = owner.commit(candidate).unwrap().locator;
            assert_eq!(
                owner.resolve_admitted(&locator, &capabilities()),
                Err(AdapterBindingError::NotAdmitted)
            );
        }
    }

    #[rstest]
    fn successor_makes_prior_admitted_locator_non_current() {
        let owner = store();
        let prior = owner.commit(draft()).unwrap().locator;
        let mut successor = draft();
        successor.generation = 2;
        successor.state = AdapterBindingState::Revoked;
        successor.observed_at_epoch_ms = 1_200;
        owner.commit(successor).unwrap();
        assert_eq!(
            owner.resolve_admitted(&prior, &capabilities()),
            Err(AdapterBindingError::NotCurrentHead)
        );
        assert_eq!(owner.record_counts().unwrap(), (2, 2));
    }

    #[rstest]
    fn opaque_credential_handle_debug_is_redacted() {
        let handle = CredentialHandleIdentity::parse("credential-handle-paper-secret").unwrap();
        let debug = format!("{handle:?}");
        assert_eq!(debug, "CredentialHandleIdentity([REDACTED])");
        assert!(!debug.contains("secret"));
        let draft_debug = format!("{:?}", draft());
        assert!(!draft_debug.contains("credential-handle-paper-alpha"));
    }
}
