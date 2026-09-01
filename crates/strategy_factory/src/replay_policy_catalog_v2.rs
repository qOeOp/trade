//! R&D-owned Replay Policy Catalog values.
//!
//! This module contains no selection fallback and no administration surface. PostgreSQL custody is
//! the only authority that may create records or resolve the current head for family formation.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::replay_execution_policy_v2::{
    REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DIGEST_V2, REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2,
    ReplayExecutionPolicyV2,
};

const RECORD_DIGEST_DOMAIN_V2: &[u8] = b"rd.replay-policy-catalog-record.v2\0";
const MAX_CATALOG_IDENTITY_BYTES_V2: usize = 256;

/// Complete Catalog fact permanently sealed into a TrialFamily policy.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayPolicyCatalogBindingV2 {
    catalog_record_id: String,
    catalog_version: u64,
    policy_grammar_parser_id: String,
    policy_grammar_parser_digest: [u8; 32],
    policy_canonical_bytes: Vec<u8>,
    policy_digest: [u8; 32],
    catalog_record_digest: [u8; 32],
}

impl ReplayPolicyCatalogBindingV2 {
    #[must_use]
    pub fn catalog_record_id(&self) -> &str {
        &self.catalog_record_id
    }

    #[must_use]
    pub const fn catalog_version(&self) -> u64 {
        self.catalog_version
    }

    #[must_use]
    pub fn policy_grammar_parser_id(&self) -> &str {
        &self.policy_grammar_parser_id
    }

    #[must_use]
    pub const fn policy_grammar_parser_digest(&self) -> &[u8; 32] {
        &self.policy_grammar_parser_digest
    }

    #[must_use]
    pub fn policy_canonical_bytes(&self) -> &[u8] {
        &self.policy_canonical_bytes
    }

    #[must_use]
    pub const fn policy_digest(&self) -> &[u8; 32] {
        &self.policy_digest
    }

    #[must_use]
    pub const fn catalog_record_digest(&self) -> &[u8; 32] {
        &self.catalog_record_digest
    }

    pub(crate) fn from_policy(
        catalog_record_id: &str,
        catalog_version: u64,
        policy: &ReplayExecutionPolicyV2,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        Self::from_canonical_bytes(
            catalog_record_id,
            catalog_version,
            REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2,
            REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DIGEST_V2,
            policy
                .canonical_bytes()
                .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?,
        )
    }

    pub(crate) fn from_canonical_bytes(
        catalog_record_id: &str,
        catalog_version: u64,
        policy_grammar_parser_id: &str,
        policy_grammar_parser_digest: [u8; 32],
        policy_canonical_bytes: Vec<u8>,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        require_ascii_identity(catalog_record_id, "catalog record identity")?;

        if catalog_version == 0 {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "catalog version must be nonzero",
            ));
        }

        if policy_grammar_parser_id != REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2
            || policy_grammar_parser_digest != REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DIGEST_V2
        {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "policy grammar/parser binding mismatch",
            ));
        }
        let policy = ReplayExecutionPolicyV2::parse_canonical(&policy_canonical_bytes)
            .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?;
        let policy_digest = policy
            .policy_digest()
            .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))?;
        let canonical_record_bytes = canonical_record_bytes(
            catalog_record_id,
            catalog_version,
            policy_grammar_parser_id,
            &policy_grammar_parser_digest,
            &policy_canonical_bytes,
            &policy_digest,
        )?;
        let mut digest = Sha256::new();
        digest.update(RECORD_DIGEST_DOMAIN_V2);
        digest.update(canonical_record_bytes);
        Ok(Self {
            catalog_record_id: catalog_record_id.to_owned(),
            catalog_version,
            policy_grammar_parser_id: policy_grammar_parser_id.to_owned(),
            policy_grammar_parser_digest,
            policy_canonical_bytes,
            policy_digest,
            catalog_record_digest: digest.finalize().into(),
        })
    }

    pub(crate) fn verify(&self) -> Result<ReplayExecutionPolicyV2, ReplayPolicyCatalogErrorV2> {
        let expected = Self::from_canonical_bytes(
            &self.catalog_record_id,
            self.catalog_version,
            &self.policy_grammar_parser_id,
            self.policy_grammar_parser_digest,
            self.policy_canonical_bytes.clone(),
        )?;

        if &expected != self {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "catalog record digest mismatch",
            ));
        }
        ReplayExecutionPolicyV2::parse_canonical(&self.policy_canonical_bytes)
            .map_err(|e| ReplayPolicyCatalogErrorV2::InvalidPolicy(e.to_string()))
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub(crate) enum ReplayPolicyCatalogErrorV2 {
    #[error("Replay Policy Catalog record is invalid: {0}")]
    InvalidRecord(&'static str),
    #[error("Replay Policy Catalog policy is invalid: {0}")]
    InvalidPolicy(String),
    #[error("Replay Policy Catalog authority is unavailable: {0}")]
    Unavailable(String),
    #[error("Replay Policy Catalog command conflicts with canonical custody")]
    Conflict,
}

fn canonical_record_bytes(
    catalog_record_id: &str,
    catalog_version: u64,
    policy_grammar_parser_id: &str,
    policy_grammar_parser_digest: &[u8; 32],
    policy_canonical_bytes: &[u8],
    policy_digest: &[u8; 32],
) -> Result<Vec<u8>, ReplayPolicyCatalogErrorV2> {
    let mut bytes = Vec::with_capacity(
        catalog_record_id.len()
            + policy_grammar_parser_id.len()
            + policy_canonical_bytes.len()
            + 84,
    );
    encode_bytes(&mut bytes, catalog_record_id.as_bytes())?;
    bytes.extend_from_slice(&catalog_version.to_le_bytes());
    encode_bytes(&mut bytes, policy_grammar_parser_id.as_bytes())?;
    bytes.extend_from_slice(policy_grammar_parser_digest);
    encode_bytes(&mut bytes, policy_canonical_bytes)?;
    bytes.extend_from_slice(policy_digest);
    Ok(bytes)
}

fn encode_bytes(output: &mut Vec<u8>, value: &[u8]) -> Result<(), ReplayPolicyCatalogErrorV2> {
    let length = u32::try_from(value.len()).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("canonical record length overflow")
    })?;
    output.extend_from_slice(&length.to_le_bytes());
    output.extend_from_slice(value);
    Ok(())
}

fn require_ascii_identity(
    value: &str,
    label: &'static str,
) -> Result<(), ReplayPolicyCatalogErrorV2> {
    if value.is_empty()
        || value.len() > MAX_CATALOG_IDENTITY_BYTES_V2
        || !value.is_ascii()
        || value.trim() != value
    {
        return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };

    #[rstest]
    fn record_cross_binding_rejects_every_tampered_component() {
        let record = ReplayPolicyCatalogBindingV2::from_policy("catalog-policy-v2-a", 1, &policy())
            .expect("record");
        assert_eq!(record.verify().expect("verify"), policy());

        let family = crate::trial_family::form_initial_family(
            "rd-research-intent-v2-catalog-unit",
            &format!("sha256:{}", "a".repeat(64)),
            crate::trial_family::TrialFamilyPolicyV1 {
                trial_budget: 2,
                stop_rule: "stop after bounded falsifier".to_owned(),
                pit_rule_identity: "pit-rule-v1".to_owned(),
                cost_model_identity: "cost-model".to_owned(),
                slippage_model_identity: "slippage-model".to_owned(),
                capacity_model_identity: "capacity-model".to_owned(),
                semantic_predecessor_frontier: Vec::new(),
                protected_feedback_frontier: "qualification-frontier-v1".to_owned(),
                independence_disposition:
                    crate::trial_family::TrialFamilyIndependenceDispositionV1::Independent,
                independence_basis_identity: "independence-basis-v1".to_owned(),
                frozen_falsifier_binding: format!("sha256:{}", "b".repeat(64)),
                replay_execution_policy_v2: Some(record.clone()),
            },
            1,
        )
        .expect("family");
        assert_eq!(
            family.root().policy().replay_execution_policy_v2(),
            Some(&record)
        );
        assert_eq!(
            family.root_receipt().replay_execution_policy_v2(),
            Some(&record)
        );
        assert_eq!(
            family.census_frontier().replay_execution_policy_v2(),
            Some(&record)
        );

        let mut changed = record.clone();
        changed.policy_canonical_bytes[0] ^= 1;
        assert!(changed.verify().is_err());
        let mut changed = record.clone();
        changed.policy_digest[0] ^= 1;
        assert!(changed.verify().is_err());
        let mut changed = record.clone();
        changed.catalog_record_digest[0] ^= 1;
        assert!(changed.verify().is_err());
        let mut changed = record;
        changed.policy_grammar_parser_digest[0] ^= 1;
        assert!(changed.verify().is_err());
    }

    fn policy() -> ReplayExecutionPolicyV2 {
        ReplayExecutionPolicyV2 {
            runtime_kernel: versioned("runtime"),
            simulator: versioned("simulator"),
            cost: versioned("cost-model"),
            slippage: versioned("slippage-model"),
            capacity: versioned("capacity-model"),
            runner_operational_profile: versioned("runner"),
            diagnostic_policy: versioned("diagnostic"),
            deterministic_seed: 7,
            window: ReplayWindowV2 {
                start_event_ns: 1,
                end_event_ns_exclusive: 2,
            },
            calendar: versioned("calendar"),
            session: versioned("session"),
            time_zone: versioned("timezone"),
            correction_rule: versioned("correction"),
            market_semantics: versioned("semantics"),
            replay_configuration: content("configuration"),
            corporate_action_cut: content("corporate-actions"),
            historical_membership_cut: content("membership"),
        }
    }

    fn versioned(identity: &str) -> VersionedIdentityV2 {
        VersionedIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            version: OpaqueIdentityV2::try_from("v1".to_owned()).unwrap(),
        }
    }

    fn content(identity: &str) -> ContentIdentityV2 {
        ContentIdentityV2 {
            identity: OpaqueIdentityV2::try_from(identity.to_owned()).unwrap(),
            digest: CanonicalDigestV2::try_from(format!("sha256:{}", "11".repeat(32))).unwrap(),
        }
    }
}
