use super::{CalendarErrorV1, CalendarIdentityV1};

pub(super) const VERSION: u16 = 1;
pub(super) const FACT_DOMAIN: &[u8] = b"vibe.market-data.calendar-fact.v1\0";
pub(super) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.calendar-request.v1\0";
pub(super) const CUT_DOMAIN: &[u8] = b"vibe.market-data.calendar-cut.v1\0";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.calendar-receipt.v1\0";
pub(super) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.calendar-readback.v1\0";
pub(crate) const STORE_DOMAIN: &[u8] = b"vibe.market-data.calendar-store.v1\0";
pub(super) const MAX_IDENTITY_BYTES: usize = 512;
pub(super) const MAX_LOCATOR_BYTES: usize = 256 * 1024;
pub(super) const MAX_DAYS: usize = 16_384;
pub(super) const MAX_ARTIFACT_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn digest(domain: &[u8], bytes: &[u8]) -> CalendarIdentityV1 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    CalendarIdentityV1::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

pub(super) fn nonzero(value: CalendarIdentityV1) -> bool {
    value.as_bytes() != &[0; 32]
}

#[derive(Default)]
pub(super) struct Encoder(Vec<u8>);

impl Encoder {
    pub(super) fn finish(self) -> Result<Box<[u8]>, CalendarErrorV1> {
        if self.0.is_empty() || self.0.len() > MAX_ARTIFACT_BYTES {
            Err(CalendarErrorV1::CapacityExceeded)
        } else {
            Ok(self.0.into_boxed_slice())
        }
    }
    pub(super) fn u8(&mut self, value: u8) {
        self.0.push(value);
    }
    pub(super) fn bool(&mut self, value: bool) {
        self.u8(u8::from(value));
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
    pub(super) fn i32(&mut self, value: i32) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn i128(&mut self, value: i128) {
        self.0.extend(value.to_be_bytes());
    }
    pub(super) fn identity(&mut self, value: CalendarIdentityV1) {
        self.0.extend(value.as_bytes());
    }
    pub(super) fn optional_identity(&mut self, value: Option<CalendarIdentityV1>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.identity(value);
            }
        }
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
    pub(super) fn bytes(&mut self, value: &[u8], cap: usize) -> Result<(), CalendarErrorV1> {
        if value.is_empty() || value.len() > cap {
            return Err(CalendarErrorV1::CapacityExceeded);
        }
        self.u32(u32::try_from(value.len()).map_err(|_| CalendarErrorV1::CapacityExceeded)?);
        self.0.extend(value);
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
    fn take(&mut self, length: usize) -> Result<&'a [u8], CalendarErrorV1> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(CalendarErrorV1::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(CalendarErrorV1::CodecMismatch)?;
        self.offset = end;
        Ok(value)
    }
    pub(super) fn finish(self) -> Result<(), CalendarErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(CalendarErrorV1::CodecMismatch)
        }
    }
    pub(super) fn u8(&mut self) -> Result<u8, CalendarErrorV1> {
        Ok(self.take(1)?[0])
    }
    pub(super) fn bool(&mut self) -> Result<bool, CalendarErrorV1> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(CalendarErrorV1::CodecMismatch),
        }
    }
    pub(super) fn u16(&mut self) -> Result<u16, CalendarErrorV1> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn u32(&mut self) -> Result<u32, CalendarErrorV1> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn u64(&mut self) -> Result<u64, CalendarErrorV1> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn i32(&mut self) -> Result<i32, CalendarErrorV1> {
        Ok(i32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn i128(&mut self) -> Result<i128, CalendarErrorV1> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn identity(&mut self) -> Result<CalendarIdentityV1, CalendarErrorV1> {
        Ok(CalendarIdentityV1::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| CalendarErrorV1::CodecMismatch)?,
        ))
    }
    pub(super) fn optional_identity(
        &mut self,
    ) -> Result<Option<CalendarIdentityV1>, CalendarErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(CalendarErrorV1::CodecMismatch),
        }
    }
    pub(super) fn optional_i128(&mut self) -> Result<Option<i128>, CalendarErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(CalendarErrorV1::CodecMismatch),
        }
    }
    pub(super) fn bytes(&mut self, cap: usize) -> Result<Box<[u8]>, CalendarErrorV1> {
        let length = usize::try_from(self.u32()?).map_err(|_| CalendarErrorV1::CapacityExceeded)?;
        if length == 0 || length > cap {
            return Err(CalendarErrorV1::CapacityExceeded);
        }
        Ok(self.take(length)?.to_vec().into_boxed_slice())
    }
}
