//! Canonical bounded storage encoding for a Strategy Input Binding declaration.

use super::{
    MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit,
    UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope, validate_request,
};
use crate::owner::source_binding::BindingDigest;

pub(crate) const VERSION: u16 = 1;
pub(crate) const MAX_REQUEST_BYTES: usize = 64 * 1024;
pub(crate) const MAX_TEXT_BYTES: usize = 16 * 1024;
pub(crate) const MAX_INSTRUMENTS: usize = 4_096;
const DOMAIN: &[u8] = b"VIBE_STRATEGY_INPUT_BINDING_DECLARATION_V1";
const MEANING_DOMAIN: &[u8] = b"VIBE_STRATEGY_INPUT_BINDING_DECLARATION_MEANING_V1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CodecError {
    InvalidRequest,
    CapacityExceeded,
    CodecMismatch,
}

pub(crate) fn encode_request_v1(
    request: &UntrustedStrategyInputBindingRequest,
) -> Result<Vec<u8>, CodecError> {
    validate_request(request).map_err(|_| CodecError::InvalidRequest)?;
    let mut encoder = Encoder::default();
    encoder.bytes(DOMAIN)?;
    encoder.u16(VERSION);
    encoder.digest(request.research_request_identity);
    encoder.digest(request.strategy_design_identity);
    encoder.digest(request.input_role_identity);
    match &request.scope {
        UntrustedStrategyInputScope::ExactInstrument { instrument } => {
            encoder.u8(1);
            encoder.string(instrument)?;
        }
        UntrustedStrategyInputScope::UniverseSelection { selection_identity } => {
            encoder.u8(2);
            encoder.digest(*selection_identity);
        }
        UntrustedStrategyInputScope::InstrumentSet { instruments } => {
            if instruments.len() > MAX_INSTRUMENTS {
                return Err(CodecError::CapacityExceeded);
            }
            encoder.u8(3);
            encoder
                .u32(u32::try_from(instruments.len()).map_err(|_| CodecError::CapacityExceeded)?);
            for instrument in instruments {
                encoder.string(instrument)?;
            }
        }
    }
    encoder.u8(field_semantic_code(request.field_semantic));
    encoder.u8(channel_code(request.channel));
    encoder.string(&request.timeframe)?;
    encoder.u8(unit_code(request.unit));
    encoder.u8(request.scale);
    encoder.digest(request.pit_request_identity);
    encoder.digest(request.pit_request_digest);
    encoder.digest(request.snapshot_identity);
    encoder.digest(request.snapshot_fact_digest);
    encoder.digest(request.observation_batch_digest);
    encoder.digest(request.source_binding_identity);
    encoder.digest(request.source_frontier_digest);
    encoder.digest(request.correction_frontier_digest);
    encoder.digest(request.instrument_master_digest);
    encoder.digest(request.universe_selection_digest);
    encoder.digest(request.market_semantics_identity);
    encoder.u64(request.decision_cut);
    encoder.finish()
}

pub(crate) fn decode_request_v1(
    bytes: &[u8],
) -> Result<UntrustedStrategyInputBindingRequest, CodecError> {
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err(CodecError::CapacityExceeded);
    }
    let mut decoder = Decoder::new(bytes);
    decoder.expect_bytes(DOMAIN)?;
    if decoder.u16()? != VERSION {
        return Err(CodecError::CodecMismatch);
    }
    let research_request_identity = decoder.digest()?;
    let strategy_design_identity = decoder.digest()?;
    let input_role_identity = decoder.digest()?;
    let scope = match decoder.u8()? {
        1 => UntrustedStrategyInputScope::ExactInstrument {
            instrument: decoder.string()?,
        },
        2 => UntrustedStrategyInputScope::UniverseSelection {
            selection_identity: decoder.digest()?,
        },
        3 => {
            let count =
                usize::try_from(decoder.u32()?).map_err(|_| CodecError::CapacityExceeded)?;
            if count > MAX_INSTRUMENTS {
                return Err(CodecError::CapacityExceeded);
            }
            let mut instruments = Vec::with_capacity(count);
            for _ in 0..count {
                instruments.push(decoder.string()?);
            }
            UntrustedStrategyInputScope::InstrumentSet { instruments }
        }
        _ => return Err(CodecError::CodecMismatch),
    };
    let field_semantic = decode_field_semantic(decoder.u8()?)?;
    let channel = decode_channel(decoder.u8()?)?;
    let timeframe = decoder.string()?;
    let unit = decode_unit(decoder.u8()?)?;
    let scale = decoder.u8()?;
    let request = UntrustedStrategyInputBindingRequest {
        research_request_identity,
        strategy_design_identity,
        input_role_identity,
        scope,
        field_semantic,
        channel,
        timeframe,
        unit,
        scale,
        pit_request_identity: decoder.digest()?,
        pit_request_digest: decoder.digest()?,
        snapshot_identity: decoder.digest()?,
        snapshot_fact_digest: decoder.digest()?,
        observation_batch_digest: decoder.digest()?,
        source_binding_identity: decoder.digest()?,
        source_frontier_digest: decoder.digest()?,
        correction_frontier_digest: decoder.digest()?,
        instrument_master_digest: decoder.digest()?,
        universe_selection_digest: decoder.digest()?,
        market_semantics_identity: decoder.digest()?,
        decision_cut: decoder.u64()?,
    };
    decoder.finish()?;
    let canonical = encode_request_v1(&request)?;
    if canonical != bytes {
        return Err(CodecError::CodecMismatch);
    }
    Ok(request)
}

pub(crate) fn meaning_digest_v1(bytes: &[u8]) -> Result<BindingDigest, CodecError> {
    decode_request_v1(bytes)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(MEANING_DOMAIN);
    hasher.update(bytes);
    Ok(BindingDigest::from_untrusted_bytes(
        *hasher.finalize().as_bytes(),
    ))
}

const fn field_semantic_code(value: MarketDataFieldSemantic) -> u8 {
    match value {
        MarketDataFieldSemantic::BarOpenPrice => 1,
        MarketDataFieldSemantic::BarHighPrice => 2,
        MarketDataFieldSemantic::BarLowPrice => 3,
        MarketDataFieldSemantic::BarClosePrice => 4,
        MarketDataFieldSemantic::BarVolumeQuantity => 5,
        MarketDataFieldSemantic::QuoteBidPrice => 6,
        MarketDataFieldSemantic::QuoteAskPrice => 7,
        MarketDataFieldSemantic::QuoteBidSize => 8,
        MarketDataFieldSemantic::QuoteAskSize => 9,
        MarketDataFieldSemantic::TradeLastPrice => 10,
        MarketDataFieldSemantic::TradeLastSize => 11,
        MarketDataFieldSemantic::ScalarValue => 12,
    }
}

fn decode_field_semantic(value: u8) -> Result<MarketDataFieldSemantic, CodecError> {
    Ok(match value {
        1 => MarketDataFieldSemantic::BarOpenPrice,
        2 => MarketDataFieldSemantic::BarHighPrice,
        3 => MarketDataFieldSemantic::BarLowPrice,
        4 => MarketDataFieldSemantic::BarClosePrice,
        5 => MarketDataFieldSemantic::BarVolumeQuantity,
        6 => MarketDataFieldSemantic::QuoteBidPrice,
        7 => MarketDataFieldSemantic::QuoteAskPrice,
        8 => MarketDataFieldSemantic::QuoteBidSize,
        9 => MarketDataFieldSemantic::QuoteAskSize,
        10 => MarketDataFieldSemantic::TradeLastPrice,
        11 => MarketDataFieldSemantic::TradeLastSize,
        12 => MarketDataFieldSemantic::ScalarValue,
        _ => return Err(CodecError::CodecMismatch),
    })
}

const fn channel_code(value: StrategyInputChannel) -> u8 {
    match value {
        StrategyInputChannel::Market => 1,
        StrategyInputChannel::Reference => 2,
        StrategyInputChannel::Economic => 3,
    }
}

fn decode_channel(value: u8) -> Result<StrategyInputChannel, CodecError> {
    Ok(match value {
        1 => StrategyInputChannel::Market,
        2 => StrategyInputChannel::Reference,
        3 => StrategyInputChannel::Economic,
        _ => return Err(CodecError::CodecMismatch),
    })
}

const fn unit_code(value: StrategyInputUnit) -> u8 {
    match value {
        StrategyInputUnit::Price => 1,
        StrategyInputUnit::Quantity => 2,
        StrategyInputUnit::Scalar => 3,
    }
}

fn decode_unit(value: u8) -> Result<StrategyInputUnit, CodecError> {
    Ok(match value {
        1 => StrategyInputUnit::Price,
        2 => StrategyInputUnit::Quantity,
        3 => StrategyInputUnit::Scalar,
        _ => return Err(CodecError::CodecMismatch),
    })
}

#[derive(Default)]
struct Encoder(Vec<u8>);

impl Encoder {
    fn finish(self) -> Result<Vec<u8>, CodecError> {
        if self.0.len() > MAX_REQUEST_BYTES {
            Err(CodecError::CapacityExceeded)
        } else {
            Ok(self.0)
        }
    }
    fn bytes(&mut self, value: &[u8]) -> Result<(), CodecError> {
        if value.len() > MAX_TEXT_BYTES {
            return Err(CodecError::CapacityExceeded);
        }
        self.u32(u32::try_from(value.len()).map_err(|_| CodecError::CapacityExceeded)?);
        self.0.extend_from_slice(value);
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), CodecError> {
        self.bytes(value.as_bytes())
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
    fn digest(&mut self, value: BindingDigest) {
        self.0.extend_from_slice(value.as_bytes());
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], CodecError> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(CodecError::CapacityExceeded)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(CodecError::CodecMismatch)?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, CodecError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, CodecError> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| CodecError::CodecMismatch)?,
        ))
    }
    fn u32(&mut self) -> Result<u32, CodecError> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| CodecError::CodecMismatch)?,
        ))
    }
    fn u64(&mut self) -> Result<u64, CodecError> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| CodecError::CodecMismatch)?,
        ))
    }
    fn bytes(&mut self) -> Result<&'a [u8], CodecError> {
        let count = usize::try_from(self.u32()?).map_err(|_| CodecError::CapacityExceeded)?;
        if count > MAX_TEXT_BYTES {
            return Err(CodecError::CapacityExceeded);
        }
        self.take(count)
    }
    fn expect_bytes(&mut self, expected: &[u8]) -> Result<(), CodecError> {
        (self.bytes()? == expected)
            .then_some(())
            .ok_or(CodecError::CodecMismatch)
    }
    fn string(&mut self) -> Result<String, CodecError> {
        String::from_utf8(self.bytes()?.to_vec()).map_err(|_| CodecError::CodecMismatch)
    }
    fn digest(&mut self) -> Result<BindingDigest, CodecError> {
        Ok(BindingDigest::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| CodecError::CodecMismatch)?,
        ))
    }
    fn finish(self) -> Result<(), CodecError> {
        (self.offset == self.bytes.len())
            .then_some(())
            .ok_or(CodecError::CodecMismatch)
    }
}
