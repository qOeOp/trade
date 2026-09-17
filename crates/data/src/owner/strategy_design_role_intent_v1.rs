//! The Design-level role intent R&D publishes before any program exists.
//!
//! Every other shape that carries Design meaning across this boundary is bound to an artifact: a
//! role-set receipt names a Composer locator, and the attestation row that carries one references a
//! Composer operation. That is correct once a Composer has run, and it cannot describe the state
//! before the first one has, because a program's own identity depends on the binding receipts this
//! registry issues. `BoundedFeatureInputV1` carries a `static_binding_receipt_digest` for every
//! input, refuses an all-zero digest, and folds the value into the program's canonical digest.
//!
//! So the first thing R&D can authenticate is the Design itself, which is what the Market Data
//! contract means by Owner-authenticated Design/role intent: R&D states which Research request and
//! custody a Design was admitted against and which roles it declares, and states nothing about
//! members, frames or binding digests, which remain Market Data's to resolve.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::source_binding::BindingDigest;
use super::strategy_design_role_set::StrategyDesignRoleEntryV1;

/// Schema version of the published intent.
pub const STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1: u16 = 1;

/// The most roles one Design may declare through this boundary.
pub const STRATEGY_DESIGN_ROLE_INTENT_MAX_ROLES_V1: usize = 64;

const INTENT_DOMAIN: &[u8] = b"rd.strategy-design-role-intent.v1\0";
const MAX_STRING_BYTES: usize = 256;

/// Why a published intent could not be built or accepted.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum StrategyDesignRoleIntentErrorV1 {
    /// The projection does not describe one admissible Design.
    #[error("the published Design role intent is not a valid projection")]
    InvalidProjection,
    /// The stored bytes do not reproduce the digest they are stored under.
    #[error("the published Design role intent does not reproduce its digest")]
    IntegrityMismatch,
}

/// What R&D publishes about one Design, before any program or artifact exists for it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StrategyDesignRoleIntentV1 {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    roles: Vec<StrategyDesignRoleEntryV1>,
    canonical_bytes: Vec<u8>,
    intent_digest: BindingDigest,
}

impl StrategyDesignRoleIntentV1 {
    /// Builds the projection R&D publishes for a Design it has admitted against Research custody.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleIntentErrorV1::InvalidProjection`] when the Design declares no
    /// roles, declares more than the bounded maximum, repeats a role identity, or carries a field
    /// that is empty or longer than the bounded maximum.
    pub fn from_rd_owner_projection(
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        research_custody_digest: BindingDigest,
        design_identity: BindingDigest,
        design_digest: BindingDigest,
        roles: Vec<StrategyDesignRoleEntryV1>,
    ) -> Result<Self, StrategyDesignRoleIntentErrorV1> {
        let mut intent = Self {
            schema_version: STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1,
            research_request_identity,
            intent_identity,
            research_custody_digest,
            design_identity,
            design_digest,
            roles,
            canonical_bytes: Vec::new(),
            intent_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        };

        validate(&intent)?;
        intent.canonical_bytes = encode(&intent)?;
        intent.intent_digest = digest(&intent.canonical_bytes);
        Ok(intent)
    }

    /// Reconstructs a published intent from the bytes and digest Market Data read back.
    ///
    /// The bytes are untrusted until they reproduce the digest they were stored under, so this
    /// re-derives both rather than believing either.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleIntentErrorV1::IntegrityMismatch`] when the bytes do not decode
    /// to a valid projection whose re-encoding reproduces `expected_digest` exactly.
    pub fn from_durable_publication(
        canonical_bytes: &[u8],
        expected_digest: BindingDigest,
    ) -> Result<Self, StrategyDesignRoleIntentErrorV1> {
        let decoded: Self = serde_json::from_slice(canonical_bytes)
            .map_err(|_| StrategyDesignRoleIntentErrorV1::IntegrityMismatch)?;
        let rebuilt = Self::from_rd_owner_projection(
            decoded.research_request_identity,
            decoded.intent_identity,
            decoded.research_custody_digest,
            decoded.design_identity,
            decoded.design_digest,
            decoded.roles,
        )
        .map_err(|_| StrategyDesignRoleIntentErrorV1::IntegrityMismatch)?;

        if rebuilt.intent_digest != expected_digest {
            return Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch);
        }

        Ok(rebuilt)
    }

    /// The Research request this Design was admitted against.
    #[must_use]
    pub const fn research_request_identity(&self) -> BindingDigest {
        self.research_request_identity
    }

    /// The Research intent this Design was admitted against.
    #[must_use]
    pub const fn intent_identity(&self) -> BindingDigest {
        self.intent_identity
    }

    /// The custody digest current when R&D admitted this Design.
    #[must_use]
    pub const fn research_custody_digest(&self) -> BindingDigest {
        self.research_custody_digest
    }

    /// The Design this intent describes.
    #[must_use]
    pub const fn design_identity(&self) -> BindingDigest {
        self.design_identity
    }

    /// The canonical digest of that Design.
    #[must_use]
    pub const fn design_digest(&self) -> BindingDigest {
        self.design_digest
    }

    /// The roles the Design declares, in the order R&D declared them.
    #[must_use]
    pub fn roles(&self) -> &[StrategyDesignRoleEntryV1] {
        &self.roles
    }

    /// The role carrying `identity`, when the Design declares one.
    #[must_use]
    pub fn role(&self, identity: BindingDigest) -> Option<&StrategyDesignRoleEntryV1> {
        self.roles
            .iter()
            .find(|role| role.role_identity == identity)
    }

    /// The bytes this intent is stored and transported as.
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// The digest those bytes reproduce.
    #[must_use]
    pub const fn intent_digest(&self) -> BindingDigest {
        self.intent_digest
    }
}

fn validate(intent: &StrategyDesignRoleIntentV1) -> Result<(), StrategyDesignRoleIntentErrorV1> {
    if intent.schema_version != STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1
        || intent.roles.is_empty()
        || intent.roles.len() > STRATEGY_DESIGN_ROLE_INTENT_MAX_ROLES_V1
    {
        return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
    }

    let zero = BindingDigest::from_untrusted_bytes([0; 32]);

    for digest in [
        intent.research_request_identity,
        intent.intent_identity,
        intent.research_custody_digest,
        intent.design_identity,
        intent.design_digest,
    ] {
        if digest == zero {
            return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
        }
    }

    let mut seen = Vec::with_capacity(intent.roles.len());
    for role in &intent.roles {
        if role.role_identity == zero || seen.contains(&role.role_identity) {
            return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
        }
        seen.push(role.role_identity);

        for value in [
            role.semantic_id.as_str(),
            role.fact_class.as_str(),
            role.instrument.as_str(),
            role.scope.as_str(),
            role.field_semantic_id.as_str(),
            role.channel.as_str(),
            role.timeframe.as_str(),
            role.unit.as_str(),
            role.value_type.as_str(),
        ] {
            if value.is_empty() || value.len() > MAX_STRING_BYTES {
                return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
            }
        }
    }

    Ok(())
}

fn encode(intent: &StrategyDesignRoleIntentV1) -> Result<Vec<u8>, StrategyDesignRoleIntentErrorV1> {
    // The transported bytes are the ones the digest covers, so they are produced once here and
    // never rebuilt from a caller's copy.
    serde_json::to_vec(&CanonicalIntentV1 {
        schema_version: intent.schema_version,
        research_request_identity: intent.research_request_identity,
        intent_identity: intent.intent_identity,
        research_custody_digest: intent.research_custody_digest,
        design_identity: intent.design_identity,
        design_digest: intent.design_digest,
        roles: intent.roles.clone(),
        canonical_bytes: Vec::new(),
        intent_digest: BindingDigest::from_untrusted_bytes([0; 32]),
    })
    .map_err(|_| StrategyDesignRoleIntentErrorV1::InvalidProjection)
}

/// The exact serialised shape, with the two derived fields held at their pre-derivation values so
/// the digest never covers itself.
#[derive(Serialize)]
struct CanonicalIntentV1 {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    roles: Vec<StrategyDesignRoleEntryV1>,
    canonical_bytes: Vec<u8>,
    intent_digest: BindingDigest,
}

fn digest(bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(INTENT_DOMAIN);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn role(value: u8) -> StrategyDesignRoleEntryV1 {
        StrategyDesignRoleEntryV1 {
            role_identity: d(value),
            semantic_id: format!("role-{value}"),
            fact_class: "BAR".to_owned(),
            instrument: "BTCUSDT".to_owned(),
            scope: "SPOT".to_owned(),
            field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
            channel: "PRIMARY".to_owned(),
            timeframe: "1M".to_owned(),
            unit: "QUOTE".to_owned(),
            scale: 8,
            value_type: "FIXED_I128".to_owned(),
        }
    }

    fn published() -> StrategyDesignRoleIntentV1 {
        StrategyDesignRoleIntentV1::from_rd_owner_projection(
            d(1),
            d(2),
            d(3),
            d(4),
            d(5),
            vec![role(10), role(11)],
        )
        .expect("a Design with two distinct roles publishes")
    }

    #[rstest]
    fn published_bytes_reproduce_the_digest_they_are_stored_under() {
        let intent = published();
        let recovered = StrategyDesignRoleIntentV1::from_durable_publication(
            intent.canonical_bytes(),
            intent.intent_digest(),
        )
        .expect("the published bytes read back");

        assert_eq!(recovered, intent);
        assert_eq!(recovered.design_identity(), d(4));
        assert_eq!(recovered.roles().len(), 2);
        assert!(recovered.role(d(10)).is_some());
        assert!(recovered.role(d(99)).is_none());
    }

    #[rstest]
    fn a_digest_from_another_publication_is_refused() {
        let intent = published();
        let other = StrategyDesignRoleIntentV1::from_rd_owner_projection(
            d(1),
            d(2),
            d(3),
            d(4),
            d(5),
            vec![role(10)],
        )
        .expect("a second Design publishes");

        assert_ne!(intent.intent_digest(), other.intent_digest());
        assert_eq!(
            StrategyDesignRoleIntentV1::from_durable_publication(
                intent.canonical_bytes(),
                other.intent_digest()
            ),
            Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch)
        );
    }

    #[rstest]
    fn mutated_bytes_are_refused_even_when_they_still_parse() {
        let intent = published();
        let mutated = String::from_utf8(intent.canonical_bytes().to_vec())
            .expect("canonical bytes are text")
            .replace("BTCUSDT", "ETHUSDT");

        assert_eq!(
            StrategyDesignRoleIntentV1::from_durable_publication(
                mutated.as_bytes(),
                intent.intent_digest()
            ),
            Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch)
        );
    }

    #[rstest]
    fn a_projection_that_declares_nothing_or_repeats_itself_is_refused() {
        for roles in [vec![], vec![role(10), role(10)]] {
            assert_eq!(
                StrategyDesignRoleIntentV1::from_rd_owner_projection(
                    d(1),
                    d(2),
                    d(3),
                    d(4),
                    d(5),
                    roles
                )
                .unwrap_err(),
                StrategyDesignRoleIntentErrorV1::InvalidProjection
            );
        }
    }

    #[rstest]
    fn an_unstated_identity_or_an_unbounded_field_is_refused() {
        assert_eq!(
            StrategyDesignRoleIntentV1::from_rd_owner_projection(
                d(1),
                d(2),
                d(3),
                d(0),
                d(5),
                vec![role(10)]
            )
            .unwrap_err(),
            StrategyDesignRoleIntentErrorV1::InvalidProjection
        );

        let mut oversized = role(10);
        oversized.instrument = "x".repeat(MAX_STRING_BYTES + 1);
        assert_eq!(
            StrategyDesignRoleIntentV1::from_rd_owner_projection(
                d(1),
                d(2),
                d(3),
                d(4),
                d(5),
                vec![oversized]
            )
            .unwrap_err(),
            StrategyDesignRoleIntentErrorV1::InvalidProjection
        );
    }
}
