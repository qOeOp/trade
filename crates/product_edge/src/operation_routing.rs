//! Operation routing: which dispatcher is the fresh business writer for one typed operation.
//!
//! `docs/architecture/product-edge.md`, "Operation routing", is the contract. The Dashboard
//! (`product/dashboard/lib/product-edge-routing-client.ts`) recomputes a binding's digest and
//! identity from every observation it receives, so the content below is serialized in exactly the
//! order that client assembles it, and the shared vectors in
//! `product/rd-owner-client/fixtures/operation_routing_binding_vectors_v1.json` pin both ends.

use serde::{Deserialize, Serialize};

use crate::{ProductEdgeError, ProductEdgeUnavailableReasonV1, canonical_digest, identity};

pub const OPERATION_ROUTING_BINDING_DIGEST_DOMAIN_V1: &str =
    "product-edge.operation-routing-binding.v1";
pub const OPERATION_ROUTING_BINDING_IDENTITY_DOMAIN_V1: &str =
    "product-edge-operation-routing-binding-v1";

/// What one routing history is kept for: a deployment, a typed operation, its version, and the
/// admission gateway channel its requests are sealed under.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeOperationRoutingKeyV1 {
    pub deployment_identity: String,
    pub operation: String,
    pub version: u32,
    pub channel: String,
}

impl ProductEdgeOperationRoutingKeyV1 {
    /// A key names an operation only when its version is the operation name's `.vN` suffix and its
    /// channel is a routing token; anything else is refused before any store is read.
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        let suffix = format!(".v{}", self.version);

        if self.deployment_identity.trim().is_empty()
            || self.deployment_identity.trim() != self.deployment_identity
            || self.version == 0
            || !self.operation.ends_with(&suffix)
            || self.operation.len() == suffix.len()
            || self.operation.trim() != self.operation
            || self.channel.is_empty()
            || !self.channel.bytes().all(|byte| {
                byte.is_ascii_uppercase() || byte.is_ascii_digit() || b"_.-".contains(&byte)
            })
        {
            return Err(ProductEdgeError::InvalidProposal("operation routing key"));
        }
        Ok(())
    }
}

/// The effect runner that is the fresh business writer for a routing key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProductEdgeOperationDispatcherV1 {
    #[serde(rename = "WINDMILL")]
    Windmill,
    #[serde(rename = "TRADE_DASHBOARD")]
    TradeDashboard,
}

impl ProductEdgeOperationDispatcherV1 {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Windmill => "WINDMILL",
            Self::TradeDashboard => "TRADE_DASHBOARD",
        }
    }
}

/// The fields a binding's digest covers, in the order the Dashboard client assembles them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeOperationRoutingBindingContentV1 {
    pub schema_version: u32,
    pub key: ProductEdgeOperationRoutingKeyV1,
    pub generation: u64,
    pub predecessor_binding_identity: Option<String>,
    pub deployment_binding_identity: String,
    pub deployment_binding_digest: String,
    pub manifest_identity: String,
    pub manifest_digest: String,
    pub dispatcher: ProductEdgeOperationDispatcherV1,
    pub committed_at_epoch_ms: u64,
}

impl ProductEdgeOperationRoutingBindingContentV1 {
    pub fn digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest(OPERATION_ROUTING_BINDING_DIGEST_DOMAIN_V1, self)
    }

    /// Seals the content: its digest, and the identity derived from that digest.
    pub fn seal(self) -> Result<ProductEdgeOperationRoutingBindingV1, ProductEdgeError> {
        if self.schema_version != 1
            || self.generation == 0
            || (self.generation == 1) != self.predecessor_binding_identity.is_none()
        {
            return Err(ProductEdgeError::InvalidProposal(
                "operation routing binding",
            ));
        }
        self.key.validate()?;
        let binding_digest = self.digest()?;
        let binding_identity = identity(
            OPERATION_ROUTING_BINDING_IDENTITY_DOMAIN_V1,
            &[&binding_digest],
        );
        Ok(ProductEdgeOperationRoutingBindingV1 {
            schema_version: self.schema_version,
            key: self.key,
            generation: self.generation,
            predecessor_binding_identity: self.predecessor_binding_identity,
            deployment_binding_identity: self.deployment_binding_identity,
            deployment_binding_digest: self.deployment_binding_digest,
            manifest_identity: self.manifest_identity,
            manifest_digest: self.manifest_digest,
            dispatcher: self.dispatcher,
            committed_at_epoch_ms: self.committed_at_epoch_ms,
            binding_identity,
            binding_digest,
        })
    }
}

/// A sealed routing binding, as stored and as the read port answers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeOperationRoutingBindingV1 {
    pub schema_version: u32,
    pub key: ProductEdgeOperationRoutingKeyV1,
    pub generation: u64,
    pub predecessor_binding_identity: Option<String>,
    pub deployment_binding_identity: String,
    pub deployment_binding_digest: String,
    pub manifest_identity: String,
    pub manifest_digest: String,
    pub dispatcher: ProductEdgeOperationDispatcherV1,
    pub committed_at_epoch_ms: u64,
    pub binding_identity: String,
    pub binding_digest: String,
}

impl ProductEdgeOperationRoutingBindingV1 {
    pub fn content(&self) -> ProductEdgeOperationRoutingBindingContentV1 {
        ProductEdgeOperationRoutingBindingContentV1 {
            schema_version: self.schema_version,
            key: self.key.clone(),
            generation: self.generation,
            predecessor_binding_identity: self.predecessor_binding_identity.clone(),
            deployment_binding_identity: self.deployment_binding_identity.clone(),
            deployment_binding_digest: self.deployment_binding_digest.clone(),
            manifest_identity: self.manifest_identity.clone(),
            manifest_digest: self.manifest_digest.clone(),
            dispatcher: self.dispatcher,
            committed_at_epoch_ms: self.committed_at_epoch_ms,
        }
    }

    /// A stored binding whose digest or identity no longer follows from its content is custody
    /// drift, never an answer.
    pub fn verify(&self) -> Result<(), ProductEdgeError> {
        match self.content().seal() {
            Ok(sealed) if sealed == *self => Ok(()),
            _ => Err(ProductEdgeError::unavailable(
                ProductEdgeUnavailableReasonV1::CustodyDrift,
            )),
        }
    }
}

/// An administrative routing change for one key of the deployment the writer is connected to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum ProductEdgeOperationRoutingProposalV1 {
    /// The first binding for a key with no history.
    Genesis {
        key: ProductEdgeOperationRoutingKeyV1,
        dispatcher: ProductEdgeOperationDispatcherV1,
        manifest_identity: String,
    },
    /// A binding that replaces the exact current head, active or withdrawn.
    Successor {
        key: ProductEdgeOperationRoutingKeyV1,
        expected_head_identity: String,
        dispatcher: ProductEdgeOperationDispatcherV1,
        manifest_identity: String,
    },
    /// Supersedes the exact current head without a successor: the key becomes zero-`ACTIVE`.
    Withdraw {
        key: ProductEdgeOperationRoutingKeyV1,
        expected_head_identity: String,
    },
}

impl ProductEdgeOperationRoutingProposalV1 {
    pub fn key(&self) -> &ProductEdgeOperationRoutingKeyV1 {
        match self {
            Self::Genesis { key, .. }
            | Self::Successor { key, .. }
            | Self::Withdraw { key, .. } => key,
        }
    }
}

/// What the read port answers for one key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductEdgeOperationRoutingObservationV1 {
    /// The head binding is `ACTIVE` and names the deployment's current `ACTIVE` binding.
    Active {
        binding: ProductEdgeOperationRoutingBindingV1,
        observed_at_epoch_ms: u64,
    },
    /// The head was withdrawn; no dispatcher is the business writer for the key.
    ZeroActive {
        key: ProductEdgeOperationRoutingKeyV1,
        generation: u64,
        history_head_identity: String,
        observed_at_epoch_ms: u64,
    },
    /// The key has no routing history.
    Absent,
    /// The head names a deployment binding that is no longer the deployment's `ACTIVE` head.
    Stale,
}

impl ProductEdgeOperationRoutingObservationV1 {
    /// The response body for an answer the Dashboard parses, or `None` for the named refusals,
    /// which the read port answers with a non-success status instead.
    pub fn response_body(&self) -> Option<serde_json::Value> {
        match self {
            Self::Active {
                binding,
                observed_at_epoch_ms,
            } => Some(serde_json::json!({
                "state": "ACTIVE",
                "binding": binding,
                "history_head_identity": binding.binding_identity,
                "observed_at_epoch_ms": observed_at_epoch_ms,
            })),
            Self::ZeroActive {
                key,
                generation,
                history_head_identity,
                observed_at_epoch_ms,
            } => Some(serde_json::json!({
                "state": "ZERO_ACTIVE",
                "key": key,
                "generation": generation,
                "history_head_identity": history_head_identity,
                "observed_at_epoch_ms": observed_at_epoch_ms,
            })),
            Self::Absent | Self::Stale => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn key() -> ProductEdgeOperationRoutingKeyV1 {
        ProductEdgeOperationRoutingKeyV1 {
            deployment_identity: "deployment-a".into(),
            operation: "research_goal.submit_or_resolve.v2".into(),
            version: 2,
            channel: "WINDMILL_PRODUCT_EDGE".into(),
        }
    }

    #[rstest]
    #[case::version_is_not_the_suffix(
        "research_goal.submit_or_resolve.v2",
        3,
        "WINDMILL_PRODUCT_EDGE"
    )]
    #[case::bare_suffix(".v2", 2, "WINDMILL_PRODUCT_EDGE")]
    #[case::lower_case_channel("research_goal.submit_or_resolve.v2", 2, "windmill")]
    #[case::empty_channel("research_goal.submit_or_resolve.v2", 2, "")]
    #[case::version_zero("research_goal.submit_or_resolve.v0", 0, "WINDMILL_PRODUCT_EDGE")]
    fn a_key_that_names_no_operation_is_refused(
        #[case] operation: &str,
        #[case] version: u32,
        #[case] channel: &str,
    ) {
        let key = ProductEdgeOperationRoutingKeyV1 {
            operation: operation.into(),
            version,
            channel: channel.into(),
            ..key()
        };
        assert!(key.validate().is_err(), "{key:?}");
    }

    #[rstest]
    fn the_five_keys_the_dashboard_uses_are_valid() {
        for (operation, version) in [
            ("research_goal.submit_or_resolve.v2", 2),
            ("artifact_build.submit_or_resolve.v1", 1),
            ("develop_composer.submit_or_resolve.v2", 2),
            ("exploratory_replay.submit_or_resolve.v2", 2),
            ("source_intake.openalex_work_by_doi.submit_or_resolve.v1", 1),
        ] {
            let key = ProductEdgeOperationRoutingKeyV1 {
                operation: operation.into(),
                version,
                ..key()
            };
            key.validate().unwrap();
        }
    }

    #[rstest]
    fn generation_one_has_no_predecessor_and_later_generations_have_one() {
        let content =
            |generation, predecessor: Option<&str>| ProductEdgeOperationRoutingBindingContentV1 {
                schema_version: 1,
                key: key(),
                generation,
                predecessor_binding_identity: predecessor.map(str::to_string),
                deployment_binding_identity: "binding".into(),
                deployment_binding_digest: format!("sha256:{}", "1".repeat(64)),
                manifest_identity: "manifest".into(),
                manifest_digest: format!("sha256:{}", "2".repeat(64)),
                dispatcher: ProductEdgeOperationDispatcherV1::TradeDashboard,
                committed_at_epoch_ms: 1,
            };
        content(1, None).seal().unwrap();
        content(2, Some("previous")).seal().unwrap();
        assert!(content(1, Some("previous")).seal().is_err());
        assert!(content(2, None).seal().is_err());
    }

    const VECTORS_PATH: &str =
        "../../product/rd-owner-client/fixtures/operation_routing_binding_vectors_v1.json";
    const VECTOR_DEPLOYMENT: &str = "acceptance-deployment-operation-routing-vectors";
    const VECTOR_COMMITTED_AT: u64 = 1_800_000_000_000;

    fn vector_content(
        generation: u64,
        predecessor: Option<&ProductEdgeOperationRoutingBindingV1>,
        dispatcher: ProductEdgeOperationDispatcherV1,
    ) -> ProductEdgeOperationRoutingBindingContentV1 {
        ProductEdgeOperationRoutingBindingContentV1 {
            schema_version: 1,
            key: ProductEdgeOperationRoutingKeyV1 {
                deployment_identity: VECTOR_DEPLOYMENT.into(),
                ..key()
            },
            generation,
            predecessor_binding_identity: predecessor
                .map(|binding| binding.binding_identity.clone()),
            deployment_binding_identity: "acceptance-binding-operation-routing-vectors".into(),
            deployment_binding_digest: format!("sha256:{}", "b".repeat(64)),
            manifest_identity: "product-edge-operation-manifest-research-goal-v2".into(),
            manifest_digest: format!("sha256:{}", "d".repeat(64)),
            dispatcher,
            committed_at_epoch_ms: VECTOR_COMMITTED_AT + generation,
        }
    }

    fn active_entry(
        name: &str,
        binding: &ProductEdgeOperationRoutingBindingV1,
    ) -> serde_json::Value {
        let response = ProductEdgeOperationRoutingObservationV1::Active {
            binding: binding.clone(),
            observed_at_epoch_ms: binding.committed_at_epoch_ms + 5,
        }
        .response_body()
        .unwrap();
        serde_json::json!({
            "name": name,
            "response": response,
            "canonical_bytes": serde_json::to_string(&binding.content()).unwrap(),
            "expected": {
                "state": "ACTIVE",
                "dispatcher": binding.dispatcher,
                "binding_identity": binding.binding_identity,
                "binding_digest": binding.binding_digest,
                "generation": binding.generation,
                "history_head_identity": binding.binding_identity,
            },
        })
    }

    /// Every vector, produced by this side's own sealing and response encoding. The file is this
    /// function's output and nothing else: a hand edit to it fails here, and a change to the
    /// encoding fails here until the file is regenerated, which then fails the Dashboard's side.
    fn operation_routing_vectors() -> serde_json::Value {
        let unavailable = serde_json::json!({
            "state": "UNAVAILABLE",
            "dispatcher": "NONE",
            "binding_identity": null,
            "binding_digest": null,
            "generation": null,
            "history_head_identity": null,
        });
        let genesis = vector_content(1, None, ProductEdgeOperationDispatcherV1::TradeDashboard)
            .seal()
            .unwrap();
        let successor = vector_content(
            2,
            Some(&genesis),
            ProductEdgeOperationDispatcherV1::Windmill,
        )
        .seal()
        .unwrap();
        let withdrawn = ProductEdgeOperationRoutingObservationV1::ZeroActive {
            key: successor.key.clone(),
            generation: successor.generation,
            history_head_identity: successor.binding_identity.clone(),
            observed_at_epoch_ms: successor.committed_at_epoch_ms + 10,
        }
        .response_body()
        .unwrap();

        // The one field the Dashboard acts on, changed after sealing: the digest no longer covers
        // what the body says, so the client must refuse it.
        let mut tampered = active_entry("tampered_dispatcher_is_refused", &genesis);
        tampered["response"]["binding"]["dispatcher"] = serde_json::json!("WINDMILL");
        tampered["expected"] = unavailable;
        let mut forged_dispatcher = genesis.clone();
        forged_dispatcher.dispatcher = ProductEdgeOperationDispatcherV1::Windmill;
        assert!(forged_dispatcher.verify().is_err());

        // Two keys transposed: the same data, other bytes, another digest. A vector that only maps
        // content to a digest would not show that the order is what both sides must agree on.
        let canonical = serde_json::to_string(&genesis.content()).unwrap();
        let transposed = canonical.replacen(
            "\"generation\":1,\"predecessor_binding_identity\":null",
            "\"predecessor_binding_identity\":null,\"generation\":1",
            1,
        );
        assert_ne!(transposed, canonical);

        serde_json::json!({
            "schema_version": 1,
            "purpose": "Pins the operation routing binding encoding that Product Edge seals and the Dashboard recomputes, so a change on either side fails where it is made instead of turning every routing answer UNAVAILABLE.",
            "producer": "crates/product_edge/src/operation_routing.rs operation_routing_vectors(); regenerate with OPERATION_ROUTING_VECTORS_WRITE=1",
            "digest_domain": OPERATION_ROUTING_BINDING_DIGEST_DOMAIN_V1,
            "identity_domain": OPERATION_ROUTING_BINDING_IDENTITY_DOMAIN_V1,
            "deployment_identity": VECTOR_DEPLOYMENT,
            "lookup": {
                "operation": genesis.key.operation,
                "version": genesis.key.version,
                "channel": genesis.key.channel,
            },
            "entries": [
                active_entry("genesis_routes_to_the_dashboard", &genesis),
                active_entry("successor_routes_to_windmill", &successor),
                {
                    "name": "withdrawn_head_is_zero_active",
                    "response": withdrawn,
                    "expected": {
                        "state": "ZERO_ACTIVE",
                        "dispatcher": "NONE",
                        "binding_identity": null,
                        "binding_digest": null,
                        "generation": successor.generation,
                        "history_head_identity": successor.binding_identity,
                    },
                },
                tampered,
            ],
            "order_sensitivity": {
                "canonical_bytes": transposed,
                "binding_digest": canonical_digest(
                    OPERATION_ROUTING_BINDING_DIGEST_DOMAIN_V1,
                    &RawBytes(transposed),
                )
                .unwrap(),
            },
        })
    }

    /// Serializes to exactly the bytes it holds, so a digest can be taken over bytes that are not
    /// this side's own encoding.
    struct RawBytes(String);

    impl Serialize for RawBytes {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let value: Box<serde_json::value::RawValue> =
                serde_json::value::RawValue::from_string(self.0.clone())
                    .map_err(serde::ser::Error::custom)?;
            value.serialize(serializer)
        }
    }

    #[rstest]
    fn the_shared_vectors_are_what_this_side_seals() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(VECTORS_PATH);
        let produced = format!(
            "{}\n",
            serde_json::to_string_pretty(&operation_routing_vectors()).unwrap()
        );

        if std::env::var_os("OPERATION_ROUTING_VECTORS_WRITE").is_some() {
            std::fs::write(&path, &produced).unwrap();
        }
        let pinned = std::fs::read_to_string(&path).expect("the shared routing vectors");
        assert!(
            pinned == produced,
            "{} differs from what Product Edge seals today; regenerate it with \
             OPERATION_ROUTING_VECTORS_WRITE=1 and let the Dashboard's side judge the change",
            path.display()
        );
        assert!(pinned.is_ascii());
    }

    #[rstest]
    fn every_answered_vector_reseals_and_the_tampered_one_does_not() {
        let vectors = operation_routing_vectors();
        let entries = vectors["entries"].as_array().unwrap();
        assert!(entries.len() >= 4);
        for entry in entries {
            let Some(binding) = entry["response"].get("binding") else {
                continue;
            };
            let binding: ProductEdgeOperationRoutingBindingV1 =
                serde_json::from_value(binding.clone()).unwrap();
            assert_eq!(
                binding.verify().is_ok(),
                entry["expected"]["state"] == "ACTIVE",
                "{}",
                entry["name"]
            );
        }
    }
}
