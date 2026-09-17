//! Durable PostgreSQL Owner composition root for the R&D joint Bounded Feature Program freeze.
//!
//! The crate-private `rd_bounded_feature_program_v1` joint freeze can issue a positive frozen value
//! only while it holds the exact transaction that supplied verified Research V2 custody, so it cannot
//! own a pool, a clock, or a caller boundary. This module is that missing root: it opens one R&D Owner transaction, commits
//! the joint freeze inside it, and returns a projection rather than the frozen value.
//!
//! The Owner invents no Research meaning. The caller declares the `StrategyDesignV2` and the
//! `BoundedFeatureProgramProposalV1`; the Owner admits them only when they match the currently
//! accepted Research custody, and it rejects a second, different freeze for the same Research
//! identity as a changed-meaning conflict.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    bounded_feature_program_lowerer_v1::{
        BoundedFeatureLoweringErrorV1, prepare_frozen_bounded_feature_source_inputs_v1,
    },
    bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    rd_bounded_feature_program_v1::{
        FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1,
        commit_research_bounded_feature_program_in_transaction_v1,
        read_research_bounded_feature_program_in_transaction_v1,
    },
    strategy_design_v2::StrategyDesignV2,
};

/// One declared joint-freeze proposal for exactly one Research request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchBoundedFeatureProgramFreezeRequestV1 {
    /// Research request or successor Research intent locator that owns this freeze.
    pub research_request_locator: String,
    /// Declared canonical Design. The Owner admits it only against current Research custody.
    pub design: StrategyDesignV2,
    /// Declared canonical Bounded Feature Program. The Owner verifies it against the pinned catalog.
    pub proposal: BoundedFeatureProgramProposalV1,
}

/// Positive freeze projection.
///
/// Digests only: the frozen value itself stays crate-private so that no caller can rebuild Owner
/// custody from a response body.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ResearchBoundedFeatureProgramFreezeReceiptV1 {
    /// Joint-freeze schema version.
    pub schema_version: u16,
    /// Research request identity the freeze is bound to.
    pub research_request_identity: String,
    /// Research Intent identity.
    pub intent_identity: String,
    /// Research Intent digest.
    pub intent_digest: String,
    /// Accepted Research custody digest at the admitted read cut.
    pub research_custody_digest: String,
    /// Canonical Design identity.
    pub design_identity: String,
    /// Canonical Design digest.
    pub design_digest: String,
    /// Canonical bounded-plugin manifest digest.
    pub plugin_manifest_digest: String,
    /// Canonical Bounded Feature Program digest.
    pub program_digest: String,
    /// Domain-separated digest covering the whole joint freeze.
    pub joint_freeze_digest: String,
    /// Owner commit time.
    pub committed_at_epoch_ms: u64,
}

/// Why a declared joint freeze was not admitted.
#[derive(Debug, Error)]
pub enum ResearchBoundedFeatureProgramOwnerErrorV1 {
    /// R&D Owner storage did not answer.
    #[error("R&D Owner storage is unavailable")]
    Storage(#[from] sqlx::Error),
    /// The pinned primitive catalog did not verify, so no program meaning is admissible.
    #[error("the pinned primitive catalog is unavailable")]
    Catalog,
    /// The declared Design does not match currently accepted Research custody.
    #[error("the declared Design does not match current accepted Research custody")]
    ResearchCustody,
    /// The declared Design is not canonicalizable.
    #[error("the declared Strategy Design is not canonicalizable")]
    Design,
    /// The declared program is outside the admitted Bounded Feature Program meaning.
    #[error("the declared Bounded Feature Program is unsupported")]
    Program,
    /// R&D Owner joint-freeze custody is unavailable.
    #[error("R&D Owner joint-freeze custody is unavailable")]
    Unavailable,
    /// A different joint freeze already occupies this Research identity.
    #[error("a different joint freeze already occupies this Research identity")]
    Conflict,
}

const fn owner_error(
    error: &ResearchBoundedFeatureProgramFreezeErrorV1,
) -> ResearchBoundedFeatureProgramOwnerErrorV1 {
    use ResearchBoundedFeatureProgramFreezeErrorV1 as Freeze;
    use ResearchBoundedFeatureProgramOwnerErrorV1 as Owner;

    match error {
        Freeze::ResearchCustody => Owner::ResearchCustody,
        Freeze::Design => Owner::Design,
        Freeze::Program(_) => Owner::Program,
        Freeze::Unavailable => Owner::Unavailable,
        Freeze::Conflict => Owner::Conflict,
    }
}

/// One lowered first-party source file.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ResearchBoundedFeatureSourceFileV1 {
    /// Path inside the generated crate.
    pub path: String,
    /// Exact generated bytes. The lowerer emits only first-party source.
    pub source: String,
    /// Domain-separated digest of those bytes.
    pub digest: String,
}

/// Deterministic lowering of one frozen program into canonical ABI3 source.
///
/// This is source, not an executable: it carries no build receipt, no Wasm, no Artifact and no
/// qualification meaning. It proves only that the frozen program lowers, with the pinned catalog
/// and first-party SDK, to exactly these bytes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ResearchBoundedFeatureProgramLoweringV1 {
    /// Research request or successor intent locator the frozen program is bound to.
    pub research_request_locator: String,
    /// Domain-separated digest covering the whole joint freeze.
    pub joint_freeze_digest: String,
    /// Canonical Bounded Feature Program digest.
    pub program_digest: String,
    /// Bounded plugin the program builds.
    pub plugin_semantic_id: String,
    /// Canonical bounded-plugin manifest digest.
    pub plugin_manifest_digest: String,
    /// Pinned primitive-catalog digest the lowering referenced.
    pub catalog_digest: String,
    /// Complete primitive-kernel source digest.
    pub complete_kernel_source_digest: String,
    /// Guest primitive-kernel source digest.
    pub guest_kernel_source_digest: String,
    /// First-party SDK source digest.
    pub sdk_source_digest: String,
    /// Lowerer source digest.
    pub lowerer_source_digest: String,
    /// Digest covering the complete generated source set.
    pub source_set_digest: String,
    /// The generated source itself, in canonical order.
    pub source_files: Vec<ResearchBoundedFeatureSourceFileV1>,
}

/// Why a frozen program could not be read back or lowered.
#[derive(Debug, Error)]
pub enum ResearchBoundedFeatureProgramLoweringErrorV1 {
    /// R&D Owner storage did not answer.
    #[error("R&D Owner storage is unavailable")]
    Storage(#[from] sqlx::Error),
    /// No joint freeze exists for this Research identity, or its stored bytes no longer verify.
    #[error("no verifiable joint freeze is readable for this Research identity")]
    Unavailable,
    /// The frozen pair does not lower with the pinned catalog and first-party SDK.
    #[error("the frozen program does not lower: {0}")]
    Lowering(String),
}

/// PostgreSQL capability narrowed to the R&D joint Bounded Feature Program freeze.
///
/// This type owns neither a sandbox, a build port, a Market Data coordinate source, nor any other
/// R&D mutation. Its sole effect is one joint freeze row plus its outbox event, both written inside
/// the transaction that supplied the custody they are bound to.
#[derive(Clone)]
pub struct PostgresResearchBoundedFeatureProgramOwnerV1 {
    pool: PgPool,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl PostgresResearchBoundedFeatureProgramOwnerV1 {
    /// Connects the Owner to the R&D Owner database.
    ///
    /// # Errors
    ///
    /// Returns the connection failure when the R&D Owner database is unreachable.
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        Ok(Self::new(PgPool::connect(database_url).await?))
    }

    /// Binds the Owner to one R&D pool and the live wall clock.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            clock: Arc::new(|| {
                use vibe_common::{clock::Clock, live::clock::LiveClock};
                LiveClock::default().timestamp_ms()
            }),
        }
    }

    /// Binds the Owner to one R&D pool and an explicit clock.
    #[must_use]
    pub fn with_clock(pool: PgPool, clock: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self { pool, clock }
    }

    /// Admits and freezes one declared Design and Bounded Feature Program.
    ///
    /// Replaying the identical request returns the identical receipt. Replaying a different one for
    /// the same Research identity is a changed-meaning [`ResearchBoundedFeatureProgramOwnerErrorV1::Conflict`].
    ///
    /// # Errors
    ///
    /// Returns the rejection reason when storage, the pinned catalog, Research custody, the declared
    /// Design, or the declared program does not admit the freeze.
    pub async fn freeze(
        &self,
        request: ResearchBoundedFeatureProgramFreezeRequestV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    > {
        let catalog = PrimitiveCatalogV1::verify()
            .map_err(|_| ResearchBoundedFeatureProgramOwnerErrorV1::Catalog)?;
        let read_cut_epoch_ms = (self.clock)();
        let committed_at_epoch_ms = (self.clock)().max(read_cut_epoch_ms);
        let mut transaction = self.pool.begin().await?;
        let committed = Box::pin(commit_research_bounded_feature_program_in_transaction_v1(
            &mut transaction,
            &request.research_request_locator,
            read_cut_epoch_ms,
            committed_at_epoch_ms,
            &request.design,
            request.proposal,
            catalog,
        ))
        .await;

        match committed {
            Ok(frozen) => {
                transaction.commit().await?;
                Ok(receipt(&frozen, committed_at_epoch_ms))
            }
            Err(e) => {
                transaction.rollback().await?;
                Err(owner_error(&e))
            }
        }
    }

    /// Lowers the frozen program this Research identity already owns.
    ///
    /// Read-only. The lowerer re-parses and re-canonicalizes the stored bytes rather than trusting
    /// a stored digest, so an identical call returns identical source for as long as the pinned
    /// catalog, first-party SDK and lowerer are unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`ResearchBoundedFeatureProgramLoweringErrorV1::Unavailable`] when no verifiable
    /// freeze is readable, and `Lowering` when the frozen pair does not lower.
    pub async fn lower(
        &self,
        research_request_locator: &str,
    ) -> Result<ResearchBoundedFeatureProgramLoweringV1, ResearchBoundedFeatureProgramLoweringErrorV1>
    {
        let catalog = PrimitiveCatalogV1::verify()
            .map_err(|_| ResearchBoundedFeatureProgramLoweringErrorV1::Unavailable)?;
        let read_cut_epoch_ms = (self.clock)();
        let mut transaction = self.pool.begin().await?;
        let frozen = Box::pin(read_research_bounded_feature_program_in_transaction_v1(
            &mut transaction,
            research_request_locator,
            read_cut_epoch_ms,
            catalog,
        ))
        .await;
        transaction.rollback().await?;
        let frozen =
            frozen.map_err(|_| ResearchBoundedFeatureProgramLoweringErrorV1::Unavailable)?;
        let lowered = prepare_frozen_bounded_feature_source_inputs_v1(&frozen).map_err(
            |e: BoundedFeatureLoweringErrorV1| {
                ResearchBoundedFeatureProgramLoweringErrorV1::Lowering(e.to_string())
            },
        )?;

        Ok(ResearchBoundedFeatureProgramLoweringV1 {
            research_request_locator: research_request_locator.to_owned(),
            joint_freeze_digest: digest_text(lowered.joint_freeze_digest()),
            program_digest: digest_text(lowered.program_digest()),
            plugin_semantic_id: lowered.plugin_semantic_id().to_owned(),
            plugin_manifest_digest: digest_text(lowered.manifest_digest()),
            catalog_digest: digest_text(lowered.catalog_digest()),
            complete_kernel_source_digest: digest_text(lowered.complete_kernel_source_digest()),
            guest_kernel_source_digest: digest_text(lowered.guest_kernel_source_digest()),
            sdk_source_digest: digest_text(lowered.sdk_source_digest()),
            lowerer_source_digest: digest_text(lowered.lowerer_source_digest()),
            source_set_digest: digest_text(lowered.source_set_digest()),
            source_files: lowered
                .source_files()
                .map(|(path, bytes)| ResearchBoundedFeatureSourceFileV1 {
                    path: path.to_owned(),
                    source: String::from_utf8_lossy(bytes).into_owned(),
                    digest: format!("sha256:{}", hex_lower(&Sha256::digest(bytes))),
                })
                .collect(),
        })
    }
}

fn receipt(
    frozen: &FrozenResearchBoundedFeatureProgramV1,
    committed_at_epoch_ms: u64,
) -> ResearchBoundedFeatureProgramFreezeReceiptV1 {
    ResearchBoundedFeatureProgramFreezeReceiptV1 {
        schema_version: frozen.schema_version(),
        research_request_identity: digest_text(frozen.research_request_identity()),
        intent_identity: digest_text(frozen.intent_identity()),
        intent_digest: digest_text(frozen.intent_digest()),
        research_custody_digest: digest_text(frozen.research_custody_digest()),
        design_identity: digest_text(frozen.design_identity()),
        design_digest: digest_text(frozen.design_digest()),
        plugin_manifest_digest: digest_text(frozen.plugin_manifest_digest()),
        program_digest: digest_text(frozen.program_digest()),
        joint_freeze_digest: digest_text(frozen.joint_freeze_digest()),
        committed_at_epoch_ms,
    }
}

fn digest_text(digest: BindingDigest) -> String {
    format!("sha256:{}", hex_lower(digest.as_bytes()))
}

fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}
