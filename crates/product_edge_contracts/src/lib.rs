//! Pure Product Edge owner contracts.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionLocatorV1 {
    pub request_identity: String,
    pub admission_identity: String,
    pub admission_digest: String,
}

#[cfg(test)]
mod tests {
    use super::ProductEdgeAdmissionLocatorV1;
    use rstest::rstest;

    #[rstest]
    fn admission_locator_preserves_its_serialized_shape() {
        let locator = ProductEdgeAdmissionLocatorV1 {
            request_identity: "request-1".into(),
            admission_identity: "admission-1".into(),
            admission_digest: "sha256:digest".into(),
        };

        assert_eq!(
            serde_json::to_string(&locator).unwrap(),
            r#"{"request_identity":"request-1","admission_identity":"admission-1","admission_digest":"sha256:digest"}"#
        );
        assert_eq!(
            serde_json::from_str::<ProductEdgeAdmissionLocatorV1>(
                r#"{"request_identity":"request-1","admission_identity":"admission-1","admission_digest":"sha256:digest","future":true}"#,
            )
            .unwrap_err()
            .classify(),
            serde_json::error::Category::Data
        );
    }
}
