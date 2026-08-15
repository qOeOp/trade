use std::collections::BTreeSet;

use rstest::rstest;
use vibe_core::UnixNanos;
use vibe_model::{
    data::{Bar, BarType},
    types::{Price, Quantity},
};

use vibe_strategy_factory::{
    FormationFamilyDisposition, FrozenStrategyFamily, NativeProducerVerificationRequest,
    ObservationFrameDisposition, ObservationFrameGate, ObservationFrameIneligibility,
    ObservationStamp, RepresentativeResearchIntent, StrategyFamilyError,
    artifact::StrategyArtifact, run_frozen_complex_formation,
};

fn research_bar(owner_key: &str, observed_ns: u64, available_ns: u64) -> Bar {
    Bar::new(
        BarType::from(owner_key),
        Price::from("100.00"),
        Price::from("101.00"),
        Price::from("99.00"),
        Price::from("100.50"),
        Quantity::from("1.000"),
        UnixNanos::from(observed_ns),
        UnixNanos::from(available_ns),
    )
}

#[rstest]
fn public_research_consumer_fails_closed_until_typed_context_owners_are_bound() {
    let intent =
        RepresentativeResearchIntent::frozen_representative().expect("representative intent");
    assert_eq!(
        intent.runtime_admission(),
        "DESIGN_FROZEN_EXECUTION_NOT_ADMITTED"
    );
    assert!(intent.is_tradable_candidate("BTCUSDT-PERP.BINANCE"));

    for context in [
        "FED:DTWEXBGS",
        "FED:DEXJPUS",
        "EIA:DCOILWTICO",
        "FRED:DGS2",
        "FRED:DGS10",
        "PAXGUSDT.BINANCE",
        "ICE:DXY",
        "GOLD",
    ] {
        assert!(!intent.is_tradable_candidate(context));
    }

    let decision_ns = 2_000_000_000_000_000_000;
    let observations = [
        ("btc_d1", "BTCUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        ("btc_h1", "BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        ("btc_h4", "BTCUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL"),
        ("btc_m15", "BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
        ("eth_d1", "ETHUSDT-PERP.BINANCE-1-DAY-LAST-EXTERNAL"),
        ("eth_h1", "ETHUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL"),
        ("eth_h4", "ETHUSDT-PERP.BINANCE-4-HOUR-LAST-EXTERNAL"),
        ("eth_m15", "ETHUSDT-PERP.BINANCE-15-MINUTE-LAST-EXTERNAL"),
    ]
    .into_iter()
    .map(|(channel, owner_key)| {
        let observed_ns = if channel == "btc_h1" {
            decision_ns - 3_600_000_000_001
        } else {
            decision_ns
        };
        ObservationStamp::from_untrusted_bar(
            channel,
            &research_bar(owner_key, observed_ns, decision_ns),
        )
        .expect("untrusted native Bar temporal projection")
    })
    .collect::<Vec<_>>();
    let frames = ObservationFrameGate::replay(&intent, observations).expect("PIT replay");
    assert_eq!(frames.len(), 1);
    assert_eq!(
        frames[0].disposition(),
        ObservationFrameDisposition::Incomplete
    );
    assert_eq!(frames[0].observations().len(), 8);
    assert_eq!(frames[0].ineligibility().len(), 7);
    assert!(
        frames[0]
            .ineligibility()
            .contains(&ObservationFrameIneligibility::Stale {
                age_ns: 3_600_000_000_001,
                channel_id: "btc_h1".to_string(),
                max_staleness_ns: 3_600_000_000_000,
            })
    );

    for context_channel in [
        "broad_usd_d1",
        "paxg_d1",
        "us10y_d1",
        "us2y_d1",
        "usdjpy_d1",
        "wti_d1",
    ] {
        assert!(
            frames[0]
                .ineligibility()
                .contains(&ObservationFrameIneligibility::Missing {
                    channel_id: context_channel.to_string(),
                })
        );
    }
    assert_eq!(frames[0].intent_digest(), intent.digest());
    assert!(!frames[0].source_provenance_verified());
}

fn assert_common_family_consumer(
    family: &FrozenStrategyFamily,
    expected_trials: usize,
) -> Vec<StrategyArtifact> {
    let mut artifact_digests = BTreeSet::new();
    let mut trial_ids = BTreeSet::new();
    let mut wasm_digests = BTreeSet::new();

    let artifacts = family.materialize_all().expect("bounded family artifacts");
    assert_eq!(artifacts.len(), expected_trials);
    for (trial, first) in family.trials().iter().zip(&artifacts) {
        let recovered = family
            .materialize(trial)
            .expect("exact artifact recovery through the same port");
        assert_eq!(first, &recovered);
        let identity = first.identity();
        assert_eq!(identity.intent_digest, family.intent().content_digest());
        assert_eq!(identity.trial_id.as_deref(), Some(trial.trial_id()));
        assert_eq!(
            identity.parameters_digest.as_deref(),
            Some(trial.parameters_digest())
        );
        assert_eq!(
            identity.strategy_spec_digest.as_deref(),
            family.strategy_spec_digest()
        );
        artifact_digests.insert(identity.artifact_digest.clone());
        trial_ids.insert(identity.trial_id.clone().expect("trial id"));
        wasm_digests.insert(identity.wasm_digest.clone());
    }

    assert_eq!(artifact_digests.len(), expected_trials);
    assert_eq!(trial_ids.len(), expected_trials);
    assert_eq!(wasm_digests.len(), 1);
    artifacts
}

#[rstest]
fn public_artifact_consumer_is_strategy_shape_independent_and_rejects_foreign_trials() {
    let simple = FrozenStrategyFamily::frozen_pilot().expect("simple frozen family");
    let complex = FrozenStrategyFamily::frozen_price_only().expect("complex frozen family");

    let simple_artifacts = assert_common_family_consumer(&simple, 1);
    let complex_artifacts = assert_common_family_consumer(&complex, 20);
    assert_ne!(simple.family_digest(), complex.family_digest());
    assert!(
        simple
            .trials()
            .iter()
            .any(|trial| trial.variant_id() == "full")
    );
    assert!(
        simple
            .trials()
            .iter()
            .all(|trial| trial.variant_id() == "full")
    );
    assert!(
        complex
            .trials()
            .iter()
            .any(|trial| trial.variant_id() == "full")
    );
    assert!(
        complex
            .trials()
            .iter()
            .any(|trial| trial.variant_id() == "without-dynamic-exit")
    );
    assert!(simple.strategy_spec_digest().is_some());
    assert!(complex.strategy_spec_digest().is_some());
    assert_eq!(simple_artifacts[0].identity().schema_version, 9);
    assert_eq!(complex_artifacts[0].identity().schema_version, 10);
    assert_eq!(
        simple_artifacts[0]
            .identity()
            .program_profile
            .schema_version,
        1
    );
    assert_eq!(
        complex_artifacts[0]
            .identity()
            .program_profile
            .schema_version,
        1
    );

    assert_eq!(
        complex.materialize(&simple.trials()[0]),
        Err(StrategyFamilyError::ForeignTrial)
    );
    assert_eq!(
        simple.materialize(&complex.trials()[0]),
        Err(StrategyFamilyError::ForeignTrial)
    );
}

#[rstest]
fn public_complex_formation_consumer_receives_only_the_authoritative_receipt() {
    let receipt = run_frozen_complex_formation(
        std::path::Path::new("/definitely/not/a/strategy-factory-formation-cache"),
        NativeProducerVerificationRequest::from_bundle(
            "/definitely/not/a/strategy-factory-attestation-bundle",
        ),
    )
    .expect("producer rejection remains an authoritative software receipt");
    assert_eq!(
        receipt.disposition(),
        FormationFamilyDisposition::SoftwareRejected
    );
    assert_eq!(receipt.economically_selected_parameter_id(), None);
    assert_eq!(receipt.selected_parameter_id(), None);
    assert_eq!(receipt.formation_robustness_passed(), None);
    assert_eq!(receipt.formation_robustness_diagnostics(), None);
}

#[rstest]
fn pilot_family_artifact_is_deterministic_and_bound() {
    let family = FrozenStrategyFamily::frozen_pilot().expect("pilot family");
    let trial = &family.trials()[0];
    let first = family.materialize(trial).expect("first artifact");
    let second = family.materialize(trial).expect("second artifact");
    assert_eq!(first, second);
    let identity = first.identity();
    assert_eq!(identity.schema_version, 9);
    assert_eq!(identity.trial_id.as_deref(), Some(trial.trial_id()));
    assert_eq!(
        identity.parameters_digest.as_deref(),
        Some(trial.parameters_digest())
    );
    assert_eq!(
        identity.guest_source_locator,
        "program-source-capsule-v1.tar"
    );
    assert_eq!(identity.build_recipe_locator, "program-build-recipe-v1.jcs");
    assert_eq!(identity.program_profile.schema_version, 1);
}
