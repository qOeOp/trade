use std::collections::BTreeMap;

use vibe_strategy_factory::{
    StatefulBacktestNativeReplayEvidenceV2, run_stateful_backtest_native_replay_v2 as run_engine,
};

use crate::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ConsumedComponentObservationV2,
    ContentIdentityV2, DiagnosticCategoryV2, DiagnosticEvidenceV2, ObservationComponentV2,
    OpaqueIdentityV2, OwnerResultDraftV2, ReplayAuthorityClaimV2, ReplayModelProfilesV2,
    ReplayOwnerErrorV2, ReplayRequestDtoV2, ReplayRequestV2, ReplayTerminalV2, ReplayWindowV2,
    SealedReplayResultV2, VersionedIdentityV2, commit_owner_result, requested_component_meanings,
};

struct NativeReplayExecutionV2 {
    attempt_identity: OpaqueIdentityV2,
    observations: Vec<ConsumedComponentObservationV2>,
    diagnostic: DiagnosticEvidenceV2,
    lifecycle: BTreeMap<&'static str, usize>,
    native_fill_count: usize,
    owner_input_cut: Option<[u8; 32]>,
    canonical_execution: Vec<u8>,
}

/// Runs the sealed deterministic stateful-trend corpus through the real ProgramHost, shared
/// lifecycle kernel, Backtest engine and Sim Exchange, then commits only engine-observed evidence.
///
/// # Errors
///
/// Fails closed when execution is unavailable, its lifecycle/fills/input cut are incomplete, or
/// the request does not exactly match the independently admitted Native Replay facts.
pub fn run_stateful_trend_native_replay_v2(
    request: &ReplayRequestV2,
) -> Result<SealedReplayResultV2, ReplayOwnerErrorV2> {
    let execution = execute_native_replay(request, false)?;
    commit_execution(request, execution)
}

fn execute_native_replay(
    request: &ReplayRequestV2,
    restore: bool,
) -> Result<NativeReplayExecutionV2, ReplayOwnerErrorV2> {
    let evidence = run_engine(restore).map_err(|e| {
        ReplayOwnerErrorV2::CanonicalEncodingUnavailable(format!(
            "stateful Native Replay unavailable: {e:#}"
        ))
    })?;
    let expected = admitted_request(&evidence)?;
    let actual = requested_component_meanings(&expected)?;
    let request_meaning_digest = request
        .meaning_digest()
        .map_err(|e| super::contract_error(&e))?;
    let execution_digest = digest_bytes(
        "vibe.backtest.native-replay.execution.v2",
        evidence.canonical_execution_bytes(),
    )?;
    let attempt_identity = identity(&format!(
        "backtest-native-replay-attempt-v2-{}",
        execution_digest.as_str().trim_start_matches("blake3:")
    ))?;
    let mut observations = actual
        .into_iter()
        .map(|(component, meaning)| {
            let locator = locator(component, meaning.digest.clone())?;
            Ok(ConsumedComponentObservationV2 {
                request_identity: request.request_identity().clone(),
                request_meaning_digest: request_meaning_digest.clone(),
                attempt_identity: attempt_identity.clone(),
                component,
                locator,
                observed_meaning_identity: meaning.identity,
                observed_meaning_digest: meaning.digest,
            })
        })
        .collect::<Result<Vec<_>, ReplayOwnerErrorV2>>()?;
    let semantic_trace_digest = digest_bytes(
        "vibe.backtest.native-replay.semantic-trace.v2",
        evidence.canonical_execution_bytes(),
    )?;
    let semantic_locator = locator(
        ObservationComponentV2::SemanticTrace,
        semantic_trace_digest.clone(),
    )?;
    observations.push(ConsumedComponentObservationV2 {
        request_identity: request.request_identity().clone(),
        request_meaning_digest: request_meaning_digest.clone(),
        attempt_identity: attempt_identity.clone(),
        component: ObservationComponentV2::SemanticTrace,
        locator: semantic_locator.clone(),
        observed_meaning_identity: identity("stateful-trend-native-semantic-trace-v2")?,
        observed_meaning_digest: semantic_trace_digest,
    });
    let lifecycle = ["START", "BAR", "FILL", "STOP"]
        .into_iter()
        .map(|kind| (kind, evidence.lifecycle_count(kind)))
        .collect();
    Ok(NativeReplayExecutionV2 {
        attempt_identity: attempt_identity.clone(),
        observations,
        diagnostic: DiagnosticEvidenceV2 {
            request_identity: request.request_identity().clone(),
            request_meaning_digest,
            attempt_identity,
            category: DiagnosticCategoryV2::NoExecutionDefect,
            decisive_evidence: semantic_locator,
        },
        lifecycle,
        native_fill_count: evidence.native_fill_count(),
        owner_input_cut: Some(evidence.owner_input_cut()),
        canonical_execution: evidence.canonical_execution_bytes().to_vec(),
    })
}

fn commit_execution(
    request: &ReplayRequestV2,
    execution: NativeReplayExecutionV2,
) -> Result<SealedReplayResultV2, ReplayOwnerErrorV2> {
    for kind in ["START", "BAR", "FILL", "STOP"] {
        if execution.lifecycle.get(kind).copied().unwrap_or_default() == 0 {
            return Err(ReplayOwnerErrorV2::MissingLifecycle(kind));
        }
    }

    if execution.native_fill_count == 0 {
        return Err(ReplayOwnerErrorV2::MissingNativeFill);
    }

    if execution.owner_input_cut.is_none_or(|cut| cut == [0; 32]) {
        return Err(ReplayOwnerErrorV2::MissingOwnerInputCut);
    }

    if execution.canonical_execution.is_empty() {
        return Err(ReplayOwnerErrorV2::IncompleteObservationCensus);
    }
    commit_owner_result(
        request,
        OwnerResultDraftV2 {
            attempt_identity: execution.attempt_identity,
            terminal: ReplayTerminalV2::TerminalResult,
            observations: execution.observations,
            diagnostics: vec![execution.diagnostic],
        },
    )
}

fn admitted_request(
    evidence: &StatefulBacktestNativeReplayEvidenceV2,
) -> Result<ReplayRequestV2, ReplayOwnerErrorV2> {
    ReplayRequestV2::try_from(ReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: identity("stateful-trend-native-replay-request-v2")?,
        frozen_research_intent: content("stateful-trend-research-intent-v2", fixed_digest('b')?),
        trial_family: content("stateful-trend-trial-family-v2", fixed_digest('c')?),
        trial_family_census_frontier: content(
            "stateful-trend-census-frontier-v2",
            fixed_digest('d')?,
        ),
        replay_authority: ReplayAuthorityClaimV2::Exploratory,
        strategy_design: content(
            "stateful-trend-strategy-design-v2",
            digest_array(evidence.design_digest())?,
        ),
        strategy_plan: content(
            "stateful-trend-strategy-plan-v2",
            digest_array(evidence.plan_digest())?,
        ),
        artifact: content(
            "stateful-trend-strategy-artifact-v2",
            digest_array(evidence.artifact_digest())?,
        ),
        resolved_owner_inputs: content(
            "stateful-trend-owner-input-cut-v2",
            digest_array(evidence.owner_input_cut())?,
        ),
        pit_scope: content("stateful-trend-pit-scope-v2", fixed_digest('4')?),
        pit_snapshot: content("stateful-trend-pit-snapshot-v2", fixed_digest('5')?),
        universe_selection: content("stateful-trend-universe-v2", fixed_digest('6')?),
        correction_rule: version("stateful-trend-correction-rule", "v2")?,
        market_semantics: version("stateful-trend-market-semantics", "v2")?,
        replay_configuration: content("stateful-trend-replay-config-v2", fixed_digest('7')?),
        models: ReplayModelProfilesV2 {
            runtime_kernel: version("strategy-shared-lifecycle-kernel", "v1")?,
            simulator: version("vibe-sim-exchange", "v1")?,
            cost: version("vibe-maker-taker-instrument-fee-model", "v1")?,
            slippage: version("stateful-trend-book-fill-model", "v1")?,
            capacity: version("stateful-trend-bounded-capacity-model", "v1")?,
        },
        runner_operational_profile: version("backtest-native-runner", "v2")?,
        diagnostic_policy: version("backtest-diagnostic-policy", "v2")?,
        deterministic_seed: 7,
        window: ReplayWindowV2 {
            start_event_ns: 1_000_000_000,
            end_event_ns_exclusive: 9_000_000_000,
        },
        calendar: version("continuous-crypto-calendar", "v1")?,
        session: version("continuous-crypto-session", "v1")?,
        time_zone: version("utc", "v1")?,
        corporate_action_cut: content("no-corporate-actions-cut", fixed_digest('8')?),
        historical_membership_cut: content("ethusdt-membership-cut", fixed_digest('9')?),
    })
    .map_err(|e| super::contract_error(&e))
}

fn content(identity_text: &str, digest: CanonicalDigestV2) -> ContentIdentityV2 {
    ContentIdentityV2 {
        identity: OpaqueIdentityV2::try_from(identity_text.to_owned())
            .expect("fixed Native Replay content identity is valid"),
        digest,
    }
}

fn version(
    identity_text: &str,
    version_text: &str,
) -> Result<VersionedIdentityV2, ReplayOwnerErrorV2> {
    Ok(VersionedIdentityV2 {
        identity: identity(identity_text)?,
        version: identity(version_text)?,
    })
}

fn identity(value: &str) -> Result<OpaqueIdentityV2, ReplayOwnerErrorV2> {
    OpaqueIdentityV2::try_from(value.to_owned()).map_err(|e| super::contract_error(&e))
}

fn fixed_digest(byte: char) -> Result<CanonicalDigestV2, ReplayOwnerErrorV2> {
    CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
        .map_err(|e| super::contract_error(&e))
}

fn digest_array(bytes: [u8; 32]) -> Result<CanonicalDigestV2, ReplayOwnerErrorV2> {
    CanonicalDigestV2::try_from(format!("sha256:{}", hex(&bytes)))
        .map_err(|e| super::contract_error(&e))
}

fn digest_bytes(domain: &str, bytes: &[u8]) -> Result<CanonicalDigestV2, ReplayOwnerErrorV2> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(|e| super::contract_error(&e))
}

fn locator(
    component: ObservationComponentV2,
    digest: CanonicalDigestV2,
) -> Result<ComponentObservationLocatorV2, ReplayOwnerErrorV2> {
    Ok(ComponentObservationLocatorV2 {
        component,
        reference: identity(&format!("native-replay-observation-{component:?}"))?,
        digest,
    })
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(TABLE[(byte >> 4) as usize] as char);
        output.push(TABLE[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn request() -> ReplayRequestV2 {
        let evidence = run_engine(false).expect("stateful Backtest fixture must run");
        admitted_request(&evidence).expect("admitted request fixture must validate")
    }

    #[rstest]
    fn native_replay_commits_actual_consumption_and_is_restart_repeat_stable() {
        let request = request();
        let first = execute_native_replay(&request, false).expect("native replay must execute");
        assert_eq!(first.lifecycle.get("START"), Some(&1));
        assert_eq!(first.lifecycle.get("BAR"), Some(&8));
        assert!(first.lifecycle.get("FILL").is_some_and(|count| *count > 0));
        assert_eq!(first.lifecycle.get("STOP"), Some(&1));
        assert!(first.native_fill_count > 0);
        assert!(first.owner_input_cut.is_some_and(|cut| cut != [0; 32]));
        let first = commit_execution(&request, first)
            .expect("complete engine observations must commit")
            .to_canonical_bytes()
            .expect("sealed result must encode");
        let restored = commit_execution(
            &request,
            execute_native_replay(&request, true).expect("restored native replay must execute"),
        )
        .expect("restored observations must commit")
        .to_canonical_bytes()
        .expect("restored sealed result must encode");
        let repeated = run_stateful_trend_native_replay_v2(&request)
            .expect("repeat native replay must commit")
            .to_canonical_bytes()
            .expect("repeat sealed result must encode");
        assert_eq!(first, restored);
        assert_eq!(first, repeated);
    }

    #[rstest]
    fn changed_request_without_rerun_cannot_commit_stale_execution() {
        let original = request();
        let execution =
            execute_native_replay(&original, false).expect("native replay must execute");
        let mut changed = original.as_dto().clone();
        changed.models.cost.version = identity("v2").expect("version identity");
        let changed = ReplayRequestV2::try_from(changed).expect("changed request remains valid");
        assert_eq!(
            commit_execution(&changed, execution).expect_err("stale execution must fail"),
            ReplayOwnerErrorV2::ObservationRequestBindingMismatch
        );
    }

    #[rstest]
    fn missing_stop_fill_or_owner_input_cut_cannot_commit_positive_result() {
        let request = request();
        let mut missing_stop =
            execute_native_replay(&request, false).expect("native replay must execute");
        missing_stop.lifecycle.insert("STOP", 0);
        assert_eq!(
            commit_execution(&request, missing_stop).expect_err("STOP is required"),
            ReplayOwnerErrorV2::MissingLifecycle("STOP")
        );

        let mut missing_fill =
            execute_native_replay(&request, false).expect("native replay must execute");
        missing_fill.native_fill_count = 0;
        assert_eq!(
            commit_execution(&request, missing_fill).expect_err("native fill is required"),
            ReplayOwnerErrorV2::MissingNativeFill
        );

        let mut missing_cut =
            execute_native_replay(&request, false).expect("native replay must execute");
        missing_cut.owner_input_cut = None;
        assert_eq!(
            commit_execution(&request, missing_cut).expect_err("Owner input cut is required"),
            ReplayOwnerErrorV2::MissingOwnerInputCut
        );
    }
}
