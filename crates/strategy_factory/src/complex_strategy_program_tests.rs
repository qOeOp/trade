use rstest::rstest;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    complex_strategy_compiler::{
        BoundComplexStrategyFrameV1, ComplexStrategyCompileInputV1, ComplexStrategyCompilerError,
        ExactSymbolicInputBindingV1, SymbolicInputBindingReceiptV1,
        UntrustedComplexStrategyFrameV1, UntrustedComplexStrategyInputSampleV1,
    },
    complex_strategy_ir_tests::{dual_tsmom, pair_mean_reversion, parse},
    complex_strategy_program::ComplexStrategyProgramError,
};

#[rstest]
fn pair_zscore_and_dual_tsmom_have_distinct_golden_multi_frame_traces() {
    let mut pair_document = pair_mean_reversion();
    pair_document["features"][3]["operation"]["window"] = Value::from(2);
    pair_document["features"][4]["operation"]["window"] = Value::from(2);
    pair_document["parameters"][0]["value"] = scaled_json(1, 0);
    pair_document["parameters"][1]["value"] = scaled_json(-1, 0);
    let pair = compile(&pair_document);
    let pair_frames = vec![
        exact_frame(&pair, &pair_document, 10, &[10, 10]),
        exact_frame(&pair, &pair_document, 20, &[14, 10]),
        exact_frame(&pair, &pair_document, 30, &[10, 10]),
        exact_frame(&pair, &pair_document, 40, &[10, 10]),
    ];
    let pair_trace = pair.execute(&pair_frames).expect("pair-zscore trace");
    let pair_recomputed = pair
        .execute(&pair_frames)
        .expect("pair-zscore host recomputation");
    assert_eq!(pair_trace, pair_recomputed);
    assert!(contains(pair_trace.canonical_bytes(), b"short_rich_spread"));
    assert!(contains(pair_trace.canonical_bytes(), b"long_cheap_spread"));
    assert!(contains(pair_trace.canonical_bytes(), b"close_at_mean"));

    let mut momentum_document = dual_tsmom();
    momentum_document["features"][1]["operation"]["periods"] = Value::from(2);
    momentum_document["features"][5]["operation"]["periods"] = Value::from(2);
    let momentum = compile(&momentum_document);
    let momentum_frames = vec![
        latest_frame(&momentum, &momentum_document, 10, &[100, 100]),
        latest_frame(&momentum, &momentum_document, 20, &[110, 90]),
        latest_frame(&momentum, &momentum_document, 30, &[120, 80]),
        latest_frame(&momentum, &momentum_document, 40, &[130, 90]),
        latest_frame(&momentum, &momentum_document, 50, &[100, 60]),
    ];
    let momentum_trace = momentum
        .execute(&momentum_frames)
        .expect("dual-instrument TSMOM trace");
    let momentum_recomputed = momentum
        .execute(&momentum_frames)
        .expect("dual-instrument TSMOM host recomputation");
    assert_eq!(momentum_trace, momentum_recomputed);
    assert!(contains(momentum_trace.canonical_bytes(), b"enter_long"));
    assert!(contains(momentum_trace.canonical_bytes(), b"enter_short"));

    assert_ne!(pair.program().identity(), momentum.program().identity());
    assert_ne!(pair_trace, momentum_trace);
    assert_eq!(
        digest(pair_trace.canonical_bytes()),
        "sha256:100bb06c34b3ea044f028f2ef61bf395ce872ccc391d848e028283c83db28454"
    );
    assert_eq!(
        digest(momentum_trace.canonical_bytes()),
        "sha256:ce08565ce0ee309e66740357cf4dc776e35ed02a6428167230640b4d2e0c3426"
    );
}

#[rstest]
fn frame_sealing_rejects_wrong_binding_count_and_exact_cut_semantics() {
    let mut document = pair_mean_reversion();
    document["features"][3]["operation"]["window"] = Value::from(2);
    document["features"][4]["operation"]["window"] = Value::from(2);
    let compiled = compile(&document);
    let mut missing = untrusted_frame(&document, 10, 10, &[10, 10], 0);
    missing.inputs.pop();
    assert!(matches!(
        compiled.seal_frame(missing),
        Err(ComplexStrategyCompilerError::FrameBindingCoverageMismatch)
    ));

    let stale_exact_cut = seal_frame(&compiled, &document, 10, 9, &[10, 10], 0);
    assert_eq!(
        compiled.execute(&[stale_exact_cut]),
        Err(ComplexStrategyProgramError::MarketSemanticsMismatch)
    );
}

#[rstest]
fn compile_input_rejects_a_frame_sealed_by_another_plan() {
    let document = dual_tsmom();
    let original = compile_with_source_seed(&document, b'a');
    let changed = compile_with_source_seed(&document, b'd');
    let original_frame = latest_frame(&original, &document, 10, &[100, 100]);

    assert_ne!(
        original.compile_plan_identity(),
        changed.compile_plan_identity()
    );
    assert_eq!(
        changed.execute(&[original_frame]),
        Err(ComplexStrategyProgramError::FrameBindingMismatch)
    );
}

#[rstest]
fn host_oracle_rejects_conflicting_cross_transition_state_writes() {
    let mut document = dual_tsmom();
    document["features"][1]["operation"]["periods"] = Value::from(1);
    document["features"][5]["operation"]["periods"] = Value::from(1);
    let mut conflicting = document["transitions"][0].clone();
    conflicting["id"] = Value::from("conflicting_long");
    conflicting["actions"][0]["value"] =
        serde_json::json!({"kind": "PARAMETER", "parameter": "flat"});
    document["transitions"]
        .as_array_mut()
        .expect("transitions")
        .push(conflicting);
    let compiled = compile(&document);
    let frames = [
        latest_frame(&compiled, &document, 10, &[100, 100]),
        latest_frame(&compiled, &document, 20, &[110, 110]),
    ];

    assert_eq!(
        compiled.execute(&frames),
        Err(ComplexStrategyProgramError::ConflictingStateAssignment)
    );
}

#[rstest]
fn host_oracle_rejects_unsupported_frame_scale_without_panicking() {
    let document = dual_tsmom();
    let compiled = compile(&document);
    let malformed = seal_frame(&compiled, &document, 10, 9, &[1, 1], 19);

    assert_eq!(
        compiled.execute(&[malformed]),
        Err(ComplexStrategyProgramError::UnsupportedScale)
    );
}

fn compile(document: &Value) -> ComplexStrategyCompileInputV1 {
    compile_with_source_seed(document, b'a')
}

fn compile_with_source_seed(document: &Value, seed: u8) -> ComplexStrategyCompileInputV1 {
    let ir = parse(document).expect("validated complex-strategy IR");
    let bindings = document["inputs"]
        .as_array()
        .expect("symbolic inputs")
        .iter()
        .enumerate()
        .map(|(index, input)| {
            ExactSymbolicInputBindingV1::for_source_test(
                input["id"].as_str().expect("input id"),
                input["instrument_role"].as_str().expect("instrument role"),
                input["timeframe"].as_str().expect("timeframe"),
                input["field"].as_str().expect("field"),
                &format!("channel:{index}"),
                &format!(
                    "sha256:{}",
                    char::from(seed + u8::try_from(index).expect("test index"))
                        .to_string()
                        .repeat(64)
                ),
            )
        })
        .collect();
    let receipt = SymbolicInputBindingReceiptV1::issue_for_test(&ir, bindings)
        .expect("canonical symbolic binding");
    ComplexStrategyCompileInputV1::from_owner_binding(&ir, &receipt)
        .expect("closed complex-strategy program")
}

fn exact_frame(
    compiled: &ComplexStrategyCompileInputV1,
    document: &Value,
    decision_time: u64,
    values: &[i64],
) -> BoundComplexStrategyFrameV1 {
    seal_frame(compiled, document, decision_time, decision_time, values, 0)
}

fn latest_frame(
    compiled: &ComplexStrategyCompileInputV1,
    document: &Value,
    decision_time: u64,
    values: &[i64],
) -> BoundComplexStrategyFrameV1 {
    seal_frame(
        compiled,
        document,
        decision_time,
        decision_time - 1,
        values,
        0,
    )
}

fn seal_frame(
    compiled: &ComplexStrategyCompileInputV1,
    document: &Value,
    decision_time: u64,
    observed_at: u64,
    values: &[i64],
    scale: u8,
) -> BoundComplexStrategyFrameV1 {
    compiled
        .seal_frame(untrusted_frame(
            document,
            decision_time,
            observed_at,
            values,
            scale,
        ))
        .expect("exact frame binding")
}

fn untrusted_frame(
    document: &Value,
    decision_time: u64,
    observed_at: u64,
    values: &[i64],
    scale: u8,
) -> UntrustedComplexStrategyFrameV1 {
    let inputs = document["inputs"].as_array().expect("symbolic inputs");
    assert_eq!(inputs.len(), values.len());
    UntrustedComplexStrategyFrameV1 {
        decision_time,
        inputs: inputs
            .iter()
            .zip(values)
            .enumerate()
            .map(
                |(index, (input, coefficient))| UntrustedComplexStrategyInputSampleV1 {
                    input_id: input["id"].as_str().expect("input id").to_owned(),
                    instrument_role: input["instrument_role"]
                        .as_str()
                        .expect("instrument role")
                        .to_owned(),
                    timeframe: input["timeframe"].as_str().expect("timeframe").to_owned(),
                    field: input["field"].as_str().expect("field").to_owned(),
                    channel_identity: format!("channel:{index}"),
                    canonical_input_identity: format!(
                        "sha256:{}",
                        char::from(b'a' + u8::try_from(index).expect("test index"))
                            .to_string()
                            .repeat(64)
                    ),
                    observed_at,
                    available_at: decision_time,
                    coefficient: *coefficient,
                    scale,
                },
            )
            .collect(),
    }
}

fn scaled_json(coefficient: i64, scale: u8) -> Value {
    serde_json::json!({"coefficient": coefficient, "scale": scale})
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
