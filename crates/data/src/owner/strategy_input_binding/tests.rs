use super::*;
use rstest::rstest;

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn request() -> UntrustedStrategyInputBindingRequest {
    UntrustedStrategyInputBindingRequest {
        research_request_identity: d(1),
        strategy_design_identity: d(2),
        input_role_identity: d(3),
        scope: UntrustedStrategyInputScope::ExactInstrument {
            instrument: "XNAS:AAPL".into(),
        },
        field_semantic: MarketDataFieldSemantic::BarClosePrice,
        channel: StrategyInputChannel::Market,
        timeframe: "PT1M".into(),
        unit: StrategyInputUnit::Price,
        scale: 4,
        pit_request_identity: d(4),
        pit_request_digest: d(5),
        snapshot_identity: d(6),
        snapshot_fact_digest: d(7),
        observation_batch_digest: d(8),
        source_binding_identity: d(9),
        source_frontier_digest: d(10),
        correction_frontier_digest: d(11),
        instrument_master_digest: d(12),
        universe_selection_digest: d(13),
        market_semantics_identity: d(14),
        decision_cut: 15,
    }
}

#[rstest]
fn declaration_codec_round_trips_and_every_field_changes_meaning() {
    let original = request();
    let bytes = codec::encode_request_v1(&original).unwrap();
    assert_eq!(codec::decode_request_v1(&bytes).unwrap(), original);
    let meaning = codec::meaning_digest_v1(&bytes).unwrap();
    let mutations: &[fn(&mut UntrustedStrategyInputBindingRequest)] = &[
        |v| v.research_request_identity = d(21),
        |v| v.strategy_design_identity = d(22),
        |v| v.input_role_identity = d(23),
        |v| {
            v.scope = UntrustedStrategyInputScope::ExactInstrument {
                instrument: "XNYS:IBM".into(),
            }
        },
        |v| v.field_semantic = MarketDataFieldSemantic::BarOpenPrice,
        |v| v.channel = StrategyInputChannel::Reference,
        |v| v.timeframe = "PT5M".into(),
        |v| v.unit = StrategyInputUnit::Quantity,
        |v| v.scale = 5,
        |v| v.pit_request_identity = d(24),
        |v| v.pit_request_digest = d(25),
        |v| v.snapshot_identity = d(26),
        |v| v.snapshot_fact_digest = d(27),
        |v| v.observation_batch_digest = d(28),
        |v| v.source_binding_identity = d(29),
        |v| v.source_frontier_digest = d(30),
        |v| v.correction_frontier_digest = d(31),
        |v| v.instrument_master_digest = d(32),
        |v| v.universe_selection_digest = d(33),
        |v| v.market_semantics_identity = d(34),
        |v| v.decision_cut = 35,
    ];

    for mutate in mutations {
        let mut changed = original.clone();
        mutate(&mut changed);
        let changed_bytes = codec::encode_request_v1(&changed).unwrap();
        assert_ne!(changed_bytes, bytes);
        assert_ne!(codec::meaning_digest_v1(&changed_bytes).unwrap(), meaning);
    }
}

#[rstest]
fn declaration_codec_rejects_version_trailing_bytes_and_caps() {
    let bytes = codec::encode_request_v1(&request()).unwrap();
    let mut wrong_version = bytes.clone();
    let version_offset = 4 + b"VIBE_STRATEGY_INPUT_BINDING_DECLARATION_V1".len();
    wrong_version[version_offset + 1] = 2;
    assert_eq!(
        codec::decode_request_v1(&wrong_version),
        Err(codec::CodecError::CodecMismatch)
    );
    let mut trailing = bytes;
    trailing.push(0);
    assert_eq!(
        codec::decode_request_v1(&trailing),
        Err(codec::CodecError::CodecMismatch)
    );
    let mut oversized = request();
    oversized.timeframe = "x".repeat(codec::MAX_TEXT_BYTES + 1);
    assert_eq!(
        codec::encode_request_v1(&oversized),
        Err(codec::CodecError::CapacityExceeded)
    );
}

/// A universe-member request matches its role on the attested coordinates, and the role never
/// names a universe.
///
/// A Design declares `UniverseMembers` with an empty instrument, so a role cannot tell two
/// universes apart; that is left to the registry, which binds the selection through the PIT
/// request's declaration key and the Owner-derived universe frame, and refuses a declaration set
/// whose universe roles name two selections. This pins the other half: the role still has to match
/// on scope, instrument and every semantic coordinate.
#[rstest]
fn a_universe_role_matches_on_its_attested_coordinates() {
    let role = StrategyDesignRoleEntryV1 {
        role_identity: d(3),
        semantic_id: "role-universe".into(),
        fact_class: "MARKET_DATA".into(),
        instrument: String::new(),
        scope: r#"{"kind":"UNIVERSE_MEMBERS"}"#.into(),
        field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".into(),
        channel: "MARKET".into(),
        timeframe: "PT1M".into(),
        unit: "PRICE".into(),
        scale: 4,
        value_type: "I128".into(),
    };
    let mut universe = request();
    universe.scope = UntrustedStrategyInputScope::UniverseSelection {
        selection_identity: d(200),
    };
    assert!(request_matches_authenticated_role_v1(&universe, &role));

    for mismatched in [
        StrategyDesignRoleEntryV1 {
            instrument: "XNAS:AAPL".into(),
            ..role.clone()
        },
        StrategyDesignRoleEntryV1 {
            scope: r#"{"kind":"EXACT_INSTRUMENT"}"#.into(),
            ..role.clone()
        },
        StrategyDesignRoleEntryV1 {
            timeframe: "PT1H".into(),
            ..role.clone()
        },
    ] {
        assert!(!request_matches_authenticated_role_v1(
            &universe,
            &mismatched
        ));
    }

    let mut instrument_set = request();
    instrument_set.scope = UntrustedStrategyInputScope::InstrumentSet {
        instruments: vec!["XNAS:AAPL".into()],
    };
    assert!(!request_matches_authenticated_role_v1(
        &instrument_set,
        &role
    ));

    // The exact-instrument path is untouched: the repair narrows one branch, not the function.
    let exact_role = StrategyDesignRoleEntryV1 {
        instrument: "XNAS:AAPL".into(),
        scope: r#"{"kind":"EXACT_INSTRUMENT"}"#.into(),
        ..role
    };
    assert!(request_matches_authenticated_role_v1(
        &request(),
        &exact_role
    ));
}
