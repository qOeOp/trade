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
//!
//! Schema 2 also names the Research Intent's initial PIT request. Market Data registers a
//! universe-member Design against exactly that request instead of searching for one, and a schema 1
//! intent names none, so its universe-member roles are refused. Schema 1 bytes and digests are
//! unchanged: the reference is absent from them rather than null, and each schema digests under its
//! own domain.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::source_binding::BindingDigest;
use super::strategy_design_role_set::StrategyDesignRoleEntryV1;

/// Schema version of an intent that names no initial PIT request.
pub const STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1: u16 = 1;

/// Schema version of an intent that names its Research Intent's initial PIT request.
pub const STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V2: u16 = 2;

/// The most roles one Design may declare through this boundary.
pub const STRATEGY_DESIGN_ROLE_INTENT_MAX_ROLES_V1: usize = 64;

const INTENT_DOMAIN_V1: &[u8] = b"rd.strategy-design-role-intent.v1\0";
const INTENT_DOMAIN_V2: &[u8] = b"rd.strategy-design-role-intent.v2\0";
const MAX_STRING_BYTES: usize = 256;

/// The canonical scope of a role bound to one exact instrument, which it must name.
const EXACT_INSTRUMENT_SCOPE: &str = r#"{"kind":"EXACT_INSTRUMENT"}"#;
/// The canonical scope of a role repeated for every member of a universe selection. It names no
/// instrument: the selection is the PIT request's, never the Design's.
const UNIVERSE_MEMBERS_SCOPE: &str = r#"{"kind":"UNIVERSE_MEMBERS"}"#;

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

/// The initial PIT request a schema 2 intent names: the claimed request identity and digest the
/// PIT intake stored the request under, which is the pair Market Data loads its lineage by.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InitialPitRequestLocatorV1 {
    /// The PIT request's identity.
    pub pit_request_identity: BindingDigest,
    /// The PIT request's canonical digest.
    pub pit_request_digest: BindingDigest,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    initial_pit_request: Option<InitialPitRequestLocatorV1>,
    canonical_bytes: Vec<u8>,
    intent_digest: BindingDigest,
}

impl StrategyDesignRoleIntentV1 {
    /// Builds the schema 1 projection R&D publishes for a Design whose Research request names no
    /// initial PIT request.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleIntentErrorV1::InvalidProjection`] when the Design declares no
    /// roles, declares more than the bounded maximum, does not present them in ascending role
    /// identity order, or carries a field that is empty or longer than the bounded maximum.
    pub fn from_rd_owner_projection(
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        research_custody_digest: BindingDigest,
        design_identity: BindingDigest,
        design_digest: BindingDigest,
        roles: Vec<StrategyDesignRoleEntryV1>,
    ) -> Result<Self, StrategyDesignRoleIntentErrorV1> {
        Self::build(Unsealed {
            schema_version: STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1,
            research_request_identity,
            intent_identity,
            research_custody_digest,
            design_identity,
            design_digest,
            roles,
            initial_pit_request: None,
        })
    }

    /// Builds the schema 2 projection, which also names the Research Intent's initial PIT request.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleIntentErrorV1::InvalidProjection`] for every refusal of
    /// [`Self::from_rd_owner_projection`], and when either half of `initial_pit_request` is all
    /// zero.
    pub fn from_rd_owner_projection_with_initial_pit(
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        research_custody_digest: BindingDigest,
        design_identity: BindingDigest,
        design_digest: BindingDigest,
        roles: Vec<StrategyDesignRoleEntryV1>,
        initial_pit_request: InitialPitRequestLocatorV1,
    ) -> Result<Self, StrategyDesignRoleIntentErrorV1> {
        Self::build(Unsealed {
            schema_version: STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V2,
            research_request_identity,
            intent_identity,
            research_custody_digest,
            design_identity,
            design_digest,
            roles,
            initial_pit_request: Some(initial_pit_request),
        })
    }

    fn build(unsealed: Unsealed) -> Result<Self, StrategyDesignRoleIntentErrorV1> {
        let mut intent = Self {
            schema_version: unsealed.schema_version,
            research_request_identity: unsealed.research_request_identity,
            intent_identity: unsealed.intent_identity,
            research_custody_digest: unsealed.research_custody_digest,
            design_identity: unsealed.design_identity,
            design_digest: unsealed.design_digest,
            roles: unsealed.roles,
            initial_pit_request: unsealed.initial_pit_request,
            canonical_bytes: Vec::new(),
            intent_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        };

        let domain = validate(&intent)?;
        intent.canonical_bytes = encode(&intent)?;
        intent.intent_digest = digest(domain, &intent.canonical_bytes);
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
        // The stored schema version chooses the rules and the digest domain, so a schema 1 row
        // that carries a PIT reference, or a schema 2 row without one, is refused rather than
        // rebuilt as the other schema.
        let rebuilt = Self::build(Unsealed {
            schema_version: decoded.schema_version,
            research_request_identity: decoded.research_request_identity,
            intent_identity: decoded.intent_identity,
            research_custody_digest: decoded.research_custody_digest,
            design_identity: decoded.design_identity,
            design_digest: decoded.design_digest,
            roles: decoded.roles,
            initial_pit_request: decoded.initial_pit_request,
        })
        .map_err(|_| StrategyDesignRoleIntentErrorV1::IntegrityMismatch)?;

        if rebuilt.intent_digest != expected_digest {
            return Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch);
        }

        Ok(rebuilt)
    }

    /// The schema this intent was published under.
    #[must_use]
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    /// The Research Intent's initial PIT request, which only a schema 2 intent names.
    #[must_use]
    pub const fn initial_pit_request(&self) -> Option<InitialPitRequestLocatorV1> {
        self.initial_pit_request
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

    /// The roles the Design declares, ascending by role identity.
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

/// The fields a projection is built from, before its bytes and digest are derived.
struct Unsealed {
    schema_version: u16,
    research_request_identity: BindingDigest,
    intent_identity: BindingDigest,
    research_custody_digest: BindingDigest,
    design_identity: BindingDigest,
    design_digest: BindingDigest,
    roles: Vec<StrategyDesignRoleEntryV1>,
    initial_pit_request: Option<InitialPitRequestLocatorV1>,
}

/// Validates `intent` and returns the digest domain of its schema.
fn validate(
    intent: &StrategyDesignRoleIntentV1,
) -> Result<&'static [u8], StrategyDesignRoleIntentErrorV1> {
    let zero = BindingDigest::from_untrusted_bytes([0; 32]);

    let domain = match (intent.schema_version, intent.initial_pit_request) {
        (STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1, None) => INTENT_DOMAIN_V1,
        (STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V2, Some(request))
            if request.pit_request_identity != zero && request.pit_request_digest != zero =>
        {
            INTENT_DOMAIN_V2
        }
        _ => return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection),
    };

    if intent.roles.is_empty() || intent.roles.len() > STRATEGY_DESIGN_ROLE_INTENT_MAX_ROLES_V1 {
        return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
    }

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

    // Roles ascend by identity, which is both the uniqueness test and the canonical order: one
    // role set then has exactly one publication, and a consumer that matches roles positionally
    // against its own sorted requests is comparing the same sequence rather than two orderings
    // that happened to agree.
    let mut previous: Option<BindingDigest> = None;
    for role in &intent.roles {
        if role.role_identity == zero || previous.is_some_and(|last| last >= role.role_identity) {
            return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
        }
        previous = Some(role.role_identity);

        // A role's scope decides whether it names an instrument, exactly as Market Data matches
        // it: an exact-instrument role names one, a universe-member role names none, and no other
        // scope is a role this boundary carries.
        let names_instrument = match role.scope.as_str() {
            EXACT_INSTRUMENT_SCOPE => true,
            UNIVERSE_MEMBERS_SCOPE => false,
            _ => return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection),
        };

        if role.instrument.is_empty() == names_instrument
            || role.instrument.len() > MAX_STRING_BYTES
        {
            return Err(StrategyDesignRoleIntentErrorV1::InvalidProjection);
        }

        for value in [
            role.semantic_id.as_str(),
            role.fact_class.as_str(),
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

    Ok(domain)
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
        initial_pit_request: intent.initial_pit_request,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_pit_request: Option<InitialPitRequestLocatorV1>,
    canonical_bytes: Vec<u8>,
    intent_digest: BindingDigest,
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
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
            scope: EXACT_INSTRUMENT_SCOPE.to_owned(),
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

    fn hex(digest: BindingDigest) -> String {
        use std::fmt::Write as _;

        digest
            .as_bytes()
            .iter()
            .fold(String::with_capacity(64), |mut out, byte| {
                write!(out, "{byte:02x}").expect("writing to a String cannot fail");
                out
            })
    }

    /// Schema 1 intents are already stored write-once, so schema 2 must leave their bytes and
    /// digest exactly as they were.
    #[rstest]
    fn schema_one_bytes_and_digest_are_unchanged() {
        let intent = published();

        assert_eq!(
            intent.schema_version(),
            STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V1
        );
        assert_eq!(intent.initial_pit_request(), None);
        assert!(!String::from_utf8_lossy(intent.canonical_bytes()).contains("initial_pit_request"));
        assert_eq!(
            hex(intent.intent_digest()),
            "6346cf0b4c75ffe41039a19d242b52cf93ff0860563029c096779f251f8035b0"
        );
    }

    fn pit(identity: u8, digest: u8) -> InitialPitRequestLocatorV1 {
        InitialPitRequestLocatorV1 {
            pit_request_identity: d(identity),
            pit_request_digest: d(digest),
        }
    }

    fn published_with_initial_pit() -> StrategyDesignRoleIntentV1 {
        StrategyDesignRoleIntentV1::from_rd_owner_projection_with_initial_pit(
            d(1),
            d(2),
            d(3),
            d(4),
            d(5),
            vec![role(10), role(11)],
            pit(6, 7),
        )
        .expect("a Design with an initial PIT request publishes")
    }

    #[rstest]
    fn a_schema_two_intent_names_its_initial_pit_request_and_reads_back() {
        let intent = published_with_initial_pit();
        let recovered = StrategyDesignRoleIntentV1::from_durable_publication(
            intent.canonical_bytes(),
            intent.intent_digest(),
        )
        .expect("the published bytes read back");

        assert_eq!(recovered, intent);
        assert_eq!(
            recovered.schema_version(),
            STRATEGY_DESIGN_ROLE_INTENT_SCHEMA_V2
        );
        assert_eq!(recovered.initial_pit_request(), Some(pit(6, 7)));
    }

    /// The same Design under the two schemas never shares a digest: the fields differ, and so
    /// does the domain, so bytes of one cannot be presented under the other's digest either.
    #[rstest]
    fn each_schema_digests_under_its_own_domain() {
        let first = published();
        let second = published_with_initial_pit();

        assert_ne!(first.intent_digest(), second.intent_digest());
        assert_eq!(
            second.intent_digest(),
            digest(INTENT_DOMAIN_V2, second.canonical_bytes())
        );
        assert_ne!(
            second.intent_digest(),
            digest(INTENT_DOMAIN_V1, second.canonical_bytes())
        );
        assert_eq!(
            StrategyDesignRoleIntentV1::from_durable_publication(
                second.canonical_bytes(),
                digest(INTENT_DOMAIN_V1, second.canonical_bytes())
            ),
            Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch)
        );
    }

    /// A stored row is rebuilt under its own schema's rules, so relabelling the version, adding
    /// a reference to a schema 1 row, or dropping it from a schema 2 row is refused, even when
    /// the digest presented is the one the altered bytes would reproduce under that schema.
    #[rstest]
    fn a_row_whose_version_and_reference_disagree_is_refused() {
        let first = String::from_utf8(published().canonical_bytes().to_vec())
            .expect("canonical bytes are text");
        let second = String::from_utf8(published_with_initial_pit().canonical_bytes().to_vec())
            .expect("canonical bytes are text");

        let schema_one_with_reference =
            second.replacen("\"schema_version\":2", "\"schema_version\":1", 1);
        let schema_two_without_reference =
            first.replacen("\"schema_version\":1", "\"schema_version\":2", 1);
        let unknown_schema = second.replacen("\"schema_version\":2", "\"schema_version\":3", 1);
        assert_ne!(schema_one_with_reference, second);
        assert_ne!(schema_two_without_reference, first);
        assert_ne!(unknown_schema, second);

        for (bytes, domain) in [
            (schema_one_with_reference, INTENT_DOMAIN_V1),
            (schema_two_without_reference, INTENT_DOMAIN_V2),
            (unknown_schema, INTENT_DOMAIN_V2),
        ] {
            assert_eq!(
                StrategyDesignRoleIntentV1::from_durable_publication(
                    bytes.as_bytes(),
                    digest(domain, bytes.as_bytes())
                ),
                Err(StrategyDesignRoleIntentErrorV1::IntegrityMismatch)
            );
        }
    }

    #[rstest]
    fn an_initial_pit_request_with_an_unstated_half_is_refused() {
        for request in [pit(0, 7), pit(6, 0)] {
            assert_eq!(
                StrategyDesignRoleIntentV1::from_rd_owner_projection_with_initial_pit(
                    d(1),
                    d(2),
                    d(3),
                    d(4),
                    d(5),
                    vec![role(10)],
                    request,
                )
                .unwrap_err(),
                StrategyDesignRoleIntentErrorV1::InvalidProjection
            );
        }
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
    fn a_projection_that_declares_nothing_or_is_not_in_canonical_order_is_refused() {
        for roles in [vec![], vec![role(10), role(10)], vec![role(11), role(10)]] {
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

    fn universe_role(value: u8) -> StrategyDesignRoleEntryV1 {
        StrategyDesignRoleEntryV1 {
            instrument: String::new(),
            scope: UNIVERSE_MEMBERS_SCOPE.to_owned(),
            ..role(value)
        }
    }

    /// A universe-member role names no instrument, so a Design declaring one publishes and reads
    /// back under either schema, alone or beside an exact-instrument role.
    #[rstest]
    fn a_design_with_universe_member_roles_publishes_and_reads_back() {
        for intent in [
            StrategyDesignRoleIntentV1::from_rd_owner_projection(
                d(1),
                d(2),
                d(3),
                d(4),
                d(5),
                vec![universe_role(10), role(11)],
            ),
            StrategyDesignRoleIntentV1::from_rd_owner_projection_with_initial_pit(
                d(1),
                d(2),
                d(3),
                d(4),
                d(5),
                vec![universe_role(10), universe_role(11)],
                pit(6, 7),
            ),
        ] {
            let intent = intent.expect("a Design with universe-member roles publishes");
            assert_eq!(
                StrategyDesignRoleIntentV1::from_durable_publication(
                    intent.canonical_bytes(),
                    intent.intent_digest(),
                ),
                Ok(intent.clone())
            );
            assert_eq!(intent.role(d(10)).unwrap().instrument, "");
        }
    }

    /// The scope and the instrument must agree, as Market Data matches them.
    #[rstest]
    fn a_role_whose_scope_and_instrument_disagree_is_refused() {
        let universe_naming_an_instrument = StrategyDesignRoleEntryV1 {
            instrument: "BTCUSDT".to_owned(),
            ..universe_role(10)
        };
        let exact_naming_none = StrategyDesignRoleEntryV1 {
            instrument: String::new(),
            ..role(10)
        };
        let unknown_scope = StrategyDesignRoleEntryV1 {
            scope: "EXACT_INSTRUMENT".to_owned(),
            ..role(10)
        };

        for refused in [
            universe_naming_an_instrument,
            exact_naming_none,
            unknown_scope,
        ] {
            assert_eq!(
                StrategyDesignRoleIntentV1::from_rd_owner_projection(
                    d(1),
                    d(2),
                    d(3),
                    d(4),
                    d(5),
                    vec![refused.clone()]
                ),
                Err(StrategyDesignRoleIntentErrorV1::InvalidProjection),
                "{refused:?}"
            );
        }
    }
}
