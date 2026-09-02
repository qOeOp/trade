#![allow(
    dead_code,
    reason = "W0 freezes the checked durable codec seam before W1 storage"
)]

use super::{UniverseSelectionErrorV1, UniverseSelectionIdentity};

pub(super) const VERSION: u16 = 1;
pub(super) const MAX_ROLE_BYTES: usize = 128;
pub(super) const MAX_RULE_BYTES: usize = 64 * 1024;
pub(super) const MAX_MEMBER_FIELD_BYTES: usize = 256;
pub(super) const MAX_EXCLUSION_REASON_BYTES: usize = 256;
pub(crate) const MAX_MEMBERSHIP_RECORDS: usize = 4096;
pub(super) const MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;
pub(super) const REQUEST_DOMAIN: &[u8] = b"VIBE_UNIVERSE_SELECTION_REQUEST_V1";
pub(super) const MEMBERSHIP_DOMAIN: &[u8] = b"VIBE_HISTORICAL_MEMBERSHIP_RECORD_V1";
pub(super) const MEMBERSHIP_CUT_DOMAIN: &[u8] = b"VIBE_HISTORICAL_MEMBERSHIP_CUT_V1";
pub(super) const SELECTION_DOMAIN: &[u8] = b"VIBE_UNIVERSE_SELECTION_RECORD_V1";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"VIBE_UNIVERSE_SELECTION_RECEIPT_V1";
pub(super) const OUTBOX_DOMAIN: &[u8] = b"VIBE_UNIVERSE_SELECTION_OUTBOX_V1";
pub(crate) const STORE_GENERATION_DOMAIN: &[u8] = b"VIBE_UNIVERSE_SELECTION_STORE_V1";

pub(crate) fn digest(domain: &[u8], bytes: &[u8]) -> UniverseSelectionIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&[0]);
    hasher.update(bytes);
    UniverseSelectionIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[derive(Default)]
pub(super) struct Encoder(Vec<u8>);

impl Encoder {
    pub(super) fn finish(self) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
        if self.0.len() > MAX_RECORD_BYTES {
            Err(UniverseSelectionErrorV1::CapacityExceeded)
        } else {
            Ok(self.0)
        }
    }
    pub(super) fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    pub(super) fn u16(&mut self, value: u16) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn u32(&mut self, value: u32) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn u64(&mut self, value: u64) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn i128(&mut self, value: i128) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn digest(&mut self, value: UniverseSelectionIdentity) {
        self.0.extend(value.as_bytes());
    }
    pub(super) fn optional_i128(&mut self, value: Option<i128>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.i128(value);
            }
        }
    }
    pub(super) fn optional_digest(&mut self, value: Option<UniverseSelectionIdentity>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.digest(value);
            }
        }
    }
    pub(super) fn optional_bytes(
        &mut self,
        value: Option<&[u8]>,
        cap: usize,
    ) -> Result<(), UniverseSelectionErrorV1> {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.bytes(value, cap)?;
            }
        }
        Ok(())
    }
    pub(super) fn bytes(
        &mut self,
        value: &[u8],
        cap: usize,
    ) -> Result<(), UniverseSelectionErrorV1> {
        if value.is_empty() || value.len() > cap {
            return Err(UniverseSelectionErrorV1::CapacityExceeded);
        }
        self.u32(
            u32::try_from(value.len()).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?,
        );
        self.0.extend(value);
        Ok(())
    }
}

pub(crate) fn nonzero(value: UniverseSelectionIdentity) -> bool {
    value.as_bytes().iter().any(|byte| *byte != 0)
}

pub(super) struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    pub(super) const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, len: usize) -> Result<&'a [u8], UniverseSelectionErrorV1> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(UniverseSelectionErrorV1::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(UniverseSelectionErrorV1::CodecMismatch)?;
        self.offset = end;
        Ok(value)
    }
    pub(super) fn finish(self) -> Result<(), UniverseSelectionErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(UniverseSelectionErrorV1::CodecMismatch)
        }
    }
    pub(super) fn u8(&mut self) -> Result<u8, UniverseSelectionErrorV1> {
        Ok(self.take(1)?[0])
    }
    pub(super) fn u16(&mut self) -> Result<u16, UniverseSelectionErrorV1> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| UniverseSelectionErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn u32(&mut self) -> Result<u32, UniverseSelectionErrorV1> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| UniverseSelectionErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn u64(&mut self) -> Result<u64, UniverseSelectionErrorV1> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| UniverseSelectionErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn i128(&mut self) -> Result<i128, UniverseSelectionErrorV1> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| UniverseSelectionErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn digest(&mut self) -> Result<UniverseSelectionIdentity, UniverseSelectionErrorV1> {
        Ok(UniverseSelectionIdentity::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| UniverseSelectionErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn bytes(&mut self, cap: usize) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
        let len =
            usize::try_from(self.u32()?).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?;
        if len == 0 || len > cap {
            return Err(UniverseSelectionErrorV1::CapacityExceeded);
        }
        Ok(self.take(len)?.to_vec())
    }
    pub(super) fn optional_i128(&mut self) -> Result<Option<i128>, UniverseSelectionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(UniverseSelectionErrorV1::CodecMismatch),
        }
    }
    pub(super) fn optional_digest(
        &mut self,
    ) -> Result<Option<UniverseSelectionIdentity>, UniverseSelectionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(UniverseSelectionErrorV1::CodecMismatch),
        }
    }
    pub(super) fn optional_bytes(
        &mut self,
        cap: usize,
    ) -> Result<Option<Vec<u8>>, UniverseSelectionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.bytes(cap)?)),
            _ => Err(UniverseSelectionErrorV1::CodecMismatch),
        }
    }
}
