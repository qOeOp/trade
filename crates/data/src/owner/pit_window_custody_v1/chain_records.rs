//! The records a PIT window custody keeps once per chain (slice T0-4c): the chain's Reference
//! Fact R0 record and cut, the frame R0 every frame computes from it on read, and the chain's
//! Market Semantics fact.
//!
//! The snapshot path keeps one R0 record and one Market Semantics fact per PIT snapshot, each
//! naming the snapshot, batch and outbox that prove it. A custody chain has no snapshot: its root's
//! commit mints these records over the whole window, in the same transaction, and a successor
//! restates the root's basis and writes none. A frame's R0 is never stored; it is computed from the
//! chain record, its window schedule and `e_k`, and inherits the chain record's time evidence.

#![allow(
    dead_code,
    reason = "the chain records are read by the custody's derived view (slice T0-5), not built yet"
)]

use sha2::{Digest as _, Sha256};

use super::{
    authority::{DerivedCustodyV1, put_market_semantics_value},
    schedule::PitWindowScheduleFactV1,
};
use crate::owner::{
    declared_bar_timeframe_v1::r0_window_end_over_v1,
    market_semantics::{
        MarketSemanticsPriceAdjustmentV1, MarketSemanticsTimestampBasisV1, MarketSemanticsValueV1,
    },
    source_binding::{
        BindingDigest, MarketDataClockAdmission, UntrustedCompleteFrontier,
        UntrustedSourceBarTimeframeV1,
    },
};

const R0_RECORD_DOMAIN: &[u8] = b"market-data.pit-window-r0-chain-record.v1\0";
const R0_CUT_DOMAIN: &[u8] = b"market-data.pit-window-r0-chain-cut.v1\0";
const FRAME_R0_DOMAIN: &[u8] = b"market-data.pit-window-frame-r0.v1\0";
const MARKET_SEMANTICS_FACT_DOMAIN: &[u8] =
    b"market-data.pit-window-market-semantics-chain-fact.v1\0";

/// The Owner clock a chain's records are minted under: the custody's minting clock.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChainClockEvidenceV1 {
    pub(crate) clock_identity: String,
    pub(crate) clock_epoch: String,
    pub(crate) monotonic_sequence: u64,
    pub(crate) wall_observed: u64,
    pub(crate) decision_cut: u64,
    pub(crate) valid_through: u64,
    pub(crate) restart_continuity_digest: BindingDigest,
    pub(crate) uncertainty_bound: u64,
    pub(crate) skew_bound: u64,
}

impl ChainClockEvidenceV1 {
    pub(crate) fn of(clock: &MarketDataClockAdmission) -> Self {
        Self {
            clock_identity: clock.clock_identity.clone(),
            clock_epoch: clock.clock_epoch.clone(),
            monotonic_sequence: clock.monotonic_sequence,
            wall_observed: clock.wall_observed,
            decision_cut: clock.decision_cut,
            valid_through: clock.valid_through,
            restart_continuity_digest: clock.restart_continuity_digest,
            uncertainty_bound: clock.uncertainty_bound,
            skew_bound: clock.skew_bound,
        }
    }
}

/// The R0 a custody chain's root commit records over its whole window.
///
/// Its evidence names the chain, its root custody, rule and basis, the Source Binding and both
/// frontiers, and the minting clock; it names no snapshot, batch or outbox. Its window runs from
/// the custody window's start to the end of the R0 its last frame would claim, so every frame's R0
/// lies inside it by construction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0ChainRecordV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) root_custody_identity: BindingDigest,
    pub(crate) rule_digest: BindingDigest,
    pub(crate) basis_digest: BindingDigest,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_fact_digest: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier: UntrustedCompleteFrontier,
    pub(crate) correction_frontier: UntrustedCompleteFrontier,
    pub(crate) clock: ChainClockEvidenceV1,
    pub(crate) window_start_ns: u64,
    pub(crate) window_end_ns_exclusive: u64,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl ReferenceFactR0ChainRecordV1 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

/// The cut a chain's R0 record is read through.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactR0ChainCutV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) record_identity: BindingDigest,
    pub(crate) window_start_ns: u64,
    pub(crate) window_end_ns_exclusive: u64,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl ReferenceFactR0ChainCutV1 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

/// The chain R0 record and cut a root custody mints, `None` when its window holds no R0 end.
pub(crate) fn issue_r0_chain_record_v1(
    derived: &DerivedCustodyV1,
    chain_root: BindingDigest,
    root_custody_identity: BindingDigest,
    clock: &MarketDataClockAdmission,
) -> Option<(ReferenceFactR0ChainRecordV1, ReferenceFactR0ChainCutV1)> {
    let window_end = r0_window_end_over_v1(
        i128::from(derived.last_execution_frame_ns()),
        &derived.binding.bar_timeframes,
        derived.input_labels(),
    )?;
    let record = seal_r0_record(ReferenceFactR0ChainRecordV1 {
        chain_root,
        root_custody_identity,
        rule_digest: derived.rule_digest,
        basis_digest: derived.basis_digest,
        source_binding_identity: derived.binding.binding_id,
        source_binding_fact_digest: derived.binding.fact_digest,
        source_binding_lineage_root: derived.binding.lineage_root,
        source_binding_lineage_version: derived.binding.lineage_version,
        source_frontier: derived.binding.source_frontier.clone(),
        correction_frontier: derived.binding.correction_frontier.clone(),
        clock: ChainClockEvidenceV1::of(clock),
        window_start_ns: derived.window.0,
        window_end_ns_exclusive: u64::try_from(window_end).ok()?,
        canonical_bytes: Vec::new(),
        identity: zero(),
    })?;
    let cut = seal_r0_cut(ReferenceFactR0ChainCutV1 {
        chain_root,
        record_identity: record.identity,
        window_start_ns: record.window_start_ns,
        window_end_ns_exclusive: record.window_end_ns_exclusive,
        canonical_bytes: Vec::new(),
        identity: zero(),
    })?;
    Some((record, cut))
}

fn seal_r0_record(
    mut record: ReferenceFactR0ChainRecordV1,
) -> Option<ReferenceFactR0ChainRecordV1> {
    if record.window_start_ns >= record.window_end_ns_exclusive
        || [record.chain_root, record.root_custody_identity].contains(&zero())
    {
        return None;
    }
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);

    for digest in [
        record.chain_root,
        record.root_custody_identity,
        record.rule_digest,
        record.basis_digest,
        record.source_binding_identity,
        record.source_binding_fact_digest,
        record.source_binding_lineage_root,
    ] {
        bytes.extend_from_slice(digest.as_bytes());
    }
    put_u64(&mut bytes, record.source_binding_lineage_version);
    put_frontier(&mut bytes, &record.source_frontier);
    put_frontier(&mut bytes, &record.correction_frontier);
    put_text(&mut bytes, &record.clock.clock_identity);
    put_text(&mut bytes, &record.clock.clock_epoch);
    for value in [
        record.clock.monotonic_sequence,
        record.clock.wall_observed,
        record.clock.decision_cut,
        record.clock.valid_through,
    ] {
        put_u64(&mut bytes, value);
    }
    bytes.extend_from_slice(record.clock.restart_continuity_digest.as_bytes());
    put_u64(&mut bytes, record.clock.uncertainty_bound);
    put_u64(&mut bytes, record.clock.skew_bound);
    put_u64(&mut bytes, record.window_start_ns);
    put_u64(&mut bytes, record.window_end_ns_exclusive);
    record.identity = sha256(R0_RECORD_DOMAIN, &bytes);
    record.canonical_bytes = bytes;
    Some(record)
}

fn seal_r0_cut(mut cut: ReferenceFactR0ChainCutV1) -> Option<ReferenceFactR0ChainCutV1> {
    if cut.window_start_ns >= cut.window_end_ns_exclusive {
        return None;
    }
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    bytes.extend_from_slice(cut.chain_root.as_bytes());
    bytes.extend_from_slice(cut.record_identity.as_bytes());
    put_u64(&mut bytes, cut.window_start_ns);
    put_u64(&mut bytes, cut.window_end_ns_exclusive);
    cut.identity = sha256(R0_CUT_DOMAIN, &bytes);
    cut.canonical_bytes = bytes;
    Some(cut)
}

/// Reads stored chain R0 bytes back into the record they state, only when they reproduce
/// `identity` and re-encode to themselves.
pub(crate) fn decode_r0_chain_record_v1(
    bytes: &[u8],
    identity: BindingDigest,
) -> Option<ReferenceFactR0ChainRecordV1> {
    if sha256(R0_RECORD_DOMAIN, bytes) != identity {
        return None;
    }
    let mut reader = Reader { bytes };

    if reader.u16()? != 1 {
        return None;
    }
    let chain_root = reader.digest()?;
    let root_custody_identity = reader.digest()?;
    let rule_digest = reader.digest()?;
    let basis_digest = reader.digest()?;
    let source_binding_identity = reader.digest()?;
    let source_binding_fact_digest = reader.digest()?;
    let source_binding_lineage_root = reader.digest()?;
    let source_binding_lineage_version = reader.u64()?;
    let source_frontier = reader.frontier()?;
    let correction_frontier = reader.frontier()?;
    let clock = ChainClockEvidenceV1 {
        clock_identity: reader.text()?,
        clock_epoch: reader.text()?,
        monotonic_sequence: reader.u64()?,
        wall_observed: reader.u64()?,
        decision_cut: reader.u64()?,
        valid_through: reader.u64()?,
        restart_continuity_digest: reader.digest()?,
        uncertainty_bound: reader.u64()?,
        skew_bound: reader.u64()?,
    };
    let record = ReferenceFactR0ChainRecordV1 {
        chain_root,
        root_custody_identity,
        rule_digest,
        basis_digest,
        source_binding_identity,
        source_binding_fact_digest,
        source_binding_lineage_root,
        source_binding_lineage_version,
        source_frontier,
        correction_frontier,
        clock,
        window_start_ns: reader.u64()?,
        window_end_ns_exclusive: reader.u64()?,
        canonical_bytes: Vec::new(),
        identity: zero(),
    };

    if !reader.bytes.is_empty() {
        return None;
    }
    seal_r0_record(record).filter(|record| record.canonical_bytes == bytes)
}

/// Reads stored chain R0 cut bytes back, only when they reproduce `identity`.
pub(crate) fn decode_r0_chain_cut_v1(
    bytes: &[u8],
    identity: BindingDigest,
) -> Option<ReferenceFactR0ChainCutV1> {
    if sha256(R0_CUT_DOMAIN, bytes) != identity {
        return None;
    }
    let mut reader = Reader { bytes };

    if reader.u16()? != 1 {
        return None;
    }
    let cut = ReferenceFactR0ChainCutV1 {
        chain_root: reader.digest()?,
        record_identity: reader.digest()?,
        window_start_ns: reader.u64()?,
        window_end_ns_exclusive: reader.u64()?,
        canonical_bytes: Vec::new(),
        identity: zero(),
    };

    if !reader.bytes.is_empty() {
        return None;
    }
    seal_r0_cut(cut).filter(|cut| cut.canonical_bytes == bytes)
}

/// One frame's R0, computed on read and never stored.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FrameR0V1 {
    pub(crate) chain_record_identity: BindingDigest,
    pub(crate) window_start_ns: u64,
    pub(crate) window_end_ns_exclusive: u64,
    pub(crate) identity: BindingDigest,
}

/// The R0 of the frame at `event_ns`: from `e_k` to the end the frame's input timeframes claim,
/// by the rule the snapshot path's R0 window uses. The fill timeframe is not an input: its bar
/// lies inside the gap the execution bar already covers.
///
/// `None` unless `event_ns` is a frame of `schedule` - inside its window, on its grid - and the
/// frame's R0 lies inside the chain record's window. It inherits the chain record's time evidence.
pub(crate) fn frame_r0_v1<'a>(
    record: &ReferenceFactR0ChainRecordV1,
    schedule: &PitWindowScheduleFactV1,
    event_ns: u64,
    declarations: &[UntrustedSourceBarTimeframeV1],
    input_labels: impl IntoIterator<Item = &'a str>,
) -> Option<FrameR0V1> {
    if schedule.chain_root != record.chain_root
        || event_ns < schedule.window_start_ns
        || event_ns >= schedule.window_end_ns_exclusive
        || event_ns < schedule.phase_ns
        || !(event_ns - schedule.phase_ns).is_multiple_of(schedule.interval_ns)
    {
        return None;
    }
    let end = u64::try_from(r0_window_end_over_v1(
        i128::from(event_ns),
        declarations,
        input_labels,
    )?)
    .ok()?;

    if event_ns < record.window_start_ns || end > record.window_end_ns_exclusive {
        return None;
    }
    let mut bytes = Vec::with_capacity(48);
    bytes.extend_from_slice(record.identity.as_bytes());
    put_u64(&mut bytes, event_ns);
    put_u64(&mut bytes, end);
    Some(FrameR0V1 {
        chain_record_identity: record.identity,
        window_start_ns: event_ns,
        window_end_ns_exclusive: end,
        identity: sha256(FRAME_R0_DOMAIN, &bytes),
    })
}

/// The Market Semantics fact a custody chain records once, under the compatibility scope its
/// Source Binding implies.
///
/// It binds the chain and its root custody, the Source Binding and both frontiers, the typed value
/// the request claimed and the chain registry record that maps the chain's dependencies to it, the
/// chain's R0 record and cut, its Instrument Master cut, and the R0 window as its effective regime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsChainFactV1 {
    pub(crate) compatibility_scope_identity: BindingDigest,
    pub(crate) chain_root: BindingDigest,
    pub(crate) root_custody_identity: BindingDigest,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_fact_digest: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) correction_frontier_digest: BindingDigest,
    pub(crate) value: MarketSemanticsValueV1,
    pub(crate) registry_record_identity: BindingDigest,
    pub(crate) r0_record_identity: BindingDigest,
    pub(crate) r0_cut_identity: BindingDigest,
    pub(crate) instrument_master_cut_identity: BindingDigest,
    pub(crate) effective_from_ns: u64,
    pub(crate) effective_until_ns: u64,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl MarketSemanticsChainFactV1 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

/// What a chain's Market Semantics fact binds beyond the custody itself.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MarketSemanticsChainBasisV1 {
    pub(crate) registry_record_identity: BindingDigest,
    pub(crate) instrument_master_cut_identity: BindingDigest,
}

/// The chain Market Semantics fact of a root custody, `None` for a value or dependency that is zero.
pub(crate) fn issue_market_semantics_chain_fact_v1(
    derived: &DerivedCustodyV1,
    chain_root: BindingDigest,
    root_custody_identity: BindingDigest,
    r0: (&ReferenceFactR0ChainRecordV1, &ReferenceFactR0ChainCutV1),
    basis: MarketSemanticsChainBasisV1,
) -> Option<MarketSemanticsChainFactV1> {
    seal_market_semantics_fact(MarketSemanticsChainFactV1 {
        compatibility_scope_identity: derived.market_semantics_identity,
        chain_root,
        root_custody_identity,
        source_binding_identity: derived.binding.binding_id,
        source_binding_fact_digest: derived.binding.fact_digest,
        source_binding_lineage_root: derived.binding.lineage_root,
        source_binding_lineage_version: derived.binding.lineage_version,
        source_frontier_digest: derived.binding.source_frontier_digest,
        correction_frontier_digest: derived.binding.correction_frontier_digest,
        value: derived.market_semantics_value,
        registry_record_identity: basis.registry_record_identity,
        r0_record_identity: r0.0.identity,
        r0_cut_identity: r0.1.identity,
        instrument_master_cut_identity: basis.instrument_master_cut_identity,
        effective_from_ns: r0.0.window_start_ns,
        effective_until_ns: r0.0.window_end_ns_exclusive,
        canonical_bytes: Vec::new(),
        identity: zero(),
    })
}

fn seal_market_semantics_fact(
    mut fact: MarketSemanticsChainFactV1,
) -> Option<MarketSemanticsChainFactV1> {
    let digests = [
        fact.compatibility_scope_identity,
        fact.chain_root,
        fact.root_custody_identity,
        fact.source_binding_identity,
        fact.source_binding_fact_digest,
        fact.source_binding_lineage_root,
        fact.value.normalization_identity,
        fact.value.price_unit_identity,
        fact.value.size_unit_identity,
        fact.registry_record_identity,
        fact.r0_record_identity,
        fact.r0_cut_identity,
        fact.instrument_master_cut_identity,
    ];

    if digests.contains(&zero()) || fact.effective_from_ns >= fact.effective_until_ns {
        return None;
    }
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);

    for digest in [
        fact.compatibility_scope_identity,
        fact.chain_root,
        fact.root_custody_identity,
        fact.source_binding_identity,
        fact.source_binding_fact_digest,
        fact.source_binding_lineage_root,
    ] {
        bytes.extend_from_slice(digest.as_bytes());
    }
    put_u64(&mut bytes, fact.source_binding_lineage_version);
    bytes.extend_from_slice(fact.source_frontier_digest.as_bytes());
    bytes.extend_from_slice(fact.correction_frontier_digest.as_bytes());
    put_market_semantics_value(&mut bytes, &fact.value);
    for digest in [
        fact.registry_record_identity,
        fact.r0_record_identity,
        fact.r0_cut_identity,
        fact.instrument_master_cut_identity,
    ] {
        bytes.extend_from_slice(digest.as_bytes());
    }
    put_u64(&mut bytes, fact.effective_from_ns);
    put_u64(&mut bytes, fact.effective_until_ns);
    fact.identity = sha256(MARKET_SEMANTICS_FACT_DOMAIN, &bytes);
    fact.canonical_bytes = bytes;
    Some(fact)
}

/// Reads stored chain Market Semantics fact bytes back, only when they reproduce `identity`.
pub(crate) fn decode_market_semantics_chain_fact_v1(
    bytes: &[u8],
    identity: BindingDigest,
) -> Option<MarketSemanticsChainFactV1> {
    if sha256(MARKET_SEMANTICS_FACT_DOMAIN, bytes) != identity {
        return None;
    }
    let mut reader = Reader { bytes };

    if reader.u16()? != 1 {
        return None;
    }
    let fact = MarketSemanticsChainFactV1 {
        compatibility_scope_identity: reader.digest()?,
        chain_root: reader.digest()?,
        root_custody_identity: reader.digest()?,
        source_binding_identity: reader.digest()?,
        source_binding_fact_digest: reader.digest()?,
        source_binding_lineage_root: reader.digest()?,
        source_binding_lineage_version: reader.u64()?,
        source_frontier_digest: reader.digest()?,
        correction_frontier_digest: reader.digest()?,
        value: reader.value()?,
        registry_record_identity: reader.digest()?,
        r0_record_identity: reader.digest()?,
        r0_cut_identity: reader.digest()?,
        instrument_master_cut_identity: reader.digest()?,
        effective_from_ns: reader.u64()?,
        effective_until_ns: reader.u64()?,
        canonical_bytes: Vec::new(),
        identity: zero(),
    };

    if !reader.bytes.is_empty() {
        return None;
    }
    seal_market_semantics_fact(fact).filter(|fact| fact.canonical_bytes == bytes)
}

struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        if self.bytes.len() < length {
            return None;
        }
        let (head, tail) = self.bytes.split_at(length);
        self.bytes = tail;
        Some(head)
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_be_bytes(self.take(8)?.try_into().ok()?))
    }

    fn digest(&mut self) -> Option<BindingDigest> {
        Some(BindingDigest::from_untrusted_bytes(
            self.take(32)?.try_into().ok()?,
        ))
    }

    fn text(&mut self) -> Option<String> {
        let length = usize::try_from(self.u64()?).ok()?;
        String::from_utf8(self.take(length)?.to_vec()).ok()
    }

    fn frontier(&mut self) -> Option<UntrustedCompleteFrontier> {
        Some(UntrustedCompleteFrontier {
            stream_identity: self.text()?,
            cut_identity: self.text()?,
            sequence: self.u64()?,
            digest: self.digest()?,
        })
    }

    fn value(&mut self) -> Option<MarketSemanticsValueV1> {
        let normalization_identity = self.digest()?;
        let price_adjustment = match self.u16()? {
            1 => MarketSemanticsPriceAdjustmentV1::Raw,
            2 => MarketSemanticsPriceAdjustmentV1::SplitAdjusted,
            3 => MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted,
            4 => MarketSemanticsPriceAdjustmentV1::Unknown,
            _ => return None,
        };
        let timestamp_basis = match self.u16()? {
            1 => MarketSemanticsTimestampBasisV1::EventEffective,
            2 => MarketSemanticsTimestampBasisV1::IntervalOpen,
            3 => MarketSemanticsTimestampBasisV1::IntervalClose,
            _ => return None,
        };
        Some(MarketSemanticsValueV1 {
            normalization_identity,
            price_adjustment,
            timestamp_basis,
            price_unit_identity: self.digest()?,
            size_unit_identity: self.digest()?,
        })
    }
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_text(out: &mut Vec<u8>, value: &str) {
    put_u64(out, value.len() as u64);
    out.extend_from_slice(value.as_bytes());
}

fn put_frontier(out: &mut Vec<u8>, frontier: &UntrustedCompleteFrontier) {
    put_text(out, &frontier.stream_identity);
    put_text(out, &frontier.cut_identity);
    put_u64(out, frontier.sequence);
    out.extend_from_slice(frontier.digest.as_bytes());
}

const fn zero() -> BindingDigest {
    BindingDigest::from_untrusted_bytes([0; 32])
}

fn sha256(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}
