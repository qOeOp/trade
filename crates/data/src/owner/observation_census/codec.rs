#![allow(
    dead_code,
    reason = "W0 freezes the checked durable codec seam before W1 storage"
)]

use super::{ObservationCensusErrorV1, ObservationCensusIdentity};

pub(super) const VERSION: u16 = 1;
pub(super) const MAX_JOIN_TEXT_BYTES: usize = 256;
pub(super) const MAX_LOCATOR_TEXT_BYTES: usize = 1_024;
pub(super) const MAX_JOIN_ROLES: usize = 256;
pub(super) const MAX_REQUEST_BYTES: usize = 256 * 1024;
pub(super) const MAX_CENSUS_ENTRIES: usize = 65_536;
pub(super) const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
pub(super) const REQUEST_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_REQUEST_V1";
pub(super) const ENTRY_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_ENTRY_V1";
pub(super) const CENSUS_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_RECORD_V1";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_RECEIPT_V1";
pub(super) const JOINED_CUT_CUSTODY_DOMAIN: &[u8] = b"VIBE_STRATEGY_INPUT_JOINED_CUT_CUSTODY_V1";
pub(super) const STORAGE_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_STORAGE_V1";

pub(super) fn digest(domain: &[u8], bytes: &[u8]) -> ObservationCensusIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&[0]);
    hasher.update(bytes);
    ObservationCensusIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}
pub(super) fn nonzero(value: ObservationCensusIdentity) -> bool {
    value.as_bytes().iter().any(|byte| *byte != 0)
}

#[derive(Default)]
pub(super) struct Encoder(Vec<u8>);
impl Encoder {
    pub(super) fn finish(self) -> Result<Vec<u8>, ObservationCensusErrorV1> {
        if self.0.len() > MAX_RECORD_BYTES {
            Err(ObservationCensusErrorV1::CapacityExceeded)
        } else {
            Ok(self.0)
        }
    }
    pub(super) fn u16(&mut self, value: u16) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    pub(super) fn u32(&mut self, value: u32) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn u64(&mut self, value: u64) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn raw(&mut self, value: &[u8]) {
        self.0.extend(value);
    }
    pub(super) fn digest(&mut self, value: ObservationCensusIdentity) {
        self.0.extend(value.as_bytes());
    }
    pub(super) fn bytes(
        &mut self,
        value: &[u8],
        cap: usize,
    ) -> Result<(), ObservationCensusErrorV1> {
        if value.is_empty() || value.len() > cap {
            return Err(ObservationCensusErrorV1::CapacityExceeded);
        }
        self.u32(
            u32::try_from(value.len()).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?,
        );
        self.raw(value);
        Ok(())
    }
}

pub(super) struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    pub(super) const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    pub(super) fn finish(self) -> Result<(), ObservationCensusErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(ObservationCensusErrorV1::CodecMismatch)
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], ObservationCensusErrorV1> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(ObservationCensusErrorV1::CodecMismatch)?;
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    pub(super) fn u16(&mut self) -> Result<u16, ObservationCensusErrorV1> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
        Ok(u16::from_be_bytes(bytes))
    }

    pub(super) fn u8(&mut self) -> Result<u8, ObservationCensusErrorV1> {
        Ok(self.take(1)?[0])
    }

    pub(super) fn u32(&mut self) -> Result<u32, ObservationCensusErrorV1> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
        Ok(u32::from_be_bytes(bytes))
    }

    pub(super) fn u64(&mut self) -> Result<u64, ObservationCensusErrorV1> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
        Ok(u64::from_be_bytes(bytes))
    }

    pub(super) fn digest(&mut self) -> Result<ObservationCensusIdentity, ObservationCensusErrorV1> {
        let bytes: [u8; 32] = self
            .take(32)?
            .try_into()
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)?;
        Ok(ObservationCensusIdentity::from_untrusted_bytes(bytes))
    }

    pub(super) fn fixed<const N: usize>(&mut self) -> Result<[u8; N], ObservationCensusErrorV1> {
        self.take(N)?
            .try_into()
            .map_err(|_| ObservationCensusErrorV1::CodecMismatch)
    }

    pub(super) fn bytes(&mut self, cap: usize) -> Result<&'a [u8], ObservationCensusErrorV1> {
        let length =
            usize::try_from(self.u32()?).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
        if length == 0 || length > cap {
            return Err(ObservationCensusErrorV1::CapacityExceeded);
        }
        self.take(length)
    }
}
