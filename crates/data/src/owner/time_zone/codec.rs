use super::{TimeZoneErrorV1, TimeZoneIdentity};

pub(crate) const SCHEMA_V1: u16 = 1;
pub(crate) const MAX_IDENTITY_BYTES: usize = 256;
pub(crate) const MAX_LOCATOR_BYTES: usize = 16 * 1024;
pub(crate) const MAX_FACTS: usize = 16_384;
pub(crate) const MAX_FACT_BYTES: usize = 64 * 1024;
pub(crate) const MAX_READBACK_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const FACT_DOMAIN: &[u8] = b"vibe.market-data.time-zone-fact.v1\0";
pub(crate) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.time-zone-request.v1\0";
pub(crate) const CUT_DOMAIN: &[u8] = b"vibe.market-data.time-zone-cut.v1\0";
pub(crate) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.time-zone-receipt.v1\0";
pub(crate) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.time-zone-readback.v1\0";

pub(crate) fn digest(domain: &[u8], bytes: &[u8]) -> TimeZoneIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    TimeZoneIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

pub(crate) fn nonzero(value: TimeZoneIdentity) -> bool {
    value.as_bytes().iter().any(|byte| *byte != 0)
}

pub(crate) fn header(output: &mut Vec<u8>) {
    output.extend_from_slice(&SCHEMA_V1.to_be_bytes());
    output.extend_from_slice(&0_u16.to_be_bytes());
}

pub(crate) fn bytes(output: &mut Vec<u8>, value: &[u8], cap: usize) -> Result<(), TimeZoneErrorV1> {
    if value.is_empty() || value.len() > cap {
        return Err(TimeZoneErrorV1::CapacityExceeded);
    }
    output.extend_from_slice(
        &u32::try_from(value.len())
            .map_err(|_| TimeZoneErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );
    output.extend_from_slice(value);
    Ok(())
}

pub(crate) fn identity(
    output: &mut Vec<u8>,
    value: TimeZoneIdentity,
) -> Result<(), TimeZoneErrorV1> {
    if !nonzero(value) {
        return Err(TimeZoneErrorV1::InvalidDependency);
    }
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

pub(crate) struct Decoder<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Decoder<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self, TimeZoneErrorV1> {
        let mut decoder = Self { bytes, position: 0 };
        if decoder.u16()? != SCHEMA_V1 || decoder.u16()? != 0 {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        Ok(decoder)
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], TimeZoneErrorV1> {
        let end = self
            .position
            .checked_add(length)
            .ok_or(TimeZoneErrorV1::CapacityExceeded)?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
        self.position = end;
        Ok(value)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, TimeZoneErrorV1> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u16(&mut self) -> Result<u16, TimeZoneErrorV1> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, TimeZoneErrorV1> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn u64(&mut self) -> Result<u64, TimeZoneErrorV1> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn i32(&mut self) -> Result<i32, TimeZoneErrorV1> {
        Ok(i32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn i128(&mut self) -> Result<i128, TimeZoneErrorV1> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn identity(&mut self) -> Result<TimeZoneIdentity, TimeZoneErrorV1> {
        let value = TimeZoneIdentity::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
        );

        if !nonzero(value) {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        Ok(value)
    }
    pub(crate) fn bytes(&mut self, cap: usize) -> Result<Box<[u8]>, TimeZoneErrorV1> {
        let length = usize::try_from(self.u32()?).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?;
        if length == 0 || length > cap {
            return Err(TimeZoneErrorV1::CapacityExceeded);
        }
        Ok(self.take(length)?.into())
    }
    pub(crate) fn optional_identity(
        &mut self,
    ) -> Result<Option<TimeZoneIdentity>, TimeZoneErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(TimeZoneErrorV1::StoreUntrusted),
        }
    }
    pub(crate) fn optional_i128(&mut self) -> Result<Option<i128>, TimeZoneErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(TimeZoneErrorV1::StoreUntrusted),
        }
    }
    pub(crate) fn finish(self) -> Result<(), TimeZoneErrorV1> {
        if self.position == self.bytes.len() {
            Ok(())
        } else {
            Err(TimeZoneErrorV1::StoreUntrusted)
        }
    }
}
