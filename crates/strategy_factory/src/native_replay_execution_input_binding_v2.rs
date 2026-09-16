//! Additive, structural R&D binding for an Owner-sealed two-frame Native Replay sequence.
//!
//! This module deliberately has no caller-facing constructor or deserializer. The Market Data
//! `NativeReplayFrameSequenceReadbackV2` capability and its first-frame equality bridge are not
//! yet available; only that typed Owner adapter may eventually mint `VerifiedOwnerSequenceV2`.
//! A structurally valid digest is never an Owner readback or durable R&D custody by itself.

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::native_replay_execution_input_binding_v1::NativeReplayExecutionInputBindingReadbackV1;

const SCHEMA_VERSION: u16 = 2;
const FRAME_COUNT: usize = 2;
const MEMBER_COUNT: usize = 2;
const SEQUENCE_DOMAIN: &[u8] = b"rd.native-replay-execution-input-sequence.v2\0";
const BINDING_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding.v2\0";
const RECEIPT_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-receipt.v2\0";

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

/// A move-only token reserved for the future typed Market Data Owner adapter.
///
/// Its fields and constructor are private; no R&D caller can assert a second PIT cut or event.
#[derive(Debug)]
pub(crate) struct VerifiedOwnerSequenceV2 {
    owner_sequence_digest: [u8; 32],
    frames: [VerifiedFrameV2; FRAME_COUNT],
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
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum NativeReplayExecutionInputBindingErrorV2 {
    #[error("two-frame Native Replay execution-input binding unavailable")]
    Unavailable,
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
    Ok(NativeReplayExecutionInputBindingReadbackV2 {
        binding,
        receipt_identity,
        receipt_bytes,
    })
}

fn seal_meaning(
    v1_binding_identity: [u8; 32],
    v1_binding_digest: [u8; 32],
    owner: VerifiedOwnerSequenceV2,
) -> Result<NativeReplayExecutionInputBindingV2, NativeReplayExecutionInputBindingErrorV2> {
    let [first, second] = owner.frames;
    if v1_binding_identity == [0; 32]
        || v1_binding_identity != v1_binding_digest
        || owner.owner_sequence_digest == [0; 32]
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
    sequence_bytes.extend_from_slice(&owner.owner_sequence_digest);
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
        owner_sequence_digest: owner.owner_sequence_digest,
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

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
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

    #[test]
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

    #[test]
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

    #[test]
    fn missing_duplicate_reordered_or_interleaved_frames_fail_closed() {
        assert_eq!(
            seal_meaning([0; 32], [0; 32], owner()),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
        assert_eq!(
            seal_meaning(d(60), d(61), owner()),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
        let mut missing = owner();
        missing.frames[1].liquidity_event_receipt_digest = [0; 32];
        assert_eq!(
            seal_meaning(d(60), d(60), missing),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
        let mut duplicate = owner();
        duplicate.frames[1].frame_identity = duplicate.frames[0].frame_identity;
        assert_eq!(
            seal_meaning(d(60), d(60), duplicate),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
        let mut reordered = owner();
        reordered.frames.swap(0, 1);
        assert_eq!(
            seal_meaning(d(60), d(60), reordered),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
        let mut interleaved = owner();
        interleaved.frames[0].last_liquidity_event_order = 20;
        assert_eq!(
            seal_meaning(d(60), d(60), interleaved),
            Err(NativeReplayExecutionInputBindingErrorV2::Unavailable)
        );
    }
}
