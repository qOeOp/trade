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
    pit_snapshot::{VerifiedPitObservation, VerifiedPitObservationBatch},
    source_binding::{
        BindingDigest, SourceBindingOwnerReadback, UntrustedSourceBarAnchorV1,
        UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1,
        UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1,
    },
    strategy_input_binding::MarketDataFieldSemantic,
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

    /// How long one declared bar is, when the declaration states a fixed duration. An exchange
    /// session day states none: its length is the session's.
    #[must_use]
    pub fn fixed_interval_ns(&self) -> Option<u64> {
        let unit_ns: u64 = match (self.kind, self.unit) {
            (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => 1_000_000_000,
            (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => 60_000_000_000,
            (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => 3_600_000_000_000,
            _ => return None,
        };
        unit_ns.checked_mul(u64::from(self.step))
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

/// Why a Replay's execution window could not be derived inside its R0 window.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ExecutionWindowErrorV1 {
    /// The Design names no single execution role: its joins trigger on different roles, or, with
    /// no join, more than one role reads the BAR close.
    #[error("the Design names no single execution role")]
    ExecutionRoleAmbiguous,
    /// The Source Binding declares bars, but none for the execution label.
    #[error("the Source Binding declares no bar for the execution label")]
    ExecutionTimeframeNotDeclared,
    /// The execution bar has no fixed duration, or ends after the R0 window the snapshot's
    /// reference facts are claimed for.
    #[error("the execution bar exceeds the R0 window")]
    ExecutionBarExceedsR0Window,
}

/// The end of the window a snapshot's R0 record claims its reference facts for, from the event
/// instant `event_effective` the snapshot answers.
///
/// One snapshot has one R0 record, and it must cover every bar the snapshot's rows declare, so the
/// claim runs for the longest fixed interval `source` declares for any BAR row label of `batch`.
/// A longer R0 is a broader claim about how long the reference facts hold, not a more cautious
/// one; it is bounded by the longest bar the snapshot itself contains, and the window each
/// execution uses is derived separately from its own execution label
/// ([`execution_window_end_v1`]), so no execution window widens because of it. Where no BAR row
/// has a declared fixed interval - a binding that declares no bars, or rows of an exchange
/// session day only - the claim is the event instant alone, one nanosecond.
///
/// `None` when `source` is not the binding `batch` was taken under, or the end overflows.
pub(crate) fn r0_window_end_v1(
    event_effective: i128,
    source: &SourceBindingOwnerReadback,
    batch: &VerifiedPitObservationBatch,
) -> Option<i128> {
    if source.fact_digest() != batch.source_binding_fact_digest() {
        return None;
    }
    r0_window_end_over_v1(
        event_effective,
        source.bar_timeframes(),
        batch
            .observations()
            .iter()
            .filter(|row| row.data_kind() == "BAR")
            .map(VerifiedPitObservation::timeframe),
    )
}

/// [`r0_window_end_v1`] over the bar `declarations` a binding makes and the labels of the BAR rows
/// a snapshot holds: the one rule, for a writer that holds those before it holds a stored batch.
pub(crate) fn r0_window_end_over_v1<'a>(
    event_effective: i128,
    declarations: &[UntrustedSourceBarTimeframeV1],
    bar_labels: impl IntoIterator<Item = &'a str>,
) -> Option<i128> {
    let longest = bar_labels
        .into_iter()
        .filter_map(|label| {
            let declared = declarations
                .iter()
                .find(|declared| declared.row_timeframe == label)?;
            DeclaredBarTimeframeV1::from_declaration(
                BindingDigest::from_untrusted_bytes([0; 32]),
                declared,
            )
            .fixed_interval_ns()
        })
        .max()
        .unwrap_or(1);
    event_effective.checked_add(i128::from(longest))
}

/// The exclusive end of a Replay's execution window: one execution bar after the event instant
/// `r0_start`, where the bar is the one `declarations` state for `execution_label`.
///
/// `execution_label` is the timeframe label of the Design's execution role
/// ([`execution_role_semantic_id_v1`]), and `None` when it has
/// no BAR role. With no BAR role, or a binding that declares no bars, the window is the event
/// instant alone. The window must end no later than `r0_end`, the end of the snapshot's R0 claim.
///
/// # Errors
///
/// [`ExecutionWindowErrorV1`] names why no window lies inside R0.
pub(crate) fn execution_window_end_v1(
    r0_start: i128,
    r0_end: i128,
    declarations: &[UntrustedSourceBarTimeframeV1],
    execution_label: Option<&str>,
) -> Result<i128, ExecutionWindowErrorV1> {
    let length = match execution_label {
        None => 1,
        Some(_) if declarations.is_empty() => 1,
        Some(label) => {
            let declared = declarations
                .iter()
                .find(|declared| declared.row_timeframe == label)
                .ok_or(ExecutionWindowErrorV1::ExecutionTimeframeNotDeclared)?;
            DeclaredBarTimeframeV1::from_declaration(
                BindingDigest::from_untrusted_bytes([0; 32]),
                declared,
            )
            .fixed_interval_ns()
            .ok_or(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window)?
        }
    };
    let end = r0_start
        .checked_add(i128::from(length))
        .ok_or(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window)?;

    if end > r0_end {
        return Err(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window);
    }
    Ok(end)
}

/// The semantic identity of a Design's execution role, from its roles' semantic and field
/// semantic identities and the roles its joins trigger on; `None` for a Design with no join and no
/// role reading the BAR close.
///
/// This is Strategy Factory's rule for the role that executes and prices a Design
/// (`derive_execution_role_v2`), read here from the same Composer role-set projection: a Design
/// with joins executes on the role they trigger on, and one without executes on the one role that
/// reads the BAR close. Where Strategy Factory defines the role - a universe Design, whose join
/// must be triggered by that pricing role - both answer the same role for the same Design, which
/// Strategy Factory's agreement test holds. The joined first corpus is defined here only.
///
/// # Errors
///
/// [`ExecutionWindowErrorV1::ExecutionRoleAmbiguous`] when joins trigger on different roles, or a
/// join triggers on no role of the Design, or no join is declared and several roles read the close.
pub fn execution_role_semantic_id_v1<'a>(
    roles: impl IntoIterator<Item = (&'a str, &'a str)>,
    join_triggers: impl IntoIterator<Item = &'a str>,
) -> Result<Option<&'a str>, ExecutionWindowErrorV1> {
    let roles = roles.into_iter().collect::<Vec<_>>();
    let mut triggers = join_triggers.into_iter().collect::<Vec<_>>();
    triggers.sort_unstable();
    triggers.dedup();

    let candidates = if triggers.is_empty() {
        roles
            .iter()
            .filter(|(_, field)| *field == MarketDataFieldSemantic::BarClosePrice.identity())
            .map(|(semantic_id, _)| *semantic_id)
            .collect::<Vec<_>>()
    } else {
        if triggers
            .iter()
            .any(|trigger| !roles.iter().any(|(semantic_id, _)| semantic_id == trigger))
        {
            return Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous);
        }
        triggers
    };

    match candidates.as_slice() {
        [] => Ok(None),
        [role] => Ok(Some(role)),
        _ => Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous),
    }
}

#[cfg(test)]
mod window_tests {
    use rstest::rstest;

    use super::{
        ExecutionWindowErrorV1, execution_role_semantic_id_v1, execution_window_end_v1,
        r0_window_end_over_v1,
    };
    use crate::owner::source_binding::{
        UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
        UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1,
        UntrustedSourceBarUnitV1,
    };

    const E: i128 = 1_790_000_000_000_000_000;
    const MINUTE: i128 = 60_000_000_000;
    const HOUR: i128 = 3_600_000_000_000;
    const DAY: i128 = 24 * HOUR;

    fn continuous(
        label: &str,
        step: u32,
        unit: UntrustedSourceBarUnitV1,
    ) -> UntrustedSourceBarTimeframeV1 {
        UntrustedSourceBarTimeframeV1 {
            row_timeframe: label.to_owned(),
            cadence: UntrustedSourceBarCadenceV1::FixedInterval { step, unit },
            anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
            clock: UntrustedSourceBarClockV1::Continuous,
            label: UntrustedSourceBarLabelV1::IntervalClose,
            completion: UntrustedSourceBarCompletionV1::CompleteOnly,
        }
    }

    fn session_day(label: &str) -> UntrustedSourceBarTimeframeV1 {
        UntrustedSourceBarTimeframeV1 {
            row_timeframe: label.to_owned(),
            cadence: UntrustedSourceBarCadenceV1::ExchangeSessionDay,
            anchor: UntrustedSourceBarAnchorV1::SessionOpen,
            clock: UntrustedSourceBarClockV1::ScheduleBounded,
            label: UntrustedSourceBarLabelV1::IntervalClose,
            completion: UntrustedSourceBarCompletionV1::CompleteOnly,
        }
    }

    /// A snapshot holding one-minute and 24-hour bars.
    fn minute_and_day() -> Vec<UntrustedSourceBarTimeframeV1> {
        vec![
            continuous("1D", 24, UntrustedSourceBarUnitV1::Hour),
            continuous("1M", 1, UntrustedSourceBarUnitV1::Minute),
        ]
    }

    /// R0 claims its reference facts for the longest bar the snapshot's rows declare; a bar with no
    /// fixed duration, a label no declaration names, or a binding that declares none leaves the
    /// event instant alone.
    #[rstest]
    #[case::minute_and_day(minute_and_day(), vec!["1M", "1D"], E + DAY)]
    #[case::minute_only(minute_and_day(), vec!["1M"], E + MINUTE)]
    #[case::session_day_has_no_fixed_length(
        vec![session_day("1D"), continuous("1M", 1, UntrustedSourceBarUnitV1::Minute)],
        vec!["1D", "1M"],
        E + MINUTE
    )]
    #[case::only_a_session_day(vec![session_day("1D")], vec!["1D"], E + 1)]
    #[case::an_undeclared_label(minute_and_day(), vec!["1H"], E + 1)]
    #[case::no_declarations(vec![], vec!["1M", "1D"], E + 1)]
    fn the_r0_claim_ends_with_the_longest_declared_bar_of_the_snapshot(
        #[case] declarations: Vec<UntrustedSourceBarTimeframeV1>,
        #[case] labels: Vec<&str>,
        #[case] end: i128,
    ) {
        assert_eq!(r0_window_end_over_v1(E, &declarations, labels), Some(end));
    }

    /// The execution window is one execution bar, however long R0 is: a one-minute execution over
    /// a snapshot that also holds 24-hour bars gets [e, e + 1m) inside R0's [e, e + 1d), not the
    /// day.
    #[rstest]
    fn a_minute_execution_over_a_day_long_r0_gets_one_minute() {
        let declarations = minute_and_day();
        let r0_end = r0_window_end_over_v1(E, &declarations, ["1M", "1D"]).unwrap();
        assert_eq!(r0_end, E + DAY);
        assert_eq!(
            execution_window_end_v1(E, r0_end, &declarations, Some("1M")),
            Ok(E + MINUTE)
        );
        assert_eq!(
            execution_window_end_v1(E, r0_end, &declarations, Some("1D")),
            Ok(E + DAY),
            "a day-long execution fills the day-long claim exactly"
        );
    }

    /// Each way an execution window cannot lie inside R0 is refused by name.
    #[rstest]
    fn an_execution_window_outside_r0_is_refused_by_name() {
        let declarations = minute_and_day();
        let minute_r0 = r0_window_end_over_v1(E, &declarations, ["1M"]).unwrap();
        assert_eq!(
            execution_window_end_v1(E, minute_r0, &declarations, Some("1D")),
            Err(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window),
            "a day-long execution over a snapshot whose R0 claims a minute"
        );
        assert_eq!(
            execution_window_end_v1(E, E + DAY, &[session_day("1D")], Some("1D")),
            Err(ExecutionWindowErrorV1::ExecutionBarExceedsR0Window),
            "a session day has no fixed length to bound"
        );
        assert_eq!(
            execution_window_end_v1(E, E + DAY, &declarations, Some("1H")),
            Err(ExecutionWindowErrorV1::ExecutionTimeframeNotDeclared)
        );
    }

    /// With no BAR role, or a binding that declares no bars, the window is the event instant alone.
    #[rstest]
    fn without_a_declared_execution_bar_the_window_is_the_event_instant() {
        assert_eq!(
            execution_window_end_v1(E, E + DAY, &minute_and_day(), None),
            Ok(E + 1)
        );
        assert_eq!(
            execution_window_end_v1(E, E + 1, &[], Some("1M")),
            Ok(E + 1)
        );
    }

    const OPEN: &str = "MARKET_DATA.BAR.OPEN.PRICE.V1";
    const CLOSE: &str = "MARKET_DATA.BAR.CLOSE.PRICE.V1";

    /// A Design executes on the role its joins trigger on, or, with no join, on the one role that
    /// reads the BAR close; every ambiguity is refused by name.
    #[rstest]
    fn the_execution_role_is_the_trigger_or_else_the_one_close() {
        let first_corpus = [
            ("minute.open", OPEN),
            ("minute.close", CLOSE),
            ("hour.close", CLOSE),
            ("day.close", CLOSE),
        ];
        assert_eq!(
            execution_role_semantic_id_v1(first_corpus, ["minute.close", "minute.close"]),
            Ok(Some("minute.close")),
            "the joined first corpus executes on its trigger"
        );
        assert_eq!(
            execution_role_semantic_id_v1([("open", OPEN), ("close", CLOSE)], []),
            Ok(Some("close")),
            "without a join the close executes, wherever it stands"
        );
        assert_eq!(
            execution_role_semantic_id_v1([("open", OPEN)], []),
            Ok(None)
        );
        assert_eq!(
            execution_role_semantic_id_v1(first_corpus, []),
            Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous),
            "several closes and no join"
        );
        assert_eq!(
            execution_role_semantic_id_v1(first_corpus, ["minute.close", "day.close"]),
            Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous),
            "joins triggering on different roles"
        );
        assert_eq!(
            execution_role_semantic_id_v1(first_corpus, ["elsewhere"]),
            Err(ExecutionWindowErrorV1::ExecutionRoleAmbiguous),
            "a trigger that is no role of the Design"
        );
    }
}
