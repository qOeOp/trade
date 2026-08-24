//! Execution-owned PAPER recovery-frontier read contract.
//!
//! This module exposes only a static, fail-closed query seam for the future Runtime
//! application boundary. Production custody and Runtime application remain absent.
//! The only positive value is sealed and can be minted only by an Execution-owned
//! implementation of [`RecoveryFrontierReadPort`].
//!
//! A caller cannot construct a positive readback:
//!
//! ```compile_fail
//! use vibe_execution::recovery_frontier::SealedRecoveryFrontier;
//!
//! let _forged = SealedRecoveryFrontier {};
//! ```
//!
//! Caller-controlled JSON cannot deserialize a positive readback:
//!
//! ```compile_fail
//! use serde::de::DeserializeOwned;
//! use vibe_execution::recovery_frontier::SealedRecoveryFrontier;
//!
//! fn requires_deserialize<T: DeserializeOwned>() {}
//! requires_deserialize::<SealedRecoveryFrontier>();
//! ```
//!
//! A downstream crate cannot implement the Owner port:
//!
//! ```compile_fail
//! use vibe_execution::recovery_frontier::{
//!     RecoveryFrontierError, RecoveryFrontierLocator, RecoveryFrontierReadPort,
//!     SealedRecoveryFrontier,
//! };
//!
//! struct CallerForwardingPort(Option<SealedRecoveryFrontier>);
//! impl RecoveryFrontierReadPort for CallerForwardingPort {
//!     fn resolve_current(
//!         &self,
//!         _locator: &RecoveryFrontierLocator,
//!     ) -> Result<SealedRecoveryFrontier, RecoveryFrontierError> {
//!         todo!()
//!     }
//! }
//! ```
//!
//! The capability is query-only; command, retry, and effect methods do not exist:
//!
//! ```compile_fail
//! use vibe_execution::recovery_frontier::RecoveryFrontierReadPort;
//!
//! fn cannot_command(port: &dyn RecoveryFrontierReadPort) {
//!     port.command_recovery();
//! }
//! ```

use std::{
    error::Error,
    fmt::{Debug, Display},
};

#[cfg(test)]
use sha2::{Digest, Sha256};

use crate::adapter_binding::PaperMode;
#[cfg(test)]
use crate::adapter_binding::{derive_paper_account_namespace, derive_paper_effect_namespace};

#[cfg(test)]
use std::{collections::BTreeMap, sync::Mutex};

/// Canonical fact kind for an Execution PAPER recovery frontier.
pub const PAPER_RECOVERY_FRONTIER_KIND: &str = "execution-paper-recovery-frontier-v1";
/// Schema version of the static recovery-frontier contract.
pub const PAPER_RECOVERY_FRONTIER_SCHEMA_VERSION: u32 = 1;
/// Honest maturity of this module.
pub const PAPER_RECOVERY_FRONTIER_MATURITY: &str =
    "STATIC_EXECUTION_RECOVERY_FRONTIER_PORT_READY_FOR_RUNTIME_NOT_APPLIED";

#[cfg(test)]
const EXECUTION_OWNER: &str = "EXECUTION";
#[cfg(test)]
const FACT_ID_DOMAIN: &[u8] = b"vibe.execution.paper-recovery-frontier.fact-id.v1\0";
#[cfg(test)]
const CONTENT_DIGEST_DOMAIN: &[u8] = b"vibe.execution.paper-recovery-frontier.content-digest.v1\0";

/// Availability asserted by an untrusted recovery-frontier locator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryFrontierAvailability {
    /// The complete frontier is available for an exact Owner reread.
    Available,
    /// Custody or required evidence is unavailable.
    Unavailable,
}

/// Recovery disposition asserted by an untrusted recovery-frontier locator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryFrontierDisposition {
    /// The complete current cut proves that no Recovery Case is required.
    NoRecoveryRequired,
    /// Recovery exists but is not completely and canonically closed.
    RecoveryInProgress,
    /// Execution committed the exact Recovery Case as `KNOWN_CLOSED`.
    KnownClosed,
}

/// Execution-native custody frontier.
#[derive(Clone, PartialEq, Eq)]
pub struct NativeRecoveryFrontier {
    /// Owner-native stream identity.
    pub stream_identity: String,
    /// Exact committed cut identity.
    pub cut_identity: String,
    /// Nonzero stream sequence.
    pub sequence: u64,
}

impl Debug for NativeRecoveryFrontier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("NativeRecoveryFrontier([REDACTED])")
    }
}

/// Untrusted exact claim used to query Execution's current sealed state.
///
/// Every field is caller-authored until the injected Owner port resolves the whole value against
/// canonical custody. Constructing this value confers no recovery or application authority.
#[derive(Clone, PartialEq, Eq)]
pub struct RecoveryFrontierLocator {
    /// Canonical Owner identity.
    pub owner_identity: String,
    /// Exact Execution custody node identity.
    pub owner_node_identity: String,
    /// Canonical fact kind.
    pub fact_kind: String,
    /// Typed PAPER mode.
    pub mode: PaperMode,
    /// Exact Execution Scope identity.
    pub execution_scope_identity: String,
    /// Canonical PAPER account namespace.
    pub account_namespace: String,
    /// Canonical PAPER effect namespace.
    pub effect_namespace: String,
    /// Monotonic recovery generation within the Execution Scope.
    pub recovery_generation: u64,
    /// Canonical fact identity.
    pub fact_identity: String,
    /// Canonical content digest.
    pub content_digest: String,
    /// Exact native custody frontier.
    pub frontier: NativeRecoveryFrontier,
    /// Claimed evidence availability.
    pub availability: RecoveryFrontierAvailability,
    /// Claimed recovery disposition.
    pub disposition: RecoveryFrontierDisposition,
    /// Inclusive start of this frontier's validity.
    pub effective_at_epoch_ms: u64,
    /// Owner observation time.
    pub observed_at_epoch_ms: u64,
    /// Exclusive freshness bound.
    pub exclusive_valid_through_epoch_ms: u64,
    /// Time-evidence clock epoch.
    pub clock_epoch: u64,
}

impl Debug for RecoveryFrontierLocator {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RecoveryFrontierLocator([REDACTED])")
    }
}

/// Fail-closed read errors. Variants intentionally carry no protected identities or evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryFrontierError {
    /// A locator field is malformed before native lookup.
    MalformedClaim,
    /// No canonical native fact matches the claimed identity.
    FactNotFound,
    /// Caller-authored bytes differ from the native record.
    ClaimMismatch,
    /// The claimed fact is no longer the current scope head.
    RollbackDetected,
    /// Complete canonical custody is unavailable.
    Unavailable,
    /// Recovery is incomplete and cannot authorize Runtime application.
    PartialRecovery,
    /// Time evidence is stale, unordered, or from another clock epoch.
    Stale,
    /// Owner custody could not be read.
    StoreUnavailable,
}

impl Display for RecoveryFrontierError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MalformedClaim => formatter.write_str("malformed recovery-frontier claim"),
            Self::FactNotFound => formatter.write_str("recovery frontier not found"),
            Self::ClaimMismatch => formatter.write_str("recovery-frontier claim mismatch"),
            Self::RollbackDetected => formatter.write_str("recovery-frontier rollback detected"),
            Self::Unavailable => formatter.write_str("recovery frontier unavailable"),
            Self::PartialRecovery => formatter.write_str("recovery is incomplete"),
            Self::Stale => formatter.write_str("recovery-frontier time evidence is stale"),
            Self::StoreUnavailable => formatter.write_str("Execution recovery custody unavailable"),
        }
    }
}

impl Error for RecoveryFrontierError {}

mod sealed {
    pub trait ExecutionOwned {}
}

/// Query-only boundary implemented inside the Execution crate by its legal composition owner.
///
/// The private supertrait prevents downstream implementations from replaying a previously issued
/// [`SealedRecoveryFrontier`] while ignoring a new locator. The positive value also has no public or
/// feature-gated constructor.
pub trait RecoveryFrontierReadPort: sealed::ExecutionOwned + Send + Sync {
    /// Resolves one exact claim from Execution's current sealed state.
    ///
    /// # Errors
    ///
    /// Returns [`RecoveryFrontierError`] for every missing, malformed, mismatched, stale,
    /// unavailable, rolled-back, or partially recovered representation.
    fn resolve_current(
        &self,
        locator: &RecoveryFrontierLocator,
    ) -> Result<SealedRecoveryFrontier, RecoveryFrontierError>;
}

#[derive(Clone, PartialEq, Eq)]
struct RecoveryMeaning {
    schema_version: u32,
    mode: PaperMode,
    execution_scope_identity: String,
    account_namespace: String,
    effect_namespace: String,
    recovery_generation: u64,
    availability: RecoveryFrontierAvailability,
    disposition: RecoveryFrontierDisposition,
    recovery_case_identity: Option<String>,
    known_closed_identity: Option<String>,
    effective_at_epoch_ms: u64,
    observed_at_epoch_ms: u64,
    exclusive_valid_through_epoch_ms: u64,
    clock_epoch: u64,
}

/// Sealed positive readback from Execution's current canonical custody.
///
/// This value has private fields, no public constructor, and no `Deserialize` implementation.
/// Its presence proves only a static Owner-port resolution; it performs no Runtime application,
/// recovery transition, retry, or external effect.
#[derive(PartialEq, Eq)]
pub struct SealedRecoveryFrontier {
    locator: RecoveryFrontierLocator,
    meaning: RecoveryMeaning,
}

impl Debug for SealedRecoveryFrontier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SealedRecoveryFrontier([REDACTED])")
    }
}

impl SealedRecoveryFrontier {
    /// Returns the exact canonical locator resolved by Execution.
    #[must_use]
    pub fn locator(&self) -> &RecoveryFrontierLocator {
        &self.locator
    }

    /// Returns the schema version.
    #[must_use]
    pub fn schema_version(&self) -> u32 {
        self.meaning.schema_version
    }

    /// Returns the typed PAPER mode.
    #[must_use]
    pub fn mode(&self) -> PaperMode {
        self.meaning.mode
    }

    /// Returns the exact Execution Scope identity.
    #[must_use]
    pub fn execution_scope_identity(&self) -> &str {
        &self.meaning.execution_scope_identity
    }

    /// Returns the canonical PAPER account namespace.
    #[must_use]
    pub fn account_namespace(&self) -> &str {
        &self.meaning.account_namespace
    }

    /// Returns the canonical PAPER effect namespace.
    #[must_use]
    pub fn effect_namespace(&self) -> &str {
        &self.meaning.effect_namespace
    }

    /// Returns the monotonic recovery generation.
    #[must_use]
    pub fn recovery_generation(&self) -> u64 {
        self.meaning.recovery_generation
    }

    /// Returns the exact availability proven by the Owner reread.
    #[must_use]
    pub fn availability(&self) -> RecoveryFrontierAvailability {
        self.meaning.availability
    }

    /// Returns the complete recovery disposition.
    #[must_use]
    pub fn disposition(&self) -> RecoveryFrontierDisposition {
        self.meaning.disposition
    }

    /// Returns the Recovery Case identity for a `KNOWN_CLOSED` disposition.
    #[must_use]
    pub fn recovery_case_identity(&self) -> Option<&str> {
        self.meaning.recovery_case_identity.as_deref()
    }

    /// Returns the immutable `KNOWN_CLOSED` fact identity when applicable.
    #[must_use]
    pub fn known_closed_identity(&self) -> Option<&str> {
        self.meaning.known_closed_identity.as_deref()
    }

    /// Returns the inclusive effective time.
    #[must_use]
    pub fn effective_at_epoch_ms(&self) -> u64 {
        self.meaning.effective_at_epoch_ms
    }

    /// Returns the Owner observation time.
    #[must_use]
    pub fn observed_at_epoch_ms(&self) -> u64 {
        self.meaning.observed_at_epoch_ms
    }

    /// Returns the exclusive freshness bound.
    #[must_use]
    pub fn exclusive_valid_through_epoch_ms(&self) -> u64 {
        self.meaning.exclusive_valid_through_epoch_ms
    }

    /// Returns the time-evidence clock epoch.
    #[must_use]
    pub fn clock_epoch(&self) -> u64 {
        self.meaning.clock_epoch
    }
}

#[cfg(test)]
fn validate_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'_' | b'-'))
}

#[cfg(test)]
fn validate_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
fn validate_locator(locator: &RecoveryFrontierLocator) -> bool {
    locator.owner_identity == EXECUTION_OWNER
        && validate_identifier(&locator.owner_node_identity)
        && locator.fact_kind == PAPER_RECOVERY_FRONTIER_KIND
        && locator.mode == PaperMode::Paper
        && validate_identifier(&locator.execution_scope_identity)
        && derive_paper_account_namespace(locator.mode, &locator.execution_scope_identity)
            .is_ok_and(|expected| expected == locator.account_namespace)
        && derive_paper_effect_namespace(locator.mode, &locator.execution_scope_identity)
            .is_ok_and(|expected| expected == locator.effect_namespace)
        && locator.recovery_generation > 0
        && validate_digest(&locator.fact_identity)
        && validate_digest(&locator.content_digest)
        && validate_identifier(&locator.frontier.stream_identity)
        && validate_identifier(&locator.frontier.cut_identity)
        && locator.frontier.sequence > 0
        && locator.effective_at_epoch_ms > 0
        && locator.effective_at_epoch_ms <= locator.observed_at_epoch_ms
        && locator.observed_at_epoch_ms < locator.exclusive_valid_through_epoch_ms
        && locator.clock_epoch > 0
}

#[cfg(test)]
#[derive(Clone)]
struct RecoveryFrontierDraft {
    recovery_generation: u64,
    execution_scope_identity: String,
    availability: RecoveryFrontierAvailability,
    disposition: RecoveryFrontierDisposition,
    recovery_case_identity: Option<String>,
    known_closed_identity: Option<String>,
    effective_at_epoch_ms: u64,
    observed_at_epoch_ms: u64,
    exclusive_valid_through_epoch_ms: u64,
    clock_epoch: u64,
}

#[cfg(test)]
#[derive(Clone)]
struct RecoveryFactRecord {
    locator: RecoveryFrontierLocator,
    meaning: RecoveryMeaning,
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct TrustedFixtureClock {
    now_epoch_ms: u64,
    clock_epoch: u64,
}

/// Test-only Owner fixture. Production exposes no store, writer, clock, or composition choice.
#[cfg(test)]
struct RecoveryFrontierStore {
    node_identity: String,
    stream_identity: String,
    state: Mutex<RecoveryStoreState>,
}

#[cfg(test)]
struct RecoveryStoreState {
    facts: BTreeMap<String, RecoveryFactRecord>,
    slots: BTreeMap<(String, u64), String>,
    heads: BTreeMap<String, String>,
    next_sequence: u64,
    clock: TrustedFixtureClock,
}

#[cfg(test)]
impl RecoveryFrontierStore {
    fn new(node_identity: &str, now_epoch_ms: u64, clock_epoch: u64) -> Self {
        assert!(validate_identifier(node_identity));
        Self {
            node_identity: node_identity.to_string(),
            stream_identity: format!("execution.paper-recovery-frontier.{node_identity}"),
            state: Mutex::new(RecoveryStoreState {
                facts: BTreeMap::new(),
                slots: BTreeMap::new(),
                heads: BTreeMap::new(),
                next_sequence: 1,
                clock: TrustedFixtureClock {
                    now_epoch_ms,
                    clock_epoch,
                },
            }),
        }
    }

    fn commit(
        &self,
        draft: RecoveryFrontierDraft,
    ) -> Result<RecoveryFrontierLocator, RecoveryFrontierError> {
        let meaning = normalize_draft(draft)?;
        let slot = (
            meaning.execution_scope_identity.clone(),
            meaning.recovery_generation,
        );
        let mut state = self
            .state
            .lock()
            .map_err(|_| RecoveryFrontierError::StoreUnavailable)?;

        if let Some(existing_identity) = state.slots.get(&slot) {
            let existing = state
                .facts
                .get(existing_identity)
                .ok_or(RecoveryFrontierError::StoreUnavailable)?;
            return if existing.meaning == meaning {
                Ok(existing.locator.clone())
            } else {
                Err(RecoveryFrontierError::ClaimMismatch)
            };
        }

        if meaning.clock_epoch != state.clock.clock_epoch
            || meaning.observed_at_epoch_ms > state.clock.now_epoch_ms
        {
            return Err(RecoveryFrontierError::Stale);
        }

        let prior = state
            .heads
            .get(&meaning.execution_scope_identity)
            .map(|identity| {
                state
                    .facts
                    .get(identity)
                    .ok_or(RecoveryFrontierError::StoreUnavailable)
            })
            .transpose()?;
        let expected_generation = prior.map_or(1, |record| {
            record.meaning.recovery_generation.saturating_add(1)
        });

        if meaning.recovery_generation != expected_generation {
            return Err(RecoveryFrontierError::RollbackDetected);
        }

        if let Some(prior) = prior
            && (meaning.clock_epoch < prior.meaning.clock_epoch
                || meaning.effective_at_epoch_ms < prior.meaning.effective_at_epoch_ms
                || meaning.observed_at_epoch_ms <= prior.meaning.observed_at_epoch_ms)
        {
            return Err(RecoveryFrontierError::RollbackDetected);
        }

        let sequence = state.next_sequence;
        state.next_sequence = sequence
            .checked_add(1)
            .ok_or(RecoveryFrontierError::StoreUnavailable)?;
        let frontier = NativeRecoveryFrontier {
            stream_identity: self.stream_identity.clone(),
            cut_identity: format!("{}:{sequence}", self.stream_identity),
            sequence,
        };
        let semantic = canonical_semantic_bytes(&meaning);
        let fact_identity = derive_digest(FACT_ID_DOMAIN, &semantic);
        let content_digest = derive_digest(CONTENT_DIGEST_DOMAIN, &semantic);
        let locator = RecoveryFrontierLocator {
            owner_identity: EXECUTION_OWNER.to_string(),
            owner_node_identity: self.node_identity.clone(),
            fact_kind: PAPER_RECOVERY_FRONTIER_KIND.to_string(),
            mode: meaning.mode,
            execution_scope_identity: meaning.execution_scope_identity.clone(),
            account_namespace: meaning.account_namespace.clone(),
            effect_namespace: meaning.effect_namespace.clone(),
            recovery_generation: meaning.recovery_generation,
            fact_identity: fact_identity.clone(),
            content_digest,
            frontier,
            availability: meaning.availability,
            disposition: meaning.disposition,
            effective_at_epoch_ms: meaning.effective_at_epoch_ms,
            observed_at_epoch_ms: meaning.observed_at_epoch_ms,
            exclusive_valid_through_epoch_ms: meaning.exclusive_valid_through_epoch_ms,
            clock_epoch: meaning.clock_epoch,
        };
        let record = RecoveryFactRecord {
            locator: locator.clone(),
            meaning,
        };
        state.facts.insert(fact_identity.clone(), record);
        state.slots.insert(slot, fact_identity.clone());
        state
            .heads
            .insert(locator.execution_scope_identity.clone(), fact_identity);
        Ok(locator)
    }

    fn advance_clock(&self, now_epoch_ms: u64, clock_epoch: u64) {
        let mut state = self.state.lock().expect("fixture lock");
        state.clock = TrustedFixtureClock {
            now_epoch_ms,
            clock_epoch,
        };
    }
}

#[cfg(test)]
impl sealed::ExecutionOwned for RecoveryFrontierStore {}

#[cfg(test)]
impl RecoveryFrontierReadPort for RecoveryFrontierStore {
    fn resolve_current(
        &self,
        locator: &RecoveryFrontierLocator,
    ) -> Result<SealedRecoveryFrontier, RecoveryFrontierError> {
        if !validate_locator(locator) {
            return Err(RecoveryFrontierError::MalformedClaim);
        }
        let state = self
            .state
            .lock()
            .map_err(|_| RecoveryFrontierError::StoreUnavailable)?;
        let record = state
            .facts
            .get(&locator.fact_identity)
            .ok_or(RecoveryFrontierError::FactNotFound)?;
        if &record.locator != locator {
            return Err(RecoveryFrontierError::ClaimMismatch);
        }

        if state.heads.get(&record.meaning.execution_scope_identity)
            != Some(&record.locator.fact_identity)
        {
            return Err(RecoveryFrontierError::RollbackDetected);
        }

        if record.meaning.availability != RecoveryFrontierAvailability::Available {
            return Err(RecoveryFrontierError::Unavailable);
        }

        if record.meaning.disposition == RecoveryFrontierDisposition::RecoveryInProgress {
            return Err(RecoveryFrontierError::PartialRecovery);
        }

        if state.clock.clock_epoch != record.meaning.clock_epoch
            || state.clock.now_epoch_ms < record.meaning.effective_at_epoch_ms
            || state.clock.now_epoch_ms < record.meaning.observed_at_epoch_ms
            || state.clock.now_epoch_ms >= record.meaning.exclusive_valid_through_epoch_ms
        {
            return Err(RecoveryFrontierError::Stale);
        }
        Ok(SealedRecoveryFrontier {
            locator: record.locator.clone(),
            meaning: record.meaning.clone(),
        })
    }
}

#[cfg(test)]
fn normalize_draft(draft: RecoveryFrontierDraft) -> Result<RecoveryMeaning, RecoveryFrontierError> {
    if draft.recovery_generation == 0
        || !validate_identifier(&draft.execution_scope_identity)
        || draft.effective_at_epoch_ms == 0
        || draft.effective_at_epoch_ms > draft.observed_at_epoch_ms
        || draft.observed_at_epoch_ms >= draft.exclusive_valid_through_epoch_ms
        || draft.clock_epoch == 0
    {
        return Err(RecoveryFrontierError::MalformedClaim);
    }

    match draft.disposition {
        RecoveryFrontierDisposition::NoRecoveryRequired => {
            if draft.recovery_case_identity.is_some() || draft.known_closed_identity.is_some() {
                return Err(RecoveryFrontierError::MalformedClaim);
            }
        }
        RecoveryFrontierDisposition::RecoveryInProgress => {
            if draft
                .recovery_case_identity
                .as_deref()
                .is_none_or(|value| !validate_identifier(value))
                || draft.known_closed_identity.is_some()
            {
                return Err(RecoveryFrontierError::MalformedClaim);
            }
        }
        RecoveryFrontierDisposition::KnownClosed => {
            if draft
                .recovery_case_identity
                .as_deref()
                .is_none_or(|value| !validate_identifier(value))
                || draft
                    .known_closed_identity
                    .as_deref()
                    .is_none_or(|value| !validate_identifier(value))
            {
                return Err(RecoveryFrontierError::MalformedClaim);
            }
        }
    }
    let account_namespace =
        derive_paper_account_namespace(PaperMode::Paper, &draft.execution_scope_identity)
            .map_err(|_| RecoveryFrontierError::MalformedClaim)?;
    let effect_namespace =
        derive_paper_effect_namespace(PaperMode::Paper, &draft.execution_scope_identity)
            .map_err(|_| RecoveryFrontierError::MalformedClaim)?;
    Ok(RecoveryMeaning {
        schema_version: PAPER_RECOVERY_FRONTIER_SCHEMA_VERSION,
        mode: PaperMode::Paper,
        execution_scope_identity: draft.execution_scope_identity,
        account_namespace,
        effect_namespace,
        recovery_generation: draft.recovery_generation,
        availability: draft.availability,
        disposition: draft.disposition,
        recovery_case_identity: draft.recovery_case_identity,
        known_closed_identity: draft.known_closed_identity,
        effective_at_epoch_ms: draft.effective_at_epoch_ms,
        observed_at_epoch_ms: draft.observed_at_epoch_ms,
        exclusive_valid_through_epoch_ms: draft.exclusive_valid_through_epoch_ms,
        clock_epoch: draft.clock_epoch,
    })
}

#[cfg(test)]
fn canonical_semantic_bytes(meaning: &RecoveryMeaning) -> Vec<u8> {
    let mut bytes = Vec::new();
    push_u64(&mut bytes, u64::from(meaning.schema_version));
    push_u64(&mut bytes, 1);
    push_string(&mut bytes, &meaning.execution_scope_identity);
    push_string(&mut bytes, &meaning.account_namespace);
    push_string(&mut bytes, &meaning.effect_namespace);
    push_u64(&mut bytes, meaning.recovery_generation);
    push_u64(
        &mut bytes,
        match meaning.availability {
            RecoveryFrontierAvailability::Available => 1,
            RecoveryFrontierAvailability::Unavailable => 2,
        },
    );
    push_u64(
        &mut bytes,
        match meaning.disposition {
            RecoveryFrontierDisposition::NoRecoveryRequired => 1,
            RecoveryFrontierDisposition::RecoveryInProgress => 2,
            RecoveryFrontierDisposition::KnownClosed => 3,
        },
    );
    push_optional_string(&mut bytes, meaning.recovery_case_identity.as_deref());
    push_optional_string(&mut bytes, meaning.known_closed_identity.as_deref());
    push_u64(&mut bytes, meaning.effective_at_epoch_ms);
    push_u64(&mut bytes, meaning.observed_at_epoch_ms);
    push_u64(&mut bytes, meaning.exclusive_valid_through_epoch_ms);
    push_u64(&mut bytes, meaning.clock_epoch);
    bytes
}

#[cfg(test)]
fn push_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
fn push_string(bytes: &mut Vec<u8>, value: &str) {
    push_u64(bytes, value.len() as u64);
    bytes.extend_from_slice(value.as_bytes());
}

#[cfg(test)]
fn push_optional_string(bytes: &mut Vec<u8>, value: Option<&str>) {
    match value {
        Some(value) => {
            bytes.push(1);
            push_string(bytes, value);
        }
        None => bytes.push(0),
    }
}

#[cfg(test)]
fn derive_digest(domain: &[u8], semantic: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(semantic);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn draft(disposition: RecoveryFrontierDisposition) -> RecoveryFrontierDraft {
        let (case, closed) = match disposition {
            RecoveryFrontierDisposition::NoRecoveryRequired => (None, None),
            RecoveryFrontierDisposition::RecoveryInProgress => {
                (Some("recovery-case-alpha".to_string()), None)
            }
            RecoveryFrontierDisposition::KnownClosed => (
                Some("recovery-case-alpha".to_string()),
                Some("known-closed-alpha".to_string()),
            ),
        };
        RecoveryFrontierDraft {
            recovery_generation: 1,
            execution_scope_identity: "paper-scope-alpha".to_string(),
            availability: RecoveryFrontierAvailability::Available,
            disposition,
            recovery_case_identity: case,
            known_closed_identity: closed,
            effective_at_epoch_ms: 1_000,
            observed_at_epoch_ms: 1_100,
            exclusive_valid_through_epoch_ms: 2_000,
            clock_epoch: 7,
        }
    }

    fn store() -> RecoveryFrontierStore {
        RecoveryFrontierStore::new("owner-node-alpha", 1_200, 7)
    }

    #[rstest]
    fn exact_sealed_read_preserves_scope_identity_digest_generation_frontier_and_time() {
        let owner = store();
        let locator = owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        let sealed = owner.resolve_current(&locator).unwrap();

        assert_eq!(sealed.locator(), &locator);
        assert_eq!(sealed.schema_version(), 1);
        assert_eq!(sealed.mode(), PaperMode::Paper);
        assert_eq!(sealed.execution_scope_identity(), "paper-scope-alpha");
        assert_eq!(sealed.account_namespace(), locator.account_namespace);
        assert_eq!(sealed.effect_namespace(), locator.effect_namespace);
        assert_eq!(sealed.recovery_generation(), 1);
        assert!(validate_digest(&locator.fact_identity));
        assert!(validate_digest(&locator.content_digest));
        assert_eq!(locator.frontier.sequence, 1);
        assert_eq!(
            sealed.availability(),
            RecoveryFrontierAvailability::Available
        );
        assert_eq!(
            sealed.disposition(),
            RecoveryFrontierDisposition::KnownClosed
        );
        assert_eq!(sealed.recovery_case_identity(), Some("recovery-case-alpha"));
        assert_eq!(sealed.known_closed_identity(), Some("known-closed-alpha"));
        assert_eq!(sealed.effective_at_epoch_ms(), 1_000);
        assert_eq!(sealed.observed_at_epoch_ms(), 1_100);
        assert_eq!(sealed.exclusive_valid_through_epoch_ms(), 2_000);
        assert_eq!(sealed.clock_epoch(), 7);
    }

    #[rstest]
    fn complete_no_recovery_required_is_a_sealed_positive_frontier() {
        let owner = store();
        let locator = owner
            .commit(draft(RecoveryFrontierDisposition::NoRecoveryRequired))
            .unwrap();
        let sealed = owner.resolve_current(&locator).unwrap();
        assert_eq!(
            sealed.disposition(),
            RecoveryFrontierDisposition::NoRecoveryRequired
        );
        assert_eq!(sealed.recovery_case_identity(), None);
        assert_eq!(sealed.known_closed_identity(), None);
    }

    #[rstest]
    fn missing_and_caller_authored_claims_fail_closed() {
        let owner = store();
        let mut locator = owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        locator.fact_identity = "a".repeat(64);
        assert_eq!(
            owner.resolve_current(&locator),
            Err(RecoveryFrontierError::FactNotFound)
        );

        let claimed_json = serde_json::json!({
            "fact_identity": "b".repeat(64),
            "disposition": "KNOWN_CLOSED"
        });
        locator.fact_identity = claimed_json["fact_identity"].as_str().unwrap().to_string();
        assert_eq!(
            owner.resolve_current(&locator),
            Err(RecoveryFrontierError::FactNotFound)
        );
    }

    #[rstest]
    fn every_material_locator_mutation_fails_closed() {
        let owner = store();
        let locator = owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        let mut mutations = Vec::new();
        let mut changed = locator.clone();
        changed.execution_scope_identity = "paper-scope-beta".to_string();
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.account_namespace.push('x');
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.effect_namespace.push('x');
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.recovery_generation = 2;
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.content_digest = "c".repeat(64);
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.frontier.sequence += 1;
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.observed_at_epoch_ms += 1;
        mutations.push(changed);
        let mut changed = locator.clone();
        changed.disposition = RecoveryFrontierDisposition::NoRecoveryRequired;
        mutations.push(changed);

        for forged in mutations {
            assert!(owner.resolve_current(&forged).is_err());
        }
        assert!(owner.resolve_current(&locator).is_ok());
    }

    #[rstest]
    fn unavailable_and_partial_recovery_fail_closed() {
        let unavailable_owner = store();
        let mut unavailable = draft(RecoveryFrontierDisposition::KnownClosed);
        unavailable.availability = RecoveryFrontierAvailability::Unavailable;
        let locator = unavailable_owner.commit(unavailable).unwrap();
        assert_eq!(
            unavailable_owner.resolve_current(&locator),
            Err(RecoveryFrontierError::Unavailable)
        );

        let partial_owner = store();
        let locator = partial_owner
            .commit(draft(RecoveryFrontierDisposition::RecoveryInProgress))
            .unwrap();
        assert_eq!(
            partial_owner.resolve_current(&locator),
            Err(RecoveryFrontierError::PartialRecovery)
        );
    }

    #[rstest]
    fn stale_or_wrong_clock_epoch_fails_closed() {
        let owner = store();
        let locator = owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        owner.advance_clock(2_000, 7);
        assert_eq!(
            owner.resolve_current(&locator),
            Err(RecoveryFrontierError::Stale)
        );

        let epoch_owner = store();
        let locator = epoch_owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        epoch_owner.advance_clock(1_200, 8);
        assert_eq!(
            epoch_owner.resolve_current(&locator),
            Err(RecoveryFrontierError::Stale)
        );
    }

    #[rstest]
    fn successor_makes_prior_frontier_a_rollback() {
        let owner = store();
        let prior = owner
            .commit(draft(RecoveryFrontierDisposition::RecoveryInProgress))
            .unwrap();
        let mut successor = draft(RecoveryFrontierDisposition::KnownClosed);
        successor.recovery_generation = 2;
        successor.effective_at_epoch_ms = 1_100;
        successor.observed_at_epoch_ms = 1_200;
        let current = owner.commit(successor).unwrap();
        assert_eq!(
            owner.resolve_current(&prior),
            Err(RecoveryFrontierError::RollbackDetected)
        );
        assert!(owner.resolve_current(&current).is_ok());
    }

    #[rstest]
    fn generation_gap_and_chronology_rollback_are_rejected() {
        let owner = store();
        owner
            .commit(draft(RecoveryFrontierDisposition::NoRecoveryRequired))
            .unwrap();

        let mut gap = draft(RecoveryFrontierDisposition::KnownClosed);
        gap.recovery_generation = 3;
        gap.observed_at_epoch_ms = 1_200;
        assert_eq!(
            owner.commit(gap),
            Err(RecoveryFrontierError::RollbackDetected)
        );

        let mut regressed = draft(RecoveryFrontierDisposition::KnownClosed);
        regressed.recovery_generation = 2;
        regressed.observed_at_epoch_ms = 1_050;
        assert_eq!(
            owner.commit(regressed),
            Err(RecoveryFrontierError::RollbackDetected)
        );
    }

    #[rstest]
    fn malformed_scope_and_inconsistent_disposition_are_rejected_before_write() {
        let owner = store();
        let mut malformed = draft(RecoveryFrontierDisposition::KnownClosed);
        malformed.execution_scope_identity = "bad scope".to_string();
        assert_eq!(
            owner.commit(malformed),
            Err(RecoveryFrontierError::MalformedClaim)
        );

        let mut inconsistent = draft(RecoveryFrontierDisposition::NoRecoveryRequired);
        inconsistent.recovery_case_identity = Some("forged-case".to_string());
        assert_eq!(
            owner.commit(inconsistent),
            Err(RecoveryFrontierError::MalformedClaim)
        );
    }

    #[rstest]
    fn debug_and_errors_redact_protected_data() {
        let owner = store();
        let locator = owner
            .commit(draft(RecoveryFrontierDisposition::KnownClosed))
            .unwrap();
        let sealed = owner.resolve_current(&locator).unwrap();
        assert_eq!(
            format!("{locator:?}"),
            "RecoveryFrontierLocator([REDACTED])"
        );
        assert_eq!(format!("{sealed:?}"), "SealedRecoveryFrontier([REDACTED])");
        assert_eq!(
            RecoveryFrontierError::ClaimMismatch.to_string(),
            "recovery-frontier claim mismatch"
        );
    }

    #[rstest]
    fn exact_replay_joins_the_same_canonical_identity_and_frontier() {
        let owner = store();
        let proposal = draft(RecoveryFrontierDisposition::KnownClosed);
        let first = owner.commit(proposal.clone()).unwrap();
        let replay = owner.commit(proposal).unwrap();
        assert_eq!(first, replay);
    }
}
