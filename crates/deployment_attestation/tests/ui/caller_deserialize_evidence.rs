use vibe_deployment_attestation::StrategyFactoryFormationEvidence;

fn main() {
    let _: StrategyFactoryFormationEvidence =
        serde_json::from_str(r#"{"status":"VERIFIED"}"#).unwrap();
}
