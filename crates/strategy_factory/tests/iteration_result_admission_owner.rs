//! Public caller seam for R&D admission of one exact Backtest Result.
//!
//! Everything a Product Edge or Owner API caller can reach lives here: the operation names it binds,
//! the exact request shape it may mint, and the refusals it must expect. The admission itself, its
//! receipt, and its readback are Owner-issued and are unreachable from this seam.

use rstest::rstest;
use vibe_strategy_factory::{
    IterationExperimentModeV1, IterationHypothesisDimensionV1,
    iteration_result_admission::{
        ITERATION_RESULT_ADMISSION_MUTATION_EFFECT_V1, ITERATION_RESULT_ADMISSION_OPERATION_V1,
        ITERATION_RESULT_ADMISSION_SCHEMA_V1, ITERATION_RESULT_ADMITTED_EVENT_V1,
        IterationResultAdmissionErrorV1, IterationResultAdmissionLocatorV1,
        IterationResultAdmissionOperationRequestV1, IterationResultCandidateProposalSetV1,
        IterationResultCandidateProposalV1,
    },
};

fn sha(byte: char) -> String {
    format!("sha256:{}", byte.to_string().repeat(64))
}

fn blake(byte: char) -> String {
    format!("blake3:{}", byte.to_string().repeat(64))
}

fn request_json() -> serde_json::Value {
    serde_json::json!({
        "locator": {
            "trial_family_identity": "rd-trial-family-1",
            "result_identity": "backtest-result-1",
            "request_identity": "exploratory-request-1",
            "attempt_identity": "backtest-attempt-1"
        },
        "result_digest": blake('3'),
        "request_meaning_digest": blake('2'),
        "proposals": {
            "generation_rule_identity": "rd-generation-rule-1",
            "generation_rule_digest": sha('4'),
            "expected_cardinality": 2,
            "proposals": [
                {
                    "candidate_identity": "candidate-1",
                    "candidate_digest": sha('1'),
                    "experiment": {"mode": "SINGLE_DIMENSION", "changed_dimension": "RETURN_MECHANISM"}
                },
                {
                    "candidate_identity": "candidate-2",
                    "candidate_digest": sha('2'),
                    "experiment": {"mode": "SINGLE_DIMENSION", "changed_dimension": "ENTRY_RULE"}
                }
            ]
        }
    })
}

fn request() -> IterationResultAdmissionOperationRequestV1 {
    serde_json::from_value(request_json()).expect("exact caller request shape")
}

#[rstest]
fn the_operation_event_schema_and_effect_names_are_frozen() {
    assert_eq!(
        ITERATION_RESULT_ADMISSION_OPERATION_V1,
        "iteration_result_admission.admit.v1"
    );
    assert_eq!(
        ITERATION_RESULT_ADMISSION_SCHEMA_V1,
        "rd-iteration-result-admission-v1"
    );
    assert_eq!(
        ITERATION_RESULT_ADMITTED_EVENT_V1,
        "RD_ITERATION_RESULT_ADMITTED_V1"
    );
    assert_eq!(
        ITERATION_RESULT_ADMISSION_MUTATION_EFFECT_V1,
        "R_AND_D_ITERATION_RESULT_ADMISSION_MUTATION_V1"
    );
}

#[rstest]
fn the_caller_request_round_trips_through_exactly_one_canonical_shape() {
    let request = request();
    assert!(request.validate().is_ok());
    assert_eq!(
        serde_json::to_value(&request).expect("request JSON"),
        request_json()
    );
    assert_eq!(request.locator.result_identity, "backtest-result-1");
    assert_eq!(request.proposals.expected_cardinality, 2);
    assert_eq!(
        request.proposals.proposals[1].experiment,
        IterationExperimentModeV1::SingleDimension {
            changed_dimension: IterationHypothesisDimensionV1::EntryRule,
        }
    );
}

#[rstest]
#[case::unknown_request_field("admission_identity")]
#[case::unknown_owner_field("budget")]
fn the_caller_cannot_widen_the_request_with_an_owner_field(#[case] field: &str) {
    let mut widened = request_json();
    widened[field] = serde_json::json!("rd-forged-owner-fact");
    assert!(serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(widened).is_err());
}

#[rstest]
fn the_caller_cannot_supply_owner_evidence_inside_the_proposal_set() {
    let mut widened = request_json();
    widened["proposals"]["candidate_set_frontier_digest"] = serde_json::json!(sha('6'));
    assert!(serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(widened).is_err());

    let mut widened = request_json();
    widened["proposals"]["proposals"][0]["admissibility"] =
        serde_json::json!({"status": "ADMISSIBLE_ABOVE_THRESHOLD"});
    assert!(serde_json::from_value::<IterationResultAdmissionOperationRequestV1>(widened).is_err());
}

#[rstest]
fn a_misordered_or_duplicated_proposal_set_is_refused_before_any_owner_read() {
    let mut misordered = request();
    misordered.proposals.proposals.swap(0, 1);
    assert!(matches!(
        misordered.validate(),
        Err(IterationResultAdmissionErrorV1::NotApplicable)
    ));

    let mut duplicated = request();
    duplicated.proposals.proposals[1].candidate_identity = "candidate-1".to_owned();
    assert!(matches!(
        duplicated.validate(),
        Err(IterationResultAdmissionErrorV1::NotApplicable)
    ));
}

#[rstest]
fn an_empty_proposal_set_cannot_drive_the_next_iteration() {
    let mut empty = request();
    empty.proposals.expected_cardinality = 0;
    empty.proposals.proposals.clear();
    assert!(matches!(
        empty.validate(),
        Err(IterationResultAdmissionErrorV1::NotApplicable)
    ));
}

#[rstest]
fn a_malformed_locator_or_digest_is_refused_before_any_owner_read() {
    let mut malformed = request();
    malformed.locator.attempt_identity = "a".to_owned();
    assert!(matches!(
        malformed.validate(),
        Err(IterationResultAdmissionErrorV1::InvalidLocator)
    ));

    let mut malformed = request();
    malformed.result_digest = "md5:0123456789abcdef".to_owned();
    assert!(matches!(
        malformed.validate(),
        Err(IterationResultAdmissionErrorV1::InvalidLocator)
    ));
}

#[rstest]
fn the_locator_alone_carries_no_result_digest_or_proposal_authority() {
    let locator: IterationResultAdmissionLocatorV1 =
        serde_json::from_value(request_json()["locator"].clone()).expect("locator shape");
    assert_eq!(
        serde_json::to_value(&locator).expect("locator JSON"),
        request_json()["locator"]
    );

    let proposals: IterationResultCandidateProposalSetV1 =
        serde_json::from_value(request_json()["proposals"].clone()).expect("proposal set shape");
    let first: &IterationResultCandidateProposalV1 = &proposals.proposals[0];
    assert_eq!(first.candidate_identity, "candidate-1");
    assert_eq!(first.candidate_digest, sha('1'));
}
