//! Owner-sealed preparation for the existing ProgramHost/shared-kernel path.
//!
//! This boundary parses and revalidates the R&D-owned Plan and Artifact package against current
//! Market Data bindings. It deliberately stops before Backtest construction and makes no claim
//! about execution, actual consumption, diagnostics, terminals, or persisted results.

use crate::{
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    exploratory_replay::SealedExploratoryReplayReadbackV2,
    program_host_v2::{ProgramHostV2, ProgramHostV2Error},
    strategy_plan_v2::{BindingProjectionV2, StrategyPlanV2, VerifiedStrategyInputBindingsV2},
};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::ReplayRequestV2;
use vibe_data::owner::{
    instrument_master::{InstrumentMasterReadbackV1, verify_instrument_master_readback},
    sealed_replay_input::SealedReplayInput,
    source_binding::BindingDigest,
    strategy_input_binding::StrategyInputBindingReceipt,
};

const OWNER_SEMANTICS_VERSION_V2: &str = "v2";

/// Move-only ProgramHost preparation capability issued from complete Owner-sealed readbacks.
///
/// Its fields remain private, it implements neither `Clone` nor a Serde trait, and it retains the
/// move-only Market Data and Instrument Master evidence that justified preparation. Its sole
/// decomposition API consumes the capability, constructs the canonical [`ProgramHostV2`], and
/// atomically transfers the validated evidence to the future Backtest adapter.
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
///     let _first = value.into_program_host_parts_v2();
///     let _second = value.into_program_host_parts_v2();
/// }
/// ```
pub struct PreparedProgramHostCapabilityV2 {
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    replay_input: SealedReplayInput,
    instrument_master: InstrumentMasterReadbackV1,
    input_bindings: Vec<StrategyInputBindingReceipt>,
    binding: PreparedProgramBindingV2,
}

impl PreparedProgramHostCapabilityV2 {
    /// Consumes this capability into the canonical ProgramHost and its sealed Owner evidence.
    ///
    /// No raw Plan, Artifact, preparation claim, or private equality binding crosses this boundary.
    /// The returned evidence remains move-only and cannot be reconstructed by the caller.
    ///
    /// # Errors
    ///
    /// Returns [`ProgramHostV2Error`] if the already-revalidated Plan and Artifact cannot construct
    /// the canonical host. On error, no partial handoff remains available to the caller.
    pub fn into_program_host_parts_v2(
        self,
    ) -> Result<
        (
            ProgramHostV2,
            SealedReplayInput,
            InstrumentMasterReadbackV1,
            Vec<StrategyInputBindingReceipt>,
        ),
        ProgramHostV2Error,
    > {
        let Self {
            plan,
            artifact,
            replay_input,
            instrument_master,
            input_bindings,
            binding,
        } = self;
        let host = construct_prepared_program_host_v2(plan, artifact)?;
        drop(binding);
        Ok((host, replay_input, instrument_master, input_bindings))
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
    request_meaning: String,
    plan: BindingDigest,
    artifact: BindingDigest,
    market_frame_cut: BindingDigest,
    instrument_cut: BindingDigest,
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
    let (plan, artifact, binding) = prepare_program_package_v2(&claims, verified_bindings)?;
    Ok(PreparedProgramHostCapabilityV2 {
        plan,
        artifact,
        replay_input,
        instrument_master,
        input_bindings,
        binding,
    })
}

struct ProgramPreparationClaimsV2 {
    request: ReplayRequestV2,
    request_bytes: Vec<u8>,
    request_meaning: String,
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
            request_meaning: replay.meaning_digest().to_owned(),
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
    validate_market_and_instrument_equality(claims, &plan)?;

    Ok((
        plan,
        artifact,
        PreparedProgramBindingV2 {
            request_meaning: claims.request_meaning.clone(),
            plan: claims.composer_plan_digest,
            artifact: claims.composer_artifact_identity,
            market_frame_cut: claims.market.frame_cut,
            instrument_cut: claims.instrument.cut,
        },
    ))
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
        || canonical != claims.request_bytes
        || meaning.as_str() != claims.request_meaning
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
) -> Result<(), ProgramPreparationFaultV2> {
    let request = claims.request.as_dto();
    let expected_end = claims
        .market
        .observation_end
        .checked_add(1)
        .ok_or(ProgramPreparationFaultV2::OwnerMismatch)?;

    if claims.market.frames.is_empty()
        || claims.market.observation_start != request.window.start_event_ns
        || expected_end != request.window.end_event_ns_exclusive
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
        && frame.field == binding.field_semantic_id()
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
    use vibe_model::instruments::{Instrument, stubs::crypto_perpetual_ethusdt};

    use super::*;
    use crate::program_host_v2_backtest_tests::preparation_fixture;

    #[rstest]
    fn two_owner_meanings_prepare_through_one_program_boundary() {
        let (first, first_bindings) = claims(71).expect("first complete Owner meaning");
        let (second, second_bindings) = claims(91).expect("second complete Owner meaning");
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
        assert_ne!(first.request_meaning, second.request_meaning);
        assert_ne!(first.plan, second.plan);
        assert_ne!(first.artifact, second.artifact);
        assert_ne!(first.market_frame_cut, second.market_frame_cut);
        assert_ne!(first.instrument_cut, second.instrument_cut);
        assert_ne!(first_host.host_identity(), second_host.host_identity());
    }

    #[rstest]
    fn every_owner_cut_cross_splice_fails_before_a_capability_exists() {
        for mutation in 0..28 {
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
                19 => claims.request_meaning.push('0'),
                20 => claims.composer_artifact_locator.push('0'),
                21 => claims.market.source_binding_lineage_root = different,
                22 => claims.market.correction_stream_identity.push('0'),
                23 => claims.market.frames[0].field.push('0'),
                24 => claims.market.frames[0].channel.push('0'),
                25 => claims.market.frames[0].timeframe.push('0'),
                26 => claims.market.frames[0].scale = 3,
                27 => claims.market.frames[0].data_kind.push('0'),
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
        semantics_splice.request_meaning = semantics_splice
            .request
            .meaning_digest()
            .expect("sealed request B meaning")
            .as_str()
            .to_owned();
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
            claims.request_meaning = claims
                .request
                .meaning_digest()
                .expect("version-spliced request meaning")
                .as_str()
                .to_owned();

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
        claims.request_meaning = claims
            .request
            .meaning_digest()
            .expect("request meaning")
            .as_str()
            .to_owned();

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
                    field: plan_binding.field_semantic_id().to_owned(),
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
                request_meaning,
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
