//! The initial PIT request a V3 Research Intent issues, as pure derivations.
//!
//! The custody and the Owner step live in `research_initial_pit_postgres`. Everything here computes
//! from its arguments alone: the correlation and requester R&D writes, the Universe Selection
//! request and PIT submission it freezes, and the attribution of a Market Data terminal to exactly
//! one frozen attempt. Market Data recomputes the requester and seals the request from the same
//! inputs, so nothing here is R&D's to choose beyond what the Research request already states.

use serde::Serialize;
use sha2::{Digest, Sha256};
use vibe_data::owner::{
    pit_market_snapshot_intake_v1::{
        PitMarketSnapshotBlockerV1, PitMarketSnapshotDispositionV1, PitMarketSnapshotTerminalV1,
    },
    pit_snapshot::{
        PitSnapshotSubmissionV1, UntrustedPitSnapshotTimeEvidence,
        research_pit_requester_identity_v1,
    },
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    research_pit_references_v1::ResearchPitReferencesV1,
    source_binding::BindingDigest,
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
};

const CORRELATION_DOMAIN_V1: &[u8] = b"rd.research-initial-pit-correlation.v1\0";
const UNIVERSE_SELECTION_REQUEST_DOMAIN_V1: &[u8] = b"rd.research-initial-universe-selection.v1\0";

/// The role R&D states on the Universe Selection request it submits for an Intent.
const UNIVERSE_SELECTION_REQUESTER_ROLE_V1: &str = crate::product_edge::RESEARCH_OWNER_V1;

/// The one correlation every attempt of an Intent's initial PIT request carries.
///
/// Market Data commits at most one initial intake per correlation, so an Intent has at most one
/// initial PIT request however many attempts R&D freezes for it.
pub(crate) fn initial_pit_correlation_v1(intent_identity: BindingDigest) -> BindingDigest {
    domain_digest(CORRELATION_DOMAIN_V1, &[intent_identity.as_bytes()])
}

/// What an Intent's initial PIT request is about: the Research request, its Intent and its scope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InitialPitSubjectV1 {
    /// R&D's `rd.develop.request-identity.v2` digest of the request locator, as a Design role
    /// intent carries it.
    pub(crate) research_request_identity: BindingDigest,
    /// The Intent identity's 32-byte digest.
    pub(crate) intent_identity: BindingDigest,
    /// The instrument scope the Intent binds.
    pub(crate) scope: ResearchInstrumentScopeV1,
}

impl InitialPitSubjectV1 {
    pub(crate) fn correlation(&self) -> BindingDigest {
        initial_pit_correlation_v1(self.intent_identity)
    }

    /// Market Data's requester digest of the Research request, never taken from a caller.
    pub(crate) fn requester_identity(&self) -> BindingDigest {
        research_pit_requester_identity_v1(self.research_request_identity)
    }
}

/// Why a request could not be frozen from what Market Data's read answered.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum InitialPitFreezeErrorV1 {
    /// The decision cut Market Data answered does not digest, so no request can name it.
    DecisionCutIncomplete,
}

/// The Universe Selection request stating the scope's fixed-member rule at Market Data's cut.
///
/// Its identity is derived from the correlation, the frontier and the cut, so the same references
/// always name the same request and Market Data rejoins it, while references read at another cut
/// or frontier name a new one rather than conflicting with the first.
pub(crate) fn universe_selection_request_v1(
    subject: &InitialPitSubjectV1,
    references: &ResearchPitReferencesV1,
) -> Result<UntrustedUniverseSelectionRequestV1, InitialPitFreezeErrorV1> {
    let cut = references.decision_cut();
    let cut_digest = cut
        .digest()
        .ok_or(InitialPitFreezeErrorV1::DecisionCutIncomplete)?;
    let correlation = subject.correlation();
    let frontier = references.eligible_instrument_frontier();
    let request_identity = domain_digest(
        UNIVERSE_SELECTION_REQUEST_DOMAIN_V1,
        &[
            correlation.as_bytes(),
            frontier.as_bytes(),
            cut_digest.as_bytes(),
        ],
    );
    let at = i128::from(cut.decision_cut);
    Ok(UntrustedUniverseSelectionRequestV1::new(
        request_identity,
        UNIVERSE_SELECTION_REQUESTER_ROLE_V1,
        subject.scope.identity(),
        subject.scope.fixed_member_selection_rule_bytes(),
        frontier,
        at,
        at,
        cut.decision_cut,
        references.source_binding_lineage_root(),
        references.correction_frontier_digest(),
        correlation,
    ))
}

/// The PIT submission for the selection Market Data recorded, at the same cut.
///
/// It states no Instrument Master digest and no claimed identity or digest: the intake stamps and
/// seals those itself.
pub(crate) fn pit_submission_v1(
    subject: &InitialPitSubjectV1,
    references: &ResearchPitReferencesV1,
    universe_selection_identity: BindingDigest,
) -> PitSnapshotSubmissionV1 {
    PitSnapshotSubmissionV1 {
        correlation_identity: subject.correlation(),
        requester_identity: subject.requester_identity(),
        scope_digest: subject.scope.identity(),
        source_binding: references.source_binding().clone(),
        universe_selection_digest: universe_selection_identity,
        market_semantics_identity: references.market_semantics_identity(),
        time_evidence: UntrustedPitSnapshotTimeEvidence::at_decision_cut_v1(
            references.decision_cut(),
        ),
    }
}

/// One frozen attempt, as custody holds it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FrozenInitialPitAttemptV1 {
    pub(crate) ordinal: u32,
    pub(crate) universe_selection: UntrustedUniverseSelectionLocatorV1,
    pub(crate) submission: PitSnapshotSubmissionV1,
}

/// Why a terminal could not be recorded against an attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum InitialPitAttributionErrorV1 {
    /// No frozen attempt seals to the request the terminal answers.
    NoAttemptMatches,
    /// More than one frozen attempt seals to it.
    SeveralAttemptsMatch,
}

/// The one attempt whose submission, stamped with the terminal's Instrument Master digest, seals
/// to exactly the request identity and digest the terminal answers.
///
/// Every attempt is checked, not only the latest: an earlier attempt's send may be the one Market
/// Data committed.
pub(crate) fn attribute_initial_pit_terminal_v1(
    attempts: &[FrozenInitialPitAttemptV1],
    terminal: &PitMarketSnapshotTerminalV1,
) -> Result<u32, InitialPitAttributionErrorV1> {
    let matching = attempts
        .iter()
        .filter(|attempt| {
            let request = attempt
                .submission
                .clone()
                .into_request(terminal.instrument_master_digest());
            request.claimed_request_identity == terminal.request_identity()
                && request.claimed_request_digest == terminal.request_digest()
        })
        .map(|attempt| attempt.ordinal)
        .collect::<Vec<_>>();

    match matching.as_slice() {
        [ordinal] => Ok(*ordinal),
        [] => Err(InitialPitAttributionErrorV1::NoAttemptMatches),
        _ => Err(InitialPitAttributionErrorV1::SeveralAttemptsMatch),
    }
}

/// The primary blocker Market Data derives a disposition from: `None` exactly for `AVAILABLE`.
///
/// Market Data maps each primary blocker to one disposition, so a recorded terminal whose
/// blocker is not this one is not a terminal Market Data can state.
pub(crate) const fn initial_pit_blocker_of_v1(
    disposition: PitMarketSnapshotDispositionV1,
) -> Option<PitMarketSnapshotBlockerV1> {
    match disposition {
        PitMarketSnapshotDispositionV1::Available => None,
        PitMarketSnapshotDispositionV1::Unlicensed => {
            Some(PitMarketSnapshotBlockerV1::RightsUnlicensed)
        }
        PitMarketSnapshotDispositionV1::Ambiguous => {
            Some(PitMarketSnapshotBlockerV1::IdentitySemanticsOrTimeAmbiguous)
        }
        PitMarketSnapshotDispositionV1::Stale => Some(PitMarketSnapshotBlockerV1::EvidenceStale),
        PitMarketSnapshotDispositionV1::Insufficient => {
            Some(PitMarketSnapshotBlockerV1::CoverageInsufficient)
        }
        PitMarketSnapshotDispositionV1::Unavailable => {
            Some(PitMarketSnapshotBlockerV1::SourceUnavailable)
        }
    }
}

/// How an Intent's initial PIT request stands, as the Research readback states it.
///
/// Each state is read from custody, never inferred from another: a request with no frozen attempt
/// is `NOT_ISSUED`, one with an attempt and no recorded terminal is `SUBMITTED_OR_UNKNOWN`, and a
/// recorded terminal carries its disposition and primary blocker exactly.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchInitialPitV1 {
    NotIssued,
    SubmittedOrUnknown,
    Terminal {
        disposition: PitMarketSnapshotDispositionV1,
        primary_blocker: Option<PitMarketSnapshotBlockerV1>,
    },
}

fn domain_digest(domain: &[u8], parts: &[&[u8]]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);

    for part in parts {
        hasher.update(part);
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rstest::rstest;
    use serde_json::json;
    use vibe_data::owner::{
        pit_market_snapshot_intake_v1::{
            MarketDataDecisionCutV1, PitMarketSnapshotBlockerV1, PitMarketSnapshotTerminalV1,
        },
        pit_snapshot::{PitSnapshotSubmissionV1, UntrustedPitSnapshotTimeEvidence},
        source_binding::{
            BindingDigest, UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
            UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf,
            UntrustedSourceBindingLocator, UntrustedSourceBindingLocatorFields,
        },
        universe_selection::UntrustedUniverseSelectionLocatorV1,
    };

    use super::{
        FrozenInitialPitAttemptV1, InitialPitAttributionErrorV1, ResearchInitialPitV1,
        attribute_initial_pit_terminal_v1, initial_pit_correlation_v1,
    };

    fn digest(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn source_binding() -> UntrustedSourceBindingLocator {
        UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
            owner: "MARKET_DATA".to_owned(),
            lineage_root: digest(1),
            lineage_version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
            binding_id: digest(1),
            fact_digest: digest(2),
            credential_handle_identity: digest(3),
            credential_audience: UntrustedCredentialAudienceClaim::MarketData,
            credential_capabilities: BTreeSet::from([
                UntrustedCredentialCapabilityClaim::MarketDataRead,
            ]),
            source_frontier: UntrustedCompleteFrontier {
                stream_identity: "source-stream".to_owned(),
                cut_identity: "source-cut".to_owned(),
                sequence: 1,
                digest: digest(4),
            },
            correction_frontier: UntrustedCompleteFrontier {
                stream_identity: "correction-stream".to_owned(),
                cut_identity: "correction-cut".to_owned(),
                sequence: 1,
                digest: digest(5),
            },
            time_evidence: UntrustedMarketDataAsOf {
                claimed_evidence_identity: digest(6),
                clock_identity: "clock".to_owned(),
                clock_epoch: "epoch-1".to_owned(),
                monotonic_sequence: 1,
                restart_continuity_digest: digest(7),
                skew_bound: 2,
                uncertainty_bound: 1,
                event_effective: 1,
                provider_available: 2,
                retrieval: 3,
                correction_publication: 2,
                observed_at: 4,
                effective_at: 4,
                valid_through: 5,
            },
        })
    }

    /// One attempt frozen at `decision_cut`: attempts of one Intent differ only in their cut.
    fn attempt(ordinal: u32, decision_cut: u64) -> FrozenInitialPitAttemptV1 {
        FrozenInitialPitAttemptV1 {
            ordinal,
            universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(
                digest(8),
                digest(9),
            ),
            submission: PitSnapshotSubmissionV1 {
                correlation_identity: initial_pit_correlation_v1(digest(10)),
                requester_identity: digest(11),
                scope_digest: digest(12),
                source_binding: source_binding(),
                universe_selection_digest: digest(13),
                market_semantics_identity: digest(14),
                time_evidence: UntrustedPitSnapshotTimeEvidence::at_decision_cut_v1(
                    &MarketDataDecisionCutV1 {
                        clock_identity: "market-data.owner-clock.v1-00001".into(),
                        clock_epoch: "market-data.owner-epoch.v1-00001".into(),
                        decision_cut,
                        monotonic_sequence: decision_cut,
                        restart_continuity_digest: digest(15),
                        valid_through: decision_cut + 1_000,
                        uncertainty_bound: 1,
                        skew_bound: 1,
                    },
                ),
            },
        }
    }

    /// The terminal Market Data answers for `attempt`, with the Instrument Master digest it
    /// stamps.
    fn terminal_for(
        attempt: &FrozenInitialPitAttemptV1,
        instrument_master_digest: BindingDigest,
    ) -> PitMarketSnapshotTerminalV1 {
        let request = attempt
            .submission
            .clone()
            .into_request(instrument_master_digest);
        serde_json::from_value(json!({
            "request_identity": request.claimed_request_identity,
            "request_digest": request.claimed_request_digest,
            "correlation_identity": request.correlation_identity,
            "snapshot_identity": digest(20),
            "fact_digest": digest(21),
            "disposition": "AVAILABLE",
            "locator": null,
            "instrument_master_digest": instrument_master_digest,
        }))
        .expect("a terminal Market Data could answer")
    }

    // Computed outside this crate: SHA-256 over the domain and thirty-two 0x07 bytes.
    #[rstest]
    fn the_correlation_is_sha256_over_its_domain_and_the_intent_identity() {
        assert_eq!(
            format!("{:?}", initial_pit_correlation_v1(digest(7)).as_bytes()),
            format!(
                "{:?}",
                (0..32)
                    .map(|at| u8::from_str_radix(
                        &"9bb9a48ebb2e7bf5fe950b6eca595a20ed45663c43967eb2e710c56ff437e12e"
                            [at * 2..at * 2 + 2],
                        16
                    )
                    .unwrap())
                    .collect::<Vec<_>>()
            )
        );
    }

    /// The terminal is attributed by sealing every attempt, so an earlier attempt's send that
    /// Market Data committed is found even when a later attempt exists. Taking the latest attempt
    /// instead would record the wrong one.
    #[rstest]
    fn the_attempt_that_seals_to_the_terminal_is_found_among_several() {
        let attempts = [attempt(1, 1_000), attempt(2, 2_000)];
        let im = digest(30);

        assert_eq!(
            attribute_initial_pit_terminal_v1(&attempts, &terminal_for(&attempts[0], im)),
            Ok(1)
        );
        assert_eq!(
            attribute_initial_pit_terminal_v1(&attempts, &terminal_for(&attempts[1], im)),
            Ok(2)
        );
    }

    /// The Instrument Master digest the terminal reports is part of the request it answers, so a
    /// terminal stamped with another one seals to no attempt.
    #[rstest]
    fn a_terminal_that_seals_to_no_attempt_is_refused() {
        let attempts = [attempt(1, 1_000)];
        let mut terminal = serde_json::to_value(terminal_for(&attempts[0], digest(30))).unwrap();
        terminal["instrument_master_digest"] = serde_json::to_value(digest(31)).unwrap();

        assert_eq!(
            attribute_initial_pit_terminal_v1(
                &attempts,
                &serde_json::from_value(terminal).unwrap()
            ),
            Err(InitialPitAttributionErrorV1::NoAttemptMatches)
        );
    }

    /// Two attempts that both seal to the terminal leave no single one to record it against.
    /// Custody never stores two identical attempts, so this is a store Market Data's answer cannot
    /// be trusted against, and it is refused rather than resolved by picking one.
    #[rstest]
    fn several_matching_attempts_are_refused() {
        let attempts = [attempt(1, 1_000), attempt(2, 1_000)];

        assert_eq!(
            attribute_initial_pit_terminal_v1(&attempts, &terminal_for(&attempts[0], digest(30))),
            Err(InitialPitAttributionErrorV1::SeveralAttemptsMatch)
        );
    }

    /// Every state the Owner can serialize, and nothing else, is in the vector file the
    /// Dashboard's consumer projection is tested against too.
    #[rstest]
    fn the_readback_states_exactly_the_shared_vectors() {
        use vibe_data::owner::pit_market_snapshot_intake_v1::PitMarketSnapshotDispositionV1;

        use super::initial_pit_blocker_of_v1;

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../product/rd-owner-client/fixtures/research_initial_pit_state_vectors_v1.json",
        );
        let file: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("the shared initial PIT state vectors"),
        )
        .expect("the vectors are JSON");
        let stated = [
            ResearchInitialPitV1::NotIssued,
            ResearchInitialPitV1::SubmittedOrUnknown,
        ]
        .into_iter()
        .chain(
            [
                PitMarketSnapshotDispositionV1::Available,
                PitMarketSnapshotDispositionV1::Unlicensed,
                PitMarketSnapshotDispositionV1::Ambiguous,
                PitMarketSnapshotDispositionV1::Stale,
                PitMarketSnapshotDispositionV1::Insufficient,
                PitMarketSnapshotDispositionV1::Unavailable,
            ]
            .into_iter()
            .map(|disposition| ResearchInitialPitV1::Terminal {
                disposition,
                primary_blocker: initial_pit_blocker_of_v1(disposition),
            }),
        )
        .map(|state| serde_json::to_value(state).unwrap())
        .collect::<Vec<_>>();
        let accepted = file["accepted"].as_array().expect("an accepted list");

        assert_eq!(stated.len(), accepted.len());
        assert!(
            stated.iter().all(|state| accepted.contains(state)),
            "{stated:?}"
        );

        for refused in file["refused"].as_array().expect("a refused list") {
            assert!(
                !stated.contains(&refused["value"]),
                "the Owner states a refused value: {}",
                refused["name"]
            );
        }
    }

    #[rstest]
    #[case::not_issued(ResearchInitialPitV1::NotIssued, json!({"state": "NOT_ISSUED"}))]
    #[case::submitted(
        ResearchInitialPitV1::SubmittedOrUnknown,
        json!({"state": "SUBMITTED_OR_UNKNOWN"})
    )]
    #[case::available(
        ResearchInitialPitV1::Terminal {
            disposition: vibe_data::owner::pit_market_snapshot_intake_v1::PitMarketSnapshotDispositionV1::Available,
            primary_blocker: None,
        },
        json!({"state": "TERMINAL", "disposition": "AVAILABLE", "primary_blocker": null})
    )]
    #[case::insufficient(
        ResearchInitialPitV1::Terminal {
            disposition: vibe_data::owner::pit_market_snapshot_intake_v1::PitMarketSnapshotDispositionV1::Insufficient,
            primary_blocker: Some(PitMarketSnapshotBlockerV1::CoverageInsufficient),
        },
        json!({
            "state": "TERMINAL",
            "disposition": "INSUFFICIENT",
            "primary_blocker": "COVERAGE_INSUFFICIENT"
        })
    )]
    fn the_readback_states_each_state_in_its_documented_shape(
        #[case] state: ResearchInitialPitV1,
        #[case] expected: serde_json::Value,
    ) {
        assert_eq!(serde_json::to_value(state).unwrap(), expected);
    }
}
