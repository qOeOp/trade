use super::{
    BACKTEST_OWNER_V1, InstrumentClass, InstrumentDecimal, InstrumentMasterError,
    InstrumentMasterFactProposalV1, InstrumentMasterScopeV1, InstrumentVenueSourceMapping,
    NativePublicTermsFieldV1, NativePublicTermsValidationErrorV1,
    UntrustedInstrumentMasterRequestV1,
    authority::{
        build_cut, build_fact, build_readback, build_receipt, decode_cut, decode_fact,
        select_facts, validate_fact_graph,
    },
    codec,
};
use crate::owner::{
    shared_time_evidence::build_head_fact,
    source_binding::{
        BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule,
        MarketDataClockCutKind,
    },
};
use rstest::rstest;

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn head(sequence: u64, wall: u64, valid: u64) -> super::super::shared_time_evidence::ClockHeadFact {
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
fn v1_native_public_terms_preserve_exact_mapping_terms_and_owner_evidence() {
    let readback = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    let terms = readback
        .validate_native_crypto_perpetual_public_terms("ETHUSDT-PERP.SIM", "SIM", "BINANCE")
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
fn v1_native_public_terms_reject_missing_and_ambiguous_mapping_or_currency() {
    let readback = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    assert_eq!(
        readback.validate_native_crypto_perpetual_public_terms("ETHUSDT-PERP.SIM", "SIM", "OTHER",),
        Err(NativePublicTermsValidationErrorV1::MissingMapping)
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
        readback.validate_native_crypto_perpetual_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(NativePublicTermsValidationErrorV1::AmbiguousMapping)
    );

    let mut missing_currency = crypto_perpetual_proposal("ETHUSDT-PERP.SIM");
    missing_currency.base_currency = None;
    let readback = readback_for(missing_currency);
    assert_eq!(
        readback.validate_native_crypto_perpetual_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(NativePublicTermsValidationErrorV1::MissingField(
            NativePublicTermsFieldV1::BaseCurrency
        ))
    );
}

#[rstest]
fn v1_native_public_terms_reject_unsupported_native_values_and_cross_readback() {
    let readback = readback_for(proposal("AAPL", None, 55, 6));
    assert_eq!(
        readback.validate_native_crypto_perpetual_public_terms("AAPL", "XNAS", "SIP"),
        Err(NativePublicTermsValidationErrorV1::UnsupportedClass(
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
        readback.validate_native_crypto_perpetual_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(NativePublicTermsValidationErrorV1::NativeRepresentation(
            NativePublicTermsFieldV1::PriceIncrement
        ))
    );

    let mut cross_spliced = readback_for(crypto_perpetual_proposal("ETHUSDT-PERP.SIM"));
    cross_spliced.cut.resolutions[0].fact_digest = d(99);
    assert_eq!(
        cross_spliced.validate_native_crypto_perpetual_public_terms(
            "ETHUSDT-PERP.SIM",
            "SIM",
            "BINANCE",
        ),
        Err(NativePublicTermsValidationErrorV1::InvalidReadback)
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
