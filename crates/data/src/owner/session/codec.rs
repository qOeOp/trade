use super::{SessionErrorV1, SessionIdentityV1};

pub(crate) const SCHEMA: u16 = 1;
pub(crate) const DAY_NS: i128 = 86_400_000_000_000;
pub(crate) const MAX_IDENTITY_BYTES: usize = 256;
pub(crate) const MAX_LOCATOR_BYTES: usize = 32 * 1024;
pub(crate) const MAX_FACTS: usize = 32_768;
pub(crate) const MAX_FACT_BYTES: usize = 128 * 1024;
pub(crate) const MAX_READBACK_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const FACT_DOMAIN: &[u8] = b"vibe.market-data.session-fact.v1\0";
pub(crate) const REQUEST_DOMAIN: &[u8] = b"vibe.market-data.session-request.v1\0";
pub(crate) const CUT_DOMAIN: &[u8] = b"vibe.market-data.session-cut.v1\0";
pub(crate) const RECEIPT_DOMAIN: &[u8] = b"vibe.market-data.session-receipt.v1\0";
pub(crate) const READBACK_DOMAIN: &[u8] = b"vibe.market-data.session-readback.v1\0";

pub(crate) fn digest(domain: &[u8], bytes: &[u8]) -> SessionIdentityV1 {
    let mut h = blake3::Hasher::new();
    h.update(domain);
    h.update(bytes);
    SessionIdentityV1::from_untrusted_bytes(*h.finalize().as_bytes())
}
pub(crate) fn nonzero(v: SessionIdentityV1) -> bool {
    v.as_bytes().iter().any(|b| *b != 0)
}
pub(crate) fn header(o: &mut Vec<u8>) {
    o.extend_from_slice(&SCHEMA.to_be_bytes());
    o.extend_from_slice(&0u16.to_be_bytes());
}
pub(crate) fn id(o: &mut Vec<u8>, v: SessionIdentityV1) -> Result<(), SessionErrorV1> {
    if !nonzero(v) {
        return Err(SessionErrorV1::InvalidDependency);
    }
    o.extend_from_slice(v.as_bytes());
    Ok(())
}
pub(crate) fn bytes(o: &mut Vec<u8>, v: &[u8], cap: usize) -> Result<(), SessionErrorV1> {
    if v.is_empty() || v.len() > cap {
        return Err(SessionErrorV1::CapacityExceeded);
    }
    o.extend_from_slice(
        &u32::try_from(v.len())
            .map_err(|_| SessionErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );
    o.extend_from_slice(v);
    Ok(())
}

pub(crate) struct Decoder<'a> {
    b: &'a [u8],
    p: usize,
}
impl<'a> Decoder<'a> {
    pub(crate) fn new(b: &'a [u8]) -> Result<Self, SessionErrorV1> {
        let mut d = Self { b, p: 0 };
        if d.u16()? != SCHEMA || d.u16()? != 0 {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        Ok(d)
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], SessionErrorV1> {
        let e = self
            .p
            .checked_add(n)
            .ok_or(SessionErrorV1::CapacityExceeded)?;
        let v = self
            .b
            .get(self.p..e)
            .ok_or(SessionErrorV1::StoreUntrusted)?;
        self.p = e;
        Ok(v)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, SessionErrorV1> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u16(&mut self) -> Result<u16, SessionErrorV1> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, SessionErrorV1> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn u64(&mut self) -> Result<u64, SessionErrorV1> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn i32(&mut self) -> Result<i32, SessionErrorV1> {
        Ok(i32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn i128(&mut self) -> Result<i128, SessionErrorV1> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        ))
    }
    pub(crate) fn id(&mut self) -> Result<SessionIdentityV1, SessionErrorV1> {
        let v = SessionIdentityV1::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| SessionErrorV1::StoreUntrusted)?,
        );

        if !nonzero(v) {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        Ok(v)
    }
    pub(crate) fn bytes(&mut self, cap: usize) -> Result<Box<[u8]>, SessionErrorV1> {
        let n = usize::try_from(self.u32()?).map_err(|_| SessionErrorV1::CapacityExceeded)?;
        if n == 0 || n > cap {
            return Err(SessionErrorV1::CapacityExceeded);
        }
        Ok(self.take(n)?.into())
    }
    pub(crate) fn opt_id(&mut self) -> Result<Option<SessionIdentityV1>, SessionErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.id()?)),
            _ => Err(SessionErrorV1::StoreUntrusted),
        }
    }
    pub(crate) fn finish(self) -> Result<(), SessionErrorV1> {
        if self.p == self.b.len() {
            Ok(())
        } else {
            Err(SessionErrorV1::StoreUntrusted)
        }
    }
}
