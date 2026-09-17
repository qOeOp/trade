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
use sqlx::PgPool;
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    bounded_feature_program_derivation_v1::{
        BoundedFeatureProgramAssemblyErrorV1, BoundedFeatureProgramMeaningV1,
        assemble_declared_bounded_feature_program_v1,
    },
    bounded_feature_program_v1::BoundedFeatureProgramProposalV1,
    rd_bounded_feature_program_v1::{
        FrozenResearchBoundedFeatureProgramV1, ResearchBoundedFeatureProgramFreezeErrorV1,
        commit_research_bounded_feature_program_in_transaction_v1,
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

/// One declared Design and program meaning, from which the Owner assembles and freezes.
///
/// A proposer sends meaning, never identities or receipts. Everything the proposal needs beyond
/// meaning is derived from this Design, the pinned catalog and the Owner's own binding custody.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchBoundedFeatureProgramDeclarationV1 {
    /// Research request or successor Research intent locator that owns this freeze.
    pub research_request_locator: String,
    /// Declared canonical Design. The Owner admits it only against current Research custody.
    pub design: StrategyDesignV2,
    /// Declared program meaning: the typed graph and what only a proposer can decide.
    pub meaning: BoundedFeatureProgramMeaningV1,
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
    /// Declared meaning does not fit the Design, or Owner binding custody did not answer.
    #[error("declared meaning does not assemble against Owner custody: {0}")]
    Assembly(String),
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

    /// Assembles declared meaning against live Owner custody and freezes the result.
    ///
    /// Assembly and the freeze share one transaction. The custody readback assembly performs takes
    /// row locks at a cut, and freezing against a different cut would seal a program whose binding
    /// receipts were never proven at the moment it was sealed.
    ///
    /// A proposer sends meaning only. The identities, digests, catalog identity, SDK digest,
    /// manifest-fixed bounds and static binding receipts are all derived here, so a proposer cannot
    /// declare one and cannot disagree with the Design it names.
    ///
    /// # Errors
    ///
    /// Returns the assembly reason when declared meaning does not fit the Design or Owner binding
    /// custody does not answer, and the freeze reason otherwise.
    pub async fn declare(
        &self,
        declaration: ResearchBoundedFeatureProgramDeclarationV1,
    ) -> Result<
        ResearchBoundedFeatureProgramFreezeReceiptV1,
        ResearchBoundedFeatureProgramOwnerErrorV1,
    > {
        let catalog = PrimitiveCatalogV1::verify()
            .map_err(|_| ResearchBoundedFeatureProgramOwnerErrorV1::Catalog)?;
        let read_cut_epoch_ms = (self.clock)();
        let committed_at_epoch_ms = (self.clock)().max(read_cut_epoch_ms);
        let mut transaction = self.pool.begin().await?;

        let assembled = Box::pin(assemble_declared_bounded_feature_program_v1(
            &mut transaction,
            &declaration.design,
            catalog,
            &declaration.meaning,
        ))
        .await;
        let proposal = match assembled {
            Ok(proposal) => proposal,
            Err(e) => {
                transaction.rollback().await?;
                return Err(assembly_error(&e));
            }
        };

        let committed = Box::pin(commit_research_bounded_feature_program_in_transaction_v1(
            &mut transaction,
            &declaration.research_request_locator,
            read_cut_epoch_ms,
            committed_at_epoch_ms,
            &declaration.design,
            proposal,
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
}

/// Carries why assembly refused, without widening what the refusal grants.
///
/// The reasons name a shape mismatch between declared meaning and a Design the caller already
/// holds, or say that Owner custody did not answer. Neither discloses custody, and discarding them
/// would leave a caller unable to tell a malformed declaration from an unavailable Owner.
fn assembly_error(
    error: &BoundedFeatureProgramAssemblyErrorV1,
) -> ResearchBoundedFeatureProgramOwnerErrorV1 {
    ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(error.to_string())
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
    let mut text = String::with_capacity(71);
    text.push_str("sha256:");
    for byte in digest.as_bytes() {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}
