use sha2::{Digest, Sha256};

use super::{
    CorrectionPolicyProjectionErrorV1 as Error, CorrectionPolicyProjectionIdentityV1 as Id,
    CorrectionPolicyProjectionV1,
};

pub(super) const DOMAIN: &[u8] = b"vibe.market-data.correction-policy-projection.v1\0";
pub(super) const MAX_STREAM: usize = 512;
const MAX_BYTES: usize = 2048;

pub(super) fn encode(value: &CorrectionPolicyProjectionV1) -> Result<Box<[u8]>, Error> {
    if value.stream_identity.is_empty() || value.stream_identity.len() > MAX_STREAM {
        return Err(Error::CapacityExceeded);
    }
    let len = u32::try_from(value.stream_identity.len()).map_err(|_| Error::CapacityExceeded)?;
    let mut b = Vec::with_capacity(512);
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&0u16.to_be_bytes());
    b.extend_from_slice(&len.to_be_bytes());
    b.extend_from_slice(&value.stream_identity);
    b.extend_from_slice(&value.sequence.to_be_bytes());
    b.push(u8::from(value.successor_only));
    for d in [
        value.source_binding_identity,
        value.source_binding_fact_digest,
        value.source_binding_lineage_root,
    ] {
        b.extend_from_slice(d.as_bytes());
    }
    b.extend_from_slice(&value.source_binding_lineage_version.to_be_bytes());
    b.extend_from_slice(value.correction_frontier_digest.as_bytes());
    b.extend_from_slice(&value.effective_from_ns.to_be_bytes());
    match value.effective_until_ns {
        None => b.push(0),
        Some(v) => {
            b.push(1);
            b.extend_from_slice(&v.to_be_bytes());
        }
    }

    for v in [
        value.provider_available_ns,
        value.retrieval_ns,
        value.correction_publication_ns,
        value.owner_observation_ns,
    ] {
        b.extend_from_slice(&v.to_be_bytes());
    }
    b.extend_from_slice(&value.decision_cut.to_be_bytes());
    for d in [
        value.clock_head_identity,
        value.clock_head_digest,
        value.r0_coordinate_identity,
        value.r0_coordinate_digest,
    ] {
        b.extend_from_slice(d.as_bytes());
    }

    if b.len() > MAX_BYTES {
        return Err(Error::CapacityExceeded);
    }
    Ok(b.into_boxed_slice())
}

pub(super) fn identity(bytes: &[u8]) -> Id {
    let mut h = Sha256::new();
    h.update(DOMAIN);
    h.update(bytes);
    Id::from_untrusted_bytes(h.finalize().into())
}

#[cfg(test)]
pub(super) fn verify(bytes: &[u8], claimed: Id) -> Result<(), Error> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::CapacityExceeded);
    }
    let mut d = Decoder { bytes, at: 0 };
    if d.u16()? != 1 || d.u16()? != 0 {
        return Err(Error::CorruptCanonicalBytes);
    }
    let n = usize::try_from(d.u32()?).map_err(|_| Error::CapacityExceeded)?;
    if n == 0 || n > MAX_STREAM {
        return Err(Error::CapacityExceeded);
    }
    d.take(n)?;
    if d.u64()? == 0 || d.byte()? != 1 {
        return Err(Error::CorruptCanonicalBytes);
    }
    d.take(32 * 3)?;
    if d.u64()? == 0 {
        return Err(Error::CorruptCanonicalBytes);
    }
    d.take(32 + 16)?;
    let tag = d.byte()?;
    if tag == 1 {
        d.take(16)?;
    } else if tag != 0 {
        return Err(Error::CorruptCanonicalBytes);
    }
    d.take(16 * 4 + 8 + 32 * 4)?;
    if d.at != bytes.len() || identity(bytes) != claimed {
        return Err(Error::CorruptCanonicalBytes);
    }
    Ok(())
}

#[cfg(test)]
struct Decoder<'a> {
    bytes: &'a [u8],
    at: usize,
}
#[cfg(test)]
impl<'a> Decoder<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], Error> {
        let end = self.at.checked_add(n).ok_or(Error::CapacityExceeded)?;
        let v = self
            .bytes
            .get(self.at..end)
            .ok_or(Error::CorruptCanonicalBytes)?;
        self.at = end;
        Ok(v)
    }
    fn byte(&mut self) -> Result<u8, Error> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, Error> {
        Ok(u16::from_be_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| Error::CorruptCanonicalBytes)?,
        ))
    }
    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| Error::CorruptCanonicalBytes)?,
        ))
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| Error::CorruptCanonicalBytes)?,
        ))
    }
}
