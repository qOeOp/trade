use std::path::PathBuf;

use serde::Serialize;
use vibe_deployment_attestation::{
    StrategyFactoryFormationEvidence, verify_strategy_factory_formation,
};

#[derive(Debug, Clone)]
pub struct NativeProducerVerificationRequest {
    bundle_path: PathBuf,
}

impl NativeProducerVerificationRequest {
    pub fn from_bundle(bundle_path: impl Into<PathBuf>) -> Self {
        Self {
            bundle_path: bundle_path.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct NativeProducerEvidence {
    record: NativeProducerRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum NativeProducerRecord {
    Attested(StrategyFactoryFormationEvidence),
    #[cfg(test)]
    TestOnly {
        status: &'static str,
        authority: &'static str,
        accepted_public_authority: bool,
        reason: &'static str,
    },
}

impl NativeProducerEvidence {
    pub(crate) const fn is_verified(&self) -> bool {
        match &self.record {
            NativeProducerRecord::Attested(evidence) => evidence.is_verified(),
            #[cfg(test)]
            NativeProducerRecord::TestOnly { .. } => false,
        }
    }

    pub(crate) const fn allows_test_or_attested_execution(&self) -> bool {
        match &self.record {
            NativeProducerRecord::Attested(evidence) => evidence.is_verified(),
            #[cfg(test)]
            NativeProducerRecord::TestOnly { .. } => true,
        }
    }

    pub(crate) fn rejection_error(&self) -> String {
        match &self.record {
            NativeProducerRecord::Attested(evidence) => evidence.rejection_error(),
            #[cfg(test)]
            NativeProducerRecord::TestOnly { .. } => {
                "native producer evidence is test-only and has no public receipt authority"
                    .to_string()
            }
        }
    }

    #[cfg(test)]
    pub(crate) const fn test_only_for_execution() -> Self {
        Self {
            record: NativeProducerRecord::TestOnly {
                status: "TEST_ONLY",
                authority: "cfg-test-only",
                accepted_public_authority: false,
                reason: "FULL_CHAIN_TEST_EXECUTION_ONLY_NO_PUBLIC_RECEIPT_AUTHORITY",
            },
        }
    }
}

pub(crate) fn verify_native_producer(
    request: NativeProducerVerificationRequest,
) -> NativeProducerEvidence {
    let NativeProducerVerificationRequest { bundle_path } = request;
    NativeProducerEvidence {
        record: NativeProducerRecord::Attested(verify_strategy_factory_formation(&bundle_path)),
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn test_only_evidence_preserves_the_existing_receipt_shape() {
        let value =
            serde_json::to_value(NativeProducerEvidence::test_only_for_execution()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "status": "TEST_ONLY",
                "authority": "cfg-test-only",
                "accepted_public_authority": false,
                "reason": "FULL_CHAIN_TEST_EXECUTION_ONLY_NO_PUBLIC_RECEIPT_AUTHORITY",
            })
        );
    }
}
