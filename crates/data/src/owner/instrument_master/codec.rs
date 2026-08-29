use super::{InstrumentMasterError, InstrumentMasterIdentity};

pub(super) const VERSION: u16 = 1;
pub(super) const FACT_DOMAIN: &[u8] = b"VIBE_INSTRUMENT_MASTER_FACT_V1";
pub(super) const CUT_DOMAIN: &[u8] = b"VIBE_INSTRUMENT_MASTER_CUT_V1";
pub(super) const RECEIPT_DOMAIN: &[u8] = b"VIBE_INSTRUMENT_MASTER_RECEIPT_V1";
pub(super) const READBACK_DOMAIN: &[u8] = b"VIBE_INSTRUMENT_MASTER_READBACK_V1";

pub(super) fn identity(domain: &[u8], bytes: &[u8]) -> InstrumentMasterIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&[0]);
    hasher.update(bytes);
    InstrumentMasterIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

#[derive(Default)]
pub(super) struct Encoder(Vec<u8>);

impl Encoder {
    pub(super) fn finish(self) -> Vec<u8> {
        self.0
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
    pub(super) fn raw(&mut self, value: &[u8]) {
        self.0.extend(value);
    }
    pub(super) fn digest(&mut self, value: InstrumentMasterIdentity) {
        self.0.extend(value.as_bytes());
    }
    pub(super) fn bytes(&mut self, value: &[u8]) -> Result<(), InstrumentMasterError> {
        let length =
            u32::try_from(value.len()).map_err(|_| InstrumentMasterError::CodecMismatch)?;
        self.u32(length);
        self.0.extend(value);
        Ok(())
    }
    pub(super) fn string(&mut self, value: &str) -> Result<(), InstrumentMasterError> {
        self.bytes(value.as_bytes())
    }
    pub(super) fn optional_digest(&mut self, value: Option<InstrumentMasterIdentity>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.digest(value);
            }
        }
    }
    pub(super) fn optional_string(
        &mut self,
        value: Option<&str>,
    ) -> Result<(), InstrumentMasterError> {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.string(value)?;
            }
        }
        Ok(())
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
}

pub(super) struct Decoder<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Decoder<'a> {
    pub(super) const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8], InstrumentMasterError> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(InstrumentMasterError::CodecMismatch)?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or(InstrumentMasterError::CodecMismatch)?;
        self.cursor = end;
        Ok(value)
    }
    pub(super) fn finish(self) -> Result<(), InstrumentMasterError> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(InstrumentMasterError::CodecMismatch)
        }
    }
    pub(super) fn u8(&mut self) -> Result<u8, InstrumentMasterError> {
        Ok(self.take(1)?[0])
    }
    pub(super) fn u16(&mut self) -> Result<u16, InstrumentMasterError> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| InstrumentMasterError::CodecMismatch)?,
        ))
    }
    pub(super) fn u32(&mut self) -> Result<u32, InstrumentMasterError> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| InstrumentMasterError::CodecMismatch)?,
        ))
    }
    pub(super) fn u64(&mut self) -> Result<u64, InstrumentMasterError> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| InstrumentMasterError::CodecMismatch)?,
        ))
    }
    pub(super) fn i128(&mut self) -> Result<i128, InstrumentMasterError> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| InstrumentMasterError::CodecMismatch)?,
        ))
    }
    pub(super) fn digest(&mut self) -> Result<InstrumentMasterIdentity, InstrumentMasterError> {
        Ok(InstrumentMasterIdentity::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| InstrumentMasterError::CodecMismatch)?,
        ))
    }
    pub(super) fn raw_32(&mut self) -> Result<[u8; 32], InstrumentMasterError> {
        self.take(32)?
            .try_into()
            .map_err(|_| InstrumentMasterError::CodecMismatch)
    }
    pub(super) fn bytes(&mut self) -> Result<Vec<u8>, InstrumentMasterError> {
        let length =
            usize::try_from(self.u32()?).map_err(|_| InstrumentMasterError::CodecMismatch)?;
        Ok(self.take(length)?.to_vec())
    }
    pub(super) fn string(&mut self) -> Result<String, InstrumentMasterError> {
        String::from_utf8(self.bytes()?).map_err(|_| InstrumentMasterError::CodecMismatch)
    }
    pub(super) fn optional_digest(
        &mut self,
    ) -> Result<Option<InstrumentMasterIdentity>, InstrumentMasterError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(InstrumentMasterError::CodecMismatch),
        }
    }
    pub(super) fn optional_string(&mut self) -> Result<Option<String>, InstrumentMasterError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.string()?)),
            _ => Err(InstrumentMasterError::CodecMismatch),
        }
    }
    pub(super) fn optional_i128(&mut self) -> Result<Option<i128>, InstrumentMasterError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(InstrumentMasterError::CodecMismatch),
        }
    }
}

pub(super) fn count(length: usize) -> Result<u32, InstrumentMasterError> {
    u32::try_from(length).map_err(|_| InstrumentMasterError::CodecMismatch)
}
