use vibe_strategy_governance::{QualificationSourceFrontier, TimeEvidence};

fn main() {
    let _ = TimeEvidence {
        clock_epoch: "clock".to_owned(),
        monotonic_sequence: 1,
        observed_at: 1,
        valid_through: 2,
        source_frontier: QualificationSourceFrontier::new("frontier").unwrap(),
    };
}
