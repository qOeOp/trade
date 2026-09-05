//! R&D-owned PostgreSQL composition for canonical Research custody and durable Composer V2.
//!
//! The public Composer request remains untrusted. `RUN` uses its Research reference only as a
//! lookup key, then locks and canonically rereads the complete Research custody. `RESOLVE` accepts
//! only the Composer request identity: it derives the immutable Research/Intent identities from
//! durable Composer custody and uniquely matches them against the complete canonical Research
//! census. The same R&D Owner transaction is passed to the fact-Owner binding resolver and remains
//! open until the Composer decision completes.

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use vibe_common::clock::Clock;
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    develop_composer_operation_v2::{
        DevelopComposerA0BuildPortV2, DevelopComposerDurableEvidenceLocatorV2,
        DevelopComposerFinalEvidencePortV2, DevelopComposerLockedEvidenceV2,
        DevelopComposerOperationResponseV2, DevelopComposerRunRequestV2,
    },
    develop_composer_postgres_v2::PostgresDevelopComposerStoreV2,
    develop_composer_v2::{CurrentResearchDevelopCustodyV2, DevelopComposerTerminalV2},
    product_edge::FrozenResearchGoalIntent,
    rd_owner_postgres_custody::{
        ResearchCustodyLookupV1, VerifiedResearchCustodyV1,
        admit_all_research_custodies_in_transaction, admit_research_custody_in_transaction,
    },
    strategy_plan_v2::VerifiedStrategyInputBindingsV2,
};

/// Canonical fact-Owner binding seam selected by the A2 assembly at compile time.
///
/// Both methods receive the already-open R&D Owner transaction. Implementations may call only
/// Owner-owned sealed read functions on that transaction; they must not open another pool,
/// connection, or transaction and cannot trust a caller-projected binding receipt.
#[async_trait::async_trait]
pub(crate) trait SourceResearchComposerBindingOwnerV2: Send + Sync {
    async fn lock_for_run(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2>;

    async fn lock_for_resolve(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        read_cut_epoch_ms: u64,
    ) -> Result<VerifiedStrategyInputBindingsV2, DevelopComposerTerminalV2>;
}

/// One fixed A2 composition root. The binding Owner is injected by trusted assembly code, not by
/// the request or a runtime provider selector.
pub(crate) struct PostgresSourceResearchComposerV2<B, C> {
    store: PostgresDevelopComposerStoreV2,
    binding_owner: B,
    clock: C,
}

impl<B, C> PostgresSourceResearchComposerV2<B, C>
where
    B: SourceResearchComposerBindingOwnerV2,
    C: Clock,
{
    pub(crate) async fn connect(
        rd_owner_database_url: &str,
        rd_fact_writer_database_url: &str,
        binding_owner: B,
        clock: C,
    ) -> Result<Self, sqlx::Error> {
        Ok(Self {
            store: PostgresDevelopComposerStoreV2::connect(
                rd_owner_database_url,
                rd_fact_writer_database_url,
            )
            .await?,
            binding_owner,
            clock,
        })
    }

    /// Runs the existing Composer operation from canonical, transaction-locked Owner evidence.
    pub(crate) async fn run(
        &self,
        builder: &mut impl DevelopComposerA0BuildPortV2,
        request: &DevelopComposerRunRequestV2,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let read_cut_epoch_ms = self.clock.timestamp_ms();
        let mut owner_transaction = self.store.begin_read_transaction().await?;
        let locked = self
            .lock_run_evidence(&mut owner_transaction, request, read_cut_epoch_ms)
            .await;
        let evidence = LockedOwnerEvidenceV2 { locked };
        let response = self
            .store
            .run(builder, &evidence, request, read_cut_epoch_ms)
            .await;
        owner_transaction.rollback().await?;
        response
    }

    /// Resolves an existing operation by request identity only and never starts first mutation.
    pub(crate) async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<DevelopComposerOperationResponseV2, sqlx::Error> {
        let read_cut_epoch_ms = self.clock.timestamp_ms();
        let Some(locator) = self
            .store
            .durable_evidence_locator(request_identity)
            .await?
        else {
            return self.store.resolve(request_identity).await;
        };

        let mut owner_transaction = self.store.begin_read_transaction().await?;
        let locked = self
            .lock_resolve_evidence(&mut owner_transaction, &locator, read_cut_epoch_ms)
            .await;
        let evidence = LockedOwnerEvidenceV2 { locked };
        let response = self
            .store
            .resolve_with_evidence(request_identity, &evidence, read_cut_epoch_ms)
            .await;
        owner_transaction.rollback().await?;
        response
    }

    async fn lock_run_evidence(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        request: &DevelopComposerRunRequestV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let custody = admit_research_custody_in_transaction(
            transaction,
            ResearchCustodyLookupV1::RequestV2(&request.research_custody_reference),
        )
        .await
        .map_err(|_| research_unavailable())?
        .ok_or_else(research_unavailable)?;
        let research = CurrentResearchDevelopCustodyV2::from_verified(
            &custody,
            &request.research_custody_reference,
            read_cut_epoch_ms,
        )?;
        let bindings = self
            .binding_owner
            .lock_for_run(transaction, request, read_cut_epoch_ms)
            .await?;
        Ok(DevelopComposerLockedEvidenceV2 { research, bindings })
    }

    async fn lock_resolve_evidence(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let custodies = admit_all_research_custodies_in_transaction(transaction)
            .await
            .map_err(|_| research_unavailable())?;
        let mut matches = Vec::new();
        for custody in custodies {
            if durable_research_identities(&custody).is_some_and(|(request, intent)| {
                request == locator.research_request_identity && intent == locator.intent_identity
            }) {
                matches.push(custody);
            }
        }
        let [custody] = matches.try_into().map_err(|_| {
            DevelopComposerTerminalV2::unavailable(
                "research_custody",
                "durable Composer identity does not uniquely match current canonical Research custody",
            )
        })?;
        let request_locator = custody.receipt().request_identity.clone();
        let research = CurrentResearchDevelopCustodyV2::from_verified(
            &custody,
            &request_locator,
            read_cut_epoch_ms,
        )?;
        let bindings = self
            .binding_owner
            .lock_for_resolve(transaction, locator, read_cut_epoch_ms)
            .await?;
        Ok(DevelopComposerLockedEvidenceV2 { research, bindings })
    }
}

#[derive(Clone)]
struct LockedOwnerEvidenceV2 {
    locked: Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2>,
}

impl DevelopComposerFinalEvidencePortV2 for LockedOwnerEvidenceV2 {
    fn lock_and_reread(
        &self,
        request: &DevelopComposerRunRequestV2,
        _design_identity: BindingDigest,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let locked = self.locked.clone()?;
        if request.research_custody_reference != locked.research.request_locator() {
            return Err(research_unavailable());
        }
        Ok(locked)
    }

    fn lock_and_reread_durable(
        &self,
        locator: &DevelopComposerDurableEvidenceLocatorV2,
        _read_cut_epoch_ms: u64,
    ) -> Result<DevelopComposerLockedEvidenceV2, DevelopComposerTerminalV2> {
        let locked = self.locked.clone()?;
        if locator.research_request_identity != locked.research.research_request_identity()
            || locator.intent_identity != locked.research.intent_identity()
        {
            return Err(research_unavailable());
        }
        Ok(locked)
    }
}

/// Derives only the immutable census keys. Positive custody still comes exclusively from
/// `CurrentResearchDevelopCustodyV2::from_verified` after the census is uniquely matched.
fn durable_research_identities(
    custody: &VerifiedResearchCustodyV1,
) -> Option<(BindingDigest, BindingDigest)> {
    let request_identity = domain_digest(
        b"rd.develop.request-identity.v2\0",
        custody.receipt().request_identity.as_bytes(),
    );
    let FrozenResearchGoalIntent::V2(intent) = custody.intent()? else {
        return None;
    };
    let intent_identity = parse_digest_suffix(&intent.intent_identity, "rd-research-intent-v2-")?;
    Some((request_identity, intent_identity))
}

fn parse_digest_suffix(value: &str, prefix: &str) -> Option<BindingDigest> {
    let hex = value.strip_prefix(prefix)?;
    if hex.len() != 64 {
        return None;
    }
    let mut bytes = [0_u8; 32];
    for (index, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        bytes[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
    }
    Some(BindingDigest::from_untrusted_bytes(bytes))
}

const fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn domain_digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn research_unavailable() -> DevelopComposerTerminalV2 {
    DevelopComposerTerminalV2::unavailable(
        "research_custody",
        "current canonical Research Owner custody is unavailable",
    )
}
