//! Strategy Factory composition of the Owner inputs a native Replay execution is built from.
//!
//! This module has two entry points because a caller can hold the Owner readbacks without yet
//! holding the values a run consumes. `prepare_native_replay_execution_prerequisites_v2` stops at
//! a move-only, request-bound prerequisite cut: the verified profile authority and every retained
//! Owner readback, which is not an execution bundle and cannot be presented to the EVENT consumer
//! as one. `compose_native_replay_execution_bundle_v2` goes on, because Market Data does expose
//! the canonical native projection: `NativeReplaySchedulingReadbackV1` releases the `BarType` and
//! ordered `Data` of its window, and the members' public terms materialize the `InstrumentAny`.

use thiserror::Error;

use vibe_data::owner::{
    instrument_economic_terms_v1::InstrumentEconomicTermsReadbackV1,
    instrument_master::{InstrumentMasterReadbackV1, verify_instrument_master_readback},
    instrument_master_v2::ValidatedCryptoPerpetualPublicTermsV2,
    native_replay_scheduling_v1::UntrustedNativeReplaySchedulingRequestV1,
    native_replay_scheduling_v2::NativeReplayFrameSequenceReadbackV2,
    replay_market_facts_v2::{
        ReplayCompositionBindingReadbackV1, ReplayMarketDependencyKindV2,
        ReplayMarketFactsReadbackV2, ResolvedReplayCompositionCutV1,
        verify_replay_market_facts_readback_v2,
    },
    source_binding::BindingDigest,
};
use vibe_model::identifiers::StrategyId;

use crate::{
    artifact_v2::StrategyArtifactV2,
    native_replay_preparation_inputs_v2::NativeReplayPreparationInputsV2,
    program_host_v2::OwnerUniverseFrameV1,
    replay_execution_profile_binding_v1::{
        OwnerIssuedReplayExecutionProfileBindingV1,
        issue_owner_replay_execution_profile_binding_from_readbacks_v1,
    },
    replay_target_set_execution_bundle_v1::ReplayTargetSetExecutionBundleV1,
    strategy_plan_v2::StrategyPlanV2,
    target_set_members::is_admitted_member_count,
};

/// Move-only complete prerequisite cut immediately below native value materialization.
pub struct NativeReplayExecutionPrerequisitesV2 {
    preparation: NativeReplayPreparationInputsV2,
    market_facts: ReplayMarketFactsReadbackV2,
    composition: ReplayCompositionBindingReadbackV1,
    instrument_master: InstrumentMasterReadbackV1,
    profile_authority: OwnerIssuedReplayExecutionProfileBindingV1,
}

impl NativeReplayExecutionPrerequisitesV2 {
    #[must_use]
    pub fn request_locator(&self) -> &crate::exploratory_replay::ExploratoryReplayRequestLocatorV2 {
        self.profile_authority.request_locator()
    }

    #[must_use]
    pub const fn profile_authority_digest(&self) -> [u8; 32] {
        self.profile_authority.authority_digest()
    }

    #[must_use]
    pub const fn market_facts(&self) -> &ReplayMarketFactsReadbackV2 {
        &self.market_facts
    }

    #[must_use]
    pub const fn composition(&self) -> &ReplayCompositionBindingReadbackV1 {
        &self.composition
    }

    #[must_use]
    pub const fn instrument_master(&self) -> &InstrumentMasterReadbackV1 {
        &self.instrument_master
    }

    /// The retained R&D/Composer input remains inseparable until a native projection is available.
    #[must_use]
    pub const fn preparation(&self) -> &NativeReplayPreparationInputsV2 {
        &self.preparation
    }

    fn into_profile_authority(self) -> OwnerIssuedReplayExecutionProfileBindingV1 {
        self.profile_authority
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum NativeReplayExecutionPrerequisitesErrorV2 {
    #[error("Native Replay Owner input binding is unavailable")]
    OwnerBindingUnavailable,
    #[error("Native Replay execution profile authority is unavailable: {0}")]
    ProfileAuthorityUnavailable(String),
    #[error("Market Data has not issued canonical ordered native scheduling data")]
    NativeSchedulingDataUnavailable,
    #[error("Native Replay execution bundle composition is unavailable: {0}")]
    ExecutionBundleUnavailable(String),
    /// The Replay composition cut has no Instrument Master, because its binding is of the
    /// universe-member shape; these prerequisites bind only the exact-instrument first corpus.
    #[error(
        "the Replay composition cut is of the universe-member shape and has no Instrument Master"
    )]
    InstrumentMasterAbsentForUniverseShape,
}

/// Resolves persistent Market Data scheduling custody and composes the exact Sim execution bundle.
///
/// The untrusted request supplies lookup coordinates only. Market Data resolves and verifies the
/// complete PIT batch and both BAR schedules before Strategy Factory can consume its move-only
/// native scheduling readback together with the already-bound profile authority.
#[allow(clippy::too_many_arguments)]
pub async fn compose_native_replay_execution_bundle_v2(
    prerequisites: NativeReplayExecutionPrerequisitesV2,
    scheduling_request: &UntrustedNativeReplaySchedulingRequestV1,
    universe_frames: Vec<OwnerUniverseFrameV1>,
    sequence: NativeReplayFrameSequenceReadbackV2,
    plan: StrategyPlanV2,
    artifact: StrategyArtifactV2,
    strategy_id: StrategyId,
    run_id: String,
    public_terms: Vec<ValidatedCryptoPerpetualPublicTermsV2>,
) -> Result<ReplayTargetSetExecutionBundleV1, NativeReplayExecutionPrerequisitesErrorV2> {
    let request_window = prerequisites.profile_authority.request_window();
    if scheduling_request.frame_time_ns() != request_window.start_event_ns
        || scheduling_request.window_end_ns_exclusive() != request_window.end_event_ns_exclusive
    {
        return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
    }
    ReplayTargetSetExecutionBundleV1::new(
        prerequisites.into_profile_authority(),
        plan,
        artifact,
        universe_frames,
        strategy_id,
        run_id,
        public_terms,
        sequence,
    )
    // `new` returns `anyhow::Result`, so what arrives here is a chain with context, and `{:#}`
    // keeps the whole chain rather than only its outermost message. This is the one discard on
    // this path that was throwing away a diagnosis someone had already written.
    .map_err(|e| {
        NativeReplayExecutionPrerequisitesErrorV2::ExecutionBundleUnavailable(format!("{e:#}"))
    })
}

/// Cross-binds all currently available Owner readbacks and issues the execution-profile authority.
///
/// A successful return proves the exact request, Composer Design, Replay window, PIT cut,
/// Universe/Instrument dependency, Instrument Master cut of the admitted members, and private
/// economic terms.
/// It deliberately does not return `ReplayTargetSetExecutionBundleV1`, because a caller that holds
/// these readbacks has not yet resolved the window's native scheduling; that is the step
/// `compose_native_replay_execution_bundle_v2` takes, from this same cut.
pub fn prepare_native_replay_execution_prerequisites_v2(
    preparation: NativeReplayPreparationInputsV2,
    replay_cut: ResolvedReplayCompositionCutV1,
    instrument_terms: &[InstrumentEconomicTermsReadbackV1],
) -> Result<NativeReplayExecutionPrerequisitesV2, NativeReplayExecutionPrerequisitesErrorV2> {
    let (composition, market_facts, instrument_master) = replay_cut.into_parts();
    // A universe-member cut binds no Instrument Master; until these prerequisites handle that
    // shape they refuse it by this name, so the refusal is findable and says why.
    let instrument_master = instrument_master
        .ok_or(NativeReplayExecutionPrerequisitesErrorV2::InstrumentMasterAbsentForUniverseShape)?;
    validate_available_owner_bindings(
        &preparation,
        &market_facts,
        &composition,
        &instrument_master,
        instrument_terms,
    )?;
    let profile_authority = issue_owner_replay_execution_profile_binding_from_readbacks_v1(
        preparation.family(),
        preparation.replay(),
        &instrument_terms.iter().collect::<Vec<_>>(),
    )
    .map_err(|e| {
        NativeReplayExecutionPrerequisitesErrorV2::ProfileAuthorityUnavailable(e.to_string())
    })?;
    Ok(NativeReplayExecutionPrerequisitesV2 {
        preparation,
        market_facts,
        composition,
        instrument_master,
        profile_authority,
    })
}

fn validate_available_owner_bindings(
    preparation: &NativeReplayPreparationInputsV2,
    market_facts: &ReplayMarketFactsReadbackV2,
    composition: &ReplayCompositionBindingReadbackV1,
    instrument_master: &InstrumentMasterReadbackV1,
    instrument_terms: &[InstrumentEconomicTermsReadbackV1],
) -> Result<(), NativeReplayExecutionPrerequisitesErrorV2> {
    let request = preparation.replay().request().as_dto();
    let facts = market_facts.facts();
    let request_window = &request.window;
    let expected_pit_scope_identity = parse_digest(request.pit_scope.identity.as_str())?;
    let expected_pit_scope_digest = parse_digest(request.pit_scope.digest.as_str())?;
    let expected_pit_snapshot_identity = parse_digest(request.pit_snapshot.identity.as_str())?;
    let expected_pit_snapshot_digest = parse_digest(request.pit_snapshot.digest.as_str())?;
    let expected_design_identity = parse_digest(request.strategy_design.identity.as_str())?;
    let expected_universe_identity = parse_digest(request.universe_selection.identity.as_str())?;
    let expected_universe_digest = parse_digest(request.universe_selection.digest.as_str())?;

    if !verify_replay_market_facts_readback_v2(market_facts)
        || !verify_instrument_master_readback(instrument_master)
        || !exact_content_matches(
            facts.request_identity(),
            facts.request_digest(),
            expected_pit_scope_identity,
            expected_pit_scope_digest,
        )
        || !exact_content_matches(
            facts.pit_snapshot_identity(),
            facts.pit_fact_digest(),
            expected_pit_snapshot_identity,
            expected_pit_snapshot_digest,
        )
        || facts.replay_start_event_ns() != i128::from(request_window.start_event_ns)
        || facts.replay_end_event_ns_exclusive()
            != i128::from(request_window.end_event_ns_exclusive)
        || composition.record().strategy_design_identity() != expected_design_identity
        || composition.record().role_count() == 0
        || instrument_master.cut().effective_instant() != i128::from(request_window.start_event_ns)
    {
        return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
    }

    let instrument_dependency =
        unique_dependency(facts, ReplayMarketDependencyKindV2::InstrumentMasterCutV1)?;
    let universe_dependency =
        unique_dependency(facts, ReplayMarketDependencyKindV2::UniverseSelectionV1)?;

    if instrument_dependency.identity() != instrument_master.cut().identity()
        || instrument_dependency.digest() != instrument_master.cut().digest()
        || universe_dependency.identity() != expected_universe_identity
        || universe_dependency.digest() != expected_universe_digest
        || !is_admitted_member_count(instrument_master.facts().len())
        || instrument_master.cut().expected_members().len() != instrument_master.facts().len()
        || instrument_terms.len() != instrument_master.facts().len()
    {
        return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
    }

    for ((member, fact), terms) in instrument_master
        .cut()
        .expected_members()
        .iter()
        .zip(instrument_master.facts())
        .zip(instrument_terms)
    {
        let terms_input = terms.fact().input();
        if member != fact.canonical_identity()
            || terms_input.instrument_identity.as_str() != member.as_str()
            || terms_input.instrument_public_fact_digest != *fact.identity().as_bytes()
            || !terms.verify()
        {
            return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
        }
    }
    Ok(())
}

fn exact_content_matches(
    identity: BindingDigest,
    digest: BindingDigest,
    expected_identity: BindingDigest,
    expected_digest: BindingDigest,
) -> bool {
    identity == expected_identity && digest == expected_digest
}

fn unique_dependency(
    facts: &vibe_data::owner::replay_market_facts_v2::ReplayMarketFactsV2,
    kind: ReplayMarketDependencyKindV2,
) -> Result<
    &vibe_data::owner::replay_market_facts_v2::ReplayMarketDependencyRefV2,
    NativeReplayExecutionPrerequisitesErrorV2,
> {
    let mut matches = facts
        .frontier()
        .dependencies()
        .iter()
        .filter(|dependency| dependency.kind() == kind);
    let value = matches
        .next()
        .ok_or(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)?;
    if matches.next().is_some() {
        return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
    }
    Ok(value)
}

fn parse_digest(value: &str) -> Result<BindingDigest, NativeReplayExecutionPrerequisitesErrorV2> {
    let hex = value
        .strip_prefix("sha256:")
        .or_else(|| value.strip_prefix("blake3:"))
        .ok_or(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)?;
    let hex = hex.as_bytes();
    if hex.len() != 64
        || !hex
            .iter()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable);
    }
    let mut bytes = [0_u8; 32];
    for (output, pair) in bytes.iter_mut().zip(hex.chunks_exact(2)) {
        let decode = |byte| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => unreachable!("canonical hexadecimal bytes were checked above"),
        };
        *output = (decode(pair[0]) << 4) | decode(pair[1]);
    }
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[rstest::rstest]
    fn digest_parser_rejects_missing_and_noncanonical_inputs() {
        assert_eq!(
            parse_digest("pit-snapshot"),
            Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)
        );
        assert_eq!(
            parse_digest("sha256:00"),
            Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)
        );
        assert_eq!(
            parse_digest(&format!("sha256:€{}", "0".repeat(61))),
            Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)
        );
        assert_eq!(
            parse_digest(&format!("sha256:A{}", "0".repeat(63))),
            Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)
        );
        assert_eq!(
            parse_digest(&format!("sha256:g{}", "0".repeat(63))),
            Err(NativeReplayExecutionPrerequisitesErrorV2::OwnerBindingUnavailable)
        );
        assert!(parse_digest(&format!("blake3:{}", "01".repeat(32))).is_ok());
    }

    #[rstest::rstest]
    fn cross_spliced_identity_and_digest_are_rejected() {
        let first = BindingDigest::from_untrusted_bytes([1; 32]);
        let second = BindingDigest::from_untrusted_bytes([2; 32]);
        assert!(exact_content_matches(first, second, first, second));
        assert!(!exact_content_matches(first, second, second, first));
    }
}
