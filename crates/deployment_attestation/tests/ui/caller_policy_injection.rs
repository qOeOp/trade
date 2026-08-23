use vibe_deployment_attestation::VerificationPolicy;

fn main() {
    let _policy = VerificationPolicy {
        repository: "attacker/repository",
        verifier_path: "/tmp/attacker-verifier",
    };
}
