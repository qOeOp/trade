//! R&D-owned custody for one request-bound Native Replay execution-input binding.
//!
//! The binding contains only exact Owner locators and digests. Its constituent token is private so
//! callers cannot splice otherwise valid facts; the future typed Owner-readback adapter must mint it
//! in this module before this persistence boundary can be reached.

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;

use crate::exploratory_replay::{
    ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2,
};

const SCHEMA_VERSION: u16 = 1;
const MEMBER_COUNT: usize = 2;
const BINDING_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-receipt.v1\0";
const OUTBOX_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-outbox.v1\0";
const MAX_TEXT_BYTES: usize = 512;
const MAX_CANONICAL_BYTES: usize = 64 * 1024;

/// Exact request/binding locator accepted by the R&D recovery port.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingLocatorV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    binding_identity: [u8; 32],
}

impl NativeReplayExecutionInputBindingLocatorV1 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub const fn binding_identity(&self) -> [u8; 32] {
        self.binding_identity
    }
}

/// Immutable locator-only binding recovered from R&D custody.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    trial_family: NamedLocatorV1,
    artifact: NamedLocatorV1,
    strategy_plan: NamedLocatorV1,
    execution_profile_seals: ExecutionProfileSealLocatorsV1,
    public_instrument_master_cut: InstrumentMasterCutLocatorBindingV1,
    universe_frame_receipt: ExactOwnerLocatorV1,
    members: [NativeReplayExecutionInputMemberV1; MEMBER_COUNT],
    binding_identity: [u8; 32],
    binding_digest: [u8; 32],
    canonical_bytes: Vec<u8>,
}

impl NativeReplayExecutionInputBindingV1 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub const fn binding_identity(&self) -> [u8; 32] {
        self.binding_identity
    }

    #[must_use]
    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub fn member_keys(&self) -> [&str; MEMBER_COUNT] {
        [&self.members[0].member_key, &self.members[1].member_key]
    }
}

#[derive(Debug, Eq, PartialEq)]
struct NamedLocatorV1 {
    identity: String,
    digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExactOwnerLocatorV1 {
    identity: [u8; 32],
    digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct InstrumentMasterCutLocatorBindingV1 {
    request_identity: [u8; 32],
    request_binding_digest: [u8; 32],
    cut_identity: [u8; 32],
    receipt_identity: [u8; 32],
}

#[derive(Debug, Eq, PartialEq)]
struct ExecutionProfileSealLocatorsV1 {
    catalog_binding_digest: [u8; 32],
    family_binding_digest: [u8; 32],
    request_binding_digest: [u8; 32],
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_digest: [u8; 32],
}

#[derive(Debug, Eq, PartialEq)]
struct NativeReplayExecutionInputMemberV1 {
    member_key: String,
    public_instrument_identity: String,
    public_instrument_digest: [u8; 32],
    venue_identity: String,
    account_scope_identity: String,
    schedule_identity: [u8; 32],
    instrument_economic_terms_fact: ExactOwnerLocatorV1,
    instrument_economic_terms_receipt: ExactOwnerLocatorV1,
    bar_schedule_cut: ExactOwnerLocatorV1,
    bar_schedule_receipt: ExactOwnerLocatorV1,
}

/// Deterministic receipt for the immutable binding.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingReceiptV1 {
    receipt_identity: [u8; 32],
    binding_identity: [u8; 32],
    binding_digest: [u8; 32],
    committed_at_epoch_ms: u64,
    canonical_bytes: Vec<u8>,
}

impl NativeReplayExecutionInputBindingReceiptV1 {
    #[must_use]
    pub const fn receipt_identity(&self) -> [u8; 32] {
        self.receipt_identity
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
struct NativeReplayExecutionInputBindingOutboxV1 {
    event_identity: [u8; 32],
    request_identity: String,
    binding_identity: [u8; 32],
    receipt_identity: [u8; 32],
    payload_digest: [u8; 32],
    canonical_bytes: Vec<u8>,
}

/// Move-only R&D Owner readback consumed by the future Native Replay preparation adapter.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingReadbackV1 {
    binding: NativeReplayExecutionInputBindingV1,
    receipt: NativeReplayExecutionInputBindingReceiptV1,
    outbox: NativeReplayExecutionInputBindingOutboxV1,
}

impl NativeReplayExecutionInputBindingReadbackV1 {
    #[must_use]
    pub const fn binding(&self) -> &NativeReplayExecutionInputBindingV1 {
        &self.binding
    }

    #[must_use]
    pub const fn receipt(&self) -> &NativeReplayExecutionInputBindingReceiptV1 {
        &self.receipt
    }

    #[must_use]
    pub fn locator(&self) -> NativeReplayExecutionInputBindingLocatorV1 {
        NativeReplayExecutionInputBindingLocatorV1 {
            request_locator: self.binding.request_locator.clone(),
            binding_identity: self.binding.binding_identity,
        }
    }
}

/// Redacted fail-closed outcome for issuance and recovery.
#[derive(Debug, Error)]
pub enum NativeReplayExecutionInputBindingErrorV1 {
    #[error("Native Replay execution-input binding unavailable")]
    Unavailable,
    #[error("Native Replay execution-input binding custody conflict")]
    Conflict,
    #[error("Native Replay execution-input binding storage unavailable")]
    Storage(#[source] sqlx::Error),
}

/// Private, move-only proof that all exact constituent Owner readbacks were verified together.
///
/// No caller-facing constructor, deserializer, or clone implementation exists. T140 must add the
/// typed Owner-readback adapter beside this token and mint it only after the complete equality proof.
pub(crate) struct VerifiedNativeReplayExecutionInputConstituentsV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    trial_family: NamedLocatorV1,
    artifact: NamedLocatorV1,
    strategy_plan: NamedLocatorV1,
    execution_profile_seals: ExecutionProfileSealLocatorsV1,
    public_instrument_master_cut: InstrumentMasterCutLocatorBindingV1,
    universe_frame_receipt: ExactOwnerLocatorV1,
    members: [NativeReplayExecutionInputMemberV1; MEMBER_COUNT],
}

/// Atomically appends one binding, receipt, and outbox row under an already sealed Replay request.
///
/// Reissuing the same exact binding returns the byte-identical stored readback without appending.
/// A different binding for the same request fails before any insert.
pub(crate) async fn issue_native_replay_execution_input_binding_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    replay: &SealedExploratoryReplayReadbackV2,
    verified: VerifiedNativeReplayExecutionInputConstituentsV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    if verified.request_locator != replay.locator() {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    validate_storage_boundary(transaction).await?;
    let prepared = prepare_rows(verified, replay.owner_cut_epoch_ms())?;
    if let Some(existing) = load_rows(
        transaction,
        &prepared.binding.request_locator.request_identity,
    )
    .await?
    {
        let readback = recover_rows(existing)?;
        return if readback == prepared {
            Ok(readback)
        } else {
            Err(NativeReplayExecutionInputBindingErrorV1::Conflict)
        };
    }

    let request = &prepared.binding.request_locator;
    let inserted: Option<i64> = sqlx::query_scalar(
        "WITH sealed AS (
           SELECT request_identity FROM public.rd_sealed_exploratory_replay_requests_v1
            WHERE request_identity=$1 AND v2_meaning_digest=$2
              AND v2_receipt_json->>'receipt_identity'=$3 AND v2_seal_digest=$4
              AND request_schema_version=2 AND lifecycle_state='FROZEN' FOR SHARE
         ), binding AS (
           INSERT INTO public.rd_native_replay_execution_input_bindings_v1
             (request_identity,request_meaning_digest,request_receipt_identity,request_seal_digest,binding_identity,binding_digest,canonical_binding_bytes,committed_at_epoch_ms)
           SELECT request_identity,$2,$3,$4,$5,$6,$7,$8 FROM sealed RETURNING binding_identity
         ), receipt AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_receipts_v1
             (binding_identity,receipt_identity,receipt_digest,canonical_receipt_bytes,committed_at_epoch_ms)
           SELECT binding_identity,$9,$10,$11,$8 FROM binding RETURNING receipt_identity
         ), outbox AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_outbox_v1
             (event_identity,request_identity,binding_identity,receipt_identity,payload_digest,canonical_payload_bytes,committed_at_epoch_ms)
           SELECT $12,$1,$5,receipt_identity,$13,$14,$8 FROM receipt RETURNING 1
         ) SELECT count(*) FROM outbox",
    )
    .bind(&request.request_identity)
    .bind(&request.meaning_digest)
    .bind(&request.receipt_identity)
    .bind(&request.seal_digest)
    .bind(prepared.binding.binding_identity.as_slice())
    .bind(prepared.binding.binding_digest.as_slice())
    .bind(&prepared.binding.canonical_bytes)
    .bind(i64::try_from(prepared.receipt.committed_at_epoch_ms).map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)?)
    .bind(prepared.receipt.receipt_identity.as_slice())
    .bind(digest(RECEIPT_DOMAIN, &prepared.receipt.canonical_bytes).as_slice())
    .bind(&prepared.receipt.canonical_bytes)
    .bind(prepared.outbox.event_identity.as_slice())
    .bind(prepared.outbox.payload_digest.as_slice())
    .bind(&prepared.outbox.canonical_bytes)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    if inserted != Some(1) {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    Ok(prepared)
}

/// Recovers one exact request/binding locator without appending or selecting a latest row.
pub async fn resolve_native_replay_execution_input_binding_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &NativeReplayExecutionInputBindingLocatorV1,
) -> Result<
    Option<NativeReplayExecutionInputBindingReadbackV1>,
    NativeReplayExecutionInputBindingErrorV1,
> {
    validate_storage_boundary(transaction).await?;
    let Some(rows) = load_rows(transaction, &locator.request_locator.request_identity).await?
    else {
        return Ok(None);
    };
    let readback = recover_rows(rows)?;
    if readback.binding.request_locator != locator.request_locator
        || readback.binding.binding_identity != locator.binding_identity
    {
        return Ok(None);
    }
    Ok(Some(readback))
}

#[derive(Debug, Eq, PartialEq)]
struct StoredRowsV1 {
    request_identity: String,
    request_meaning_digest: String,
    request_receipt_identity: String,
    request_seal_digest: String,
    binding_identity: Vec<u8>,
    binding_digest: Vec<u8>,
    binding_bytes: Vec<u8>,
    receipt_identity: Vec<u8>,
    receipt_digest: Vec<u8>,
    receipt_bytes: Vec<u8>,
    receipt_committed_at_epoch_ms: i64,
    event_identity: Vec<u8>,
    outbox_request_identity: String,
    outbox_receipt_identity: Vec<u8>,
    payload_digest: Vec<u8>,
    payload_bytes: Vec<u8>,
    outbox_committed_at_epoch_ms: i64,
    committed_at_epoch_ms: i64,
}

async fn validate_storage_boundary(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    let valid: bool = sqlx::query_scalar(
        "WITH expected(name) AS (VALUES
           ('rd_native_replay_execution_input_bindings_v1'::text),
           ('rd_native_replay_execution_input_binding_receipts_v1'::text),
           ('rd_native_replay_execution_input_binding_outbox_v1'::text)
         ), relations AS (
           SELECT expected.name,relation.oid,relation.relowner,relation.relkind,relation.relpersistence,relation.relacl
             FROM expected
             LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname='public'
             LEFT JOIN pg_catalog.pg_class relation ON relation.relnamespace=namespace.oid AND relation.relname=expected.name
         )
         SELECT current_user='rd_owner' AND count(*)=3
            AND bool_and(oid IS NOT NULL AND pg_catalog.pg_get_userbyid(relowner)='rd_owner' AND relkind='r' AND relpersistence='p')
            AND NOT EXISTS (
              SELECT 1 FROM relations
              CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl
              WHERE acl.grantee<>relowner
            )
           FROM relations",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    if !valid {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    Ok(())
}

async fn load_rows(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredRowsV1>, NativeReplayExecutionInputBindingErrorV1> {
    let row = sqlx::query(
        "SELECT b.request_identity,b.request_meaning_digest,b.request_receipt_identity,b.request_seal_digest,
                b.binding_identity,b.binding_digest,b.canonical_binding_bytes,
                r.receipt_identity,r.receipt_digest,r.canonical_receipt_bytes,r.committed_at_epoch_ms AS receipt_committed_at_epoch_ms,
                o.event_identity,o.request_identity AS outbox_request_identity,o.receipt_identity AS outbox_receipt_identity,
                o.payload_digest,o.canonical_payload_bytes,o.committed_at_epoch_ms AS outbox_committed_at_epoch_ms,
                b.committed_at_epoch_ms
           FROM public.rd_native_replay_execution_input_bindings_v1 b
           JOIN public.rd_native_replay_execution_input_binding_receipts_v1 r USING(binding_identity)
           JOIN public.rd_native_replay_execution_input_binding_outbox_v1 o USING(binding_identity)
          WHERE b.request_identity=$1",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    row.map(|row| {
        Ok(StoredRowsV1 {
            request_identity: row.try_get("request_identity")?,
            request_meaning_digest: row.try_get("request_meaning_digest")?,
            request_receipt_identity: row.try_get("request_receipt_identity")?,
            request_seal_digest: row.try_get("request_seal_digest")?,
            binding_identity: row.try_get("binding_identity")?,
            binding_digest: row.try_get("binding_digest")?,
            binding_bytes: row.try_get("canonical_binding_bytes")?,
            receipt_identity: row.try_get("receipt_identity")?,
            receipt_digest: row.try_get("receipt_digest")?,
            receipt_bytes: row.try_get("canonical_receipt_bytes")?,
            receipt_committed_at_epoch_ms: row.try_get("receipt_committed_at_epoch_ms")?,
            event_identity: row.try_get("event_identity")?,
            outbox_request_identity: row.try_get("outbox_request_identity")?,
            outbox_receipt_identity: row.try_get("outbox_receipt_identity")?,
            payload_digest: row.try_get("payload_digest")?,
            payload_bytes: row.try_get("canonical_payload_bytes")?,
            outbox_committed_at_epoch_ms: row.try_get("outbox_committed_at_epoch_ms")?,
            committed_at_epoch_ms: row.try_get("committed_at_epoch_ms")?,
        })
    })
    .transpose()
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)
}

fn prepare_rows(
    verified: VerifiedNativeReplayExecutionInputConstituentsV1,
    committed_at_epoch_ms: u64,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    validate_verified(&verified)?;
    let mut writer = CanonicalWriter::new();
    writer.u16(SCHEMA_VERSION);
    writer.request_locator(&verified.request_locator)?;
    writer.named(&verified.trial_family)?;
    writer.named(&verified.artifact)?;
    writer.named(&verified.strategy_plan)?;
    writer.digest(verified.execution_profile_seals.catalog_binding_digest);
    writer.digest(verified.execution_profile_seals.family_binding_digest);
    writer.digest(verified.execution_profile_seals.request_binding_digest);
    writer.digest(
        verified
            .execution_profile_seals
            .economic_configuration_digest,
    );
    writer.digest(
        verified
            .execution_profile_seals
            .runner_operational_profile_digest,
    );
    writer.instrument_master_cut_locator(verified.public_instrument_master_cut);
    writer.locator(verified.universe_frame_receipt);
    writer.u16(MEMBER_COUNT as u16);
    for member in &verified.members {
        writer.text(&member.member_key)?;
        writer.text(&member.public_instrument_identity)?;
        writer.digest(member.public_instrument_digest);
        writer.text(&member.venue_identity)?;
        writer.text(&member.account_scope_identity)?;
        writer.digest(member.schedule_identity);
        writer.locator(member.instrument_economic_terms_fact);
        writer.locator(member.instrument_economic_terms_receipt);
        writer.locator(member.bar_schedule_cut);
        writer.locator(member.bar_schedule_receipt);
    }
    let canonical_bytes = writer.finish()?;
    let binding_identity = digest(BINDING_DOMAIN, &canonical_bytes);
    let binding_digest = binding_identity;

    let mut receipt_writer = CanonicalWriter::new();
    receipt_writer.u16(SCHEMA_VERSION);
    receipt_writer.digest(binding_identity);
    receipt_writer.digest(binding_digest);
    receipt_writer.u64(committed_at_epoch_ms);
    let receipt_bytes = receipt_writer.finish()?;
    let receipt_identity = digest(RECEIPT_DOMAIN, &receipt_bytes);

    let request_identity = verified.request_locator.request_identity.clone();
    let mut outbox_writer = CanonicalWriter::new();
    outbox_writer.u16(SCHEMA_VERSION);
    outbox_writer.text(&verified.request_locator.request_identity)?;
    outbox_writer.digest(binding_identity);
    outbox_writer.digest(receipt_identity);
    let outbox_bytes = outbox_writer.finish()?;
    let event_identity = digest(OUTBOX_DOMAIN, &outbox_bytes);

    Ok(NativeReplayExecutionInputBindingReadbackV1 {
        binding: NativeReplayExecutionInputBindingV1 {
            request_locator: verified.request_locator,
            trial_family: verified.trial_family,
            artifact: verified.artifact,
            strategy_plan: verified.strategy_plan,
            execution_profile_seals: verified.execution_profile_seals,
            public_instrument_master_cut: verified.public_instrument_master_cut,
            universe_frame_receipt: verified.universe_frame_receipt,
            members: verified.members,
            binding_identity,
            binding_digest,
            canonical_bytes,
        },
        receipt: NativeReplayExecutionInputBindingReceiptV1 {
            receipt_identity,
            binding_identity,
            binding_digest,
            committed_at_epoch_ms,
            canonical_bytes: receipt_bytes,
        },
        outbox: NativeReplayExecutionInputBindingOutboxV1 {
            event_identity,
            request_identity,
            binding_identity,
            receipt_identity,
            payload_digest: digest(OUTBOX_DOMAIN, &outbox_bytes),
            canonical_bytes: outbox_bytes,
        },
    })
}

fn recover_rows(
    rows: StoredRowsV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    let mut decoder = CanonicalDecoder::new(&rows.binding_bytes);
    if decoder.u16()? != SCHEMA_VERSION {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    let request_locator = decoder.request_locator()?;
    let trial_family = decoder.named()?;
    let artifact = decoder.named()?;
    let strategy_plan = decoder.named()?;
    let execution_profile_seals = ExecutionProfileSealLocatorsV1 {
        catalog_binding_digest: decoder.digest()?,
        family_binding_digest: decoder.digest()?,
        request_binding_digest: decoder.digest()?,
        economic_configuration_digest: decoder.digest()?,
        runner_operational_profile_digest: decoder.digest()?,
    };
    let public_instrument_master_cut = decoder.instrument_master_cut_locator()?;
    let universe_frame_receipt = decoder.locator()?;
    if decoder.u16()? as usize != MEMBER_COUNT {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    let members = [decoder.member()?, decoder.member()?];
    decoder.finish()?;
    let binding_identity = array(&rows.binding_identity)?;
    let binding_digest = array(&rows.binding_digest)?;
    let committed_at_epoch_ms = u64::try_from(rows.committed_at_epoch_ms)
        .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)?;

    let mut receipt_decoder = CanonicalDecoder::new(&rows.receipt_bytes);
    if receipt_decoder.u16()? != SCHEMA_VERSION
        || receipt_decoder.digest()? != binding_identity
        || receipt_decoder.digest()? != binding_digest
        || receipt_decoder.u64()? != committed_at_epoch_ms
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    receipt_decoder.finish()?;
    let receipt_identity = array(&rows.receipt_identity)?;

    let mut outbox_decoder = CanonicalDecoder::new(&rows.payload_bytes);
    if outbox_decoder.u16()? != SCHEMA_VERSION
        || outbox_decoder.text()? != request_locator.request_identity
        || outbox_decoder.digest()? != binding_identity
        || outbox_decoder.digest()? != receipt_identity
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    outbox_decoder.finish()?;

    if request_locator.request_identity != rows.request_identity
        || request_locator.meaning_digest != rows.request_meaning_digest
        || request_locator.receipt_identity != rows.request_receipt_identity
        || request_locator.seal_digest != rows.request_seal_digest
        || digest(BINDING_DOMAIN, &rows.binding_bytes) != binding_identity
        || binding_digest != binding_identity
        || digest(RECEIPT_DOMAIN, &rows.receipt_bytes) != receipt_identity
        || array(&rows.receipt_digest)? != digest(RECEIPT_DOMAIN, &rows.receipt_bytes)
        || rows.receipt_committed_at_epoch_ms != rows.committed_at_epoch_ms
        || rows.outbox_request_identity != rows.request_identity
        || array(&rows.outbox_receipt_identity)? != receipt_identity
        || array(&rows.event_identity)? != digest(OUTBOX_DOMAIN, &rows.payload_bytes)
        || array(&rows.payload_digest)? != digest(OUTBOX_DOMAIN, &rows.payload_bytes)
        || rows.outbox_committed_at_epoch_ms != rows.committed_at_epoch_ms
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }

    let verified = VerifiedNativeReplayExecutionInputConstituentsV1 {
        request_locator,
        trial_family,
        artifact,
        strategy_plan,
        execution_profile_seals,
        public_instrument_master_cut,
        universe_frame_receipt,
        members,
    };
    let expected = prepare_rows(verified, committed_at_epoch_ms)?;
    if expected.binding.canonical_bytes != rows.binding_bytes
        || expected.receipt.canonical_bytes != rows.receipt_bytes
        || expected.outbox.canonical_bytes != rows.payload_bytes
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    Ok(expected)
}

fn validate_verified(
    verified: &VerifiedNativeReplayExecutionInputConstituentsV1,
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    let request = &verified.request_locator;
    if !valid_text(&request.request_identity)
        || !valid_sha256(&request.meaning_digest)
        || !valid_text(&request.receipt_identity)
        || !valid_sha256(&request.seal_digest)
        || !valid_named(&verified.trial_family)
        || !valid_named(&verified.artifact)
        || !valid_named(&verified.strategy_plan)
        || !valid_instrument_master_cut_locator(verified.public_instrument_master_cut)
        || !valid_locator(verified.universe_frame_receipt)
        || verified.members[0].member_key >= verified.members[1].member_key
        || verified.members[0].public_instrument_identity
            == verified.members[1].public_instrument_identity
        || !verified.members.iter().all(valid_member)
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    let seals = &verified.execution_profile_seals;
    if [
        seals.catalog_binding_digest,
        seals.family_binding_digest,
        seals.request_binding_digest,
        seals.economic_configuration_digest,
        seals.runner_operational_profile_digest,
    ]
    .contains(&[0; 32])
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
    }
    Ok(())
}

fn valid_named(value: &NamedLocatorV1) -> bool {
    valid_text(&value.identity) && value.digest != [0; 32]
}

fn valid_locator(value: ExactOwnerLocatorV1) -> bool {
    value.identity != [0; 32] && value.digest != [0; 32]
}

fn valid_instrument_master_cut_locator(value: InstrumentMasterCutLocatorBindingV1) -> bool {
    [
        value.request_identity,
        value.request_binding_digest,
        value.cut_identity,
        value.receipt_identity,
    ]
    .into_iter()
    .all(|identity| identity != [0; 32])
}

fn valid_member(value: &NativeReplayExecutionInputMemberV1) -> bool {
    valid_text(&value.member_key)
        && valid_text(&value.public_instrument_identity)
        && value.public_instrument_digest != [0; 32]
        && valid_text(&value.venue_identity)
        && valid_text(&value.account_scope_identity)
        && value.schedule_identity != [0; 32]
        && valid_locator(value.instrument_economic_terms_fact)
        && valid_locator(value.instrument_economic_terms_receipt)
        && valid_locator(value.bar_schedule_cut)
        && valid_locator(value.bar_schedule_receipt)
}

fn valid_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_TEXT_BYTES
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn array(bytes: &[u8]) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV1> {
    bytes
        .try_into()
        .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)
}

struct CanonicalWriter(Vec<u8>);

impl CanonicalWriter {
    fn new() -> Self {
        Self(Vec::new())
    }
    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn digest(&mut self, value: [u8; 32]) {
        self.0.extend_from_slice(&value);
    }
    fn text(&mut self, value: &str) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        let length = u16::try_from(value.len())
            .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)?;
        self.u16(length);
        self.0.extend_from_slice(value.as_bytes());
        Ok(())
    }
    fn request_locator(
        &mut self,
        value: &ExploratoryReplayRequestLocatorV2,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        self.text(&value.request_identity)?;
        self.text(&value.meaning_digest)?;
        self.text(&value.receipt_identity)?;
        self.text(&value.seal_digest)
    }
    fn named(
        &mut self,
        value: &NamedLocatorV1,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        self.text(&value.identity)?;
        self.digest(value.digest);
        Ok(())
    }
    fn locator(&mut self, value: ExactOwnerLocatorV1) {
        self.digest(value.identity);
        self.digest(value.digest);
    }
    fn instrument_master_cut_locator(&mut self, value: InstrumentMasterCutLocatorBindingV1) {
        self.digest(value.request_identity);
        self.digest(value.request_binding_digest);
        self.digest(value.cut_identity);
        self.digest(value.receipt_identity);
    }
    fn finish(self) -> Result<Vec<u8>, NativeReplayExecutionInputBindingErrorV1> {
        if self.0.is_empty() || self.0.len() > MAX_CANONICAL_BYTES {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
        }
        Ok(self.0)
    }
}

struct CanonicalDecoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> CanonicalDecoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(
        &mut self,
        length: usize,
    ) -> Result<&'a [u8], NativeReplayExecutionInputBindingErrorV1> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(NativeReplayExecutionInputBindingErrorV1::Unavailable)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(NativeReplayExecutionInputBindingErrorV1::Unavailable)?;
        self.offset = end;
        Ok(value)
    }
    fn u16(&mut self) -> Result<u16, NativeReplayExecutionInputBindingErrorV1> {
        Ok(u16::from_be_bytes(array2(self.take(2)?)?))
    }
    fn u64(&mut self) -> Result<u64, NativeReplayExecutionInputBindingErrorV1> {
        Ok(u64::from_be_bytes(array8(self.take(8)?)?))
    }
    fn digest(&mut self) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV1> {
        array(self.take(32)?)
    }
    fn text(&mut self) -> Result<String, NativeReplayExecutionInputBindingErrorV1> {
        let length = self.u16()? as usize;
        let value = std::str::from_utf8(self.take(length)?)
            .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)?;
        if !valid_text(value) {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
        }
        Ok(value.to_owned())
    }
    fn request_locator(
        &mut self,
    ) -> Result<ExploratoryReplayRequestLocatorV2, NativeReplayExecutionInputBindingErrorV1> {
        Ok(ExploratoryReplayRequestLocatorV2 {
            request_identity: self.text()?,
            meaning_digest: self.text()?,
            receipt_identity: self.text()?,
            seal_digest: self.text()?,
        })
    }
    fn named(&mut self) -> Result<NamedLocatorV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(NamedLocatorV1 {
            identity: self.text()?,
            digest: self.digest()?,
        })
    }
    fn locator(&mut self) -> Result<ExactOwnerLocatorV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(ExactOwnerLocatorV1 {
            identity: self.digest()?,
            digest: self.digest()?,
        })
    }
    fn instrument_master_cut_locator(
        &mut self,
    ) -> Result<InstrumentMasterCutLocatorBindingV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(InstrumentMasterCutLocatorBindingV1 {
            request_identity: self.digest()?,
            request_binding_digest: self.digest()?,
            cut_identity: self.digest()?,
            receipt_identity: self.digest()?,
        })
    }
    fn member(
        &mut self,
    ) -> Result<NativeReplayExecutionInputMemberV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(NativeReplayExecutionInputMemberV1 {
            member_key: self.text()?,
            public_instrument_identity: self.text()?,
            public_instrument_digest: self.digest()?,
            venue_identity: self.text()?,
            account_scope_identity: self.text()?,
            schedule_identity: self.digest()?,
            instrument_economic_terms_fact: self.locator()?,
            instrument_economic_terms_receipt: self.locator()?,
            bar_schedule_cut: self.locator()?,
            bar_schedule_receipt: self.locator()?,
        })
    }
    fn finish(self) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        if self.offset != self.bytes.len() {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable);
        }
        Ok(())
    }
}

fn array2(bytes: &[u8]) -> Result<[u8; 2], NativeReplayExecutionInputBindingErrorV1> {
    bytes
        .try_into()
        .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)
}

fn array8(bytes: &[u8]) -> Result<[u8; 8], NativeReplayExecutionInputBindingErrorV1> {
    bytes
        .try_into()
        .map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(value: u8) -> [u8; 32] {
        [value; 32]
    }
    fn locator(value: u8) -> ExactOwnerLocatorV1 {
        ExactOwnerLocatorV1 {
            identity: d(value),
            digest: d(value + 1),
        }
    }
    fn instrument_master_locator(value: u8) -> InstrumentMasterCutLocatorBindingV1 {
        InstrumentMasterCutLocatorBindingV1 {
            request_identity: d(value),
            request_binding_digest: d(value + 1),
            cut_identity: d(value + 2),
            receipt_identity: d(value + 3),
        }
    }
    fn member(key: &str, instrument: &str, value: u8) -> NativeReplayExecutionInputMemberV1 {
        NativeReplayExecutionInputMemberV1 {
            member_key: key.into(),
            public_instrument_identity: instrument.into(),
            public_instrument_digest: d(value),
            venue_identity: "XNAS".into(),
            account_scope_identity: "research".into(),
            schedule_identity: d(value + 1),
            instrument_economic_terms_fact: locator(value + 2),
            instrument_economic_terms_receipt: locator(value + 4),
            bar_schedule_cut: locator(value + 6),
            bar_schedule_receipt: locator(value + 8),
        }
    }
    fn verified() -> VerifiedNativeReplayExecutionInputConstituentsV1 {
        VerifiedNativeReplayExecutionInputConstituentsV1 {
            request_locator: ExploratoryReplayRequestLocatorV2 {
                request_identity: "replay-v2".into(),
                meaning_digest: format!("sha256:{}", "1".repeat(64)),
                receipt_identity: "receipt-v2".into(),
                seal_digest: format!("sha256:{}", "2".repeat(64)),
            },
            trial_family: NamedLocatorV1 {
                identity: "family-v1".into(),
                digest: d(3),
            },
            artifact: NamedLocatorV1 {
                identity: "artifact-v1".into(),
                digest: d(4),
            },
            strategy_plan: NamedLocatorV1 {
                identity: "plan-v1".into(),
                digest: d(5),
            },
            execution_profile_seals: ExecutionProfileSealLocatorsV1 {
                catalog_binding_digest: d(6),
                family_binding_digest: d(7),
                request_binding_digest: d(8),
                economic_configuration_digest: d(9),
                runner_operational_profile_digest: d(10),
            },
            public_instrument_master_cut: instrument_master_locator(11),
            universe_frame_receipt: locator(13),
            members: [
                member("AAPL", "AAPL.XNAS", 20),
                member("MSFT", "MSFT.XNAS", 40),
            ],
        }
    }
    fn stored(readback: &NativeReplayExecutionInputBindingReadbackV1) -> StoredRowsV1 {
        StoredRowsV1 {
            request_identity: readback.binding.request_locator.request_identity.clone(),
            request_meaning_digest: readback.binding.request_locator.meaning_digest.clone(),
            request_receipt_identity: readback.binding.request_locator.receipt_identity.clone(),
            request_seal_digest: readback.binding.request_locator.seal_digest.clone(),
            binding_identity: readback.binding.binding_identity.to_vec(),
            binding_digest: readback.binding.binding_digest.to_vec(),
            binding_bytes: readback.binding.canonical_bytes.clone(),
            receipt_identity: readback.receipt.receipt_identity.to_vec(),
            receipt_digest: digest(RECEIPT_DOMAIN, &readback.receipt.canonical_bytes).to_vec(),
            receipt_bytes: readback.receipt.canonical_bytes.clone(),
            receipt_committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
            event_identity: readback.outbox.event_identity.to_vec(),
            outbox_request_identity: readback.outbox.request_identity.clone(),
            outbox_receipt_identity: readback.outbox.receipt_identity.to_vec(),
            payload_digest: readback.outbox.payload_digest.to_vec(),
            payload_bytes: readback.outbox.canonical_bytes.clone(),
            outbox_committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
            committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
        }
    }

    #[test]
    fn exact_two_member_binding_round_trips_byte_identically() {
        let prepared = prepare_rows(verified(), 17).expect("prepared");
        let recovered = recover_rows(stored(&prepared)).expect("recovered");
        assert_eq!(prepared, recovered);
        assert_eq!(recovered.binding.member_keys(), ["AAPL", "MSFT"]);
    }

    #[test]
    fn reordered_or_changed_constituent_cannot_join_same_request_custody() {
        let canonical = prepare_rows(verified(), 17).expect("canonical");
        let mut reordered = verified();
        reordered.members.swap(0, 1);
        assert!(prepare_rows(reordered, 17).is_err());
        let mut changed = verified();
        changed.members[0].bar_schedule_cut.digest = d(99);
        let changed = prepare_rows(changed, 17).expect("changed representation");
        assert_ne!(
            canonical.binding.binding_identity,
            changed.binding.binding_identity
        );
    }

    #[test]
    fn duplicate_member_and_corrupt_recovery_fail_closed() {
        let mut duplicate = verified();
        duplicate.members[1].member_key = duplicate.members[0].member_key.clone();
        assert!(prepare_rows(duplicate, 17).is_err());

        let prepared = prepare_rows(verified(), 17).expect("prepared");
        let mut corrupt = stored(&prepared);
        corrupt.binding_bytes[5] ^= 1;
        assert!(recover_rows(corrupt).is_err());

        let mut wrong_request = stored(&prepared);
        wrong_request.request_identity = "another-request".into();
        assert!(recover_rows(wrong_request).is_err());
    }
}
