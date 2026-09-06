//! Closed Market Data catalog for business-valued reference facts.
//!
//! R0 proves when an Owner observed source material.  This catalog separately owns the business
//! value and its effective interval.  Positive entries are crate-private and are admitted only by
//! the PostgreSQL catalog writer; native Calendar, Time Zone and Session resolvers receive an
//! authenticated entry rather than caller-authored business values.

#![allow(
    dead_code,
    reason = "the closed catalog is consumed only by native reference resolvers"
)]

use std::fmt::Display;

use super::source_binding::BindingDigest;

const KEY_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-catalog-key.v1\0";
const ENTRY_DOMAIN: &[u8] = b"vibe.market-data.reference-fact-catalog-entry.v1\0";
const MAX_BYTES: usize = 64 * 1024;

pub(crate) type ReferenceFactCatalogIdentityV1 = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum ReferenceFactCatalogKindV1 {
    Calendar = 1,
    TimeZone = 2,
    Session = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum ReferenceFactLocalResolutionV1 {
    Exact = 1,
    EarlierInstant = 2,
    LaterInstant = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactLocalBoundaryV1 {
    pub(crate) day: i32,
    pub(crate) nanos_of_day: u64,
    pub(crate) resolution: ReferenceFactLocalResolutionV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactCatalogValueV1 {
    Calendar {
        calendar_identity: Box<[u8]>,
        day: i32,
        is_open: bool,
    },
    TimeZone {
        time_zone_identity: Box<[u8]>,
        ruleset_identity: ReferenceFactCatalogIdentityV1,
        utc_offset_seconds: i32,
    },
    Session {
        session_identity: Box<[u8]>,
        trading_day: i32,
        interval_ordinal: u32,
        local_open: ReferenceFactLocalBoundaryV1,
        local_close: ReferenceFactLocalBoundaryV1,
    },
}

impl ReferenceFactCatalogValueV1 {
    pub(crate) const fn kind(&self) -> ReferenceFactCatalogKindV1 {
        match self {
            Self::Calendar { .. } => ReferenceFactCatalogKindV1::Calendar,
            Self::TimeZone { .. } => ReferenceFactCatalogKindV1::TimeZone,
            Self::Session { .. } => ReferenceFactCatalogKindV1::Session,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactCatalogSourceV1 {
    pub(crate) source_binding_identity: ReferenceFactCatalogIdentityV1,
    pub(crate) source_binding_fact_digest: ReferenceFactCatalogIdentityV1,
    pub(crate) source_binding_lineage_root: ReferenceFactCatalogIdentityV1,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_digest: ReferenceFactCatalogIdentityV1,
    pub(crate) correction_frontier_digest: ReferenceFactCatalogIdentityV1,
    pub(crate) admission_identity: ReferenceFactCatalogIdentityV1,
}

/// Bootstrap/admin input.  It carries no positive authority until sealed and durably re-read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedReferenceFactCatalogProposalV1 {
    pub(crate) command_identity: ReferenceFactCatalogIdentityV1,
    pub(crate) scope_identity: ReferenceFactCatalogIdentityV1,
    pub(crate) revision: u64,
    pub(crate) lineage_root: ReferenceFactCatalogIdentityV1,
    pub(crate) predecessor_identity: Option<ReferenceFactCatalogIdentityV1>,
    pub(crate) correction_sequence: u64,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) source: ReferenceFactCatalogSourceV1,
    pub(crate) value: ReferenceFactCatalogValueV1,
    pub(crate) stable_correlation: ReferenceFactCatalogIdentityV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedReferenceFactCatalogLocatorV1 {
    pub(crate) entry_identity: ReferenceFactCatalogIdentityV1,
    pub(crate) entry_digest: ReferenceFactCatalogIdentityV1,
}

impl UntrustedReferenceFactCatalogLocatorV1 {
    pub(crate) const fn from_untrusted(
        entry_identity: ReferenceFactCatalogIdentityV1,
        entry_digest: ReferenceFactCatalogIdentityV1,
    ) -> Self {
        Self {
            entry_identity,
            entry_digest,
        }
    }
}

/// Positive business fact.  Fields stay private to force exact verification through this module.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReferenceFactCatalogEntryV1 {
    command_identity: ReferenceFactCatalogIdentityV1,
    scope_identity: ReferenceFactCatalogIdentityV1,
    revision: u64,
    lineage_root: ReferenceFactCatalogIdentityV1,
    predecessor_identity: Option<ReferenceFactCatalogIdentityV1>,
    correction_sequence: u64,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    source: ReferenceFactCatalogSourceV1,
    value: ReferenceFactCatalogValueV1,
    stable_correlation: ReferenceFactCatalogIdentityV1,
    canonical_bytes: Box<[u8]>,
    identity: ReferenceFactCatalogIdentityV1,
}

impl ReferenceFactCatalogEntryV1 {
    pub(crate) const fn identity(&self) -> ReferenceFactCatalogIdentityV1 {
        self.identity
    }
    pub(crate) const fn digest(&self) -> ReferenceFactCatalogIdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn scope_identity(&self) -> ReferenceFactCatalogIdentityV1 {
        self.scope_identity
    }
    pub(crate) const fn lineage_root(&self) -> ReferenceFactCatalogIdentityV1 {
        self.lineage_root
    }
    pub(crate) const fn predecessor_identity(&self) -> Option<ReferenceFactCatalogIdentityV1> {
        self.predecessor_identity
    }
    pub(crate) const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub(crate) const fn effective_from_ns(&self) -> i128 {
        self.effective_from_ns
    }
    pub(crate) const fn effective_until_ns(&self) -> Option<i128> {
        self.effective_until_ns
    }
    pub(crate) const fn source(&self) -> ReferenceFactCatalogSourceV1 {
        self.source
    }
    pub(crate) const fn stable_correlation(&self) -> ReferenceFactCatalogIdentityV1 {
        self.stable_correlation
    }
    pub(crate) const fn value(&self) -> &ReferenceFactCatalogValueV1 {
        &self.value
    }
    pub(crate) const fn locator(&self) -> UntrustedReferenceFactCatalogLocatorV1 {
        UntrustedReferenceFactCatalogLocatorV1 {
            entry_identity: self.identity,
            entry_digest: self.identity,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReferenceFactCatalogErrorV1 {
    InvalidProposal,
    DependencyMismatch,
    NonCanonical,
    CapacityExceeded,
    UnknownIdentity,
    RequestConflict,
    StoreUntrusted,
    StoreUnavailable,
}

impl Display for ReferenceFactCatalogErrorV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("reference fact catalog rejected the operation")
    }
}

impl std::error::Error for ReferenceFactCatalogErrorV1 {}

pub(crate) fn seal_reference_fact_catalog_entry_v1(
    proposal: &UntrustedReferenceFactCatalogProposalV1,
) -> Result<ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1> {
    validate_proposal(proposal)?;
    let key = encode_key(proposal)?;
    let mut bytes = Vec::with_capacity(key.len() + 512);
    header(&mut bytes);
    bytes_with_len(&mut bytes, &key)?;
    identity(&mut bytes, proposal.command_identity);
    optional_identity(&mut bytes, proposal.predecessor_identity);
    bytes.extend_from_slice(&proposal.correction_sequence.to_be_bytes());
    bytes.extend_from_slice(&proposal.effective_from_ns.to_be_bytes());
    optional_i128(&mut bytes, proposal.effective_until_ns);
    encode_source(&mut bytes, proposal.source);
    encode_value(&mut bytes, &proposal.value)?;
    identity(&mut bytes, proposal.stable_correlation);
    if bytes.len() > MAX_BYTES {
        return Err(ReferenceFactCatalogErrorV1::CapacityExceeded);
    }
    let id = digest(ENTRY_DOMAIN, &bytes);
    Ok(ReferenceFactCatalogEntryV1 {
        command_identity: proposal.command_identity,
        scope_identity: proposal.scope_identity,
        revision: proposal.revision,
        lineage_root: proposal.lineage_root,
        predecessor_identity: proposal.predecessor_identity,
        correction_sequence: proposal.correction_sequence,
        effective_from_ns: proposal.effective_from_ns,
        effective_until_ns: proposal.effective_until_ns,
        source: proposal.source,
        value: proposal.value.clone(),
        stable_correlation: proposal.stable_correlation,
        canonical_bytes: bytes.into(),
        identity: id,
    })
}

pub(crate) fn authenticate_reference_fact_catalog_entry_v1(
    entry: &ReferenceFactCatalogEntryV1,
    locator: UntrustedReferenceFactCatalogLocatorV1,
    expected_kind: ReferenceFactCatalogKindV1,
    expected_scope_identity: ReferenceFactCatalogIdentityV1,
    expected_source: ReferenceFactCatalogSourceV1,
) -> Result<&ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1> {
    if entry.identity != locator.entry_identity
        || entry.identity != locator.entry_digest
        || digest(ENTRY_DOMAIN, &entry.canonical_bytes) != entry.identity
        || entry.value.kind() != expected_kind
        || entry.scope_identity != expected_scope_identity
        || entry.source != expected_source
    {
        return Err(ReferenceFactCatalogErrorV1::DependencyMismatch);
    }
    Ok(entry)
}

pub(crate) fn decode_reference_fact_catalog_entry_v1(
    bytes: &[u8],
) -> Result<ReferenceFactCatalogEntryV1, ReferenceFactCatalogErrorV1> {
    if bytes.len() > MAX_BYTES {
        return Err(ReferenceFactCatalogErrorV1::CapacityExceeded);
    }
    let mut d = Decoder::new(bytes)?;
    let key_bytes = d.bytes()?;
    let mut key = Decoder::new(&key_bytes)?;
    let kind = key.kind()?;
    let scope_identity = key.identity()?;
    let revision = key.u64()?;
    let lineage_root = key.identity()?;
    let value_kind = key.kind()?;
    if value_kind != kind {
        return Err(ReferenceFactCatalogErrorV1::NonCanonical);
    }
    let key_value = key.value(value_kind)?;
    let key_identity = key.identity()?;
    key.finish()?;

    if digest(KEY_DOMAIN, &key_bytes[..key_bytes.len() - 32]) != key_identity {
        return Err(ReferenceFactCatalogErrorV1::NonCanonical);
    }
    let command_identity = d.identity()?;
    let predecessor_identity = d.optional_identity()?;
    let correction_sequence = d.u64()?;
    let effective_from_ns = d.i128()?;
    let effective_until_ns = d.optional_i128()?;
    let source = ReferenceFactCatalogSourceV1 {
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        source_frontier_digest: d.identity()?,
        correction_frontier_digest: d.identity()?,
        admission_identity: d.identity()?,
    };
    let value_kind = d.kind()?;
    let value = d.value(value_kind)?;
    let stable_correlation = d.identity()?;
    d.finish()?;

    if value != key_value {
        return Err(ReferenceFactCatalogErrorV1::NonCanonical);
    }
    let proposal = UntrustedReferenceFactCatalogProposalV1 {
        command_identity,
        scope_identity,
        revision,
        lineage_root,
        predecessor_identity,
        correction_sequence,
        effective_from_ns,
        effective_until_ns,
        source,
        value,
        stable_correlation,
    };
    let entry = seal_reference_fact_catalog_entry_v1(&proposal)?;
    if entry.canonical_bytes() != bytes {
        return Err(ReferenceFactCatalogErrorV1::NonCanonical);
    }
    Ok(entry)
}

fn validate_proposal(
    p: &UntrustedReferenceFactCatalogProposalV1,
) -> Result<(), ReferenceFactCatalogErrorV1> {
    let nonzero = |v: ReferenceFactCatalogIdentityV1| v.as_bytes() != &[0; 32];
    if !nonzero(p.command_identity)
        || !nonzero(p.scope_identity)
        || p.revision == 0
        || !nonzero(p.lineage_root)
        || p.correction_sequence == 0
        || matches!(
            (p.correction_sequence, p.predecessor_identity),
            (1, Some(_)) | (2.., None)
        )
        || p.effective_until_ns
            .is_some_and(|v| v <= p.effective_from_ns)
        || !nonzero(p.source.source_binding_identity)
        || !nonzero(p.source.source_binding_fact_digest)
        || !nonzero(p.source.source_binding_lineage_root)
        || p.source.source_binding_lineage_version == 0
        || !nonzero(p.source.source_frontier_digest)
        || !nonzero(p.source.correction_frontier_digest)
        || !nonzero(p.source.admission_identity)
        || !nonzero(p.stable_correlation)
    {
        return Err(ReferenceFactCatalogErrorV1::InvalidProposal);
    }

    match &p.value {
        ReferenceFactCatalogValueV1::Calendar {
            calendar_identity, ..
        } if calendar_identity.is_empty() => {
            return Err(ReferenceFactCatalogErrorV1::InvalidProposal);
        }
        ReferenceFactCatalogValueV1::TimeZone {
            time_zone_identity,
            ruleset_identity,
            ..
        } if time_zone_identity.is_empty() || !nonzero(*ruleset_identity) => {
            return Err(ReferenceFactCatalogErrorV1::InvalidProposal);
        }
        ReferenceFactCatalogValueV1::Session {
            session_identity,
            local_open,
            local_close,
            ..
        } if session_identity.is_empty()
            || local_open.nanos_of_day >= 86_400_000_000_000
            || local_close.nanos_of_day >= 86_400_000_000_000
            || (local_open.day, local_open.nanos_of_day)
                >= (local_close.day, local_close.nanos_of_day) =>
        {
            return Err(ReferenceFactCatalogErrorV1::InvalidProposal);
        }
        _ => {}
    }
    Ok(())
}

fn encode_key(
    p: &UntrustedReferenceFactCatalogProposalV1,
) -> Result<Vec<u8>, ReferenceFactCatalogErrorV1> {
    let mut bytes = Vec::new();
    header(&mut bytes);
    bytes.push(p.value.kind() as u8);
    identity(&mut bytes, p.scope_identity);
    bytes.extend_from_slice(&p.revision.to_be_bytes());
    identity(&mut bytes, p.lineage_root);
    encode_value(&mut bytes, &p.value)?;
    let key_id = digest(KEY_DOMAIN, &bytes);
    identity(&mut bytes, key_id);
    Ok(bytes)
}

fn encode_source(out: &mut Vec<u8>, s: ReferenceFactCatalogSourceV1) {
    for v in [
        s.source_binding_identity,
        s.source_binding_fact_digest,
        s.source_binding_lineage_root,
    ] {
        identity(out, v);
    }
    out.extend_from_slice(&s.source_binding_lineage_version.to_be_bytes());
    for v in [
        s.source_frontier_digest,
        s.correction_frontier_digest,
        s.admission_identity,
    ] {
        identity(out, v);
    }
}

fn encode_value(
    out: &mut Vec<u8>,
    value: &ReferenceFactCatalogValueV1,
) -> Result<(), ReferenceFactCatalogErrorV1> {
    out.push(value.kind() as u8);
    match value {
        ReferenceFactCatalogValueV1::Calendar {
            calendar_identity,
            day,
            is_open,
        } => {
            bytes_with_len(out, calendar_identity)?;
            out.extend_from_slice(&day.to_be_bytes());
            out.push(u8::from(*is_open));
        }
        ReferenceFactCatalogValueV1::TimeZone {
            time_zone_identity,
            ruleset_identity,
            utc_offset_seconds,
        } => {
            bytes_with_len(out, time_zone_identity)?;
            identity(out, *ruleset_identity);
            out.extend_from_slice(&utc_offset_seconds.to_be_bytes());
        }
        ReferenceFactCatalogValueV1::Session {
            session_identity,
            trading_day,
            interval_ordinal,
            local_open,
            local_close,
        } => {
            bytes_with_len(out, session_identity)?;
            out.extend_from_slice(&trading_day.to_be_bytes());
            out.extend_from_slice(&interval_ordinal.to_be_bytes());
            encode_boundary(out, *local_open);
            encode_boundary(out, *local_close);
        }
    }
    Ok(())
}

fn encode_boundary(out: &mut Vec<u8>, v: ReferenceFactLocalBoundaryV1) {
    out.extend_from_slice(&v.day.to_be_bytes());
    out.extend_from_slice(&v.nanos_of_day.to_be_bytes());
    out.push(v.resolution as u8);
}
fn header(out: &mut Vec<u8>) {
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
}
fn identity(out: &mut Vec<u8>, v: ReferenceFactCatalogIdentityV1) {
    out.extend_from_slice(v.as_bytes());
}
fn optional_identity(out: &mut Vec<u8>, v: Option<ReferenceFactCatalogIdentityV1>) {
    match v {
        None => out.push(0),
        Some(v) => {
            out.push(1);
            identity(out, v);
        }
    }
}
fn optional_i128(out: &mut Vec<u8>, v: Option<i128>) {
    match v {
        None => out.push(0),
        Some(v) => {
            out.push(1);
            out.extend_from_slice(&v.to_be_bytes());
        }
    }
}
fn bytes_with_len(out: &mut Vec<u8>, value: &[u8]) -> Result<(), ReferenceFactCatalogErrorV1> {
    let n =
        u32::try_from(value.len()).map_err(|_| ReferenceFactCatalogErrorV1::CapacityExceeded)?;
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(value);
    Ok(())
}
fn digest(domain: &[u8], bytes: &[u8]) -> ReferenceFactCatalogIdentityV1 {
    let mut h = blake3::Hasher::new();
    h.update(domain);
    h.update(bytes);
    ReferenceFactCatalogIdentityV1::from_untrusted_bytes(*h.finalize().as_bytes())
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self, ReferenceFactCatalogErrorV1> {
        if bytes.len() < 4 || bytes[..2] != 1u16.to_be_bytes() || bytes[2..4] != 0u16.to_be_bytes()
        {
            return Err(ReferenceFactCatalogErrorV1::NonCanonical);
        }
        Ok(Self { bytes, offset: 4 })
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], ReferenceFactCatalogErrorV1> {
        let end = self
            .offset
            .checked_add(n)
            .ok_or(ReferenceFactCatalogErrorV1::CapacityExceeded)?;
        let v = self
            .bytes
            .get(self.offset..end)
            .ok_or(ReferenceFactCatalogErrorV1::NonCanonical)?;
        self.offset = end;
        Ok(v)
    }
    fn u8(&mut self) -> Result<u8, ReferenceFactCatalogErrorV1> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, ReferenceFactCatalogErrorV1> {
        Ok(u32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::NonCanonical)?,
        ))
    }
    fn u64(&mut self) -> Result<u64, ReferenceFactCatalogErrorV1> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::NonCanonical)?,
        ))
    }
    fn i32(&mut self) -> Result<i32, ReferenceFactCatalogErrorV1> {
        Ok(i32::from_be_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::NonCanonical)?,
        ))
    }
    fn i128(&mut self) -> Result<i128, ReferenceFactCatalogErrorV1> {
        Ok(i128::from_be_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::NonCanonical)?,
        ))
    }
    fn identity(&mut self) -> Result<ReferenceFactCatalogIdentityV1, ReferenceFactCatalogErrorV1> {
        Ok(BindingDigest::from_untrusted_bytes(
            self.take(32)?
                .try_into()
                .map_err(|_| ReferenceFactCatalogErrorV1::NonCanonical)?,
        ))
    }
    fn bytes(&mut self) -> Result<Box<[u8]>, ReferenceFactCatalogErrorV1> {
        let n = usize::try_from(self.u32()?)
            .map_err(|_| ReferenceFactCatalogErrorV1::CapacityExceeded)?;
        Ok(self.take(n)?.into())
    }
    fn optional_identity(
        &mut self,
    ) -> Result<Option<ReferenceFactCatalogIdentityV1>, ReferenceFactCatalogErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(ReferenceFactCatalogErrorV1::NonCanonical),
        }
    }
    fn optional_i128(&mut self) -> Result<Option<i128>, ReferenceFactCatalogErrorV1> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(ReferenceFactCatalogErrorV1::NonCanonical),
        }
    }
    fn kind(&mut self) -> Result<ReferenceFactCatalogKindV1, ReferenceFactCatalogErrorV1> {
        match self.u8()? {
            1 => Ok(ReferenceFactCatalogKindV1::Calendar),
            2 => Ok(ReferenceFactCatalogKindV1::TimeZone),
            3 => Ok(ReferenceFactCatalogKindV1::Session),
            _ => Err(ReferenceFactCatalogErrorV1::NonCanonical),
        }
    }
    fn resolution(
        &mut self,
    ) -> Result<ReferenceFactLocalResolutionV1, ReferenceFactCatalogErrorV1> {
        match self.u8()? {
            1 => Ok(ReferenceFactLocalResolutionV1::Exact),
            2 => Ok(ReferenceFactLocalResolutionV1::EarlierInstant),
            3 => Ok(ReferenceFactLocalResolutionV1::LaterInstant),
            _ => Err(ReferenceFactCatalogErrorV1::NonCanonical),
        }
    }
    fn boundary(&mut self) -> Result<ReferenceFactLocalBoundaryV1, ReferenceFactCatalogErrorV1> {
        Ok(ReferenceFactLocalBoundaryV1 {
            day: self.i32()?,
            nanos_of_day: self.u64()?,
            resolution: self.resolution()?,
        })
    }
    fn value(
        &mut self,
        kind: ReferenceFactCatalogKindV1,
    ) -> Result<ReferenceFactCatalogValueV1, ReferenceFactCatalogErrorV1> {
        Ok(match kind {
            ReferenceFactCatalogKindV1::Calendar => ReferenceFactCatalogValueV1::Calendar {
                calendar_identity: self.bytes()?,
                day: self.i32()?,
                is_open: match self.u8()? {
                    0 => false,
                    1 => true,
                    _ => return Err(ReferenceFactCatalogErrorV1::NonCanonical),
                },
            },
            ReferenceFactCatalogKindV1::TimeZone => ReferenceFactCatalogValueV1::TimeZone {
                time_zone_identity: self.bytes()?,
                ruleset_identity: self.identity()?,
                utc_offset_seconds: self.i32()?,
            },
            ReferenceFactCatalogKindV1::Session => ReferenceFactCatalogValueV1::Session {
                session_identity: self.bytes()?,
                trading_day: self.i32()?,
                interval_ordinal: self.u32()?,
                local_open: self.boundary()?,
                local_close: self.boundary()?,
            },
        })
    }
    fn finish(self) -> Result<(), ReferenceFactCatalogErrorV1> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(ReferenceFactCatalogErrorV1::NonCanonical)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn d(v: u8) -> ReferenceFactCatalogIdentityV1 {
        BindingDigest::from_untrusted_bytes([v; 32])
    }
    fn proposal() -> UntrustedReferenceFactCatalogProposalV1 {
        UntrustedReferenceFactCatalogProposalV1 {
            command_identity: d(1),
            scope_identity: d(2),
            revision: 1,
            lineage_root: d(3),
            predecessor_identity: None,
            correction_sequence: 1,
            effective_from_ns: 50,
            effective_until_ns: Some(52),
            source: ReferenceFactCatalogSourceV1 {
                source_binding_identity: d(4),
                source_binding_fact_digest: d(5),
                source_binding_lineage_root: d(6),
                source_binding_lineage_version: 1,
                source_frontier_digest: d(7),
                correction_frontier_digest: d(8),
                admission_identity: d(9),
            },
            value: ReferenceFactCatalogValueV1::TimeZone {
                time_zone_identity: b"Etc/UTC".to_vec().into(),
                ruleset_identity: d(2),
                utc_offset_seconds: 0,
            },
            stable_correlation: d(10),
        }
    }

    #[rstest]
    fn exact_entry_round_trips_and_keeps_business_interval_independent() {
        let entry = seal_reference_fact_catalog_entry_v1(&proposal()).unwrap();
        let decoded = decode_reference_fact_catalog_entry_v1(entry.canonical_bytes()).unwrap();
        assert_eq!(decoded, entry);
        assert_eq!(entry.effective_from_ns(), 50);
        assert_eq!(entry.effective_until_ns(), Some(52));
        assert!(
            authenticate_reference_fact_catalog_entry_v1(
                &entry,
                entry.locator(),
                ReferenceFactCatalogKindV1::TimeZone,
                d(2),
                entry.source()
            )
            .is_ok()
        );
    }

    #[rstest]
    fn changed_source_locator_and_noncanonical_bytes_fail_closed() {
        let entry = seal_reference_fact_catalog_entry_v1(&proposal()).unwrap();
        let mut source = entry.source();
        source.source_frontier_digest = d(11);
        assert_eq!(
            authenticate_reference_fact_catalog_entry_v1(
                &entry,
                entry.locator(),
                ReferenceFactCatalogKindV1::TimeZone,
                d(2),
                source
            ),
            Err(ReferenceFactCatalogErrorV1::DependencyMismatch)
        );
        let mut bytes = entry.canonical_bytes().to_vec();
        bytes.push(0);
        assert_eq!(
            decode_reference_fact_catalog_entry_v1(&bytes),
            Err(ReferenceFactCatalogErrorV1::NonCanonical)
        );
    }
}
