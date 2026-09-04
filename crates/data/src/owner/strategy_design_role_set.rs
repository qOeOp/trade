//! Dependency-neutral R&D Strategy Design role-set projection.
//!
//! The receipt hash protects transport integrity only. Authority comes from resolving an exact
//! Composer locator through the deployment-fixed R&D Owner port; callers cannot promote these DTOs
//! to R&D custody merely by recomputing the hash.

use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::replay_market_facts_v2::AuthenticatedComposerNativeJoinV1;
use super::source_binding::BindingDigest;

pub const STRATEGY_DESIGN_ROLE_SET_SCHEMA_V1: u16 = 1;
pub const STRATEGY_DESIGN_ROLE_SET_RESERVED_V1: u16 = 0;
const RECEIPT_DOMAIN: &[u8] = b"rd.strategy-design-role-set.receipt.v1\0";
const NATIVE_JOIN_DOMAIN: &[u8] = b"rd.strategy-design-native-join.receipt.v1\0";
const MAX_RECEIPT_BYTES: usize = 1024 * 1024;

/// Exact untrusted locator for one already-accepted durable Composer operation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyDesignRoleSetLocatorV1 {
    pub schema_version: u16,
    pub request_identity: String,
    pub operation_receipt_identity: BindingDigest,
    pub artifact_locator: String,
    pub artifact_identity: BindingDigest,
    pub canonical_plan_digest: BindingDigest,
    pub design_digest: BindingDigest,
}

/// Immutable Composer attestation of one Market-Owner-authenticated native V4 join.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyDesignNativeJoinReceiptV1 {
    composer_locator: StrategyDesignRoleSetLocatorV1,
    projection_receipt_digest: BindingDigest,
    joined_cut_digest: BindingDigest,
    schedule_dependency_set_digest: BindingDigest,
    canonical_bytes: Vec<u8>,
    receipt_digest: BindingDigest,
}

impl StrategyDesignNativeJoinReceiptV1 {
    /// Seals the exact Market Owner projection into the Composer locator.
    ///
    /// # Errors
    ///
    /// Returns an error if the bounded locator cannot be encoded canonically.
    pub fn from_market_owner(
        composer_locator: StrategyDesignRoleSetLocatorV1,
        native_join: &AuthenticatedComposerNativeJoinV1,
    ) -> Result<Self, StrategyDesignRoleSetErrorV1> {
        let projection_receipt_digest =
            BindingDigest::from_untrusted_bytes(native_join.locator().receipt_digest());
        let mut canonical_bytes = Vec::new();
        canonical_bytes.extend_from_slice(&1_u16.to_be_bytes());
        canonical_bytes.extend_from_slice(&0_u16.to_be_bytes());
        canonical_bytes.extend_from_slice(&composer_locator.schema_version.to_be_bytes());
        push_string(&mut canonical_bytes, &composer_locator.request_identity)?;
        canonical_bytes.extend_from_slice(composer_locator.operation_receipt_identity.as_bytes());
        push_string(&mut canonical_bytes, &composer_locator.artifact_locator)?;
        canonical_bytes.extend_from_slice(composer_locator.artifact_identity.as_bytes());
        canonical_bytes.extend_from_slice(composer_locator.canonical_plan_digest.as_bytes());
        canonical_bytes.extend_from_slice(composer_locator.design_digest.as_bytes());
        canonical_bytes.extend_from_slice(projection_receipt_digest.as_bytes());
        canonical_bytes.extend_from_slice(native_join.joined_cut_digest().as_bytes());
        canonical_bytes.extend_from_slice(native_join.schedule_dependency_set_digest().as_bytes());
        let receipt_digest = domain_digest(NATIVE_JOIN_DOMAIN, &canonical_bytes);
        Ok(Self {
            composer_locator,
            projection_receipt_digest,
            joined_cut_digest: native_join.joined_cut_digest(),
            schedule_dependency_set_digest: native_join.schedule_dependency_set_digest(),
            canonical_bytes,
            receipt_digest,
        })
    }

    pub const fn projection_receipt_digest(&self) -> BindingDigest {
        self.projection_receipt_digest
    }

    pub const fn joined_cut_digest(&self) -> BindingDigest {
        self.joined_cut_digest
    }

    pub const fn schedule_dependency_set_digest(&self) -> BindingDigest {
        self.schedule_dependency_set_digest
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    /// Verifies durable bytes against the exact Composer locator and expected digest.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed, mismatched, zero, or trailing canonical data.
    pub fn from_durable_attestation(
        expected_locator: &StrategyDesignRoleSetLocatorV1,
        canonical_bytes: &[u8],
        expected_digest: BindingDigest,
    ) -> Result<Self, StrategyDesignRoleSetErrorV1> {
        if canonical_bytes.len() > MAX_RECEIPT_BYTES
            || domain_digest(NATIVE_JOIN_DOMAIN, canonical_bytes) != expected_digest
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        let mut decoder = Decoder::new(canonical_bytes);
        if decoder.u16()? != 1 || decoder.u16()? != 0 {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        let schema_version = decoder.u16()?;
        let request_identity = decoder.string()?;
        let operation_receipt_identity = decoder.digest()?;
        let artifact_locator = decoder.string()?;
        let artifact_identity = decoder.digest()?;
        let canonical_plan_digest = decoder.digest()?;
        let design_digest = decoder.digest()?;
        let projection_receipt_digest = decoder.digest()?;
        let joined_cut_digest = decoder.digest()?;
        let schedule_dependency_set_digest = decoder.digest()?;
        decoder.finish()?;
        if schema_version != expected_locator.schema_version
            || request_identity != expected_locator.request_identity
            || operation_receipt_identity != expected_locator.operation_receipt_identity
            || artifact_locator != expected_locator.artifact_locator
            || artifact_identity != expected_locator.artifact_identity
            || canonical_plan_digest != expected_locator.canonical_plan_digest
            || design_digest != expected_locator.design_digest
            || projection_receipt_digest.as_bytes() == &[0; 32]
            || joined_cut_digest.as_bytes() == &[0; 32]
            || schedule_dependency_set_digest.as_bytes() == &[0; 32]
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        Ok(Self {
            composer_locator: expected_locator.clone(),
            projection_receipt_digest,
            joined_cut_digest,
            schedule_dependency_set_digest,
            canonical_bytes: canonical_bytes.to_vec(),
            receipt_digest: expected_digest,
        })
    }
}

/// Complete semantic coordinates for one canonical Strategy Design input role.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyDesignRoleEntryV1 {
    pub role_identity: BindingDigest,
    pub semantic_id: String,
    pub fact_class: String,
    pub instrument: String,
    pub scope: String,
    pub field_semantic_id: String,
    pub channel: String,
    pub timeframe: String,
    pub unit: String,
    pub scale: u8,
    pub value_type: String,
}

/// One role coordinate in the exact Design-declared join order.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyDesignJoinRoleV1 {
    pub semantic_id: String,
    pub role_identity: BindingDigest,
}

/// Complete semantic coordinates for one canonical Strategy Design join.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StrategyDesignJoinEntryV1 {
    pub join_identity: BindingDigest,
    pub semantic_id: String,
    pub roles: Vec<StrategyDesignJoinRoleV1>,
    pub alignment_semantic_id: String,
    pub trigger_input_id: String,
    pub max_staleness_ns: u64,
}

/// Integrity-protected read-only projection of existing R&D Composer custody.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyDesignRoleSetReceiptV1 {
    pub schema_version: u16,
    pub reserved: u16,
    pub composer_locator: StrategyDesignRoleSetLocatorV1,
    pub operation_receipt_identity: BindingDigest,
    pub research_request_identity: BindingDigest,
    pub intent_identity: BindingDigest,
    pub design_identity: BindingDigest,
    pub design_digest: BindingDigest,
    pub canonical_design_digest: BindingDigest,
    pub canonical_plan_digest: BindingDigest,
    pub artifact_identity: BindingDigest,
    pub roles: Vec<StrategyDesignRoleEntryV1>,
    pub joins: Vec<StrategyDesignJoinEntryV1>,
    canonical_bytes: Vec<u8>,
    receipt_digest: BindingDigest,
}

impl StrategyDesignRoleSetReceiptV1 {
    /// Builds the transport projection used only by the fixed R&D Owner adapter.
    ///
    /// The resulting value is not authority by construction; consumers must receive it from the
    /// admitted resolver and then call [`Self::has_valid_integrity`].
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleSetErrorV1::InvalidProjection`] when the locator, ordering,
    /// completeness, or semantic coordinates are not canonical.
    #[allow(clippy::too_many_arguments)]
    pub fn from_rd_owner_projection(
        composer_locator: StrategyDesignRoleSetLocatorV1,
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        design_identity: BindingDigest,
        design_digest: BindingDigest,
        canonical_design_digest: BindingDigest,
        roles: Vec<StrategyDesignRoleEntryV1>,
        joins: Vec<StrategyDesignJoinEntryV1>,
    ) -> Result<Self, StrategyDesignRoleSetErrorV1> {
        let mut receipt = Self {
            schema_version: STRATEGY_DESIGN_ROLE_SET_SCHEMA_V1,
            reserved: STRATEGY_DESIGN_ROLE_SET_RESERVED_V1,
            operation_receipt_identity: composer_locator.operation_receipt_identity,
            canonical_plan_digest: composer_locator.canonical_plan_digest,
            artifact_identity: composer_locator.artifact_identity,
            composer_locator,
            research_request_identity,
            intent_identity,
            design_identity,
            design_digest,
            canonical_design_digest,
            roles,
            joins,
            canonical_bytes: vec![],
            receipt_digest: BindingDigest::from_untrusted_bytes([0; 32]),
        };
        validate_projection(&receipt)?;
        receipt.canonical_bytes = encode_canonical(&receipt)?;
        receipt.receipt_digest = digest_bytes(&receipt.canonical_bytes);
        Ok(receipt)
    }

    #[must_use]
    pub fn has_valid_integrity(&self) -> bool {
        validate_projection(self).is_ok()
            && encode_canonical(self).is_ok_and(|bytes| bytes == self.canonical_bytes)
            && self.receipt_digest == digest_bytes(&self.canonical_bytes)
    }

    pub fn role(&self, identity: BindingDigest) -> Option<&StrategyDesignRoleEntryV1> {
        self.roles
            .binary_search_by_key(&identity, |role| role.role_identity)
            .ok()
            .map(|index| &self.roles[index])
    }

    /// Returns the exact durable binary projection bytes recovered for this locator.
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// Returns the domain-separated SHA-256 integrity digest of [`Self::canonical_bytes`].
    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    /// Returns the content-addressed attestation identity.
    pub const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_digest
    }

    /// Reconstitutes an exact durable attestation after its locator and digest were selected by
    /// the deployment-fixed R&D database read seam.
    ///
    /// This is transport decoding, not authority. Market Data converts only bytes returned by its
    /// fixed R&D database connection into the crate-private capability used by positive issuance.
    #[doc(hidden)]
    pub fn from_durable_attestation(
        expected_locator: &StrategyDesignRoleSetLocatorV1,
        canonical_bytes: &[u8],
        expected_digest: BindingDigest,
    ) -> Result<Self, StrategyDesignRoleSetErrorV1> {
        if canonical_bytes.len() > MAX_RECEIPT_BYTES
            || digest_bytes(canonical_bytes) != expected_digest
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        let mut decoder = Decoder::new(canonical_bytes);
        let schema_version = decoder.u16()?;
        let reserved = decoder.u16()?;
        let composer_locator = StrategyDesignRoleSetLocatorV1 {
            schema_version: decoder.u16()?,
            request_identity: decoder.string()?,
            operation_receipt_identity: decoder.digest()?,
            artifact_locator: decoder.string()?,
            artifact_identity: decoder.digest()?,
            canonical_plan_digest: decoder.digest()?,
            design_digest: decoder.digest()?,
        };
        let operation_receipt_identity = decoder.digest()?;
        let research_request_identity = decoder.digest()?;
        let intent_identity = decoder.digest()?;
        let design_identity = decoder.digest()?;
        let design_digest = decoder.digest()?;
        let canonical_design_digest = decoder.digest()?;
        let canonical_plan_digest = decoder.digest()?;
        let artifact_identity = decoder.digest()?;
        let role_count = decoder.count()?;
        let mut roles = Vec::with_capacity(role_count);
        for _ in 0..role_count {
            roles.push(StrategyDesignRoleEntryV1 {
                role_identity: decoder.digest()?,
                semantic_id: decoder.string()?,
                fact_class: decoder.string()?,
                instrument: decoder.string()?,
                scope: decoder.string()?,
                field_semantic_id: decoder.string()?,
                channel: decoder.string()?,
                timeframe: decoder.string()?,
                unit: decoder.string()?,
                scale: decoder.u8()?,
                value_type: decoder.string()?,
            });
        }
        let join_count = decoder.count()?;
        let mut joins = Vec::with_capacity(join_count);
        for _ in 0..join_count {
            let join_identity = decoder.digest()?;
            let semantic_id = decoder.string()?;
            let join_role_count = decoder.count()?;
            let mut join_roles = Vec::with_capacity(join_role_count);
            for _ in 0..join_role_count {
                join_roles.push(StrategyDesignJoinRoleV1 {
                    semantic_id: decoder.string()?,
                    role_identity: decoder.digest()?,
                });
            }
            joins.push(StrategyDesignJoinEntryV1 {
                join_identity,
                semantic_id,
                roles: join_roles,
                alignment_semantic_id: decoder.string()?,
                trigger_input_id: decoder.string()?,
                max_staleness_ns: decoder.u64()?,
            });
        }
        decoder.finish()?;
        let receipt = Self {
            schema_version,
            reserved,
            composer_locator,
            operation_receipt_identity,
            research_request_identity,
            intent_identity,
            design_identity,
            design_digest,
            canonical_design_digest,
            canonical_plan_digest,
            artifact_identity,
            roles,
            joins,
            canonical_bytes: canonical_bytes.to_vec(),
            receipt_digest: expected_digest,
        };
        if receipt.composer_locator != *expected_locator || !receipt.has_valid_integrity() {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        Ok(receipt)
    }
}

/// Market Data's unforgeable proof that the role set came from its fixed exact-locator R&D DB seam.
pub(in crate::owner) struct AuthenticatedStrategyDesignRoleSetV1 {
    receipt: StrategyDesignRoleSetReceiptV1,
}

impl AuthenticatedStrategyDesignRoleSetV1 {
    pub(in crate::owner) const fn receipt(&self) -> &StrategyDesignRoleSetReceiptV1 {
        &self.receipt
    }
}

pub(in crate::owner) fn authenticate_durable_strategy_design_role_set_v1(
    locator: &StrategyDesignRoleSetLocatorV1,
    canonical_bytes: &[u8],
    receipt_digest: BindingDigest,
) -> Result<AuthenticatedStrategyDesignRoleSetV1, StrategyDesignRoleSetErrorV1> {
    Ok(AuthenticatedStrategyDesignRoleSetV1 {
        receipt: StrategyDesignRoleSetReceiptV1::from_durable_attestation(
            locator,
            canonical_bytes,
            receipt_digest,
        )?,
    })
}

/// Exact-locator readback returned by the deployment-fixed R&D resolver.
///
/// This transport value is deliberately not deserializable. Its construction does not itself
/// grant authority; production consumers trust only the value returned by their fixed adapter.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct StrategyDesignRoleSetReadbackV1 {
    locator: StrategyDesignRoleSetLocatorV1,
    receipt: StrategyDesignRoleSetReceiptV1,
}

impl StrategyDesignRoleSetReadbackV1 {
    /// Forms the readback after the fixed resolver has authenticated existing Composer custody.
    ///
    /// # Errors
    ///
    /// Returns [`StrategyDesignRoleSetErrorV1::InvalidProjection`] when the receipt is corrupt or
    /// does not repeat the exact requested locator.
    #[doc(hidden)]
    pub fn from_fixed_resolver(
        locator: StrategyDesignRoleSetLocatorV1,
        receipt: StrategyDesignRoleSetReceiptV1,
    ) -> Result<Self, StrategyDesignRoleSetErrorV1> {
        if !receipt.has_valid_integrity() || receipt.composer_locator != locator {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        Ok(Self { locator, receipt })
    }

    pub const fn locator(&self) -> &StrategyDesignRoleSetLocatorV1 {
        &self.locator
    }

    pub const fn receipt(&self) -> &StrategyDesignRoleSetReceiptV1 {
        &self.receipt
    }
}

/// Read-only R&D Owner authority port. Deployment composition fixes its implementation.
#[async_trait::async_trait]
pub trait StrategyDesignRoleSetResolverV1: Send + Sync {
    async fn resolve_strategy_design_role_set_v1(
        &self,
        locator: &StrategyDesignRoleSetLocatorV1,
    ) -> Result<StrategyDesignRoleSetReadbackV1, StrategyDesignRoleSetErrorV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyDesignRoleSetErrorV1 {
    InvalidLocator,
    InvalidProjection,
    Unavailable,
}

impl Display for StrategyDesignRoleSetErrorV1 {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for StrategyDesignRoleSetErrorV1 {}

fn validate_projection(
    receipt: &StrategyDesignRoleSetReceiptV1,
) -> Result<(), StrategyDesignRoleSetErrorV1> {
    let locator = &receipt.composer_locator;
    if receipt.schema_version != STRATEGY_DESIGN_ROLE_SET_SCHEMA_V1
        || receipt.reserved != STRATEGY_DESIGN_ROLE_SET_RESERVED_V1
        || locator.schema_version != 2
        || locator.request_identity.is_empty()
        || locator.artifact_locator.is_empty()
        || receipt.operation_receipt_identity != locator.operation_receipt_identity
        || receipt.design_digest != locator.design_digest
        || receipt.canonical_plan_digest != locator.canonical_plan_digest
        || receipt.artifact_identity != locator.artifact_identity
        || receipt.roles.is_empty()
        || receipt.canonical_bytes.len() > MAX_RECEIPT_BYTES
        || receipt
            .roles
            .windows(2)
            .any(|pair| pair[0].role_identity >= pair[1].role_identity)
        || receipt
            .joins
            .windows(2)
            .any(|pair| pair[0].join_identity >= pair[1].join_identity)
    {
        return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
    }
    for role in &receipt.roles {
        if role.semantic_id.is_empty()
            || role.fact_class.is_empty()
            || role.scope.is_empty()
            || role.field_semantic_id.is_empty()
            || role.channel.is_empty()
            || role.timeframe.is_empty()
            || role.unit.is_empty()
            || role.value_type.is_empty()
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
    }
    for join in &receipt.joins {
        if join.semantic_id.is_empty()
            || join.roles.len() < 2
            || join.alignment_semantic_id.is_empty()
            || join.trigger_input_id.is_empty()
            || join.max_staleness_ns == 0
            || join.roles.iter().any(|role| {
                receipt
                    .role(role.role_identity)
                    .is_none_or(|entry| entry.semantic_id != role.semantic_id)
            })
            || !join
                .roles
                .iter()
                .any(|role| role.semantic_id == join.trigger_input_id)
        {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
    }
    Ok(())
}

fn encode_canonical(
    receipt: &StrategyDesignRoleSetReceiptV1,
) -> Result<Vec<u8>, StrategyDesignRoleSetErrorV1> {
    let mut bytes = Vec::new();
    bytes.extend(receipt.schema_version.to_be_bytes());
    bytes.extend(receipt.reserved.to_be_bytes());
    bytes.extend(receipt.composer_locator.schema_version.to_be_bytes());
    push_string(&mut bytes, &receipt.composer_locator.request_identity)?;
    push_digest(
        &mut bytes,
        receipt.composer_locator.operation_receipt_identity,
    );
    push_string(&mut bytes, &receipt.composer_locator.artifact_locator)?;
    push_digest(&mut bytes, receipt.composer_locator.artifact_identity);
    push_digest(&mut bytes, receipt.composer_locator.canonical_plan_digest);
    push_digest(&mut bytes, receipt.composer_locator.design_digest);
    for digest in [
        receipt.operation_receipt_identity,
        receipt.research_request_identity,
        receipt.intent_identity,
        receipt.design_identity,
        receipt.design_digest,
        receipt.canonical_design_digest,
        receipt.canonical_plan_digest,
        receipt.artifact_identity,
    ] {
        push_digest(&mut bytes, digest);
    }
    push_count(&mut bytes, receipt.roles.len())?;
    for role in &receipt.roles {
        push_digest(&mut bytes, role.role_identity);
        for value in [
            role.semantic_id.as_str(),
            role.fact_class.as_str(),
            role.instrument.as_str(),
            role.scope.as_str(),
            role.field_semantic_id.as_str(),
            role.channel.as_str(),
            role.timeframe.as_str(),
            role.unit.as_str(),
        ] {
            push_string(&mut bytes, value)?;
        }
        bytes.push(role.scale);
        push_string(&mut bytes, &role.value_type)?;
    }
    push_count(&mut bytes, receipt.joins.len())?;
    for join in &receipt.joins {
        push_digest(&mut bytes, join.join_identity);
        push_string(&mut bytes, &join.semantic_id)?;
        push_count(&mut bytes, join.roles.len())?;
        for role in &join.roles {
            push_string(&mut bytes, &role.semantic_id)?;
            push_digest(&mut bytes, role.role_identity);
        }
        push_string(&mut bytes, &join.alignment_semantic_id)?;
        push_string(&mut bytes, &join.trigger_input_id)?;
        bytes.extend(join.max_staleness_ns.to_be_bytes());
    }
    if bytes.len() > MAX_RECEIPT_BYTES {
        return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
    }
    Ok(bytes)
}

fn push_count(bytes: &mut Vec<u8>, count: usize) -> Result<(), StrategyDesignRoleSetErrorV1> {
    let count =
        u32::try_from(count).map_err(|_| StrategyDesignRoleSetErrorV1::InvalidProjection)?;
    bytes.extend(count.to_be_bytes());
    Ok(())
}

fn push_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), StrategyDesignRoleSetErrorV1> {
    push_count(bytes, value.len())?;
    bytes.extend(value.as_bytes());
    Ok(())
}

fn push_digest(bytes: &mut Vec<u8>, digest: BindingDigest) {
    bytes.extend(digest.as_bytes());
}

fn digest_bytes(bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], StrategyDesignRoleSetErrorV1> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(StrategyDesignRoleSetErrorV1::InvalidProjection)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(StrategyDesignRoleSetErrorV1::InvalidProjection)?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, StrategyDesignRoleSetErrorV1> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, StrategyDesignRoleSetErrorV1> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().map_err(
            |_| StrategyDesignRoleSetErrorV1::InvalidProjection,
        )?))
    }

    fn u32(&mut self) -> Result<u32, StrategyDesignRoleSetErrorV1> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().map_err(
            |_| StrategyDesignRoleSetErrorV1::InvalidProjection,
        )?))
    }

    fn u64(&mut self) -> Result<u64, StrategyDesignRoleSetErrorV1> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().map_err(
            |_| StrategyDesignRoleSetErrorV1::InvalidProjection,
        )?))
    }

    fn count(&mut self) -> Result<usize, StrategyDesignRoleSetErrorV1> {
        let count = usize::try_from(self.u32()?)
            .map_err(|_| StrategyDesignRoleSetErrorV1::InvalidProjection)?;
        if count > MAX_RECEIPT_BYTES {
            return Err(StrategyDesignRoleSetErrorV1::InvalidProjection);
        }
        Ok(count)
    }

    fn string(&mut self) -> Result<String, StrategyDesignRoleSetErrorV1> {
        let len = self.count()?;
        String::from_utf8(self.take(len)?.to_vec())
            .map_err(|_| StrategyDesignRoleSetErrorV1::InvalidProjection)
    }

    fn digest(&mut self) -> Result<BindingDigest, StrategyDesignRoleSetErrorV1> {
        Ok(BindingDigest::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| StrategyDesignRoleSetErrorV1::InvalidProjection)?,
        ))
    }

    fn finish(self) -> Result<(), StrategyDesignRoleSetErrorV1> {
        (self.offset == self.bytes.len())
            .then_some(())
            .ok_or(StrategyDesignRoleSetErrorV1::InvalidProjection)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn role(identity: u8, semantic_id: &str) -> StrategyDesignRoleEntryV1 {
        StrategyDesignRoleEntryV1 {
            role_identity: d(identity),
            semantic_id: semantic_id.into(),
            fact_class: "MARKET_DATA".into(),
            instrument: "XNAS:AAPL".into(),
            scope: "EXACT_INSTRUMENT".into(),
            field_semantic_id: "BAR_CLOSE_PRICE".into(),
            channel: "MARKET".into(),
            timeframe: "PT1M".into(),
            unit: "PRICE".into(),
            scale: 4,
            value_type: "I128".into(),
        }
    }

    #[rstest]
    fn integrity_requires_sorted_complete_role_and_join_coordinates() {
        let locator = StrategyDesignRoleSetLocatorV1 {
            schema_version: 2,
            request_identity: "request".into(),
            operation_receipt_identity: d(1),
            artifact_locator: "artifact".into(),
            artifact_identity: d(2),
            canonical_plan_digest: d(3),
            design_digest: d(4),
        };
        let roles = vec![role(5, "close"), role(6, "open")];
        let joins = vec![StrategyDesignJoinEntryV1 {
            join_identity: d(7),
            semantic_id: "bar".into(),
            roles: vec![
                StrategyDesignJoinRoleV1 {
                    semantic_id: "open".into(),
                    role_identity: d(6),
                },
                StrategyDesignJoinRoleV1 {
                    semantic_id: "close".into(),
                    role_identity: d(5),
                },
            ],
            alignment_semantic_id: "LATEST_NOT_AFTER".into(),
            trigger_input_id: "close".into(),
            max_staleness_ns: 60,
        }];
        let receipt = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
            locator,
            d(8),
            d(9),
            d(10),
            d(4),
            d(11),
            roles,
            joins,
        )
        .unwrap();
        assert!(receipt.has_valid_integrity());
        assert_eq!(
            &receipt.canonical_bytes()[..17],
            b"\0\x01\0\0\0\x02\0\0\0\x07request"
        );
        let recovered = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
            receipt.composer_locator.clone(),
            receipt.research_request_identity,
            receipt.intent_identity,
            receipt.design_identity,
            receipt.design_digest,
            receipt.canonical_design_digest,
            receipt.roles.clone(),
            receipt.joins.clone(),
        )
        .unwrap();
        assert_eq!(recovered.canonical_bytes(), receipt.canonical_bytes());
        assert_eq!(recovered.receipt_digest(), receipt.receipt_digest());
        let durable = StrategyDesignRoleSetReceiptV1::from_durable_attestation(
            &receipt.composer_locator,
            receipt.canonical_bytes(),
            receipt.receipt_digest(),
        )
        .unwrap();
        assert_eq!(durable, receipt);
        let mut cross_locator = receipt.composer_locator.clone();
        cross_locator.canonical_plan_digest = d(99);
        assert_eq!(
            StrategyDesignRoleSetReceiptV1::from_durable_attestation(
                &cross_locator,
                receipt.canonical_bytes(),
                receipt.receipt_digest(),
            ),
            Err(StrategyDesignRoleSetErrorV1::InvalidProjection)
        );
        assert_eq!(
            StrategyDesignRoleSetReceiptV1::from_durable_attestation(
                &receipt.composer_locator,
                receipt.canonical_bytes(),
                d(98),
            ),
            Err(StrategyDesignRoleSetErrorV1::InvalidProjection)
        );
        let readback = StrategyDesignRoleSetReadbackV1::from_fixed_resolver(
            receipt.composer_locator.clone(),
            receipt.clone(),
        )
        .unwrap();
        assert_eq!(readback.receipt(), &receipt);
        let mut reordered = receipt;
        reordered.roles.reverse();
        reordered.canonical_bytes = encode_canonical(&reordered).unwrap();
        reordered.receipt_digest = digest_bytes(&reordered.canonical_bytes);
        assert!(!reordered.has_valid_integrity());
        reordered.roles.reverse();
        reordered.canonical_bytes = encode_canonical(&reordered).unwrap();
        reordered.receipt_digest = digest_bytes(&reordered.canonical_bytes);
        reordered.roles[0].value_type = "I64".into();
        reordered.canonical_bytes = encode_canonical(&reordered).unwrap();
        reordered.receipt_digest = digest_bytes(&reordered.canonical_bytes);
        assert!(reordered.has_valid_integrity());
        // Integrity is intentionally not authority: a self-consistent forged DTO cannot be
        // injected into the fixed resolver endpoint, which accepts only an exact locator.
        reordered.roles[0].value_type = "I128".into();
        reordered.canonical_bytes.push(0);
        reordered.receipt_digest = digest_bytes(&reordered.canonical_bytes);
        assert!(!reordered.has_valid_integrity());
    }
}
