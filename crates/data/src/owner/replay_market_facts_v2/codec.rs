use super::{
    ReplayCorporateActionTermsV2, ReplayMarketDependencyRefV2, ReplayMarketFactsErrorV2,
    ReplayPriceAdjustmentV2, ReplayReferenceFactTimeV2, ReplayReferenceFactValueV2,
    ReplayTimestampBasisV2,
};
use crate::owner::source_binding::BindingDigest;

pub(super) const FACT_DOMAIN: &[u8] = b"vibe.market-data.replay-reference-fact.v2\0";
pub(super) const CUT_DOMAIN: &[u8] = b"vibe.market-data.replay-reference-cut.v2\0";
pub(super) const FRONTIER_DOMAIN: &[u8] = b"vibe.market-data.replay-facts-frontier.v2\0";
pub(super) const FACTS_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts.v2\0";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.replay-market-facts-receipt.v2\0";
pub(super) const PIT_CLOCK_DOMAIN: &[u8] = b"vibe.market-data.replay-pit-clock.v2\0";
pub(super) const MAX_FIELD_BYTES: usize = 4 * 1024;
pub(super) const MAX_FACT_BYTES: usize = 32 * 1024;
pub(super) const MAX_CUT_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_FRONTIER_BYTES: usize = 64 * 1024;
pub(super) const MAX_AGGREGATE_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_RECEIPT_BYTES: usize = 1024;
pub(super) const MAX_FACTS_PER_CUT: usize = 4096;
pub(super) const MAX_TOTAL_FACTS: usize = 8192;

pub(super) struct Encoder {
    bytes: Vec<u8>,
    limit: usize,
    failed: bool,
}

impl Encoder {
    pub(super) fn new(limit: usize) -> Self {
        let mut this = Self {
            bytes: Vec::new(),
            limit,
            failed: false,
        };
        this.u16(2);
        this
    }

    fn extend(&mut self, value: &[u8]) {
        let fits = self
            .bytes
            .len()
            .checked_add(value.len())
            .is_some_and(|len| len <= self.limit);

        if fits && !self.failed {
            self.bytes.extend_from_slice(value);
        } else {
            self.failed = true;
        }
    }

    pub(super) fn u8(&mut self, value: u8) {
        self.extend(&[value]);
    }

    pub(super) fn u16(&mut self, value: u16) {
        self.extend(&value.to_be_bytes());
    }

    pub(super) fn u32(&mut self, value: u32) {
        self.extend(&value.to_be_bytes());
    }

    pub(super) fn u64(&mut self, value: u64) {
        self.extend(&value.to_be_bytes());
    }

    pub(super) fn i32(&mut self, value: i32) {
        self.extend(&value.to_be_bytes());
    }

    pub(super) fn i128(&mut self, value: i128) {
        self.extend(&value.to_be_bytes());
    }

    pub(super) fn digest(&mut self, value: BindingDigest) {
        self.extend(value.as_bytes());
    }

    pub(super) fn optional_i128(&mut self, value: Option<i128>) {
        if let Some(value) = value {
            self.u8(1);
            self.i128(value);
        } else {
            self.u8(0);
        }
    }

    pub(super) fn bytes(&mut self, value: &[u8]) -> Result<(), ReplayMarketFactsErrorV2> {
        if value.len() > MAX_FIELD_BYTES {
            return Err(ReplayMarketFactsErrorV2::CapacityExceeded);
        }
        self.length_prefixed(value)
    }

    pub(super) fn nested_bytes(&mut self, value: &[u8]) -> Result<(), ReplayMarketFactsErrorV2> {
        self.length_prefixed(value)
    }

    fn length_prefixed(&mut self, value: &[u8]) -> Result<(), ReplayMarketFactsErrorV2> {
        self.u32(
            u32::try_from(value.len())
                .map_err(|_| ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable)?,
        );
        self.extend(value);
        Ok(())
    }

    pub(super) fn finish(self) -> Result<Box<[u8]>, ReplayMarketFactsErrorV2> {
        if self.failed {
            Err(ReplayMarketFactsErrorV2::CapacityExceeded)
        } else {
            Ok(self.bytes.into_boxed_slice())
        }
    }
}

pub(super) fn encode_time(encoder: &mut Encoder, time: ReplayReferenceFactTimeV2) {
    encoder.i128(time.effective_from_ns);
    encoder.optional_i128(time.effective_until_ns);
    encoder.i128(time.provider_available_ns);
    encoder.i128(time.retrieval_ns);
    encoder.i128(time.correction_publication_ns);
    encoder.i128(time.owner_observation_ns);
    encoder.u64(time.decision_cut);
}

pub(super) fn encode_value(
    encoder: &mut Encoder,
    value: &ReplayReferenceFactValueV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    encoder.u16(value.kind() as u16);
    match value {
        ReplayReferenceFactValueV2::Calendar {
            calendar_identity,
            trading_day,
            is_open,
        } => {
            encoder.bytes(calendar_identity)?;
            encoder.i32(*trading_day);
            encoder.u8(u8::from(*is_open));
        }
        ReplayReferenceFactValueV2::Session {
            session_identity,
            calendar_identity,
            opens_at_ns,
            closes_at_ns,
        } => {
            encoder.bytes(session_identity)?;
            encoder.bytes(calendar_identity)?;
            encoder.i128(*opens_at_ns);
            encoder.i128(*closes_at_ns);
        }
        ReplayReferenceFactValueV2::TimeZone {
            time_zone_identity,
            ruleset_identity,
            offset_seconds,
        } => {
            encoder.bytes(time_zone_identity)?;
            encoder.digest(*ruleset_identity);
            encoder.i32(*offset_seconds);
        }
        ReplayReferenceFactValueV2::MarketSemantics {
            normalization_identity,
            price_adjustment,
            timestamp_basis,
            price_unit_identity,
            size_unit_identity,
        } => {
            encoder.digest(*normalization_identity);
            encoder.u16(*price_adjustment as u16);
            encoder.u16(*timestamp_basis as u16);
            encoder.digest(*price_unit_identity);
            encoder.digest(*size_unit_identity);
        }
        ReplayReferenceFactValueV2::CorrectionPolicy {
            stream_identity,
            sequence,
            successor_only,
        } => {
            encoder.bytes(stream_identity)?;
            encoder.u64(*sequence);
            encoder.u8(u8::from(*successor_only));
        }
        ReplayReferenceFactValueV2::CorporateAction {
            action_identity,
            instrument,
            terms,
        } => {
            encoder.digest(*action_identity);
            encoder.bytes(instrument)?;
            encode_action_terms(encoder, terms)?;
        }
        ReplayReferenceFactValueV2::HistoricalMembership {
            selection_identity,
            member_key,
            instrument,
            included,
        } => {
            encoder.digest(*selection_identity);
            encoder.bytes(member_key)?;
            encoder.bytes(instrument)?;
            encoder.u8(u8::from(*included));
        }
    }
    Ok(())
}

fn encode_action_terms(
    encoder: &mut Encoder,
    terms: &ReplayCorporateActionTermsV2,
) -> Result<(), ReplayMarketFactsErrorV2> {
    match terms {
        ReplayCorporateActionTermsV2::Split {
            numerator,
            denominator,
        } => {
            encoder.u16(1);
            encoder.u64(*numerator);
            encoder.u64(*denominator);
        }
        ReplayCorporateActionTermsV2::CashDividend {
            mantissa,
            scale,
            currency_identity,
        } => {
            encoder.u16(2);
            encoder.i128(*mantissa);
            encoder.u8(*scale);
            encoder.bytes(currency_identity)?;
        }
        ReplayCorporateActionTermsV2::SymbolChange {
            successor_instrument,
        } => {
            encoder.u16(3);
            encoder.bytes(successor_instrument)?;
        }
        ReplayCorporateActionTermsV2::Expiry => encoder.u16(4),
        ReplayCorporateActionTermsV2::Roll {
            successor_instrument,
        } => {
            encoder.u16(5);
            encoder.bytes(successor_instrument)?;
        }
    }
    Ok(())
}

pub(super) fn encode_dependency(encoder: &mut Encoder, value: ReplayMarketDependencyRefV2) {
    encoder.u16(value.kind() as u16);
    encoder.digest(value.identity());
    encoder.digest(value.digest());
}

pub(super) fn digest(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[allow(
    dead_code,
    reason = "used by Owner-private issuance once the TARGET canonical-store resolver is connected"
)]
pub(super) fn valid_adjustment(value: ReplayPriceAdjustmentV2) -> bool {
    matches!(
        value,
        ReplayPriceAdjustmentV2::Raw
            | ReplayPriceAdjustmentV2::SplitAdjusted
            | ReplayPriceAdjustmentV2::TotalReturnAdjusted
    )
}

#[allow(
    dead_code,
    reason = "used by Owner-private issuance once the TARGET canonical-store resolver is connected"
)]
pub(super) fn valid_timestamp_basis(value: ReplayTimestampBasisV2) -> bool {
    matches!(
        value,
        ReplayTimestampBasisV2::EventEffective
            | ReplayTimestampBasisV2::IntervalOpen
            | ReplayTimestampBasisV2::IntervalClose
    )
}
