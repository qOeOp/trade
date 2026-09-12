//! Effect-free R&D resolution of one exact Market Data repair terminal.

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_data::owner::{
    pit_snapshot::UntrustedPitSnapshotTimeEvidence,
    research_pit_terminal::{ResearchPitBlocker, ResearchPitDisposition},
    source_binding::BindingDigest,
};
use vibe_market_data_repair_custody::{MarketDataRepairDispositionV1, MarketDataRepairTerminalV1};

use crate::{
    iteration_decision::{
        IterationDecisionEvidenceCutV1, IterationDecisionOutcomeV1, IterationRepairCategoryV1,
        IterationRepairTargetV1, IterationTerminalStopReasonV1,
        RepairInputIterationDecisionReadbackV1,
    },
    market_data_repair_request::MarketDataRepairRequestReadbackV1,
    repair_action::RepairActionRequestReadbackV1,
};

const RESOLUTION_DOMAIN_V1: &str = "rd.market-data-repair-resolution.v1";

/// R&D's exact interpretation of a correlated Market Data repair terminal.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketDataRepairResolutionDispositionV1 {
    Repaired,
    InputUnavailable,
}

/// Positive repaired snapshot coordinates. Present only for `REPAIRED`.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct RepairedMarketDataSnapshotV1 {
    snapshot_identity: BindingDigest,
    normalized_records_digest: BindingDigest,
}

impl RepairedMarketDataSnapshotV1 {
    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    #[must_use]
    pub const fn normalized_records_digest(&self) -> BindingDigest {
        self.normalized_records_digest
    }
}

/// Move-only R&D terminal derived from the complete Decision -> request -> Market Data result chain.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct MarketDataRepairResearchTerminalV1 {
    schema_version: u16,
    resolution_identity: String,
    resolution_digest: String,
    disposition: MarketDataRepairResolutionDispositionV1,
    decision_identity: String,
    decision_digest: String,
    decision_evidence_cut: IterationDecisionEvidenceCutV1,
    action_request_identity: String,
    action_request_digest: String,
    repair_request_identity: String,
    repair_request_digest: String,
    repair_request_receipt_identity: String,
    repair_request_receipt_digest: String,
    market_data_terminal_identity: String,
    market_data_terminal_digest: String,
    correlation_identity: BindingDigest,
    result_time_evidence: UntrustedPitSnapshotTimeEvidence,
    repaired: Option<RepairedMarketDataSnapshotV1>,
    unavailable_basis: Option<ResearchPitDisposition>,
    blockers: Box<[ResearchPitBlocker]>,
    stop_reason: Option<IterationTerminalStopReasonV1>,
}

impl MarketDataRepairResearchTerminalV1 {
    #[must_use]
    pub fn resolution_identity(&self) -> &str {
        &self.resolution_identity
    }

    #[must_use]
    pub fn resolution_digest(&self) -> &str {
        &self.resolution_digest
    }

    #[must_use]
    pub const fn disposition(&self) -> MarketDataRepairResolutionDispositionV1 {
        self.disposition
    }

    #[must_use]
    pub const fn repaired(&self) -> Option<&RepairedMarketDataSnapshotV1> {
        self.repaired.as_ref()
    }

    #[must_use]
    pub const fn stop_reason(&self) -> Option<IterationTerminalStopReasonV1> {
        self.stop_reason
    }

    /// Returns deterministic bytes suitable for later R&D-owned append-only custody.
    ///
    /// # Errors
    ///
    /// Returns an encoding error if canonical serialization is unavailable.
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, MarketDataRepairResolutionErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MarketDataRepairResolutionErrorV1 {
    #[error("the Decision or repair action is not for Market Data")]
    WrongRepairTarget,
    #[error("the R&D Decision, action, request, and Market Data terminal do not match")]
    CustodyMismatch,
    #[error("the Market Data terminal shape cannot produce an R&D resolution")]
    TerminalShape,
    #[error("Market Data repair resolution encoding is unavailable: {0}")]
    Encoding(String),
}

/// Consumes one Owner-sealed Market Data terminal and issues the only legal R&D resolution.
///
/// This operation creates no Replay Request, successor Intent, Selection, repair effect, or trading effect.
#[allow(
    clippy::needless_pass_by_value,
    reason = "consuming the Market Data terminal preserves single-use Owner custody"
)]
pub fn resolve_market_data_repair_terminal_v1(
    decision: &RepairInputIterationDecisionReadbackV1,
    action: &RepairActionRequestReadbackV1,
    request: &MarketDataRepairRequestReadbackV1,
    terminal: MarketDataRepairTerminalV1,
) -> Result<MarketDataRepairResearchTerminalV1, MarketDataRepairResolutionErrorV1> {
    issue_from_evidence(decision, action, request, &terminal)
}

trait DecisionEvidence {
    fn market_data_target(&self) -> bool;
    fn identity(&self) -> &str;
    fn digest(&self) -> &str;
    fn result_identity(&self) -> &str;
    fn evidence_cut(&self) -> &IterationDecisionEvidenceCutV1;
}

impl DecisionEvidence for RepairInputIterationDecisionReadbackV1 {
    fn market_data_target(&self) -> bool {
        matches!(
            self.decision().outcome(),
            IterationDecisionOutcomeV1::RepairInputs {
                category: IterationRepairCategoryV1::MarketData,
                target: IterationRepairTargetV1::MarketData
            }
        )
    }
    fn identity(&self) -> &str {
        self.decision().decision_identity()
    }
    fn digest(&self) -> &str {
        self.decision().decision_digest()
    }
    fn result_identity(&self) -> &str {
        self.receipt().result_identity()
    }
    fn evidence_cut(&self) -> &IterationDecisionEvidenceCutV1 {
        self.decision().evidence_cut()
    }
}

trait ActionEvidence {
    fn market_data_target(&self) -> bool;
    fn identity(&self) -> &str;
    fn digest(&self) -> &str;
    fn decision_identity(&self) -> &str;
    fn decision_digest(&self) -> &str;
    fn result_identity(&self) -> &str;
}

impl ActionEvidence for RepairActionRequestReadbackV1 {
    fn market_data_target(&self) -> bool {
        self.request().category() == IterationRepairCategoryV1::MarketData
            && self.request().target() == IterationRepairTargetV1::MarketData
    }
    fn identity(&self) -> &str {
        self.request().action_request_identity()
    }
    fn digest(&self) -> &str {
        self.request().action_request_digest()
    }
    fn decision_identity(&self) -> &str {
        self.request().decision_identity()
    }
    fn decision_digest(&self) -> &str {
        self.request().decision_digest()
    }
    fn result_identity(&self) -> &str {
        self.request().result_identity()
    }
}

trait RequestEvidence {
    fn market_data_target(&self) -> bool;
    fn identity(&self) -> &str;
    fn digest(&self) -> &str;
    fn receipt_identity(&self) -> &str;
    fn receipt_digest(&self) -> &str;
    fn action_identity(&self) -> &str;
    fn action_digest(&self) -> &str;
    fn decision_identity(&self) -> &str;
    fn decision_digest(&self) -> &str;
    fn result_identity(&self) -> &str;
    fn correlation_identity(&self) -> BindingDigest;
}

impl RequestEvidence for MarketDataRepairRequestReadbackV1 {
    fn market_data_target(&self) -> bool {
        self.request().category() == IterationRepairCategoryV1::MarketData
            && self.request().target() == IterationRepairTargetV1::MarketData
    }
    fn identity(&self) -> &str {
        self.request().request_identity()
    }
    fn digest(&self) -> &str {
        self.request().request_digest()
    }
    fn receipt_identity(&self) -> &str {
        self.receipt().receipt_identity()
    }
    fn receipt_digest(&self) -> &str {
        self.receipt().receipt_digest()
    }
    fn action_identity(&self) -> &str {
        self.request().action_request_identity()
    }
    fn action_digest(&self) -> &str {
        self.request().action_request_digest()
    }
    fn decision_identity(&self) -> &str {
        self.request().decision_identity()
    }
    fn decision_digest(&self) -> &str {
        self.request().decision_digest()
    }
    fn result_identity(&self) -> &str {
        self.request().result_identity()
    }
    fn correlation_identity(&self) -> BindingDigest {
        self.request().correlation_identity()
    }
}

trait TerminalEvidence {
    fn identity(&self) -> &str;
    fn digest(&self) -> &str;
    fn request_identity(&self) -> &str;
    fn request_digest(&self) -> &str;
    fn request_receipt_identity(&self) -> &str;
    fn request_receipt_digest(&self) -> &str;
    fn correlation_identity(&self) -> BindingDigest;
    fn disposition(&self) -> MarketDataRepairDispositionV1;
    fn repaired(&self) -> Option<(BindingDigest, BindingDigest)>;
    fn unavailable_basis(&self) -> Option<ResearchPitDisposition>;
    fn blockers(&self) -> &[ResearchPitBlocker];
    fn result_time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence;
}

impl TerminalEvidence for MarketDataRepairTerminalV1 {
    fn identity(&self) -> &str {
        self.terminal_identity()
    }
    fn digest(&self) -> &str {
        self.terminal_digest()
    }
    fn request_identity(&self) -> &str {
        self.repair_request_identity()
    }
    fn request_digest(&self) -> &str {
        self.repair_request_digest()
    }
    fn request_receipt_identity(&self) -> &str {
        self.repair_request_receipt_identity()
    }
    fn request_receipt_digest(&self) -> &str {
        self.repair_request_receipt_digest()
    }
    fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity()
    }
    fn disposition(&self) -> MarketDataRepairDispositionV1 {
        self.disposition()
    }
    fn repaired(&self) -> Option<(BindingDigest, BindingDigest)> {
        self.available()
            .map(|value| (value.snapshot_identity(), value.normalized_records_digest()))
    }
    fn unavailable_basis(&self) -> Option<ResearchPitDisposition> {
        self.unavailable_basis()
    }
    fn blockers(&self) -> &[ResearchPitBlocker] {
        self.blockers()
    }
    fn result_time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        self.result_time_evidence()
    }
}

fn issue_from_evidence(
    decision: &impl DecisionEvidence,
    action: &impl ActionEvidence,
    request: &impl RequestEvidence,
    terminal: &impl TerminalEvidence,
) -> Result<MarketDataRepairResearchTerminalV1, MarketDataRepairResolutionErrorV1> {
    if !decision.market_data_target()
        || !action.market_data_target()
        || !request.market_data_target()
    {
        return Err(MarketDataRepairResolutionErrorV1::WrongRepairTarget);
    }
    if action.decision_identity() != decision.identity()
        || action.decision_digest() != decision.digest()
        || action.result_identity() != decision.result_identity()
        || request.action_identity() != action.identity()
        || request.action_digest() != action.digest()
        || request.decision_identity() != decision.identity()
        || request.decision_digest() != decision.digest()
        || request.result_identity() != decision.result_identity()
        || terminal.request_identity() != request.identity()
        || terminal.request_digest() != request.digest()
        || terminal.request_receipt_identity() != request.receipt_identity()
        || terminal.request_receipt_digest() != request.receipt_digest()
        || terminal.correlation_identity() != request.correlation_identity()
    {
        return Err(MarketDataRepairResolutionErrorV1::CustodyMismatch);
    }
    let (disposition, repaired, unavailable_basis, blockers, stop_reason) =
        match terminal.disposition() {
            MarketDataRepairDispositionV1::Available => {
                let (snapshot_identity, normalized_records_digest) = terminal
                    .repaired()
                    .filter(|_| {
                        terminal.unavailable_basis().is_none() && terminal.blockers().is_empty()
                    })
                    .ok_or(MarketDataRepairResolutionErrorV1::TerminalShape)?;
                (
                    MarketDataRepairResolutionDispositionV1::Repaired,
                    Some(RepairedMarketDataSnapshotV1 {
                        snapshot_identity,
                        normalized_records_digest,
                    }),
                    None,
                    Vec::new(),
                    None,
                )
            }
            MarketDataRepairDispositionV1::Unavailable => {
                if terminal.repaired().is_some() || terminal.unavailable_basis().is_none() {
                    return Err(MarketDataRepairResolutionErrorV1::TerminalShape);
                }
                (
                    MarketDataRepairResolutionDispositionV1::InputUnavailable,
                    None,
                    terminal.unavailable_basis(),
                    terminal.blockers().to_vec(),
                    Some(IterationTerminalStopReasonV1::InputUnavailable),
                )
            }
        };
    let meaning = ResolutionMeaningV1 {
        schema_version: 1,
        disposition,
        decision_identity: decision.identity(),
        decision_digest: decision.digest(),
        decision_evidence_cut: decision.evidence_cut(),
        action_request_identity: action.identity(),
        action_request_digest: action.digest(),
        repair_request_identity: request.identity(),
        repair_request_digest: request.digest(),
        repair_request_receipt_identity: request.receipt_identity(),
        repair_request_receipt_digest: request.receipt_digest(),
        market_data_terminal_identity: terminal.identity(),
        market_data_terminal_digest: terminal.digest(),
        correlation_identity: terminal.correlation_identity(),
        result_time_evidence: terminal.result_time_evidence(),
        repaired: repaired.as_ref(),
        unavailable_basis,
        blockers: &blockers,
        stop_reason,
    };
    let resolution_digest = digest(&meaning)?;
    Ok(MarketDataRepairResearchTerminalV1 {
        schema_version: 1,
        resolution_identity: format!(
            "rd-market-data-repair-resolution-v1-{}",
            resolution_digest.trim_start_matches("sha256:")
        ),
        resolution_digest,
        disposition,
        decision_identity: decision.identity().to_owned(),
        decision_digest: decision.digest().to_owned(),
        decision_evidence_cut: decision.evidence_cut().clone(),
        action_request_identity: action.identity().to_owned(),
        action_request_digest: action.digest().to_owned(),
        repair_request_identity: request.identity().to_owned(),
        repair_request_digest: request.digest().to_owned(),
        repair_request_receipt_identity: request.receipt_identity().to_owned(),
        repair_request_receipt_digest: request.receipt_digest().to_owned(),
        market_data_terminal_identity: terminal.identity().to_owned(),
        market_data_terminal_digest: terminal.digest().to_owned(),
        correlation_identity: terminal.correlation_identity(),
        result_time_evidence: terminal.result_time_evidence().clone(),
        repaired,
        unavailable_basis,
        blockers: blockers.into_boxed_slice(),
        stop_reason,
    })
}

#[derive(Serialize)]
struct ResolutionMeaningV1<'a> {
    schema_version: u16,
    disposition: MarketDataRepairResolutionDispositionV1,
    decision_identity: &'a str,
    decision_digest: &'a str,
    decision_evidence_cut: &'a IterationDecisionEvidenceCutV1,
    action_request_identity: &'a str,
    action_request_digest: &'a str,
    repair_request_identity: &'a str,
    repair_request_digest: &'a str,
    repair_request_receipt_identity: &'a str,
    repair_request_receipt_digest: &'a str,
    market_data_terminal_identity: &'a str,
    market_data_terminal_digest: &'a str,
    correlation_identity: BindingDigest,
    result_time_evidence: &'a UntrustedPitSnapshotTimeEvidence,
    repaired: Option<&'a RepairedMarketDataSnapshotV1>,
    unavailable_basis: Option<ResearchPitDisposition>,
    blockers: &'a [ResearchPitBlocker],
    stop_reason: Option<IterationTerminalStopReasonV1>,
}

fn digest(value: &impl Serialize) -> Result<String, MarketDataRepairResolutionErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope {
        domain: RESOLUTION_DOMAIN_V1,
        value,
    })
    .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
    .map_err(encoding)
}

fn encoding(error: impl std::fmt::Display) -> MarketDataRepairResolutionErrorV1 {
    MarketDataRepairResolutionErrorV1::Encoding(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_data::owner::pit_snapshot::{
        UntrustedEventEffectiveTime, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    };

    fn binding(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn time() -> UntrustedPitSnapshotTimeEvidence {
        UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "clock", "epoch"),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                11, "clock", "epoch",
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(12, "clock", "epoch"),
            correction_publication: None,
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(13, "clock", "epoch"),
            monotonic_sequence: 14,
            restart_continuity_digest: binding(30),
            skew_bound: 2,
            uncertainty_bound: 1,
            observed_at: 15,
            valid_through: 20,
        }
    }

    struct Decision {
        target: bool,
        cut: IterationDecisionEvidenceCutV1,
    }

    impl DecisionEvidence for Decision {
        fn market_data_target(&self) -> bool {
            self.target
        }
        fn identity(&self) -> &str {
            "decision"
        }
        fn digest(&self) -> &str {
            "sha256:decision"
        }
        fn result_identity(&self) -> &str {
            "result"
        }
        fn evidence_cut(&self) -> &IterationDecisionEvidenceCutV1 {
            &self.cut
        }
    }

    struct Action {
        decision_digest: &'static str,
    }

    impl ActionEvidence for Action {
        fn market_data_target(&self) -> bool {
            true
        }
        fn identity(&self) -> &str {
            "action"
        }
        fn digest(&self) -> &str {
            "sha256:action"
        }
        fn decision_identity(&self) -> &str {
            "decision"
        }
        fn decision_digest(&self) -> &str {
            self.decision_digest
        }
        fn result_identity(&self) -> &str {
            "result"
        }
    }

    struct Request;

    impl RequestEvidence for Request {
        fn market_data_target(&self) -> bool {
            true
        }
        fn identity(&self) -> &str {
            "request"
        }
        fn digest(&self) -> &str {
            "sha256:request"
        }
        fn receipt_identity(&self) -> &str {
            "receipt"
        }
        fn receipt_digest(&self) -> &str {
            "sha256:receipt"
        }
        fn action_identity(&self) -> &str {
            "action"
        }
        fn action_digest(&self) -> &str {
            "sha256:action"
        }
        fn decision_identity(&self) -> &str {
            "decision"
        }
        fn decision_digest(&self) -> &str {
            "sha256:decision"
        }
        fn result_identity(&self) -> &str {
            "result"
        }
        fn correlation_identity(&self) -> BindingDigest {
            binding(1)
        }
    }

    struct Terminal {
        disposition: MarketDataRepairDispositionV1,
        repaired: Option<(BindingDigest, BindingDigest)>,
        basis: Option<ResearchPitDisposition>,
        blockers: Vec<ResearchPitBlocker>,
        request_digest: &'static str,
        time: UntrustedPitSnapshotTimeEvidence,
    }

    impl TerminalEvidence for Terminal {
        fn identity(&self) -> &str {
            "terminal"
        }
        fn digest(&self) -> &str {
            "sha256:terminal"
        }
        fn request_identity(&self) -> &str {
            "request"
        }
        fn request_digest(&self) -> &str {
            self.request_digest
        }
        fn request_receipt_identity(&self) -> &str {
            "receipt"
        }
        fn request_receipt_digest(&self) -> &str {
            "sha256:receipt"
        }
        fn correlation_identity(&self) -> BindingDigest {
            binding(1)
        }
        fn disposition(&self) -> MarketDataRepairDispositionV1 {
            self.disposition
        }
        fn repaired(&self) -> Option<(BindingDigest, BindingDigest)> {
            self.repaired
        }
        fn unavailable_basis(&self) -> Option<ResearchPitDisposition> {
            self.basis
        }
        fn blockers(&self) -> &[ResearchPitBlocker] {
            &self.blockers
        }
        fn result_time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
            &self.time
        }
    }

    fn decision() -> Decision {
        Decision {
            target: true,
            cut: IterationDecisionEvidenceCutV1 {
                decision_policy_identity: "policy".into(),
                decision_policy_version: 1,
                decision_policy_digest: [1; 32],
                decision_policy_binding_digest: [2; 32],
                trial_family_identity: "family".into(),
                census_frontier_identity: "census".into(),
                census_frontier_digest: "sha256:census".into(),
                attempt_frontier_identity: "attempt-frontier".into(),
                attempt_frontier_digest: "sha256:attempt-frontier".into(),
                candidate_set_frontier_identity: "candidate-frontier".into(),
                candidate_set_frontier_digest: "sha256:candidate-frontier".into(),
                request_identity: "replay-request".into(),
                request_digest: "sha256:replay-request".into(),
                result_identity: "result".into(),
                result_digest: "sha256:result".into(),
                attempt_identity: "attempt".into(),
            },
        }
    }

    fn available_terminal() -> Terminal {
        Terminal {
            disposition: MarketDataRepairDispositionV1::Available,
            repaired: Some((binding(20), binding(21))),
            basis: None,
            blockers: Vec::new(),
            request_digest: "sha256:request",
            time: time(),
        }
    }

    #[test]
    fn available_terminal_deterministically_yields_repaired_without_stop() {
        let first = issue_from_evidence(
            &decision(),
            &Action {
                decision_digest: "sha256:decision",
            },
            &Request,
            &available_terminal(),
        )
        .expect("repaired resolution");
        let second = issue_from_evidence(
            &decision(),
            &Action {
                decision_digest: "sha256:decision",
            },
            &Request,
            &available_terminal(),
        )
        .expect("same resolution");
        assert_eq!(
            first.disposition(),
            MarketDataRepairResolutionDispositionV1::Repaired
        );
        assert!(first.repaired().is_some());
        assert_eq!(first.stop_reason(), None);
        assert_eq!(first.to_canonical_bytes(), second.to_canonical_bytes());
    }

    #[test]
    fn unavailable_terminal_yields_only_input_unavailable_stop() {
        let terminal = Terminal {
            disposition: MarketDataRepairDispositionV1::Unavailable,
            repaired: None,
            basis: Some(ResearchPitDisposition::Unavailable),
            blockers: vec![ResearchPitBlocker::SourceUnavailable],
            request_digest: "sha256:request",
            time: time(),
        };
        let resolved = issue_from_evidence(
            &decision(),
            &Action {
                decision_digest: "sha256:decision",
            },
            &Request,
            &terminal,
        )
        .expect("unavailable stop");
        assert_eq!(
            resolved.disposition(),
            MarketDataRepairResolutionDispositionV1::InputUnavailable
        );
        assert!(resolved.repaired().is_none());
        assert_eq!(
            resolved.stop_reason(),
            Some(IterationTerminalStopReasonV1::InputUnavailable)
        );
    }

    #[test]
    fn wrong_target_chain_splice_or_terminal_shape_fails_closed() {
        let mut wrong = decision();
        wrong.target = false;
        assert_eq!(
            issue_from_evidence(
                &wrong,
                &Action {
                    decision_digest: "sha256:decision"
                },
                &Request,
                &available_terminal()
            ),
            Err(MarketDataRepairResolutionErrorV1::WrongRepairTarget)
        );

        assert_eq!(
            issue_from_evidence(
                &decision(),
                &Action {
                    decision_digest: "sha256:other"
                },
                &Request,
                &available_terminal()
            ),
            Err(MarketDataRepairResolutionErrorV1::CustodyMismatch)
        );

        let mut malformed = available_terminal();
        malformed.basis = Some(ResearchPitDisposition::Unavailable);
        assert_eq!(
            issue_from_evidence(
                &decision(),
                &Action {
                    decision_digest: "sha256:decision"
                },
                &Request,
                &malformed
            ),
            Err(MarketDataRepairResolutionErrorV1::TerminalShape)
        );
    }
}
