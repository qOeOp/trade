//! R&D-owned custody for one request-bound Native Replay execution-input binding.
//!
//! The binding contains only exact Owner locators and digests. Its constituent token is private so
//! callers cannot splice otherwise valid facts; the typed Owner-readback adapter mints it in this
//! module before this persistence boundary can be reached.

use std::collections::BTreeSet;

use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use vibe_backtest_owner_contracts::CanonicalDigestV2;
use vibe_data::owner::{
    bar_schedule::BarScheduleReadbackV1,
    instrument_economic_terms_v1::{
        InstrumentEconomicTermsLocatorV1, InstrumentEconomicTermsReadbackV1,
    },
    instrument_master::InstrumentDecimal,
    instrument_master_v2::{
        FactValue, InstrumentDecimalV2, InstrumentMasterFactV2, InstrumentMasterReadbackV2,
        native_replay_request_identity_v2,
    },
    pit_window_custody_v1::PitWindowChainBasisV1,
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
    universe_selection::UniverseSelectionMembersForRdV1,
};

use crate::{
    NativeReplayExecutionInputBindingCauseV1 as Cause,
    artifact_v2::StrategyArtifactV2,
    exploratory_replay::{ExploratoryReplayRequestLocatorV2, SealedExploratoryReplayReadbackV2},
    native_replay_preparation_inputs_v2::NativeReplayPreparationInputsV2,
    replay_execution_profile_binding_v1::OwnerIssuedReplayExecutionProfileBindingV1,
    strategy_plan_v2::StrategyPlanV2,
    target_set_members::{BoundedMembers, is_admitted_member_count},
};

/// Bumped to 3: schema 2 (the custody-run data path, T1) moved BAR-schedule fields out of
/// `members` into a `data_path` discriminant; schema 3 additionally makes
/// `public_instrument_master_cut` a discriminated `PublicInstrumentMasterCutV1` (a custody run's
/// chain-wide V1 Instrument Master cut uses a different locator shape than a snapshot's V2 one -
/// writing V1 values into the V2-shaped locator would let a downstream V2 resolve misread them).
/// No binding has ever been issued under any earlier schema outside this module's own tests, so
/// there is no byte carried forward from either change.
const SCHEMA_VERSION: u16 = 3;
const BINDING_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-receipt.v1\0";
const OUTBOX_DOMAIN: &[u8] = b"rd.native-replay-execution-input-binding-outbox.v1\0";
const MAX_TEXT_BYTES: usize = 512;
const MAX_CANONICAL_BYTES: usize = 64 * 1024;

/// Exact request/binding locator accepted by the R&D recovery port.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingLocatorV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    binding_identity: [u8; 32],
}

impl NativeReplayExecutionInputBindingLocatorV1 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub const fn binding_identity(&self) -> [u8; 32] {
        self.binding_identity
    }
}

/// Immutable locator-only binding recovered from R&D custody.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    trial_family: NamedLocatorV1,
    artifact: NamedLocatorV1,
    strategy_plan: NamedLocatorV1,
    execution_profile_seals: ExecutionProfileSealLocatorsV1,
    public_instrument_master_cut: PublicInstrumentMasterCutV1,
    members: BoundedMembers<NativeReplayExecutionInputMemberV1>,
    data_path: NativeReplayExecutionDataPathV1,
    binding_identity: [u8; 32],
    binding_digest: [u8; 32],
    canonical_bytes: Vec<u8>,
}

impl NativeReplayExecutionInputBindingV1 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }

    #[must_use]
    pub const fn binding_identity(&self) -> [u8; 32] {
        self.binding_identity
    }

    #[must_use]
    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub fn member_keys(&self) -> Vec<&str> {
        self.members
            .iter()
            .map(|member| member.member_key.as_str())
            .collect()
    }

    /// The custody run this binding names, or `None` for a single-frame (snapshot) binding.
    ///
    /// Per-member economic-terms locators and the public Instrument Master cut stay shared for
    /// both data paths (`members()`/accessors above); this names only the custody-run-specific
    /// chain/window coordinate. A consumer re-resolves the run from `chain_root` and the window,
    /// and refuses by name when the head it reads back differs from `head_identity` - never
    /// follows a newer head.
    #[must_use]
    pub const fn custody_run(&self) -> Option<ReplayCustodyRunBindingV1> {
        match &self.data_path {
            NativeReplayExecutionDataPathV1::CustodyRun(run) => Some(*run),
            NativeReplayExecutionDataPathV1::Snapshot { .. } => None,
        }
    }
}

/// A PIT window custody run named by a chain root and a window, as the sealed Replay commit (H7)
/// accepted it in place of a single PIT snapshot identity.
///
/// `head_identity` is pinned once, at issuance, from the head Market Data's
/// `resolve_pit_window_frames_v1` names for this exact `(chain_root, run_start_ns,
/// run_end_ns_exclusive)`; it is never advanced to a later one by the binding itself.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayCustodyRunBindingV1 {
    pub chain_root: [u8; 32],
    pub head_identity: [u8; 32],
    pub run_start_ns: u64,
    pub run_end_ns_exclusive: u64,
}

/// Which data a Native Replay execution reads: one committed PIT snapshot, or a run over a PIT
/// window custody chain.
///
/// Per-member economic-terms locators and the public Instrument Master cut are per-instrument,
/// not per-data-path, so they stay on [`NativeReplayExecutionInputBindingV1`] itself rather than
/// in either variant here.
#[derive(Debug, Eq, PartialEq)]
enum NativeReplayExecutionDataPathV1 {
    Snapshot {
        universe_frame_receipt: ExactOwnerLocatorV1,
        member_bar_schedules: BoundedMembers<NativeReplayExecutionMemberBarScheduleV1>,
    },
    CustodyRun(ReplayCustodyRunBindingV1),
}

/// One member's BAR schedule locators, the single-frame (snapshot) path only: a custody run's
/// schedule is already minted once, per member, as T0-4b's window schedule fact, so there is
/// nothing for this path to mint or bind here.
#[derive(Clone, Debug, Eq, PartialEq)]
struct NativeReplayExecutionMemberBarScheduleV1 {
    member_key: String,
    schedule_identity: [u8; 32],
    bar_schedule_cut: ExactOwnerLocatorV1,
    bar_schedule_receipt: ExactOwnerLocatorV1,
}

#[derive(Debug, Eq, PartialEq)]
struct NamedLocatorV1 {
    identity: String,
    digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExactOwnerLocatorV1 {
    identity: [u8; 32],
    digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct InstrumentMasterCutLocatorBindingV1 {
    request_identity: [u8; 32],
    request_binding_digest: [u8; 32],
    cut_identity: [u8; 32],
    receipt_identity: [u8; 32],
}

/// The Instrument Master cut a binding names, by data path.
///
/// A snapshot binding's locator is V2 resolver vocabulary (`request_binding_digest` is a V2
/// concept): a custody-run value must never be written into it, or a downstream V2 resolve would
/// answer `UnknownLocator` or, worse, resolve the wrong thing. A custody run names the chain's own
/// V1 cut instead - minted once at root-custody-commit time from the chain root, bound to the
/// chain rather than to any one Replay request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PublicInstrumentMasterCutV1 {
    SnapshotV2(InstrumentMasterCutLocatorBindingV1),
    CustodyChainV1 {
        chain_root: [u8; 32],
        cut_identity: [u8; 32],
        receipt_identity: [u8; 32],
        request_identity: [u8; 32],
        request_meaning_digest: [u8; 32],
    },
}

#[derive(Debug, Eq, PartialEq)]
struct ExecutionProfileSealLocatorsV1 {
    catalog_binding_digest: [u8; 32],
    family_binding_digest: [u8; 32],
    request_binding_digest: [u8; 32],
    economic_configuration_digest: [u8; 32],
    runner_operational_profile_digest: [u8; 32],
}

#[derive(Debug, Eq, PartialEq)]
struct NativeReplayExecutionInputMemberV1 {
    member_key: String,
    public_instrument_identity: String,
    public_instrument_digest: [u8; 32],
    venue_identity: String,
    account_scope_identity: String,
    instrument_economic_terms_fact: ExactOwnerLocatorV1,
    instrument_economic_terms_receipt: ExactOwnerLocatorV1,
}

/// Deterministic receipt for the immutable binding.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingReceiptV1 {
    receipt_identity: [u8; 32],
    binding_identity: [u8; 32],
    binding_digest: [u8; 32],
    committed_at_epoch_ms: u64,
    canonical_bytes: Vec<u8>,
}

impl NativeReplayExecutionInputBindingReceiptV1 {
    #[must_use]
    pub const fn receipt_identity(&self) -> [u8; 32] {
        self.receipt_identity
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// The Owner cut epoch this binding was committed against.
    ///
    /// The V2 binding extends exactly this V1 binding, so it commits against the same epoch
    /// rather than reading a clock of its own.
    #[must_use]
    pub(crate) const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Debug, Eq, PartialEq)]
struct NativeReplayExecutionInputBindingOutboxV1 {
    event_identity: [u8; 32],
    request_identity: String,
    binding_identity: [u8; 32],
    receipt_identity: [u8; 32],
    payload_digest: [u8; 32],
    canonical_bytes: Vec<u8>,
}

/// Move-only R&D Owner readback consumed by the future Native Replay preparation adapter.
#[derive(Debug, Eq, PartialEq)]
pub struct NativeReplayExecutionInputBindingReadbackV1 {
    binding: NativeReplayExecutionInputBindingV1,
    receipt: NativeReplayExecutionInputBindingReceiptV1,
    outbox: NativeReplayExecutionInputBindingOutboxV1,
}

impl NativeReplayExecutionInputBindingReadbackV1 {
    #[must_use]
    pub const fn binding(&self) -> &NativeReplayExecutionInputBindingV1 {
        &self.binding
    }

    #[must_use]
    pub const fn receipt(&self) -> &NativeReplayExecutionInputBindingReceiptV1 {
        &self.receipt
    }

    #[must_use]
    pub fn locator(&self) -> NativeReplayExecutionInputBindingLocatorV1 {
        NativeReplayExecutionInputBindingLocatorV1 {
            request_locator: self.binding.request_locator.clone(),
            binding_identity: self.binding.binding_identity,
        }
    }

    pub(crate) fn instrument_economic_terms_locators(
        &self,
    ) -> Result<
        BoundedMembers<InstrumentEconomicTermsLocatorV1>,
        NativeReplayExecutionInputBindingErrorV1,
    > {
        let locator = |member: &NativeReplayExecutionInputMemberV1| {
            InstrumentEconomicTermsLocatorV1::from_identities(
                member.instrument_economic_terms_fact.identity,
                member.instrument_economic_terms_receipt.identity,
            )
            .map_err(|_| {
                NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
            })
        };
        self.binding.members.try_map(locator)
    }
}

/// Redacted fail-closed outcome for issuance and recovery.
#[derive(Debug, Error)]
pub enum NativeReplayExecutionInputBindingErrorV1 {
    /// Issuance or recovery cannot answer, for the named reason. The cause carries no Owner
    /// detail: issuance records that under its stage's coordinate.
    #[error("Native Replay execution-input binding unavailable: {}", .0.code())]
    Unavailable(NativeReplayExecutionInputBindingCauseV1),
    #[error("Native Replay execution-input binding custody conflict")]
    Conflict,
    /// The sealed Replay request has no Composer-backed V3 record, so it names no Market Data
    /// composition binding to issue its Instrument Master cut over. Nothing is guessed in its
    /// place, and no retry changes the answer.
    #[error("sealed Replay request names no Market Data composition binding")]
    NoCompositionBinding,
    /// The Instrument Master V2 cut's facts disagree with the V1 facts the composition binding's
    /// PIT snapshot cites. The cut's facts are fixed at the selection's observation, so no retry
    /// changes the answer; Market Data wrote nothing.
    #[error(
        "Instrument Master V2 facts disagree with the V1 facts the Replay's PIT snapshot cites"
    )]
    InstrumentMasterGenerationMismatch,
    /// A member's Instrument Master V2 terms were changed by a later `exchangeInfo` snapshot, and
    /// the cut does not yet select by the Replay window, so it refuses the member whatever the
    /// window. The facts are fixed at the selection's observation, so no retry changes the answer;
    /// Market Data wrote nothing.
    #[error("an Instrument Master V2 member's terms changed at a later snapshot")]
    InstrumentMasterTermsChanged,
    #[error("Native Replay execution-input binding storage unavailable: {0}")]
    Storage(#[source] sqlx::Error),
}

/// Why an execution-input binding is `Unavailable`: one name for each check that refuses it.
///
/// The list is closed. [`Self::code`] matches it with no wildcard, so a site cannot refuse
/// without naming one of these, and a new one is a new variant with its own code. A code is a
/// stable wire name; the HTTP answer stays 503 for every one of them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum NativeReplayExecutionInputBindingCauseV1 {
    // Issuance, in the order its stages run.
    /// The sealed Replay request, its family or its Composer readback could not be resolved.
    PreparationUnresolved,
    /// The Composer's Plan bytes do not decode to the Plan projection issuance needs.
    PlanProjectionUndecodable,
    /// The request identity cannot key an Instrument Master cut.
    RequestIdentityInvalid,
    /// The request's Market Data composition binding could not be read.
    CompositionBindingUnreadable,
    /// Market Data did not issue the request-keyed Instrument Master cut.
    InstrumentMasterCutNotIssued,
    /// A member has no admitted BAR schedule at the frame. Until Market Data commits one, no
    /// retry changes the answer.
    BarScheduleAbsent,
    /// A member's BAR schedule for the frame cannot be chosen: two answer it, or the frame's roles
    /// read more than one bar label.
    BarScheduleUnavailable,
    /// The frame's Source Binding declares no bar timeframe, so no schedule can be chosen.
    SourceBindingDeclaresNoBarTimeframe,
    /// A role's timeframe, or every schedule of a member at the frame, is not the bar the frame's
    /// Source Binding declares.
    DeclaredBarTimeframeMismatch,
    /// No role reads the BAR close, so no role executes and prices the frame.
    ExecutionRoleAbsent,
    /// More than one role reads the BAR close.
    ExecutionRoleAmbiguous,
    /// A BAR role reads another timeframe than the execution role.
    MoreThanOneRoleTimeframe,
    /// The frame's Source Binding declares no bar for the execution role's timeframe label.
    ExecutionTimeframeNotDeclared,
    /// The frame's declared bar is a `CalendarMonth` cadence, which no window schedule can
    /// enumerate as an execution timeframe yet.
    CalendarMonthNotAnExecutionTimeframe,
    /// Market Data did not issue the initial frame's universe sample projection, for a reason
    /// other than the schedule ones above.
    SampleProjectionNotIssued,
    /// The request-keyed Instrument Master cut could not be resolved.
    InstrumentMasterUnresolved,
    /// The resolved Instrument Master cut belongs to another Replay request.
    InstrumentMasterCutForeign,
    /// The sealed Replay policy carries no Replay Policy Catalog V3.
    ReplayPolicyCatalogAbsent,
    /// The Replay Policy Catalog V3 does not verify.
    ReplayPolicyCatalogInvalid,
    /// No economic terms apply to every member at the Replay's venue, quote currency and window
    /// start. A member listed at another venue has none there either.
    EconomicTermsAbsent,
    /// More than one terms fact or account scope could apply to the same members.
    EconomicTermsAmbiguous,
    /// The economic terms could not be resolved: the store, its ACL or its readback failed.
    EconomicTermsUnresolved,
    /// The Owner-issued execution profile could not be issued from the family and the terms.
    ExecutionProfileNotIssued,
    /// The Plan states an input role the initial frame cannot read: not a universe Market Data
    /// role, or one with an unknown field, channel or unit.
    PlanRolesUnsupported,
    /// Market Data did not resolve the initial frame's market inputs, for a reason other than the
    /// schedule ones above.
    MarketInputsUnresolved,
    /// The initial frame's sample projection names another universe frame than the one resolved.
    SampleProjectionNamesAnotherFrame,
    /// The Plan does not revalidate against the resolved universe frame.
    PlanRevalidationRefused,
    /// The artifact does not revalidate against the Plan.
    ArtifactRevalidationRefused,

    // Verification that the Owner readbacks agree with each other and with the request: one cause
    // for each clause, in the order they are checked.
    /// The Plan binds no Owner universe selection.
    PlanHasNoUniverseSelection,
    /// The sealed Replay carries no execution profile seal.
    ReplayHasNoExecutionProfileSeal,
    /// A digest the request or the family states is not a canonical `sha256:` digest.
    DigestNotCanonical,
    /// The execution profile was issued for another Replay request.
    ExecutionProfileNamesAnotherRequest,
    /// The execution profile names another TrialFamily than the request's.
    ExecutionProfileNamesAnotherFamily,
    /// The execution profile's TrialFamily digest is not the family root's.
    ExecutionProfileFamilyDigestDiffers,
    /// The execution profile names another Plan than the request.
    ExecutionProfileNamesAnotherPlan,
    /// The execution profile's Plan digest is not the request's.
    ExecutionProfilePlanDigestDiffers,
    /// The Plan's canonical digest is not the one the request names.
    PlanDigestDiffersFromRequest,
    /// The execution profile names another artifact than the request.
    ExecutionProfileNamesAnotherArtifact,
    /// The execution profile's artifact digest is not the request's.
    ExecutionProfileArtifactDigestDiffers,
    /// The artifact's identity is not the digest the request names.
    ArtifactDigestDiffersFromRequest,
    /// The execution profile names another universe selection than the request.
    ExecutionProfileNamesAnotherUniverseSelection,
    /// The execution profile's universe selection digest is not the request's.
    ExecutionProfileUniverseSelectionDigestDiffers,
    /// The execution profile was issued over other economic terms than the ones resolved.
    ExecutionProfileNamesOtherEconomicTerms,
    /// The Composer's Plan bytes are not the Plan's durable bytes.
    ComposerPlanBytesDiffer,
    /// The Composer's artifact package bytes are not the artifact's.
    ComposerArtifactPackageDiffers,
    /// The Composer's module bytes are not the artifact's modules.
    ComposerModulesDiffer,
    /// The artifact does not validate for the Plan.
    ArtifactInvalidForPlan,
    /// The universe frame holds a member count no native Replay admits.
    MemberCountNotAdmitted,
    /// The universe frame's members are not in strictly ascending member-key order.
    UniverseFrameMembersOutOfOrder,
    /// There is not exactly one economic terms readback for each member.
    EconomicTermsCountDiffers,
    /// There is not exactly one BAR schedule for each member.
    BarScheduleCountDiffers,
    /// The universe frame's selection identity is not the Plan's.
    UniverseFrameSelectionIdentityDiffersFromPlan,
    /// The universe frame's selection digest is not the Plan's.
    UniverseFrameSelectionDigestDiffersFromPlan,
    /// The universe frame holds another member count than the Plan's selection.
    UniverseFrameMemberCountDiffersFromPlan,
    /// A universe frame member's key or instrument is not the Plan's at the same position.
    UniverseFrameMembersDifferFromPlan,
    /// The Instrument Master cut was issued for another Replay request.
    InstrumentMasterCutNamesAnotherRequest,
    /// The Instrument Master cut holds another member count than the universe frame.
    InstrumentMasterCutMemberCountDiffers,
    /// A member's public instrument fact states no valid native crypto perpetual terms.
    PublicTermsInvalid,
    /// A universe frame member is not the Instrument Master cut's instrument at the same position.
    InstrumentMasterCutMemberDiffers,
    /// A member's economic terms name another instrument.
    EconomicTermsNameAnotherInstrument,
    /// A member's economic terms cite another public instrument fact.
    EconomicTermsCiteAnotherPublicFact,
    /// A member's economic terms name another venue than its public fact.
    EconomicTermsNameAnotherVenue,
    /// A member's economic terms name another quote currency than its public terms.
    EconomicTermsNameAnotherQuoteCurrency,
    /// A member's economic terms take effect after the Replay window's start.
    EconomicTermsNotYetInForce,
    /// A member's economic terms end at or before the Replay window's start.
    EconomicTermsNoLongerInForce,
    /// A member's economic terms readback does not verify.
    EconomicTermsDoNotVerify,
    /// A member's BAR schedule names another instrument.
    BarScheduleNamesAnotherInstrument,
    /// A member's BAR schedule is cut at another instant than the Replay window's start.
    BarScheduleCutAtAnotherInstant,
    /// The members' economic terms name more than one account scope.
    AccountScopesDiffer,

    // Custody of the binding itself.
    /// The verified constituents name another request than the sealed Replay being issued for.
    RequestLocatorMismatch,
    /// No frozen V2 request matches the locator's meaning, receipt and seal, so nothing was
    /// appended.
    RequestNotSealed,
    /// The binding tables' ownership, persistence or ACL is not the Owner's alone.
    StorageBoundaryInvalid,
    // The constituents the binding records, each checked before it is encoded: one cause per
    // check, in order.
    /// The request identity is empty, blank or longer than 512 bytes.
    BindingRequestIdentityInvalid,
    /// The request's meaning digest is not a canonical `sha256:` digest.
    BindingRequestMeaningDigestInvalid,
    /// The request's receipt identity is empty, blank or longer than 512 bytes.
    BindingRequestReceiptIdentityInvalid,
    /// The request's seal digest is not a canonical `sha256:` digest.
    BindingRequestSealDigestInvalid,
    /// The TrialFamily locator's identity is not valid text, or its digest is zero.
    BindingTrialFamilyLocatorInvalid,
    /// The artifact locator's identity is not valid text, or its digest is zero.
    BindingArtifactLocatorInvalid,
    /// The Plan locator's identity is not valid text, or its digest is zero.
    BindingStrategyPlanLocatorInvalid,
    /// One of the Instrument Master cut locator's four identities is zero.
    BindingInstrumentMasterCutLocatorInvalid,
    /// The universe frame receipt's identity or digest is zero.
    BindingUniverseFrameReceiptInvalid,
    /// The members are not in strictly ascending member-key order.
    BindingMembersOutOfOrder,
    /// Two members name the same public instrument.
    BindingMembersRepeatAnInstrument,
    /// A member's key is empty, blank or longer than 512 bytes.
    BindingMemberKeyInvalid,
    /// A member's public instrument identity is empty, blank or longer than 512 bytes.
    BindingMemberInstrumentIdentityInvalid,
    /// A member's public instrument digest is zero.
    BindingMemberInstrumentDigestZero,
    /// A member's venue identity is empty, blank or longer than 512 bytes.
    BindingMemberVenueInvalid,
    /// A member's account scope identity is empty, blank or longer than 512 bytes.
    BindingMemberAccountScopeInvalid,
    /// A member's BAR schedule identity is zero.
    BindingMemberScheduleIdentityZero,
    /// A member's economic terms fact locator has a zero identity or digest.
    BindingMemberEconomicTermsFactInvalid,
    /// A member's economic terms receipt locator has a zero identity or digest.
    BindingMemberEconomicTermsReceiptInvalid,
    /// A member's BAR schedule cut locator has a zero identity or digest.
    BindingMemberBarScheduleCutInvalid,
    /// A member's BAR schedule receipt locator has a zero identity or digest.
    BindingMemberBarScheduleReceiptInvalid,
    /// The snapshot path's BAR-schedule member list is not the same length as the shared member
    /// list.
    BindingMemberBarSchedulesCountDiffers,
    /// The snapshot path's BAR-schedule member list is not in the same member-key order as the
    /// shared member list.
    BindingMemberBarSchedulesOutOfOrder,
    /// A custody run's chain root is zero.
    BindingCustodyRunChainRootZero,
    /// A custody run's pinned head identity is zero.
    BindingCustodyRunHeadIdentityZero,
    /// A custody run's window is not strictly ordered (`run_start_ns < run_end_ns_exclusive`).
    BindingCustodyRunWindowInvalid,
    /// The custody chain's own declared members (`PitWindowChainBasisV1::members`) are not the
    /// same instrument set, in the same order, as the Universe Selection record's.
    CustodyMembersNotTheChains,
    /// A custody member's linked V2 Instrument Master fact disagrees with the custody chain's own
    /// V1 fact for that member: canonical identity, a currency, an increment or the contract
    /// multiplier differs, or the chain's structural projection could not be derived at all.
    CustodyPublicTermsDisagreeWithChainInstrumentMaster,
    /// The execution profile seal's Replay Policy Catalog binding digest is zero.
    CatalogBindingSealZero,
    /// The execution profile seal's TrialFamily binding digest is zero.
    FamilyBindingSealZero,
    /// The execution profile seal's request binding digest is zero.
    RequestBindingSealZero,
    /// The execution profile's economic configuration digest is zero.
    EconomicConfigurationDigestZero,
    /// The execution profile's runner operational profile digest is zero.
    RunnerOperationalProfileDigestZero,
    /// A text, count or the whole binding exceeds its canonical encoding's bounds.
    BindingNotEncodable,
    /// A stored binding, receipt or outbox row does not decode or does not reproduce its digests.
    StoredBindingCorrupt,
    /// A fresh Owner resolution does not reproduce the stored binding.
    ReResolutionDiffers,
    /// An issued binding could not be re-resolved into a native execution bundle.
    ExecutionBundleUnresolved,
    /// A custody-run re-verification was asked of a binding whose data path is a snapshot, not a
    /// custody run.
    BindingIsNotACustodyRun,
}

impl NativeReplayExecutionInputBindingCauseV1 {
    /// The cause's stable wire name.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::PreparationUnresolved => "PREPARATION_UNRESOLVED",
            Self::PlanProjectionUndecodable => "PLAN_PROJECTION_UNDECODABLE",
            Self::RequestIdentityInvalid => "REQUEST_IDENTITY_INVALID",
            Self::CompositionBindingUnreadable => "COMPOSITION_BINDING_UNREADABLE",
            Self::InstrumentMasterCutNotIssued => "INSTRUMENT_MASTER_CUT_NOT_ISSUED",
            Self::BarScheduleAbsent => "BAR_SCHEDULE_ABSENT",
            Self::BarScheduleUnavailable => "BAR_SCHEDULE_UNAVAILABLE",
            Self::SourceBindingDeclaresNoBarTimeframe => "SOURCE_BINDING_DECLARES_NO_BAR_TIMEFRAME",
            Self::DeclaredBarTimeframeMismatch => "DECLARED_BAR_TIMEFRAME_MISMATCH",
            Self::ExecutionRoleAbsent => "EXECUTION_ROLE_ABSENT",
            Self::ExecutionRoleAmbiguous => "EXECUTION_ROLE_AMBIGUOUS",
            Self::MoreThanOneRoleTimeframe => "MORE_THAN_ONE_ROLE_TIMEFRAME",
            Self::ExecutionTimeframeNotDeclared => "EXECUTION_TIMEFRAME_NOT_DECLARED",
            Self::CalendarMonthNotAnExecutionTimeframe => {
                "CALENDAR_MONTH_NOT_AN_EXECUTION_TIMEFRAME"
            }
            Self::SampleProjectionNotIssued => "SAMPLE_PROJECTION_NOT_ISSUED",
            Self::InstrumentMasterUnresolved => "INSTRUMENT_MASTER_UNRESOLVED",
            Self::InstrumentMasterCutForeign => "INSTRUMENT_MASTER_CUT_FOREIGN",
            Self::ReplayPolicyCatalogAbsent => "REPLAY_POLICY_CATALOG_ABSENT",
            Self::ReplayPolicyCatalogInvalid => "REPLAY_POLICY_CATALOG_INVALID",
            Self::EconomicTermsAbsent => "ECONOMIC_TERMS_ABSENT",
            Self::EconomicTermsAmbiguous => "ECONOMIC_TERMS_AMBIGUOUS",
            Self::EconomicTermsUnresolved => "ECONOMIC_TERMS_UNRESOLVED",
            Self::ExecutionProfileNotIssued => "EXECUTION_PROFILE_NOT_ISSUED",
            Self::PlanRolesUnsupported => "PLAN_ROLES_UNSUPPORTED",
            Self::MarketInputsUnresolved => "MARKET_INPUTS_UNRESOLVED",
            Self::SampleProjectionNamesAnotherFrame => "SAMPLE_PROJECTION_NAMES_ANOTHER_FRAME",
            Self::PlanRevalidationRefused => "PLAN_REVALIDATION_REFUSED",
            Self::ArtifactRevalidationRefused => "ARTIFACT_REVALIDATION_REFUSED",
            Self::PlanHasNoUniverseSelection => "PLAN_HAS_NO_UNIVERSE_SELECTION",
            Self::ReplayHasNoExecutionProfileSeal => "REPLAY_HAS_NO_EXECUTION_PROFILE_SEAL",
            Self::DigestNotCanonical => "DIGEST_NOT_CANONICAL",
            Self::ExecutionProfileNamesAnotherRequest => "EXECUTION_PROFILE_NAMES_ANOTHER_REQUEST",
            Self::ExecutionProfileNamesAnotherFamily => "EXECUTION_PROFILE_NAMES_ANOTHER_FAMILY",
            Self::ExecutionProfileFamilyDigestDiffers => "EXECUTION_PROFILE_FAMILY_DIGEST_DIFFERS",
            Self::ExecutionProfileNamesAnotherPlan => "EXECUTION_PROFILE_NAMES_ANOTHER_PLAN",
            Self::ExecutionProfilePlanDigestDiffers => "EXECUTION_PROFILE_PLAN_DIGEST_DIFFERS",
            Self::PlanDigestDiffersFromRequest => "PLAN_DIGEST_DIFFERS_FROM_REQUEST",
            Self::ExecutionProfileNamesAnotherArtifact => {
                "EXECUTION_PROFILE_NAMES_ANOTHER_ARTIFACT"
            }
            Self::ExecutionProfileArtifactDigestDiffers => {
                "EXECUTION_PROFILE_ARTIFACT_DIGEST_DIFFERS"
            }
            Self::ArtifactDigestDiffersFromRequest => "ARTIFACT_DIGEST_DIFFERS_FROM_REQUEST",
            Self::ExecutionProfileNamesAnotherUniverseSelection => {
                "EXECUTION_PROFILE_NAMES_ANOTHER_UNIVERSE_SELECTION"
            }
            Self::ExecutionProfileUniverseSelectionDigestDiffers => {
                "EXECUTION_PROFILE_UNIVERSE_SELECTION_DIGEST_DIFFERS"
            }
            Self::ExecutionProfileNamesOtherEconomicTerms => {
                "EXECUTION_PROFILE_NAMES_OTHER_ECONOMIC_TERMS"
            }
            Self::ComposerPlanBytesDiffer => "COMPOSER_PLAN_BYTES_DIFFER",
            Self::ComposerArtifactPackageDiffers => "COMPOSER_ARTIFACT_PACKAGE_DIFFERS",
            Self::ComposerModulesDiffer => "COMPOSER_MODULES_DIFFER",
            Self::ArtifactInvalidForPlan => "ARTIFACT_INVALID_FOR_PLAN",
            Self::MemberCountNotAdmitted => "MEMBER_COUNT_NOT_ADMITTED",
            Self::UniverseFrameMembersOutOfOrder => "UNIVERSE_FRAME_MEMBERS_OUT_OF_ORDER",
            Self::EconomicTermsCountDiffers => "ECONOMIC_TERMS_COUNT_DIFFERS",
            Self::BarScheduleCountDiffers => "BAR_SCHEDULE_COUNT_DIFFERS",
            Self::UniverseFrameSelectionIdentityDiffersFromPlan => {
                "UNIVERSE_FRAME_SELECTION_IDENTITY_DIFFERS_FROM_PLAN"
            }
            Self::UniverseFrameSelectionDigestDiffersFromPlan => {
                "UNIVERSE_FRAME_SELECTION_DIGEST_DIFFERS_FROM_PLAN"
            }
            Self::UniverseFrameMemberCountDiffersFromPlan => {
                "UNIVERSE_FRAME_MEMBER_COUNT_DIFFERS_FROM_PLAN"
            }
            Self::UniverseFrameMembersDifferFromPlan => "UNIVERSE_FRAME_MEMBERS_DIFFER_FROM_PLAN",
            Self::InstrumentMasterCutNamesAnotherRequest => {
                "INSTRUMENT_MASTER_CUT_NAMES_ANOTHER_REQUEST"
            }
            Self::InstrumentMasterCutMemberCountDiffers => {
                "INSTRUMENT_MASTER_CUT_MEMBER_COUNT_DIFFERS"
            }
            Self::PublicTermsInvalid => "PUBLIC_TERMS_INVALID",
            Self::InstrumentMasterCutMemberDiffers => "INSTRUMENT_MASTER_CUT_MEMBER_DIFFERS",
            Self::EconomicTermsNameAnotherInstrument => "ECONOMIC_TERMS_NAME_ANOTHER_INSTRUMENT",
            Self::EconomicTermsCiteAnotherPublicFact => "ECONOMIC_TERMS_CITE_ANOTHER_PUBLIC_FACT",
            Self::EconomicTermsNameAnotherVenue => "ECONOMIC_TERMS_NAME_ANOTHER_VENUE",
            Self::EconomicTermsNameAnotherQuoteCurrency => {
                "ECONOMIC_TERMS_NAME_ANOTHER_QUOTE_CURRENCY"
            }
            Self::EconomicTermsNotYetInForce => "ECONOMIC_TERMS_NOT_YET_IN_FORCE",
            Self::EconomicTermsNoLongerInForce => "ECONOMIC_TERMS_NO_LONGER_IN_FORCE",
            Self::EconomicTermsDoNotVerify => "ECONOMIC_TERMS_DO_NOT_VERIFY",
            Self::BarScheduleNamesAnotherInstrument => "BAR_SCHEDULE_NAMES_ANOTHER_INSTRUMENT",
            Self::BarScheduleCutAtAnotherInstant => "BAR_SCHEDULE_CUT_AT_ANOTHER_INSTANT",
            Self::AccountScopesDiffer => "ACCOUNT_SCOPES_DIFFER",
            Self::RequestLocatorMismatch => "REQUEST_LOCATOR_MISMATCH",
            Self::RequestNotSealed => "REQUEST_NOT_SEALED",
            Self::StorageBoundaryInvalid => "STORAGE_BOUNDARY_INVALID",
            Self::BindingRequestIdentityInvalid => "BINDING_REQUEST_IDENTITY_INVALID",
            Self::BindingRequestMeaningDigestInvalid => "BINDING_REQUEST_MEANING_DIGEST_INVALID",
            Self::BindingRequestReceiptIdentityInvalid => {
                "BINDING_REQUEST_RECEIPT_IDENTITY_INVALID"
            }
            Self::BindingRequestSealDigestInvalid => "BINDING_REQUEST_SEAL_DIGEST_INVALID",
            Self::BindingTrialFamilyLocatorInvalid => "BINDING_TRIAL_FAMILY_LOCATOR_INVALID",
            Self::BindingArtifactLocatorInvalid => "BINDING_ARTIFACT_LOCATOR_INVALID",
            Self::BindingStrategyPlanLocatorInvalid => "BINDING_STRATEGY_PLAN_LOCATOR_INVALID",
            Self::BindingInstrumentMasterCutLocatorInvalid => {
                "BINDING_INSTRUMENT_MASTER_CUT_LOCATOR_INVALID"
            }
            Self::BindingUniverseFrameReceiptInvalid => "BINDING_UNIVERSE_FRAME_RECEIPT_INVALID",
            Self::BindingMembersOutOfOrder => "BINDING_MEMBERS_OUT_OF_ORDER",
            Self::BindingMembersRepeatAnInstrument => "BINDING_MEMBERS_REPEAT_AN_INSTRUMENT",
            Self::BindingMemberKeyInvalid => "BINDING_MEMBER_KEY_INVALID",
            Self::BindingMemberInstrumentIdentityInvalid => {
                "BINDING_MEMBER_INSTRUMENT_IDENTITY_INVALID"
            }
            Self::BindingMemberInstrumentDigestZero => "BINDING_MEMBER_INSTRUMENT_DIGEST_ZERO",
            Self::BindingMemberVenueInvalid => "BINDING_MEMBER_VENUE_INVALID",
            Self::BindingMemberAccountScopeInvalid => "BINDING_MEMBER_ACCOUNT_SCOPE_INVALID",
            Self::BindingMemberScheduleIdentityZero => "BINDING_MEMBER_SCHEDULE_IDENTITY_ZERO",
            Self::BindingMemberEconomicTermsFactInvalid => {
                "BINDING_MEMBER_ECONOMIC_TERMS_FACT_INVALID"
            }
            Self::BindingMemberEconomicTermsReceiptInvalid => {
                "BINDING_MEMBER_ECONOMIC_TERMS_RECEIPT_INVALID"
            }
            Self::BindingMemberBarScheduleCutInvalid => "BINDING_MEMBER_BAR_SCHEDULE_CUT_INVALID",
            Self::BindingMemberBarScheduleReceiptInvalid => {
                "BINDING_MEMBER_BAR_SCHEDULE_RECEIPT_INVALID"
            }
            Self::BindingMemberBarSchedulesCountDiffers => {
                "BINDING_MEMBER_BAR_SCHEDULES_COUNT_DIFFERS"
            }
            Self::BindingMemberBarSchedulesOutOfOrder => {
                "BINDING_MEMBER_BAR_SCHEDULES_OUT_OF_ORDER"
            }
            Self::BindingCustodyRunChainRootZero => "BINDING_CUSTODY_RUN_CHAIN_ROOT_ZERO",
            Self::BindingCustodyRunHeadIdentityZero => "BINDING_CUSTODY_RUN_HEAD_IDENTITY_ZERO",
            Self::BindingCustodyRunWindowInvalid => "BINDING_CUSTODY_RUN_WINDOW_INVALID",
            Self::CustodyMembersNotTheChains => "CUSTODY_MEMBERS_NOT_THE_CHAINS",
            Self::CustodyPublicTermsDisagreeWithChainInstrumentMaster => {
                "CUSTODY_PUBLIC_TERMS_DISAGREE_WITH_CHAIN_INSTRUMENT_MASTER"
            }
            Self::CatalogBindingSealZero => "CATALOG_BINDING_SEAL_ZERO",
            Self::FamilyBindingSealZero => "FAMILY_BINDING_SEAL_ZERO",
            Self::RequestBindingSealZero => "REQUEST_BINDING_SEAL_ZERO",
            Self::EconomicConfigurationDigestZero => "ECONOMIC_CONFIGURATION_DIGEST_ZERO",
            Self::RunnerOperationalProfileDigestZero => "RUNNER_OPERATIONAL_PROFILE_DIGEST_ZERO",
            Self::BindingNotEncodable => "BINDING_NOT_ENCODABLE",
            Self::StoredBindingCorrupt => "STORED_BINDING_CORRUPT",
            Self::ReResolutionDiffers => "RE_RESOLUTION_DIFFERS",
            Self::ExecutionBundleUnresolved => "EXECUTION_BUNDLE_UNRESOLVED",
            Self::BindingIsNotACustodyRun => "BINDING_IS_NOT_A_CUSTODY_RUN",
        }
    }
}

/// Private, move-only proof that all exact constituent Owner readbacks were verified together.
///
/// No caller-facing constructor, deserializer, or clone implementation exists. T140 must add the
/// typed Owner-readback adapter beside this token and mint it only after the complete equality proof.
pub(crate) struct VerifiedNativeReplayExecutionInputConstituentsV1 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    trial_family: NamedLocatorV1,
    artifact: NamedLocatorV1,
    strategy_plan: NamedLocatorV1,
    execution_profile_seals: ExecutionProfileSealLocatorsV1,
    public_instrument_master_cut: PublicInstrumentMasterCutV1,
    members: BoundedMembers<NativeReplayExecutionInputMemberV1>,
    data_path: NativeReplayExecutionDataPathV1,
}

/// Verifies the complete typed Owner readback set and atomically persists its R&D binding.
///
/// This is crate-private so an application caller cannot replace any constituent with locator
/// fields or reconstructed bytes. The service composition root must first resolve every Owner
/// capability and may then transfer those move-only/read-only values through this boundary.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn issue_native_replay_execution_input_binding_from_owner_readbacks_v1(
    transaction: &mut Transaction<'_, Postgres>,
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    instrument_master: &InstrumentMasterReadbackV2,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    universe_frame: &StrategyInputUniverseFrameReceipt,
    schedules: &[&BarScheduleReadbackV1],
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    let verified = verify_owner_readbacks(
        preparation,
        profile,
        plan,
        artifact,
        instrument_master,
        instrument_terms,
        universe_frame,
        schedules,
    )?;
    issue_native_replay_execution_input_binding_v1_in_transaction(
        transaction,
        preparation.replay(),
        verified,
    )
    .await
}

/// Verifies a custody run's complete constituent set and atomically appends its binding, receipt
/// and outbox row under the already sealed Replay request, exactly as
/// [`issue_native_replay_execution_input_binding_from_owner_readbacks_v1`] does for a snapshot.
///
/// See [`verify_custody_run_shared_replay_execution_inputs`] for what each parameter is and where
/// it comes from.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn issue_native_replay_execution_input_binding_from_custody_run_v1(
    transaction: &mut Transaction<'_, Postgres>,
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    basis: &PitWindowChainBasisV1,
    custody_members: &UniverseSelectionMembersForRdV1,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    resolved_public_terms: &[&InstrumentMasterFactV2],
    run: ReplayCustodyRunBindingV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    refuse_invalid_custody_run(run)?;
    let shared = verify_custody_run_shared_replay_execution_inputs(
        preparation,
        profile,
        plan,
        artifact,
        basis,
        custody_members,
        instrument_terms,
        resolved_public_terms,
        run.run_start_ns,
        run.run_end_ns_exclusive,
    )?;
    let verified = VerifiedNativeReplayExecutionInputConstituentsV1 {
        request_locator: preparation.replay().locator(),
        trial_family: shared.trial_family,
        artifact: shared.artifact,
        strategy_plan: shared.strategy_plan,
        execution_profile_seals: shared.execution_profile_seals,
        public_instrument_master_cut: shared.public_instrument_master_cut,
        members: shared.members,
        data_path: NativeReplayExecutionDataPathV1::CustodyRun(run),
    };
    issue_native_replay_execution_input_binding_v1_in_transaction(
        transaction,
        preparation.replay(),
        verified,
    )
    .await
}

fn refuse_invalid_custody_run(
    run: ReplayCustodyRunBindingV1,
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    let unavailable = NativeReplayExecutionInputBindingErrorV1::Unavailable;

    if run.chain_root == [0; 32] {
        return Err(unavailable(Cause::BindingCustodyRunChainRootZero));
    }

    if run.head_identity == [0; 32] {
        return Err(unavailable(Cause::BindingCustodyRunHeadIdentityZero));
    }

    if run.run_start_ns >= run.run_end_ns_exclusive {
        return Err(unavailable(Cause::BindingCustodyRunWindowInvalid));
    }
    Ok(())
}

/// Proves that a fresh consumer-side Owner resolution reproduces the stored binding exactly.
#[allow(clippy::too_many_arguments)]
pub(crate) fn verify_re_resolved_native_replay_execution_inputs_v1(
    stored: &NativeReplayExecutionInputBindingReadbackV1,
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    instrument_master: &InstrumentMasterReadbackV2,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    universe_frame: &StrategyInputUniverseFrameReceipt,
    schedules: &[&BarScheduleReadbackV1],
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    let verified = verify_owner_readbacks(
        preparation,
        profile,
        plan,
        artifact,
        instrument_master,
        instrument_terms,
        universe_frame,
        schedules,
    )?;
    let expected = prepare_rows(verified, stored.receipt.committed_at_epoch_ms)?;
    if &expected != stored {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::ReResolutionDiffers,
        ));
    }
    Ok(())
}

/// Proves that a fresh consumer-side Owner resolution reproduces a custody-run binding's shared
/// constituents exactly, and returns the run it names.
///
/// `basis` is the custody chain's own basis (`PitWindowRunFramesV1::basis()`), `custody_members`
/// is the Universe Selection record it names (already resolved by the caller via
/// `read_universe_selection_members_for_rd_v1(tx, basis.universe_selection_record())`), and
/// `resolved_public_terms` is each member's linked V2 Instrument Master fact (already resolved by
/// the caller via `InstrumentMasterV2PostgresOwner::resolve_fact_v2`, from
/// `economic_input.instrument_public_fact_digest`, the same digest
/// [`NativeReplayExecutionInputBindingReadbackV1::instrument_economic_terms_locators`] names) -
/// never from an independent resolution the caller performs itself. There is no per-request
/// universe frame or BAR schedule to re-check here: a custody run has neither.
///
/// # Errors
///
/// [`Cause::BindingIsNotACustodyRun`] when `stored` names a snapshot binding, and
/// [`Cause::ReResolutionDiffers`] when the freshly resolved shared constituents, or the request
/// locator, do not reproduce the stored binding's.
#[allow(clippy::too_many_arguments)]
pub(crate) fn verify_re_resolved_native_replay_custody_execution_inputs_v1(
    stored: &NativeReplayExecutionInputBindingReadbackV1,
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    basis: &PitWindowChainBasisV1,
    custody_members: &UniverseSelectionMembersForRdV1,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    resolved_public_terms: &[&InstrumentMasterFactV2],
) -> Result<ReplayCustodyRunBindingV1, NativeReplayExecutionInputBindingErrorV1> {
    let unavailable = NativeReplayExecutionInputBindingErrorV1::Unavailable;
    let NativeReplayExecutionDataPathV1::CustodyRun(run) = &stored.binding.data_path else {
        return Err(unavailable(Cause::BindingIsNotACustodyRun));
    };
    let run = *run;
    let shared = verify_custody_run_shared_replay_execution_inputs(
        preparation,
        profile,
        plan,
        artifact,
        basis,
        custody_members,
        instrument_terms,
        resolved_public_terms,
        run.run_start_ns,
        run.run_end_ns_exclusive,
    )?;

    if stored.binding.request_locator != preparation.replay().locator()
        || shared.trial_family != stored.binding.trial_family
        || shared.artifact != stored.binding.artifact
        || shared.strategy_plan != stored.binding.strategy_plan
        || shared.execution_profile_seals != stored.binding.execution_profile_seals
        || shared.public_instrument_master_cut != stored.binding.public_instrument_master_cut
        || shared.members != stored.binding.members
    {
        return Err(unavailable(Cause::ReResolutionDiffers));
    }
    Ok(run)
}

/// Atomically appends one binding, receipt, and outbox row under an already sealed Replay request.
///
/// Reissuing the same exact binding returns the byte-identical stored readback without appending.
/// A different binding for the same request fails before any insert.
pub(crate) async fn issue_native_replay_execution_input_binding_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    replay: &SealedExploratoryReplayReadbackV2,
    verified: VerifiedNativeReplayExecutionInputConstituentsV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    if verified.request_locator != replay.locator() {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::RequestLocatorMismatch,
        ));
    }
    validate_storage_boundary(transaction).await?;
    let prepared = prepare_rows(verified, replay.owner_cut_epoch_ms())?;

    if let Some(existing) = load_rows(
        transaction,
        &prepared.binding.request_locator.request_identity,
    )
    .await?
    {
        let readback = recover_rows(&existing)?;
        return if readback == prepared {
            Ok(readback)
        } else {
            Err(NativeReplayExecutionInputBindingErrorV1::Conflict)
        };
    }

    let request = &prepared.binding.request_locator;
    let inserted: Option<i64> = sqlx::query_scalar(
        "WITH sealed AS (
           SELECT request_identity FROM public.rd_sealed_exploratory_replay_requests_v1
            WHERE request_identity=$1 AND v2_meaning_digest=$2
              AND v2_receipt_json->>'receipt_identity'=$3 AND v2_seal_digest=$4
              AND request_schema_version=2 AND lifecycle_state='FROZEN' FOR SHARE
         ), binding AS (
           INSERT INTO public.rd_native_replay_execution_input_bindings_v1
             (request_identity,request_meaning_digest,request_receipt_identity,request_seal_digest,binding_identity,binding_digest,canonical_binding_bytes,committed_at_epoch_ms)
           SELECT request_identity,$2,$3,$4,$5,$6,$7,$8 FROM sealed RETURNING binding_identity
         ), receipt AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_receipts_v1
             (binding_identity,receipt_identity,receipt_digest,canonical_receipt_bytes,committed_at_epoch_ms)
           SELECT binding_identity,$9,$10,$11,$8 FROM binding RETURNING receipt_identity
         ), outbox AS (
           INSERT INTO public.rd_native_replay_execution_input_binding_outbox_v1
             (event_identity,request_identity,binding_identity,receipt_identity,payload_digest,canonical_payload_bytes,committed_at_epoch_ms)
           SELECT $12,$1,$5,receipt_identity,$13,$14,$8 FROM receipt RETURNING 1
         ) SELECT count(*) FROM outbox",
    )
    .bind(&request.request_identity)
    .bind(&request.meaning_digest)
    .bind(&request.receipt_identity)
    .bind(&request.seal_digest)
    .bind(prepared.binding.binding_identity.as_slice())
    .bind(prepared.binding.binding_digest.as_slice())
    .bind(&prepared.binding.canonical_bytes)
    .bind(i64::try_from(prepared.receipt.committed_at_epoch_ms).map_err(|_| NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::BindingNotEncodable))?)
    .bind(prepared.receipt.receipt_identity.as_slice())
    .bind(digest(RECEIPT_DOMAIN, &prepared.receipt.canonical_bytes).as_slice())
    .bind(&prepared.receipt.canonical_bytes)
    .bind(prepared.outbox.event_identity.as_slice())
    .bind(prepared.outbox.payload_digest.as_slice())
    .bind(&prepared.outbox.canonical_bytes)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    if inserted != Some(1) {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::RequestNotSealed,
        ));
    }
    Ok(prepared)
}

/// Recovers one exact request/binding locator without appending or selecting a latest row.
pub async fn resolve_native_replay_execution_input_binding_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &NativeReplayExecutionInputBindingLocatorV1,
) -> Result<
    Option<NativeReplayExecutionInputBindingReadbackV1>,
    NativeReplayExecutionInputBindingErrorV1,
> {
    validate_storage_boundary(transaction).await?;
    let Some(rows) = load_rows(transaction, &locator.request_locator.request_identity).await?
    else {
        return Ok(None);
    };
    let readback = recover_rows(&rows)?;
    if readback.binding.request_locator != locator.request_locator
        || readback.binding.binding_identity != locator.binding_identity
    {
        return Ok(None);
    }
    Ok(Some(readback))
}

/// Recovers the unique binding already issued for one complete sealed Replay locator.
///
/// This service-facing path accepts no binding identity or constituent locator from the caller.
/// It does not issue a missing binding and never falls back to another request or a latest row.
pub(crate) async fn resolve_native_replay_execution_input_binding_for_request_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<
    Option<NativeReplayExecutionInputBindingReadbackV1>,
    NativeReplayExecutionInputBindingErrorV1,
> {
    validate_storage_boundary(transaction).await?;
    let Some(rows) = load_rows(transaction, &request_locator.request_identity).await? else {
        return Ok(None);
    };
    let readback = recover_rows(&rows)?;
    if &readback.binding.request_locator != request_locator {
        return Ok(None);
    }
    Ok(Some(readback))
}

#[derive(Debug, Eq, PartialEq)]
struct StoredRowsV1 {
    request_identity: String,
    request_meaning_digest: String,
    request_receipt_identity: String,
    request_seal_digest: String,
    binding_identity: Vec<u8>,
    binding_digest: Vec<u8>,
    binding_bytes: Vec<u8>,
    receipt_identity: Vec<u8>,
    receipt_digest: Vec<u8>,
    receipt_bytes: Vec<u8>,
    receipt_committed_at_epoch_ms: i64,
    event_identity: Vec<u8>,
    outbox_request_identity: String,
    outbox_receipt_identity: Vec<u8>,
    payload_digest: Vec<u8>,
    payload_bytes: Vec<u8>,
    outbox_committed_at_epoch_ms: i64,
    committed_at_epoch_ms: i64,
}

async fn validate_storage_boundary(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    let valid: bool = sqlx::query_scalar(
        "WITH expected(name) AS (VALUES
           ('rd_native_replay_execution_input_bindings_v1'::text),
           ('rd_native_replay_execution_input_binding_receipts_v1'::text),
           ('rd_native_replay_execution_input_binding_outbox_v1'::text)
         ), relations AS (
           SELECT expected.name,relation.oid,relation.relowner,relation.relkind,relation.relpersistence,relation.relacl
             FROM expected
             LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname='public'
             LEFT JOIN pg_catalog.pg_class relation ON relation.relnamespace=namespace.oid AND relation.relname=expected.name
         )
         SELECT current_user='rd_owner' AND count(*)=3
            AND bool_and(oid IS NOT NULL AND pg_catalog.pg_get_userbyid(relowner)='rd_owner' AND relkind='r' AND relpersistence='p')
            AND NOT EXISTS (
              SELECT 1 FROM relations
              CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relacl,pg_catalog.acldefault('r',relowner))) acl
              WHERE acl.grantee<>relowner
            )
           FROM relations",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    if !valid {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StorageBoundaryInvalid,
        ));
    }
    Ok(())
}

async fn load_rows(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
) -> Result<Option<StoredRowsV1>, NativeReplayExecutionInputBindingErrorV1> {
    let row = sqlx::query(
        "SELECT b.request_identity,b.request_meaning_digest,b.request_receipt_identity,b.request_seal_digest,
                b.binding_identity,b.binding_digest,b.canonical_binding_bytes,
                r.receipt_identity,r.receipt_digest,r.canonical_receipt_bytes,r.committed_at_epoch_ms AS receipt_committed_at_epoch_ms,
                o.event_identity,o.request_identity AS outbox_request_identity,o.receipt_identity AS outbox_receipt_identity,
                o.payload_digest,o.canonical_payload_bytes,o.committed_at_epoch_ms AS outbox_committed_at_epoch_ms,
                b.committed_at_epoch_ms
           FROM public.rd_native_replay_execution_input_bindings_v1 b
           JOIN public.rd_native_replay_execution_input_binding_receipts_v1 r USING(binding_identity)
           JOIN public.rd_native_replay_execution_input_binding_outbox_v1 o USING(binding_identity)
          WHERE b.request_identity=$1",
    )
    .bind(request_identity)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)?;
    row.map(|row| {
        Ok(StoredRowsV1 {
            request_identity: row.try_get("request_identity")?,
            request_meaning_digest: row.try_get("request_meaning_digest")?,
            request_receipt_identity: row.try_get("request_receipt_identity")?,
            request_seal_digest: row.try_get("request_seal_digest")?,
            binding_identity: row.try_get("binding_identity")?,
            binding_digest: row.try_get("binding_digest")?,
            binding_bytes: row.try_get("canonical_binding_bytes")?,
            receipt_identity: row.try_get("receipt_identity")?,
            receipt_digest: row.try_get("receipt_digest")?,
            receipt_bytes: row.try_get("canonical_receipt_bytes")?,
            receipt_committed_at_epoch_ms: row.try_get("receipt_committed_at_epoch_ms")?,
            event_identity: row.try_get("event_identity")?,
            outbox_request_identity: row.try_get("outbox_request_identity")?,
            outbox_receipt_identity: row.try_get("outbox_receipt_identity")?,
            payload_digest: row.try_get("payload_digest")?,
            payload_bytes: row.try_get("canonical_payload_bytes")?,
            outbox_committed_at_epoch_ms: row.try_get("outbox_committed_at_epoch_ms")?,
            committed_at_epoch_ms: row.try_get("committed_at_epoch_ms")?,
        })
    })
    .transpose()
    .map_err(NativeReplayExecutionInputBindingErrorV1::Storage)
}

fn prepare_rows(
    verified: VerifiedNativeReplayExecutionInputConstituentsV1,
    committed_at_epoch_ms: u64,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    validate_verified(&verified)?;
    let mut writer = CanonicalWriter::new();
    writer.u16(SCHEMA_VERSION);
    writer.request_locator(&verified.request_locator)?;
    writer.named(&verified.trial_family)?;
    writer.named(&verified.artifact)?;
    writer.named(&verified.strategy_plan)?;
    writer.digest(verified.execution_profile_seals.catalog_binding_digest);
    writer.digest(verified.execution_profile_seals.family_binding_digest);
    writer.digest(verified.execution_profile_seals.request_binding_digest);
    writer.digest(
        verified
            .execution_profile_seals
            .economic_configuration_digest,
    );
    writer.digest(
        verified
            .execution_profile_seals
            .runner_operational_profile_digest,
    );
    writer.public_instrument_master_cut(verified.public_instrument_master_cut);
    writer.u16(u16::try_from(verified.members.len()).map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::BindingNotEncodable)
    })?);

    for member in &verified.members {
        writer.text(&member.member_key)?;
        writer.text(&member.public_instrument_identity)?;
        writer.digest(member.public_instrument_digest);
        writer.text(&member.venue_identity)?;
        writer.text(&member.account_scope_identity)?;
        writer.locator(member.instrument_economic_terms_fact);
        writer.locator(member.instrument_economic_terms_receipt);
    }
    writer.data_path(&verified.data_path)?;
    let canonical_bytes = writer.finish()?;
    let binding_identity = digest(BINDING_DOMAIN, &canonical_bytes);
    let binding_digest = binding_identity;

    let mut receipt_writer = CanonicalWriter::new();
    receipt_writer.u16(SCHEMA_VERSION);
    receipt_writer.digest(binding_identity);
    receipt_writer.digest(binding_digest);
    receipt_writer.u64(committed_at_epoch_ms);
    let receipt_bytes = receipt_writer.finish()?;
    let receipt_identity = digest(RECEIPT_DOMAIN, &receipt_bytes);

    let request_identity = verified.request_locator.request_identity.clone();
    let mut outbox_writer = CanonicalWriter::new();
    outbox_writer.u16(SCHEMA_VERSION);
    outbox_writer.text(&verified.request_locator.request_identity)?;
    outbox_writer.digest(binding_identity);
    outbox_writer.digest(receipt_identity);
    let outbox_bytes = outbox_writer.finish()?;
    let event_identity = digest(OUTBOX_DOMAIN, &outbox_bytes);

    Ok(NativeReplayExecutionInputBindingReadbackV1 {
        binding: NativeReplayExecutionInputBindingV1 {
            request_locator: verified.request_locator,
            trial_family: verified.trial_family,
            artifact: verified.artifact,
            strategy_plan: verified.strategy_plan,
            execution_profile_seals: verified.execution_profile_seals,
            public_instrument_master_cut: verified.public_instrument_master_cut,
            members: verified.members,
            data_path: verified.data_path,
            binding_identity,
            binding_digest,
            canonical_bytes,
        },
        receipt: NativeReplayExecutionInputBindingReceiptV1 {
            receipt_identity,
            binding_identity,
            binding_digest,
            committed_at_epoch_ms,
            canonical_bytes: receipt_bytes,
        },
        outbox: NativeReplayExecutionInputBindingOutboxV1 {
            event_identity,
            request_identity,
            binding_identity,
            receipt_identity,
            payload_digest: digest(OUTBOX_DOMAIN, &outbox_bytes),
            canonical_bytes: outbox_bytes,
        },
    })
}

fn recover_rows(
    rows: &StoredRowsV1,
) -> Result<NativeReplayExecutionInputBindingReadbackV1, NativeReplayExecutionInputBindingErrorV1> {
    let mut decoder = CanonicalDecoder::new(&rows.binding_bytes);
    if decoder.u16()? != SCHEMA_VERSION {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }
    let request_locator = decoder.request_locator()?;
    let trial_family = decoder.named()?;
    let artifact = decoder.named()?;
    let strategy_plan = decoder.named()?;
    let execution_profile_seals = ExecutionProfileSealLocatorsV1 {
        catalog_binding_digest: decoder.digest()?,
        family_binding_digest: decoder.digest()?,
        request_binding_digest: decoder.digest()?,
        economic_configuration_digest: decoder.digest()?,
        runner_operational_profile_digest: decoder.digest()?,
    };
    let public_instrument_master_cut = decoder.public_instrument_master_cut()?;
    let member_count = usize::from(decoder.u16()?);
    if !is_admitted_member_count(member_count) {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }
    let members = (0..member_count)
        .map(|_| decoder.member())
        .collect::<Result<Vec<_>, _>>()?;
    let members = BoundedMembers::new(members).map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })?;
    let data_path = decoder.data_path()?;
    decoder.finish()?;
    let binding_identity = array(&rows.binding_identity)?;
    let binding_digest = array(&rows.binding_digest)?;
    let committed_at_epoch_ms = u64::try_from(rows.committed_at_epoch_ms).map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })?;

    let mut receipt_decoder = CanonicalDecoder::new(&rows.receipt_bytes);
    if receipt_decoder.u16()? != SCHEMA_VERSION
        || receipt_decoder.digest()? != binding_identity
        || receipt_decoder.digest()? != binding_digest
        || receipt_decoder.u64()? != committed_at_epoch_ms
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }
    receipt_decoder.finish()?;
    let receipt_identity = array(&rows.receipt_identity)?;

    let mut outbox_decoder = CanonicalDecoder::new(&rows.payload_bytes);
    if outbox_decoder.u16()? != SCHEMA_VERSION
        || outbox_decoder.text()? != request_locator.request_identity
        || outbox_decoder.digest()? != binding_identity
        || outbox_decoder.digest()? != receipt_identity
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }
    outbox_decoder.finish()?;

    if request_locator.request_identity != rows.request_identity
        || request_locator.meaning_digest != rows.request_meaning_digest
        || request_locator.receipt_identity != rows.request_receipt_identity
        || request_locator.seal_digest != rows.request_seal_digest
        || digest(BINDING_DOMAIN, &rows.binding_bytes) != binding_identity
        || binding_digest != binding_identity
        || digest(RECEIPT_DOMAIN, &rows.receipt_bytes) != receipt_identity
        || array(&rows.receipt_digest)? != digest(RECEIPT_DOMAIN, &rows.receipt_bytes)
        || rows.receipt_committed_at_epoch_ms != rows.committed_at_epoch_ms
        || rows.outbox_request_identity != rows.request_identity
        || array(&rows.outbox_receipt_identity)? != receipt_identity
        || array(&rows.event_identity)? != digest(OUTBOX_DOMAIN, &rows.payload_bytes)
        || array(&rows.payload_digest)? != digest(OUTBOX_DOMAIN, &rows.payload_bytes)
        || rows.outbox_committed_at_epoch_ms != rows.committed_at_epoch_ms
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }

    let verified = VerifiedNativeReplayExecutionInputConstituentsV1 {
        request_locator,
        trial_family,
        artifact,
        strategy_plan,
        execution_profile_seals,
        public_instrument_master_cut,
        members,
        data_path,
    };
    // The constituents were decoded from stored bytes, so any refusal to re-prepare them is the
    // stored row's, not an encoding limit or invalid input.
    let expected = prepare_rows(verified, committed_at_epoch_ms).map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })?;

    if expected.binding.canonical_bytes != rows.binding_bytes
        || expected.receipt.canonical_bytes != rows.receipt_bytes
        || expected.outbox.canonical_bytes != rows.payload_bytes
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::StoredBindingCorrupt,
        ));
    }
    Ok(expected)
}

fn validate_verified(
    verified: &VerifiedNativeReplayExecutionInputConstituentsV1,
) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
    // One check, one cause, in the order the single condition they replace evaluated them.
    let refuse = |refused: bool, cause: Cause| {
        if refused {
            Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(cause))
        } else {
            Ok(())
        }
    };
    let request = &verified.request_locator;
    refuse(
        !valid_text(&request.request_identity),
        Cause::BindingRequestIdentityInvalid,
    )?;
    // The meaning digest is whatever the Replay contract mints, and `meaning_digest()` mints
    // `blake3:`. Validating it as `sha256:` here refused every production Replay; the contract's
    // own type is the one definition of a valid digest.
    refuse(
        CanonicalDigestV2::try_from(request.meaning_digest.clone()).is_err(),
        Cause::BindingRequestMeaningDigestInvalid,
    )?;
    refuse(
        !valid_text(&request.receipt_identity),
        Cause::BindingRequestReceiptIdentityInvalid,
    )?;
    refuse(
        !valid_sha256(&request.seal_digest),
        Cause::BindingRequestSealDigestInvalid,
    )?;
    refuse(
        !valid_named(&verified.trial_family),
        Cause::BindingTrialFamilyLocatorInvalid,
    )?;
    refuse(
        !valid_named(&verified.artifact),
        Cause::BindingArtifactLocatorInvalid,
    )?;
    refuse(
        !valid_named(&verified.strategy_plan),
        Cause::BindingStrategyPlanLocatorInvalid,
    )?;
    refuse(
        !valid_public_instrument_master_cut(verified.public_instrument_master_cut),
        Cause::BindingInstrumentMasterCutLocatorInvalid,
    )?;
    refuse(
        verified
            .members
            .windows(2)
            .any(|pair| pair[0].member_key >= pair[1].member_key),
        Cause::BindingMembersOutOfOrder,
    )?;
    refuse(
        verified
            .members
            .iter()
            .map(|member| &member.public_instrument_identity)
            .collect::<BTreeSet<_>>()
            .len()
            != verified.members.len(),
        Cause::BindingMembersRepeatAnInstrument,
    )?;

    if let Some(cause) = verified.members.iter().find_map(member_refusal) {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(cause));
    }

    match &verified.data_path {
        NativeReplayExecutionDataPathV1::Snapshot {
            universe_frame_receipt,
            member_bar_schedules,
        } => {
            refuse(
                !valid_locator(*universe_frame_receipt),
                Cause::BindingUniverseFrameReceiptInvalid,
            )?;
            refuse(
                member_bar_schedules.len() != verified.members.len(),
                Cause::BindingMemberBarSchedulesCountDiffers,
            )?;
            refuse(
                verified
                    .members
                    .iter()
                    .zip(member_bar_schedules.iter())
                    .any(|(member, schedule)| member.member_key != schedule.member_key),
                Cause::BindingMemberBarSchedulesOutOfOrder,
            )?;

            if let Some(cause) = member_bar_schedules
                .iter()
                .find_map(member_bar_schedule_refusal)
            {
                return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(cause));
            }
        }
        NativeReplayExecutionDataPathV1::CustodyRun(run) => {
            refuse(
                run.chain_root == [0; 32],
                Cause::BindingCustodyRunChainRootZero,
            )?;
            refuse(
                run.head_identity == [0; 32],
                Cause::BindingCustodyRunHeadIdentityZero,
            )?;
            refuse(
                run.run_start_ns >= run.run_end_ns_exclusive,
                Cause::BindingCustodyRunWindowInvalid,
            )?;
        }
    }
    let seals = &verified.execution_profile_seals;
    refuse(
        seals.catalog_binding_digest == [0; 32],
        Cause::CatalogBindingSealZero,
    )?;
    refuse(
        seals.family_binding_digest == [0; 32],
        Cause::FamilyBindingSealZero,
    )?;
    refuse(
        seals.request_binding_digest == [0; 32],
        Cause::RequestBindingSealZero,
    )?;
    refuse(
        seals.economic_configuration_digest == [0; 32],
        Cause::EconomicConfigurationDigestZero,
    )?;
    refuse(
        seals.runner_operational_profile_digest == [0; 32],
        Cause::RunnerOperationalProfileDigestZero,
    )
}

#[allow(clippy::too_many_arguments)]
/// What a sealed Replay commit's execution-input binding checks the same way for every data path:
/// the execution profile, Composer, Plan and Artifact agreement, and each member's Instrument
/// Master public fact and economic terms. A data path's own frame/schedule evidence (the
/// single-frame universe frame and BAR schedules, or a custody run's chain) is the caller's own
/// check, before or after this one.
struct SharedReplayExecutionInputsV1 {
    trial_family: NamedLocatorV1,
    artifact: NamedLocatorV1,
    strategy_plan: NamedLocatorV1,
    execution_profile_seals: ExecutionProfileSealLocatorsV1,
    public_instrument_master_cut: PublicInstrumentMasterCutV1,
    members: BoundedMembers<NativeReplayExecutionInputMemberV1>,
}

#[allow(clippy::too_many_arguments)]
fn verify_shared_replay_execution_inputs(
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    instrument_master: &InstrumentMasterReadbackV2,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    member_keys_and_instruments: &[(&str, &str)],
) -> Result<SharedReplayExecutionInputsV1, NativeReplayExecutionInputBindingErrorV1> {
    let replay = preparation.replay();
    let request = replay.request().as_dto();
    let composer = preparation.composer();
    let unavailable = NativeReplayExecutionInputBindingErrorV1::Unavailable;
    let seal = replay
        .execution_profile_seal()
        .ok_or(unavailable(Cause::ReplayHasNoExecutionProfileSeal))?;
    let request_plan_digest = parse_sha256(request.strategy_plan.digest.as_str())?;
    let request_artifact_digest = parse_sha256(request.artifact.digest.as_str())?;
    let request_universe_digest = parse_sha256(request.universe_selection.digest.as_str())?;
    let artifact_modules = artifact.private_module_bytes();

    // One check, one cause: each clause refuses under its own name, so a refusal says which
    // agreement failed without a probe. The clauses are pure comparisons in the order the single
    // condition they replace evaluated them, so splitting it changes no outcome, only the name.
    let refuse = |refused: bool, cause: Cause| {
        if refused {
            Err(unavailable(cause))
        } else {
            Ok(())
        }
    };
    let family_root = preparation.family().root();
    refuse(
        !profile.matches_request_locator(&replay.locator()),
        Cause::ExecutionProfileNamesAnotherRequest,
    )?;
    refuse(
        profile.trial_family_identity() != family_root.trial_family_identity(),
        Cause::ExecutionProfileNamesAnotherFamily,
    )?;
    refuse(
        profile.trial_family_digest() != parse_sha256(family_root.root_digest())?,
        Cause::ExecutionProfileFamilyDigestDiffers,
    )?;
    refuse(
        request.strategy_plan.identity.as_str() != profile.request_strategy_plan_identity(),
        Cause::ExecutionProfileNamesAnotherPlan,
    )?;
    refuse(
        request_plan_digest != profile.request_strategy_plan_digest(),
        Cause::ExecutionProfilePlanDigestDiffers,
    )?;
    refuse(
        request_plan_digest != *plan.canonical_plan_digest().as_bytes(),
        Cause::PlanDigestDiffersFromRequest,
    )?;
    refuse(
        request.artifact.identity.as_str() != profile.request_artifact_identity(),
        Cause::ExecutionProfileNamesAnotherArtifact,
    )?;
    refuse(
        request_artifact_digest != profile.request_artifact_digest(),
        Cause::ExecutionProfileArtifactDigestDiffers,
    )?;
    refuse(
        request_artifact_digest != *artifact.identity().as_bytes(),
        Cause::ArtifactDigestDiffersFromRequest,
    )?;
    refuse(
        request.universe_selection.identity.as_str()
            != profile.request_universe_selection_identity(),
        Cause::ExecutionProfileNamesAnotherUniverseSelection,
    )?;
    refuse(
        request_universe_digest != profile.request_universe_selection_digest(),
        Cause::ExecutionProfileUniverseSelectionDigestDiffers,
    )?;
    refuse(
        !profile.matches_instrument_terms_readbacks(instrument_terms),
        Cause::ExecutionProfileNamesOtherEconomicTerms,
    )?;
    refuse(
        composer.plan_bytes() != plan.durable_bytes(),
        Cause::ComposerPlanBytesDiffer,
    )?;
    refuse(
        composer.artifact_package_bytes() != artifact.durable_package_bytes(),
        Cause::ComposerArtifactPackageDiffers,
    )?;
    refuse(
        !composer
            .module_bytes()
            .eq(artifact_modules.iter().map(|bytes| bytes.as_ref())),
        Cause::ComposerModulesDiffer,
    )?;
    refuse(
        artifact.validate_for_plan(plan).is_err(),
        Cause::ArtifactInvalidForPlan,
    )?;
    refuse(
        !is_admitted_member_count(member_keys_and_instruments.len()),
        Cause::MemberCountNotAdmitted,
    )?;
    refuse(
        member_keys_and_instruments
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0),
        Cause::UniverseFrameMembersOutOfOrder,
    )?;
    refuse(
        instrument_terms.len() != member_keys_and_instruments.len(),
        Cause::EconomicTermsCountDiffers,
    )?;

    let cut_members = instrument_master.cut().members();
    refuse(
        instrument_master.cut().request_identity()
            != native_replay_request_identity_v2(request.request_identity.as_str())
                .map_err(|_| unavailable(Cause::RequestIdentityInvalid))?,
        Cause::InstrumentMasterCutNamesAnotherRequest,
    )?;
    refuse(
        cut_members.len() != member_keys_and_instruments.len(),
        Cause::InstrumentMasterCutMemberCountDiffers,
    )?;
    let mut members = Vec::with_capacity(cut_members.len());

    for (index, &(member_key, member_instrument)) in member_keys_and_instruments.iter().enumerate()
    {
        let public_fact = cut_members[index].fact();
        let economic = instrument_terms[index];
        let economic_input = economic.fact().input();
        let public_terms = public_fact
            .validate_native_crypto_perpetual_public_terms()
            .map_err(|_| unavailable(Cause::PublicTermsInvalid))?;
        let event_time = i128::from(request.window.start_event_ns);

        refuse(
            member_instrument != public_fact.canonical_identity(),
            Cause::InstrumentMasterCutMemberDiffers,
        )?;
        refuse(
            economic_input.instrument_identity != public_fact.canonical_identity(),
            Cause::EconomicTermsNameAnotherInstrument,
        )?;
        refuse(
            economic_input.instrument_public_fact_digest != *public_fact.identity().as_bytes(),
            Cause::EconomicTermsCiteAnotherPublicFact,
        )?;
        refuse(
            economic_input.venue_identity != public_fact.venue_identity(),
            Cause::EconomicTermsNameAnotherVenue,
        )?;
        refuse(
            economic_input.quote_currency != public_terms.quote_currency(),
            Cause::EconomicTermsNameAnotherQuoteCurrency,
        )?;
        refuse(
            economic_input.valid_from_ns > event_time,
            Cause::EconomicTermsNotYetInForce,
        )?;
        refuse(
            event_time >= economic_input.valid_until_ns_exclusive,
            Cause::EconomicTermsNoLongerInForce,
        )?;
        refuse(!economic.verify(), Cause::EconomicTermsDoNotVerify)?;
        let economic_locator = economic.locator();
        members.push(NativeReplayExecutionInputMemberV1 {
            member_key: member_key.to_owned(),
            public_instrument_identity: public_fact.canonical_identity().to_owned(),
            public_instrument_digest: *public_fact.identity().as_bytes(),
            venue_identity: public_fact.venue_identity().to_owned(),
            account_scope_identity: economic_input.account_scope_identity.clone(),
            instrument_economic_terms_fact: ExactOwnerLocatorV1 {
                identity: economic_locator.fact_identity(),
                digest: economic.fact().meaning_identity(),
            },
            instrument_economic_terms_receipt: ExactOwnerLocatorV1 {
                identity: economic_locator.receipt_identity(),
                digest: economic_locator.receipt_identity(),
            },
        });
    }

    if members
        .windows(2)
        .any(|pair| pair[0].account_scope_identity != pair[1].account_scope_identity)
    {
        return Err(unavailable(Cause::AccountScopesDiffer));
    }
    let members =
        BoundedMembers::new(members).map_err(|_| unavailable(Cause::MemberCountNotAdmitted))?;
    let master_locator = instrument_master.locator();
    Ok(SharedReplayExecutionInputsV1 {
        trial_family: NamedLocatorV1 {
            identity: profile.trial_family_identity().to_owned(),
            digest: profile.trial_family_digest(),
        },
        artifact: NamedLocatorV1 {
            identity: request.artifact.identity.as_str().to_owned(),
            digest: *artifact.identity().as_bytes(),
        },
        strategy_plan: NamedLocatorV1 {
            identity: request.strategy_plan.identity.as_str().to_owned(),
            digest: *plan.canonical_plan_digest().as_bytes(),
        },
        execution_profile_seals: ExecutionProfileSealLocatorsV1 {
            catalog_binding_digest: seal.catalog_binding_digest(),
            family_binding_digest: seal.family_binding_digest(),
            request_binding_digest: seal.request_binding_digest(),
            economic_configuration_digest: profile.economic_configuration_digest(),
            runner_operational_profile_digest: profile.runner_operational_profile_digest(),
        },
        public_instrument_master_cut: PublicInstrumentMasterCutV1::SnapshotV2(
            InstrumentMasterCutLocatorBindingV1 {
                request_identity: *master_locator.request_identity().as_bytes(),
                request_binding_digest: *master_locator.request_binding_digest().as_bytes(),
                cut_identity: *master_locator.cut_identity().as_bytes(),
                receipt_identity: *master_locator.receipt_identity().as_bytes(),
            },
        ),
        members,
    })
}

/// Verifies a single-frame (snapshot) binding's complete constituent set: the shared agreement
/// ([`verify_shared_replay_execution_inputs`]) plus the universe frame's own selection (held
/// against the Plan's) and each member's BAR schedule.
#[allow(clippy::too_many_arguments)]
fn verify_owner_readbacks(
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    instrument_master: &InstrumentMasterReadbackV2,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    universe_frame: &StrategyInputUniverseFrameReceipt,
    schedules: &[&BarScheduleReadbackV1],
) -> Result<
    VerifiedNativeReplayExecutionInputConstituentsV1,
    NativeReplayExecutionInputBindingErrorV1,
> {
    let replay = preparation.replay();
    let request = replay.request().as_dto();
    let selection = universe_frame.selection();
    let unavailable = NativeReplayExecutionInputBindingErrorV1::Unavailable;
    let plan_selection = plan
        .universe_selection()
        .ok_or(unavailable(Cause::PlanHasNoUniverseSelection))?;
    let refuse = |refused: bool, cause: Cause| {
        if refused {
            Err(unavailable(cause))
        } else {
            Ok(())
        }
    };
    refuse(
        schedules.len() != selection.members().len(),
        Cause::BarScheduleCountDiffers,
    )?;
    // The Replay's `universe_selection` is the Universe Selection Record its composition depends
    // on, not the strategy-input selection the Plan was bound under, and the two never share an
    // identity. So the Plan's selection is held only against the frame's, here. The Record is
    // checked by Market Data against the frame's verified batch, refused by name as
    // `UniverseSelectionRecordMismatch`, when `resolve_native_replay_initial_owner_inputs_v1`
    // produced the frame this function is given. Comparing the Record with the Plan's selection
    // here refuses every production Replay.
    refuse(
        selection.selection_identity() != plan_selection.selection_identity(),
        Cause::UniverseFrameSelectionIdentityDiffersFromPlan,
    )?;
    refuse(
        selection.selection_digest() != plan_selection.selection_digest(),
        Cause::UniverseFrameSelectionDigestDiffersFromPlan,
    )?;
    refuse(
        selection.members().len() != plan_selection.members().len(),
        Cause::UniverseFrameMemberCountDiffersFromPlan,
    )?;
    refuse(
        !selection
            .members()
            .iter()
            .zip(plan_selection.members())
            .all(|(owner, planned)| {
                owner.member_key() == planned.member_key()
                    && owner.instrument() == planned.instrument()
            }),
        Cause::UniverseFrameMembersDifferFromPlan,
    )?;
    let member_keys_and_instruments = selection
        .members()
        .iter()
        .map(|member| (member.member_key(), member.instrument()))
        .collect::<Vec<_>>();
    let shared = verify_shared_replay_execution_inputs(
        preparation,
        profile,
        plan,
        artifact,
        instrument_master,
        instrument_terms,
        &member_keys_and_instruments,
    )?;

    let event_time = i128::from(request.window.start_event_ns);
    let cut_members = instrument_master.cut().members();
    let mut member_bar_schedules = Vec::with_capacity(shared.members.len());
    for ((member, schedule), cut_member) in shared
        .members
        .iter()
        .zip(schedules.iter())
        .zip(cut_members.iter())
    {
        let public_fact = cut_member.fact();
        refuse(
            schedule.fact().canonical_instrument() != public_fact.canonical_identity(),
            Cause::BarScheduleNamesAnotherInstrument,
        )?;
        refuse(
            schedule.fact().cut_effective_instant() != event_time,
            Cause::BarScheduleCutAtAnotherInstant,
        )?;
        member_bar_schedules.push(NativeReplayExecutionMemberBarScheduleV1 {
            member_key: member.member_key.clone(),
            schedule_identity: *schedule.fact().identity().as_bytes(),
            bar_schedule_cut: ExactOwnerLocatorV1 {
                identity: *schedule.cut_identity().as_bytes(),
                digest: *schedule.identity().as_bytes(),
            },
            bar_schedule_receipt: ExactOwnerLocatorV1 {
                identity: *schedule.receipt_identity().as_bytes(),
                digest: *schedule.receipt_identity().as_bytes(),
            },
        });
    }
    let member_bar_schedules = BoundedMembers::new(member_bar_schedules)
        .map_err(|_| unavailable(Cause::MemberCountNotAdmitted))?;

    Ok(VerifiedNativeReplayExecutionInputConstituentsV1 {
        request_locator: replay.locator(),
        trial_family: shared.trial_family,
        artifact: shared.artifact,
        strategy_plan: shared.strategy_plan,
        execution_profile_seals: shared.execution_profile_seals,
        public_instrument_master_cut: shared.public_instrument_master_cut,
        members: shared.members,
        data_path: NativeReplayExecutionDataPathV1::Snapshot {
            universe_frame_receipt: ExactOwnerLocatorV1 {
                identity: *universe_frame.digest().as_bytes(),
                digest: *universe_frame.digest().as_bytes(),
            },
            member_bar_schedules,
        },
    })
}

/// Verifies a custody run's complete constituent set: the shared agreement (duplicated here
/// rather than shared with [`verify_shared_replay_execution_inputs`], since the two member loops
/// have nothing but their first half in common - this one resolves members from the custody
/// chain's own basis, not a per-request universe frame, and has no V2 Instrument Master cut or
/// BAR schedule to check), each member's V1-fact-to-V2-terms association (Lane 3's ruling), and
/// the V1/V2 structural cross-check (Lane 6's finding: V1's own structural projection cannot
/// materialize a native instrument - it lacks `is_inverse`, lot size and every limit - so
/// materialization still uses the V2 fact the terms are bound to, proven to name the same
/// instrument as the chain's V1 member instead of trusted on its own).
///
/// `resolved_public_terms` is the V2 fact the economic terms at the same index name
/// (`economic_input.instrument_public_fact_digest`), already resolved by the caller via
/// `InstrumentMasterV2PostgresOwner::resolve_fact_v2`. `custody_members` is the custody chain's
/// Universe Selection record, already resolved by the caller via
/// `read_universe_selection_members_for_rd_v1(tx, basis.universe_selection_record())`.
#[allow(clippy::too_many_arguments)]
fn verify_custody_run_shared_replay_execution_inputs(
    preparation: &NativeReplayPreparationInputsV2,
    profile: &OwnerIssuedReplayExecutionProfileBindingV1,
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    basis: &PitWindowChainBasisV1,
    custody_members: &UniverseSelectionMembersForRdV1,
    instrument_terms: &[&InstrumentEconomicTermsReadbackV1],
    resolved_public_terms: &[&InstrumentMasterFactV2],
    run_start_ns: u64,
    run_end_ns_exclusive: u64,
) -> Result<SharedReplayExecutionInputsV1, NativeReplayExecutionInputBindingErrorV1> {
    let replay = preparation.replay();
    let request = replay.request().as_dto();
    let composer = preparation.composer();
    let unavailable = NativeReplayExecutionInputBindingErrorV1::Unavailable;
    let plan_selection = plan
        .universe_selection()
        .ok_or(unavailable(Cause::PlanHasNoUniverseSelection))?;
    let seal = replay
        .execution_profile_seal()
        .ok_or(unavailable(Cause::ReplayHasNoExecutionProfileSeal))?;
    let request_plan_digest = parse_sha256(request.strategy_plan.digest.as_str())?;
    let request_artifact_digest = parse_sha256(request.artifact.digest.as_str())?;
    let request_universe_digest = parse_sha256(request.universe_selection.digest.as_str())?;
    let artifact_modules = artifact.private_module_bytes();

    let refuse = |refused: bool, cause: Cause| {
        if refused {
            Err(unavailable(cause))
        } else {
            Ok(())
        }
    };
    let family_root = preparation.family().root();
    refuse(
        !profile.matches_request_locator(&replay.locator()),
        Cause::ExecutionProfileNamesAnotherRequest,
    )?;
    refuse(
        profile.trial_family_identity() != family_root.trial_family_identity(),
        Cause::ExecutionProfileNamesAnotherFamily,
    )?;
    refuse(
        profile.trial_family_digest() != parse_sha256(family_root.root_digest())?,
        Cause::ExecutionProfileFamilyDigestDiffers,
    )?;
    refuse(
        request.strategy_plan.identity.as_str() != profile.request_strategy_plan_identity(),
        Cause::ExecutionProfileNamesAnotherPlan,
    )?;
    refuse(
        request_plan_digest != profile.request_strategy_plan_digest(),
        Cause::ExecutionProfilePlanDigestDiffers,
    )?;
    refuse(
        request_plan_digest != *plan.canonical_plan_digest().as_bytes(),
        Cause::PlanDigestDiffersFromRequest,
    )?;
    refuse(
        request.artifact.identity.as_str() != profile.request_artifact_identity(),
        Cause::ExecutionProfileNamesAnotherArtifact,
    )?;
    refuse(
        request_artifact_digest != profile.request_artifact_digest(),
        Cause::ExecutionProfileArtifactDigestDiffers,
    )?;
    refuse(
        request_artifact_digest != *artifact.identity().as_bytes(),
        Cause::ArtifactDigestDiffersFromRequest,
    )?;
    refuse(
        request.universe_selection.identity.as_str()
            != profile.request_universe_selection_identity(),
        Cause::ExecutionProfileNamesAnotherUniverseSelection,
    )?;
    refuse(
        request_universe_digest != profile.request_universe_selection_digest(),
        Cause::ExecutionProfileUniverseSelectionDigestDiffers,
    )?;
    refuse(
        !profile.matches_instrument_terms_readbacks(instrument_terms),
        Cause::ExecutionProfileNamesOtherEconomicTerms,
    )?;
    refuse(
        composer.plan_bytes() != plan.durable_bytes(),
        Cause::ComposerPlanBytesDiffer,
    )?;
    refuse(
        composer.artifact_package_bytes() != artifact.durable_package_bytes(),
        Cause::ComposerArtifactPackageDiffers,
    )?;
    refuse(
        !composer
            .module_bytes()
            .eq(artifact_modules.iter().map(|bytes| bytes.as_ref())),
        Cause::ComposerModulesDiffer,
    )?;
    refuse(
        artifact.validate_for_plan(plan).is_err(),
        Cause::ArtifactInvalidForPlan,
    )?;

    let custody_member_list = custody_members.members();
    refuse(
        !is_admitted_member_count(custody_member_list.len()),
        Cause::MemberCountNotAdmitted,
    )?;

    let mut member_keys = Vec::with_capacity(custody_member_list.len());

    for member in custody_member_list {
        let key = std::str::from_utf8(member.member_key())
            .map_err(|_| unavailable(Cause::BindingMemberKeyInvalid))?;
        member_keys.push((key, member.instrument()));
    }
    refuse(
        member_keys.windows(2).any(|pair| pair[0].0 >= pair[1].0),
        Cause::UniverseFrameMembersOutOfOrder,
    )?;
    refuse(
        instrument_terms.len() != member_keys.len(),
        Cause::EconomicTermsCountDiffers,
    )?;
    refuse(
        resolved_public_terms.len() != member_keys.len(),
        Cause::EconomicTermsCountDiffers,
    )?;
    refuse(
        basis.members().len() != member_keys.len()
            || !basis
                .members()
                .iter()
                .zip(member_keys.iter())
                .all(|(chain_member, (_, instrument))| chain_member == instrument),
        Cause::CustodyMembersNotTheChains,
    )?;
    refuse(
        member_keys.len() != plan_selection.members().len(),
        Cause::UniverseFrameMemberCountDiffersFromPlan,
    )?;
    refuse(
        !member_keys
            .iter()
            .zip(plan_selection.members())
            .all(|((key, instrument), planned)| {
                *key == planned.member_key() && *instrument == planned.instrument()
            }),
        Cause::UniverseFrameMembersDifferFromPlan,
    )?;

    let mut members = Vec::with_capacity(member_keys.len());

    for (index, (member_key, member_instrument)) in member_keys.iter().enumerate() {
        let economic = instrument_terms[index];
        let economic_input = economic.fact().input();
        let v2_fact = resolved_public_terms[index];

        refuse(
            economic_input.instrument_identity != *member_instrument,
            Cause::EconomicTermsNameAnotherInstrument,
        )?;
        refuse(
            v2_fact.canonical_identity() != *member_instrument,
            Cause::EconomicTermsCiteAnotherPublicFact,
        )?;
        refuse(
            economic_input.instrument_public_fact_digest != *v2_fact.identity().as_bytes(),
            Cause::EconomicTermsCiteAnotherPublicFact,
        )?;
        refuse(
            economic_input.valid_from_ns > i128::from(run_start_ns),
            Cause::EconomicTermsNotYetInForce,
        )?;
        refuse(
            i128::from(run_end_ns_exclusive) > economic_input.valid_until_ns_exclusive,
            Cause::EconomicTermsNoLongerInForce,
        )?;
        refuse(!economic.verify(), Cause::EconomicTermsDoNotVerify)?;

        let v1_structural = basis
            .structural_public_terms(member_instrument)
            .map_err(|_| unavailable(Cause::CustodyPublicTermsDisagreeWithChainInstrumentMaster))?;
        let v2_terms = v2_fact.terms();
        refuse(
            v2_fact.canonical_identity() != v1_structural.canonical_identity()
                || !fact_value_eq_str(&v2_terms.base_currency, v1_structural.base_currency())
                || !fact_value_eq_str(&v2_terms.quote_currency, v1_structural.quote_currency())
                || !fact_value_eq_str(
                    &v2_terms.settlement_currency,
                    v1_structural.settlement_currency(),
                )
                || !fact_value_eq_decimal(
                    &v2_terms.price_increment_from_filter,
                    v1_structural.price_increment(),
                )
                || !fact_value_eq_decimal(
                    &v2_terms.quantity_increment_from_filter,
                    v1_structural.quantity_increment(),
                )
                || !fact_value_eq_decimal(
                    &v2_terms.contract_multiplier,
                    v1_structural.contract_multiplier(),
                ),
            Cause::CustodyPublicTermsDisagreeWithChainInstrumentMaster,
        )?;

        let economic_locator = economic.locator();
        members.push(NativeReplayExecutionInputMemberV1 {
            member_key: (*member_key).to_owned(),
            public_instrument_identity: v2_fact.canonical_identity().to_owned(),
            public_instrument_digest: *v2_fact.identity().as_bytes(),
            venue_identity: v2_fact.venue_identity().to_owned(),
            account_scope_identity: economic_input.account_scope_identity.clone(),
            instrument_economic_terms_fact: ExactOwnerLocatorV1 {
                identity: economic_locator.fact_identity(),
                digest: economic.fact().meaning_identity(),
            },
            instrument_economic_terms_receipt: ExactOwnerLocatorV1 {
                identity: economic_locator.receipt_identity(),
                digest: economic_locator.receipt_identity(),
            },
        });
    }

    if members
        .windows(2)
        .any(|pair| pair[0].account_scope_identity != pair[1].account_scope_identity)
    {
        return Err(unavailable(Cause::AccountScopesDiffer));
    }
    let members =
        BoundedMembers::new(members).map_err(|_| unavailable(Cause::MemberCountNotAdmitted))?;
    let cut = basis.instrument_master_cut().cut();

    Ok(SharedReplayExecutionInputsV1 {
        trial_family: NamedLocatorV1 {
            identity: profile.trial_family_identity().to_owned(),
            digest: profile.trial_family_digest(),
        },
        artifact: NamedLocatorV1 {
            identity: request.artifact.identity.as_str().to_owned(),
            digest: *artifact.identity().as_bytes(),
        },
        strategy_plan: NamedLocatorV1 {
            identity: request.strategy_plan.identity.as_str().to_owned(),
            digest: *plan.canonical_plan_digest().as_bytes(),
        },
        execution_profile_seals: ExecutionProfileSealLocatorsV1 {
            catalog_binding_digest: seal.catalog_binding_digest(),
            family_binding_digest: seal.family_binding_digest(),
            request_binding_digest: seal.request_binding_digest(),
            economic_configuration_digest: profile.economic_configuration_digest(),
            runner_operational_profile_digest: profile.runner_operational_profile_digest(),
        },
        public_instrument_master_cut: PublicInstrumentMasterCutV1::CustodyChainV1 {
            chain_root: *basis.chain_root().as_bytes(),
            cut_identity: *cut.identity().as_bytes(),
            receipt_identity: *basis.instrument_master_cut().receipt_identity().as_bytes(),
            request_identity: *cut.request_identity().as_bytes(),
            request_meaning_digest: *cut.request_meaning_digest().as_bytes(),
        },
        members,
    })
}

fn fact_value_eq_str(value: &FactValue<String>, expected: &str) -> bool {
    matches!(value, FactValue::Value(actual) if actual == expected)
}

fn fact_value_eq_decimal(
    value: &FactValue<InstrumentDecimalV2>,
    expected: InstrumentDecimal,
) -> bool {
    matches!(value, FactValue::Value(actual) if actual.mantissa == expected.mantissa && actual.scale == expected.scale)
}

fn parse_sha256(value: &str) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV1> {
    let hex = value.strip_prefix("sha256:").ok_or(
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::DigestNotCanonical),
    )?;

    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
            Cause::DigestNotCanonical,
        ));
    }
    let mut bytes = [0_u8; 32];
    for (output, pair) in bytes.iter_mut().zip(hex.as_bytes().chunks_exact(2)) {
        let nibble = |byte| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => unreachable!("canonical hexadecimal was checked above"),
        };
        *output = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    Ok(bytes)
}

fn valid_named(value: &NamedLocatorV1) -> bool {
    valid_text(&value.identity) && value.digest != [0; 32]
}

fn valid_locator(value: ExactOwnerLocatorV1) -> bool {
    value.identity != [0; 32] && value.digest != [0; 32]
}

fn valid_public_instrument_master_cut(value: PublicInstrumentMasterCutV1) -> bool {
    match value {
        PublicInstrumentMasterCutV1::SnapshotV2(locator) => [
            locator.request_identity,
            locator.request_binding_digest,
            locator.cut_identity,
            locator.receipt_identity,
        ]
        .into_iter()
        .all(|identity| identity != [0; 32]),
        PublicInstrumentMasterCutV1::CustodyChainV1 {
            chain_root,
            cut_identity,
            receipt_identity,
            request_identity,
            request_meaning_digest,
        } => [
            chain_root,
            cut_identity,
            receipt_identity,
            request_identity,
            request_meaning_digest,
        ]
        .into_iter()
        .all(|identity| identity != [0; 32]),
    }
}

/// The first of a binding member's locators that is empty, blank, oversized or zero, named.
fn member_refusal(value: &NativeReplayExecutionInputMemberV1) -> Option<Cause> {
    [
        (
            valid_text(&value.member_key),
            Cause::BindingMemberKeyInvalid,
        ),
        (
            valid_text(&value.public_instrument_identity),
            Cause::BindingMemberInstrumentIdentityInvalid,
        ),
        (
            value.public_instrument_digest != [0; 32],
            Cause::BindingMemberInstrumentDigestZero,
        ),
        (
            valid_text(&value.venue_identity),
            Cause::BindingMemberVenueInvalid,
        ),
        (
            valid_text(&value.account_scope_identity),
            Cause::BindingMemberAccountScopeInvalid,
        ),
        (
            valid_locator(value.instrument_economic_terms_fact),
            Cause::BindingMemberEconomicTermsFactInvalid,
        ),
        (
            valid_locator(value.instrument_economic_terms_receipt),
            Cause::BindingMemberEconomicTermsReceiptInvalid,
        ),
    ]
    .into_iter()
    .find_map(|(valid, cause)| (!valid).then_some(cause))
}

/// The first of a single-frame member's BAR-schedule locators that is blank or zero, named.
fn member_bar_schedule_refusal(value: &NativeReplayExecutionMemberBarScheduleV1) -> Option<Cause> {
    [
        (
            valid_text(&value.member_key),
            Cause::BindingMemberKeyInvalid,
        ),
        (
            value.schedule_identity != [0; 32],
            Cause::BindingMemberScheduleIdentityZero,
        ),
        (
            valid_locator(value.bar_schedule_cut),
            Cause::BindingMemberBarScheduleCutInvalid,
        ),
        (
            valid_locator(value.bar_schedule_receipt),
            Cause::BindingMemberBarScheduleReceiptInvalid,
        ),
    ]
    .into_iter()
    .find_map(|(valid, cause)| (!valid).then_some(cause))
}

fn valid_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_TEXT_BYTES
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn array(bytes: &[u8]) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV1> {
    bytes.try_into().map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })
}

struct CanonicalWriter(Vec<u8>);

impl CanonicalWriter {
    fn new() -> Self {
        Self(Vec::new())
    }
    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }
    fn digest(&mut self, value: [u8; 32]) {
        self.0.extend_from_slice(&value);
    }
    fn text(&mut self, value: &str) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        let length = u16::try_from(value.len()).map_err(|_| {
            NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::BindingNotEncodable)
        })?;
        self.u16(length);
        self.0.extend_from_slice(value.as_bytes());
        Ok(())
    }
    fn request_locator(
        &mut self,
        value: &ExploratoryReplayRequestLocatorV2,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        self.text(&value.request_identity)?;
        self.text(&value.meaning_digest)?;
        self.text(&value.receipt_identity)?;
        self.text(&value.seal_digest)
    }
    fn named(
        &mut self,
        value: &NamedLocatorV1,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        self.text(&value.identity)?;
        self.digest(value.digest);
        Ok(())
    }
    fn locator(&mut self, value: ExactOwnerLocatorV1) {
        self.digest(value.identity);
        self.digest(value.digest);
    }
    fn public_instrument_master_cut(&mut self, value: PublicInstrumentMasterCutV1) {
        match value {
            PublicInstrumentMasterCutV1::SnapshotV2(locator) => {
                self.0.push(0);
                self.digest(locator.request_identity);
                self.digest(locator.request_binding_digest);
                self.digest(locator.cut_identity);
                self.digest(locator.receipt_identity);
            }
            PublicInstrumentMasterCutV1::CustodyChainV1 {
                chain_root,
                cut_identity,
                receipt_identity,
                request_identity,
                request_meaning_digest,
            } => {
                self.0.push(1);
                self.digest(chain_root);
                self.digest(cut_identity);
                self.digest(receipt_identity);
                self.digest(request_identity);
                self.digest(request_meaning_digest);
            }
        }
    }
    fn data_path(
        &mut self,
        value: &NativeReplayExecutionDataPathV1,
    ) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        match value {
            NativeReplayExecutionDataPathV1::Snapshot {
                universe_frame_receipt,
                member_bar_schedules,
            } => {
                self.0.push(0);
                self.locator(*universe_frame_receipt);
                self.u16(u16::try_from(member_bar_schedules.len()).map_err(|_| {
                    NativeReplayExecutionInputBindingErrorV1::Unavailable(
                        Cause::BindingNotEncodable,
                    )
                })?);

                for schedule in member_bar_schedules {
                    self.text(&schedule.member_key)?;
                    self.digest(schedule.schedule_identity);
                    self.locator(schedule.bar_schedule_cut);
                    self.locator(schedule.bar_schedule_receipt);
                }
            }
            NativeReplayExecutionDataPathV1::CustodyRun(run) => {
                self.0.push(1);
                self.digest(run.chain_root);
                self.digest(run.head_identity);
                self.u64(run.run_start_ns);
                self.u64(run.run_end_ns_exclusive);
            }
        }
        Ok(())
    }
    fn finish(self) -> Result<Vec<u8>, NativeReplayExecutionInputBindingErrorV1> {
        if self.0.is_empty() || self.0.len() > MAX_CANONICAL_BYTES {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::BindingNotEncodable,
            ));
        }
        Ok(self.0)
    }
}

struct CanonicalDecoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> CanonicalDecoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(
        &mut self,
        length: usize,
    ) -> Result<&'a [u8], NativeReplayExecutionInputBindingErrorV1> {
        let end = self.offset.checked_add(length).ok_or(
            NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt),
        )?;
        let value = self.bytes.get(self.offset..end).ok_or(
            NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt),
        )?;
        self.offset = end;
        Ok(value)
    }
    fn u16(&mut self) -> Result<u16, NativeReplayExecutionInputBindingErrorV1> {
        Ok(u16::from_be_bytes(array2(self.take(2)?)?))
    }
    fn u64(&mut self) -> Result<u64, NativeReplayExecutionInputBindingErrorV1> {
        Ok(u64::from_be_bytes(array8(self.take(8)?)?))
    }
    fn digest(&mut self) -> Result<[u8; 32], NativeReplayExecutionInputBindingErrorV1> {
        array(self.take(32)?)
    }
    fn text(&mut self) -> Result<String, NativeReplayExecutionInputBindingErrorV1> {
        let length = self.u16()? as usize;
        let value = std::str::from_utf8(self.take(length)?).map_err(|_| {
            NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
        })?;

        if !valid_text(value) {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::StoredBindingCorrupt,
            ));
        }
        Ok(value.to_owned())
    }
    fn request_locator(
        &mut self,
    ) -> Result<ExploratoryReplayRequestLocatorV2, NativeReplayExecutionInputBindingErrorV1> {
        Ok(ExploratoryReplayRequestLocatorV2 {
            request_identity: self.text()?,
            meaning_digest: self.text()?,
            receipt_identity: self.text()?,
            seal_digest: self.text()?,
        })
    }
    fn named(&mut self) -> Result<NamedLocatorV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(NamedLocatorV1 {
            identity: self.text()?,
            digest: self.digest()?,
        })
    }
    fn locator(&mut self) -> Result<ExactOwnerLocatorV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(ExactOwnerLocatorV1 {
            identity: self.digest()?,
            digest: self.digest()?,
        })
    }
    fn public_instrument_master_cut(
        &mut self,
    ) -> Result<PublicInstrumentMasterCutV1, NativeReplayExecutionInputBindingErrorV1> {
        let discriminant =
            *self
                .take(1)?
                .first()
                .ok_or(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                    Cause::StoredBindingCorrupt,
                ))?;

        match discriminant {
            0 => Ok(PublicInstrumentMasterCutV1::SnapshotV2(
                InstrumentMasterCutLocatorBindingV1 {
                    request_identity: self.digest()?,
                    request_binding_digest: self.digest()?,
                    cut_identity: self.digest()?,
                    receipt_identity: self.digest()?,
                },
            )),
            1 => Ok(PublicInstrumentMasterCutV1::CustodyChainV1 {
                chain_root: self.digest()?,
                cut_identity: self.digest()?,
                receipt_identity: self.digest()?,
                request_identity: self.digest()?,
                request_meaning_digest: self.digest()?,
            }),
            _ => Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::StoredBindingCorrupt,
            )),
        }
    }
    fn member(
        &mut self,
    ) -> Result<NativeReplayExecutionInputMemberV1, NativeReplayExecutionInputBindingErrorV1> {
        Ok(NativeReplayExecutionInputMemberV1 {
            member_key: self.text()?,
            public_instrument_identity: self.text()?,
            public_instrument_digest: self.digest()?,
            venue_identity: self.text()?,
            account_scope_identity: self.text()?,
            instrument_economic_terms_fact: self.locator()?,
            instrument_economic_terms_receipt: self.locator()?,
        })
    }
    fn member_bar_schedule(
        &mut self,
    ) -> Result<NativeReplayExecutionMemberBarScheduleV1, NativeReplayExecutionInputBindingErrorV1>
    {
        Ok(NativeReplayExecutionMemberBarScheduleV1 {
            member_key: self.text()?,
            schedule_identity: self.digest()?,
            bar_schedule_cut: self.locator()?,
            bar_schedule_receipt: self.locator()?,
        })
    }
    fn data_path(
        &mut self,
    ) -> Result<NativeReplayExecutionDataPathV1, NativeReplayExecutionInputBindingErrorV1> {
        let discriminant =
            *self
                .take(1)?
                .first()
                .ok_or(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                    Cause::StoredBindingCorrupt,
                ))?;

        match discriminant {
            0 => {
                let universe_frame_receipt = self.locator()?;
                let count = usize::from(self.u16()?);
                let member_bar_schedules = (0..count)
                    .map(|_| self.member_bar_schedule())
                    .collect::<Result<Vec<_>, _>>()?;
                let member_bar_schedules =
                    BoundedMembers::new(member_bar_schedules).map_err(|_| {
                        NativeReplayExecutionInputBindingErrorV1::Unavailable(
                            Cause::StoredBindingCorrupt,
                        )
                    })?;
                Ok(NativeReplayExecutionDataPathV1::Snapshot {
                    universe_frame_receipt,
                    member_bar_schedules,
                })
            }
            1 => Ok(NativeReplayExecutionDataPathV1::CustodyRun(
                ReplayCustodyRunBindingV1 {
                    chain_root: self.digest()?,
                    head_identity: self.digest()?,
                    run_start_ns: self.u64()?,
                    run_end_ns_exclusive: self.u64()?,
                },
            )),
            _ => Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::StoredBindingCorrupt,
            )),
        }
    }
    fn finish(self) -> Result<(), NativeReplayExecutionInputBindingErrorV1> {
        if self.offset != self.bytes.len() {
            return Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::StoredBindingCorrupt,
            ));
        }
        Ok(())
    }
}

fn array2(bytes: &[u8]) -> Result<[u8; 2], NativeReplayExecutionInputBindingErrorV1> {
    bytes.try_into().map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })
}

fn array8(bytes: &[u8]) -> Result<[u8; 8], NativeReplayExecutionInputBindingErrorV1> {
    bytes.try_into().map_err(|_| {
        NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::StoredBindingCorrupt)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[rstest::rstest]
    fn every_cause_has_its_own_screaming_snake_wire_name() {
        use strum::IntoEnumIterator as _;

        let codes = Cause::iter().map(Cause::code).collect::<Vec<_>>();
        assert_eq!(
            codes.iter().collect::<BTreeSet<_>>().len(),
            codes.len(),
            "two causes share a wire name: {codes:?}"
        );

        for code in &codes {
            assert!(
                !code.is_empty()
                    && code
                        .bytes()
                        .all(|byte| byte.is_ascii_uppercase() || byte == b'_')
                    && !code.starts_with('_')
                    && !code.ends_with('_'),
                "{code} is not a SCREAMING_SNAKE wire name"
            );
        }
        assert_eq!(
            NativeReplayExecutionInputBindingErrorV1::Unavailable(Cause::BarScheduleAbsent)
                .to_string(),
            "Native Replay execution-input binding unavailable: BAR_SCHEDULE_ABSENT"
        );
    }

    fn d(value: u8) -> [u8; 32] {
        [value; 32]
    }
    fn locator(value: u8) -> ExactOwnerLocatorV1 {
        ExactOwnerLocatorV1 {
            identity: d(value),
            digest: d(value + 1),
        }
    }
    fn instrument_master_locator(value: u8) -> InstrumentMasterCutLocatorBindingV1 {
        InstrumentMasterCutLocatorBindingV1 {
            request_identity: d(value),
            request_binding_digest: d(value + 1),
            cut_identity: d(value + 2),
            receipt_identity: d(value + 3),
        }
    }
    fn member(key: &str, instrument: &str, value: u8) -> NativeReplayExecutionInputMemberV1 {
        NativeReplayExecutionInputMemberV1 {
            member_key: key.into(),
            public_instrument_identity: instrument.into(),
            public_instrument_digest: d(value),
            venue_identity: "XNAS".into(),
            account_scope_identity: "research".into(),
            instrument_economic_terms_fact: locator(value + 2),
            instrument_economic_terms_receipt: locator(value + 4),
        }
    }
    fn member_bar_schedule(key: &str, value: u8) -> NativeReplayExecutionMemberBarScheduleV1 {
        NativeReplayExecutionMemberBarScheduleV1 {
            member_key: key.into(),
            schedule_identity: d(value + 1),
            bar_schedule_cut: locator(value + 6),
            bar_schedule_receipt: locator(value + 8),
        }
    }
    fn verified() -> VerifiedNativeReplayExecutionInputConstituentsV1 {
        VerifiedNativeReplayExecutionInputConstituentsV1 {
            request_locator: ExploratoryReplayRequestLocatorV2 {
                request_identity: "replay-v2".into(),
                meaning_digest: format!("sha256:{}", "1".repeat(64)),
                receipt_identity: "receipt-v2".into(),
                seal_digest: format!("sha256:{}", "2".repeat(64)),
            },
            trial_family: NamedLocatorV1 {
                identity: "family-v1".into(),
                digest: d(3),
            },
            artifact: NamedLocatorV1 {
                identity: "artifact-v1".into(),
                digest: d(4),
            },
            strategy_plan: NamedLocatorV1 {
                identity: "plan-v1".into(),
                digest: d(5),
            },
            execution_profile_seals: ExecutionProfileSealLocatorsV1 {
                catalog_binding_digest: d(6),
                family_binding_digest: d(7),
                request_binding_digest: d(8),
                economic_configuration_digest: d(9),
                runner_operational_profile_digest: d(10),
            },
            public_instrument_master_cut: PublicInstrumentMasterCutV1::SnapshotV2(
                instrument_master_locator(11),
            ),
            members: BoundedMembers::try_from([
                member("AAPL", "AAPL.XNAS", 20),
                member("MSFT", "MSFT.XNAS", 40),
            ])
            .unwrap(),
            data_path: NativeReplayExecutionDataPathV1::Snapshot {
                universe_frame_receipt: locator(13),
                member_bar_schedules: BoundedMembers::try_from([
                    member_bar_schedule("AAPL", 20),
                    member_bar_schedule("MSFT", 40),
                ])
                .unwrap(),
            },
        }
    }
    fn stored(readback: &NativeReplayExecutionInputBindingReadbackV1) -> StoredRowsV1 {
        StoredRowsV1 {
            request_identity: readback.binding.request_locator.request_identity.clone(),
            request_meaning_digest: readback.binding.request_locator.meaning_digest.clone(),
            request_receipt_identity: readback.binding.request_locator.receipt_identity.clone(),
            request_seal_digest: readback.binding.request_locator.seal_digest.clone(),
            binding_identity: readback.binding.binding_identity.to_vec(),
            binding_digest: readback.binding.binding_digest.to_vec(),
            binding_bytes: readback.binding.canonical_bytes.clone(),
            receipt_identity: readback.receipt.receipt_identity.to_vec(),
            receipt_digest: digest(RECEIPT_DOMAIN, &readback.receipt.canonical_bytes).to_vec(),
            receipt_bytes: readback.receipt.canonical_bytes.clone(),
            receipt_committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
            event_identity: readback.outbox.event_identity.to_vec(),
            outbox_request_identity: readback.outbox.request_identity.clone(),
            outbox_receipt_identity: readback.outbox.receipt_identity.to_vec(),
            payload_digest: readback.outbox.payload_digest.to_vec(),
            payload_bytes: readback.outbox.canonical_bytes.clone(),
            outbox_committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
            committed_at_epoch_ms: readback.receipt.committed_at_epoch_ms as i64,
        }
    }

    #[rstest::rstest]
    fn a_production_meaning_digest_is_admitted() {
        // `ExploratoryReplayRequestV2::meaning_digest` mints `blake3:`, never `sha256:`.
        let mut production = verified();
        production.request_locator.meaning_digest = format!("blake3:{}", "1".repeat(64));
        prepare_rows(production, 17).expect("a production-shaped meaning digest is admitted");

        let mut malformed = verified();
        malformed.request_locator.meaning_digest = format!("md5:{}", "1".repeat(64));
        assert!(matches!(
            prepare_rows(malformed, 17),
            Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(
                Cause::BindingRequestMeaningDigestInvalid
            ))
        ));
    }

    #[rstest::rstest]
    fn exact_two_member_binding_round_trips_byte_identically() {
        let prepared = prepare_rows(verified(), 17).expect("prepared");
        let recovered = recover_rows(&stored(&prepared)).expect("recovered");
        assert_eq!(prepared, recovered);
        assert_eq!(recovered.binding.member_keys(), ["AAPL", "MSFT"]);
        let locators = recovered
            .instrument_economic_terms_locators()
            .expect("exact economic locators");
        assert_eq!(locators[0].fact_identity(), d(22));
        assert_eq!(locators[0].receipt_identity(), d(24));
        assert_eq!(locators[1].fact_identity(), d(42));
        assert_eq!(locators[1].receipt_identity(), d(44));
    }

    #[rstest::rstest]
    fn reordered_or_changed_constituent_cannot_join_same_request_custody() {
        let canonical = prepare_rows(verified(), 17).expect("canonical");
        let mut reordered = verified();
        reordered.members.swap(0, 1);
        assert!(prepare_rows(reordered, 17).is_err());
        let mut changed = verified();
        changed.members[0].instrument_economic_terms_fact.digest = d(99);
        let changed = prepare_rows(changed, 17).expect("changed representation");
        assert_ne!(
            canonical.binding.binding_identity,
            changed.binding.binding_identity
        );
    }

    #[rstest::rstest]
    fn duplicate_member_and_corrupt_recovery_fail_closed() {
        let mut duplicate = verified();
        duplicate.members[1].member_key = duplicate.members[0].member_key.clone();
        assert!(prepare_rows(duplicate, 17).is_err());

        let prepared = prepare_rows(verified(), 17).expect("prepared");
        let mut corrupt = stored(&prepared);
        corrupt.binding_bytes[5] ^= 1;
        assert!(recover_rows(&corrupt).is_err());

        let mut wrong_request = stored(&prepared);
        wrong_request.request_identity = "another-request".into();
        assert!(recover_rows(&wrong_request).is_err());
    }

    /// The persisted binding, receipt, and outbox bytes of a two-member binding, pinned from the
    /// pre-widening tree so the count-carrying member loop cannot move them.
    ///
    /// Re-pinned for schema 3 (T1 custody-run `PublicInstrumentMasterCutV1` discriminant, 10-04):
    /// `public_instrument_master_cut` now encodes a one-byte discriminant before its payload. No
    /// binding was ever issued under any earlier schema outside this module's own tests, so there
    /// was no byte to carry forward across the change.
    #[rstest::rstest]
    fn two_member_binding_bytes_are_unchanged_by_the_member_count_widening() {
        let prepared = prepare_rows(verified(), 17).expect("prepared");
        crate::target_set_members::assert_two_member_bytes_unchanged(
            &[
                ("binding", &prepared.binding.canonical_bytes),
                ("binding_identity", &prepared.binding.binding_identity),
                ("receipt", &prepared.receipt.canonical_bytes),
                ("outbox", &prepared.outbox.canonical_bytes),
            ],
            &[
                (
                    "binding",
                    1_376,
                    "13dc071aa05eb32c30f6cc1424a706f58d0600ae6dbc7b4f04248b3be0e3a640",
                ),
                (
                    "binding_identity",
                    32,
                    "8fe69a82849b4a4e9297334676bdb8df18188f7fd2f33f6e2a16d9d48c5e8689",
                ),
                (
                    "receipt",
                    74,
                    "d78ce7053e514c3523e06cb7e220da0c0b89e5c4dbc65514e83c6e5d67186ffb",
                ),
                (
                    "outbox",
                    77,
                    "8c214054359f99ca338c6961ad879cd0422da953c6c1bd85a5565859de3cfdc1",
                ),
            ],
        );
    }

    /// A custody-run binding carries no member BAR schedules or universe frame receipt at all,
    /// and `custody_run()` names the run it binds.
    #[rstest::rstest]
    fn a_custody_run_binding_names_its_run_and_no_snapshot_fields() {
        let mut custody = verified();
        custody.data_path =
            NativeReplayExecutionDataPathV1::CustodyRun(ReplayCustodyRunBindingV1 {
                chain_root: d(60),
                head_identity: d(61),
                run_start_ns: 100,
                run_end_ns_exclusive: 200,
            });
        let prepared = prepare_rows(custody, 17).expect("a custody-run binding prepares");
        assert_eq!(
            prepared.binding.custody_run(),
            Some(ReplayCustodyRunBindingV1 {
                chain_root: d(60),
                head_identity: d(61),
                run_start_ns: 100,
                run_end_ns_exclusive: 200,
            })
        );
        let recovered = recover_rows(&stored(&prepared)).expect("recovered");
        assert_eq!(prepared, recovered);
    }

    #[rstest::rstest]
    fn a_snapshot_binding_has_no_custody_run() {
        let prepared = prepare_rows(verified(), 17).expect("prepared");
        assert_eq!(prepared.binding.custody_run(), None);
    }

    /// A custody run whose chain root, head identity, or window is zero/invalid is refused by
    /// name, each under its own cause.
    #[rstest::rstest]
    #[case::chain_root_zero(
        ReplayCustodyRunBindingV1 { chain_root: [0; 32], head_identity: d(61), run_start_ns: 100, run_end_ns_exclusive: 200 },
        Cause::BindingCustodyRunChainRootZero
    )]
    #[case::head_identity_zero(
        ReplayCustodyRunBindingV1 { chain_root: d(60), head_identity: [0; 32], run_start_ns: 100, run_end_ns_exclusive: 200 },
        Cause::BindingCustodyRunHeadIdentityZero
    )]
    #[case::window_not_ordered(
        ReplayCustodyRunBindingV1 { chain_root: d(60), head_identity: d(61), run_start_ns: 200, run_end_ns_exclusive: 200 },
        Cause::BindingCustodyRunWindowInvalid
    )]
    fn an_invalid_custody_run_is_refused_by_name(
        #[case] run: ReplayCustodyRunBindingV1,
        #[case] cause: Cause,
    ) {
        let mut custody = verified();
        custody.data_path = NativeReplayExecutionDataPathV1::CustodyRun(run);
        assert!(matches!(
            prepare_rows(custody, 17),
            Err(NativeReplayExecutionInputBindingErrorV1::Unavailable(actual)) if actual == cause
        ));
    }
}
