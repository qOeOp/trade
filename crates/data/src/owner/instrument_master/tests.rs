use super::{
    BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterError,
    InstrumentMasterFactProposalV1, InstrumentMasterScopeV1, InstrumentVenueSourceMapping,
    MissingNativeCryptoPerpetualOwnerFieldV1, UntrustedInstrumentMasterRequestV1,
    V1StructuralPublicTermsField, V1StructuralPublicTermsProjectionError,
    authority::{
        build_cut, build_fact, build_readback, build_receipt, decode_cut, decode_fact, observable,
        select_facts, validate_fact_graph,
    },
    codec,
};
use crate::owner::{
    shared_time_evidence::{ClockHeadFact, build_head_fact},
    source_binding::{
        BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
        MarketDataClockCutKind,
    },
};
use rstest::rstest;

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn head(sequence: u64, wall: u64, valid: u64) -> ClockHeadFact {
    build_head_fact(
        &MarketDataClockAdmission {
            cut_kind: MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: "12345678901234567890123456789012".into(),
            clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
            monotonic_sequence: sequence,
            wall_observed: wall,
            decision_cut: wall,
            valid_through: valid,
            restart_continuity_digest: d(90),
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        },
        None,
    )
    .unwrap()
}

fn proposal(
    identity: &str,
    predecessor: Option<BindingDigest>,
    observed: i128,
    correction: u8,
) -> InstrumentMasterFactProposalV1 {
    InstrumentMasterFactProposalV1 {
        canonical_identity: identity.into(),
        predecessor_fact_digest: predecessor,
        mappings: vec![InstrumentVenueSourceMapping {
            venue_identity: "XNAS".into(),
            source_identity: "SIP".into(),
            source_instrument: identity.as_bytes().to_vec(),
        }],
        instrument_class: InstrumentClass::Equity,
        base_currency: Some("USD".into()),
        quote_currency: None,
        settlement_currency: Some("USD".into()),
        margin_currency: None,
        price_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        contract_multiplier: InstrumentDecimal {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "America/New_York".into(),
        lifecycle_frontier: d(1),
        corporate_action_frontier: d(2),
        historical_membership_frontier: d(3),
        market_semantics_identity: d(4),
        source_frontier: d(5),
        correction_frontier: d(correction),
        effective_from: 10,
        effective_until: Some(100),
        provider_available: observed - 3,
        retrieval: observed - 2,
        correction_publication: observed - 1,
        owner_observation: observed,
    }
}

fn request(
    identity: &str,
    observed: i128,
    head: &super::super::shared_time_evidence::ClockHeadFact,
) -> UntrustedInstrumentMasterRequestV1 {
    UntrustedInstrumentMasterRequestV1 {
        request_identity: d(21),
        request_meaning_digest: d(22),
        consumer_role: BACKTEST_OWNER_V1.into(),
        scope: InstrumentMasterScopeV1::ExactInstrument(identity.into()),
        effective_instant: 50,
        owner_observation: observed,
        decision_cut: head.handoff.decision_cut(),
        clock_head: head.handoff.locator().clone(),
        lifecycle_frontier: d(1),
        corporate_action_frontier: d(2),
        historical_membership_frontier: d(3),
        market_semantics_identity: d(4),
        source_frontier: d(5),
        correction_frontier: d(6),
        stable_correlation: d(23),
    }
}

fn crypto_perpetual_proposal(identity: &str) -> InstrumentMasterFactProposalV1 {
    let mut proposal = proposal(identity, None, 55, 6);
    proposal.mappings = vec![InstrumentVenueSourceMapping {
        venue_identity: "SIM".into(),
        source_identity: "BINANCE".into(),
        source_instrument: b"ETHUSDT-PERP".to_vec(),
    }];
    proposal.instrument_class = InstrumentClass::CryptoPerpetual;
    proposal.base_currency = Some("ETH".into());
    proposal.quote_currency = Some("USDT".into());
    proposal.settlement_currency = Some("USDT".into());
    proposal.margin_currency = Some("USDT".into());
    proposal
}

fn readback_for(proposal: InstrumentMasterFactProposalV1) -> super::InstrumentMasterReadbackV1 {
    let clock = head(1, 60, 100);
    let identity = proposal.canonical_identity.clone();
    let fact = build_fact(proposal, &clock.handoff, None).unwrap();
    let request = request(&identity, 59, &clock);
    let cut = build_cut(
        &request,
        vec![identity],
        std::slice::from_ref(&fact),
        fact.clock.clone(),
    )
    .unwrap();
    let receipt = build_receipt(&request, std::slice::from_ref(&fact), &cut, d(30), 7).unwrap();
    build_readback(&receipt).unwrap()
}

/// One clock head per `(sequence, decision_cut)` base, each also in variants that move exactly one
/// other clock coordinate away from its default: wall time past the decision cut, validity, restart
/// continuity, skew bound, uncertainty bound, clock identity and clock epoch.
///
/// Every coordinate a head carries takes two values somewhere in the grid, and each is varied on its
/// own rather than derived from another one: a grid where wall time follows the decision cut could
/// never show a wall-time condition going wrong.
fn visibility_grid_heads(bases: &[(u64, u64)]) -> Vec<ClockHeadFact> {
    const CLOCK: &str = "12345678901234567890123456789012";
    const OTHER_CLOCK: &str = "ZYXWVUTSRQPONMLKJIHGFEDCBA987654";
    const EPOCH: &str = "abcdefghijklmnopqrstuvwxyzABCDEF";
    const OTHER_EPOCH: &str = "FEDCBAzyxwvutsrqponmlkjihgfedcba";
    // (wall after cut, valid after wall, continuity, skew, uncertainty, clock, epoch)
    let variants = [
        (0, 30, 90, 2, 1, CLOCK, EPOCH),
        (10, 30, 90, 2, 1, CLOCK, EPOCH),
        (0, 40, 90, 2, 1, CLOCK, EPOCH),
        (0, 30, 91, 2, 1, CLOCK, EPOCH),
        (0, 30, 90, 3, 1, CLOCK, EPOCH),
        (0, 30, 90, 2, 0, CLOCK, EPOCH),
        (0, 30, 90, 2, 1, OTHER_CLOCK, EPOCH),
        (0, 30, 90, 2, 1, CLOCK, OTHER_EPOCH),
    ];
    let mut heads = Vec::new();

    for &(sequence, decision_cut) in bases {
        for (wall_after, valid_after, continuity, skew, uncertainty, clock, epoch) in variants {
            let wall = decision_cut + wall_after;
            heads.push(
                build_head_fact(
                    &MarketDataClockAdmission {
                        cut_kind: MarketDataClockCutKind::MarketDataAsOf,
                        clock_identity: clock.into(),
                        clock_epoch: epoch.into(),
                        monotonic_sequence: sequence,
                        wall_observed: wall,
                        decision_cut,
                        valid_through: wall + valid_after,
                        restart_continuity_digest: d(continuity),
                        uncertainty_bound: uncertainty,
                        skew_bound: skew,
                        comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
                    },
                    None,
                )
                .expect("every grid head is complete"),
            );
        }
    }
    heads
}

/// `observes_at_least` is what lets one cut stand in for another's knowledge, so it has to imply
/// visibility exactly as `observable` defines it: whenever `shared` can see a fact and `at_bar`
/// observes at least what `shared` does, `at_bar` sees that fact too.
///
/// Checked over every fact and every pair of cuts from `visibility_grid_heads`, with fact times that
/// trail the Owner observation both together and independently. The grid must also contain a
/// non-dominant cut that really misses a fact, or it could not tell a correct comparison from an
/// empty one. A condition added to `observable` on a coordinate this grid varies turns it red; one
/// on a coordinate it does not vary would not, so a new clock or fact field belongs in the grid too.
#[rstest]
fn observes_at_least_implies_seeing_every_fact_the_other_cut_sees() {
    let mut facts = Vec::new();

    for head in visibility_grid_heads(&[(1, 70), (3, 70), (1, 85), (3, 85)]) {
        for observed in [50, 65, 70] {
            // (provider available, retrieval, correction publication) lags behind the observation
            for (available, retrieval, publication) in [(3, 2, 1), (0, 3, 0)] {
                let mut proposal = proposal("AAPL", None, observed, 6);
                proposal.provider_available = observed - available;
                proposal.retrieval = observed - retrieval;
                proposal.correction_publication = observed - publication;
                facts.push(build_fact(proposal, &head.handoff, None).expect("grid fact"));
            }
        }
    }
    let mut cuts = Vec::new();

    for head in visibility_grid_heads(&[(2, 70), (4, 70), (2, 90), (4, 90)]) {
        // `build_cut` needs a fact of its own, admitted on its own head; it is never the one tested.
        let held = build_fact(proposal("AAPL", None, 40, 6), &head.handoff, None).unwrap();

        for observed in [55, 68, 75] {
            cuts.push(
                build_cut(
                    &request("AAPL", observed, &head),
                    vec!["AAPL".into()],
                    std::slice::from_ref(&held),
                    held.clock.clone(),
                )
                .expect("grid cut"),
            );
        }
    }
    let sees = |fact, cut: &super::InstrumentMasterCutV1| {
        observable(fact, cut.owner_observation, cut.decision_cut, &cut.clock)
    };
    let mut implied = 0;
    let mut missed_without_dominance = 0;

    for shared in &cuts {
        for at_bar in &cuts {
            let dominates = at_bar.observes_at_least(shared);

            for fact in &facts {
                if !sees(fact, shared) {
                    continue;
                }

                if dominates {
                    assert!(
                        sees(fact, at_bar),
                        "a cut that observes at least another must see every fact the other sees"
                    );
                    implied += 1;
                } else if !sees(fact, at_bar) {
                    missed_without_dominance += 1;
                }
            }
        }
    }
    assert!(implied > 0, "the grid exercised the implication");
    assert!(
        missed_without_dominance > 0,
        "the grid contains a cut that is not dominant and does miss a fact"
    );
}

/// Cuts on different clocks are not ordered: identical sequence, decision cut and observation on
/// another clock still do not make one cut observe what the other does.
#[rstest]
fn cuts_on_different_clocks_do_not_observe_at_least_one_another() {
    let here = readback_for(proposal("AAPL", None, 55, 6));
    let elsewhere_head = build_head_fact(
        &MarketDataClockAdmission {
            cut_kind: MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: "ZYXWVUTSRQPONMLKJIHGFEDCBA987654".into(),
            clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
            monotonic_sequence: 1,
            wall_observed: 60,
            decision_cut: 60,
            valid_through: 100,
            restart_continuity_digest: d(90),
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        },
        None,
    )
    .unwrap();
    let fact = build_fact(proposal("AAPL", None, 55, 6), &elsewhere_head.handoff, None).unwrap();
    let elsewhere = build_cut(
        &request("AAPL", 59, &elsewhere_head),
        vec!["AAPL".into()],
        std::slice::from_ref(&fact),
        fact.clock.clone(),
    )
    .unwrap();

    assert!(here.cut().observes_at_least(here.cut()));
    assert_eq!(
        (
            elsewhere.clock.monotonic_sequence,
            elsewhere.decision_cut,
            elsewhere.owner_observation
        ),
        (
            here.cut().clock.monotonic_sequence,
            here.cut().decision_cut,
            here.cut().owner_observation
        ),
        "only the clock differs"
    );
    assert!(!here.cut().observes_at_least(&elsewhere));
    assert!(!elsewhere.observes_at_least(here.cut()));
}

#[rstest]
fn canonical_fact_codec_is_domain_separated_strict_and_complete() {
    let clock = head(1, 60, 100);
    let fact = build_fact(proposal("AAPL", None, 55, 6), &clock.handoff, None).unwrap();
    assert_eq!(decode_fact(fact.canonical_bytes()).unwrap(), fact);
    assert_eq!(
        fact.identity(),
        codec::identity(codec::FACT_DOMAIN, fact.canonical_bytes())
    );
    assert_ne!(
        fact.identity(),
        codec::identity(codec::CUT_DOMAIN, fact.canonical_bytes())
    );

    let mut trailing = fact.canonical_bytes().to_vec();
    trailing.push(0);
    assert_eq!(
        decode_fact(&trailing),
        Err(InstrumentMasterError::CodecMismatch)
    );
    let mut version = fact.canonical_bytes().to_vec();
    version[1] = 2;
    assert_eq!(
        decode_fact(&version),
        Err(InstrumentMasterError::CodecMismatch)
    );
    assert_eq!(
        fact.identity().as_bytes(),
        &[
            0xc3, 0x55, 0xce, 0x0c, 0xd8, 0x3a, 0x94, 0xda, 0xbc, 0x87, 0x06, 0x20, 0x7c, 0x71,
            0x53, 0x9b, 0x66, 0x51, 0x0a, 0x0b, 0x06, 0x84, 0x08, 0x92, 0x9c, 0x8e, 0x28, 0x2f,
            0xf3, 0xa7, 0x58, 0x72,
        ]
    );
}

#[rstest]
fn decimal_mapping_interval_and_clock_boundaries_fail_closed() {
    let clock = head(1, 60, 100);
    let mut invalid = proposal("AAPL", None, 55, 6);
    invalid.price_increment = InstrumentDecimal {
        mantissa: 10,
        scale: 2,
    };
    assert_eq!(
        build_fact(invalid, &clock.handoff, None),
        Err(InstrumentMasterError::InvalidFact)
    );
    let mut invalid = proposal("AAPL", None, 55, 6);
    invalid.effective_until = Some(10);
    assert_eq!(
        build_fact(invalid, &clock.handoff, None),
        Err(InstrumentMasterError::InvalidFact)
    );
    let mut expired = proposal("AAPL", None, 100, 6);
    expired.provider_available = 90;
    expired.retrieval = 91;
    expired.correction_publication = 92;
    assert_eq!(
        build_fact(expired, &clock.handoff, None),
        Err(InstrumentMasterError::ClockExpired)
    );
    let short_clock = build_head_fact(
        &MarketDataClockAdmission {
            clock_identity: "short".into(),
            ..MarketDataClockAdmission {
                cut_kind: MarketDataClockCutKind::MarketDataAsOf,
                clock_identity: String::new(),
                clock_epoch: "abcdefghijklmnopqrstuvwxyzABCDEF".into(),
                monotonic_sequence: 1,
                wall_observed: 60,
                decision_cut: 60,
                valid_through: 100,
                restart_continuity_digest: d(90),
                uncertainty_bound: 1,
                skew_bound: 2,
                comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
            }
        },
        None,
    )
    .unwrap();
    assert_eq!(
        build_fact(proposal("AAPL", None, 55, 6), &short_clock.handoff, None),
        Err(InstrumentMasterError::ClockMismatch)
    );
}

#[rstest]
fn correction_chain_selects_unique_maximal_without_retroactive_visibility() {
    let clock = head(2, 90, 120);
    let first = build_fact(proposal("AAPL", None, 50, 6), &clock.handoff, None).unwrap();
    let successor = build_fact(
        proposal("AAPL", Some(first.digest()), 80, 6),
        &clock.handoff,
        None,
    )
    .unwrap();
    validate_fact_graph(&[first.clone(), successor.clone()]).unwrap();
    let early = select_facts(
        &[first.clone(), successor.clone()],
        &["AAPL".into()],
        50,
        70,
        90,
        &first.clock,
    )
    .unwrap();
    assert_eq!(early[0].digest(), first.digest());
    let late = select_facts(
        &[first, successor.clone()],
        &["AAPL".into()],
        50,
        85,
        90,
        &successor.clock,
    )
    .unwrap();
    assert_eq!(late[0].digest(), successor.digest());
}

#[rstest]
fn predecessor_missing_branch_cycle_and_unrelated_overlap_are_rejected() {
    let clock = head(1, 90, 120);
    let root = build_fact(proposal("AAPL", None, 50, 6), &clock.handoff, None).unwrap();
    let left = build_fact(
        proposal("AAPL", Some(root.digest()), 60, 6),
        &clock.handoff,
        None,
    )
    .unwrap();
    let right = build_fact(
        proposal("AAPL", Some(root.digest()), 70, 6),
        &clock.handoff,
        None,
    )
    .unwrap();
    assert_eq!(
        validate_fact_graph(&[root.clone(), left, right]),
        Err(InstrumentMasterError::PredecessorBranch)
    );
    let missing = build_fact(proposal("AAPL", Some(d(99)), 60, 6), &clock.handoff, None).unwrap();
    assert_eq!(
        validate_fact_graph(&[missing]),
        Err(InstrumentMasterError::MissingPredecessor)
    );
    let other_root = build_fact(proposal("AAPL", None, 60, 7), &clock.handoff, None).unwrap();
    assert_eq!(
        validate_fact_graph(&[root.clone(), other_root]),
        Err(InstrumentMasterError::InvalidOverlap)
    );
    let mut cycle = root;
    cycle.proposal.predecessor_fact_digest = Some(cycle.digest());
    assert_eq!(
        validate_fact_graph(&[cycle]),
        Err(InstrumentMasterError::PredecessorCycle)
    );
}

#[rstest]
fn exact_scope_and_nested_fact_cut_receipt_readback_equalities_are_enforced() {
    let clock = head(1, 60, 100);
    let fact = build_fact(proposal("AAPL", None, 55, 6), &clock.handoff, None).unwrap();
    let request = request("AAPL", 59, &clock);
    let cut = build_cut(
        &request,
        vec!["AAPL".into()],
        std::slice::from_ref(&fact),
        fact.clock.clone(),
    )
    .unwrap();
    assert_eq!(decode_cut(cut.canonical_bytes()).unwrap(), cut);
    let receipt = build_receipt(&request, std::slice::from_ref(&fact), &cut, d(30), 1).unwrap();
    let readback = build_readback(&receipt).unwrap();
    assert!(super::verify_instrument_master_readback(&readback));
    assert_eq!(readback.receipt_identity(), readback.outbox_identity());
    let mut tampered = readback;
    tampered.facts[0].canonical_bytes.push(0);
    assert!(!super::verify_instrument_master_readback(&tampered));
    tampered.facts[0].canonical_bytes.pop();
    tampered.cut.identity = d(99);
    assert!(!super::verify_instrument_master_readback(&tampered));

    let mut wrong = request;
    wrong.scope = InstrumentMasterScopeV1::ExactInstrument("MSFT".into());
    assert_eq!(
        build_cut(
            &wrong,
            vec!["AAPL".into()],
            &[fact],
            tampered.cut.clock.clone()
        ),
        Err(InstrumentMasterError::MembershipMismatch)
    );
}

#[rstest]
fn a_perpetual_described_as_the_venue_describes_it_crosses_the_v2_bridge() {
    // The fixture above builds its perpetual by overriding an equity's class and currencies and
    // keeping the equity's increments, calendar, session and time zone. So the projection has only
    // ever been shown a perpetual with a two-decimal tick, a whole-number step and an exchange
    // session day - none of which a perpetual has. This states the venue's own terms for
    // `BTCUSDT-PERP.BINANCE`: `PRICE_FILTER.tickSize` 0.10 and `LOT_SIZE.stepSize` 0.001 from
    // `fapi.binance.com/fapi/v1/exchangeInfo`, on the continuous clock this venue keeps.
    let mut proposal = crypto_perpetual_proposal("BTCUSDT-PERP.BINANCE");
    proposal.mappings = vec![InstrumentVenueSourceMapping {
        venue_identity: "BINANCE".into(),
        source_identity: "BINANCE_USDM".into(),
        source_instrument: b"BTCUSDT".to_vec(),
    }];
    proposal.base_currency = Some("BTC".into());
    proposal.price_increment = InstrumentDecimal {
        mantissa: 1,
        scale: 1,
    };
    proposal.quantity_increment = InstrumentDecimal {
        mantissa: 1,
        scale: 3,
    };
    proposal.calendar_identity = "CRYPTO-CONTINUOUS-V1".into();
    proposal.session_identity = "CRYPTO-CONTINUOUS-V1".into();
    proposal.time_zone_identity = "Etc/UTC".into();

    let readback = readback_for(proposal);
    let terms = readback
        .project_validated_v1_crypto_perpetual_structural_public_terms(
            "BTCUSDT-PERP.BINANCE",
            "BINANCE",
            "BINANCE_USDM",
        )
        .expect("a perpetual stated in the venue's own terms projects");

    assert_eq!(terms.raw_symbol(), "BTCUSDT");
    assert_eq!(terms.base_currency(), "BTC");
    assert_eq!(terms.quote_currency(), "USDT");
    assert_eq!(terms.settlement_currency(), "USDT");
    assert_eq!(
        terms.margin_currency(),
        Some("USDT"),
        "a perpetual is margined, and the projection carries which asset margins it"
    );
    assert_eq!(terms.price_increment().scale, 1, "a 0.10 tick, not 0.01");
    assert_eq!(terms.quantity_increment().scale, 3, "a 0.001 step, not 1");
    assert_eq!(terms.calendar_identity(), "CRYPTO-CONTINUOUS-V1");
    assert_eq!(
        terms.time_zone_identity(),
        "Etc/UTC",
        "this venue never closes, so it keeps no exchange session day"
    );
}

#[rstest]
fn v1_public_terms_projection_preserve_exact_mapping_terms_and_owner_evidence() {
    let readback = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    let terms = readback
        .project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        )
        .unwrap();

    assert_eq!(terms.readback_identity(), readback.identity());
    assert_eq!(terms.request_identity(), d(21));
    assert_eq!(terms.request_meaning_digest(), d(22));
    assert_eq!(terms.cut_identity(), readback.cut().identity());
    assert_eq!(terms.receipt_identity(), readback.receipt_identity());
    assert_eq!(terms.outbox_identity(), readback.outbox_identity());
    assert_eq!(terms.stable_correlation(), d(23));
    assert_eq!(terms.store_generation_identity(), d(30));
    assert_eq!(terms.store_append_sequence(), 7);
    assert_eq!(terms.fact_identity(), readback.facts()[0].identity());
    assert_eq!(terms.predecessor_fact_digest(), None);
    assert_eq!(terms.canonical_identity(), "ETHUSDT-PERP.SIM");
    assert_eq!(terms.venue_identity(), "SIM");
    assert_eq!(terms.source_identity(), "BINANCE");
    assert_eq!(terms.source_instrument(), b"ETHUSDT-PERP");
    assert_eq!(terms.raw_symbol(), "ETHUSDT-PERP");
    assert_eq!(terms.instrument_class(), InstrumentClass::CryptoPerpetual);
    assert_eq!(terms.base_currency(), "ETH");
    assert_eq!(terms.quote_currency(), "USDT");
    assert_eq!(terms.settlement_currency(), "USDT");
    assert_eq!(terms.margin_currency(), Some("USDT"));
    assert_eq!(
        terms.price_increment(),
        InstrumentDecimal {
            mantissa: 1,
            scale: 2
        }
    );
    assert_eq!(
        terms.quantity_increment(),
        InstrumentDecimal {
            mantissa: 1,
            scale: 0
        }
    );
    assert_eq!(
        terms.contract_multiplier(),
        InstrumentDecimal {
            mantissa: 1,
            scale: 0
        }
    );
    assert_eq!(terms.calendar_identity(), "XNYS-CALENDAR-V1");
    assert_eq!(terms.session_identity(), "XNYS-REGULAR-V1");
    assert_eq!(terms.time_zone_identity(), "America/New_York");
    assert_eq!(terms.lifecycle_frontier(), d(1));
    assert_eq!(terms.corporate_action_frontier(), d(2));
    assert_eq!(terms.historical_membership_frontier(), d(3));
    assert_eq!(terms.market_semantics_identity(), d(4));
    assert_eq!(terms.source_frontier(), d(5));
    assert_eq!(terms.correction_frontier(), d(6));
    assert_eq!(terms.effective_from().as_u64(), 10);
    assert_eq!(terms.effective_until().unwrap().as_u64(), 100);
    assert_eq!(terms.provider_available().as_u64(), 52);
    assert_eq!(terms.retrieval().as_u64(), 53);
    assert_eq!(terms.correction_publication().as_u64(), 54);
    assert_eq!(terms.owner_observation().as_u64(), 55);
    assert_eq!(terms.effective_instant().as_u64(), 50);
    assert_eq!(terms.decision_cut(), 60);
}

#[rstest]
fn v1_public_terms_projection_cannot_claim_complete_native_construction() {
    let readback = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    let projection = readback
        .project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        )
        .unwrap();

    let unavailable = projection
        .require_complete_native_crypto_perpetual_construction()
        .unwrap_err();
    assert_eq!(
        unavailable.missing_owner_fields(),
        &[
            MissingNativeCryptoPerpetualOwnerFieldV1::IsInverse,
            MissingNativeCryptoPerpetualOwnerFieldV1::LotSize,
            MissingNativeCryptoPerpetualOwnerFieldV1::ContractStatus,
            MissingNativeCryptoPerpetualOwnerFieldV1::LimitDispositions,
        ]
    );
}

#[rstest]
fn v1_public_terms_projection_reject_missing_and_ambiguous_mapping_or_currency() {
    let readback = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "OTHER",
        ),
        Err(V1StructuralPublicTermsProjectionError::MissingMapping)
    );

    let mut ambiguous = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    ambiguous.mappings.push(InstrumentVenueSourceMapping {
        venue_identity: "SIM".into(),
        source_identity: "BINANCE".into(),
        source_instrument: b"ETHUSDT-PERP-ALT".to_vec(),
    });
    ambiguous.mappings.sort_by(|left, right| {
        (
            &left.venue_identity,
            &left.source_identity,
            &left.source_instrument,
        )
            .cmp(&(
                &right.venue_identity,
                &right.source_identity,
                &right.source_instrument,
            ))
    });
    let readback = readback_for(ambiguous);
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::AmbiguousMapping)
    );

    let mut missing_currency = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    missing_currency.base_currency = None;
    let readback = readback_for(missing_currency);
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::MissingField(
            V1StructuralPublicTermsField::BaseCurrency
        ))
    );
}

#[rstest]
fn v1_public_terms_projection_rejects_whitespace_raw_symbol_and_currency() {
    let mut whitespace_symbol = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    whitespace_symbol.mappings[0].source_instrument = b"   ".to_vec();
    let readback = readback_for(whitespace_symbol);
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::InvalidPublicTerm(
            V1StructuralPublicTermsField::SourceInstrument
        ))
    );

    let mut whitespace_currency = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    whitespace_currency.base_currency = Some("   ".into());
    let readback = readback_for(whitespace_currency);
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::InvalidPublicTerm(
            V1StructuralPublicTermsField::BaseCurrency
        ))
    );
}

#[rstest]
fn v1_public_terms_projection_reject_unsupported_native_values_and_cross_readback() {
    let readback = readback_for(proposal("AAPL", None, 55, 6));
    assert_eq!(
        readback
            .project_validated_v1_crypto_perpetual_structural_public_terms("AAPL", "XNAS", "SIP"),
        Err(V1StructuralPublicTermsProjectionError::UnsupportedClass(
            InstrumentClass::Equity
        ))
    );

    let mut invalid_decimal = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    invalid_decimal.price_increment = InstrumentDecimal {
        mantissa: 1,
        scale: 38,
    };
    let readback = readback_for(invalid_decimal);
    assert_eq!(
        readback.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::InvalidPublicTerm(
            V1StructuralPublicTermsField::PriceIncrement
        ))
    );

    let mut cross_spliced = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    cross_spliced.cut.resolutions[0].fact_digest = d(99);
    assert_eq!(
        cross_spliced.project_validated_v1_crypto_perpetual_structural_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(V1StructuralPublicTermsProjectionError::InvalidReadback)
    );
}

#[rstest]
fn cut_codec_rejects_trailing_reserved_and_reordered_members() {
    let clock = head(1, 60, 100);
    let aapl = build_fact(proposal("AAPL", None, 55, 6), &clock.handoff, None).unwrap();
    let msft = build_fact(proposal("MSFT", None, 55, 6), &clock.handoff, None).unwrap();
    let mut request = request("AAPL", 59, &clock);
    request.scope = InstrumentMasterScopeV1::UniverseSelectionRecord(d(40));
    let cut = build_cut(
        &request,
        vec!["AAPL".into(), "MSFT".into()],
        &[aapl, msft],
        super::authority::clock_projection(&clock.handoff, None).unwrap(),
    )
    .unwrap();
    let mut trailing = cut.canonical_bytes().to_vec();
    trailing.push(0);
    assert_eq!(
        decode_cut(&trailing),
        Err(InstrumentMasterError::CodecMismatch)
    );
    assert_eq!(
        build_cut(&request, vec!["MSFT".into(), "AAPL".into()], &[], cut.clock),
        Err(InstrumentMasterError::MembershipMismatch)
    );
}
