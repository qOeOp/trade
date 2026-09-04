//! Durable R0 observation-evidence custody.
//!
//! R0 does not own business meaning or a clock. It seals the exact native Source Binding, PIT,
//! observation-batch, and Shared Time evidence used by a reference-fact decision.

use super::super::source_binding::BindingDigest;

pub(crate) type R0IdentityV1 = BindingDigest;

const VERSION: u16 = 1;
const MAX_LOCATOR_BYTES: usize = 64 * 1024;
const MAX_RECORD_BYTES: usize = 256 * 1024;
const MAX_READBACK_BYTES: usize = 512 * 1024;
pub(crate) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-r0-request.v1\0";
pub(crate) const RECORD_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-r0-record.v1\0";
pub(crate) const CUT_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-r0-cut.v1\0";
pub(crate) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-r0-receipt.v1\0";
pub(crate) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-r0-readback.v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactR0ErrorV1 {
    InvalidRequest,
    CodecMismatch,
    DigestMismatch,
    EvidenceUnavailable,
    EvidenceMismatch,
    RequestConflict,
    UnknownIdentity,
    StoreUnavailable,
    StoreUntrusted,
    CapacityExceeded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedReferenceFactR0RequestV1 {
    pub(crate) request_identity: R0IdentityV1,
    pub(crate) request_meaning_digest: R0IdentityV1,
    pub(crate) pit_locator_bytes: Box<[u8]>,
    pub(crate) source_binding_locator_bytes: Box<[u8]>,
    pub(crate) replay_start_event_ns: i128,
    pub(crate) replay_end_event_ns_exclusive: i128,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) provider_available_ns: i128,
    pub(crate) retrieval_ns: i128,
    pub(crate) correction_publication_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) predecessor_identity: Option<R0IdentityV1>,
    pub(crate) stable_correlation: R0IdentityV1,
}

impl UntrustedReferenceFactR0RequestV1 {
    pub(crate) const fn locator(&self) -> UntrustedReferenceFactR0LocatorV1 {
        UntrustedReferenceFactR0LocatorV1 {
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedReferenceFactR0LocatorV1 {
    pub(crate) request_identity: R0IdentityV1,
    pub(crate) request_meaning_digest: R0IdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticatedReferenceFactR0EvidenceV1 {
    pub(crate) pit_request_identity: R0IdentityV1,
    pub(crate) pit_request_digest: R0IdentityV1,
    pub(crate) pit_snapshot_identity: R0IdentityV1,
    pub(crate) pit_fact_digest: R0IdentityV1,
    pub(crate) pit_outbox_digest: R0IdentityV1,
    pub(crate) observation_batch_digest: R0IdentityV1,
    pub(crate) source_binding_identity: R0IdentityV1,
    pub(crate) source_binding_fact_digest: R0IdentityV1,
    pub(crate) source_binding_outbox_digest: R0IdentityV1,
    pub(crate) source_binding_lineage_root: R0IdentityV1,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_stream_identity: Box<[u8]>,
    pub(crate) source_frontier_cut_identity: Box<[u8]>,
    pub(crate) source_frontier_sequence: u64,
    pub(crate) source_frontier_digest: R0IdentityV1,
    pub(crate) correction_frontier_stream_identity: Box<[u8]>,
    pub(crate) correction_frontier_cut_identity: Box<[u8]>,
    pub(crate) correction_frontier_sequence: u64,
    pub(crate) correction_frontier_digest: R0IdentityV1,
    pub(crate) clock_identity: Box<[u8]>,
    pub(crate) clock_epoch: Box<[u8]>,
    pub(crate) clock_sequence: u64,
    pub(crate) clock_wall_observed: u64,
    pub(crate) clock_decision_cut: u64,
    pub(crate) clock_valid_through: u64,
    pub(crate) clock_head_identity: R0IdentityV1,
    pub(crate) clock_head_digest: R0IdentityV1,
    pub(crate) restart_continuity_digest: R0IdentityV1,
    pub(crate) uncertainty_bound: u64,
    pub(crate) skew_bound: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0RecordV1 {
    pub(crate) request_identity: R0IdentityV1,
    pub(crate) request_meaning_digest: R0IdentityV1,
    pub(crate) evidence: AuthenticatedReferenceFactR0EvidenceV1,
    pub(crate) replay_start_event_ns: i128,
    pub(crate) replay_end_event_ns_exclusive: i128,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) provider_available_ns: i128,
    pub(crate) retrieval_ns: i128,
    pub(crate) correction_publication_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) predecessor_identity: Option<R0IdentityV1>,
    pub(crate) stable_correlation: R0IdentityV1,
    canonical_bytes: Box<[u8]>,
    identity: R0IdentityV1,
}

impl ReferenceFactR0RecordV1 {
    pub(crate) const fn identity(&self) -> R0IdentityV1 {
        self.identity
    }
    pub(crate) const fn digest(&self) -> R0IdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0CutV1 {
    pub(crate) request_identity: R0IdentityV1,
    pub(crate) request_meaning_digest: R0IdentityV1,
    pub(crate) record_identity: R0IdentityV1,
    pub(crate) record_digest: R0IdentityV1,
    canonical_bytes: Box<[u8]>,
    identity: R0IdentityV1,
}

impl ReferenceFactR0CutV1 {
    pub(crate) const fn identity(&self) -> R0IdentityV1 {
        self.identity
    }
    pub(crate) const fn digest(&self) -> R0IdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0ReceiptV1 {
    pub(crate) request_identity: R0IdentityV1,
    pub(crate) request_meaning_digest: R0IdentityV1,
    pub(crate) cut_identity: R0IdentityV1,
    pub(crate) cut_digest: R0IdentityV1,
    pub(crate) store_generation_identity: R0IdentityV1,
    pub(crate) append_sequence: u64,
    pub(crate) stable_correlation: R0IdentityV1,
    canonical_bytes: Box<[u8]>,
    identity: R0IdentityV1,
}

impl ReferenceFactR0ReceiptV1 {
    pub(crate) const fn identity(&self) -> R0IdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0ReadbackV1 {
    record: ReferenceFactR0RecordV1,
    cut: ReferenceFactR0CutV1,
    receipt: ReferenceFactR0ReceiptV1,
    outbox_identity: R0IdentityV1,
    canonical_bytes: Box<[u8]>,
    identity: R0IdentityV1,
}

impl ReferenceFactR0ReadbackV1 {
    pub(crate) const fn record(&self) -> &ReferenceFactR0RecordV1 {
        &self.record
    }
    pub(crate) const fn cut(&self) -> &ReferenceFactR0CutV1 {
        &self.cut
    }
    pub(crate) const fn receipt(&self) -> &ReferenceFactR0ReceiptV1 {
        &self.receipt
    }
    pub(crate) const fn outbox_identity(&self) -> R0IdentityV1 {
        self.outbox_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn identity(&self) -> R0IdentityV1 {
        self.identity
    }
}

pub(crate) fn request_meaning_digest_v1(
    request: &UntrustedReferenceFactR0RequestV1,
) -> Result<R0IdentityV1, ReferenceFactR0ErrorV1> {
    Ok(digest(REQUEST_DOMAIN, &encode_request(request)?))
}

pub(crate) fn issue_record_and_cut_v1(
    request: &UntrustedReferenceFactR0RequestV1,
    evidence: AuthenticatedReferenceFactR0EvidenceV1,
) -> Result<(ReferenceFactR0RecordV1, ReferenceFactR0CutV1), ReferenceFactR0ErrorV1> {
    validate(request, &evidence)?;
    let mut record = ReferenceFactR0RecordV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        evidence,
        replay_start_event_ns: request.replay_start_event_ns,
        replay_end_event_ns_exclusive: request.replay_end_event_ns_exclusive,
        effective_from_ns: request.effective_from_ns,
        effective_until_ns: request.effective_until_ns,
        provider_available_ns: request.provider_available_ns,
        retrieval_ns: request.retrieval_ns,
        correction_publication_ns: request.correction_publication_ns,
        owner_observation_ns: request.owner_observation_ns,
        decision_cut: request.decision_cut,
        predecessor_identity: request.predecessor_identity,
        stable_correlation: request.stable_correlation,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    record.canonical_bytes = encode_record(&record)?;
    record.identity = digest(RECORD_DOMAIN, &record.canonical_bytes);
    let mut cut = ReferenceFactR0CutV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        record_identity: record.identity,
        record_digest: record.identity,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    cut.canonical_bytes = encode_cut(&cut)?;
    cut.identity = digest(CUT_DOMAIN, &cut.canonical_bytes);
    Ok((record, cut))
}

pub(crate) fn issue_readback_v1(
    record: ReferenceFactR0RecordV1,
    cut: ReferenceFactR0CutV1,
    store_generation_identity: R0IdentityV1,
    append_sequence: u64,
) -> Result<ReferenceFactR0ReadbackV1, ReferenceFactR0ErrorV1> {
    if append_sequence == 0
        || !nonzero(store_generation_identity)
        || cut.record_identity != record.identity
    {
        return Err(ReferenceFactR0ErrorV1::StoreUntrusted);
    }
    let mut receipt = ReferenceFactR0ReceiptV1 {
        request_identity: record.request_identity,
        request_meaning_digest: record.request_meaning_digest,
        cut_identity: cut.identity,
        cut_digest: cut.identity,
        store_generation_identity,
        append_sequence,
        stable_correlation: record.stable_correlation,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    receipt.canonical_bytes = encode_receipt(&receipt)?;
    receipt.identity = digest(RECEIPT_DOMAIN, &receipt.canonical_bytes);
    let mut readback = ReferenceFactR0ReadbackV1 {
        record,
        cut,
        outbox_identity: receipt.identity,
        receipt,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    readback.canonical_bytes = encode_readback(&readback)?;
    readback.identity = digest(READBACK_DOMAIN, &readback.canonical_bytes);
    Ok(readback)
}

pub(crate) fn decode_and_verify_readback_v1(
    bytes: &[u8],
) -> Result<ReferenceFactR0ReadbackV1, ReferenceFactR0ErrorV1> {
    let mut d = Decoder::new(bytes, MAX_READBACK_BYTES)?;
    d.header()?;
    let record_identity = d.identity()?;
    let record_bytes = d.bytes(MAX_RECORD_BYTES)?;
    let record = decode_record(&record_bytes)?;
    let cut_identity = d.identity()?;
    let cut_bytes = d.bytes(1024)?;
    let cut = decode_cut(&cut_bytes)?;
    let receipt_identity = d.identity()?;
    let receipt_bytes = d.bytes(1024)?;
    let receipt = decode_receipt(&receipt_bytes)?;
    let outbox_identity = d.identity()?;
    d.done()?;
    if record_identity != record.identity
        || cut_identity != cut.identity
        || receipt_identity != receipt.identity
        || outbox_identity != receipt.identity
        || cut.record_identity != record.identity
        || receipt.cut_identity != cut.identity
        || receipt.request_identity != record.request_identity
        || receipt.request_meaning_digest != record.request_meaning_digest
        || receipt.stable_correlation != record.stable_correlation
    {
        return Err(ReferenceFactR0ErrorV1::DigestMismatch);
    }
    Ok(ReferenceFactR0ReadbackV1 {
        record,
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: bytes.into(),
        identity: digest(READBACK_DOMAIN, bytes),
    })
}

fn validate(
    request: &UntrustedReferenceFactR0RequestV1,
    evidence: &AuthenticatedReferenceFactR0EvidenceV1,
) -> Result<(), ReferenceFactR0ErrorV1> {
    let identities = [
        request.request_identity,
        request.request_meaning_digest,
        request.stable_correlation,
        evidence.pit_request_identity,
        evidence.pit_request_digest,
        evidence.pit_snapshot_identity,
        evidence.pit_fact_digest,
        evidence.pit_outbox_digest,
        evidence.observation_batch_digest,
        evidence.source_binding_identity,
        evidence.source_binding_fact_digest,
        evidence.source_binding_outbox_digest,
        evidence.source_binding_lineage_root,
        evidence.source_frontier_digest,
        evidence.correction_frontier_digest,
        evidence.clock_head_identity,
        evidence.clock_head_digest,
        evidence.restart_continuity_digest,
    ];
    if !identities.into_iter().all(nonzero)
        || request.request_meaning_digest != request_meaning_digest_v1(request)?
        || request.pit_locator_bytes.is_empty()
        || request.source_binding_locator_bytes.is_empty()
        || request.replay_start_event_ns >= request.replay_end_event_ns_exclusive
        || request
            .effective_until_ns
            .is_some_and(|v| v <= request.effective_from_ns)
        || request.provider_available_ns <= 0
        || request.provider_available_ns > request.retrieval_ns
        || request.correction_publication_ns <= 0
        || request.correction_publication_ns > request.retrieval_ns
        || request.retrieval_ns > request.owner_observation_ns
        || request.decision_cut == 0
        || request.decision_cut != evidence.clock_decision_cut
        || request.owner_observation_ns > i128::from(evidence.clock_wall_observed)
        || evidence.clock_identity.is_empty()
        || evidence.clock_epoch.is_empty()
        || evidence.source_frontier_stream_identity.is_empty()
        || evidence.source_frontier_cut_identity.is_empty()
        || evidence.correction_frontier_stream_identity.is_empty()
        || evidence.correction_frontier_cut_identity.is_empty()
        || evidence.clock_sequence == 0
        || evidence.clock_valid_through <= evidence.clock_wall_observed
        || evidence.source_binding_lineage_version == 0
        || evidence.source_frontier_sequence == 0
        || evidence.correction_frontier_sequence == 0
        || evidence.skew_bound == 0
        || evidence.uncertainty_bound > evidence.skew_bound
        || request.predecessor_identity.is_some_and(|v| !nonzero(v))
    {
        return Err(ReferenceFactR0ErrorV1::InvalidRequest);
    }
    Ok(())
}

#[derive(Default)]
struct Encoder(Vec<u8>);
impl Encoder {
    fn header(&mut self) {
        self.u16(VERSION);
        self.u16(0);
    }
    fn raw(&mut self, v: &[u8]) {
        self.0.extend_from_slice(v);
    }
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.raw(&v.to_be_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.raw(&v.to_be_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.raw(&v.to_be_bytes());
    }
    fn i128(&mut self, v: i128) {
        self.raw(&v.to_be_bytes());
    }
    fn identity(&mut self, v: R0IdentityV1) {
        self.raw(v.as_bytes());
    }
    fn optional_identity(&mut self, v: Option<R0IdentityV1>) {
        match v {
            None => self.u8(0),
            Some(v) => {
                self.u8(1);
                self.identity(v);
            }
        }
    }
    fn optional_i128(&mut self, v: Option<i128>) {
        match v {
            None => self.u8(0),
            Some(v) => {
                self.u8(1);
                self.i128(v);
            }
        }
    }
    fn bytes(&mut self, v: &[u8], limit: usize) -> Result<(), ReferenceFactR0ErrorV1> {
        if v.is_empty() || v.len() > limit {
            return Err(ReferenceFactR0ErrorV1::CapacityExceeded);
        }
        self.u32(u32::try_from(v.len()).map_err(|_| ReferenceFactR0ErrorV1::CapacityExceeded)?);
        self.raw(v);
        Ok(())
    }
    fn finish(self, limit: usize) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
        if self.0.is_empty() || self.0.len() > limit {
            Err(ReferenceFactR0ErrorV1::CapacityExceeded)
        } else {
            Ok(self.0.into_boxed_slice())
        }
    }
}

fn encode_request(
    v: &UntrustedReferenceFactR0RequestV1,
) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.bytes(&v.pit_locator_bytes, MAX_LOCATOR_BYTES)?;
    e.bytes(&v.source_binding_locator_bytes, MAX_LOCATOR_BYTES)?;
    encode_claim_tail(&mut e, ClaimTailV1::from(v));
    e.finish(MAX_RECORD_BYTES)
}

#[derive(Clone, Copy)]
struct ClaimTailV1 {
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    predecessor_identity: Option<R0IdentityV1>,
    stable_correlation: R0IdentityV1,
}

impl From<&UntrustedReferenceFactR0RequestV1> for ClaimTailV1 {
    fn from(value: &UntrustedReferenceFactR0RequestV1) -> Self {
        Self {
            replay_start_event_ns: value.replay_start_event_ns,
            replay_end_event_ns_exclusive: value.replay_end_event_ns_exclusive,
            effective_from_ns: value.effective_from_ns,
            effective_until_ns: value.effective_until_ns,
            provider_available_ns: value.provider_available_ns,
            retrieval_ns: value.retrieval_ns,
            correction_publication_ns: value.correction_publication_ns,
            owner_observation_ns: value.owner_observation_ns,
            decision_cut: value.decision_cut,
            predecessor_identity: value.predecessor_identity,
            stable_correlation: value.stable_correlation,
        }
    }
}

impl From<&ReferenceFactR0RecordV1> for ClaimTailV1 {
    fn from(value: &ReferenceFactR0RecordV1) -> Self {
        Self {
            replay_start_event_ns: value.replay_start_event_ns,
            replay_end_event_ns_exclusive: value.replay_end_event_ns_exclusive,
            effective_from_ns: value.effective_from_ns,
            effective_until_ns: value.effective_until_ns,
            provider_available_ns: value.provider_available_ns,
            retrieval_ns: value.retrieval_ns,
            correction_publication_ns: value.correction_publication_ns,
            owner_observation_ns: value.owner_observation_ns,
            decision_cut: value.decision_cut,
            predecessor_identity: value.predecessor_identity,
            stable_correlation: value.stable_correlation,
        }
    }
}

fn encode_claim_tail(encoder: &mut Encoder, claim: ClaimTailV1) {
    encoder.i128(claim.replay_start_event_ns);
    encoder.i128(claim.replay_end_event_ns_exclusive);
    encoder.i128(claim.effective_from_ns);
    encoder.optional_i128(claim.effective_until_ns);
    encoder.i128(claim.provider_available_ns);
    encoder.i128(claim.retrieval_ns);
    encoder.i128(claim.correction_publication_ns);
    encoder.i128(claim.owner_observation_ns);
    encoder.u64(claim.decision_cut);
    encoder.optional_identity(claim.predecessor_identity);
    encoder.identity(claim.stable_correlation);
}
fn encode_evidence(
    e: &mut Encoder,
    v: &AuthenticatedReferenceFactR0EvidenceV1,
) -> Result<(), ReferenceFactR0ErrorV1> {
    for x in [
        v.pit_request_identity,
        v.pit_request_digest,
        v.pit_snapshot_identity,
        v.pit_fact_digest,
        v.pit_outbox_digest,
        v.observation_batch_digest,
        v.source_binding_identity,
        v.source_binding_fact_digest,
        v.source_binding_outbox_digest,
        v.source_binding_lineage_root,
    ] {
        e.identity(x);
    }
    e.u64(v.source_binding_lineage_version);
    e.bytes(&v.source_frontier_stream_identity, MAX_LOCATOR_BYTES)?;
    e.bytes(&v.source_frontier_cut_identity, MAX_LOCATOR_BYTES)?;
    e.u64(v.source_frontier_sequence);
    e.identity(v.source_frontier_digest);
    e.bytes(&v.correction_frontier_stream_identity, MAX_LOCATOR_BYTES)?;
    e.bytes(&v.correction_frontier_cut_identity, MAX_LOCATOR_BYTES)?;
    e.u64(v.correction_frontier_sequence);
    e.identity(v.correction_frontier_digest);
    e.bytes(&v.clock_identity, MAX_LOCATOR_BYTES)?;
    e.bytes(&v.clock_epoch, MAX_LOCATOR_BYTES)?;
    e.u64(v.clock_sequence);
    e.u64(v.clock_wall_observed);
    e.u64(v.clock_decision_cut);
    e.u64(v.clock_valid_through);
    e.identity(v.clock_head_identity);
    e.identity(v.clock_head_digest);
    e.identity(v.restart_continuity_digest);
    e.u64(v.uncertainty_bound);
    e.u64(v.skew_bound);
    Ok(())
}
fn encode_record(v: &ReferenceFactR0RecordV1) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(v.request_identity);
    e.identity(v.request_meaning_digest);
    encode_evidence(&mut e, &v.evidence)?;
    encode_claim_tail(&mut e, ClaimTailV1::from(v));
    e.finish(MAX_RECORD_BYTES)
}
fn encode_cut(v: &ReferenceFactR0CutV1) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(v.request_identity);
    e.identity(v.request_meaning_digest);
    e.u32(1);
    e.identity(v.record_identity);
    e.identity(v.record_digest);
    e.u32(0);
    e.finish(1024)
}
fn encode_receipt(v: &ReferenceFactR0ReceiptV1) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
    let mut e = Encoder::default();
    e.header();
    for x in [
        v.request_identity,
        v.request_meaning_digest,
        v.cut_identity,
        v.cut_digest,
        v.store_generation_identity,
    ] {
        e.identity(x);
    }
    e.u64(v.append_sequence);
    e.identity(v.stable_correlation);
    e.finish(1024)
}
fn encode_readback(v: &ReferenceFactR0ReadbackV1) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(v.record.identity);
    e.bytes(&v.record.canonical_bytes, MAX_RECORD_BYTES)?;
    e.identity(v.cut.identity);
    e.bytes(&v.cut.canonical_bytes, 1024)?;
    e.identity(v.receipt.identity);
    e.bytes(&v.receipt.canonical_bytes, 1024)?;
    e.identity(v.outbox_identity);
    e.finish(MAX_READBACK_BYTES)
}

struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8], limit: usize) -> Result<Self, ReferenceFactR0ErrorV1> {
        if bytes.is_empty() || bytes.len() > limit {
            Err(ReferenceFactR0ErrorV1::CapacityExceeded)
        } else {
            Ok(Self { bytes, cursor: 0 })
        }
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N], ReferenceFactR0ErrorV1> {
        let end = self
            .cursor
            .checked_add(N)
            .ok_or(ReferenceFactR0ErrorV1::CodecMismatch)?;
        let v = self
            .bytes
            .get(self.cursor..end)
            .ok_or(ReferenceFactR0ErrorV1::CodecMismatch)?
            .try_into()
            .map_err(|_| ReferenceFactR0ErrorV1::CodecMismatch)?;
        self.cursor = end;
        Ok(v)
    }
    fn u8(&mut self) -> Result<u8, ReferenceFactR0ErrorV1> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, ReferenceFactR0ErrorV1> {
        Ok(u16::from_be_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, ReferenceFactR0ErrorV1> {
        Ok(u32::from_be_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, ReferenceFactR0ErrorV1> {
        Ok(u64::from_be_bytes(self.take()?))
    }
    fn i128(&mut self) -> Result<i128, ReferenceFactR0ErrorV1> {
        Ok(i128::from_be_bytes(self.take()?))
    }
    fn identity(&mut self) -> Result<R0IdentityV1, ReferenceFactR0ErrorV1> {
        Ok(R0IdentityV1::from_untrusted_bytes(self.take()?))
    }
    fn optional_identity(&mut self) -> Result<Option<R0IdentityV1>, ReferenceFactR0ErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(ReferenceFactR0ErrorV1::CodecMismatch),
        }
    }
    fn optional_i128(&mut self) -> Result<Option<i128>, ReferenceFactR0ErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(ReferenceFactR0ErrorV1::CodecMismatch),
        }
    }
    fn bytes(&mut self, limit: usize) -> Result<Box<[u8]>, ReferenceFactR0ErrorV1> {
        let n =
            usize::try_from(self.u32()?).map_err(|_| ReferenceFactR0ErrorV1::CapacityExceeded)?;
        if n == 0 || n > limit {
            return Err(ReferenceFactR0ErrorV1::CapacityExceeded);
        }
        let end = self
            .cursor
            .checked_add(n)
            .ok_or(ReferenceFactR0ErrorV1::CodecMismatch)?;
        let v = self
            .bytes
            .get(self.cursor..end)
            .ok_or(ReferenceFactR0ErrorV1::CodecMismatch)?
            .into();
        self.cursor = end;
        Ok(v)
    }
    fn header(&mut self) -> Result<(), ReferenceFactR0ErrorV1> {
        if self.u16()? == VERSION && self.u16()? == 0 {
            Ok(())
        } else {
            Err(ReferenceFactR0ErrorV1::CodecMismatch)
        }
    }
    fn done(&self) -> Result<(), ReferenceFactR0ErrorV1> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(ReferenceFactR0ErrorV1::CodecMismatch)
        }
    }
}

fn decode_evidence(
    d: &mut Decoder<'_>,
) -> Result<AuthenticatedReferenceFactR0EvidenceV1, ReferenceFactR0ErrorV1> {
    Ok(AuthenticatedReferenceFactR0EvidenceV1 {
        pit_request_identity: d.identity()?,
        pit_request_digest: d.identity()?,
        pit_snapshot_identity: d.identity()?,
        pit_fact_digest: d.identity()?,
        pit_outbox_digest: d.identity()?,
        observation_batch_digest: d.identity()?,
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_outbox_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        source_frontier_stream_identity: d.bytes(MAX_LOCATOR_BYTES)?,
        source_frontier_cut_identity: d.bytes(MAX_LOCATOR_BYTES)?,
        source_frontier_sequence: d.u64()?,
        source_frontier_digest: d.identity()?,
        correction_frontier_stream_identity: d.bytes(MAX_LOCATOR_BYTES)?,
        correction_frontier_cut_identity: d.bytes(MAX_LOCATOR_BYTES)?,
        correction_frontier_sequence: d.u64()?,
        correction_frontier_digest: d.identity()?,
        clock_identity: d.bytes(MAX_LOCATOR_BYTES)?,
        clock_epoch: d.bytes(MAX_LOCATOR_BYTES)?,
        clock_sequence: d.u64()?,
        clock_wall_observed: d.u64()?,
        clock_decision_cut: d.u64()?,
        clock_valid_through: d.u64()?,
        clock_head_identity: d.identity()?,
        clock_head_digest: d.identity()?,
        restart_continuity_digest: d.identity()?,
        uncertainty_bound: d.u64()?,
        skew_bound: d.u64()?,
    })
}
fn decode_record(bytes: &[u8]) -> Result<ReferenceFactR0RecordV1, ReferenceFactR0ErrorV1> {
    let mut d = Decoder::new(bytes, MAX_RECORD_BYTES)?;
    d.header()?;
    let mut v = ReferenceFactR0RecordV1 {
        request_identity: d.identity()?,
        request_meaning_digest: d.identity()?,
        evidence: decode_evidence(&mut d)?,
        replay_start_event_ns: d.i128()?,
        replay_end_event_ns_exclusive: d.i128()?,
        effective_from_ns: d.i128()?,
        effective_until_ns: d.optional_i128()?,
        provider_available_ns: d.i128()?,
        retrieval_ns: d.i128()?,
        correction_publication_ns: d.i128()?,
        owner_observation_ns: d.i128()?,
        decision_cut: d.u64()?,
        predecessor_identity: d.optional_identity()?,
        stable_correlation: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(RECORD_DOMAIN, bytes),
    };
    d.done()?;
    if !validate_record(&v) {
        return Err(ReferenceFactR0ErrorV1::CodecMismatch);
    }
    v.canonical_bytes = bytes.into();
    Ok(v)
}
fn validate_record(value: &ReferenceFactR0RecordV1) -> bool {
    let evidence = &value.evidence;
    let identities = [
        value.request_identity,
        value.request_meaning_digest,
        value.stable_correlation,
        evidence.pit_request_identity,
        evidence.pit_request_digest,
        evidence.pit_snapshot_identity,
        evidence.pit_fact_digest,
        evidence.pit_outbox_digest,
        evidence.observation_batch_digest,
        evidence.source_binding_identity,
        evidence.source_binding_fact_digest,
        evidence.source_binding_outbox_digest,
        evidence.source_binding_lineage_root,
        evidence.source_frontier_digest,
        evidence.correction_frontier_digest,
        evidence.clock_head_identity,
        evidence.clock_head_digest,
        evidence.restart_continuity_digest,
    ];
    identities.into_iter().all(nonzero)
        && value.predecessor_identity.is_none_or(nonzero)
        && value.replay_start_event_ns < value.replay_end_event_ns_exclusive
        && value
            .effective_until_ns
            .is_none_or(|until| until > value.effective_from_ns)
        && value.decision_cut == evidence.clock_decision_cut
        && value.owner_observation_ns <= i128::from(evidence.clock_wall_observed)
        && value.receipt_safe()
        && evidence.source_binding_lineage_version > 0
        && !evidence.source_frontier_stream_identity.is_empty()
        && !evidence.source_frontier_cut_identity.is_empty()
        && evidence.source_frontier_sequence > 0
        && !evidence.correction_frontier_stream_identity.is_empty()
        && !evidence.correction_frontier_cut_identity.is_empty()
        && evidence.correction_frontier_sequence > 0
        && !evidence.clock_identity.is_empty()
        && !evidence.clock_epoch.is_empty()
        && evidence.clock_sequence > 0
        && evidence.clock_valid_through > evidence.clock_wall_observed
        && evidence.skew_bound > 0
        && evidence.uncertainty_bound <= evidence.skew_bound
}
impl ReferenceFactR0RecordV1 {
    fn receipt_safe(&self) -> bool {
        self.provider_available_ns > 0
            && self.provider_available_ns <= self.retrieval_ns
            && self.correction_publication_ns > 0
            && self.correction_publication_ns <= self.retrieval_ns
            && self.retrieval_ns <= self.owner_observation_ns
    }
}
fn decode_cut(bytes: &[u8]) -> Result<ReferenceFactR0CutV1, ReferenceFactR0ErrorV1> {
    let mut d = Decoder::new(bytes, 1024)?;
    d.header()?;
    let v = ReferenceFactR0CutV1 {
        request_identity: d.identity()?,
        request_meaning_digest: d.identity()?,
        record_identity: {
            if d.u32()? != 1 {
                return Err(ReferenceFactR0ErrorV1::CodecMismatch);
            }
            d.identity()?
        },
        record_digest: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(CUT_DOMAIN, bytes),
    };
    if d.u32()? != 0 || v.record_identity != v.record_digest {
        return Err(ReferenceFactR0ErrorV1::CodecMismatch);
    }
    d.done()?;
    Ok(v)
}
fn decode_receipt(bytes: &[u8]) -> Result<ReferenceFactR0ReceiptV1, ReferenceFactR0ErrorV1> {
    let mut d = Decoder::new(bytes, 1024)?;
    d.header()?;
    let v = ReferenceFactR0ReceiptV1 {
        request_identity: d.identity()?,
        request_meaning_digest: d.identity()?,
        cut_identity: d.identity()?,
        cut_digest: d.identity()?,
        store_generation_identity: d.identity()?,
        append_sequence: d.u64()?,
        stable_correlation: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(RECEIPT_DOMAIN, bytes),
    };
    d.done()?;
    if v.cut_identity != v.cut_digest || v.append_sequence == 0 {
        return Err(ReferenceFactR0ErrorV1::CodecMismatch);
    }
    Ok(v)
}
fn nonzero(v: R0IdentityV1) -> bool {
    v.as_bytes() != &[0; 32]
}
fn zero() -> R0IdentityV1 {
    R0IdentityV1::from_untrusted_bytes([0; 32])
}
fn digest(domain: &[u8], bytes: &[u8]) -> R0IdentityV1 {
    let mut h = blake3::Hasher::new();
    h.update(domain);
    h.update(bytes);
    R0IdentityV1::from_untrusted_bytes(*h.finalize().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn id(byte: u8) -> R0IdentityV1 {
        R0IdentityV1::from_untrusted_bytes([byte; 32])
    }

    fn request() -> UntrustedReferenceFactR0RequestV1 {
        let mut request = UntrustedReferenceFactR0RequestV1 {
            request_identity: id(1),
            request_meaning_digest: id(2),
            pit_locator_bytes: vec![1].into(),
            source_binding_locator_bytes: vec![2].into(),
            replay_start_event_ns: 50,
            replay_end_event_ns_exclusive: 51,
            effective_from_ns: 50,
            effective_until_ns: Some(51),
            provider_available_ns: 90,
            retrieval_ns: 92,
            correction_publication_ns: 91,
            owner_observation_ns: 100,
            decision_cut: 100,
            predecessor_identity: None,
            stable_correlation: id(3),
        };
        request.request_meaning_digest = request_meaning_digest_v1(&request).unwrap();
        request
    }

    fn evidence() -> AuthenticatedReferenceFactR0EvidenceV1 {
        AuthenticatedReferenceFactR0EvidenceV1 {
            pit_request_identity: id(4),
            pit_request_digest: id(5),
            pit_snapshot_identity: id(6),
            pit_fact_digest: id(7),
            pit_outbox_digest: id(8),
            observation_batch_digest: id(9),
            source_binding_identity: id(10),
            source_binding_fact_digest: id(11),
            source_binding_outbox_digest: id(12),
            source_binding_lineage_root: id(13),
            source_binding_lineage_version: 1,
            source_frontier_stream_identity: b"source-stream".as_slice().into(),
            source_frontier_cut_identity: b"source-cut".as_slice().into(),
            source_frontier_sequence: 1,
            source_frontier_digest: id(14),
            correction_frontier_stream_identity: b"correction-stream".as_slice().into(),
            correction_frontier_cut_identity: b"correction-cut".as_slice().into(),
            correction_frontier_sequence: 1,
            correction_frontier_digest: id(15),
            clock_identity: b"clock".as_slice().into(),
            clock_epoch: b"epoch".as_slice().into(),
            clock_sequence: 1,
            clock_wall_observed: 100,
            clock_decision_cut: 100,
            clock_valid_through: 160,
            clock_head_identity: id(16),
            clock_head_digest: id(17),
            restart_continuity_digest: id(18),
            uncertainty_bound: 1,
            skew_bound: 2,
        }
    }

    #[rstest]
    fn durable_r0_round_trip_rehashes_complete_aggregate() {
        let request = request();
        let (record, cut) = issue_record_and_cut_v1(&request, evidence()).unwrap();
        let readback = issue_readback_v1(record, cut, id(19), 1).unwrap();
        let recovered = decode_and_verify_readback_v1(readback.canonical_bytes()).unwrap();
        assert_eq!(recovered, readback);
        assert_eq!(recovered.outbox_identity(), recovered.receipt().identity());
    }

    #[rstest]
    fn request_meaning_binds_every_repeated_scalar() {
        let request = request();
        for changed in [
            {
                let mut value = request.clone();
                value.provider_available_ns -= 1;
                value
            },
            {
                let mut value = request.clone();
                value.owner_observation_ns -= 1;
                value
            },
            {
                let mut value = request.clone();
                value.decision_cut -= 1;
                value
            },
        ] {
            assert_ne!(
                request_meaning_digest_v1(&request).unwrap(),
                request_meaning_digest_v1(&changed).unwrap()
            );
        }
    }
}
