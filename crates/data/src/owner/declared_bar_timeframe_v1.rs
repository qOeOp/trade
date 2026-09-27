//! The bar timeframe a verified Source Binding declares: the one rule a BAR schedule is selected
//! and minted by.
//!
//! A role's timeframe label, the rows' label and the declaration's `row_timeframe` are compared by
//! identity only. What the bar *is* - cadence, anchor, clock, label, completion - comes from the
//! declaration and is compared with a schedule's typed fields, so no label is ever parsed into a
//! schedule shape or rendered from one.

use sha2::{Digest as _, Sha256};

use super::{
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleFactV1, BarScheduleIdentity,
        BarScheduleKindV1, BarScheduleLabelV1, BarScheduleUnitV1,
    },
    pit_snapshot::VerifiedPitObservationBatch,
    source_binding::{
        BindingDigest, SourceBindingOwnerReadback, UntrustedSourceBarAnchorV1,
        UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1,
        UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1,
    },
};

const ANCHOR_DOMAIN: &[u8] = b"market-data.bar-schedule.anchor.v1\0";

/// Where a declared bar grid starts.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum DeclaredBarAnchorV1 {
    UnixEpoch = 0x01,
    SessionOpen = 0x02,
}

/// Why a batch's bars have no declared timeframe.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DeclaredBarTimeframeErrorV1 {
    /// The Source Binding declares no bar timeframe: a schema-1 binding, or a schema-2 binding of
    /// a source it did not declare as serving bars.
    #[error("the Source Binding declares no bar timeframe")]
    SourceBindingDeclaresNoBarTimeframe,
    /// The declaration is not the one the batch's own Source Binding makes.
    #[error("the declaration is not the batch's own Source Binding's")]
    NotTheBatchBinding,
    /// A role or row names a timeframe label other than the one the declaration describes.
    #[error("the timeframe label is not the one the Source Binding declares")]
    TimeframeLabelNotDeclared,
}

/// What a declared bar is, without the label its rows carry: the meaning two frames of one Replay
/// must share when the engine gives their bars one name.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeclaredBarShapeV1 {
    pub kind: BarScheduleKindV1,
    pub unit: BarScheduleUnitV1,
    pub step: u32,
    pub anchor: DeclaredBarAnchorV1,
    pub clock: BarScheduleClockV1,
    pub label: BarScheduleLabelV1,
    pub completion: BarScheduleCompletionV1,
}

/// The typed bar timeframe of one verified Source Binding.
///
/// Constructed only from a verified binding readback, so it always names the exact binding fact it
/// came from; `for_batch` refuses it for any batch that binding did not produce.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeclaredBarTimeframeV1 {
    binding_fact_digest: BindingDigest,
    row_timeframe: String,
    kind: BarScheduleKindV1,
    unit: BarScheduleUnitV1,
    step: u32,
    anchor: DeclaredBarAnchorV1,
    clock: BarScheduleClockV1,
    label: BarScheduleLabelV1,
    completion: BarScheduleCompletionV1,
}

impl DeclaredBarTimeframeV1 {
    /// The declaration a verified binding makes for its BAR rows labelled `row_timeframe`.
    ///
    /// # Errors
    ///
    /// Refuses a binding that declares no bar timeframe at all, and a label it declares none for.
    pub(crate) fn from_binding(
        binding: &SourceBindingOwnerReadback,
        row_timeframe: &str,
    ) -> Result<Self, DeclaredBarTimeframeErrorV1> {
        if binding.bar_timeframes().is_empty() {
            return Err(DeclaredBarTimeframeErrorV1::SourceBindingDeclaresNoBarTimeframe);
        }
        let declared = binding
            .bar_timeframes()
            .iter()
            .find(|declared| declared.row_timeframe == row_timeframe)
            .ok_or(DeclaredBarTimeframeErrorV1::TimeframeLabelNotDeclared)?;
        Ok(Self::from_declaration(binding.fact_digest(), declared))
    }

    fn from_declaration(
        binding_fact_digest: BindingDigest,
        declared: &UntrustedSourceBarTimeframeV1,
    ) -> Self {
        let (kind, unit, step) = match declared.cadence {
            UntrustedSourceBarCadenceV1::FixedInterval { step, unit } => (
                BarScheduleKindV1::FixedInterval,
                match unit {
                    UntrustedSourceBarUnitV1::Second => BarScheduleUnitV1::Second,
                    UntrustedSourceBarUnitV1::Minute => BarScheduleUnitV1::Minute,
                    UntrustedSourceBarUnitV1::Hour => BarScheduleUnitV1::Hour,
                },
                step,
            ),
            UntrustedSourceBarCadenceV1::ExchangeSessionDay => (
                BarScheduleKindV1::ExchangeSession,
                BarScheduleUnitV1::ExchangeSessionDay,
                1,
            ),
        };
        Self {
            binding_fact_digest,
            row_timeframe: declared.row_timeframe.clone(),
            kind,
            unit,
            step,
            anchor: match declared.anchor {
                UntrustedSourceBarAnchorV1::UnixEpoch => DeclaredBarAnchorV1::UnixEpoch,
                UntrustedSourceBarAnchorV1::SessionOpen => DeclaredBarAnchorV1::SessionOpen,
            },
            clock: match declared.clock {
                UntrustedSourceBarClockV1::Continuous => BarScheduleClockV1::Continuous,
                UntrustedSourceBarClockV1::ScheduleBounded => BarScheduleClockV1::ScheduleBounded,
            },
            label: match declared.label {
                UntrustedSourceBarLabelV1::IntervalOpen => BarScheduleLabelV1::IntervalOpen,
                UntrustedSourceBarLabelV1::IntervalClose => BarScheduleLabelV1::IntervalClose,
            },
            completion: match declared.completion {
                UntrustedSourceBarCompletionV1::CompleteOnly => {
                    BarScheduleCompletionV1::CompleteOnly
                }
            },
        }
    }

    /// This declaration, only when it is the one `batch`'s own Source Binding makes.
    ///
    /// # Errors
    ///
    /// Refuses a declaration from any other binding fact.
    pub(crate) fn for_batch(
        &self,
        batch: &VerifiedPitObservationBatch,
    ) -> Result<&Self, DeclaredBarTimeframeErrorV1> {
        if self.binding_fact_digest == batch.source_binding_fact_digest() {
            Ok(self)
        } else {
            Err(DeclaredBarTimeframeErrorV1::NotTheBatchBinding)
        }
    }

    /// Refuses a role or row label other than the one this declaration describes. Identity
    /// equality: the label is provenance and is never parsed.
    ///
    /// # Errors
    ///
    /// Returns [`DeclaredBarTimeframeErrorV1::TimeframeLabelNotDeclared`] for any other label.
    pub(crate) fn describes_label(&self, label: &str) -> Result<(), DeclaredBarTimeframeErrorV1> {
        if label == self.row_timeframe {
            Ok(())
        } else {
            Err(DeclaredBarTimeframeErrorV1::TimeframeLabelNotDeclared)
        }
    }

    /// Whether `schedule` states exactly this bar: the same cadence, anchor, clock, label and
    /// completion. Calendar, session and time zone come from the Instrument Master, not from the
    /// declaration; only whether calendar and session are bound at all is the declaration's.
    #[must_use]
    pub fn admits_schedule(&self, schedule: &BarScheduleFactV1) -> bool {
        schedule.kind() == self.kind
            && schedule.unit() == self.unit
            && schedule.step() == self.step
            && schedule.anchor_identity() == self.anchor_identity()
            && schedule.clock() == self.clock
            && schedule.label() == self.label
            && schedule.completion() == self.completion
    }

    /// The anchor identity a schedule of this declaration carries. It names the anchor alone -
    /// not the instrument or its Instrument Master fact - so one anchor means one thing on every
    /// schedule.
    #[must_use]
    pub fn anchor_identity(&self) -> BarScheduleIdentity {
        anchor_identity_v1(self.anchor)
    }

    /// What this declared bar is, without its rows' label.
    #[must_use]
    pub const fn shape(&self) -> DeclaredBarShapeV1 {
        DeclaredBarShapeV1 {
            kind: self.kind,
            unit: self.unit,
            step: self.step,
            anchor: self.anchor,
            clock: self.clock,
            label: self.label,
            completion: self.completion,
        }
    }

    #[must_use]
    pub const fn binding_fact_digest(&self) -> BindingDigest {
        self.binding_fact_digest
    }

    #[must_use]
    pub fn row_timeframe(&self) -> &str {
        &self.row_timeframe
    }

    #[must_use]
    pub const fn kind(&self) -> BarScheduleKindV1 {
        self.kind
    }

    #[must_use]
    pub const fn unit(&self) -> BarScheduleUnitV1 {
        self.unit
    }

    #[must_use]
    pub const fn step(&self) -> u32 {
        self.step
    }

    #[must_use]
    pub const fn anchor(&self) -> DeclaredBarAnchorV1 {
        self.anchor
    }

    #[must_use]
    pub const fn clock(&self) -> BarScheduleClockV1 {
        self.clock
    }

    #[must_use]
    pub const fn label(&self) -> BarScheduleLabelV1 {
        self.label
    }

    #[must_use]
    pub const fn completion(&self) -> BarScheduleCompletionV1 {
        self.completion
    }
}

/// The schedule anchor identity of `anchor`: SHA-256 over the anchor domain and its tag.
#[must_use]
pub fn anchor_identity_v1(anchor: DeclaredBarAnchorV1) -> BarScheduleIdentity {
    let mut hasher = Sha256::new();
    hasher.update(ANCHOR_DOMAIN);
    hasher.update([anchor as u8]);
    BarScheduleIdentity::from_untrusted_bytes(hasher.finalize().into())
}

/// A declaration of `declared` for the binding fact `binding_fact_digest`, for tests that hold no
/// stored binding.
#[cfg(test)]
pub(crate) fn declared_bar_timeframe_for_test_v1(
    binding_fact_digest: BindingDigest,
    declared: &UntrustedSourceBarTimeframeV1,
) -> DeclaredBarTimeframeV1 {
    DeclaredBarTimeframeV1::from_declaration(binding_fact_digest, declared)
}
