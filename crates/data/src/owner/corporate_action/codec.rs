use super::{
    CorporateActionConsumerV1, CorporateActionCutEntryV1, CorporateActionCutV1,
    CorporateActionErrorV1, CorporateActionFactV1, CorporateActionIdentity,
    CorporateActionInstrumentCensusV1, CorporateActionReadbackV1, CorporateActionReceiptV1,
    CorporateActionTermsV1, UntrustedCorporateActionProposalV1,
};

pub(super) const VERSION: u16 = 1;
pub(super) const FACT_DOMAIN: &[u8] = b"vibe.market-data.corporate-action-fact.v1\0";
pub(super) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.corporate-action-request.v1\0";
pub(super) const CUT_DOMAIN: &[u8] = b"vibe.market-data.corporate-action-cut.v1\0";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.corporate-action-receipt.v1\0";
pub(super) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.corporate-action-readback.v1\0";
const MAX_ITEM: usize = 64 * 1024;
const MAX_FACTS: usize = 16_384;
const MAX_CUT: usize = 4 * 1024 * 1024;
const MAX_READBACK: usize = 8 * 1024 * 1024;

pub(super) fn digest(domain: &[u8], bytes: &[u8]) -> CorporateActionIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    CorporateActionIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[derive(Default)]
struct Encoder(Vec<u8>);

impl Encoder {
    fn header(&mut self) {
        self.u16(VERSION);
        self.u16(0);
    }
    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn i128(&mut self, value: i128) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn identity(&mut self, value: CorporateActionIdentity) {
        self.0.extend_from_slice(value.as_bytes());
    }
    fn optional_identity(&mut self, value: Option<CorporateActionIdentity>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.identity(value);
            }
            None => self.u8(0),
        }
    }
    fn optional_i128(&mut self, value: Option<i128>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.i128(value);
            }
            None => self.u8(0),
        }
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), CorporateActionErrorV1> {
        if value.is_empty() || value.len() > MAX_ITEM {
            return Err(CorporateActionErrorV1::CapacityExceeded);
        }
        self.u32(u32::try_from(value.len()).map_err(|_| CorporateActionErrorV1::CapacityExceeded)?);
        self.0.extend_from_slice(value);
        Ok(())
    }
    fn finish(self, max: usize) -> Result<Box<[u8]>, CorporateActionErrorV1> {
        if self.0.len() > max {
            Err(CorporateActionErrorV1::CapacityExceeded)
        } else {
            Ok(self.0.into_boxed_slice())
        }
    }
}

pub(super) fn encode_request_meaning(
    request: &UntrustedCorporateActionProposalV1,
) -> Result<Box<[u8]>, CorporateActionErrorV1> {
    if request.instruments.is_empty() || request.instruments.len() > MAX_FACTS {
        return Err(CorporateActionErrorV1::InvalidRequest);
    }
    let mut e = Encoder::default();
    e.header();
    e.u16(request.consumer as u16);
    e.i128(request.replay_start_ns);
    e.i128(request.replay_end_ns_exclusive);
    e.u32(
        u32::try_from(request.instruments.len())
            .map_err(|_| CorporateActionErrorV1::CapacityExceeded)?,
    );

    for instrument in &request.instruments {
        e.bytes(instrument)?;
    }
    e.i128(request.owner_observation_ns);
    e.u64(request.decision_cut);
    e.bytes(&request.instrument_master_locator_bytes)?;
    e.bytes(&request.pit_locator_bytes)?;
    e.bytes(&request.source_binding_locator_bytes)?;
    e.bytes(&request.r0_locator_bytes)?;
    e.identity(request.stable_correlation);
    e.finish(MAX_CUT)
}

fn encode_terms(
    e: &mut Encoder,
    terms: &CorporateActionTermsV1,
) -> Result<(), CorporateActionErrorV1> {
    match terms {
        CorporateActionTermsV1::Split {
            numerator,
            denominator,
        } => {
            e.u16(1);
            e.u64(*numerator);
            e.u64(*denominator);
        }
        CorporateActionTermsV1::CashDividend {
            mantissa,
            scale,
            currency_identity,
        } => {
            e.u16(2);
            e.i128(*mantissa);
            e.u8(*scale);
            e.bytes(currency_identity)?;
        }
        CorporateActionTermsV1::SymbolChange {
            successor_instrument,
        } => {
            e.u16(3);
            e.bytes(successor_instrument)?;
        }
        CorporateActionTermsV1::Expiry => e.u16(4),
        CorporateActionTermsV1::Roll {
            successor_instrument,
        } => {
            e.u16(5);
            e.bytes(successor_instrument)?;
        }
    }
    Ok(())
}

pub(super) fn encode_fact(
    fact: &CorporateActionFactV1,
) -> Result<Box<[u8]>, CorporateActionErrorV1> {
    let mut e = Encoder::default();
    e.header();
    e.identity(fact.action_identity);
    e.bytes(&fact.instrument)?;
    encode_terms(&mut e, &fact.terms)?;
    e.optional_identity(fact.predecessor_identity);
    e.i128(fact.effective_from_ns);
    e.optional_i128(fact.effective_until_ns);
    e.i128(fact.provider_available_ns);
    e.i128(fact.retrieval_ns);
    e.i128(fact.correction_publication_ns);
    e.i128(fact.owner_observation_ns);
    e.u64(fact.decision_cut);
    e.identity(fact.coordinate_identity);
    e.identity(fact.coordinate_digest);
    e.identity(fact.instrument_master_readback_digest);
    e.identity(fact.instrument_master_fact_digest);
    e.identity(fact.instrument_master_cut_digest);
    e.identity(fact.pit_snapshot_identity);
    e.identity(fact.pit_fact_digest);
    e.identity(fact.source_binding_identity);
    e.identity(fact.source_binding_fact_digest);
    e.identity(fact.source_binding_lineage_root);
    e.u64(fact.source_binding_lineage_version);
    e.identity(fact.source_frontier);
    e.identity(fact.correction_frontier);
    e.identity(fact.correction_identity);
    e.finish(MAX_ITEM)
}

pub(super) fn encode_cut(cut: &CorporateActionCutV1) -> Result<Box<[u8]>, CorporateActionErrorV1> {
    if cut.census.is_empty() || cut.census.len() > MAX_FACTS || cut.gaps.len() > MAX_FACTS {
        return Err(CorporateActionErrorV1::IncompleteCut);
    }
    let mut e = Encoder::default();
    e.header();
    e.identity(cut.request_identity);
    e.identity(cut.request_meaning_digest);
    e.u16(cut.consumer as u16);
    e.i128(cut.replay_start_ns);
    e.i128(cut.replay_end_ns_exclusive);
    e.i128(cut.owner_observation_ns);
    e.u64(cut.decision_cut);
    e.identity(cut.r0_cut_identity);
    e.identity(cut.r0_cut_digest);
    e.identity(cut.instrument_master_cut_digest);
    e.identity(cut.pit_cut_digest);
    e.u32(u32::try_from(cut.census.len()).map_err(|_| CorporateActionErrorV1::CapacityExceeded)?);
    for census in &cut.census {
        e.bytes(&census.instrument)?;
        e.u32(
            u32::try_from(census.actions.len())
                .map_err(|_| CorporateActionErrorV1::CapacityExceeded)?,
        );

        for action in &census.actions {
            e.i128(action.effective_from_ns);
            e.identity(action.action_identity);
            e.identity(action.fact_identity);
            e.identity(action.fact_digest);
        }
    }
    e.u32(u32::try_from(cut.gaps.len()).map_err(|_| CorporateActionErrorV1::CapacityExceeded)?);
    for gap in &cut.gaps {
        e.bytes(gap)?;
    }
    e.finish(MAX_CUT)
}

pub(super) fn encode_receipt(
    receipt: &CorporateActionReceiptV1,
) -> Result<Box<[u8]>, CorporateActionErrorV1> {
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
    readback: &CorporateActionReadbackV1,
) -> Result<Box<[u8]>, CorporateActionErrorV1> {
    if readback.facts.len() > MAX_FACTS {
        return Err(CorporateActionErrorV1::CapacityExceeded);
    }
    let mut e = Encoder::default();
    e.header();
    e.u32(
        u32::try_from(readback.facts.len())
            .map_err(|_| CorporateActionErrorV1::CapacityExceeded)?,
    );

    for fact in &readback.facts {
        e.identity(fact.identity);
        e.bytes(&fact.canonical_bytes)?;
    }
    e.identity(readback.cut.identity);
    e.bytes(&readback.cut.canonical_bytes)?;
    e.identity(readback.receipt.identity);
    e.bytes(&readback.receipt.canonical_bytes)?;
    e.identity(readback.outbox_identity);
    e.finish(MAX_READBACK)
}

struct Decoder<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8], max: usize) -> Result<Self, CorporateActionErrorV1> {
        if bytes.len() > max {
            return Err(CorporateActionErrorV1::CapacityExceeded);
        }
        let mut d = Self { bytes, at: 0 };
        if d.u16()? != VERSION || d.u16()? != 0 {
            return Err(CorporateActionErrorV1::CodecMismatch);
        }
        Ok(d)
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N], CorporateActionErrorV1> {
        let end = self
            .at
            .checked_add(N)
            .ok_or(CorporateActionErrorV1::CodecMismatch)?;
        let value: [u8; N] = self
            .bytes
            .get(self.at..end)
            .ok_or(CorporateActionErrorV1::CodecMismatch)?
            .try_into()
            .map_err(|_| CorporateActionErrorV1::CodecMismatch)?;
        self.at = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, CorporateActionErrorV1> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, CorporateActionErrorV1> {
        Ok(u16::from_be_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, CorporateActionErrorV1> {
        Ok(u32::from_be_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, CorporateActionErrorV1> {
        Ok(u64::from_be_bytes(self.take()?))
    }
    fn i128(&mut self) -> Result<i128, CorporateActionErrorV1> {
        Ok(i128::from_be_bytes(self.take()?))
    }
    fn identity(&mut self) -> Result<CorporateActionIdentity, CorporateActionErrorV1> {
        Ok(CorporateActionIdentity::from_untrusted_bytes(self.take()?))
    }
    fn optional_identity(
        &mut self,
    ) -> Result<Option<CorporateActionIdentity>, CorporateActionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(CorporateActionErrorV1::CodecMismatch),
        }
    }
    fn optional_i128(&mut self) -> Result<Option<i128>, CorporateActionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(CorporateActionErrorV1::CodecMismatch),
        }
    }
    fn bytes(&mut self) -> Result<Box<[u8]>, CorporateActionErrorV1> {
        let len =
            usize::try_from(self.u32()?).map_err(|_| CorporateActionErrorV1::CapacityExceeded)?;
        if len == 0 || len > MAX_ITEM {
            return Err(CorporateActionErrorV1::CodecMismatch);
        }
        let end = self
            .at
            .checked_add(len)
            .ok_or(CorporateActionErrorV1::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.at..end)
            .ok_or(CorporateActionErrorV1::CodecMismatch)?
            .to_vec()
            .into_boxed_slice();
        self.at = end;
        Ok(value)
    }
    fn count(&mut self) -> Result<usize, CorporateActionErrorV1> {
        let n =
            usize::try_from(self.u32()?).map_err(|_| CorporateActionErrorV1::CapacityExceeded)?;
        if n > MAX_FACTS {
            Err(CorporateActionErrorV1::CapacityExceeded)
        } else {
            Ok(n)
        }
    }
    fn finish(self) -> Result<(), CorporateActionErrorV1> {
        if self.at == self.bytes.len() {
            Ok(())
        } else {
            Err(CorporateActionErrorV1::CodecMismatch)
        }
    }
}

fn decode_terms(d: &mut Decoder<'_>) -> Result<CorporateActionTermsV1, CorporateActionErrorV1> {
    Ok(match d.u16()? {
        1 => CorporateActionTermsV1::Split {
            numerator: d.u64()?,
            denominator: d.u64()?,
        },
        2 => CorporateActionTermsV1::CashDividend {
            mantissa: d.i128()?,
            scale: d.u8()?,
            currency_identity: d.bytes()?,
        },
        3 => CorporateActionTermsV1::SymbolChange {
            successor_instrument: d.bytes()?,
        },
        4 => CorporateActionTermsV1::Expiry,
        5 => CorporateActionTermsV1::Roll {
            successor_instrument: d.bytes()?,
        },
        _ => return Err(CorporateActionErrorV1::CodecMismatch),
    })
}

pub(crate) fn decode_fact(bytes: &[u8]) -> Result<CorporateActionFactV1, CorporateActionErrorV1> {
    let mut d = Decoder::new(bytes, MAX_ITEM)?;
    let mut fact = CorporateActionFactV1 {
        action_identity: d.identity()?,
        instrument: d.bytes()?,
        terms: decode_terms(&mut d)?,
        predecessor_identity: d.optional_identity()?,
        effective_from_ns: d.i128()?,
        effective_until_ns: d.optional_i128()?,
        provider_available_ns: d.i128()?,
        retrieval_ns: d.i128()?,
        correction_publication_ns: d.i128()?,
        owner_observation_ns: d.i128()?,
        decision_cut: d.u64()?,
        coordinate_identity: d.identity()?,
        coordinate_digest: d.identity()?,
        instrument_master_readback_digest: d.identity()?,
        instrument_master_fact_digest: d.identity()?,
        instrument_master_cut_digest: d.identity()?,
        pit_snapshot_identity: d.identity()?,
        pit_fact_digest: d.identity()?,
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        source_frontier: d.identity()?,
        correction_frontier: d.identity()?,
        correction_identity: d.identity()?,
        canonical_bytes: bytes.into(),
        identity: CorporateActionIdentity::from_untrusted_bytes([0; 32]),
    };
    d.finish()?;
    fact.identity = digest(FACT_DOMAIN, bytes);
    Ok(fact)
}

fn decode_cut(bytes: &[u8]) -> Result<CorporateActionCutV1, CorporateActionErrorV1> {
    let mut d = Decoder::new(bytes, MAX_CUT)?;
    let request_identity = d.identity()?;
    let request_meaning_digest = d.identity()?;
    let consumer = match d.u16()? {
        1 => CorporateActionConsumerV1::ReplayV2,
        2 => CorporateActionConsumerV1::Backtest,
        _ => return Err(CorporateActionErrorV1::CodecMismatch),
    };
    let replay_start_ns = d.i128()?;
    let replay_end_ns_exclusive = d.i128()?;
    let owner_observation_ns = d.i128()?;
    let decision_cut = d.u64()?;
    let r0_cut_identity = d.identity()?;
    let r0_cut_digest = d.identity()?;
    let instrument_master_cut_digest = d.identity()?;
    let pit_cut_digest = d.identity()?;
    let census_count = d.count()?;
    let mut census = Vec::with_capacity(census_count);
    for _ in 0..census_count {
        let instrument = d.bytes()?;
        let action_count = d.count()?;
        let mut actions = Vec::with_capacity(action_count);
        for _ in 0..action_count {
            actions.push(CorporateActionCutEntryV1 {
                effective_from_ns: d.i128()?,
                action_identity: d.identity()?,
                fact_identity: d.identity()?,
                fact_digest: d.identity()?,
            });
        }
        census.push(CorporateActionInstrumentCensusV1 {
            instrument,
            actions: actions.into_boxed_slice(),
        });
    }
    let gap_count = d.count()?;
    let mut gaps = Vec::with_capacity(gap_count);
    for _ in 0..gap_count {
        gaps.push(d.bytes()?);
    }
    d.finish()?;
    Ok(CorporateActionCutV1 {
        request_identity,
        request_meaning_digest,
        consumer,
        replay_start_ns,
        replay_end_ns_exclusive,
        owner_observation_ns,
        decision_cut,
        r0_cut_identity,
        r0_cut_digest,
        instrument_master_cut_digest,
        pit_cut_digest,
        census: census.into_boxed_slice(),
        gaps: gaps.into_boxed_slice(),
        canonical_bytes: bytes.into(),
        identity: digest(CUT_DOMAIN, bytes),
    })
}

fn decode_receipt(bytes: &[u8]) -> Result<CorporateActionReceiptV1, CorporateActionErrorV1> {
    let mut d = Decoder::new(bytes, 1024)?;
    let request_identity = d.identity()?;
    let request_meaning_digest = d.identity()?;
    let consumer = match d.u16()? {
        1 => CorporateActionConsumerV1::ReplayV2,
        2 => CorporateActionConsumerV1::Backtest,
        _ => return Err(CorporateActionErrorV1::CodecMismatch),
    };
    let cut_identity = d.identity()?;
    let cut_digest = d.identity()?;
    let store_generation_identity = d.identity()?;
    let append_sequence = d.u64()?;
    let stable_correlation = d.identity()?;
    d.finish()?;
    Ok(CorporateActionReceiptV1 {
        request_identity,
        request_meaning_digest,
        consumer,
        cut_identity,
        cut_digest,
        store_generation_identity,
        append_sequence,
        stable_correlation,
        canonical_bytes: bytes.into(),
        identity: digest(RECEIPT_DOMAIN, bytes),
    })
}

pub(super) fn decode_readback(
    bytes: &[u8],
) -> Result<CorporateActionReadbackV1, CorporateActionErrorV1> {
    let mut d = Decoder::new(bytes, MAX_READBACK)?;
    let fact_count = d.count()?;
    let mut facts = Vec::with_capacity(fact_count);
    for _ in 0..fact_count {
        let identity = d.identity()?;
        let fact_bytes = d.bytes()?;
        let fact = decode_fact(&fact_bytes)?;
        if identity != fact.identity {
            return Err(CorporateActionErrorV1::DigestMismatch);
        }
        facts.push(fact);
    }
    let cut_identity = d.identity()?;
    let cut_bytes = d.bytes()?;
    let cut = decode_cut(&cut_bytes)?;
    let receipt_identity = d.identity()?;
    let receipt_bytes = d.bytes()?;
    let receipt = decode_receipt(&receipt_bytes)?;
    let outbox_identity = d.identity()?;
    d.finish()?;

    if cut_identity != cut.identity || receipt_identity != receipt.identity {
        return Err(CorporateActionErrorV1::DigestMismatch);
    }
    Ok(CorporateActionReadbackV1 {
        facts: facts.into_boxed_slice(),
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: bytes.into(),
        identity: digest(READBACK_DOMAIN, bytes),
    })
}
