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
use crate::{
    replay_economic_configuration_v1::ReplayEconomicConfigurationV1,
    replay_runner_operational_profile_v1::ReplayRunnerOperationalProfileV1,
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

/// Complete canonical execution-profile bytes attached to one authenticated Catalog record.
///
/// This value is readable and persistable, but its private fields prevent callers from directly
/// constructing a value. Its digest cross-binds both canonical profiles to the unchanged Catalog
/// V2 record digest. A Catalog record without this extension remains historically readable but is
/// unavailable for execution-profile authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayExecutionProfileSealsV1 {
    economic_configuration_canonical_bytes: Vec<u8>,
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_canonical_bytes: Vec<u8>,
    runner_operational_profile_digest: [u8; 32],
    catalog_record_digest: [u8; 32],
    binding_digest: [u8; 32],
}

impl ReplayExecutionProfileSealsV1 {
    #[must_use]
    pub fn economic_configuration_canonical_bytes(&self) -> &[u8] {
        &self.economic_configuration_canonical_bytes
    }

    #[must_use]
    pub const fn economic_configuration_digest(&self) -> [u8; 32] {
        self.economic_configuration_digest
    }

    #[must_use]
    pub fn runner_operational_profile_canonical_bytes(&self) -> &[u8] {
        &self.runner_operational_profile_canonical_bytes
    }

    #[must_use]
    pub const fn runner_operational_profile_digest(&self) -> [u8; 32] {
        self.runner_operational_profile_digest
    }

    #[must_use]
    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }

    pub fn verify(
        &self,
        expected_catalog_record_digest: [u8; 32],
    ) -> Result<
        (
            ReplayEconomicConfigurationV1,
            ReplayRunnerOperationalProfileV1,
        ),
        ReplayPolicyCatalogErrorV2,
    > {
        let economic = ReplayEconomicConfigurationV1::parse_canonical(
            &self.economic_configuration_canonical_bytes,
        )
        .map_err(|error| ReplayPolicyCatalogErrorV2::InvalidPolicy(error.to_string()))?;
        let runner = ReplayRunnerOperationalProfileV1::parse_canonical(
            &self.runner_operational_profile_canonical_bytes,
        )
        .map_err(|error| ReplayPolicyCatalogErrorV2::InvalidPolicy(error.to_string()))?;
        let expected = execution_profiles_binding_digest(
            expected_catalog_record_digest,
            economic.digest(),
            economic.canonical_bytes(),
            runner.digest(),
            runner.canonical_bytes(),
        )?;
        if self.catalog_record_digest != expected_catalog_record_digest
            || self.economic_configuration_digest != economic.digest()
            || self.runner_operational_profile_digest != runner.digest()
            || self.binding_digest != expected
        {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "execution-profile Catalog cross-binding mismatch",
            ));
        }
        Ok((economic, runner))
    }
}

/// Additive Catalog value for a V2 policy record plus the exact dual execution-profile seals.
///
/// V2 bytes, JSON and record digests are embedded unchanged. This wrapper has one V3 meaning and
/// cannot be decoded as a V2 binding.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayPolicyCatalogBindingV3 {
    schema_version: u16,
    replay_policy_v2: ReplayPolicyCatalogBindingV2,
    execution_profiles_v1: ReplayExecutionProfileSealsV1,
    binding_digest: [u8; 32],
}

impl ReplayPolicyCatalogBindingV3 {
    #[must_use]
    pub fn replay_policy_v2(&self) -> &ReplayPolicyCatalogBindingV2 {
        &self.replay_policy_v2
    }

    #[must_use]
    pub fn execution_profiles_v1(&self) -> &ReplayExecutionProfileSealsV1 {
        &self.execution_profiles_v1
    }

    #[must_use]
    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }

    pub fn issue(
        replay_policy_v2: ReplayPolicyCatalogBindingV2,
        economic: &ReplayEconomicConfigurationV1,
        runner: &ReplayRunnerOperationalProfileV1,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        replay_policy_v2.verify()?;
        let execution_profiles_v1 = ReplayExecutionProfileSealsV1::seal(
            *replay_policy_v2.catalog_record_digest(),
            economic,
            runner,
        )?;
        let binding_digest = catalog_v3_binding_digest(
            replay_policy_v2.catalog_record_digest,
            execution_profiles_v1.binding_digest,
        );
        Ok(Self {
            schema_version: 3,
            replay_policy_v2,
            execution_profiles_v1,
            binding_digest,
        })
    }

    pub fn from_stored_parts(
        replay_policy_v2: ReplayPolicyCatalogBindingV2,
        economic_configuration_canonical_bytes: Vec<u8>,
        economic_configuration_digest: [u8; 32],
        runner_operational_profile_canonical_bytes: Vec<u8>,
        runner_operational_profile_digest: [u8; 32],
        execution_profiles_binding_digest: [u8; 32],
        binding_digest: [u8; 32],
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        let value = Self {
            schema_version: 3,
            execution_profiles_v1: ReplayExecutionProfileSealsV1 {
                economic_configuration_canonical_bytes,
                economic_configuration_digest,
                runner_operational_profile_canonical_bytes,
                runner_operational_profile_digest,
                catalog_record_digest: *replay_policy_v2.catalog_record_digest(),
                binding_digest: execution_profiles_binding_digest,
            },
            replay_policy_v2,
            binding_digest,
        };
        value.verify()?;
        Ok(value)
    }

    pub fn verify(
        &self,
    ) -> Result<
        (
            ReplayEconomicConfigurationV1,
            ReplayRunnerOperationalProfileV1,
        ),
        ReplayPolicyCatalogErrorV2,
    > {
        if self.schema_version != 3 {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "execution-profile Catalog schema version mismatch",
            ));
        }
        self.replay_policy_v2.verify()?;
        let profiles = self
            .execution_profiles_v1
            .verify(*self.replay_policy_v2.catalog_record_digest())?;
        if self.binding_digest
            != catalog_v3_binding_digest(
                self.replay_policy_v2.catalog_record_digest,
                self.execution_profiles_v1.binding_digest,
            )
        {
            return Err(ReplayPolicyCatalogErrorV2::InvalidRecord(
                "execution-profile Catalog V3 binding digest mismatch",
            ));
        }
        Ok(profiles)
    }
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

    pub fn from_policy(
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

    pub fn from_canonical_bytes(
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

    pub fn verify(&self) -> Result<ReplayExecutionPolicyV2, ReplayPolicyCatalogErrorV2> {
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

impl ReplayExecutionProfileSealsV1 {
    fn seal(
        catalog_record_digest: [u8; 32],
        economic: &ReplayEconomicConfigurationV1,
        runner: &ReplayRunnerOperationalProfileV1,
    ) -> Result<Self, ReplayPolicyCatalogErrorV2> {
        Ok(Self {
            economic_configuration_canonical_bytes: economic.canonical_bytes().to_vec(),
            economic_configuration_digest: economic.digest(),
            runner_operational_profile_canonical_bytes: runner.canonical_bytes().to_vec(),
            runner_operational_profile_digest: runner.digest(),
            catalog_record_digest,
            binding_digest: execution_profiles_binding_digest(
                catalog_record_digest,
                economic.digest(),
                economic.canonical_bytes(),
                runner.digest(),
                runner.canonical_bytes(),
            )?,
        })
    }
}

fn catalog_v3_binding_digest(
    catalog_record_digest: [u8; 32],
    execution_profiles_binding_digest: [u8; 32],
) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"rd.replay-policy-catalog-binding.v3\0");
    digest.update(catalog_record_digest);
    digest.update(execution_profiles_binding_digest);
    digest.finalize().into()
}

fn execution_profiles_binding_digest(
    catalog_record_digest: [u8; 32],
    economic_digest: [u8; 32],
    economic_bytes: &[u8],
    runner_digest: [u8; 32],
    runner_bytes: &[u8],
) -> Result<[u8; 32], ReplayPolicyCatalogErrorV2> {
    let economic_length = u32::try_from(economic_bytes.len()).map_err(|_| {
        ReplayPolicyCatalogErrorV2::InvalidRecord("economic profile length overflow")
    })?;
    let runner_length = u32::try_from(runner_bytes.len())
        .map_err(|_| ReplayPolicyCatalogErrorV2::InvalidRecord("runner profile length overflow"))?;
    let mut digest = Sha256::new();
    digest.update(b"rd.replay-execution-profile-catalog-seals.v1\0");
    digest.update(catalog_record_digest);
    digest.update(economic_digest);
    digest.update(economic_length.to_le_bytes());
    digest.update(economic_bytes);
    digest.update(runner_digest);
    digest.update(runner_length.to_le_bytes());
    digest.update(runner_bytes);
    Ok(digest.finalize().into())
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ReplayPolicyCatalogErrorV2 {
    #[error("Replay Policy Catalog record is invalid: {0}")]
    InvalidRecord(&'static str),
    #[error("Replay Policy Catalog policy is invalid: {0}")]
    InvalidPolicy(String),
    #[error("Replay Policy Catalog authority is unavailable: {0}")]
    Unavailable(String),
    #[error("Replay Policy Catalog command conflicts with canonical custody")]
    Conflict,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayPolicyCatalogBootstrapReceiptV1 {
    pub schema_version: u16,
    pub bootstrap_identity: String,
    pub administrator_identity: String,
    pub verifier_identity: String,
    pub authentication_fact_digest: String,
    pub catalog_binding: ReplayPolicyCatalogBindingV2,
    pub create_command_identity: String,
    pub advance_command_identity: String,
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
    use rstest::rstest;

    use super::*;
    use crate::{
        replay_economic_configuration_v1::{ReplayEconomicConfigurationV1, economic_fixture},
        replay_runner_operational_profile_v1::{ReplayRunnerOperationalProfileV1, runner_fixture},
    };
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
    };

    #[rstest]
    fn record_cross_binding_rejects_every_tampered_component() {
        let record = ReplayPolicyCatalogBindingV2::from_policy("catalog-policy-v2-a", 1, &policy())
            .expect("record");
        assert_eq!(record.verify().expect("verify"), policy());

        let mut changed = record.clone();
        changed.policy_canonical_bytes[0] ^= 1;
        assert!(changed.verify().is_err());
        let mut changed = record.clone();
        changed.catalog_record_id = " replay-policy-v2".into();
        assert!(changed.verify().is_err());
        let mut changed = record.clone();
        changed.catalog_version = 0;
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

    #[rstest]
    fn additive_v3_profile_binding_round_trips_exact_bytes_and_rejects_splices() {
        let economic = ReplayEconomicConfigurationV1::seal(economic_fixture()).unwrap();
        let runner = ReplayRunnerOperationalProfileV1::seal(runner_fixture()).unwrap();
        let historical_v2 =
            ReplayPolicyCatalogBindingV2::from_policy("catalog-policy-v2-historical", 1, &policy())
                .unwrap();
        let historical_json = serde_json::to_value(&historical_v2).unwrap();
        assert!(historical_json.get("execution_profiles_v1").is_none());

        let sealed =
            ReplayPolicyCatalogBindingV3::issue(historical_v2.clone(), &economic, &runner).unwrap();
        let profiles = sealed.execution_profiles_v1();
        let (read_economic, read_runner) = sealed.verify().unwrap();
        assert_eq!(read_economic.canonical_bytes(), economic.canonical_bytes());
        assert_eq!(read_runner.canonical_bytes(), runner.canonical_bytes());
        assert_eq!(sealed.replay_policy_v2(), &historical_v2);
        assert_eq!(sealed.replay_policy_v2().verify().unwrap(), policy());

        let mut changed = sealed.clone();
        changed
            .execution_profiles_v1
            .economic_configuration_canonical_bytes[0] ^= 1;
        assert!(changed.verify().is_err());

        for replace_economic in [true, false] {
            let mut invalid = sealed.clone();
            if replace_economic {
                invalid
                    .execution_profiles_v1
                    .economic_configuration_canonical_bytes = br#"{"economic":1}"#.to_vec();
                let mut digest = Sha256::new();
                digest.update(b"strategy-factory.replay-economic-configuration.v1\0");
                digest.update(
                    &invalid
                        .execution_profiles_v1
                        .economic_configuration_canonical_bytes,
                );
                invalid.execution_profiles_v1.economic_configuration_digest =
                    digest.finalize().into();
            } else {
                invalid
                    .execution_profiles_v1
                    .runner_operational_profile_canonical_bytes = br#"{"runner":1}"#.to_vec();
                let mut digest = Sha256::new();
                digest.update(b"strategy-factory.replay-runner-operational-profile.v1\0");
                digest.update(
                    &invalid
                        .execution_profiles_v1
                        .runner_operational_profile_canonical_bytes,
                );
                invalid
                    .execution_profiles_v1
                    .runner_operational_profile_digest = digest.finalize().into();
            }
            invalid.execution_profiles_v1.binding_digest = execution_profiles_binding_digest(
                invalid.execution_profiles_v1.catalog_record_digest,
                invalid.execution_profiles_v1.economic_configuration_digest,
                &invalid
                    .execution_profiles_v1
                    .economic_configuration_canonical_bytes,
                invalid
                    .execution_profiles_v1
                    .runner_operational_profile_digest,
                &invalid
                    .execution_profiles_v1
                    .runner_operational_profile_canonical_bytes,
            )
            .unwrap();
            invalid.binding_digest = catalog_v3_binding_digest(
                invalid.replay_policy_v2.catalog_record_digest,
                invalid.execution_profiles_v1.binding_digest,
            );
            assert!(invalid.verify().is_err());
        }

        let other =
            ReplayPolicyCatalogBindingV2::from_policy("catalog-policy-v2-other", 2, &policy())
                .unwrap();
        assert!(profiles.verify(*other.catalog_record_digest()).is_err());
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
