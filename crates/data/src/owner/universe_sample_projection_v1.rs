//! The Owner sample coordinate of every (member, role) value of one universe frame.
//!
//! `StrategyInputUniverseSampleProjectionV1` is additive: no earlier projection, sample or coordinate
//! codec changes. Its subject is the exact digest of the `StrategyInputUniverseFrameReceipt` a
//! `ProgramHost` admits, and it holds one component per value of that frame, in the frame's value
//! order, which is member ordinal then input-role identity. A BAR frame's projection also binds the
//! schedule each member's BAR role was read under, through a schedule-dependency set digest that is
//! part of the projection's identity. The canonical bytes and both digests are stated in
//! `docs/owners/market-data.md`, "universe-frame sample projection".

use std::fmt::Display;

use sha2::{Digest as _, Sha256};

use super::{
    sample_fact::StoredSampleReadbackV1,
    sample_projection::{
        COORDINATE_LEN, SampleCoordinateFieldsV1, encode_sample_coordinate_v1,
        sample_coordinate_digest_v1, verify_universe_member_sample_coordinate_v1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{StrategyInputEventKind, StrategyInputUniverseFrameReceipt},
};

const RECEIPT_DOMAIN: &[u8] = b"market-data.universe-sample-projection-receipt.v1\0";
const SCHEDULE_SET_DOMAIN: &[u8] = b"market-data.universe-sample-projection-schedule-set.v1\0";
const EVENT_LIFECYCLE: u8 = 1;
const BAR_LIFECYCLE: u8 = 2;

/// The lifecycle of the frame a projection's subject names.
///
/// The byte values are the ones the V3 and V4 projections use, not the trigger's own encoding.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSampleProjectionLifecycleV1 {
    /// An EVENT frame: no schedule is read, and the projection binds none.
    Event,
    /// A BAR frame: every component's role was read under its member's BAR schedule.
    Bar,
}

impl UniverseSampleProjectionLifecycleV1 {
    const fn byte(self) -> u8 {
        match self {
            Self::Event => EVENT_LIFECYCLE,
            Self::Bar => BAR_LIFECYCLE,
        }
    }

    const fn of(frame: &StrategyInputUniverseFrameReceipt) -> Self {
        match frame.trigger().lifecycle().kind() {
            StrategyInputEventKind::Bar => Self::Bar,
            StrategyInputEventKind::Event => Self::Event,
        }
    }
}

/// One (member, role) value's Owner sample coordinate, with the evidence that names it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UniverseSampleProjectionComponentV1 {
    member_ordinal: u8,
    member_key: String,
    instrument: String,
    input_role_identity: BindingDigest,
    member_binding_digest: BindingDigest,
    value_receipt_digest: BindingDigest,
    trigger_digest: BindingDigest,
    timeframe_projection_digest: BindingDigest,
    sample_identity: BindingDigest,
    sample_receipt_digest: BindingDigest,
    coordinate_digest: BindingDigest,
    coordinate: [u8; COORDINATE_LEN],
}

impl UniverseSampleProjectionComponentV1 {
    /// The member's position in the selection's canonical member order.
    #[must_use]
    pub const fn member_ordinal(&self) -> u8 {
        self.member_ordinal
    }

    /// The member key the verified batch carries.
    #[must_use]
    pub fn member_key(&self) -> &str {
        &self.member_key
    }

    /// The member's canonical instrument.
    #[must_use]
    pub fn instrument(&self) -> &str {
        &self.instrument
    }

    /// The input role this component's value answers.
    #[must_use]
    pub const fn input_role_identity(&self) -> BindingDigest {
        self.input_role_identity
    }

    /// The universe member binding digest the frame's value was issued under.
    #[must_use]
    pub const fn member_binding_digest(&self) -> BindingDigest {
        self.member_binding_digest
    }

    /// The digest of the frame's value receipt.
    #[must_use]
    pub const fn value_receipt_digest(&self) -> BindingDigest {
        self.value_receipt_digest
    }

    /// The frame's one trigger digest.
    #[must_use]
    pub const fn trigger_digest(&self) -> BindingDigest {
        self.trigger_digest
    }

    /// The timeframe projection through which the member binding reads its sample.
    #[must_use]
    pub const fn timeframe_projection_digest(&self) -> BindingDigest {
        self.timeframe_projection_digest
    }

    /// The Owner sample the coordinate names.
    #[must_use]
    pub const fn sample_identity(&self) -> BindingDigest {
        self.sample_identity
    }

    /// The digest of the native `SampleReceiptV1`.
    #[must_use]
    pub const fn sample_receipt_digest(&self) -> BindingDigest {
        self.sample_receipt_digest
    }

    /// The coordinate's digest under the unchanged coordinate codec.
    #[must_use]
    pub const fn coordinate_digest(&self) -> BindingDigest {
        self.coordinate_digest
    }

    /// The 308 coordinate bytes.
    #[must_use]
    pub const fn coordinate(&self) -> &[u8; COORDINATE_LEN] {
        &self.coordinate
    }
}

/// One issued universe-frame sample projection, verified from its exact canonical bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyInputUniverseSampleProjectionReadbackV1 {
    identity: BindingDigest,
    subject: BindingDigest,
    lifecycle: UniverseSampleProjectionLifecycleV1,
    schedule_dependency_set_digest: Option<BindingDigest>,
    components: Box<[UniverseSampleProjectionComponentV1]>,
    canonical_bytes: Box<[u8]>,
}

impl StrategyInputUniverseSampleProjectionReadbackV1 {
    /// The projection identity: SHA-256 over the receipt domain and the canonical bytes.
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    /// The digest of the universe frame receipt this projection is for.
    #[must_use]
    pub const fn subject(&self) -> BindingDigest {
        self.subject
    }

    /// The subject frame's lifecycle.
    #[must_use]
    pub const fn lifecycle(&self) -> UniverseSampleProjectionLifecycleV1 {
        self.lifecycle
    }

    /// The schedule-dependency set digest: present for a BAR frame and absent for an EVENT frame.
    #[must_use]
    pub const fn schedule_dependency_set_digest(&self) -> Option<BindingDigest> {
        self.schedule_dependency_set_digest
    }

    /// Every component, in member ordinal then input-role identity order.
    #[must_use]
    pub fn components(&self) -> &[UniverseSampleProjectionComponentV1] {
        &self.components
    }

    /// The component of one member's role, if the frame has that value.
    #[must_use]
    pub fn component(
        &self,
        member_ordinal: u8,
        input_role_identity: BindingDigest,
    ) -> Option<&UniverseSampleProjectionComponentV1> {
        self.components.iter().find(|component| {
            component.member_ordinal == member_ordinal
                && component.input_role_identity == input_role_identity
        })
    }

    /// The exact canonical bytes the identity is taken over.
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// Decodes and verifies stored canonical bytes against the identity that names them.
    ///
    /// # Errors
    ///
    /// Returns an error when the bytes are not canonical, do not hash to `identity`, or name a
    /// component whose coordinate does not verify against it.
    pub fn decode(
        identity: BindingDigest,
        bytes: &[u8],
    ) -> Result<Self, UniverseSampleProjectionErrorV1> {
        if receipt_identity(bytes) != identity {
            return Err(UniverseSampleProjectionErrorV1::DigestMismatch);
        }
        let mut decoder = Decoder { bytes, at: 0 };

        if decoder.u16()? != 1 || decoder.u16()? != 0 {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        let subject = decoder.digest()?;
        let lifecycle = match decoder.u8()? {
            EVENT_LIFECYCLE => UniverseSampleProjectionLifecycleV1::Event,
            BAR_LIFECYCLE => UniverseSampleProjectionLifecycleV1::Bar,
            _ => return Err(UniverseSampleProjectionErrorV1::NonCanonical),
        };
        let schedule_dependency_set_digest = match lifecycle {
            UniverseSampleProjectionLifecycleV1::Bar => Some(decoder.digest()?),
            UniverseSampleProjectionLifecycleV1::Event => None,
        };
        let count = decoder.u32()?;

        if count == 0 {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        let mut components = Vec::new();

        for _ in 0..count {
            let component = UniverseSampleProjectionComponentV1 {
                member_ordinal: decoder.u8()?,
                member_key: decoder.string()?,
                instrument: decoder.string()?,
                input_role_identity: decoder.digest()?,
                member_binding_digest: decoder.digest()?,
                value_receipt_digest: decoder.digest()?,
                trigger_digest: decoder.digest()?,
                timeframe_projection_digest: decoder.digest()?,
                sample_identity: decoder.digest()?,
                sample_receipt_digest: decoder.digest()?,
                coordinate_digest: decoder.digest()?,
                coordinate: decoder
                    .take(COORDINATE_LEN)?
                    .try_into()
                    .map_err(|_| UniverseSampleProjectionErrorV1::NonCanonical)?,
            };
            verify_universe_member_sample_coordinate_v1(
                &component.coordinate,
                *component.coordinate_digest.as_bytes(),
                *component.input_role_identity.as_bytes(),
                *component.member_binding_digest.as_bytes(),
                *component.sample_identity.as_bytes(),
                *component.sample_receipt_digest.as_bytes(),
            )
            .map_err(|_| UniverseSampleProjectionErrorV1::CoordinateMismatch)?;
            components.push(component);
        }

        if decoder.at != bytes.len() || !strictly_ordered(&components) {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        let trigger = components[0].trigger_digest;

        if components
            .iter()
            .any(|component| component.trigger_digest != trigger)
        {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        Ok(Self {
            identity,
            subject,
            lifecycle,
            schedule_dependency_set_digest,
            components: components.into_boxed_slice(),
            canonical_bytes: bytes.into(),
        })
    }
}

/// One frame value's sample, and for a BAR frame the schedule its role was read under.
pub(crate) struct UniverseMemberSampleV1<'a> {
    pub(crate) member_ordinal: u8,
    pub(crate) timeframe_projection_digest: BindingDigest,
    pub(crate) sample: &'a StoredSampleReadbackV1,
    pub(crate) schedule_readback_identity: Option<BindingDigest>,
}

/// Issues the projection of `frame` from the sample of each of its values, in the frame's order.
///
/// # Errors
///
/// Returns [`UniverseSampleProjectionErrorV1::FrameMismatch`] when the samples do not exhaust the
/// frame's values in order, a sample is not of its value's row, or a BAR frame's value names no
/// schedule, or an EVENT frame's value names one.
pub(crate) fn prepare_universe_sample_projection_v1(
    frame: &StrategyInputUniverseFrameReceipt,
    samples: &[UniverseMemberSampleV1<'_>],
) -> Result<StrategyInputUniverseSampleProjectionReadbackV1, UniverseSampleProjectionErrorV1> {
    assemble_universe_sample_projection_v1(
        frame,
        samples
            .iter()
            .map(|sample| ComponentEvidenceV1 {
                member_ordinal: sample.member_ordinal,
                timeframe_projection_digest: sample.timeframe_projection_digest,
                schedule_readback_identity: sample.schedule_readback_identity,
                fields: SampleCoordinateFieldsV1::of_receipt(sample.sample.receipt()),
            })
            .collect(),
    )
}

/// What one component states about the sample its value reads.
struct ComponentEvidenceV1 {
    member_ordinal: u8,
    timeframe_projection_digest: BindingDigest,
    schedule_readback_identity: Option<BindingDigest>,
    fields: SampleCoordinateFieldsV1,
}

/// Seals the projection of `frame` from one component's evidence per value, in the frame's order.
fn assemble_universe_sample_projection_v1(
    frame: &StrategyInputUniverseFrameReceipt,
    evidence: Vec<ComponentEvidenceV1>,
) -> Result<StrategyInputUniverseSampleProjectionReadbackV1, UniverseSampleProjectionErrorV1> {
    let values = frame.values();

    if values.is_empty() || evidence.len() != values.len() {
        return Err(UniverseSampleProjectionErrorV1::FrameMismatch);
    }
    let lifecycle = UniverseSampleProjectionLifecycleV1::of(frame);
    let members = frame.selection().members();
    let mut components = Vec::with_capacity(values.len());
    let mut schedules = Vec::with_capacity(values.len());

    for (value, sample) in values.iter().zip(evidence) {
        let member = members
            .get(usize::from(sample.member_ordinal))
            .ok_or(UniverseSampleProjectionErrorV1::FrameMismatch)?;

        if member.member_key() != value.member_key()
            || member.instrument() != value.instrument()
            || value.trigger_digest() != frame.trigger().digest()
            || sample.fields.canonical_row_digest != *value.canonical_row_digest().as_bytes()
        {
            return Err(UniverseSampleProjectionErrorV1::FrameMismatch);
        }

        match (lifecycle, sample.schedule_readback_identity) {
            (UniverseSampleProjectionLifecycleV1::Bar, Some(schedule)) => {
                schedules.push((sample.member_ordinal, value.input_role_identity(), schedule));
            }
            (UniverseSampleProjectionLifecycleV1::Event, None) => {}
            _ => return Err(UniverseSampleProjectionErrorV1::FrameMismatch),
        }
        let coordinate = encode_sample_coordinate_v1(
            *value.input_role_identity().as_bytes(),
            *value.binding_digest().as_bytes(),
            &sample.fields,
        )
        .map_err(|_| UniverseSampleProjectionErrorV1::FrameMismatch)?;
        components.push(UniverseSampleProjectionComponentV1 {
            member_ordinal: sample.member_ordinal,
            member_key: value.member_key().to_owned(),
            instrument: value.instrument().to_owned(),
            input_role_identity: value.input_role_identity(),
            member_binding_digest: value.binding_digest(),
            value_receipt_digest: value.digest(),
            trigger_digest: value.trigger_digest(),
            timeframe_projection_digest: sample.timeframe_projection_digest,
            sample_identity: BindingDigest::from_untrusted_bytes(sample.fields.sample_identity),
            sample_receipt_digest: BindingDigest::from_untrusted_bytes(
                sample.fields.receipt_digest,
            ),
            coordinate_digest: BindingDigest::from_untrusted_bytes(sample_coordinate_digest_v1(
                &coordinate,
            )),
            coordinate,
        });
    }

    if !strictly_ordered(&components) {
        return Err(UniverseSampleProjectionErrorV1::FrameMismatch);
    }
    let schedule_dependency_set_digest = match lifecycle {
        UniverseSampleProjectionLifecycleV1::Bar => {
            Some(schedule_dependency_set_digest(&schedules)?)
        }
        UniverseSampleProjectionLifecycleV1::Event => None,
    };
    let bytes = canonical_bytes(
        frame.digest(),
        lifecycle,
        schedule_dependency_set_digest,
        &components,
    )?;
    Ok(StrategyInputUniverseSampleProjectionReadbackV1 {
        identity: receipt_identity(&bytes),
        subject: frame.digest(),
        lifecycle,
        schedule_dependency_set_digest,
        components: components.into_boxed_slice(),
        canonical_bytes: bytes.into_boxed_slice(),
    })
}

/// A projection for an acceptance fixture's frame, sealed by the real codec over synthetic samples.
///
/// It exists only with `sealed-strategy-input-acceptance`, so no production build can issue a
/// projection without writing its samples. Every byte is produced by the codec a real issuance uses,
/// and every component names its frame value exactly: only the sample each coordinate states is
/// synthetic, derived from that value's own digest, so two frames never share one.
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub mod sealed_acceptance {
    use sha2::{Digest as _, Sha256};

    use super::{
        ComponentEvidenceV1, StrategyInputUniverseSampleProjectionReadbackV1,
        UniverseSampleProjectionLifecycleV1, assemble_universe_sample_projection_v1,
    };
    use crate::owner::{
        sample_projection::SampleCoordinateFieldsV1, source_binding::BindingDigest,
        strategy_input_binding::StrategyInputUniverseFrameReceipt,
    };

    /// Issues the projection of `frame`, with `schedule` naming each BAR member role's schedule
    /// readback by member ordinal and input role; an EVENT frame never asks it.
    ///
    /// # Panics
    ///
    /// Panics when `frame` holds no value, or a member ordinal does not fit its selection, which
    /// no frame the Owner binds does.
    #[must_use]
    pub fn issue_sealed_acceptance_universe_sample_projection_v1(
        frame: &StrategyInputUniverseFrameReceipt,
        schedule: impl Fn(u8, BindingDigest) -> BindingDigest,
    ) -> StrategyInputUniverseSampleProjectionReadbackV1 {
        let bar = UniverseSampleProjectionLifecycleV1::of(frame)
            == UniverseSampleProjectionLifecycleV1::Bar;
        let members = frame.selection().members();
        let evidence = frame
            .values()
            .iter()
            .map(|value| {
                let member_ordinal = members
                    .iter()
                    .position(|member| {
                        member.member_key() == value.member_key()
                            && member.instrument() == value.instrument()
                    })
                    .and_then(|ordinal| u8::try_from(ordinal).ok())
                    .expect("every value is of a member of its frame's selection");
                let synthetic = |tag: &[u8]| -> [u8; 32] {
                    let mut hasher = Sha256::new();
                    hasher.update(b"market-data.sealed-acceptance.universe-sample.v1\0");
                    hasher.update(tag);
                    hasher.update(value.digest().as_bytes());
                    hasher.finalize().into()
                };
                let mut owner_event = [0_u8; 16];
                owner_event.copy_from_slice(&synthetic(b"owner-event")[..16]);
                ComponentEvidenceV1 {
                    member_ordinal,
                    timeframe_projection_digest: BindingDigest::from_untrusted_bytes(synthetic(
                        b"timeframe-projection",
                    )),
                    schedule_readback_identity: bar
                        .then(|| schedule(member_ordinal, value.input_role_identity())),
                    fields: SampleCoordinateFieldsV1 {
                        timeframe_identity: synthetic(b"timeframe"),
                        owner_event_identity: owner_event,
                        sample_identity: synthetic(b"sample"),
                        logical_time: 1,
                        event_effective: 1,
                        owner_sequence: 1,
                        canonical_row_digest: *value.canonical_row_digest().as_bytes(),
                        source_binding_lineage_root: *frame
                            .selection()
                            .source_binding_lineage_root()
                            .as_bytes(),
                        source_binding_lineage_version: 1,
                        market_semantics_identity: *value.market_semantics_identity().as_bytes(),
                        receipt_digest: synthetic(b"sample-receipt"),
                    },
                }
            })
            .collect();
        assemble_universe_sample_projection_v1(frame, evidence)
            .expect("a frame's own values seal into its projection")
    }
}

/// Why a projection could not be issued or read.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSampleProjectionErrorV1 {
    /// The samples are not the frame's values, in its order, each of its own row.
    FrameMismatch,
    /// The bytes are not the canonical encoding.
    NonCanonical,
    /// The bytes do not hash to the identity that names them.
    DigestMismatch,
    /// A component's coordinate does not verify against the component.
    CoordinateMismatch,
}

impl Display for UniverseSampleProjectionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::FrameMismatch => "the samples are not the universe frame's values",
            Self::NonCanonical => "the projection bytes are not canonical",
            Self::DigestMismatch => "the projection bytes do not hash to their identity",
            Self::CoordinateMismatch => "a component's coordinate does not verify",
        })
    }
}

impl std::error::Error for UniverseSampleProjectionErrorV1 {}

fn strictly_ordered(components: &[UniverseSampleProjectionComponentV1]) -> bool {
    components.windows(2).all(|pair| {
        (
            pair[0].member_ordinal,
            pair[0].input_role_identity.as_bytes(),
        ) < (
            pair[1].member_ordinal,
            pair[1].input_role_identity.as_bytes(),
        )
    })
}

fn schedule_dependency_set_digest(
    schedules: &[(u8, BindingDigest, BindingDigest)],
) -> Result<BindingDigest, UniverseSampleProjectionErrorV1> {
    let count = u32::try_from(schedules.len())
        .map_err(|_| UniverseSampleProjectionErrorV1::FrameMismatch)?;
    let mut hasher = Sha256::new();
    hasher.update(SCHEDULE_SET_DOMAIN);
    hasher.update(count.to_le_bytes());

    for (ordinal, role, schedule) in schedules {
        hasher.update([*ordinal]);
        hasher.update(role.as_bytes());
        hasher.update(schedule.as_bytes());
    }
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

fn canonical_bytes(
    subject: BindingDigest,
    lifecycle: UniverseSampleProjectionLifecycleV1,
    schedule_dependency_set_digest: Option<BindingDigest>,
    components: &[UniverseSampleProjectionComponentV1],
) -> Result<Vec<u8>, UniverseSampleProjectionErrorV1> {
    let count = u32::try_from(components.len())
        .map_err(|_| UniverseSampleProjectionErrorV1::FrameMismatch)?;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&0_u16.to_le_bytes());
    bytes.extend_from_slice(subject.as_bytes());
    bytes.push(lifecycle.byte());

    if let Some(digest) = schedule_dependency_set_digest {
        bytes.extend_from_slice(digest.as_bytes());
    }
    bytes.extend_from_slice(&count.to_le_bytes());

    for component in components {
        bytes.push(component.member_ordinal);
        put_string(&mut bytes, &component.member_key)?;
        put_string(&mut bytes, &component.instrument)?;

        for digest in [
            component.input_role_identity,
            component.member_binding_digest,
            component.value_receipt_digest,
            component.trigger_digest,
            component.timeframe_projection_digest,
            component.sample_identity,
            component.sample_receipt_digest,
            component.coordinate_digest,
        ] {
            bytes.extend_from_slice(digest.as_bytes());
        }
        bytes.extend_from_slice(&component.coordinate);
    }
    Ok(bytes)
}

fn put_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), UniverseSampleProjectionErrorV1> {
    let length =
        u16::try_from(value.len()).map_err(|_| UniverseSampleProjectionErrorV1::FrameMismatch)?;
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

fn receipt_identity(bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

struct Decoder<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Decoder<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], UniverseSampleProjectionErrorV1> {
        let end = self
            .at
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(UniverseSampleProjectionErrorV1::NonCanonical)?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, UniverseSampleProjectionErrorV1> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, UniverseSampleProjectionErrorV1> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().map_err(
            |_| UniverseSampleProjectionErrorV1::NonCanonical,
        )?))
    }

    fn u32(&mut self) -> Result<u32, UniverseSampleProjectionErrorV1> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().map_err(
            |_| UniverseSampleProjectionErrorV1::NonCanonical,
        )?))
    }

    fn digest(&mut self) -> Result<BindingDigest, UniverseSampleProjectionErrorV1> {
        let bytes: [u8; 32] = self
            .take(32)?
            .try_into()
            .map_err(|_| UniverseSampleProjectionErrorV1::NonCanonical)?;

        if bytes == [0; 32] {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        Ok(BindingDigest::from_untrusted_bytes(bytes))
    }

    fn string(&mut self) -> Result<String, UniverseSampleProjectionErrorV1> {
        let length = usize::from(self.u16()?);
        let bytes = self.take(length)?;

        if bytes.is_empty() {
            return Err(UniverseSampleProjectionErrorV1::NonCanonical);
        }
        String::from_utf8(bytes.to_vec()).map_err(|_| UniverseSampleProjectionErrorV1::NonCanonical)
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use sha2::{Digest as _, Sha256};

    use super::*;
    use crate::owner::sample_fact::tests::prepared_point_event_fixture_v1;

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    /// Two components of one member, each with a coordinate that verifies against it.
    fn components() -> Vec<UniverseSampleProjectionComponentV1> {
        let sample = prepared_point_event_fixture_v1();
        let receipt = sample.receipt();
        [d(0x21), d(0x22)]
            .into_iter()
            .map(|role| {
                let binding = d(0x30);
                let coordinate = encode_sample_coordinate_v1(
                    *role.as_bytes(),
                    *binding.as_bytes(),
                    &SampleCoordinateFieldsV1::of_receipt(receipt),
                )
                .unwrap();
                let coordinate_digest = sample_coordinate_digest_v1(&coordinate);
                UniverseSampleProjectionComponentV1 {
                    member_ordinal: 0,
                    member_key: "AAPL".into(),
                    instrument: "AAPL.XNAS".into(),
                    input_role_identity: role,
                    member_binding_digest: binding,
                    value_receipt_digest: d(0x40),
                    trigger_digest: d(0x41),
                    timeframe_projection_digest: d(0x42),
                    sample_identity: BindingDigest::from_untrusted_bytes(
                        sample.fact().sample_identity(),
                    ),
                    sample_receipt_digest: BindingDigest::from_untrusted_bytes(receipt.digest()),
                    coordinate_digest: BindingDigest::from_untrusted_bytes(coordinate_digest),
                    coordinate,
                }
            })
            .collect()
    }

    fn encoded(
        lifecycle: UniverseSampleProjectionLifecycleV1,
        schedule: Option<BindingDigest>,
        components: &[UniverseSampleProjectionComponentV1],
    ) -> Vec<u8> {
        canonical_bytes(d(0x11), lifecycle, schedule, components).unwrap()
    }

    #[rstest]
    #[case::bar(UniverseSampleProjectionLifecycleV1::Bar, Some(d(0x51)))]
    #[case::event(UniverseSampleProjectionLifecycleV1::Event, None)]
    fn the_canonical_bytes_decode_to_the_same_projection(
        #[case] lifecycle: UniverseSampleProjectionLifecycleV1,
        #[case] schedule: Option<BindingDigest>,
    ) {
        let components = components();
        let bytes = encoded(lifecycle, schedule, &components);
        let decoded = StrategyInputUniverseSampleProjectionReadbackV1::decode(
            receipt_identity(&bytes),
            &bytes,
        )
        .unwrap();

        assert_eq!(decoded.subject(), d(0x11));
        assert_eq!(decoded.lifecycle(), lifecycle);
        assert_eq!(decoded.schedule_dependency_set_digest(), schedule);
        assert_eq!(decoded.components(), &components[..]);
        assert_eq!(decoded.canonical_bytes(), &bytes[..]);
        assert_eq!(decoded.component(0, d(0x22)), Some(&components[1]));
        assert_eq!(decoded.component(1, d(0x22)), None);
        // The identity is SHA-256 over the receipt domain and the canonical bytes.
        let mut hasher = Sha256::new();
        hasher.update(b"market-data.universe-sample-projection-receipt.v1\0");
        hasher.update(&bytes);
        let identity: [u8; 32] = hasher.finalize().into();
        assert_eq!(decoded.identity().as_bytes(), &identity);
        // The lifecycle byte follows the subject: 1 EVENT, 2 BAR.
        assert_eq!(bytes[36], lifecycle.byte());
    }

    /// The schedule-dependency set digest over the documented preimage, computed apart from the
    /// builder: the domain, the count, then each component's ordinal, role and schedule.
    #[rstest]
    fn the_schedule_set_digest_is_the_documented_preimage() {
        let schedules = [(0, d(0x21), d(0x61)), (1, d(0x21), d(0x62))];
        let mut preimage = b"market-data.universe-sample-projection-schedule-set.v1\0".to_vec();
        preimage.extend_from_slice(&2_u32.to_le_bytes());

        for (ordinal, role, schedule) in &schedules {
            preimage.push(*ordinal);
            preimage.extend_from_slice(role.as_bytes());
            preimage.extend_from_slice(schedule.as_bytes());
        }
        let expected: [u8; 32] = Sha256::digest(&preimage).into();

        assert_eq!(
            schedule_dependency_set_digest(&schedules)
                .unwrap()
                .as_bytes(),
            &expected
        );
    }

    #[rstest]
    fn bytes_that_are_not_the_canonical_encoding_are_refused_by_name() {
        let components = components();
        let bar = encoded(
            UniverseSampleProjectionLifecycleV1::Bar,
            Some(d(0x51)),
            &components,
        );
        let refused = |bytes: &[u8]| {
            StrategyInputUniverseSampleProjectionReadbackV1::decode(receipt_identity(bytes), bytes)
                .unwrap_err()
        };

        assert_eq!(
            StrategyInputUniverseSampleProjectionReadbackV1::decode(d(0x99), &bar).unwrap_err(),
            UniverseSampleProjectionErrorV1::DigestMismatch
        );
        let mut lifecycle = bar.clone();
        lifecycle[36] = 3;
        assert_eq!(
            refused(&lifecycle),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let mut trailing = bar;
        trailing.push(0);
        assert_eq!(
            refused(&trailing),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let empty = encoded(UniverseSampleProjectionLifecycleV1::Event, None, &[]);
        assert_eq!(
            refused(&empty),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let mut reversed = components.clone();
        reversed.reverse();
        assert_eq!(
            refused(&encoded(
                UniverseSampleProjectionLifecycleV1::Event,
                None,
                &reversed
            )),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let mut duplicated = components.clone();
        duplicated[1] = duplicated[0].clone();
        assert_eq!(
            refused(&encoded(
                UniverseSampleProjectionLifecycleV1::Event,
                None,
                &duplicated
            )),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let mut two_triggers = components.clone();
        two_triggers[1].trigger_digest = d(0x49);
        assert_eq!(
            refused(&encoded(
                UniverseSampleProjectionLifecycleV1::Event,
                None,
                &two_triggers
            )),
            UniverseSampleProjectionErrorV1::NonCanonical
        );
        let mut foreign_role = components.clone();
        foreign_role[0].input_role_identity = d(0x20);
        assert_eq!(
            refused(&encoded(
                UniverseSampleProjectionLifecycleV1::Event,
                None,
                &foreign_role
            )),
            UniverseSampleProjectionErrorV1::CoordinateMismatch,
            "a component whose coordinate names another role"
        );
        let mut foreign_coordinate = components;
        foreign_coordinate[0].coordinate_digest = d(0x48);
        assert_eq!(
            refused(&encoded(
                UniverseSampleProjectionLifecycleV1::Event,
                None,
                &foreign_coordinate
            )),
            UniverseSampleProjectionErrorV1::CoordinateMismatch
        );
    }
}
