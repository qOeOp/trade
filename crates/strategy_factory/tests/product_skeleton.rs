use std::{collections::BTreeSet, fs};

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
    artifact::StrategyArtifact, materialize_strategy_project_scaffold,
    run_frozen_complex_formation, run_frozen_representative_formation,
    seal_strategy_project_proposal,
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
fn public_research_consumer_is_software_control_only() {
    let intent =
        RepresentativeResearchIntent::frozen_representative().expect("representative intent");
    assert_eq!(
        intent.runtime_admission(),
        "PROGRAM_FIRST_REPRESENTATIVE_SOFTWARE_CONTROL_ONLY"
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
fn public_artifact_debug_redacts_executable_material() {
    let family = FrozenStrategyFamily::frozen_price_only().expect("complex frozen family");
    let artifact = family
        .materialize(&family.trials()[0])
        .expect("sealed artifact");
    let debug = format!("{artifact:?}");
    assert!(debug.contains(&artifact.identity().artifact_digest));
    assert!(!debug.contains("wasm: ["));
    assert!(!debug.contains("[0, 97, 115, 109"));
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
fn public_project_consumer_materializes_simple_and_complex_families_through_one_port() {
    for family in [
        FrozenStrategyFamily::frozen_pilot().expect("simple frozen family"),
        FrozenStrategyFamily::frozen_price_only().expect("complex frozen family"),
    ] {
        let parent = tempfile::tempdir().expect("project parent");
        let manifest = family
            .program_project()
            .expect("family project")
            .materialize(parent.path())
            .expect("inspectable project");
        assert_eq!(
            manifest.file_name().unwrap(),
            "strategy-program-project-v1.jcs"
        );
        assert!(manifest.is_file());
        assert!(
            manifest
                .ancestors()
                .any(|ancestor| ancestor.join(".git").is_dir())
        );
    }
}

#[rstest]
fn public_generic_scaffold_reuses_the_existing_sdk_project() {
    let parent = tempfile::tempdir().expect("scaffold parent");
    let manifest =
        materialize_strategy_project_scaffold(parent.path()).expect("generic project scaffold");
    assert_eq!(
        manifest.file_name().unwrap(),
        "strategy-program-project-v1.jcs"
    );
    assert!(manifest.is_file());
    assert!(
        manifest
            .ancestors()
            .any(|ancestor| ancestor.join(".git").is_dir())
    );
    let intent = manifest.with_file_name("research-intent-proposal-v1.jcs");
    assert!(intent.is_file());
    let manifest_text = fs::read_to_string(&manifest).unwrap();
    assert_eq!(
        manifest_text
            .matches("research-intent-proposal-v1.jcs")
            .count(),
        1
    );
}

#[rstest]
#[ignore = "requires Docker to seal and reseal one caller-edited project"]
fn materially_different_external_project_is_artifact_only_and_exactly_recoverable() {
    const NOOP_PROGRAM: &str = concat!(
        "#![no_std]\n",
        "use core::panic::PanicInfo;\n",
        "use strategy_factory_program_sdk::{ActionEncoder, Frame, ProgramFault, ",
        "StrategyProgram, export_strategy_program};\n",
        "struct NoopProgram;\n",
        "impl StrategyProgram for NoopProgram {\n",
        "fn on_frame(&mut self, _frame: &Frame<'_>, _actions: &mut ActionEncoder<'_>) ",
        "-> Result<(), ProgramFault> { Ok(()) }\n}\n",
        "export_strategy_program!(NoopProgram, NoopProgram);\n",
        "#[panic_handler] fn panic(_info: &PanicInfo<'_>) -> ! { ",
        "core::arch::wasm32::unreachable() }\n",
    );

    let original_parent = tempfile::tempdir().expect("original project parent");
    let manifest = materialize_strategy_project_scaffold(original_parent.path())
        .expect("editable project scaffold");
    let project_root = manifest
        .ancestors()
        .find(|path| path.join(".git").is_dir())
        .expect("private Git project root");
    let source = project_root.join("crates/strategy_factory/programs/pilot/src/lib.rs");
    fs::write(&source, NOOP_PROGRAM).expect("materially different guest source");
    let intent_path = manifest.with_file_name("research-intent-proposal-v1.jcs");
    let mut intent: serde_json::Value =
        serde_json::from_slice(&fs::read(&intent_path).expect("proposal intent template"))
            .expect("proposal intent JSON");
    intent["identity"] = serde_json::json!("session-state-proposal-v1");
    intent["hypothesis"] = serde_json::json!("Session-aware behavior is testable after costs.");
    intent["evaluation"]["holdout"] = serde_json::json!("one-way reserved partition");
    intent["evaluation"]["metrics"][0]["statement"] =
        serde_json::json!("Evaluate net return after declared transaction costs.");
    intent["evidence"][0]["claim"] =
        serde_json::json!("Session boundaries can change market behavior.");
    intent["evidence"][0]["locator"] = serde_json::json!("doi:10.1093/rfs/hhi027");
    intent["falsifiers"][0] = serde_json::json!("Costs exceed gross returns in every coordinate.");
    let mut intent_bytes = serde_json::to_vec(&intent).expect("canonical proposal intent");
    intent_bytes.push(b'\n');
    fs::write(&intent_path, &intent_bytes).expect("candidate research intent proposal");

    let proposal = seal_strategy_project_proposal(&manifest).expect("candidate-only proposal");
    let identity = proposal.artifact().identity().clone();
    let debug = format!("{proposal:?}");
    assert!(debug.contains(&identity.artifact_digest));
    assert!(!debug.contains("#![no_std]"));
    assert!(!debug.contains("cargo_vendor_locked_versioned_dirs"));
    assert_eq!(identity.trial_id, None);
    assert_eq!(identity.parameters_digest, None);
    assert_eq!(identity.strategy_spec_digest, None);
    assert_eq!(identity.schema_version, 2);
    assert_eq!(proposal.intent().identity(), "session-state-proposal-v1");
    assert_eq!(identity.intent_digest, proposal.intent().content_digest());
    assert_eq!(proposal.intent().canonical_bytes(), intent_bytes);
    original_parent
        .close()
        .expect("delete mutable original project");

    let recovery_parent = tempfile::tempdir().expect("recovery parent");
    let recovered_manifest = proposal
        .materialize(recovery_parent.path())
        .expect("retained exact source capsule");
    let recovered = proposal
        .recover(&recovered_manifest)
        .expect("exact proposal recovery");
    assert_eq!(recovered.identity(), &identity);

    let recovered_root = recovered_manifest
        .ancestors()
        .find(|path| path.join(".git").is_dir())
        .expect("recovered Git project root");
    fs::write(
        recovered_root.join("crates/strategy_factory/programs/pilot/src/lib.rs"),
        NOOP_PROGRAM.replace("Ok(())", "Err(ProgramFault::ProgramRejected)"),
    )
    .expect("mutate recovered proposal");
    assert!(proposal.recover(&recovered_manifest).is_err());
    fs::write(
        recovered_root.join("crates/strategy_factory/programs/pilot/src/lib.rs"),
        NOOP_PROGRAM,
    )
    .expect("restore recovered source");
    fs::write(
        recovered_manifest.with_file_name("research-intent-proposal-v1.jcs"),
        String::from_utf8(intent_bytes)
            .expect("UTF-8 proposal intent")
            .replace("session-state-proposal-v1", "session-state-proposal-v2"),
    )
    .expect("mutate recovered intent only");
    assert!(proposal.recover(&recovered_manifest).is_err());
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
fn rejected_representative_producer_binds_all_trials_before_any_data_effect() {
    let root = tempfile::tempdir().unwrap();
    let derived = root.path().join("derived");
    let receipt = run_frozen_representative_formation(
        &root.path().join("missing-market"),
        &root.path().join("missing-alfred"),
        &root.path().join("missing-schedule"),
        &derived,
        NativeProducerVerificationRequest::from_bundle(root.path().join("missing-bundle")),
    )
    .expect("producer rejection remains an authoritative family receipt");
    assert_eq!(
        receipt.disposition(),
        FormationFamilyDisposition::SoftwareRejected
    );
    assert_eq!(receipt.trial_count(), 40);
    assert!(!derived.exists());
    let value: serde_json::Value = serde_json::from_slice(&receipt.to_bytes().unwrap()).unwrap();
    assert!(
        value["body"]["qualification_policy"]
            .as_str()
            .unwrap()
            .starts_with("NOT_ELIGIBLE_NO_RESERVED_ONE_WAY_HOLDOUT:")
    );
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
