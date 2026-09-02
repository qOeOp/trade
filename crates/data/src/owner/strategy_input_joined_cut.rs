//! Market Data Owner-sealed complete-cut alignment for typed strategy inputs.
//!
//! Research supplies only a typed join claim. Market Data selects every role by a
//! latest-not-after argmax over one complete Owner census. The resulting receipt is opaque,
//! non-deserializable, and has no public constructor; the Program Host can verify and consume it,
//! but cannot select, substitute, or reorder component frames.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::strategy_input_binding::StrategyInputBindingReceipt;
use super::{
    source_binding::BindingDigest, strategy_input_binding::StrategyInputEventFrameReceipt,
};

const JOIN_IDENTITY_DOMAIN: &[u8] = b"strategy.input-join.identity.v2\0";
const CENSUS_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-join.census.v1\0";
const FRONTIER_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-join.frontier.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.strategy-input-joined-cut.receipt.v1\0";

/// Canonical Research-declared join role projected into the Owner request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputJoinRoleClaimV1 {
    pub semantic_id: String,
    pub input_role_identity: BindingDigest,
}

/// Untrusted exact join claim. A matching positive receipt, not this value, carries authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedStrategyInputJoinClaimV1 {
    pub strategy_design_identity: BindingDigest,
    pub join_semantic_id: String,
    pub join_identity: BindingDigest,
    pub alignment_semantic_id: String,
    pub trigger_input_id: String,
    pub max_staleness_ns: u64,
    pub roles: Vec<StrategyInputJoinRoleClaimV1>,
}

/// Fail-closed Owner issuance categories. No variant contains a partial positive receipt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyInputJoinedCutUnavailable {
    InvalidClaim,
    IncompleteCensus,
    AmbiguousLatest,
    MissingTrigger,
    StaleComponent,
    BindingMismatch,
    CrossDesign,
    CrossCensus,
    MarketSemanticsMismatch,
}

/// One Owner-selected role component. Fields are intentionally private.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputJoinedCutComponentV1 {
    role_semantic_id: String,
    frame_digest: BindingDigest,
    staleness_ns: u64,
    frame: StrategyInputEventFrameReceipt,
}

impl StrategyInputJoinedCutComponentV1 {
    pub fn role_semantic_id(&self) -> &str {
        &self.role_semantic_id
    }

    pub const fn frame(&self) -> &StrategyInputEventFrameReceipt {
        &self.frame
    }
    pub const fn frame_digest(&self) -> BindingDigest {
        self.frame_digest
    }
    pub const fn staleness_ns(&self) -> u64 {
        self.staleness_ns
    }
}

/// Opaque Market Data Owner receipt for one complete joined decision cut.
///
/// It deliberately implements neither `Deserialize` nor a public constructor.
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1;
/// let _: StrategyInputJoinedCutReceiptV1 = serde_json::from_str("{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_data::owner::strategy_input_joined_cut::StrategyInputJoinedCutReceiptV1;
/// let _ = StrategyInputJoinedCutReceiptV1 {};
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputJoinedCutReceiptV1 {
    strategy_design_identity: BindingDigest,
    join_identity: BindingDigest,
    alignment_semantic_id: String,
    trigger_input_id: String,
    trigger_digest: BindingDigest,
    max_staleness_ns: u64,
    selection_basis_digest: BindingDigest,
    frontier_digest: BindingDigest,
    market_semantics_identity: BindingDigest,
    components: Box<[StrategyInputJoinedCutComponentV1]>,
    digest: BindingDigest,
}

impl StrategyInputJoinedCutReceiptV1 {
    pub const fn strategy_design_identity(&self) -> BindingDigest {
        self.strategy_design_identity
    }
    pub const fn join_identity(&self) -> BindingDigest {
        self.join_identity
    }
    pub fn alignment_semantic_id(&self) -> &str {
        &self.alignment_semantic_id
    }
    pub fn trigger_input_id(&self) -> &str {
        &self.trigger_input_id
    }
    pub const fn trigger_digest(&self) -> BindingDigest {
        self.trigger_digest
    }
    pub const fn max_staleness_ns(&self) -> u64 {
        self.max_staleness_ns
    }
    pub const fn selection_basis_digest(&self) -> BindingDigest {
        self.selection_basis_digest
    }
    pub const fn frontier_digest(&self) -> BindingDigest {
        self.frontier_digest
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub fn components(&self) -> &[StrategyInputJoinedCutComponentV1] {
        &self.components
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }

    /// Recomputes the receipt digest from its immutable Owner-sealed projection.
    #[must_use]
    pub fn has_valid_digest(&self) -> bool {
        self.digest == receipt_digest(self)
    }
}

/// Derives the byte-stable identity shared by canonical lowering and Owner issuance.
///
/// # Panics
///
/// Panics only if serialization of the fixed, non-fallible canonical join projection fails.
#[must_use]
pub fn derive_strategy_input_join_identity_v2(
    semantic_id: &str,
    inputs: &[String],
    alignment_semantic_id: &str,
    trigger_input_id: &str,
    max_staleness_ns: u64,
) -> BindingDigest {
    #[derive(Serialize)]
    struct CanonicalJoin<'a> {
        semantic_id: &'a str,
        inputs: &'a [String],
        alignment_semantic_id: &'a str,
        trigger_input_id: &'a str,
        max_staleness_ns: u64,
    }
    digest(
        JOIN_IDENTITY_DOMAIN,
        &serde_json::to_vec(&CanonicalJoin {
            semantic_id,
            inputs,
            alignment_semantic_id,
            trigger_input_id,
            max_staleness_ns,
        })
        .expect("canonical join serialization is infallible"),
    )
}

/// One complete verified Owner census. It is crate-private and cannot cross into the Host.
pub(crate) struct StrategyInputJoinCensusV1 {
    frames: Box<[StrategyInputEventFrameReceipt]>,
    digest: BindingDigest,
    frontier_digest: BindingDigest,
}

/// Seals the complete census presented by the Owner's verified PIT/correction frontier adapter.
pub(crate) fn seal_strategy_input_join_census_v1(
    frames: Vec<StrategyInputEventFrameReceipt>,
) -> Result<StrategyInputJoinCensusV1, StrategyInputJoinedCutUnavailable> {
    if frames.is_empty() || frames.iter().any(|frame| frame.values().len() != 1) {
        return Err(StrategyInputJoinedCutUnavailable::IncompleteCensus);
    }
    let mut coordinates = BTreeSet::new();

    for frame in &frames {
        let value = &frame.values()[0];
        let lifecycle = frame.trigger().lifecycle();

        if !coordinates.insert((
            value.input_role_identity(),
            lifecycle.logical_time(),
            lifecycle.event_time(),
            lifecycle.owner_sequence(),
            lifecycle.event_identity(),
        )) {
            return Err(StrategyInputJoinedCutUnavailable::CrossCensus);
        }
    }
    let mut ordered = frames;
    ordered.sort_by_key(|frame| {
        let value = &frame.values()[0];
        let lifecycle = frame.trigger().lifecycle();
        (
            value.input_role_identity(),
            lifecycle.logical_time(),
            lifecycle.event_time(),
            lifecycle.owner_sequence(),
            lifecycle.event_identity(),
        )
    });
    let mut census_bytes = Vec::new();
    let mut frontier_bytes = Vec::new();

    for frame in &ordered {
        let value = &frame.values()[0];
        census_bytes.extend(frame.trigger().digest().as_bytes());
        census_bytes.extend(value.digest().as_bytes());
        frontier_bytes.extend(value.source_binding_lineage_root().as_bytes());
        frontier_bytes.extend(value.source_binding_lineage_version().to_le_bytes());
        frontier_bytes.extend(value.correction_stream_identity().as_bytes());
        frontier_bytes.extend(value.correction_sequence().to_le_bytes());
        frontier_bytes.extend(value.correction_frontier_digest().as_bytes());
    }
    Ok(StrategyInputJoinCensusV1 {
        frames: ordered.into_boxed_slice(),
        digest: digest(CENSUS_DOMAIN, &census_bytes),
        frontier_digest: digest(FRONTIER_DOMAIN, &frontier_bytes),
    })
}

/// Performs complete-set latest-not-after selection and seals one joined cut.
pub(crate) fn issue_strategy_input_joined_cut_v1(
    claim: &UntrustedStrategyInputJoinClaimV1,
    bindings: &[StrategyInputBindingReceipt],
    census: &StrategyInputJoinCensusV1,
    trigger_logical_time: u64,
) -> Result<StrategyInputJoinedCutReceiptV1, StrategyInputJoinedCutUnavailable> {
    validate_claim(claim)?;
    let by_identity = claim
        .roles
        .iter()
        .map(|role| (role.input_role_identity, role))
        .collect::<BTreeMap<_, _>>();
    let binding_by_identity = bindings
        .iter()
        .map(|binding| (binding.locator().input_role_identity(), binding))
        .collect::<BTreeMap<_, _>>();

    if binding_by_identity.len() != claim.roles.len() || binding_by_identity.len() != bindings.len()
    {
        return Err(StrategyInputJoinedCutUnavailable::BindingMismatch);
    }

    for role in &claim.roles {
        let binding = binding_by_identity
            .get(&role.input_role_identity)
            .ok_or(StrategyInputJoinedCutUnavailable::BindingMismatch)?;
        if binding.locator().strategy_design_identity() != claim.strategy_design_identity {
            return Err(StrategyInputJoinedCutUnavailable::CrossDesign);
        }
    }

    let mut candidates: BTreeMap<BindingDigest, Vec<&StrategyInputEventFrameReceipt>> =
        BTreeMap::new();
    let mut market_semantics = None;

    for frame in &census.frames {
        let value = &frame.values()[0];
        let Some(binding) = binding_by_identity.get(&value.input_role_identity()) else {
            return Err(StrategyInputJoinedCutUnavailable::CrossCensus);
        };

        if value.binding_receipt_digest() != binding.digest()
            || value.source_binding_lineage_root()
                != binding.locator().source_binding_lineage_root()
            || value.correction_stream_identity() != binding.locator().correction_stream_identity()
            || value.market_semantics_identity() != binding.locator().market_semantics_identity()
        {
            return Err(StrategyInputJoinedCutUnavailable::CrossCensus);
        }

        if market_semantics
            .replace(value.market_semantics_identity())
            .is_some_and(|identity| identity != value.market_semantics_identity())
        {
            return Err(StrategyInputJoinedCutUnavailable::MarketSemanticsMismatch);
        }
        candidates
            .entry(value.input_role_identity())
            .or_default()
            .push(frame);
    }

    if candidates.len() != claim.roles.len()
        || candidates
            .keys()
            .any(|identity| !by_identity.contains_key(identity))
    {
        return Err(StrategyInputJoinedCutUnavailable::IncompleteCensus);
    }

    let mut components = Vec::with_capacity(claim.roles.len());
    let mut trigger_digest = None;

    for role in &claim.roles {
        let eligible = candidates
            .get(&role.input_role_identity)
            .ok_or(StrategyInputJoinedCutUnavailable::IncompleteCensus)?
            .iter()
            .copied()
            .filter(|frame| frame.trigger().lifecycle().logical_time() <= trigger_logical_time)
            .collect::<Vec<_>>();
        let latest_time = eligible
            .iter()
            .map(|frame| frame.trigger().lifecycle().logical_time())
            .max()
            .ok_or(StrategyInputJoinedCutUnavailable::IncompleteCensus)?;
        let latest = eligible
            .into_iter()
            .filter(|frame| frame.trigger().lifecycle().logical_time() == latest_time)
            .collect::<Vec<_>>();
        let [selected] = latest.as_slice() else {
            return Err(StrategyInputJoinedCutUnavailable::AmbiguousLatest);
        };

        if trigger_logical_time.saturating_sub(latest_time) > claim.max_staleness_ns {
            return Err(StrategyInputJoinedCutUnavailable::StaleComponent);
        }

        if role.semantic_id == claim.trigger_input_id {
            if latest_time != trigger_logical_time {
                return Err(StrategyInputJoinedCutUnavailable::MissingTrigger);
            }
            trigger_digest = Some(selected.trigger().digest());
        }
        components.push(StrategyInputJoinedCutComponentV1 {
            role_semantic_id: role.semantic_id.clone(),
            frame_digest: component_frame_digest(selected),
            staleness_ns: trigger_logical_time - latest_time,
            frame: (*selected).clone(),
        });
    }
    let market_semantics_identity =
        market_semantics.ok_or(StrategyInputJoinedCutUnavailable::IncompleteCensus)?;
    let mut receipt = StrategyInputJoinedCutReceiptV1 {
        strategy_design_identity: claim.strategy_design_identity,
        join_identity: claim.join_identity,
        alignment_semantic_id: claim.alignment_semantic_id.clone(),
        trigger_input_id: claim.trigger_input_id.clone(),
        trigger_digest: trigger_digest.ok_or(StrategyInputJoinedCutUnavailable::MissingTrigger)?,
        max_staleness_ns: claim.max_staleness_ns,
        selection_basis_digest: census.digest,
        frontier_digest: census.frontier_digest,
        market_semantics_identity,
        components: components.into_boxed_slice(),
        digest: BindingDigest::from_untrusted_bytes([0; 32]),
    };
    receipt.digest = receipt_digest(&receipt);
    Ok(receipt)
}

fn validate_claim(
    claim: &UntrustedStrategyInputJoinClaimV1,
) -> Result<(), StrategyInputJoinedCutUnavailable> {
    let role_names = claim
        .roles
        .iter()
        .map(|role| role.semantic_id.as_str())
        .collect::<BTreeSet<_>>();
    let role_identities = claim
        .roles
        .iter()
        .map(|role| role.input_role_identity)
        .collect::<BTreeSet<_>>();
    let inputs = claim
        .roles
        .iter()
        .map(|role| role.semantic_id.clone())
        .collect::<Vec<_>>();

    if claim.join_semantic_id.is_empty()
        || claim.alignment_semantic_id.is_empty()
        || claim.trigger_input_id.is_empty()
        || claim.max_staleness_ns == 0
        || claim.roles.len() < 2
        || role_names.len() != claim.roles.len()
        || role_identities.len() != claim.roles.len()
        || !role_names.contains(claim.trigger_input_id.as_str())
        || derive_strategy_input_join_identity_v2(
            &claim.join_semantic_id,
            &inputs,
            &claim.alignment_semantic_id,
            &claim.trigger_input_id,
            claim.max_staleness_ns,
        ) != claim.join_identity
    {
        return Err(StrategyInputJoinedCutUnavailable::InvalidClaim);
    }
    Ok(())
}

fn receipt_digest(receipt: &StrategyInputJoinedCutReceiptV1) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(receipt.strategy_design_identity.as_bytes());
    bytes.extend(receipt.join_identity.as_bytes());
    bytes.extend(receipt.alignment_semantic_id.as_bytes());
    bytes.push(0);
    bytes.extend(receipt.trigger_input_id.as_bytes());
    bytes.push(0);
    bytes.extend(receipt.trigger_digest.as_bytes());
    bytes.extend(receipt.max_staleness_ns.to_le_bytes());
    bytes.extend(receipt.selection_basis_digest.as_bytes());
    bytes.extend(receipt.frontier_digest.as_bytes());
    bytes.extend(receipt.market_semantics_identity.as_bytes());
    for component in &receipt.components {
        bytes.extend(component.role_semantic_id.as_bytes());
        bytes.push(0);
        bytes.extend(component.frame_digest.as_bytes());
        bytes.extend(component.staleness_ns.to_le_bytes());
    }
    digest(RECEIPT_DOMAIN, &bytes)
}

fn component_frame_digest(frame: &StrategyInputEventFrameReceipt) -> BindingDigest {
    let mut bytes = Vec::new();
    bytes.extend(frame.trigger().digest().as_bytes());
    bytes.extend(frame.values()[0].digest().as_bytes());
    digest(
        b"vibe.market-data.strategy-input-join.component.v1\0",
        &bytes,
    )
}

fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}
