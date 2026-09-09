//! Owner-sealed preparation for the existing ProgramHost/shared-kernel path.
//!
//! This boundary parses and revalidates the R&D-owned Plan and Artifact package against current
//! Market Data bindings. It deliberately stops before Backtest construction and makes no claim
//! about execution, actual consumption, diagnostics, terminals, or persisted results.

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::ReplayRequestV2;
use vibe_data::owner::{
    instrument_master::{InstrumentMasterReadbackV1, verify_instrument_master_readback},
    replay_market_facts_v2::AuthenticatedComposerNativeJoinV1,
    sample_projection::{
        StrategyInputSampleProjectionKindV2, StrategyInputSampleProjectionReadbackV2,
    },
    sample_projection_v4::{
        StrategyInputSampleProjectionKindV4, StrategyInputSampleProjectionReadbackV4,
        StrategyInputSampleProjectionResolverV4,
    },
    sealed_replay_input::SealedReplayInput,
    source_binding::BindingDigest,
    strategy_input_binding::{
        MarketDataFieldSemantic, StrategyInputBindingReceipt, StrategyInputEventKind,
    },
    strategy_input_event_corpus_v1::StrategyInputEventReplayPackageV1,
    strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1,
};

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    program_host_v2::{
        AdmittedProgramEventV2, ProgramHostV2, ProgramHostV2Error,
        admit_market_data_bar_joined_cut_program_event_v4,
        admit_market_data_joined_program_event_v2,
    },
    strategy_plan_v2::{BindingProjectionV2, StrategyPlanV2, VerifiedStrategyInputBindingsV2},
};

const OWNER_SEMANTICS_VERSION_V2: &str = "v2";

/// Move-only ProgramHost preparation capability issued from complete Owner-sealed readbacks.
///
/// Its fields remain private, it implements neither `Clone` nor a Serde trait, and it retains the
/// move-only Market Data and Instrument Master evidence that justified preparation. Its sole
/// handoff API consumes the capability, constructs the canonical [`ProgramHostV2`], and atomically
/// transfers the validated evidence to the future Backtest adapter.
///
/// An external caller cannot construct one directly:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// let _forged = PreparedProgramHostCapabilityV2 {};
/// ```
///
/// It cannot be cloned:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// fn require_clone<T: Clone>() {}
/// require_clone::<PreparedProgramHostCapabilityV2>();
/// ```
///
/// It cannot be serialized or deserialized:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// fn require_serialize<T: serde::Serialize>() {}
/// require_serialize::<PreparedProgramHostCapabilityV2>();
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// fn require_deserialize<T: for<'de> serde::Deserialize<'de>>() {}
/// require_deserialize::<PreparedProgramHostCapabilityV2>();
/// ```
///
/// Its private evidence cannot be destructured:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// fn split(value: PreparedProgramHostCapabilityV2) {
///     let PreparedProgramHostCapabilityV2 { plan, .. } = value;
///     drop(plan);
/// }
/// ```
///
/// Receiving the handoff is a one-shot move:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostCapabilityV2;
/// fn replay(value: PreparedProgramHostCapabilityV2) {
///     let _first = value.into_program_host_handoff_v2();
///     let _second = value.into_program_host_handoff_v2();
/// }
/// ```
pub struct PreparedProgramHostCapabilityV2 {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    request: ReplayRequestV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    sample_projection: StrategyInputSampleProjectionReadbackV2,
    binding: PreparedProgramBindingV2,
}

/// Move-only preparation capability for one exact Owner-issued V4 BAR joined cut.
///
/// The caller supplies selectors and sealed Owner readbacks, but never coordinate bytes. The V4
/// projection is resolved through a sealed Market Data resolver and is retained with the exact
/// joined cut until the real Backtest consumer takes ownership.
///
/// The capability is move-only:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostBarCapabilityV1;
/// fn require_clone<T: Clone>() {}
/// require_clone::<PreparedProgramHostBarCapabilityV1>();
/// ```
///
/// Its private evidence cannot be extracted or replaced:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostBarCapabilityV1;
/// fn split(value: PreparedProgramHostBarCapabilityV1) {
///     let PreparedProgramHostBarCapabilityV1 { native_join, .. } = value;
///     drop(native_join);
/// }
/// ```
pub struct PreparedProgramHostBarCapabilityV1 {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    request: ReplayRequestV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    sample_projection: StrategyInputSampleProjectionReadbackV4,
    native_join: AuthenticatedComposerNativeJoinV1,
    binding: PreparedProgramBarBindingV1,
}

/// Complete move-only Owner inputs for one V4 BAR joined-cut preparation.
///
/// This carrier shortens the preparation boundary without granting authority to construct any of
/// its sealed values. The preparation path still revalidates every equality before Host creation.
///
/// It cannot be copied into a second preparation attempt:
///
/// ```compile_fail
/// use vibe_strategy_factory::OwnerBarJoinedCutPreparationV1;
/// fn require_clone<T: Clone>() {}
/// require_clone::<OwnerBarJoinedCutPreparationV1>();
/// ```
pub struct OwnerBarJoinedCutPreparationV1 {
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    native_join: AuthenticatedComposerNativeJoinV1,
}

impl OwnerBarJoinedCutPreparationV1 {
    #[must_use]
    pub fn new(
        replay_input: SealedReplayInput,
        instrument_master: InstrumentMasterReadbackV1,
        input_bindings: Vec<StrategyInputBindingReceipt>,
        joined_cut: StrategyInputJoinedCutReceiptV1,
        native_join: AuthenticatedComposerNativeJoinV1,
    ) -> Self {
        Self {
            replay_input,
            instrument_master,
            input_bindings,
            joined_cut,
            native_join,
        }
    }
}

impl PreparedProgramHostBarCapabilityV1 {
    /// Revalidates the complete Owner binding and constructs the sole ProgramHost handoff.
    ///
    /// # Errors
    ///
    /// Returns [`ProgramHostV2Error::InputCoverage`] before a handoff exists if any retained
    /// Owner identity no longer matches the frozen preparation binding.
    pub fn into_program_host_bar_handoff_v1(
        self,
    ) -> Result<PreparedProgramHostBarHandoffV1, ProgramHostV2Error> {
        let Self {
            plan,
            artifact,
            request,
            replay_input,
            instrument_master,
            input_bindings,
            joined_cut,
            sample_projection,
            native_join,
            binding,
        } = self;
        if !prepared_bar_binding_matches_v1(
            &binding,
            &plan,
            &joined_cut,
            &sample_projection,
            &native_join,
        ) || binding.base.artifact != artifact.identity()
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let host = construct_prepared_program_host_v2(plan, artifact)?;
        Ok(PreparedProgramHostBarHandoffV1 {
            host,
            request,
            replay_input,
            instrument_master,
            input_bindings,
            joined_cut,
            sample_projection,
            native_join,
            binding,
        })
    }
}

impl PreparedProgramHostCapabilityV2 {
    /// Consumes this capability into one inseparable ProgramHost handoff.
    ///
    /// No raw Plan, Artifact, preparation claim, or private equality binding crosses this boundary.
    /// The returned evidence remains move-only and cannot be reconstructed by the caller.
    ///
    /// # Errors
    ///
    /// Returns [`ProgramHostV2Error`] if the already-revalidated Plan and Artifact cannot construct
    /// the canonical host. On error, no partial handoff remains available to the caller.
    pub fn into_program_host_handoff_v2(
        self,
    ) -> Result<PreparedProgramHostHandoffV2, ProgramHostV2Error> {
        let Self {
            plan,
            artifact,
            request,
            replay_input,
            instrument_master,
            input_bindings,
            joined_cut,
            sample_projection,
            binding,
        } = self;

        if !prepared_projection_binding_matches_v2(
            &binding,
            &joined_cut,
            sample_projection.receipt_digest(),
            sample_projection.subject_identity(),
            sample_projection.component_count(),
        ) {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let host = construct_prepared_program_host_v2(plan, artifact)?;
        Ok(PreparedProgramHostHandoffV2 {
            host,
            request,
            replay_input: Some(replay_input),
            instrument_master,
            input_bindings,
            joined_cut: Some(joined_cut),
            sample_projection: Some(sample_projection),
            event_package: None,
            binding,
        })
    }
}

/// Move-only preparation capability for the additive complete ordered EVENT corpus path.
pub struct PreparedProgramHostEventCorpusCapabilityV2 {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    request: ReplayRequestV2,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    event_package: StrategyInputEventReplayPackageV1,
    binding: PreparedProgramBindingV2,
}

impl PreparedProgramHostEventCorpusCapabilityV2 {
    /// Constructs one host only after rechecking the whole retained corpus binding, then transfers
    /// that corpus exactly once into the inseparable handoff.
    ///
    /// # Errors
    ///
    /// Returns [`ProgramHostV2Error::InputCoverage`] before Host construction if the retained corpus
    /// no longer matches the exact preparation binding.
    pub fn into_program_host_handoff_v2(
        self,
    ) -> Result<PreparedProgramHostHandoffV2, ProgramHostV2Error> {
        let Self {
            plan,
            artifact,
            request,
            instrument_master,
            input_bindings,
            event_package,
            binding,
        } = self;

        if !event_package.has_valid_digest()
            || binding.event_corpus_digest != event_package.corpus().digest()
            || binding.event_corpus_count != event_package.corpus().expected_count()
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let host = construct_prepared_program_host_v2(plan, artifact)?;
        Ok(PreparedProgramHostHandoffV2 {
            host,
            request,
            replay_input: None,
            instrument_master,
            input_bindings,
            joined_cut: None,
            sample_projection: None,
            event_package: Some(event_package),
            binding,
        })
    }
}

/// Move-only, inseparable ProgramHost handoff for a future Strategy Factory Backtest adapter.
///
/// This type preserves the canonical host, every Owner-sealed input, and the complete preparation
/// equality binding behind one private boundary. Public observations carry no preparation or
/// execution authority.
///
/// An external caller cannot construct or destructure the handoff:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn forge() -> PreparedProgramHostHandoffV2 {
///     PreparedProgramHostHandoffV2 {}
/// }
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn split(value: PreparedProgramHostHandoffV2) {
///     let PreparedProgramHostHandoffV2 { host, .. } = value;
///     drop(host);
/// }
/// ```
///
/// The request and its Owner correlation remain private:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn extract_request(value: &PreparedProgramHostHandoffV2) {
///     let _request = value.request();
/// }
/// ```
///
/// A consumer cannot require a separately supplied request:
///
/// ```compile_fail
/// use vibe_backtest_owner_contracts::ReplayRequestV2;
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn accepts_consumer(_: impl FnOnce(PreparedProgramHostHandoffV2)) {}
/// fn consume(_: PreparedProgramHostHandoffV2, _: ReplayRequestV2) {}
/// accepts_consumer(consume);
/// ```
///
/// It cannot be treated as a tuple of independently spliceable capabilities:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn splice(value: PreparedProgramHostHandoffV2) {
///     let (_host, _replay_input, _instrument_master, _input_bindings) = value;
/// }
/// ```
///
/// It cannot be cloned:
///
/// ```compile_fail
/// use vibe_strategy_factory::PreparedProgramHostHandoffV2;
/// fn require_clone<T: Clone>() {}
/// require_clone::<PreparedProgramHostHandoffV2>();
/// ```
pub struct PreparedProgramHostHandoffV2 {
    host: ProgramHostV2,
    request: ReplayRequestV2,
    replay_input: Option<SealedReplayInput>,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: Option<StrategyInputJoinedCutReceiptV1>,
    sample_projection: Option<StrategyInputSampleProjectionReadbackV2>,
    event_package: Option<StrategyInputEventReplayPackageV1>,
    binding: PreparedProgramBindingV2,
}

/// Inseparable ProgramHost handoff for one Owner-issued V4 BAR joined cut.
///
/// Public observations expose identities only. The joined cut, exact coordinate projection and
/// resolver-authenticated native join remain private and move exactly once into the in-crate
/// Backtest adapter.
///
/// The real Backtest consumer can take the handoff only once:
///
/// ```compile_fail
/// use vibe_strategy_factory::{
///     PreparedProgramHostBarHandoffV1, run_prepared_owner_bar_joined_cut_backtest_v1,
/// };
/// fn replay(value: PreparedProgramHostBarHandoffV1) {
///     let _first = run_prepared_owner_bar_joined_cut_backtest_v1(value);
///     let _second = run_prepared_owner_bar_joined_cut_backtest_v1(value);
/// }
/// ```
pub struct PreparedProgramHostBarHandoffV1 {
    host: ProgramHostV2,
    request: ReplayRequestV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    sample_projection: StrategyInputSampleProjectionReadbackV4,
    native_join: AuthenticatedComposerNativeJoinV1,
    binding: PreparedProgramBarBindingV1,
}

impl PreparedProgramHostBarHandoffV1 {
    /// Returns the exact V4 projection identity admitted before Host construction.
    #[must_use]
    pub const fn sample_projection_digest(&self) -> [u8; 32] {
        self.binding.sample_projection_digest
    }

    /// Returns the exact schedule-dependency-set digest sealed by Market Data.
    #[must_use]
    pub const fn schedule_dependency_set_digest(&self) -> [u8; 32] {
        self.binding.schedule_dependency_set_digest
    }

    /// Returns the canonical Host identity without exposing the prepared Host.
    #[must_use]
    pub const fn host_identity(&self) -> BindingDigest {
        self.host.host_identity()
    }

    pub(crate) fn into_bar_parts_v1(
        self,
    ) -> Result<(ProgramHostV2, AdmittedProgramEventV2), ProgramHostV2Error> {
        let Self {
            host,
            request: _,
            replay_input: _,
            instrument_master: _,
            input_bindings: _,
            joined_cut,
            sample_projection,
            native_join,
            binding,
        } = self;
        if !prepared_bar_binding_matches_v1(
            &binding,
            host.plan(),
            &joined_cut,
            &sample_projection,
            &native_join,
        ) {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        let event = admit_market_data_bar_joined_cut_program_event_v4(
            host.plan(),
            &joined_cut,
            &sample_projection,
        )?;
        Ok((host, event))
    }
}

impl PreparedProgramHostHandoffV2 {
    /// Returns the canonical host identity without exposing the prepared host.
    pub const fn host_identity(&self) -> BindingDigest {
        self.host.host_identity()
    }

    /// Returns the number of inseparable Owner input bindings.
    pub const fn input_binding_count(&self) -> usize {
        self.input_bindings.len()
    }

    /// Returns the exact Owner projection receipt digest admitted before Host construction.
    pub const fn sample_projection_digest(&self) -> [u8; 32] {
        self.binding.sample_projection_digest
    }

    /// Returns the complete Owner projection component count admitted with the Plan bindings.
    pub const fn sample_projection_component_count(&self) -> u32 {
        self.binding.sample_projection_component_count
    }

    /// Returns the complete EVENT corpus count, or zero for the historical single-event path.
    pub const fn event_corpus_count(&self) -> usize {
        self.binding.event_corpus_count
    }

    /// Returns the complete EVENT corpus digest, or zero for the historical single-event path.
    pub const fn event_corpus_digest(&self) -> BindingDigest {
        self.binding.event_corpus_digest
    }

    /// Moves the persistent Host and its complete corpus into the in-crate Backtest adapter.
    /// Keeping this seam crate-private prevents external adapters from selecting corpus members
    /// or bypassing the canonical Risk, Execution, and Portfolio composition path.
    pub(crate) fn into_event_corpus_parts_v1(
        self,
    ) -> Result<(ProgramHostV2, StrategyInputEventReplayPackageV1), ProgramHostV2Error> {
        let package = self
            .event_package
            .ok_or(ProgramHostV2Error::InputCoverage)?;

        if !package.has_valid_digest()
            || package.corpus().digest() != self.binding.event_corpus_digest
            || package.corpus().expected_count() != self.binding.event_corpus_count
        {
            return Err(ProgramHostV2Error::InputCoverage);
        }
        Ok((self.host, package))
    }
}

fn construct_prepared_program_host_v2(
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
) -> Result<ProgramHostV2, ProgramHostV2Error> {
    ProgramHostV2::new(plan, artifact)
}

/// Immutable equality binding over the complete preparation inputs.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct PreparedProgramBindingV2 {
    request_identity: String,
    request_meaning: String,
    request_receipt_identity: String,
    request_seal_digest: String,
    request_owner_cut_epoch_ms: u64,
    canonical_request_bytes_identity: BindingDigest,
    plan: BindingDigest,
    artifact: BindingDigest,
    market_frame_cut: BindingDigest,
    instrument_cut: BindingDigest,
    sample_projection_digest: [u8; 32],
    sample_projection_subject: [u8; 32],
    sample_projection_component_count: u32,
    event_corpus_digest: BindingDigest,
    event_corpus_count: usize,
}

#[derive(Debug, Eq, PartialEq)]
struct PreparedProgramBarBindingV1 {
    base: PreparedProgramBindingV2,
    strategy_design_identity: BindingDigest,
    join_identity: BindingDigest,
    joined_cut_receipt_digest: BindingDigest,
    sample_projection_digest: [u8; 32],
    sample_projection_subject: [u8; 32],
    schedule_dependency_set_digest: [u8; 32],
    sample_projection_component_count: u32,
}

/// Prepares the sole ProgramHost package from R&D and Market Data Owner-sealed evidence.
///
/// Every comparison and canonical parser completes before this function can return a capability.
/// External callers cannot mint any positive input accepted here because every input is a sealed
/// Owner readback or move-only Owner fact with private construction.
///
/// # Errors
///
/// Returns [`ProgramPreparationFaultV2`] before a capability exists when Owner evidence is
/// unavailable, cross-spliced, or fails canonical package revalidation.
pub fn prepare_program_host_from_owner_readbacks_v2(
    replay: &SealedExploratoryReplayReadbackV2,
    composer: &SealedDevelopComposerReadbackV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    joined_cut: StrategyInputJoinedCutReceiptV1,
    sample_projection: StrategyInputSampleProjectionReadbackV2,
) -> Result<PreparedProgramHostCapabilityV2, ProgramPreparationFaultV2> {
    if !verify_instrument_master_readback(&instrument_master) {
        return Err(ProgramPreparationFaultV2::Unavailable);
    }
    let claims = ProgramPreparationClaimsV2::from_owner_readbacks(
        replay,
        composer,
        &replay_input,
        &instrument_master,
    );
    let verified_bindings = VerifiedStrategyInputBindingsV2::from_owner_receipts(&input_bindings);
    let (plan, artifact, mut binding) = prepare_program_package_v2(&claims, verified_bindings)?;
    validate_joined_cut_plan_admission_v2(&plan, &joined_cut)?;
    validate_sample_projection_admission_v2(
        &sample_projection,
        &joined_cut,
        plan.input_bindings(),
    )?;
    binding.sample_projection_digest = sample_projection.receipt_digest();
    binding.sample_projection_subject = sample_projection.subject_identity();
    binding.sample_projection_component_count = sample_projection.component_count();
    Ok(PreparedProgramHostCapabilityV2 {
        plan,
        artifact,
        request: claims.request,
        replay_input,
        instrument_master,
        input_bindings,
        joined_cut,
        sample_projection,
        binding,
    })
}

/// Resolves and prepares one exact Owner-issued V4 BAR joined cut for the sole ProgramHost path.
///
/// # Errors
///
/// Returns [`ProgramPreparationFaultV2`] before Host construction when the exact V4 locator cannot
/// be resolved or any Replay, Composer, Plan, joined-cut, role, static-binding, subject, schedule,
/// or component equality fails.
pub async fn prepare_program_host_from_owner_bar_joined_cut_v1<R>(
    replay: &SealedExploratoryReplayReadbackV2,
    composer: &SealedDevelopComposerReadbackV2,
    inputs: OwnerBarJoinedCutPreparationV1,
    resolver: &R,
) -> Result<PreparedProgramHostBarCapabilityV1, ProgramPreparationFaultV2>
where
    R: StrategyInputSampleProjectionResolverV4 + ?Sized,
{
    let OwnerBarJoinedCutPreparationV1 {
        replay_input,
        instrument_master,
        input_bindings,
        joined_cut,
        native_join,
    } = inputs;
    if !verify_instrument_master_readback(&instrument_master) {
        return Err(ProgramPreparationFaultV2::Unavailable);
    }
    let sample_projection = resolver
        .resolve_strategy_input_sample_projection_v4(native_join.locator())
        .await
        .map_err(|_| ProgramPreparationFaultV2::Unavailable)?;
    let claims = ProgramPreparationClaimsV2::from_owner_readbacks(
        replay,
        composer,
        &replay_input,
        &instrument_master,
    );
    let verified_bindings = VerifiedStrategyInputBindingsV2::from_owner_receipts(&input_bindings);
    let (plan, artifact, base) = prepare_program_package_v2(&claims, verified_bindings)?;
    validate_bar_projection_admission_v1(&plan, &joined_cut, &sample_projection, &native_join)?;
    let binding = PreparedProgramBarBindingV1 {
        base,
        strategy_design_identity: native_join.strategy_design_identity(),
        join_identity: native_join.join_identity(),
        joined_cut_receipt_digest: native_join.joined_cut_receipt_digest(),
        sample_projection_digest: sample_projection.receipt_digest(),
        sample_projection_subject: sample_projection.subject_identity(),
        schedule_dependency_set_digest: sample_projection.schedule_dependency_set_digest(),
        sample_projection_component_count: sample_projection.component_count(),
    };
    Ok(PreparedProgramHostBarCapabilityV1 {
        plan,
        artifact,
        request: claims.request,
        replay_input,
        instrument_master,
        input_bindings,
        joined_cut,
        sample_projection,
        native_join,
        binding,
    })
}

fn validate_bar_projection_admission_v1(
    plan: &StrategyPlanV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
    projection: &StrategyInputSampleProjectionReadbackV4,
    native_join: &AuthenticatedComposerNativeJoinV1,
) -> Result<(), ProgramPreparationFaultV2> {
    if projection.kind() != StrategyInputSampleProjectionKindV4::JoinedCut
        || projection.component_count() != 6
        || projection.components().len() != 6
        || projection.receipt_digest() != native_join.locator().receipt_digest()
        || projection.subject_identity() != *joined_cut.digest().as_bytes()
        || projection.subject_identity() != *native_join.joined_cut_receipt_digest().as_bytes()
        || projection.schedule_dependency_set_digest()
            != *native_join.schedule_dependency_set_digest().as_bytes()
        || joined_cut.strategy_design_identity() != plan.design_identity()
        || native_join.strategy_design_identity() != plan.design_identity()
        || joined_cut.join_identity() != native_join.join_identity()
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    admit_market_data_bar_joined_cut_program_event_v4(plan, joined_cut, projection)
        .map(|_| ())
        .map_err(|_| ProgramPreparationFaultV2::OwnerMismatch)
}

fn prepared_bar_binding_matches_v1(
    binding: &PreparedProgramBarBindingV1,
    plan: &StrategyPlanV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
    projection: &StrategyInputSampleProjectionReadbackV4,
    native_join: &AuthenticatedComposerNativeJoinV1,
) -> bool {
    binding.base.plan == plan.canonical_plan_digest()
        && binding.base.artifact != BindingDigest::from_untrusted_bytes([0; 32])
        && binding.strategy_design_identity == plan.design_identity()
        && binding.strategy_design_identity == native_join.strategy_design_identity()
        && binding.join_identity == joined_cut.join_identity()
        && binding.join_identity == native_join.join_identity()
        && binding.joined_cut_receipt_digest == joined_cut.digest()
        && binding.joined_cut_receipt_digest == native_join.joined_cut_receipt_digest()
        && binding.sample_projection_digest == projection.receipt_digest()
        && binding.sample_projection_digest == native_join.locator().receipt_digest()
        && binding.sample_projection_subject == projection.subject_identity()
        && binding.sample_projection_subject == *joined_cut.digest().as_bytes()
        && binding.schedule_dependency_set_digest == projection.schedule_dependency_set_digest()
        && binding.schedule_dependency_set_digest
            == *native_join.schedule_dependency_set_digest().as_bytes()
        && binding.sample_projection_component_count == 6
        && projection.component_count() == 6
        && projection.components().len() == 6
}

/// Prepares one ProgramHost package carrying the complete Owner-sealed ordered EVENT corpus.
///
/// This is additive to [`prepare_program_host_from_owner_readbacks_v2`]. The historical single-event
/// path and all existing V1/V2 wire identities remain unchanged.
///
/// # Errors
///
/// Returns [`ProgramPreparationFaultV2`] before a capability or Host exists if any corpus member is
/// incompatible with the exact request, Plan bindings, or complete Market Data census.
pub fn prepare_program_host_from_owner_event_corpus_v1(
    replay: &SealedExploratoryReplayReadbackV2,
    composer: &SealedDevelopComposerReadbackV2,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    event_package: StrategyInputEventReplayPackageV1,
) -> Result<PreparedProgramHostEventCorpusCapabilityV2, ProgramPreparationFaultV2> {
    if !event_package.has_valid_digest() {
        return Err(ProgramPreparationFaultV2::Unavailable);
    }

    if !verify_instrument_master_readback(&instrument_master) {
        return Err(ProgramPreparationFaultV2::Unavailable);
    }
    let claims = ProgramPreparationClaimsV2::from_owner_readbacks(
        replay,
        composer,
        event_package.replay_input(),
        &instrument_master,
    );
    let verified_bindings = VerifiedStrategyInputBindingsV2::from_owner_receipts(&input_bindings);
    let (plan, artifact, mut binding) =
        prepare_program_event_corpus_package_v2(&claims, verified_bindings, &event_package)?;
    for member in event_package.corpus().members() {
        validate_joined_cut_plan_admission_v2(&plan, member.joined_cut())?;
        validate_sample_projection_admission_v2(
            member.projection(),
            member.joined_cut(),
            plan.input_bindings(),
        )?;
    }
    binding.event_corpus_digest = event_package.corpus().digest();
    binding.event_corpus_count = event_package.corpus().expected_count();
    Ok(PreparedProgramHostEventCorpusCapabilityV2 {
        plan,
        artifact,
        request: claims.request,
        instrument_master,
        input_bindings,
        event_package,
        binding,
    })
}

fn validate_joined_cut_plan_admission_v2(
    plan: &StrategyPlanV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
) -> Result<(), ProgramPreparationFaultV2> {
    admit_market_data_joined_program_event_v2(plan, joined_cut)
        .map(|_| ())
        .map_err(|_| ProgramPreparationFaultV2::OwnerMismatch)
}

struct ProgramPreparationClaimsV2 {
    request: ReplayRequestV2,
    request_bytes: Vec<u8>,
    request_locator: ExploratoryReplayRequestLocatorV2,
    request_bytes_identity: BindingDigest,
    owner_cut_epoch_ms: u64,
    composer_research_request: BindingDigest,
    composer_intent: BindingDigest,
    composer_design_identity: BindingDigest,
    composer_design_digest: BindingDigest,
    composer_plan_digest: BindingDigest,
    composer_artifact_identity: BindingDigest,
    composer_artifact_locator: String,
    design_bytes: Vec<u8>,
    design_bytes_digest: BindingDigest,
    plan_bytes: Vec<u8>,
    plan_bytes_digest: BindingDigest,
    artifact_package_bytes: Vec<u8>,
    artifact_package_bytes_digest: BindingDigest,
    module_bytes: Vec<Box<[u8]>>,
    module_bytes_digests: Vec<BindingDigest>,
    build_receipt_identities: Vec<BindingDigest>,
    build_receipt_bytes: Vec<Vec<u8>>,
    build_receipt_bytes_digests: Vec<BindingDigest>,
    composer_receipt_bytes: Vec<u8>,
    composer_receipt_bytes_digest: BindingDigest,
    host_receipt_bytes: Vec<u8>,
    host_receipt_bytes_digest: BindingDigest,
    market: MarketPreparationProjectionV2,
    instrument: InstrumentPreparationProjectionV1,
}

#[derive(Clone)]
struct MarketPreparationProjectionV2 {
    scope: BindingDigest,
    snapshot_identity: BindingDigest,
    snapshot_digest: BindingDigest,
    instrument_master: BindingDigest,
    universe: BindingDigest,
    market_semantics: BindingDigest,
    correction_rule: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    correction_stream_identity: String,
    frame_cut: BindingDigest,
    observation_start: u64,
    observation_end: u64,
    frames: Vec<FramePreparationProjectionV2>,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
struct FramePreparationProjectionV2 {
    event_effective: u64,
    correction_publication: u64,
    correction_sequence: u64,
    instrument: String,
    channel: String,
    data_kind: String,
    timeframe: String,
    field: String,
    scale: u8,
    member_key: String,
    digest: BindingDigest,
}

#[derive(Clone)]
struct InstrumentPreparationProjectionV1 {
    digest: BindingDigest,
    cut: BindingDigest,
    expected_members: Vec<String>,
    fact_members: Vec<String>,
}

impl ProgramPreparationClaimsV2 {
    fn from_owner_readbacks(
        replay: &SealedExploratoryReplayReadbackV2,
        composer: &SealedDevelopComposerReadbackV2,
        market: &SealedReplayInput,
        instrument: &InstrumentMasterReadbackV1,
    ) -> Self {
        let instrument_digest = instrument.digest();
        let instrument_cut = instrument.cut().digest();
        let frames = market
            .frames()
            .iter()
            .map(|frame| FramePreparationProjectionV2 {
                event_effective: frame.event_effective(),
                correction_publication: frame.correction_publication(),
                correction_sequence: frame.correction_sequence(),
                instrument: frame.instrument().to_owned(),
                channel: frame.channel().to_owned(),
                data_kind: frame.data_kind().to_owned(),
                timeframe: frame.timeframe().to_owned(),
                field: frame.field().to_owned(),
                scale: frame.value_scale(),
                member_key: frame.member_key().to_owned(),
                digest: frame.digest(),
            })
            .collect();
        Self {
            request: replay.request().clone(),
            request_bytes: replay.canonical_request_bytes().to_vec(),
            request_locator: replay.locator(),
            request_bytes_identity: canonical_blob_digest(
                b"rd.exploratory-replay-request.canonical-bytes.v2\0",
                replay.canonical_request_bytes(),
            ),
            owner_cut_epoch_ms: replay.owner_cut_epoch_ms(),
            composer_research_request: composer.research_request_identity(),
            composer_intent: composer.intent_identity(),
            composer_design_identity: composer.design_identity(),
            composer_design_digest: composer.locator().design_digest,
            composer_plan_digest: composer.locator().canonical_plan_digest,
            composer_artifact_identity: composer.locator().artifact_identity,
            composer_artifact_locator: composer.locator().artifact_locator.clone(),
            design_bytes: composer.design_bytes().to_vec(),
            design_bytes_digest: composer.design_bytes_digest(),
            plan_bytes: composer.plan_bytes().to_vec(),
            plan_bytes_digest: composer.plan_bytes_digest(),
            artifact_package_bytes: composer.artifact_package_bytes().to_vec(),
            artifact_package_bytes_digest: composer.artifact_package_bytes_digest(),
            module_bytes: composer.module_bytes().map(Box::<[u8]>::from).collect(),
            module_bytes_digests: composer.module_bytes_digests().to_vec(),
            build_receipt_identities: composer.build_receipt_identities().to_vec(),
            build_receipt_bytes: composer.build_receipt_bytes().map(<[u8]>::to_vec).collect(),
            build_receipt_bytes_digests: composer.build_receipt_bytes_digests().to_vec(),
            composer_receipt_bytes: composer.composer_receipt_bytes().to_vec(),
            composer_receipt_bytes_digest: composer.composer_receipt_bytes_digest(),
            host_receipt_bytes: composer.host_receipt_bytes().to_vec(),
            host_receipt_bytes_digest: composer.host_receipt_bytes_digest(),
            market: MarketPreparationProjectionV2 {
                scope: market.scope_digest(),
                snapshot_identity: market.snapshot_identity(),
                snapshot_digest: market.snapshot_fact_digest(),
                instrument_master: market.instrument_master_digest(),
                universe: market.universe_selection_digest(),
                market_semantics: market.market_semantics_identity(),
                correction_rule: market.snapshot_correction_rule_digest(),
                source_binding_lineage_root: market.source_binding_lineage_root(),
                correction_stream_identity: market.correction_frontier().stream_identity.clone(),
                frame_cut: market.frame_census_digest(),
                observation_start: market.observation_start_event_time(),
                observation_end: market.observation_end_event_time(),
                frames,
            },
            instrument: InstrumentPreparationProjectionV1 {
                digest: instrument_digest,
                cut: instrument_cut,
                expected_members: instrument.cut().expected_members().to_vec(),
                fact_members: instrument
                    .facts()
                    .iter()
                    .map(|fact| fact.canonical_identity().to_owned())
                    .collect(),
            },
        }
    }
}

fn prepare_program_package_v2(
    claims: &ProgramPreparationClaimsV2,
    current_bindings: VerifiedStrategyInputBindingsV2,
) -> Result<(StrategyPlanV2, StrategyArtifactV2, PreparedProgramBindingV2), ProgramPreparationFaultV2>
{
    let expected_window_end = claims
        .market
        .observation_end
        .checked_add(1)
        .ok_or(ProgramPreparationFaultV2::OwnerMismatch)?;
    prepare_program_package_with_replay_window_v2(
        claims,
        current_bindings,
        claims.market.observation_start,
        expected_window_end,
    )
}

fn prepare_program_event_corpus_package_v2(
    claims: &ProgramPreparationClaimsV2,
    current_bindings: VerifiedStrategyInputBindingsV2,
    event_package: &StrategyInputEventReplayPackageV1,
) -> Result<(StrategyPlanV2, StrategyArtifactV2, PreparedProgramBindingV2), ProgramPreparationFaultV2>
{
    let members = event_package.corpus().members();
    let expected_window_start = members
        .first()
        .ok_or(ProgramPreparationFaultV2::OwnerMismatch)?
        .order_key()
        .event_time();
    let expected_window_end = members
        .last()
        .ok_or(ProgramPreparationFaultV2::OwnerMismatch)?
        .order_key()
        .event_time()
        .checked_add(1)
        .ok_or(ProgramPreparationFaultV2::OwnerMismatch)?;
    let request_window = &claims.request.as_dto().window;

    if members.iter().any(|member| {
        let event_time = member.order_key().event_time();
        event_time < request_window.start_event_ns
            || event_time >= request_window.end_event_ns_exclusive
    }) {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    prepare_program_package_with_replay_window_v2(
        claims,
        current_bindings,
        expected_window_start,
        expected_window_end,
    )
}

fn prepare_program_package_with_replay_window_v2(
    claims: &ProgramPreparationClaimsV2,
    current_bindings: VerifiedStrategyInputBindingsV2,
    expected_window_start: u64,
    expected_window_end: u64,
) -> Result<(StrategyPlanV2, StrategyArtifactV2, PreparedProgramBindingV2), ProgramPreparationFaultV2>
{
    validate_request_seal(claims)?;
    validate_private_blob_digests(claims)?;

    let plan = StrategyPlanV2::parse_and_revalidate_durable(&claims.plan_bytes, current_bindings)
        .map_err(|_| ProgramPreparationFaultV2::CanonicalPackageMismatch)?;

    if plan.canonical_design_durable_bytes() != claims.design_bytes
        || plan.research_request_identity() != claims.composer_research_request
        || plan.intent_identity() != claims.composer_intent
        || plan.design_identity() != claims.composer_design_identity
        || plan.design_digest() != claims.composer_design_digest
        || plan.canonical_plan_digest() != claims.composer_plan_digest
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }

    let artifact = StrategyArtifactV2::parse_and_revalidate_durable(
        &claims.artifact_package_bytes,
        claims.module_bytes.clone(),
        &plan,
    )
    .map_err(|_| ProgramPreparationFaultV2::CanonicalPackageMismatch)?;

    if artifact.identity() != claims.composer_artifact_identity
        || claims.build_receipt_identities.len() != plan.plugin_implementations().len()
        || claims
            .build_receipt_identities
            .iter()
            .zip(plan.plugin_implementations())
            .any(|(owner, plugin)| *owner != plugin.verified_build_receipt_digest())
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }

    validate_request_program_equality(claims, &plan, &artifact)?;
    validate_market_and_instrument_equality(
        claims,
        &plan,
        expected_window_start,
        expected_window_end,
    )?;

    Ok((
        plan,
        artifact,
        PreparedProgramBindingV2 {
            request_identity: claims.request_locator.request_identity.clone(),
            request_meaning: claims.request_locator.meaning_digest.clone(),
            request_receipt_identity: claims.request_locator.receipt_identity.clone(),
            request_seal_digest: claims.request_locator.seal_digest.clone(),
            request_owner_cut_epoch_ms: claims.owner_cut_epoch_ms,
            canonical_request_bytes_identity: claims.request_bytes_identity,
            plan: claims.composer_plan_digest,
            artifact: claims.composer_artifact_identity,
            market_frame_cut: claims.market.frame_cut,
            instrument_cut: claims.instrument.cut,
            sample_projection_digest: [0; 32],
            sample_projection_subject: [0; 32],
            sample_projection_component_count: 0,
            event_corpus_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            event_corpus_count: 0,
        },
    ))
}

fn validate_sample_projection_admission_v2(
    projection: &StrategyInputSampleProjectionReadbackV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
    plan_bindings: &[BindingProjectionV2],
) -> Result<(), ProgramPreparationFaultV2> {
    let components = projection
        .components()
        .iter()
        .map(|component| {
            (
                component.role_identity(),
                component.binding_receipt_digest(),
            )
        })
        .collect::<Vec<_>>();
    let expected = plan_bindings
        .iter()
        .map(|binding| {
            (
                *binding.input_role_identity().as_bytes(),
                *binding.receipt_digest().as_bytes(),
            )
        })
        .collect::<Vec<_>>();
    let mut joined_components = joined_cut
        .components()
        .iter()
        .map(|component| {
            let [value] = component.frame().values() else {
                return Err(ProgramPreparationFaultV2::OwnerMismatch);
            };

            if component.frame().trigger().lifecycle().kind() != StrategyInputEventKind::Event {
                return Err(ProgramPreparationFaultV2::OwnerMismatch);
            }
            Ok((
                *value.input_role_identity().as_bytes(),
                *value.binding_receipt_digest().as_bytes(),
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    joined_components.sort_unstable();

    if projection.kind() != StrategyInputSampleProjectionKindV2::JoinedCut
        || projection.lifecycle() != StrategyInputEventKind::Event
        || !joined_cut.has_valid_digest()
        || projection.subject_identity() != *joined_cut.digest().as_bytes()
        || components != joined_components
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    validate_sample_projection_binding_set_v2(
        projection.receipt_digest(),
        projection.subject_identity(),
        projection.component_count(),
        &components,
        &expected,
    )
}

fn validate_sample_projection_binding_set_v2(
    receipt_digest: [u8; 32],
    subject_identity: [u8; 32],
    component_count: u32,
    components: &[([u8; 32], [u8; 32])],
    expected: &[([u8; 32], [u8; 32])],
) -> Result<(), ProgramPreparationFaultV2> {
    let count =
        usize::try_from(component_count).map_err(|_| ProgramPreparationFaultV2::OwnerMismatch)?;

    if receipt_digest == [0; 32]
        || subject_identity == [0; 32]
        || count != components.len()
        || count != expected.len()
        || components.windows(2).any(|pair| pair[0].0 >= pair[1].0)
        || components
            .iter()
            .zip(expected)
            .any(|(component, expected)| component != expected)
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    Ok(())
}

fn prepared_projection_binding_matches_v2(
    binding: &PreparedProgramBindingV2,
    joined_cut: &StrategyInputJoinedCutReceiptV1,
    receipt_digest: [u8; 32],
    subject_identity: [u8; 32],
    component_count: u32,
) -> bool {
    joined_cut.has_valid_digest()
        && subject_identity == *joined_cut.digest().as_bytes()
        && prepared_projection_identity_matches_v2(
            binding,
            receipt_digest,
            subject_identity,
            component_count,
        )
}

fn prepared_projection_identity_matches_v2(
    binding: &PreparedProgramBindingV2,
    receipt_digest: [u8; 32],
    subject_identity: [u8; 32],
    component_count: u32,
) -> bool {
    binding.sample_projection_digest == receipt_digest
        && binding.sample_projection_subject == subject_identity
        && binding.sample_projection_component_count == component_count
}

fn validate_request_seal(
    claims: &ProgramPreparationClaimsV2,
) -> Result<(), ProgramPreparationFaultV2> {
    let canonical = claims
        .request
        .to_canonical_bytes()
        .map_err(|_| ProgramPreparationFaultV2::Unavailable)?;
    let meaning = claims
        .request
        .meaning_digest()
        .map_err(|_| ProgramPreparationFaultV2::Unavailable)?;

    if claims.owner_cut_epoch_ms == 0
        || claims.request.request_identity().as_str() != claims.request_locator.request_identity
        || canonical != claims.request_bytes
        || meaning.as_str() != claims.request_locator.meaning_digest
        || claims.request_locator.receipt_identity.trim().is_empty()
        || claims.request_locator.seal_digest.trim().is_empty()
        || canonical_blob_digest(
            b"rd.exploratory-replay-request.canonical-bytes.v2\0",
            &claims.request_bytes,
        ) != claims.request_bytes_identity
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    Ok(())
}

fn validate_private_blob_digests(
    claims: &ProgramPreparationClaimsV2,
) -> Result<(), ProgramPreparationFaultV2> {
    let exact = [
        (
            b"rd.develop.design.canonical-bytes.v2\0".as_slice(),
            claims.design_bytes.as_slice(),
            claims.design_bytes_digest,
        ),
        (
            b"rd.develop.plan.canonical-bytes.v2\0".as_slice(),
            claims.plan_bytes.as_slice(),
            claims.plan_bytes_digest,
        ),
        (
            b"rd.develop.artifact-package.canonical-bytes.v2\0".as_slice(),
            claims.artifact_package_bytes.as_slice(),
            claims.artifact_package_bytes_digest,
        ),
        (
            b"rd.develop.composer-receipt.canonical-bytes.v2\0".as_slice(),
            claims.composer_receipt_bytes.as_slice(),
            claims.composer_receipt_bytes_digest,
        ),
        (
            b"rd.develop.host-receipt.canonical-bytes.v2\0".as_slice(),
            claims.host_receipt_bytes.as_slice(),
            claims.host_receipt_bytes_digest,
        ),
    ];

    if exact
        .into_iter()
        .any(|(domain, bytes, expected)| canonical_blob_digest(domain, bytes) != expected)
        || claims.module_bytes.len() != claims.module_bytes_digests.len()
        || claims.build_receipt_bytes.len() != claims.build_receipt_bytes_digests.len()
        || claims.build_receipt_bytes.len() != claims.build_receipt_identities.len()
        || claims
            .module_bytes
            .iter()
            .zip(&claims.module_bytes_digests)
            .any(|(bytes, expected)| {
                canonical_blob_digest(b"rd.develop.artifact-module.canonical-bytes.v2\0", bytes)
                    != *expected
            })
        || claims
            .build_receipt_bytes
            .iter()
            .zip(&claims.build_receipt_bytes_digests)
            .any(|(bytes, expected)| {
                canonical_blob_digest(b"rd.develop.build-receipt.canonical-bytes.v2\0", bytes)
                    != *expected
            })
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    Ok(())
}

fn validate_request_program_equality(
    claims: &ProgramPreparationClaimsV2,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
) -> Result<(), ProgramPreparationFaultV2> {
    let request = claims.request.as_dto();
    if !named_binding_identity(
        &request.frozen_research_intent.identity,
        "rd-research-intent-v2-",
        plan.intent_identity(),
    ) || !content_digest_matches(
        &request.frozen_research_intent,
        DigestAlgorithmV2::Sha256,
        plan.intent_digest(),
    ) || !content_identity_matches(
        &request.strategy_design,
        DigestAlgorithmV2::Sha256,
        plan.design_identity(),
    ) || !content_digest_matches(
        &request.strategy_design,
        DigestAlgorithmV2::Sha256,
        plan.design_digest(),
    ) || !content_identity_matches(
        &request.strategy_plan,
        DigestAlgorithmV2::Sha256,
        plan.canonical_plan_digest(),
    ) || !content_digest_matches(
        &request.strategy_plan,
        DigestAlgorithmV2::Sha256,
        plan.canonical_plan_digest(),
    ) || request.artifact.identity.as_str() != claims.composer_artifact_locator
        || !content_digest_matches(
            &request.artifact,
            DigestAlgorithmV2::Sha256,
            artifact.identity(),
        )
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    Ok(())
}

fn validate_market_and_instrument_equality(
    claims: &ProgramPreparationClaimsV2,
    plan: &StrategyPlanV2,
    expected_window_start: u64,
    expected_window_end: u64,
) -> Result<(), ProgramPreparationFaultV2> {
    let request = claims.request.as_dto();

    if claims.market.frames.is_empty()
        || expected_window_start != request.window.start_event_ns
        || expected_window_end != request.window.end_event_ns_exclusive
        || !content_digest_matches(
            &request.pit_scope,
            DigestAlgorithmV2::Blake3,
            claims.market.scope,
        )
        || !content_identity_matches(
            &request.pit_snapshot,
            DigestAlgorithmV2::Blake3,
            claims.market.snapshot_identity,
        )
        || !content_digest_matches(
            &request.pit_snapshot,
            DigestAlgorithmV2::Blake3,
            claims.market.snapshot_digest,
        )
        || !content_digest_matches(
            &request.universe_selection,
            DigestAlgorithmV2::Blake3,
            claims.market.universe,
        )
        || !content_digest_matches(
            &request.resolved_owner_inputs,
            DigestAlgorithmV2::Blake3,
            claims.market.frame_cut,
        )
        || !version_identity_matches(
            &request.market_semantics,
            DigestAlgorithmV2::Blake3,
            claims.market.market_semantics,
        )
        || !version_identity_matches(
            &request.correction_rule,
            DigestAlgorithmV2::Blake3,
            claims.market.correction_rule,
        )
        || !content_digest_matches(
            &request.historical_membership_cut,
            DigestAlgorithmV2::Blake3,
            claims.instrument.cut,
        )
        || claims.market.instrument_master != claims.instrument.digest
        || plan.market_semantics_identity() != claims.market.market_semantics
        || plan.input_bindings().is_empty()
        || !plan.input_bindings().iter().all(|binding| {
            claims
                .market
                .frames
                .iter()
                .any(|frame| frame_matches_binding(&claims.market, frame, binding))
        })
        || !claims.market.frames.iter().all(|frame| {
            plan.input_bindings()
                .iter()
                .any(|binding| frame_matches_binding(&claims.market, frame, binding))
        })
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }

    let mut frames = claims.market.frames.clone();
    let original = frames.clone();
    frames.sort();
    let mut expected_members = claims.instrument.expected_members.clone();
    let mut fact_members = claims.instrument.fact_members.clone();
    let mut frame_members = claims
        .market
        .frames
        .iter()
        .map(|frame| frame.instrument.clone())
        .collect::<Vec<_>>();
    expected_members.sort();
    expected_members.dedup();
    fact_members.sort();
    fact_members.dedup();
    frame_members.sort();
    frame_members.dedup();

    if frames != original
        || frames.first().map(|frame| frame.event_effective)
            != Some(claims.market.observation_start)
        || frames.last().map(|frame| frame.event_effective) != Some(claims.market.observation_end)
        || frames
            .windows(2)
            .any(|pair| pair[0] == pair[1] || pair[0].digest == pair[1].digest)
        || frames
            .iter()
            .any(|frame| frame.digest.as_bytes() == &[0; 32])
        || expected_members.is_empty()
        || expected_members != fact_members
        || expected_members != frame_members
    {
        return Err(ProgramPreparationFaultV2::OwnerMismatch);
    }
    Ok(())
}

fn frame_matches_binding(
    market: &MarketPreparationProjectionV2,
    frame: &FramePreparationProjectionV2,
    binding: &BindingProjectionV2,
) -> bool {
    binding.source_binding_lineage_root() == market.source_binding_lineage_root
        && binding.correction_stream_identity() == market.correction_stream_identity
        && frame.instrument == binding.instrument()
        && frame.channel == binding.channel()
        && frame.data_kind == binding.data_kind()
        && frame.timeframe == binding.timeframe()
        && MarketDataFieldSemantic::from_identity(binding.field_semantic_id())
            .is_some_and(|semantic| frame.field == semantic.row_field())
        && frame.scale == binding.scale()
}

#[derive(Clone, Copy)]
enum DigestAlgorithmV2 {
    Sha256,
    Blake3,
}

fn content_identity_matches(
    value: &vibe_backtest_owner_contracts::ContentIdentityV2,
    algorithm: DigestAlgorithmV2,
    expected: BindingDigest,
) -> bool {
    binding_text_matches(value.identity.as_str(), algorithm, expected)
}

fn content_digest_matches(
    value: &vibe_backtest_owner_contracts::ContentIdentityV2,
    algorithm: DigestAlgorithmV2,
    expected: BindingDigest,
) -> bool {
    binding_text_matches(value.digest.as_str(), algorithm, expected)
}

fn version_identity_matches(
    value: &vibe_backtest_owner_contracts::VersionedIdentityV2,
    algorithm: DigestAlgorithmV2,
    expected: BindingDigest,
) -> bool {
    value.version.as_str() == OWNER_SEMANTICS_VERSION_V2
        && binding_text_matches(value.identity.as_str(), algorithm, expected)
}

fn named_binding_identity(
    value: &vibe_backtest_owner_contracts::OpaqueIdentityV2,
    prefix: &str,
    expected: BindingDigest,
) -> bool {
    value.as_str() == format!("{prefix}{}", hex(expected.as_bytes()))
}

fn binding_text_matches(
    value: &str,
    algorithm: DigestAlgorithmV2,
    expected: BindingDigest,
) -> bool {
    let algorithm = match algorithm {
        DigestAlgorithmV2::Sha256 => "sha256",
        DigestAlgorithmV2::Blake3 => "blake3",
    };
    value == format!("{algorithm}:{}", hex(expected.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn canonical_blob_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
pub(crate) fn prepare_event_corpus_handoff_for_sealed_acceptance_v1()
-> anyhow::Result<PreparedProgramHostHandoffV2> {
    prepare_event_corpus_handoff_for_sealed_acceptance_window_v1(None)
}

#[cfg(all(test, feature = "sealed-strategy-input-acceptance"))]
fn prepare_event_corpus_handoff_for_sealed_acceptance_window_v1(
    replay_window: Option<vibe_backtest_owner_contracts::ReplayWindowV2>,
) -> anyhow::Result<PreparedProgramHostHandoffV2> {
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayWindowV2, VersionedIdentityV2,
    };
    use vibe_data::owner::pit_snapshot::joined_input_sealed_acceptance::issue_strategy_input_event_replay_package_for_sealed_acceptance_v1;

    use crate::{
        develop_composer_postgres_v2::issue_sealed_develop_composer_readback_for_acceptance_v2,
        exploratory_replay::issue_sealed_exploratory_replay_readback_for_acceptance_v2,
        program_host_v2::event_corpus_plan_and_artifact,
    };

    fn opaque(value: &str) -> anyhow::Result<OpaqueIdentityV2> {
        OpaqueIdentityV2::try_from(value.to_owned()).map_err(Into::into)
    }
    fn digest_text(algorithm: &str, value: BindingDigest) -> String {
        format!("{algorithm}:{}", hex(value.as_bytes()))
    }
    fn content(
        algorithm: &str,
        identity: BindingDigest,
        digest: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(&digest_text(algorithm, identity))?,
            digest: CanonicalDigestV2::try_from(digest_text(algorithm, digest))?,
        })
    }
    fn named_content(identity: String, digest: BindingDigest) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(&identity)?,
            digest: CanonicalDigestV2::try_from(digest_text("sha256", digest))?,
        })
    }
    fn version(algorithm: &str, identity: BindingDigest) -> anyhow::Result<VersionedIdentityV2> {
        Ok(VersionedIdentityV2 {
            identity: opaque(&digest_text(algorithm, identity))?,
            version: opaque(OWNER_SEMANTICS_VERSION_V2)?,
        })
    }
    fn fixture_digest(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    let acceptance = issue_strategy_input_event_replay_package_for_sealed_acceptance_v1()?;
    let (bindings, event_package, instrument_master) = acceptance.into_preparation_parts();
    let (plan, artifact) = event_corpus_plan_and_artifact(&bindings);
    let first_event_ns = event_package
        .corpus()
        .members()
        .first()
        .ok_or_else(|| anyhow::anyhow!("EVENT replay corpus is empty"))?
        .order_key()
        .event_time();
    let end_event_ns_exclusive = event_package
        .corpus()
        .members()
        .last()
        .ok_or_else(|| anyhow::anyhow!("EVENT replay corpus is empty"))?
        .order_key()
        .event_time()
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("EVENT replay window overflow"))?;
    let market = event_package.replay_input();
    let artifact_locator = format!(
        "rd-strategy-artifact-v2-{}",
        hex(artifact.identity().as_bytes())
    );
    let request = ReplayRequestV2::try_from(ReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: opaque("owner-event-corpus-replay-request-v2")?,
        frozen_research_intent: named_content(
            format!(
                "rd-research-intent-v2-{}",
                hex(plan.intent_identity().as_bytes())
            ),
            plan.intent_digest(),
        )?,
        trial_family: content("sha256", fixture_digest(1), fixture_digest(2))?,
        trial_family_census_frontier: content("sha256", fixture_digest(3), fixture_digest(4))?,
        replay_authority: ReplayAuthorityClaimV2::Exploratory,
        strategy_design: content("sha256", plan.design_identity(), plan.design_digest())?,
        strategy_plan: content(
            "sha256",
            plan.canonical_plan_digest(),
            plan.canonical_plan_digest(),
        )?,
        artifact: named_content(artifact_locator, artifact.identity())?,
        resolved_owner_inputs: content("blake3", fixture_digest(5), market.frame_census_digest())?,
        pit_scope: content("blake3", fixture_digest(6), market.scope_digest())?,
        pit_snapshot: content(
            "blake3",
            market.snapshot_identity(),
            market.snapshot_fact_digest(),
        )?,
        universe_selection: content(
            "blake3",
            fixture_digest(7),
            market.universe_selection_digest(),
        )?,
        correction_rule: version("blake3", market.snapshot_correction_rule_digest())?,
        market_semantics: version("blake3", market.market_semantics_identity())?,
        replay_configuration: content("sha256", fixture_digest(8), fixture_digest(9))?,
        models: ReplayModelProfilesV2 {
            runtime_kernel: version("sha256", fixture_digest(10))?,
            simulator: version("sha256", fixture_digest(11))?,
            cost: version("sha256", fixture_digest(12))?,
            slippage: version("sha256", fixture_digest(13))?,
            capacity: version("sha256", fixture_digest(14))?,
        },
        runner_operational_profile: version("sha256", fixture_digest(15))?,
        diagnostic_policy: version("sha256", fixture_digest(16))?,
        deterministic_seed: 17,
        window: replay_window.unwrap_or(ReplayWindowV2 {
            start_event_ns: first_event_ns,
            end_event_ns_exclusive,
        }),
        calendar: version("sha256", fixture_digest(17))?,
        session: version("sha256", fixture_digest(18))?,
        time_zone: version("sha256", fixture_digest(19))?,
        corporate_action_cut: content("sha256", fixture_digest(20), fixture_digest(21))?,
        historical_membership_cut: content(
            "blake3",
            fixture_digest(22),
            instrument_master.cut().digest(),
        )?,
    })?;
    let replay = issue_sealed_exploratory_replay_readback_for_acceptance_v2(request)?;
    let composer = issue_sealed_develop_composer_readback_for_acceptance_v2(&plan, &artifact)?;
    Ok(prepare_program_host_from_owner_event_corpus_v1(
        &replay,
        &composer,
        instrument_master,
        bindings.into_vec(),
        event_package,
    )?
    .into_program_host_handoff_v2()?)
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ProgramPreparationFaultV2 {
    /// Complete sealed Owner evidence is unavailable.
    #[error("complete Owner evidence is unavailable")]
    Unavailable,
    /// The sealed inputs do not bind one exact request and program meaning.
    #[error("Owner-sealed preparation inputs do not describe one exact meaning")]
    OwnerMismatch,
    /// The canonical Plan or Artifact package cannot be strictly reconstructed.
    #[error("canonical Plan or Artifact package failed strict revalidation")]
    CanonicalPackageMismatch,
}

#[cfg(test)]
mod preparation_tests {
    use rstest::rstest;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayWindowV2, VersionedIdentityV2,
    };
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    use vibe_data::owner::pit_snapshot::joined_input_sealed_acceptance::issue_strategy_input_join_corpus;
    use vibe_model::instruments::{Instrument, stubs::crypto_perpetual_ethusdt};

    use super::*;
    use crate::program_host_v2_backtest_tests::preparation_fixture;
    #[cfg(feature = "sealed-strategy-input-acceptance")]
    use crate::{
        program_host_v2::joined_design,
        strategy_plan_v2::{
            StrategyCompilationV2, compile_strategy_design_v2,
            plugin_implementation_receipts_for_test,
        },
    };

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[rstest]
    fn event_corpus_member_outside_replay_window_fails_before_handoff() {
        let result =
            prepare_event_corpus_handoff_for_sealed_acceptance_window_v1(Some(ReplayWindowV2 {
                start_event_ns: 5_000_000_000,
                end_event_ns_exclusive: 5_000_000_001,
            }));
        let error = result
            .err()
            .expect("a terminal-anchor-only Replay window must fail closed");

        assert_eq!(
            error.downcast_ref::<ProgramPreparationFaultV2>(),
            Some(&ProgramPreparationFaultV2::OwnerMismatch)
        );
    }

    #[cfg(feature = "sealed-strategy-input-acceptance")]
    #[rstest]
    fn owner_valid_alternate_join_claim_fails_before_native_preparation() {
        let corpus = issue_strategy_input_join_corpus().expect("Owner-sealed joined corpus");
        let design = joined_design();
        let implementation_receipts = plugin_implementation_receipts_for_test(&design, 71);
        let StrategyCompilationV2::Compiled(plan) =
            compile_strategy_design_v2(design, corpus.bindings(), &implementation_receipts)
        else {
            panic!("canonical joined Plan compiles from the fixed Owner bindings")
        };
        let canonical = &corpus.events()[0];
        let alternate = corpus.alternate_join_claim_for_negative_test();

        assert_eq!(
            validate_joined_cut_plan_admission_v2(&plan, canonical),
            Ok(())
        );
        assert!(alternate.has_valid_digest());
        assert_eq!(alternate.strategy_design_identity(), plan.design_identity());
        assert_eq!(alternate.components().len(), corpus.bindings().len());
        assert_ne!(alternate.join_identity(), canonical.join_identity());
        assert_eq!(
            validate_joined_cut_plan_admission_v2(&plan, alternate),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
    }

    #[rstest]
    fn projection_binding_set_requires_exact_complete_strict_plan_order() {
        let first = ([1; 32], [11; 32]);
        let second = ([2; 32], [22; 32]);
        let expected = [first, second];
        let accepts = |count, components: &[([u8; 32], [u8; 32])]| {
            validate_sample_projection_binding_set_v2(
                [31; 32], [41; 32], count, components, &expected,
            )
        };

        assert_eq!(accepts(2, &expected), Ok(()));
        assert_eq!(
            accepts(1, &expected[..1]),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            accepts(3, &[first, second, ([3; 32], [33; 32])]),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            accepts(2, &[first, first]),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            accepts(2, &[second, first]),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            accepts(2, &[([1; 32], [99; 32]), second]),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            validate_sample_projection_binding_set_v2([0; 32], [41; 32], 2, &expected, &expected),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            validate_sample_projection_binding_set_v2([31; 32], [0; 32], 2, &expected, &expected),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
        assert_eq!(
            validate_sample_projection_binding_set_v2([31; 32], [41; 32], 1, &expected, &expected),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        );
    }

    #[rstest]
    fn projection_identity_binding_rejects_cross_projection_splice() {
        let (claims, bindings) = claims(67).expect("complete Owner meaning");
        let (_, _, mut prepared) =
            prepare_program_package_v2(&claims, bindings).expect("canonical prepared package");
        prepared.sample_projection_digest = [31; 32];
        prepared.sample_projection_subject = [41; 32];
        prepared.sample_projection_component_count = 1;

        assert!(prepared_projection_identity_matches_v2(
            &prepared, [31; 32], [41; 32], 1
        ));
        assert!(!prepared_projection_identity_matches_v2(
            &prepared, [32; 32], [41; 32], 1
        ));
        assert!(!prepared_projection_identity_matches_v2(
            &prepared, [31; 32], [42; 32], 1
        ));
        assert!(!prepared_projection_identity_matches_v2(
            &prepared, [31; 32], [41; 32], 2
        ));
    }

    #[rstest]
    fn two_owner_meanings_prepare_through_one_program_boundary() {
        let (first, first_bindings) = claims(71).expect("first complete Owner meaning");
        let (second, second_bindings) = claims(91).expect("second complete Owner meaning");
        let first_correlation = (
            first.request_locator.clone(),
            first.owner_cut_epoch_ms,
            first.request_bytes_identity,
        );
        let (first_plan, first_artifact, first) =
            prepare_program_package_v2(&first, first_bindings).expect("first meaning must prepare");
        let (second_plan, second_artifact, second) =
            prepare_program_package_v2(&second, second_bindings)
                .expect("second meaning must prepare");
        let first_host = construct_prepared_program_host_v2(first_plan, first_artifact)
            .expect("first prepared meaning constructs the canonical host");
        let second_host = construct_prepared_program_host_v2(second_plan, second_artifact)
            .expect("second prepared meaning constructs the canonical host");

        assert_ne!(first, second);
        assert_eq!(first.request_identity, first_correlation.0.request_identity);
        assert_eq!(first.request_meaning, first_correlation.0.meaning_digest);
        assert_eq!(
            first.request_receipt_identity,
            first_correlation.0.receipt_identity
        );
        assert_eq!(first.request_seal_digest, first_correlation.0.seal_digest);
        assert_eq!(first.request_owner_cut_epoch_ms, first_correlation.1);
        assert_eq!(first.canonical_request_bytes_identity, first_correlation.2);
        assert_ne!(first.request_identity, second.request_identity);
        assert_ne!(first.request_meaning, second.request_meaning);
        assert_ne!(
            first.canonical_request_bytes_identity,
            second.canonical_request_bytes_identity
        );
        assert_ne!(first.plan, second.plan);
        assert_ne!(first.artifact, second.artifact);
        assert_ne!(first.market_frame_cut, second.market_frame_cut);
        assert_ne!(first.instrument_cut, second.instrument_cut);
        assert_ne!(first_host.host_identity(), second_host.host_identity());
    }

    #[rstest]
    fn every_owner_cut_cross_splice_fails_before_a_capability_exists() {
        for mutation in 0..32 {
            let (mut claims, bindings) = claims(101).expect("complete Owner meaning");
            let different = BindingDigest::from_untrusted_bytes([mutation + 131; 32]);
            match mutation {
                0 => claims.request_bytes.push(0),
                1 => claims.composer_intent = different,
                2 => claims.composer_design_identity = different,
                3 => claims.composer_plan_digest = different,
                4 => claims.composer_artifact_identity = different,
                5 => claims.module_bytes_digests[0] = different,
                6 => claims.build_receipt_identities[0] = different,
                7 => claims.market.market_semantics = different,
                8 => claims.market.scope = different,
                9 => claims.market.snapshot_digest = different,
                10 => claims.market.universe = different,
                11 => claims.market.frame_cut = different,
                12 => claims.instrument.cut = different,
                13 => {
                    claims
                        .market
                        .frames
                        .retain(|frame| frame.event_effective == 1);
                }
                14 => claims.design_bytes.push(0),
                15 => claims.plan_bytes.push(0),
                16 => claims.artifact_package_bytes.push(0),
                17 => claims.build_receipt_bytes[0].push(0),
                18 => claims.owner_cut_epoch_ms = 0,
                19 => claims.request_locator.meaning_digest.push('0'),
                20 => claims.composer_artifact_locator.push('0'),
                21 => claims.market.source_binding_lineage_root = different,
                22 => claims.market.correction_stream_identity.push('0'),
                23 => claims.market.frames[0].field.push('0'),
                24 => claims.market.frames[0].channel.push('0'),
                25 => claims.market.frames[0].timeframe.push('0'),
                26 => claims.market.frames[0].scale = 3,
                27 => claims.market.frames[0].data_kind.push('0'),
                28 => claims.request_locator.request_identity.push('0'),
                29 => claims.request_locator.receipt_identity.clear(),
                30 => claims.request_locator.seal_digest.clear(),
                31 => claims.request_bytes_identity = different,
                _ => unreachable!(),
            }
            assert!(
                prepare_program_package_v2(&claims, bindings).is_err(),
                "mutation {mutation} must fail closed"
            );
        }
    }

    #[rstest]
    fn aligned_owner_splices_still_fail_against_the_canonical_plan() {
        let (mut instrument_splice, instrument_bindings) =
            claims(105).expect("complete instrument A meaning");
        let instrument_b = "AAPL.XNAS".to_owned();

        for frame in &mut instrument_splice.market.frames {
            frame.instrument.clone_from(&instrument_b);
        }
        instrument_splice.instrument.expected_members = vec![instrument_b.clone()];
        instrument_splice.instrument.fact_members = vec![instrument_b];
        assert!(matches!(
            prepare_program_package_v2(&instrument_splice, instrument_bindings),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        ));

        let (mut semantics_splice, semantics_bindings) =
            claims(106).expect("complete Market Semantics A meaning");
        let semantics_b = binding(207);
        let mut request_b = semantics_splice.request.as_dto().clone();
        request_b.market_semantics =
            blake3_version(semantics_b).expect("valid Market Semantics B identity");
        semantics_splice.request =
            ReplayRequestV2::try_from(request_b).expect("well-formed sealed request B");
        semantics_splice.request_bytes = semantics_splice
            .request
            .to_canonical_bytes()
            .expect("canonical sealed request B bytes");
        semantics_splice.request_locator.meaning_digest = semantics_splice
            .request
            .meaning_digest()
            .expect("sealed request B meaning")
            .as_str()
            .to_owned();
        semantics_splice.request_bytes_identity = canonical_blob_digest(
            b"rd.exploratory-replay-request.canonical-bytes.v2\0",
            &semantics_splice.request_bytes,
        );
        semantics_splice.market.market_semantics = semantics_b;
        assert!(matches!(
            prepare_program_package_v2(&semantics_splice, semantics_bindings),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        ));
    }

    #[rstest]
    fn version_only_owner_splices_fail_closed() {
        for market_semantics in [false, true] {
            let (mut claims, bindings) = claims(107).expect("complete V2 Owner meaning");
            let mut request = claims.request.as_dto().clone();
            let version = opaque("v3").expect("valid unsupported version");
            if market_semantics {
                request.market_semantics.version = version;
            } else {
                request.correction_rule.version = version;
            }
            claims.request =
                ReplayRequestV2::try_from(request).expect("well-formed version-spliced request");
            claims.request_bytes = claims
                .request
                .to_canonical_bytes()
                .expect("canonical version-spliced request bytes");
            claims.request_locator.meaning_digest = claims
                .request
                .meaning_digest()
                .expect("version-spliced request meaning")
                .as_str()
                .to_owned();
            claims.request_bytes_identity = canonical_blob_digest(
                b"rd.exploratory-replay-request.canonical-bytes.v2\0",
                &claims.request_bytes,
            );

            assert!(matches!(
                prepare_program_package_v2(&claims, bindings),
                Err(ProgramPreparationFaultV2::OwnerMismatch)
            ));
        }
    }

    #[rstest]
    fn digest_algorithm_cross_splice_fails_even_when_payload_bytes_match() {
        let (mut claims, bindings) = claims(111).expect("complete Owner meaning");
        let mut request = claims.request.as_dto().clone();
        request.strategy_plan.digest = CanonicalDigestV2::try_from(format!(
            "blake3:{}",
            hex(claims.composer_plan_digest.as_bytes())
        ))
        .expect("same digest payload in a different algorithm namespace");
        claims.request = ReplayRequestV2::try_from(request).expect("well-formed request claim");
        claims.request_bytes = claims
            .request
            .to_canonical_bytes()
            .expect("canonical request bytes");
        claims.request_locator.meaning_digest = claims
            .request
            .meaning_digest()
            .expect("request meaning")
            .as_str()
            .to_owned();
        claims.request_bytes_identity = canonical_blob_digest(
            b"rd.exploratory-replay-request.canonical-bytes.v2\0",
            &claims.request_bytes,
        );

        assert!(matches!(
            prepare_program_package_v2(&claims, bindings),
            Err(ProgramPreparationFaultV2::OwnerMismatch)
        ));
    }

    fn claims(
        meaning: u8,
    ) -> anyhow::Result<(ProgramPreparationClaimsV2, VerifiedStrategyInputBindingsV2)> {
        let instrument = crypto_perpetual_ethusdt();
        let instrument_id = instrument.id();
        let instrument_text = instrument_id.to_string();
        let (plan, artifact, bindings) = preparation_fixture(instrument_id, meaning)?;
        let scope = binding(meaning.wrapping_add(4));
        let snapshot_identity = binding(meaning.wrapping_add(5));
        let snapshot_digest = binding(meaning.wrapping_add(6));
        let universe = binding(meaning.wrapping_add(7));
        let frame_cut = binding(meaning.wrapping_add(8));
        let correction = binding(meaning.wrapping_add(9));
        let instrument_digest = binding(meaning.wrapping_add(10));
        let instrument_cut = binding(meaning.wrapping_add(11));
        let artifact_locator = format!(
            "rd-strategy-artifact-v2-{}",
            hex(artifact.identity().as_bytes())
        );
        let request = ReplayRequestV2::try_from(ReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: opaque(&format!("owner-replay-request-{meaning}"))?,
            frozen_research_intent: named_content(
                &format!(
                    "rd-research-intent-v2-{}",
                    hex(plan.intent_identity().as_bytes())
                ),
                DigestAlgorithmV2::Sha256,
                plan.intent_digest(),
            )?,
            trial_family: content(binding(1), binding(2))?,
            trial_family_census_frontier: content(binding(3), binding(4))?,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            strategy_design: content(plan.design_identity(), plan.design_digest())?,
            strategy_plan: content(plan.canonical_plan_digest(), plan.canonical_plan_digest())?,
            artifact: named_content(
                &artifact_locator,
                DigestAlgorithmV2::Sha256,
                artifact.identity(),
            )?,
            resolved_owner_inputs: blake3_content(binding(5), frame_cut)?,
            pit_scope: blake3_content(binding(6), scope)?,
            pit_snapshot: blake3_content(snapshot_identity, snapshot_digest)?,
            universe_selection: blake3_content(binding(7), universe)?,
            correction_rule: blake3_version(correction)?,
            market_semantics: blake3_version(plan.market_semantics_identity())?,
            replay_configuration: content(binding(8), binding(9))?,
            models: ReplayModelProfilesV2 {
                runtime_kernel: version(binding(10))?,
                simulator: version(binding(11))?,
                cost: version(binding(12))?,
                slippage: version(binding(13))?,
                capacity: version(binding(14))?,
            },
            runner_operational_profile: version(binding(15))?,
            diagnostic_policy: version(binding(16))?,
            deterministic_seed: u64::from(meaning),
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 3,
            },
            calendar: version(binding(17))?,
            session: version(binding(18))?,
            time_zone: version(binding(19))?,
            corporate_action_cut: content(binding(20), binding(21))?,
            historical_membership_cut: blake3_content(binding(22), instrument_cut)?,
        })?;
        let request_bytes = request.to_canonical_bytes()?;
        let request_meaning = request.meaning_digest()?.as_str().to_owned();
        let request_locator = ExploratoryReplayRequestLocatorV2 {
            request_identity: request.request_identity().as_str().to_owned(),
            meaning_digest: request_meaning,
            receipt_identity: format!(
                "rd-exploratory-replay-receipt-v2-{}",
                hex(binding(23).as_bytes())
            ),
            seal_digest: format!("sha256:{}", hex(binding(24).as_bytes())),
        };
        let request_bytes_identity = canonical_blob_digest(
            b"rd.exploratory-replay-request.canonical-bytes.v2\0",
            &request_bytes,
        );
        let design_bytes = plan.canonical_design_durable_bytes();
        let plan_bytes = plan.durable_bytes();
        let artifact_package_bytes = artifact.durable_package_bytes();
        let module_bytes = artifact.private_module_bytes();
        let module_bytes_digests = module_bytes
            .iter()
            .map(|bytes| {
                canonical_blob_digest(b"rd.develop.artifact-module.canonical-bytes.v2\0", bytes)
            })
            .collect();
        let build_receipt_identities = plan
            .plugin_implementations()
            .iter()
            .map(|receipt| receipt.verified_build_receipt_digest())
            .collect::<Vec<_>>();
        let build_receipt_bytes = build_receipt_identities
            .iter()
            .map(|identity| identity.as_bytes().to_vec())
            .collect::<Vec<_>>();
        let build_receipt_bytes_digests = build_receipt_bytes
            .iter()
            .map(|bytes| {
                canonical_blob_digest(b"rd.develop.build-receipt.canonical-bytes.v2\0", bytes)
            })
            .collect();
        let composer_receipt_bytes = vec![meaning, 1];
        let host_receipt_bytes = vec![meaning, 2];
        let source_binding_lineage_root = plan
            .input_bindings()
            .first()
            .expect("prepared fixture has input bindings")
            .source_binding_lineage_root();
        let correction_stream_identity = plan
            .input_bindings()
            .first()
            .expect("prepared fixture has input bindings")
            .correction_stream_identity()
            .to_owned();
        let mut frame_meaning = meaning;
        let mut frames = Vec::new();

        for event in 1..=2 {
            for plan_binding in plan.input_bindings() {
                frames.push(FramePreparationProjectionV2 {
                    event_effective: event,
                    correction_publication: event,
                    correction_sequence: event,
                    instrument: plan_binding.instrument().to_owned(),
                    channel: plan_binding.channel().to_owned(),
                    data_kind: plan_binding.data_kind().to_owned(),
                    timeframe: plan_binding.timeframe().to_owned(),
                    field: MarketDataFieldSemantic::from_identity(plan_binding.field_semantic_id())
                        .expect("prepared binding has canonical field semantic")
                        .row_field()
                        .to_owned(),
                    scale: plan_binding.scale(),
                    member_key: "member-1".to_owned(),
                    digest: binding(frame_meaning),
                });
                frame_meaning = frame_meaning.wrapping_add(1);
            }
        }
        frames.sort();
        Ok((
            ProgramPreparationClaimsV2 {
                request,
                request_bytes,
                request_locator,
                request_bytes_identity,
                owner_cut_epoch_ms: 1,
                composer_research_request: plan.research_request_identity(),
                composer_intent: plan.intent_identity(),
                composer_design_identity: plan.design_identity(),
                composer_design_digest: plan.design_digest(),
                composer_plan_digest: plan.canonical_plan_digest(),
                composer_artifact_identity: artifact.identity(),
                composer_artifact_locator: artifact_locator,
                design_bytes_digest: canonical_blob_digest(
                    b"rd.develop.design.canonical-bytes.v2\0",
                    &design_bytes,
                ),
                design_bytes,
                plan_bytes_digest: canonical_blob_digest(
                    b"rd.develop.plan.canonical-bytes.v2\0",
                    &plan_bytes,
                ),
                plan_bytes,
                artifact_package_bytes_digest: canonical_blob_digest(
                    b"rd.develop.artifact-package.canonical-bytes.v2\0",
                    &artifact_package_bytes,
                ),
                artifact_package_bytes,
                module_bytes,
                module_bytes_digests,
                build_receipt_identities,
                build_receipt_bytes,
                build_receipt_bytes_digests,
                composer_receipt_bytes_digest: canonical_blob_digest(
                    b"rd.develop.composer-receipt.canonical-bytes.v2\0",
                    &composer_receipt_bytes,
                ),
                composer_receipt_bytes,
                host_receipt_bytes_digest: canonical_blob_digest(
                    b"rd.develop.host-receipt.canonical-bytes.v2\0",
                    &host_receipt_bytes,
                ),
                host_receipt_bytes,
                market: MarketPreparationProjectionV2 {
                    scope,
                    snapshot_identity,
                    snapshot_digest,
                    instrument_master: instrument_digest,
                    universe,
                    market_semantics: plan.market_semantics_identity(),
                    correction_rule: correction,
                    source_binding_lineage_root,
                    correction_stream_identity,
                    frame_cut,
                    observation_start: 1,
                    observation_end: 2,
                    frames,
                },
                instrument: InstrumentPreparationProjectionV1 {
                    digest: instrument_digest,
                    cut: instrument_cut,
                    expected_members: vec![instrument_text.clone()],
                    fact_members: vec![instrument_text],
                },
            },
            bindings,
        ))
    }

    fn binding(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn opaque(value: &str) -> anyhow::Result<OpaqueIdentityV2> {
        OpaqueIdentityV2::try_from(value.to_owned()).map_err(Into::into)
    }

    fn content(
        identity: BindingDigest,
        digest_value: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        binding_content(identity, DigestAlgorithmV2::Sha256, digest_value)
    }

    fn blake3_content(
        identity: BindingDigest,
        digest_value: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        binding_content(identity, DigestAlgorithmV2::Blake3, digest_value)
    }

    fn binding_content(
        identity: BindingDigest,
        algorithm: DigestAlgorithmV2,
        digest_value: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(&binding_text(algorithm, identity))?,
            digest: canonical_digest(algorithm, digest_value)?,
        })
    }

    fn version(identity: BindingDigest) -> anyhow::Result<VersionedIdentityV2> {
        binding_version(DigestAlgorithmV2::Sha256, identity)
    }

    fn blake3_version(identity: BindingDigest) -> anyhow::Result<VersionedIdentityV2> {
        binding_version(DigestAlgorithmV2::Blake3, identity)
    }

    fn binding_version(
        algorithm: DigestAlgorithmV2,
        identity: BindingDigest,
    ) -> anyhow::Result<VersionedIdentityV2> {
        Ok(VersionedIdentityV2 {
            identity: opaque(&binding_text(algorithm, identity))?,
            version: opaque("v2")?,
        })
    }

    fn named_content(
        identity: &str,
        algorithm: DigestAlgorithmV2,
        digest_value: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(identity)?,
            digest: canonical_digest(algorithm, digest_value)?,
        })
    }

    fn canonical_digest(
        algorithm: DigestAlgorithmV2,
        value: BindingDigest,
    ) -> anyhow::Result<CanonicalDigestV2> {
        CanonicalDigestV2::try_from(binding_text(algorithm, value)).map_err(Into::into)
    }

    fn binding_text(algorithm: DigestAlgorithmV2, value: BindingDigest) -> String {
        let algorithm = match algorithm {
            DigestAlgorithmV2::Sha256 => "sha256",
            DigestAlgorithmV2::Blake3 => "blake3",
        };
        format!("{algorithm}:{}", hex(value.as_bytes()))
    }
}
