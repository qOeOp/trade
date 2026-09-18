//! Durable custody for one live channel's head, and the channel that seals against it.
//!
//! The head is the whole persistence surface of a live channel, and it is deliberately tiny: a
//! channel identity, the last sequence the Owner issued, and the last fact it issued under that
//! sequence. Live facts themselves are not stored. They are answers about the present that a
//! Strategy Instance consumes as they happen; persisting them would make this Owner a second
//! historical authority beside PIT, which the contract gives to PIT alone.

use sqlx::{Postgres, Row, Transaction};

use super::MarketDataOwnerPostgres;
use crate::owner::{
    live_market_fact_v1::{
        LiveMarketBindingV1, LiveMarketFactV1, LiveMarketSubscriptionV1, seal_live_market_fact_v1,
    },
    live_market_stream_v1::{
        LiveMarketChannelErrorV1, LiveMarketChannelHeadV1, LiveMarketChannelRequestV1,
        derive_channel_identity_v1,
    },
    source_binding::BindingDigest,
};

pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.live_market_channel_heads_v1(channel_identity BYTEA PRIMARY KEY CHECK(octet_length(channel_identity)=32),source_binding_identity BYTEA NOT NULL CHECK(octet_length(source_binding_identity)=32),owner_sequence BIGINT NOT NULL CHECK(owner_sequence>=0),last_fact_identity BYTEA CHECK(last_fact_identity IS NULL OR octet_length(last_fact_identity)=32),head_digest BYTEA NOT NULL CHECK(octet_length(head_digest)=32),CHECK((owner_sequence=0)=(last_fact_identity IS NULL)))",
    "REVOKE ALL ON TABLE market_data_private.live_market_channel_heads_v1 FROM PUBLIC",
];

/// Domain for the digest one stored head is sealed under.
const LIVE_MARKET_HEAD_DOMAIN: &[u8] = b"vibe.market-data.live-market-channel-head.v1\0";

/// Seals the meaning of one head row.
///
/// Without this the head is four plain columns, and a sequence rewound by an operator, a restore
/// from an older backup or a mistaken migration reads back as a perfectly ordinary head. The Owner
/// would then re-issue sequences it has already handed out, which is exactly the harm the durable
/// head exists to prevent, and no consumer could tell.
fn seal_head_digest_v1(
    channel_identity: BindingDigest,
    source_binding_identity: BindingDigest,
    owner_sequence: u64,
    last_fact_identity: Option<BindingDigest>,
) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(LIVE_MARKET_HEAD_DOMAIN);
    hasher.update(channel_identity.as_bytes());
    hasher.update(source_binding_identity.as_bytes());
    hasher.update(&owner_sequence.to_be_bytes());
    match last_fact_identity {
        None => hasher.update(&[0u8]),
        Some(identity) => {
            hasher.update(&[1u8]);
            hasher.update(identity.as_bytes())
        }
    };
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

/// Installs the live channel head custody.
///
/// # Errors
///
/// Returns `StoreUnavailable` when the store refuses a statement.
pub(super) async fn install(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), LiveMarketChannelErrorV1> {
    for statement in SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
    }
    Ok(())
}

/// Reads one channel's head, creating the empty one on first use.
///
/// The row is locked for the caller's transaction, which is what makes "read the head, seal the
/// next facts, write the head" one advance rather than three racing ones.
async fn head_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    channel_identity: BindingDigest,
    source_binding_identity: BindingDigest,
) -> Result<LiveMarketChannelHeadV1, LiveMarketChannelErrorV1> {
    let empty = seal_head_digest_v1(channel_identity, source_binding_identity, 0, None);
    sqlx::query("INSERT INTO market_data_private.live_market_channel_heads_v1(channel_identity,source_binding_identity,owner_sequence,last_fact_identity,head_digest) VALUES($1,$2,0,NULL,$3) ON CONFLICT(channel_identity) DO NOTHING")
        .bind(channel_identity.as_bytes().as_slice())
        .bind(source_binding_identity.as_bytes().as_slice())
        .bind(empty.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
    let row = sqlx::query("SELECT source_binding_identity,owner_sequence,last_fact_identity,head_digest FROM market_data_private.live_market_channel_heads_v1 WHERE channel_identity=$1 FOR UPDATE")
        .bind(channel_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?
        .ok_or(LiveMarketChannelErrorV1::StoreUnavailable)?;
    decode_head_row(&row, channel_identity, source_binding_identity)
}

/// Decodes and verifies one stored head row.
fn decode_head_row(
    row: &sqlx::postgres::PgRow,
    channel_identity: BindingDigest,
    source_binding_identity: BindingDigest,
) -> Result<LiveMarketChannelHeadV1, LiveMarketChannelErrorV1> {
    let stored_binding: Vec<u8> = row
        .try_get("source_binding_identity")
        .map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?;

    // The channel identity already covers the binding, so a row that disagrees with it is not a
    // stale head; it is custody that does not verify.
    if stored_binding.as_slice() != source_binding_identity.as_bytes() {
        return Err(LiveMarketChannelErrorV1::StoreUntrusted);
    }
    let sequence: i64 = row
        .try_get("owner_sequence")
        .map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?;
    let sequence = u64::try_from(sequence).map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?;
    let last = decode_optional_digest(row, "last_fact_identity")?;

    if (sequence == 0) != last.is_none() {
        return Err(LiveMarketChannelErrorV1::StoreUntrusted);
    }
    let stored_digest: Vec<u8> = row
        .try_get("head_digest")
        .map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?;

    if stored_digest.as_slice()
        != seal_head_digest_v1(channel_identity, source_binding_identity, sequence, last).as_bytes()
    {
        return Err(LiveMarketChannelErrorV1::StoreUntrusted);
    }
    Ok(LiveMarketChannelHeadV1::seal(
        channel_identity,
        sequence,
        last,
    ))
}

fn decode_optional_digest(
    row: &sqlx::postgres::PgRow,
    column: &str,
) -> Result<Option<BindingDigest>, LiveMarketChannelErrorV1> {
    let bytes: Option<Vec<u8>> = row
        .try_get(column)
        .map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?;
    bytes
        .map(|bytes| {
            <[u8; 32]>::try_from(bytes.as_slice())
                .map(BindingDigest::from_untrusted_bytes)
                .map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)
        })
        .transpose()
}

/// Resolves the Owner's own view of the binding a live channel may run on, inside one transaction.
///
/// The lineage head is required, not merely the named row. Later evidence about a source creates a
/// successor binding rather than upgrading an earlier one, so a channel that kept streaming under
/// the row it opened on would keep streaming after that source was superseded, with the superseded
/// row still reading as admitted. A live channel is not an as-of question.
async fn resolve_live_market_binding_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &crate::owner::source_binding::UntrustedSourceBindingLocator,
) -> Result<LiveMarketBindingV1, LiveMarketChannelErrorV1> {
    let aggregate = super::load_source_for_update(transaction, locator.binding_id(), true)
        .await
        .map_err(|_| LiveMarketChannelErrorV1::BindingUnavailable)?
        .ok_or(LiveMarketChannelErrorV1::BindingUnavailable)?;

    if aggregate.commit().receipt().locator() != locator {
        return Err(LiveMarketChannelErrorV1::BindingUnavailable);
    }
    let readback =
        crate::owner::source_binding::SourceBindingOwnerReadback::from_verified(&aggregate);

    if !readback.is_admitted() {
        return Err(LiveMarketChannelErrorV1::BindingUnavailable);
    }
    Ok(LiveMarketBindingV1 {
        source_binding_identity: readback.binding_id(),
        source_binding_lineage_root: readback.lineage_root(),
        source_binding_lineage_version: readback.lineage_version(),
        market_semantics_identity:
            crate::owner::source_binding::authority::derive_market_semantics_compatibility_identity_v1(
                &aggregate.commit().fact().proposal().semantics,
            ),
    })
}

impl MarketDataOwnerPostgres {
    /// Resolves the binding and issues the subscription one live channel may run on.
    ///
    /// # Errors
    ///
    /// `BindingUnavailable` when the locator names nothing this Owner admitted or the lineage has
    /// moved past it, `InstrumentUnavailable` when no Instrument Master fact covers a proposed
    /// instrument at `observation_ns`.
    pub(crate) async fn open_live_market_scope_v1(
        &self,
        request: &LiveMarketChannelRequestV1,
        observation_ns: u64,
    ) -> Result<(LiveMarketBindingV1, LiveMarketSubscriptionV1), LiveMarketChannelErrorV1> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
        let scope = resolve_live_market_scope_v1(&mut transaction, request, observation_ns).await;
        transaction
            .rollback()
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
        scope
    }

    /// Seals one batch against the channel's durable head and advances it in the same transaction.
    ///
    /// The binding and the subscription are resolved again here rather than reused from the open,
    /// so a source superseded while the channel was waiting on the venue, or an instrument whose
    /// Instrument Master fact has since stopped covering now, stops the channel instead of being
    /// carried on the strength of a check made minutes ago.
    ///
    /// Either every fact in the batch is issued and the head names the last of them, or none is
    /// and the head is untouched. A consumer therefore never sees a sequence the Owner will hand
    /// out again after a restart.
    ///
    /// # Errors
    ///
    /// A bounded category. An observation outside the re-issued subscription refuses the whole
    /// batch rather than being trimmed out of it.
    pub(crate) async fn seal_live_market_batch_v1(
        &self,
        request: &LiveMarketChannelRequestV1,
        channel_identity: BindingDigest,
        observations: &[crate::owner::live_market_fact_v1::VendorLiveObservationV1],
        retrieval_ns: u64,
    ) -> Result<Vec<LiveMarketFactV1>, LiveMarketChannelErrorV1> {
        if observations.is_empty() {
            return Ok(Vec::new());
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
        let (binding, subscription) =
            resolve_live_market_scope_v1(&mut transaction, request, retrieval_ns).await?;

        // The scope is re-issued, so it must still name the channel the head belongs to. A channel
        // whose identity moved is a different channel and must not inherit this one's sequence.
        if derive_channel_identity_v1(binding.source_binding_identity, &subscription)
            != channel_identity
        {
            return Err(LiveMarketChannelErrorV1::InstrumentUnavailable);
        }
        let head = head_for_update(
            &mut transaction,
            channel_identity,
            binding.source_binding_identity,
        )
        .await?;
        let mut sequence = head.owner_sequence();
        let mut facts = Vec::with_capacity(observations.len());

        for observation in observations {
            sequence = sequence
                .checked_add(1)
                .ok_or(LiveMarketChannelErrorV1::StoreUntrusted)?;
            facts.push(seal_live_market_fact_v1(
                observation,
                &subscription,
                binding,
                sequence,
                retrieval_ns,
            )?);
        }
        let last = facts
            .last()
            .ok_or(LiveMarketChannelErrorV1::StoreUntrusted)?;
        advance_head_v1(
            &mut transaction,
            channel_identity,
            binding.source_binding_identity,
            sequence,
            last.identity(),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
        Ok(facts)
    }

    /// Reads one channel's durable head without advancing it or creating one.
    ///
    /// This is a read, so it neither writes nor locks: a consumer polling the head must not mint
    /// custody for a channel that has issued nothing, nor serialise against an in-flight batch.
    /// A channel with no stored head has issued nothing, which is what the empty head says.
    ///
    /// # Errors
    ///
    /// A bounded category when the store cannot answer or the head does not verify.
    pub(crate) async fn live_market_channel_head_v1(
        &self,
        channel_identity: BindingDigest,
        source_binding_identity: BindingDigest,
    ) -> Result<LiveMarketChannelHeadV1, LiveMarketChannelErrorV1> {
        let row = sqlx::query("SELECT source_binding_identity,owner_sequence,last_fact_identity,head_digest FROM market_data_private.live_market_channel_heads_v1 WHERE channel_identity=$1")
            .bind(channel_identity.as_bytes().as_slice())
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;

        match row {
            None => Ok(LiveMarketChannelHeadV1::seal(channel_identity, 0, None)),
            Some(row) => decode_head_row(&row, channel_identity, source_binding_identity),
        }
    }
}

/// Writes one channel head forward inside the caller's transaction.
///
/// The digest is written with the row, so the two can only disagree if something outside this
/// Owner changed one of them.
async fn advance_head_v1(
    transaction: &mut Transaction<'_, Postgres>,
    channel_identity: BindingDigest,
    source_binding_identity: BindingDigest,
    owner_sequence: u64,
    last_fact_identity: BindingDigest,
) -> Result<(), LiveMarketChannelErrorV1> {
    let digest = seal_head_digest_v1(
        channel_identity,
        source_binding_identity,
        owner_sequence,
        Some(last_fact_identity),
    );
    sqlx::query("UPDATE market_data_private.live_market_channel_heads_v1 SET owner_sequence=$2,last_fact_identity=$3,head_digest=$4 WHERE channel_identity=$1")
        .bind(channel_identity.as_bytes().as_slice())
        .bind(
            i64::try_from(owner_sequence).map_err(|_| LiveMarketChannelErrorV1::StoreUntrusted)?,
        )
        .bind(last_fact_identity.as_bytes().as_slice())
        .bind(digest.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|_| LiveMarketChannelErrorV1::StoreUnavailable)?;
    Ok(())
}

/// Resolves the binding and issues the subscription inside one caller transaction.
async fn resolve_live_market_scope_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &LiveMarketChannelRequestV1,
    observation_ns: u64,
) -> Result<(LiveMarketBindingV1, LiveMarketSubscriptionV1), LiveMarketChannelErrorV1> {
    let binding = resolve_live_market_binding_v1(transaction, &request.source_binding).await?;
    let subscription = super::issue_live_market_subscription_v1(
        transaction,
        &request.proposed_instruments,
        request.channel,
        request.field_semantic,
        binding,
        observation_ns,
    )
    .await?;
    Ok((binding, subscription))
}

#[cfg(test)]
mod tests {
    use std::env;

    use sqlx::postgres::PgPoolOptions;

    use super::*;

    /// This proof's own channel, chosen so the shared chain database can carry it beside every
    /// other Owner's rows. Every statement below names it, and the proof removes exactly this row
    /// before it returns.
    fn proof_channel_identity() -> BindingDigest {
        BindingDigest::from_untrusted_bytes([0x4C; 32])
    }

    fn proof_binding_identity() -> BindingDigest {
        BindingDigest::from_untrusted_bytes([0x4D; 32])
    }

    fn proof_fact_identity() -> BindingDigest {
        BindingDigest::from_untrusted_bytes([0x4E; 32])
    }

    /// One live channel head is durable, verified, private, and readable without being minted.
    ///
    /// The venue is deliberately absent. What a restart has to answer is not "can the venue be
    /// reached" but "which sequence did I last issue", and that answer lives entirely in this
    /// relation. The end-to-end proof under `crates/adapters/bybit/tests` drives the same head
    /// through real trades; this one drives the failures a live venue cannot produce on demand:
    /// a rewound sequence, a substituted fact, and a reader that should reach none of it.
    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    async fn postgres_live_channel_head_resumes_and_is_acl_sealed_and_tamper_closed() {
        let owner_url = env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        let reader_url = env::var("MARKET_DATA_READER_TEST_DATABASE_URL").unwrap();
        let owner = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
        let channel = proof_channel_identity();
        let binding = proof_binding_identity();
        let rows_here = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM market_data_private.live_market_channel_heads_v1 WHERE channel_identity=$1")
                .bind(channel.as_bytes().as_slice())
                .fetch_one(&owner.pool)
                .await
                .unwrap()
        };
        assert_eq!(
            rows_here().await,
            0,
            "this proof starts from no head of its own"
        );

        // Reading a head the Owner never issued answers "nothing issued" without minting custody
        // for it. A consumer polling a quiet channel must not create rows by looking.
        let empty = owner
            .live_market_channel_head_v1(channel, binding)
            .await
            .unwrap();
        assert_eq!(empty.owner_sequence(), 0);
        assert_eq!(empty.last_fact_identity(), None);
        assert_eq!(empty.channel_identity(), channel);
        assert_eq!(rows_here().await, 0, "a read writes nothing");

        // The sealing path takes the row lock, which is what creates the head on first use.
        let mut transaction = owner.pool.begin().await.unwrap();
        let created = head_for_update(&mut transaction, channel, binding)
            .await
            .unwrap();
        assert_eq!(created.owner_sequence(), 0);
        advance_head_v1(&mut transaction, channel, binding, 3, proof_fact_identity())
            .await
            .unwrap();
        transaction.commit().await.unwrap();
        let advanced = owner
            .live_market_channel_head_v1(channel, binding)
            .await
            .unwrap();
        assert_eq!(advanced.owner_sequence(), 3);
        assert_eq!(advanced.last_fact_identity(), Some(proof_fact_identity()));

        // A rewound sequence is the one fault the head exists to catch: the Owner would otherwise
        // re-issue sequences a consumer has already ordered its own state by.
        sqlx::query("UPDATE market_data_private.live_market_channel_heads_v1 SET owner_sequence=1 WHERE channel_identity=$1")
            .bind(channel.as_bytes().as_slice())
            .execute(&owner.pool)
            .await
            .unwrap();
        assert_eq!(
            owner.live_market_channel_head_v1(channel, binding).await,
            Err(LiveMarketChannelErrorV1::StoreUntrusted)
        );
        sqlx::query("UPDATE market_data_private.live_market_channel_heads_v1 SET owner_sequence=3 WHERE channel_identity=$1")
            .bind(channel.as_bytes().as_slice())
            .execute(&owner.pool)
            .await
            .unwrap();
        assert_eq!(
            owner
                .live_market_channel_head_v1(channel, binding)
                .await
                .unwrap(),
            advanced,
            "restoring the exact column restores the exact head"
        );

        // A substituted last fact is caught the same way, so the head cannot be made to name a
        // fact the Owner never issued.
        sqlx::query("UPDATE market_data_private.live_market_channel_heads_v1 SET last_fact_identity=$2 WHERE channel_identity=$1")
            .bind(channel.as_bytes().as_slice())
            .bind([0x4F_u8; 32].as_slice())
            .execute(&owner.pool)
            .await
            .unwrap();
        assert_eq!(
            owner.live_market_channel_head_v1(channel, binding).await,
            Err(LiveMarketChannelErrorV1::StoreUntrusted)
        );
        sqlx::query("UPDATE market_data_private.live_market_channel_heads_v1 SET last_fact_identity=$2 WHERE channel_identity=$1")
            .bind(channel.as_bytes().as_slice())
            .bind(proof_fact_identity().as_bytes().as_slice())
            .execute(&owner.pool)
            .await
            .unwrap();
        assert_eq!(
            owner
                .live_market_channel_head_v1(channel, binding)
                .await
                .unwrap(),
            advanced
        );

        // A head read under a binding the channel does not belong to verifies nothing, because the
        // channel identity already covers the binding.
        assert_eq!(
            owner
                .live_market_channel_head_v1(channel, proof_fact_identity())
                .await,
            Err(LiveMarketChannelErrorV1::StoreUntrusted)
        );

        // The relation is the Owner's alone. The reader cannot see it, and holds no privilege that
        // would let it write. The write half is asked of the catalog rather than attempted: this
        // Owner's heads are custody, and a proof does not need to issue destructive statements to
        // show that a role may not issue them.
        let reader = PgPoolOptions::new()
            .max_connections(1)
            .connect(&reader_url)
            .await
            .unwrap();
        assert!(
            sqlx::query("SELECT * FROM market_data_private.live_market_channel_heads_v1")
                .fetch_all(&reader)
                .await
                .is_err()
        );
        let reader_role: String = sqlx::query_scalar("SELECT current_user::text")
            .fetch_one(&reader)
            .await
            .unwrap();

        for role in [reader_role.as_str(), "public"] {
            for privilege in ["SELECT", "INSERT", "UPDATE", "DELETE"] {
                let admitted: bool = sqlx::query_scalar(
                    "SELECT has_table_privilege($1,'market_data_private.live_market_channel_heads_v1',$2)",
                )
                .bind(role)
                .bind(privilege)
                .fetch_one(&owner.pool)
                .await
                .unwrap();
                assert!(
                    !admitted,
                    "{role} unexpectedly has {privilege} on the head relation"
                );
            }
        }

        // The head stays. It is durable custody, and this proof runs on a database provisioned for
        // it alone, so erasing the row at the end would remove the evidence rather than tidy it.
        assert_eq!(
            rows_here().await,
            1,
            "this proof leaves exactly its own head, and no other"
        );
        assert_eq!(
            owner
                .live_market_channel_head_v1(channel, binding)
                .await
                .unwrap(),
            advanced,
            "the head still verifies after every tamper was restored"
        );
    }
}
