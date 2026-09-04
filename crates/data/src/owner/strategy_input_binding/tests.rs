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
