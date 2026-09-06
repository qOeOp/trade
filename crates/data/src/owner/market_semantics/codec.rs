use super::{
    MarketSemanticsConsumerV1, MarketSemanticsCutEntryV1, MarketSemanticsCutV1,
    MarketSemanticsErrorV1, MarketSemanticsFactV1, MarketSemanticsIdentity,
    MarketSemanticsPriceAdjustmentV1, MarketSemanticsReadbackV1, MarketSemanticsReceiptV1,
    MarketSemanticsRegistryEntryV1, MarketSemanticsRegistryKeyV1, MarketSemanticsTimestampBasisV1,
    MarketSemanticsValueV1, UntrustedMarketSemanticsProposalV1,
};

pub(super) const VERSION: u16 = 1;
pub(super) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.market-semantics-request.v1\0";
pub(super) const FACT_DOMAIN: &[u8] = b"vibe.market-data.market-semantics-fact.v1\0";
pub(super) const CUT_DOMAIN: &[u8] = b"vibe.market-data.market-semantics-cut.v1\0";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.market-semantics-receipt.v1\0";
pub(super) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.market-semantics-readback.v1\0";
pub(super) const REGISTRY_KEY_DOMAIN: &[u8] =
    b"vibe.market-data.market-semantics-registry-key.v1\0";
pub(super) const REGISTRY_RECORD_DOMAIN: &[u8] =
    b"vibe.market-data.market-semantics-registry-record.v1\0";
pub(super) const MAX_LOCATOR_BYTES: usize = 64 * 1024;
pub(super) const MAX_FACT_BYTES: usize = 64 * 1024;
pub(super) const MAX_CUT_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_READBACK_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_FACTS: usize = 16_384;

pub(super) fn digest(domain: &[u8], bytes: &[u8]) -> MarketSemanticsIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    MarketSemanticsIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[derive(Default)]
pub(super) struct Encoder(Vec<u8>);

impl Encoder {
    fn finish(self, limit: usize) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
        if self.0.is_empty() || self.0.len() > limit {
            Err(MarketSemanticsErrorV1::CapacityExceeded)
        } else {
            Ok(self.0.into_boxed_slice())
        }
    }
    fn raw(&mut self, value: &[u8]) {
        self.0.extend_from_slice(value);
    }
    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.raw(&value.to_be_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.raw(&value.to_be_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.raw(&value.to_be_bytes());
    }
    fn i128(&mut self, value: i128) {
        self.raw(&value.to_be_bytes());
    }
    fn identity(&mut self, value: MarketSemanticsIdentity) {
        self.raw(value.as_bytes());
    }
    fn optional_identity(&mut self, value: Option<MarketSemanticsIdentity>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.identity(value);
            }
        }
    }
    fn optional_i128(&mut self, value: Option<i128>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.i128(value);
            }
        }
    }
    fn bytes(&mut self, value: &[u8], limit: usize) -> Result<(), MarketSemanticsErrorV1> {
        if value.is_empty() || value.len() > limit {
            return Err(MarketSemanticsErrorV1::CapacityExceeded);
        }
        self.u32(u32::try_from(value.len()).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?);
        self.raw(value);
        Ok(())
    }
    fn header(&mut self) {
        self.u16(VERSION);
        self.u16(0);
    }
    fn value(&mut self, value: MarketSemanticsValueV1) {
        self.identity(value.normalization_identity);
        self.u16(value.price_adjustment as u16);
        self.u16(value.timestamp_basis as u16);
        self.identity(value.price_unit_identity);
        self.identity(value.size_unit_identity);
    }
}

pub(super) fn encode_request_meaning(
    proposal: &UntrustedMarketSemanticsProposalV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.u16(proposal.consumer as u16);
    e.identity(proposal.compatibility_scope_identity);
    e.optional_identity(proposal.predecessor_identity);
    e.value(proposal.value);
    e.i128(proposal.effective_from_ns);
    e.optional_i128(proposal.effective_until_ns);
    e.i128(proposal.owner_observation_ns);
    e.u64(proposal.decision_cut);
    e.bytes(&proposal.pit_locator_bytes, MAX_LOCATOR_BYTES)?;
    e.bytes(&proposal.source_binding_locator_bytes, MAX_LOCATOR_BYTES)?;
    e.bytes(&proposal.instrument_master_locator_bytes, MAX_LOCATOR_BYTES)?;
    e.bytes(&proposal.r0_locator_bytes, MAX_LOCATOR_BYTES)?;
    e.identity(proposal.stable_correlation);
    e.finish(MAX_READBACK_BYTES)
}

pub(super) fn encode_registry_key(
    key: &MarketSemanticsRegistryKeyV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    let mut e = Encoder::default();
    e.header();

    for value in [
        key.compatibility_scope_identity,
        key.r0_record_identity,
        key.r0_record_digest,
        key.r0_cut_identity,
        key.r0_cut_digest,
        key.pit_snapshot_identity,
        key.pit_fact_digest,
        key.source_binding_identity,
        key.source_binding_fact_digest,
        key.source_binding_lineage_root,
    ] {
        e.identity(value);
    }
    e.u64(key.source_binding_lineage_version);
    for value in [
        key.instrument_master_readback_digest,
        key.instrument_master_fact_digest,
        key.instrument_master_cut_digest,
        key.source_frontier,
        key.correction_frontier,
    ] {
        e.identity(value);
    }
    e.finish(2048)
}

pub(super) fn encode_registry_entry(
    entry: &MarketSemanticsRegistryEntryV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(entry.key.identity);
    e.bytes(&entry.key.canonical_bytes, 2048)?;
    e.value(entry.value);
    e.identity(entry.correction_identity);
    e.finish(4096)
}

pub(crate) fn decode_registry_entry(
    bytes: &[u8],
) -> Result<MarketSemanticsRegistryEntryV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, 4096)?;
    d.header()?;
    let key_identity = d.identity()?;
    let key_bytes = d.bytes(2048)?;
    let key = decode_registry_key(&key_bytes)?;
    if key.identity != key_identity {
        return Err(MarketSemanticsErrorV1::DigestMismatch);
    }
    let value = d.value()?;
    let correction_identity = d.identity()?;
    d.done()?;
    Ok(MarketSemanticsRegistryEntryV1 {
        key,
        value,
        correction_identity,
        canonical_bytes: bytes.into(),
        identity: digest(REGISTRY_RECORD_DOMAIN, bytes),
    })
}

fn decode_registry_key(
    bytes: &[u8],
) -> Result<MarketSemanticsRegistryKeyV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, 2048)?;
    d.header()?;
    let key = MarketSemanticsRegistryKeyV1 {
        compatibility_scope_identity: d.identity()?,
        r0_record_identity: d.identity()?,
        r0_record_digest: d.identity()?,
        r0_cut_identity: d.identity()?,
        r0_cut_digest: d.identity()?,
        pit_snapshot_identity: d.identity()?,
        pit_fact_digest: d.identity()?,
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        instrument_master_readback_digest: d.identity()?,
        instrument_master_fact_digest: d.identity()?,
        instrument_master_cut_digest: d.identity()?,
        source_frontier: d.identity()?,
        correction_frontier: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(REGISTRY_KEY_DOMAIN, bytes),
    };
    d.done()?;
    Ok(key)
}

pub(super) fn encode_fact(
    fact: &MarketSemanticsFactV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(fact.compatibility_scope_identity);
    e.optional_identity(fact.predecessor_identity);
    e.value(fact.value);
    e.i128(fact.effective_from_ns);
    e.optional_i128(fact.effective_until_ns);
    e.i128(fact.provider_available_ns);
    e.i128(fact.retrieval_ns);
    e.i128(fact.correction_publication_ns);
    e.i128(fact.owner_observation_ns);
    e.u64(fact.decision_cut);
    for value in [
        fact.coordinate_identity,
        fact.coordinate_digest,
        fact.pit_snapshot_identity,
        fact.pit_fact_digest,
        fact.source_binding_identity,
        fact.source_binding_fact_digest,
        fact.source_binding_lineage_root,
    ] {
        e.identity(value);
    }
    e.u64(fact.source_binding_lineage_version);
    for value in [
        fact.instrument_master_readback_digest,
        fact.instrument_master_fact_digest,
        fact.instrument_master_cut_digest,
        fact.source_frontier,
        fact.correction_frontier,
        fact.correction_identity,
    ] {
        e.identity(value);
    }
    e.finish(MAX_FACT_BYTES)
}

pub(super) fn encode_cut(cut: &MarketSemanticsCutV1) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    if cut.entries.len() > MAX_FACTS || cut.gaps.len() > MAX_FACTS {
        return Err(MarketSemanticsErrorV1::CapacityExceeded);
    }
    let mut e = Encoder::default();
    e.header();
    e.identity(cut.request_identity);
    e.identity(cut.request_meaning_digest);
    e.u16(cut.consumer as u16);
    e.identity(cut.compatibility_scope_identity);
    e.i128(cut.effective_instant_ns);
    e.i128(cut.owner_observation_ns);
    e.u64(cut.decision_cut);
    e.identity(cut.r0_cut_identity);
    e.identity(cut.r0_cut_digest);
    e.u32(u32::try_from(cut.entries.len()).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?);
    for entry in &cut.entries {
        e.identity(entry.scope_identity);
        e.identity(entry.fact_identity);
        e.identity(entry.fact_digest);
    }
    e.u32(u32::try_from(cut.gaps.len()).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?);
    for gap in &cut.gaps {
        e.identity(*gap);
    }
    e.finish(MAX_CUT_BYTES)
}

pub(super) fn encode_receipt(
    receipt: &MarketSemanticsReceiptV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(receipt.request_identity);
    e.identity(receipt.request_meaning_digest);
    e.u16(receipt.consumer as u16);
    e.identity(receipt.cut_identity);
    e.identity(receipt.cut_digest);
    e.identity(receipt.store_generation_identity);
    e.u64(receipt.append_sequence);
    e.identity(receipt.stable_correlation);
    e.finish(1024)
}

pub(super) fn encode_readback(
    readback: &MarketSemanticsReadbackV1,
) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
    if readback.facts.is_empty() || readback.facts.len() > MAX_FACTS {
        return Err(MarketSemanticsErrorV1::IncompleteCut);
    }
    let mut e = Encoder::default();
    e.header();
    e.u32(
        u32::try_from(readback.facts.len())
            .map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?,
    );

    for fact in &readback.facts {
        e.identity(fact.identity);
        e.bytes(&fact.canonical_bytes, MAX_FACT_BYTES)?;
    }
    e.identity(readback.cut.identity);
    e.bytes(&readback.cut.canonical_bytes, MAX_CUT_BYTES)?;
    e.identity(readback.receipt.identity);
    e.bytes(&readback.receipt.canonical_bytes, 1024)?;
    e.identity(readback.outbox_identity);
    e.finish(MAX_READBACK_BYTES)
}

struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8], limit: usize) -> Result<Self, MarketSemanticsErrorV1> {
        if bytes.is_empty() || bytes.len() > limit {
            Err(MarketSemanticsErrorV1::CapacityExceeded)
        } else {
            Ok(Self { bytes, cursor: 0 })
        }
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N], MarketSemanticsErrorV1> {
        let end = self
            .cursor
            .checked_add(N)
            .ok_or(MarketSemanticsErrorV1::CodecMismatch)?;
        let value: [u8; N] = self
            .bytes
            .get(self.cursor..end)
            .ok_or(MarketSemanticsErrorV1::CodecMismatch)?
            .try_into()
            .map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?;
        self.cursor = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, MarketSemanticsErrorV1> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, MarketSemanticsErrorV1> {
        Ok(u16::from_be_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, MarketSemanticsErrorV1> {
        Ok(u32::from_be_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, MarketSemanticsErrorV1> {
        Ok(u64::from_be_bytes(self.take()?))
    }
    fn i128(&mut self) -> Result<i128, MarketSemanticsErrorV1> {
        Ok(i128::from_be_bytes(self.take()?))
    }
    fn identity(&mut self) -> Result<MarketSemanticsIdentity, MarketSemanticsErrorV1> {
        Ok(MarketSemanticsIdentity::from_untrusted_bytes(self.take()?))
    }
    fn optional_identity(
        &mut self,
    ) -> Result<Option<MarketSemanticsIdentity>, MarketSemanticsErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(MarketSemanticsErrorV1::CodecMismatch),
        }
    }
    fn optional_i128(&mut self) -> Result<Option<i128>, MarketSemanticsErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(MarketSemanticsErrorV1::CodecMismatch),
        }
    }
    fn bytes(&mut self, limit: usize) -> Result<Box<[u8]>, MarketSemanticsErrorV1> {
        let len =
            usize::try_from(self.u32()?).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?;
        if len == 0 || len > limit {
            return Err(MarketSemanticsErrorV1::CapacityExceeded);
        }
        let end = self
            .cursor
            .checked_add(len)
            .ok_or(MarketSemanticsErrorV1::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or(MarketSemanticsErrorV1::CodecMismatch)?
            .into();
        self.cursor = end;
        Ok(value)
    }
    fn header(&mut self) -> Result<(), MarketSemanticsErrorV1> {
        if self.u16()? == VERSION && self.u16()? == 0 {
            Ok(())
        } else {
            Err(MarketSemanticsErrorV1::CodecMismatch)
        }
    }
    fn consumer(&mut self) -> Result<MarketSemanticsConsumerV1, MarketSemanticsErrorV1> {
        match self.u16()? {
            1 => Ok(MarketSemanticsConsumerV1::StrategyInputBindingRegistry),
            2 => Ok(MarketSemanticsConsumerV1::ReplayMarketFactsV2),
            _ => Err(MarketSemanticsErrorV1::CodecMismatch),
        }
    }
    fn value(&mut self) -> Result<MarketSemanticsValueV1, MarketSemanticsErrorV1> {
        let normalization_identity = self.identity()?;
        let price_adjustment = match self.u16()? {
            1 => MarketSemanticsPriceAdjustmentV1::Raw,
            2 => MarketSemanticsPriceAdjustmentV1::SplitAdjusted,
            3 => MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted,
            _ => return Err(MarketSemanticsErrorV1::CodecMismatch),
        };
        let timestamp_basis = match self.u16()? {
            1 => MarketSemanticsTimestampBasisV1::EventEffective,
            2 => MarketSemanticsTimestampBasisV1::IntervalOpen,
            3 => MarketSemanticsTimestampBasisV1::IntervalClose,
            _ => return Err(MarketSemanticsErrorV1::CodecMismatch),
        };
        Ok(MarketSemanticsValueV1 {
            normalization_identity,
            price_adjustment,
            timestamp_basis,
            price_unit_identity: self.identity()?,
            size_unit_identity: self.identity()?,
        })
    }
    fn done(&self) -> Result<(), MarketSemanticsErrorV1> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(MarketSemanticsErrorV1::CodecMismatch)
        }
    }
}

pub(crate) fn decode_fact(bytes: &[u8]) -> Result<MarketSemanticsFactV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, MAX_FACT_BYTES)?;
    d.header()?;
    let compatibility_scope_identity = d.identity()?;
    let predecessor_identity = d.optional_identity()?;
    let value = d.value()?;
    let effective_from_ns = d.i128()?;
    let effective_until_ns = d.optional_i128()?;
    let mut fact = MarketSemanticsFactV1 {
        compatibility_scope_identity,
        predecessor_identity,
        value,
        effective_from_ns,
        effective_until_ns,
        provider_available_ns: d.i128()?,
        retrieval_ns: d.i128()?,
        correction_publication_ns: d.i128()?,
        owner_observation_ns: d.i128()?,
        decision_cut: d.u64()?,
        coordinate_identity: d.identity()?,
        coordinate_digest: d.identity()?,
        pit_snapshot_identity: d.identity()?,
        pit_fact_digest: d.identity()?,
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        instrument_master_readback_digest: d.identity()?,
        instrument_master_fact_digest: d.identity()?,
        instrument_master_cut_digest: d.identity()?,
        source_frontier: d.identity()?,
        correction_frontier: d.identity()?,
        correction_identity: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(FACT_DOMAIN, bytes),
    };
    d.done()?;
    fact.canonical_bytes = bytes.into();
    Ok(fact)
}

pub(super) fn decode_cut(bytes: &[u8]) -> Result<MarketSemanticsCutV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, MAX_CUT_BYTES)?;
    d.header()?;
    let request_identity = d.identity()?;
    let request_meaning_digest = d.identity()?;
    let consumer = d.consumer()?;
    let compatibility_scope_identity = d.identity()?;
    let effective_instant_ns = d.i128()?;
    let owner_observation_ns = d.i128()?;
    let decision_cut = d.u64()?;
    let r0_cut_identity = d.identity()?;
    let r0_cut_digest = d.identity()?;
    let count = usize::try_from(d.u32()?).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?;
    if count > MAX_FACTS {
        return Err(MarketSemanticsErrorV1::CapacityExceeded);
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        entries.push(MarketSemanticsCutEntryV1 {
            scope_identity: d.identity()?,
            fact_identity: d.identity()?,
            fact_digest: d.identity()?,
        });
    }
    let gap_count =
        usize::try_from(d.u32()?).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?;
    if gap_count > MAX_FACTS {
        return Err(MarketSemanticsErrorV1::CapacityExceeded);
    }
    let mut gaps = Vec::with_capacity(gap_count);
    for _ in 0..gap_count {
        gaps.push(d.identity()?);
    }
    d.done()?;
    Ok(MarketSemanticsCutV1 {
        request_identity,
        request_meaning_digest,
        consumer,
        compatibility_scope_identity,
        effective_instant_ns,
        owner_observation_ns,
        decision_cut,
        r0_cut_identity,
        r0_cut_digest,
        entries: entries.into_boxed_slice(),
        gaps: gaps.into_boxed_slice(),
        canonical_bytes: bytes.into(),
        identity: digest(CUT_DOMAIN, bytes),
    })
}

pub(super) fn decode_receipt(
    bytes: &[u8],
) -> Result<MarketSemanticsReceiptV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, 1024)?;
    d.header()?;
    let receipt = MarketSemanticsReceiptV1 {
        request_identity: d.identity()?,
        request_meaning_digest: d.identity()?,
        consumer: d.consumer()?,
        cut_identity: d.identity()?,
        cut_digest: d.identity()?,
        store_generation_identity: d.identity()?,
        append_sequence: d.u64()?,
        stable_correlation: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: digest(RECEIPT_DOMAIN, bytes),
    };
    d.done()?;
    Ok(receipt)
}

pub(super) fn decode_readback(
    bytes: &[u8],
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let mut d = Decoder::new(bytes, MAX_READBACK_BYTES)?;
    d.header()?;
    let count = usize::try_from(d.u32()?).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?;
    if count == 0 || count > MAX_FACTS {
        return Err(MarketSemanticsErrorV1::IncompleteCut);
    }
    let mut facts = Vec::with_capacity(count);
    for _ in 0..count {
        let claimed = d.identity()?;
        let fact_bytes = d.bytes(MAX_FACT_BYTES)?;
        let fact = decode_fact(&fact_bytes)?;
        if fact.identity != claimed {
            return Err(MarketSemanticsErrorV1::DigestMismatch);
        }
        facts.push(fact);
    }
    let cut_identity = d.identity()?;
    let cut_bytes = d.bytes(MAX_CUT_BYTES)?;
    let cut = decode_cut(&cut_bytes)?;
    if cut.identity != cut_identity {
        return Err(MarketSemanticsErrorV1::DigestMismatch);
    }
    let receipt_identity = d.identity()?;
    let receipt_bytes = d.bytes(1024)?;
    let receipt = decode_receipt(&receipt_bytes)?;
    if receipt.identity != receipt_identity {
        return Err(MarketSemanticsErrorV1::DigestMismatch);
    }
    let outbox_identity = d.identity()?;
    d.done()?;
    Ok(MarketSemanticsReadbackV1 {
        facts: facts.into_boxed_slice(),
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: bytes.into(),
        identity: digest(READBACK_DOMAIN, bytes),
    })
}
