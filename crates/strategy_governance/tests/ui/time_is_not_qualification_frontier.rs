use vibe_strategy_governance::{
    ArtifactId, CandidateId, Digest, EconomicConditionsVersion, EligibilityState, FactRef,
    TimeEvidence, TimeSourceFrontierId, UntrustedEligibilityReadback,
};

fn main() {
    let time_frontier = TimeSourceFrontierId::new("frontier").unwrap();
    let time = TimeEvidence {
        clock_epoch: "clock".to_owned(),
        monotonic_sequence: 1,
        observed_at: 1,
        valid_through: 2,
        source_frontier: time_frontier.clone(),
    };
    let _ = UntrustedEligibilityReadback {
        eligibility_ref: FactRef {
            id: "fact".to_owned(),
            digest: Digest::of_fields(&["fact"]),
        },
        state: EligibilityState::Qualified,
        artifact_id: ArtifactId::new("artifact").unwrap(),
        candidate_id: CandidateId::new("candidate").unwrap(),
        economic_conditions_version: EconomicConditionsVersion::new("conditions").unwrap(),
        evaluated_capacity_model: "model".to_owned(),
        capacity_ceiling: 1,
        effective_from: 1,
        effective_through: 2,
        qualification_frontier: time_frontier,
        revocation_frontier: Digest::of_fields(&["revocation"]),
        time_evidence_ref: FactRef {
            id: "time".to_owned(),
            digest: Digest::of_fields(&["time"]),
        },
        time,
    };
}
