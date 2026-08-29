//! Pure Product Edge owner contracts.

use serde::{Deserialize, Serialize};

pub const PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1: &str = "product-edge.admission-events.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionEventCursorV1 {
    stream_identity: String,
    owner_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    event_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fact_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fact_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    observation_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    observation_digest: Option<String>,
}

impl ProductEdgeAdmissionEventCursorV1 {
    pub fn origin() -> Self {
        Self {
            stream_identity: PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1.to_string(),
            owner_sequence: 0,
            event_identity: None,
            fact_identity: None,
            fact_digest: None,
            observation_identity: None,
            observation_digest: None,
        }
    }

    pub fn stream_identity(&self) -> &str {
        &self.stream_identity
    }

    pub fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }

    pub fn event_identity(&self) -> Option<&str> {
        self.event_identity.as_deref()
    }

    pub fn fact_identity(&self) -> Option<&str> {
        self.fact_identity.as_deref()
    }

    pub fn fact_digest(&self) -> Option<&str> {
        self.fact_digest.as_deref()
    }

    pub fn observation_identity(&self) -> Option<&str> {
        self.observation_identity.as_deref()
    }

    pub fn observation_digest(&self) -> Option<&str> {
        self.observation_digest.as_deref()
    }

    pub fn after_owner_observation(
        locator: &ProductEdgeAdmissionEventLocatorV1,
        observation_identity: String,
        observation_digest: String,
    ) -> Self {
        Self {
            stream_identity: locator.stream_identity.clone(),
            owner_sequence: locator.owner_sequence,
            event_identity: Some(locator.event_identity.clone()),
            fact_identity: Some(locator.fact_identity.clone()),
            fact_digest: Some(locator.fact_digest.clone()),
            observation_identity: Some(observation_identity),
            observation_digest: Some(observation_digest),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionEventLocatorV1 {
    stream_identity: String,
    owner_sequence: u64,
    event_identity: String,
    fact_identity: String,
    fact_digest: String,
}

impl ProductEdgeAdmissionEventLocatorV1 {
    pub fn stream_identity(&self) -> &str {
        &self.stream_identity
    }

    pub fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }

    pub fn event_identity(&self) -> &str {
        &self.event_identity
    }

    pub fn fact_identity(&self) -> &str {
        &self.fact_identity
    }

    pub fn fact_digest(&self) -> &str {
        &self.fact_digest
    }

    pub fn from_owner_fact(
        owner_sequence: u64,
        event_identity: String,
        fact_identity: String,
        fact_digest: String,
    ) -> Self {
        Self {
            stream_identity: PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1.to_string(),
            owner_sequence,
            event_identity,
            fact_identity,
            fact_digest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionLocatorV1 {
    pub request_identity: String,
    pub admission_identity: String,
    pub admission_digest: String,
}

#[cfg(test)]
mod tests {
    use super::{
        PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1, ProductEdgeAdmissionEventCursorV1,
        ProductEdgeAdmissionEventLocatorV1, ProductEdgeAdmissionLocatorV1,
    };
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

    #[rstest]
    fn admission_event_cursor_and_locator_reject_shape_drift() {
        let cursor = ProductEdgeAdmissionEventCursorV1::origin();
        assert_eq!(
            cursor.stream_identity(),
            PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1
        );
        assert_eq!(cursor.owner_sequence(), 0);
        assert_eq!(
            serde_json::to_string(&cursor).unwrap(),
            r#"{"stream_identity":"product-edge.admission-events.v1","owner_sequence":0}"#
        );

        let locator = ProductEdgeAdmissionEventLocatorV1::from_owner_fact(
            7,
            "event-7".into(),
            "admission-7".into(),
            "sha256:digest-7".into(),
        );
        assert_eq!(locator.owner_sequence(), 7);
        assert_eq!(locator.event_identity(), "event-7");
        assert_eq!(locator.fact_identity(), "admission-7");
        assert_eq!(locator.fact_digest(), "sha256:digest-7");
        let cursor = ProductEdgeAdmissionEventCursorV1::after_owner_observation(
            &locator,
            "observation-7".into(),
            "sha256:observation-digest-7".into(),
        );
        assert_eq!(cursor.owner_sequence(), 7);
        assert_eq!(cursor.event_identity(), Some("event-7"));
        assert_eq!(cursor.fact_identity(), Some("admission-7"));
        assert_eq!(cursor.fact_digest(), Some("sha256:digest-7"));
        assert_eq!(cursor.observation_identity(), Some("observation-7"));
        assert_eq!(
            cursor.observation_digest(),
            Some("sha256:observation-digest-7")
        );
        assert!(
            serde_json::from_str::<ProductEdgeAdmissionEventLocatorV1>(
                r#"{"stream_identity":"product-edge.admission-events.v1","owner_sequence":7,"event_identity":"event-7","fact_identity":"admission-7","fact_digest":"sha256:digest-7","authority":true}"#,
            )
            .is_err()
        );
    }
}
