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
use vibe_data::owner::strategy_design_role_intent_v1::StrategyDesignRoleIntentV1;
use vibe_indicators_kernel::PrimitiveCatalogV1;

use crate::{
    develop_composer_v2::CurrentResearchDevelopCustodyV2,
    rd_design_role_intent_v1::derive_design_role_intent_v1,
};

use crate::{
    bounded_feature_program_derivation_v1::{
        BoundedFeatureProgramAssemblyErrorV1, BoundedFeatureProgramMeaningV1,
        assemble_declared_bounded_feature_program_v1,
    },
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
    /// The declared Design does not match currently accepted Research custody.
    #[error("the declared Design does not match current accepted Research custody")]
    ResearchCustody,
    /// The declared Design is not canonicalizable.
    #[error("the declared Strategy Design is not canonicalizable")]
    Design,
    /// The declared program is outside the admitted Bounded Feature Program meaning.
    #[error("the declared Bounded Feature Program is unsupported")]
    Program,
    /// The declared first-party SDK source digest is not the pinned first-party SDK.
    #[error("the declared first-party SDK source digest is not the pinned first-party SDK")]
    SdkSource,
    /// Declared meaning does not fit the Design, or Owner binding custody did not answer.
    ///
    /// The payload is the typed reason rather than its rendering, because the two reasons ask a
    /// caller for opposite things: one to change the meaning it declared, one to wait for an Owner
    /// gap it cannot affect. Rendering them to a string here left every consumer holding a single
    /// outcome, which is the condition the `assembly_error` documentation says must not arise.
    #[error("declared meaning does not assemble against Owner custody: {0}")]
    Assembly(#[from] BoundedFeatureProgramAssemblyErrorV1),
    /// No published primitive catalog verifies, so nothing can be assembled against any meaning.
    ///
    /// This is neither of the assembly reasons: it precedes them and is not about this caller's
    /// declaration at all. It shared their variant while that variant carried a string.
    #[error("no published primitive catalog verifies")]
    CatalogUnavailable,
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
        Freeze::SdkSource => Owner::SdkSource,
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
        // The catalog is no longer resolved here: a freeze rebuilds it from the catalog version the
        // program's own bytes declare, so a check against the pinned one here could only disagree
        // with the version actually in force for this program.
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

    /// Publishes what this Owner knows about a Design, so Market Data can authenticate it.
    ///
    /// This is the one statement about a Design that does not depend on a program, which is what
    /// makes a first cycle possible: a program's identity folds in the binding receipts Market Data
    /// issues, so nothing carrying a program can precede them.
    ///
    /// Publication is write-once per Design. Republishing the same Design returns the stored
    /// intent, and a Design whose roles or Research custody differ from the stored one is a
    /// conflict rather than an overwrite.
    ///
    /// # Errors
    ///
    /// Returns [`ResearchBoundedFeatureProgramOwnerErrorV1::ResearchCustody`] when the locator has
    /// no currently accepted Research custody, [`ResearchBoundedFeatureProgramOwnerErrorV1::Design`]
    /// when the Design does not belong to it or does not prepare,
    /// [`ResearchBoundedFeatureProgramOwnerErrorV1::Conflict`] when this Design was already
    /// published with different meaning, and
    /// [`ResearchBoundedFeatureProgramOwnerErrorV1::Unavailable`] when the store does not answer.
    pub async fn publish_design_role_intent(
        &self,
        research_request_locator: &str,
        design: &StrategyDesignV2,
    ) -> Result<StrategyDesignRoleIntentV1, ResearchBoundedFeatureProgramOwnerErrorV1> {
        let read_cut_epoch_ms = (self.clock)();
        let mut transaction = self.pool.begin().await?;
        let verified = match Box::pin(
            crate::rd_owner_postgres_custody::admit_research_v2_custody_read_only_in_transaction(
                &mut transaction,
                research_request_locator,
            ),
        )
        .await
        {
            Ok(Some(verified)) => verified,
            Ok(None) => {
                transaction.rollback().await?;
                return Err(ResearchBoundedFeatureProgramOwnerErrorV1::ResearchCustody);
            }
            Err(_) => {
                transaction.rollback().await?;
                return Err(ResearchBoundedFeatureProgramOwnerErrorV1::Unavailable);
            }
        };

        let custody = match CurrentResearchDevelopCustodyV2::from_verified(
            &verified,
            research_request_locator,
            read_cut_epoch_ms,
        ) {
            Ok(custody) => custody,
            Err(_) => {
                transaction.rollback().await?;
                return Err(ResearchBoundedFeatureProgramOwnerErrorV1::ResearchCustody);
            }
        };

        let intent = match derive_design_role_intent_v1(&custody, design) {
            Ok(intent) => intent,
            Err(_) => {
                transaction.rollback().await?;
                return Err(ResearchBoundedFeatureProgramOwnerErrorV1::Design);
            }
        };

        // Write-once by primary key, then read back: a second publication of the same Design must
        // return what is stored rather than what was offered, so a changed meaning cannot pass by
        // being written after the row it disagrees with.
        sqlx::query(
            "INSERT INTO rd_design_role_intents_v1(
                design_identity, research_request_identity, intent_identity,
                research_custody_digest, design_digest, intent_digest, canonical_bytes,
                published_at_epoch_ms
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (design_identity) DO NOTHING",
        )
        .bind(intent.design_identity().as_bytes().as_slice())
        .bind(intent.research_request_identity().as_bytes().as_slice())
        .bind(intent.intent_identity().as_bytes().as_slice())
        .bind(intent.research_custody_digest().as_bytes().as_slice())
        .bind(intent.design_digest().as_bytes().as_slice())
        .bind(intent.intent_digest().as_bytes().as_slice())
        .bind(intent.canonical_bytes())
        .bind(i64::try_from(read_cut_epoch_ms).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await?;

        let stored: (Vec<u8>, Vec<u8>) = sqlx::query_as(
            "SELECT canonical_bytes, intent_digest FROM rd_design_role_intents_v1
             WHERE design_identity=$1",
        )
        .bind(intent.design_identity().as_bytes().as_slice())
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;

        let stored_digest = <[u8; 32]>::try_from(stored.1.as_slice())
            .map(BindingDigest::from_untrusted_bytes)
            .map_err(|_| ResearchBoundedFeatureProgramOwnerErrorV1::Unavailable)?;
        let recovered =
            StrategyDesignRoleIntentV1::from_durable_publication(&stored.0, stored_digest)
                .map_err(|_| ResearchBoundedFeatureProgramOwnerErrorV1::Unavailable)?;

        if recovered != intent {
            return Err(ResearchBoundedFeatureProgramOwnerErrorV1::Conflict);
        }

        Ok(recovered)
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
        // Assembling a new program picks a catalog and the proposal records which one; rebuilding
        // a stored program instead uses the version its own bytes declare, which is why `freeze`
        // and `lower` resolve none.
        let catalog = PrimitiveCatalogV1::verify()
            .map_err(|_| ResearchBoundedFeatureProgramOwnerErrorV1::CatalogUnavailable)?;
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
        // The readback rebuilds the freeze under the catalog version its own stored bytes declare,
        // so resolving a catalog here could only disagree with the one actually in force.
        let read_cut_epoch_ms = (self.clock)();
        let mut transaction = self.pool.begin().await?;
        let frozen = Box::pin(read_research_bounded_feature_program_in_transaction_v1(
            &mut transaction,
            research_request_locator,
            read_cut_epoch_ms,
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

/// Carries why assembly refused, without widening what the refusal grants.
///
/// The reasons name a shape mismatch between declared meaning and a Design the caller already
/// holds, or say that Owner custody did not answer. Neither discloses custody, and discarding them
/// would leave a caller unable to tell a malformed declaration from an unavailable Owner.
fn assembly_error(
    error: &BoundedFeatureProgramAssemblyErrorV1,
) -> ResearchBoundedFeatureProgramOwnerErrorV1 {
    ResearchBoundedFeatureProgramOwnerErrorV1::Assembly(error.clone())
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
