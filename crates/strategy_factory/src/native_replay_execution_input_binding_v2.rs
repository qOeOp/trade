//! Additive, structural R&D binding for an Owner-sealed two-frame Native Replay sequence.
//!
//! This module has no caller-facing constructor or deserializer. `VerifiedOwnerSequenceV2` is
//! minted from one move-only Market Data `NativeReplayFrameSequenceReadbackV2` and nothing else,
//! so no R&D caller can assert a second PIT cut, frame, schedule or liquidity EVENT.
//! A structurally valid digest is never an Owner readback or durable R&D custody by itself.

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;

use vibe_data::owner::native_replay_scheduling_v2::{
    NativeReplayFrameEvidenceV2, NativeReplayFrameSequenceReadbackV2,
};

use crate::native_replay_execution_input_binding_v1::NativeReplayExecutionInputBindingReadbackV1;

const SCHEMA_VERSION: u16 = 2;
const FRAME_COUNT: usize = 2;
const MEMBER_COUNT: usize = 2;
const SEQUENCE_DOMAIN: &[u8] = b"rd.native-replay-execution-input-sequence.v2\0";
const BINDING_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding.v2\0";
const RECEIPT_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-receipt.v2\0";
const OUTBOX_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-outbox.v2\0";

/// Fixed canonical sizes. The V2 layout has no variable-length member, so recovery reads exact
/// offsets rather than trusting a length field carried by the stored bytes themselves.
const FRAME_DIGEST_COUNT: usize = 13;
const FRAME_BYTES: usize = FRAME_DIGEST_COUNT * 32 + 16;
const SEQUENCE_BYTES: usize = 32 * 3 + FRAME_COUNT * FRAME_BYTES;
const CANONICAL_BYTES: usize = 5 + 32 + SEQUENCE_BYTES;

/// One complete Owner-verified BAR frame and its native schedule and liquidity receipts.
///
/// The ordinals refer to the Owner's complete native BAR/EVENT order, not caller timestamps.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct VerifiedFrameV2 {
    pit_cut_identity: [u8; 32],
    pit_cut_receipt_digest: [u8; 32],
    frame_identity: [u8; 32],
    frame_receipt_identity: [u8; 32],
    frame_receipt_digest: [u8; 32],
    native_schedule_identity: [u8; 32],
    native_schedule_receipt_identity: [u8; 32],
    native_schedule_receipt_digest: [u8; 32],
    liquidity_event_identity: [u8; 32],
    liquidity_event_receipt_identity: [u8; 32],
    liquidity_event_receipt_digest: [u8; 32],
    member_bar_schedule_receipt_digests: [[u8; 32]; MEMBER_COUNT],
    first_bar_order: u64,
    last_liquidity_event_order: u64,
}

/// A move-only token minted only from a Market Data Owner sequence readback.
///
/// Its fields and constructor are private; no R&D caller can assert a second PIT cut or event.
#[derive(Debug)]
pub(crate) struct VerifiedOwnerSequenceV2 {
    owner_sequence_digest: [u8; 32],
    frames: [VerifiedFrameV2; FRAME_COUNT],
}

/// R&D-side domains. Each names one R&D coordinate derived from Owner-sealed constituents; none
/// of them invents a fact, and none can be produced without the Owner's own sealed digests.
const FRAME_IDENTITY_DOMAIN: &[u8] = b"rd.native-replay-frame-identity.v2\0";
const FRAME_RECEIPT_IDENTITY_DOMAIN: &[u8] = b"rd.native-replay-frame-receipt-identity.v2\0";
const SCHEDULE_IDENTITY_DOMAIN: &[u8] = b"rd.native-replay-native-schedule-identity.v2\0";
const SCHEDULE_RECEIPT_IDENTITY_DOMAIN: &[u8] =
    b"rd.native-replay-native-schedule-receipt-identity.v2\0";
const LIQUIDITY_IDENTITY_DOMAIN: &[u8] = b"rd.native-replay-liquidity-event-identity.v2\0";
const LIQUIDITY_RECEIPT_IDENTITY_DOMAIN: &[u8] =
    b"rd.native-replay-liquidity-event-receipt-identity.v2\0";
const MEMBER_BAR_SCHEDULE_DOMAIN: &[u8] = b"rd.native-replay-member-bar-schedule-receipt.v2\0";

impl VerifiedOwnerSequenceV2 {
    /// Mints the token from one Owner sequence, consuming it.
    ///
    /// The frame-zero bridge is the Owner's own: `seal_native_replay_frame_sequence_v2` binds the
    /// V1 binding identity into the sequence digest, and the Owner's census already refuses a
    /// first frame that is not the one the sealed request fixes. So requiring the sequence to
    /// carry *this* V1 binding identity is what makes frame zero the V1 initial frame - R&D does
    /// not re-derive that claim, and V1's sealed meaning does not change to carry it.
    ///
    /// # Errors
    ///
    /// Returns [`NativeReplayExecutionInputBindingErrorV2::Unavailable`] when the sequence does
    /// not belong to this V1 binding or a frame is missing a sealed constituent.
    pub(crate) fn from_owner_readback(
        v1: &NativeReplayExecutionInputBindingReadbackV1,
        sequence: NativeReplayFrameSequenceReadbackV2,
    ) -> Result<Self, NativeReplayExecutionInputBindingErrorV2> {
        if *sequence.v1_binding_identity().as_bytes() != v1.binding().binding_identity() {
            return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
        }
        let owner_sequence_digest = *sequence.sequence_digest().as_bytes();
        // Consume the Owner token: the caller cannot keep it and offer a second reading.
        let [first, second] = sequence.into_frames();
        let frames = [verified_frame(&first)?, verified_frame(&second)?];
        Ok(Self {
            owner_sequence_digest,
            frames,
        })
    }
}

/// Projects one Owner frame onto the R&D frame coordinates, deriving nothing it was not given.
fn verified_frame(
    frame: &NativeReplayFrameEvidenceV2,
) -> Result<VerifiedFrameV2, NativeReplayExecutionInputBindingErrorV2> {
    let pit_cut_identity = *frame.snapshot_identity().as_bytes();
    let pit_cut_receipt_digest = *frame.snapshot_fact_digest().as_bytes();
    let frame_receipt_digest = *frame.observation_batch_digest().as_bytes();
    let native_schedule_receipt_digest = *frame.scheduling_receipt_digest_v1().as_bytes();
    let liquidity_event_receipt_digest = *frame.liquidity_receipt().receipt_digest().as_bytes();

    let bar_rows = frame.bar_row_digests();
    let mut member_bar_schedule_receipt_digests = [[0u8; 32]; MEMBER_COUNT];

    for (member, rows) in bar_rows.iter().enumerate() {
        let mut bytes = Vec::with_capacity(32 + 8 + 32 * 5);
        bytes.extend_from_slice(&pit_cut_identity);
        bytes.extend_from_slice(&(member as u64).to_le_bytes());
        for row in rows {
            bytes.extend_from_slice(row.as_bytes());
        }
        member_bar_schedule_receipt_digests[member] = digest(MEMBER_BAR_SCHEDULE_DOMAIN, &bytes);
    }

    // The frame's own BAR time opens it; its last sealed liquidity EVENT closes it.
    let first_bar_order = frame.frame_time_ns();
    let last_liquidity_event_order = frame
        .liquidity()
        .iter()
        .map(|member| member.event_time_ns())
        .max()
        .ok_or(NativeReplayExecutionInputBindingErrorV2::Unavailable)?;

    let verified = VerifiedFrameV2 {
        pit_cut_identity,
        pit_cut_receipt_digest,
        frame_identity: digest(
            FRAME_IDENTITY_DOMAIN,
            &[pit_cut_identity, frame_receipt_digest].concat(),
        ),
        frame_receipt_identity: digest(
            FRAME_RECEIPT_IDENTITY_DOMAIN,
            &[
                frame_receipt_digest,
                *frame.source_frontier_digest().as_bytes(),
                *frame.correction_frontier_digest().as_bytes(),
            ]
            .concat(),
        ),
        frame_receipt_digest,
        native_schedule_identity: digest(
            SCHEDULE_IDENTITY_DOMAIN,
            &[native_schedule_receipt_digest, pit_cut_identity].concat(),
        ),
        native_schedule_receipt_identity: digest(
            SCHEDULE_RECEIPT_IDENTITY_DOMAIN,
            &native_schedule_receipt_digest,
        ),
        native_schedule_receipt_digest,
        liquidity_event_identity: digest(
            LIQUIDITY_IDENTITY_DOMAIN,
            &[liquidity_event_receipt_digest, pit_cut_identity].concat(),
        ),
        liquidity_event_receipt_identity: digest(
            LIQUIDITY_RECEIPT_IDENTITY_DOMAIN,
            &liquidity_event_receipt_digest,
        ),
        liquidity_event_receipt_digest,
        member_bar_schedule_receipt_digests,
        first_bar_order,
        last_liquidity_event_order,
    };
    // Reuse the one structural gate rather than a second, drifting copy of it.
    if !valid_frame(&verified) {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    Ok(verified)
}

/// Deterministic meaning of the V2 binding. It does not reinterpret or replace the V1 binding.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingV2 {
    v1_binding_identity: [u8; 32],
    v1_binding_digest: [u8; 32],
    owner_sequence_digest: [u8; 32],
    sequence_digest: [u8; 32],
    frames: [VerifiedFrameV2; FRAME_COUNT],
    binding_identity: [u8; 32],
    canonical_bytes: Vec<u8>,
}

impl NativeReplayExecutionInputBindingV2 {
    #[must_use]
    pub const fn binding_identity(&self) -> [u8; 32] {
        self.binding_identity
    }

    #[must_use]
    pub const fn v1_binding_identity(&self) -> [u8; 32] {
        self.v1_binding_identity
    }

    #[must_use]
    pub const fn v1_binding_digest(&self) -> [u8; 32] {
        self.v1_binding_digest
    }

    #[must_use]
    pub const fn owner_sequence_digest(&self) -> [u8; 32] {
        self.owner_sequence_digest
    }

    #[must_use]
    pub const fn sequence_digest(&self) -> [u8; 32] {
        self.sequence_digest
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// The Owner-sealed BAR/EVENT order boundaries of both frames, in canonical frame order.
    ///
    /// Each entry is `(first_bar_order, last_liquidity_event_order)`. This is the whole of what a
    /// consumer needs to bind an executed frame to the sealed sequence, so the frame coordinates
    /// themselves stay private and cannot be reassembled into a frame the Owner never sealed.
    #[must_use]
    pub fn frame_orders(&self) -> [(u64, u64); FRAME_COUNT] {
        self.frames
            .map(|frame| (frame.first_bar_order, frame.last_liquidity_event_order))
    }

    /// Compare a stored candidate against newly verified V1 and Owner constituents.
    /// The future custody reader must additionally verify its append-only receipt and outbox.
    pub(crate) fn verify_against_owner(
        &self,
        v1: &NativeReplayExecutionInputBindingReadbackV1,
        owner: VerifiedOwnerSequenceV2,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV2> {
        let expected = seal_meaning(
            v1.binding().binding_identity(),
            v1.binding().binding_digest(),
            owner,
        )?;

        if *self != expected {
            return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
        }
        Ok(())
    }
}

/// Structural projection only. A positive durable readback requires the future R&D SQL custody
/// path to check the exact stored binding, receipt and outbox against fresh Owner capabilities.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingReadbackV2 {
    binding: NativeReplayExecutionInputBindingV2,
    receipt_identity: [u8; 32],
    receipt_bytes: Vec<u8>,
    outbox_identity: [u8; 32],
    outbox_payload: Vec<u8>,
}

impl NativeReplayExecutionInputBindingReadbackV2 {
    #[must_use]
    pub const fn binding(&self) -> &NativeReplayExecutionInputBindingV2 {
        &self.binding
    }

    #[must_use]
    pub const fn receipt_identity(&self) -> [u8; 32] {
        self.receipt_identity
    }

    #[must_use]
    pub fn receipt_bytes(&self) -> &[u8] {
        &self.receipt_bytes
    }

    #[must_use]
    pub const fn outbox_identity(&self) -> [u8; 32] {
        self.outbox_identity
    }

    #[must_use]
    pub fn outbox_payload(&self) -> &[u8] {
        &self.outbox_payload
    }
}

#[derive(Debug, Error)]
pub enum NativeReplayExecutionInputBindingErrorV2 {
    #[error("two-frame Native Replay execution-input binding unavailable")]
    Unavailable,
    #[error("two-frame Native Replay execution-input binding custody conflict")]
    Conflict,
    #[error("two-frame Native Replay execution-input binding storage unavailable")]
    Storage(#[source] sqlx::Error),
}

/// Reserved entry point for an adapter holding both exact, typed Owner readbacks.
/// There is intentionally no producer of `VerifiedOwnerSequenceV2` until Market Data issues its
/// complete sequence capability and proves frame zero equals the V1 initial frame.
pub(crate) fn prepare_binding_from_verified_owner_v2(
    v1: &NativeReplayExecutionInputBindingReadbackV1,
    owner: VerifiedOwnerSequenceV2,
) -> Result<NativeReplayExecutionInputBindingReadbackV2, NativeReplayExecutionInputBindingErrorV2> {
    let binding = seal_meaning(
        v1.binding().binding_identity(),
        v1.binding().binding_digest(),
        owner,
    )?;
    let mut receipt_bytes = Vec::with_capacity(4 + 32 * 3);
    receipt_bytes.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    receipt_bytes.extend_from_slice(&0u16.to_le_bytes());
    receipt_bytes.extend_from_slice(&binding.v1_binding_identity);
    receipt_bytes.extend_from_slice(&binding.binding_identity);
    receipt_bytes.extend_from_slice(&binding.sequence_digest);
    let receipt_identity = digest(RECEIPT_DOMAIN, &receipt_bytes);

    let mut outbox_payload = Vec::with_capacity(4 + 32 * 3);
    outbox_payload.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    outbox_payload.extend_from_slice(&0u16.to_le_bytes());
    outbox_payload.extend_from_slice(&binding.v1_binding_identity);
    outbox_payload.extend_from_slice(&binding.binding_identity);
    outbox_payload.extend_from_slice(&receipt_identity);
    let outbox_identity = digest(OUTBOX_DOMAIN, &outbox_payload);

    Ok(NativeReplayExecutionInputBindingReadbackV2 {
        binding,
        receipt_identity,
        receipt_bytes,
        outbox_identity,
        outbox_payload,
    })
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "VerifiedOwnerSequenceV2 is a move-only token; spending it here is the invariant, and \
              borrowing it would let one Owner readback seal two bindings"
)]
fn seal_meaning(
    v1_binding_identity: [u8; 32],
    v1_binding_digest: [u8; 32],
    owner: VerifiedOwnerSequenceV2,
) -> Result<NativeReplayExecutionInputBindingV2, NativeReplayExecutionInputBindingErrorV2> {
    // Destructured whole rather than read field by field: `VerifiedOwnerSequenceV2` is a move-only
    // token, and consuming it here is what makes sealing the one place it can be spent.
    let VerifiedOwnerSequenceV2 {
        owner_sequence_digest,
        frames: [first, second],
    } = owner;

    if v1_binding_identity == [0; 32]
        || v1_binding_identity != v1_binding_digest
        || owner_sequence_digest == [0; 32]
        || first.frame_identity == second.frame_identity
        || first.pit_cut_identity == second.pit_cut_identity
        || !valid_frame(&first)
        || !valid_frame(&second)
        || first.last_liquidity_event_order >= second.first_bar_order
    {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }

    let frames = [first, second];
    let mut sequence_bytes = Vec::with_capacity(32 * 3 + 2 * (32 * 13 + 16));
    sequence_bytes.extend_from_slice(&v1_binding_identity);
    sequence_bytes.extend_from_slice(&v1_binding_digest);
    sequence_bytes.extend_from_slice(&owner_sequence_digest);
    for frame in &frames {
        append_frame(&mut sequence_bytes, frame);
    }
    let sequence_digest = digest(SEQUENCE_DOMAIN, &sequence_bytes);

    let mut canonical_bytes = Vec::with_capacity(5 + 32 + sequence_bytes.len());
    canonical_bytes.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    canonical_bytes.extend_from_slice(&0u16.to_le_bytes());
    canonical_bytes.push(FRAME_COUNT as u8);
    canonical_bytes.extend_from_slice(&sequence_digest);
    canonical_bytes.extend_from_slice(&sequence_bytes);
    let binding_identity = digest(BINDING_DOMAIN, &canonical_bytes);
    Ok(NativeReplayExecutionInputBindingV2 {
        v1_binding_identity,
        v1_binding_digest,
        owner_sequence_digest,
        sequence_digest,
        frames,
        binding_identity,
        canonical_bytes,
    })
}

fn valid_frame(frame: &VerifiedFrameV2) -> bool {
    [
        frame.pit_cut_identity,
        frame.pit_cut_receipt_digest,
        frame.frame_identity,
        frame.frame_receipt_identity,
        frame.frame_receipt_digest,
        frame.native_schedule_identity,
        frame.native_schedule_receipt_identity,
        frame.native_schedule_receipt_digest,
        frame.liquidity_event_identity,
        frame.liquidity_event_receipt_identity,
        frame.liquidity_event_receipt_digest,
        frame.member_bar_schedule_receipt_digests[0],
        frame.member_bar_schedule_receipt_digests[1],
    ]
    .iter()
    .all(|digest| *digest != [0; 32])
        && frame.member_bar_schedule_receipt_digests[0]
            != frame.member_bar_schedule_receipt_digests[1]
        && frame.first_bar_order < frame.last_liquidity_event_order
}

fn append_frame(bytes: &mut Vec<u8>, frame: &VerifiedFrameV2) {
    for value in [
        frame.pit_cut_identity,
        frame.pit_cut_receipt_digest,
        frame.frame_identity,
        frame.frame_receipt_identity,
        frame.frame_receipt_digest,
        frame.native_schedule_identity,
        frame.native_schedule_receipt_identity,
        frame.native_schedule_receipt_digest,
        frame.liquidity_event_identity,
        frame.liquidity_event_receipt_identity,
        frame.liquidity_event_receipt_digest,
        frame.member_bar_schedule_receipt_digests[0],
        frame.member_bar_schedule_receipt_digests[1],
    ] {
        bytes.extend_from_slice(&value);
    }
    bytes.extend_from_slice(&frame.first_bar_order.to_le_bytes());
    bytes.extend_from_slice(&frame.last_liquidity_event_order.to_le_bytes());
}

/// Verifies the Owner sequence against this V1 binding and atomically persists its V2 custody.
///
/// Crate-private for the same reason V1 is: an application caller must not be able to substitute
/// a constituent with locator fields or reconstructed bytes. The sequence is moved in, so the
/// caller cannot retain it and offer a second, differently verified copy.
///
/// # Errors
///
/// Returns `Conflict` when this V1 binding already holds a differently sealed V2 meaning,
/// `Storage` when the transaction fails, and `Unavailable` otherwise.
pub(crate) async fn issue_native_replay_execution_input_binding_v2_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    v1: &NativeReplayExecutionInputBindingReadbackV1,
    sequence: NativeReplayFrameSequenceReadbackV2,
) -> Result<NativeReplayExecutionInputBindingReadbackV2, NativeReplayExecutionInputBindingErrorV2> {
    validate_storage_boundary_v2(transaction).await?;
    let owner = VerifiedOwnerSequenceV2::from_owner_readback(v1, sequence)?;
    let prepared = prepare_binding_from_verified_owner_v2(v1, owner)?;
    let committed_at_epoch_ms = i64::try_from(v1.receipt().committed_at_epoch_ms())
        .map_err(|_| NativeReplayExecutionInputBindingErrorV2::Unavailable)?;

    if let Some(existing) = load_rows_v2(transaction, prepared.binding.v1_binding_identity).await? {
        let readback = recover_rows_v2(&existing)?;
        return if readback == prepared {
            Ok(readback)
        } else {
            Err(NativeReplayExecutionInputBindingErrorV2::Conflict)
        };
    }

    // One statement, so a binding without its receipt and outbox is not a reachable state. The
    // V1 row is locked FOR SHARE: the extended binding cannot be committed against a V1 binding
    // that is changing underneath it.
    let inserted: Option<i64> = sqlx::query_scalar(
        "WITH v1 AS (
           SELECT binding_identity FROM public.rd_native_replay_execution_input_bindings_v1
            WHERE binding_identity=$1 AND binding_digest=$2 FOR SHARE
         ), binding AS (
           INSERT INTO public.rd_native_replay_execution_input_bindings_v2
             (v1_binding_identity,binding_identity,owner_sequence_digest,sequence_digest,canonical_binding_bytes,committed_at_epoch_ms)
           SELECT binding_identity,$3,$4,$5,$6,$7 FROM v1 RETURNING binding_identity,v1_binding_identity
         ), receipt AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_receipts_v2
             (binding_identity,receipt_identity,receipt_digest,canonical_receipt_bytes,committed_at_epoch_ms)
           SELECT binding_identity,$8,$9,$10,$7 FROM binding RETURNING receipt_identity
         ), outbox AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_outbox_v2
             (event_identity,v1_binding_identity,binding_identity,receipt_identity,payload_digest,canonical_payload_bytes,committed_at_epoch_ms)
           SELECT $11,$1,$3,receipt_identity,$12,$13,$7 FROM receipt RETURNING 1
         ) SELECT count(*) FROM outbox",
    )
    .bind(prepared.binding.v1_binding_identity.as_slice())
    .bind(prepared.binding.v1_binding_digest.as_slice())
    .bind(prepared.binding.binding_identity.as_slice())
    .bind(prepared.binding.owner_sequence_digest.as_slice())
    .bind(prepared.binding.sequence_digest.as_slice())
    .bind(prepared.binding.canonical_bytes.as_slice())
    .bind(committed_at_epoch_ms)
    .bind(prepared.receipt_identity.as_slice())
    .bind(digest(RECEIPT_DOMAIN, &prepared.receipt_bytes).as_slice())
    .bind(prepared.receipt_bytes.as_slice())
    .bind(prepared.outbox_identity.as_slice())
    .bind(digest(OUTBOX_DOMAIN, &prepared.outbox_payload).as_slice())
    .bind(prepared.outbox_payload.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV2::Storage)?;
    if inserted != Some(1) {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    Ok(prepared)
}

/// Recovers the unique V2 binding extending one exact V1 binding, or hands back nothing.
///
/// It accepts no binding identity, sequence digest or frame coordinate from the caller, issues
/// nothing that is missing, and never falls back to another V1 binding or a latest row.
///
/// # Errors
///
/// Returns `Storage` when the transaction fails and `Unavailable` when stored custody does not
/// recover to a well-formed binding.
pub(crate) async fn resolve_native_replay_execution_input_binding_for_v1_binding_v2_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    v1_binding_identity: [u8; 32],
) -> Result<
    Option<NativeReplayExecutionInputBindingReadbackV2>,
    NativeReplayExecutionInputBindingErrorV2,
> {
    validate_storage_boundary_v2(transaction).await?;
    let Some(rows) = load_rows_v2(transaction, v1_binding_identity).await? else {
        return Ok(None);
    };
    let readback = recover_rows_v2(&rows)?;
    if readback.binding.v1_binding_identity != v1_binding_identity {
        return Ok(None);
    }
    Ok(Some(readback))
}

#[derive(Debug, Eq, PartialEq)]
struct StoredRowsV2 {
    v1_binding_identity: Vec<u8>,
    binding_identity: Vec<u8>,
    owner_sequence_digest: Vec<u8>,
    sequence_digest: Vec<u8>,
    binding_bytes: Vec<u8>,
    receipt_identity: Vec<u8>,
    receipt_digest: Vec<u8>,
    receipt_bytes: Vec<u8>,
    event_identity: Vec<u8>,
    outbox_binding_identity: Vec<u8>,
    outbox_receipt_identity: Vec<u8>,
    payload_digest: Vec<u8>,
    payload_bytes: Vec<u8>,
}

/// The V2 relations must be `rd_owner`-owned, ordinary, permanent and granted to nobody else.
async fn validate_storage_boundary_v2(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), NativeReplayExecutionInputBindingErrorV2> {
    let valid: bool = sqlx::query_scalar(
        "WITH expected(name) AS (VALUES
           ('rd_native_replay_execution_input_bindings_v2'::text),
           ('rd_native_replay_execution_input_binding_receipts_v2'::text),
           ('rd_native_replay_execution_input_binding_outbox_v2'::text)
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
    .map_err(NativeReplayExecutionInputBindingErrorV2::Storage)?;
    if !valid {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    Ok(())
}

async fn load_rows_v2(
    transaction: &mut Transaction<'_, Postgres>,
    v1_binding_identity: [u8; 32],
) -> Result<Option<StoredRowsV2>, NativeReplayExecutionInputBindingErrorV2> {
    let row = sqlx::query(
        "SELECT b.v1_binding_identity,b.binding_identity,b.owner_sequence_digest,b.sequence_digest,b.canonical_binding_bytes,
                r.receipt_identity,r.receipt_digest,r.canonical_receipt_bytes,
                o.event_identity,o.binding_identity AS outbox_binding_identity,o.receipt_identity AS outbox_receipt_identity,
                o.payload_digest,o.canonical_payload_bytes
           FROM public.rd_native_replay_execution_input_bindings_v2 b
           JOIN public.rd_native_replay_execution_input_binding_receipts_v2 r USING(binding_identity)
           JOIN public.rd_native_replay_execution_input_binding_outbox_v2 o USING(binding_identity)
          WHERE b.v1_binding_identity=$1",
    )
    .bind(v1_binding_identity.as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV2::Storage)?;
    row.map(|row| {
        Ok(StoredRowsV2 {
            v1_binding_identity: row.try_get("v1_binding_identity")?,
            binding_identity: row.try_get("binding_identity")?,
            owner_sequence_digest: row.try_get("owner_sequence_digest")?,
            sequence_digest: row.try_get("sequence_digest")?,
            binding_bytes: row.try_get("canonical_binding_bytes")?,
            receipt_identity: row.try_get("receipt_identity")?,
            receipt_digest: row.try_get("receipt_digest")?,
            receipt_bytes: row.try_get("canonical_receipt_bytes")?,
            event_identity: row.try_get("event_identity")?,
            outbox_binding_identity: row.try_get("outbox_binding_identity")?,
            outbox_receipt_identity: row.try_get("outbox_receipt_identity")?,
            payload_digest: row.try_get("payload_digest")?,
            payload_bytes: row.try_get("canonical_payload_bytes")?,
        })
    })
    .transpose()
    .map_err(NativeReplayExecutionInputBindingErrorV2::Storage)
}

/// Rebuilds the readback from stored bytes and refuses any row that disagrees with them.
///
/// Every stored identity is re-derived from the stored canonical bytes rather than trusted, so a
/// row edited in place cannot present itself as a binding this code would have issued.
fn recover_rows_v2(
    rows: &StoredRowsV2,
) -> Result<NativeReplayExecutionInputBindingReadbackV2, NativeReplayExecutionInputBindingErrorV2> {
    let binding = recover_binding_v2(&rows.binding_bytes)?;
    let prepared_receipt = receipt_bytes_for(&binding);
    let receipt_identity = digest(RECEIPT_DOMAIN, &prepared_receipt);
    let outbox_payload = outbox_payload_for(&binding, receipt_identity);
    let outbox_identity = digest(OUTBOX_DOMAIN, &outbox_payload);

    let agrees = rows.v1_binding_identity == binding.v1_binding_identity
        && rows.binding_identity == binding.binding_identity
        && rows.owner_sequence_digest == binding.owner_sequence_digest
        && rows.sequence_digest == binding.sequence_digest
        && rows.receipt_identity == receipt_identity
        && rows.receipt_bytes == prepared_receipt
        && rows.receipt_digest == digest(RECEIPT_DOMAIN, &prepared_receipt)
        && rows.event_identity == outbox_identity
        && rows.outbox_binding_identity == binding.binding_identity
        && rows.outbox_receipt_identity == receipt_identity
        && rows.payload_bytes == outbox_payload
        && rows.payload_digest == digest(OUTBOX_DOMAIN, &outbox_payload);

    if !agrees {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    Ok(NativeReplayExecutionInputBindingReadbackV2 {
        binding,
        receipt_identity,
        receipt_bytes: prepared_receipt,
        outbox_identity,
        outbox_payload,
    })
}

fn receipt_bytes_for(binding: &NativeReplayExecutionInputBindingV2) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + 32 * 3);
    bytes.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&binding.v1_binding_identity);
    bytes.extend_from_slice(&binding.binding_identity);
    bytes.extend_from_slice(&binding.sequence_digest);
    bytes
}

fn outbox_payload_for(
    binding: &NativeReplayExecutionInputBindingV2,
    receipt_identity: [u8; 32],
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4 + 32 * 3);
    bytes.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&binding.v1_binding_identity);
    bytes.extend_from_slice(&binding.binding_identity);
    bytes.extend_from_slice(&receipt_identity);
    bytes
}

/// Decodes the fixed canonical layout and re-derives every digest it claims.
fn recover_binding_v2(
    bytes: &[u8],
) -> Result<NativeReplayExecutionInputBindingV2, NativeReplayExecutionInputBindingErrorV2> {
    if bytes.len() != CANONICAL_BYTES
        || bytes[0..2] != SCHEMA_VERSION.to_le_bytes()
        || bytes[2..4] != 0u16.to_le_bytes()
        || usize::from(bytes[4]) != FRAME_COUNT
    {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    let mut cursor = Cursor { bytes, at: 5 };
    let sequence_digest = cursor.digest()?;
    let sequence_start = cursor.at;
    let v1_binding_identity = cursor.digest()?;
    let v1_binding_digest = cursor.digest()?;
    let owner_sequence_digest = cursor.digest()?;
    let frames = [cursor.frame()?, cursor.frame()?];

    // The stored digests are claims; recomputing them is what makes the readback a recovery.
    if digest(SEQUENCE_DOMAIN, &bytes[sequence_start..]) != sequence_digest
        || digest(BINDING_DOMAIN, bytes) == [0; 32]
    {
        return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
    }
    Ok(NativeReplayExecutionInputBindingV2 {
        v1_binding_identity,
        v1_binding_digest,
        owner_sequence_digest,
        sequence_digest,
        frames,
        binding_identity: digest(BINDING_DOMAIN, bytes),
        canonical_bytes: bytes.to_vec(),
    })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn take(&mut self, len: usize) -> Result<&[u8], NativeReplayExecutionInputBindingErrorV2> {
        let end = self
            .at
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(NativeReplayExecutionInputBindingErrorV2::Unavailable)?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn digest(&mut self) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV2> {
        self.take(32)?
            .try_into()
            .map_err(|_| NativeReplayExecutionInputBindingErrorV2::Unavailable)
    }

    fn order(&mut self) -> Result<u64, NativeReplayExecutionInputBindingErrorV2> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| NativeReplayExecutionInputBindingErrorV2::Unavailable)?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn frame(&mut self) -> Result<VerifiedFrameV2, NativeReplayExecutionInputBindingErrorV2> {
        let frame = VerifiedFrameV2 {
            pit_cut_identity: self.digest()?,
            pit_cut_receipt_digest: self.digest()?,
            frame_identity: self.digest()?,
            frame_receipt_identity: self.digest()?,
            frame_receipt_digest: self.digest()?,
            native_schedule_identity: self.digest()?,
            native_schedule_receipt_identity: self.digest()?,
            native_schedule_receipt_digest: self.digest()?,
            liquidity_event_identity: self.digest()?,
            liquidity_event_receipt_identity: self.digest()?,
            liquidity_event_receipt_digest: self.digest()?,
            member_bar_schedule_receipt_digests: [self.digest()?, self.digest()?],
            first_bar_order: self.order()?,
            last_liquidity_event_order: self.order()?,
        };

        if !valid_frame(&frame) {
            return Err(NativeReplayExecutionInputBindingErrorV2::Unavailable);
        }
        Ok(frame)
    }
}

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn d(n: u8) -> [u8; 32] {
        [n; 32]
    }

    fn frame(n: u8, bar: u64, liquidity: u64) -> VerifiedFrameV2 {
        VerifiedFrameV2 {
            pit_cut_identity: d(n),
            pit_cut_receipt_digest: d(n + 1),
            frame_identity: d(n + 2),
            frame_receipt_identity: d(n + 3),
            frame_receipt_digest: d(n + 4),
            native_schedule_identity: d(n + 5),
            native_schedule_receipt_identity: d(n + 6),
            native_schedule_receipt_digest: d(n + 7),
            liquidity_event_identity: d(n + 8),
            liquidity_event_receipt_identity: d(n + 9),
            liquidity_event_receipt_digest: d(n + 10),
            member_bar_schedule_receipt_digests: [d(n + 11), d(n + 12)],
            first_bar_order: bar,
            last_liquidity_event_order: liquidity,
        }
    }

    fn owner() -> VerifiedOwnerSequenceV2 {
        VerifiedOwnerSequenceV2 {
            owner_sequence_digest: d(50),
            frames: [frame(1, 10, 19), frame(21, 20, 29)],
        }
    }

    #[rstest]
    fn ordered_sequence_has_stable_canonical_identity_and_distinct_domains() {
        let first = seal_meaning(d(60), d(60), owner()).unwrap();
        let second = seal_meaning(d(60), d(60), owner()).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.canonical_bytes[0..5], [2, 0, 0, 0, 2]);
        assert_ne!(first.sequence_digest, first.binding_identity);
        assert_eq!(
            first.binding_identity,
            digest(BINDING_DOMAIN, first.canonical_bytes())
        );
        assert_eq!(first.canonical_bytes.len(), 5 + 32 + 96 + 2 * (416 + 16));
    }

    #[rstest]
    fn altered_v1_or_owner_receipt_changes_identity() {
        let baseline = seal_meaning(d(60), d(60), owner()).unwrap();
        assert_ne!(baseline, seal_meaning(d(61), d(61), owner()).unwrap());
        let mut changed = owner();
        changed.frames[1].liquidity_event_receipt_digest = d(55);
        assert_ne!(baseline, seal_meaning(d(60), d(60), changed).unwrap());
        let mut changed = owner();
        changed.owner_sequence_digest = d(51);
        assert_ne!(baseline, seal_meaning(d(60), d(60), changed).unwrap());
    }

    #[rstest]
    fn missing_duplicate_reordered_or_interleaved_frames_fail_closed() {
        assert!(matches!(
            seal_meaning([0; 32], [0; 32], owner()),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
        assert!(matches!(
            seal_meaning(d(60), d(61), owner()),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
        let mut missing = owner();
        missing.frames[1].liquidity_event_receipt_digest = [0; 32];
        assert!(matches!(
            seal_meaning(d(60), d(60), missing),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
        let mut duplicate = owner();
        duplicate.frames[1].frame_identity = duplicate.frames[0].frame_identity;
        assert!(matches!(
            seal_meaning(d(60), d(60), duplicate),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
        let mut reordered = owner();
        reordered.frames.swap(0, 1);
        assert!(matches!(
            seal_meaning(d(60), d(60), reordered),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
        let mut interleaved = owner();
        interleaved.frames[0].last_liquidity_event_order = 20;
        assert!(matches!(
            seal_meaning(d(60), d(60), interleaved),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        ));
    }

    /// Recovery must rebuild the exact binding from stored bytes alone.
    #[rstest]
    fn stored_canonical_bytes_recover_to_the_same_binding() {
        let sealed = seal_meaning(d(60), d(60), owner()).unwrap();
        let recovered = recover_binding_v2(sealed.canonical_bytes()).unwrap();
        assert_eq!(recovered, sealed);
        assert_eq!(sealed.canonical_bytes().len(), CANONICAL_BYTES);
    }

    fn stored_rows_for(binding: &NativeReplayExecutionInputBindingV2) -> StoredRowsV2 {
        let receipt_bytes = receipt_bytes_for(binding);
        let receipt_identity = digest(RECEIPT_DOMAIN, &receipt_bytes);
        let payload_bytes = outbox_payload_for(binding, receipt_identity);
        StoredRowsV2 {
            v1_binding_identity: binding.v1_binding_identity.to_vec(),
            binding_identity: binding.binding_identity.to_vec(),
            owner_sequence_digest: binding.owner_sequence_digest.to_vec(),
            sequence_digest: binding.sequence_digest.to_vec(),
            binding_bytes: binding.canonical_bytes.clone(),
            receipt_identity: receipt_identity.to_vec(),
            receipt_digest: digest(RECEIPT_DOMAIN, &receipt_bytes).to_vec(),
            receipt_bytes,
            event_identity: digest(OUTBOX_DOMAIN, &payload_bytes).to_vec(),
            outbox_binding_identity: binding.binding_identity.to_vec(),
            outbox_receipt_identity: receipt_identity.to_vec(),
            payload_digest: digest(OUTBOX_DOMAIN, &payload_bytes).to_vec(),
            payload_bytes,
        }
    }

    #[rstest]
    fn a_complete_consistent_row_set_recovers() {
        let binding = seal_meaning(d(60), d(60), owner()).unwrap();
        let rows = stored_rows_for(&binding);
        let readback = recover_rows_v2(&rows).unwrap();
        assert_eq!(readback.binding(), &binding);
        assert_eq!(readback.receipt_bytes(), rows.receipt_bytes);
        assert_eq!(readback.outbox_payload(), rows.payload_bytes);
    }

    /// A row edited in place must not be able to present itself as issued custody.
    #[rstest]
    fn rows_that_disagree_with_their_own_bytes_fail_closed() {
        let binding = seal_meaning(d(60), d(60), owner()).unwrap();

        for tamper in [
            (|rows: &mut StoredRowsV2| rows.binding_identity = vec![9; 32])
                as fn(&mut StoredRowsV2),
            |rows: &mut StoredRowsV2| rows.sequence_digest = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.owner_sequence_digest = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.v1_binding_identity = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.receipt_identity = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.receipt_digest = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.receipt_bytes = vec![9; 8],
            |rows: &mut StoredRowsV2| rows.event_identity = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.outbox_binding_identity = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.outbox_receipt_identity = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.payload_digest = vec![9; 32],
            |rows: &mut StoredRowsV2| rows.payload_bytes = vec![9; 8],
        ] {
            let mut rows = stored_rows_for(&binding);
            tamper(&mut rows);
            assert!(matches!(
                recover_rows_v2(&rows),
                Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
            ));
        }
    }

    /// The decoder reads exact offsets, so a short, long or mislabelled buffer is not a binding.
    #[rstest]
    fn malformed_canonical_bytes_fail_closed() {
        let sealed = seal_meaning(d(60), d(60), owner()).unwrap();
        let good = sealed.canonical_bytes();

        let mut short = good.to_vec();
        short.pop();
        let mut long = good.to_vec();
        long.push(0);
        let mut wrong_schema = good.to_vec();
        wrong_schema[0] = 3;
        let mut wrong_reserved = good.to_vec();
        wrong_reserved[2] = 1;
        let mut wrong_frame_count = good.to_vec();
        wrong_frame_count[4] = 3;
        // A sequence digest that does not cover the bytes that follow it.
        let mut lying_digest = good.to_vec();
        lying_digest[5] ^= 0xff;
        // A frame whose sealed constituent was zeroed is not a frame.
        let mut zeroed_frame = good.to_vec();
        for byte in &mut zeroed_frame[37 + 96..37 + 96 + 32] {
            *byte = 0;
        }

        for candidate in [
            short,
            long,
            wrong_schema,
            wrong_reserved,
            wrong_frame_count,
            lying_digest,
            zeroed_frame,
            Vec::new(),
        ] {
            assert!(matches!(
                recover_binding_v2(&candidate),
                Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
            ));
        }
    }
}
