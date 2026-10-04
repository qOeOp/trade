//! Every frame of one PIT window custody run, read through Market Data at one pinned head.
//!
//! A custody run's frames are Market Data's, not a caller's list. The frames port enumerates them
//! from the chain's head, and each frame is then read through the native Replay resolver's
//! custody frame method at that head and that frame's `e_k`. A frame is admitted only when its
//! strategy inputs are the chain's derived view at exactly the coordinate the run enumerated, and
//! its member coordinates come from the frame's own sample projection, so the bundle built from
//! them cannot pair a frame with another frame's view, coordinates or head.
//!
//! The governing text is `docs/architecture/strategy-factory.md`, "T1, the custody run's
//! consumer".

use thiserror::Error;
use vibe_data::owner::{
    native_replay_scheduling_v1::{
        NativeReplayFrameSourceV1, NativeReplayInitialMarketRequestV1,
        NativeReplaySchedulingErrorV1, NativeReplaySchedulingReadbackV1,
        NativeReplaySchedulingResolverV1,
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, PitWindowChainBasisV1, PitWindowCustodyFramesV1,
        PitWindowRunFramesV1, PitWindowRunRefusalV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowRunV1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::StrategyInputUniverseFrameReceipt,
};

use crate::{
    native_replay_execution_input_binding_v1::ReplayCustodyRunBindingV1,
    native_replay_initial_owner_inputs_v1::native_replay_custody_first_frame_request_v1,
    native_replay_preparation_inputs_v2::NativeReplayPreparationInputsV2,
    program_host_v2::OwnerUniverseFrameV1,
    replay_target_set_execution_bundle_v1::ReplayCustodyRunCensusV1,
    strategy_plan_v2::StrategyPlanV2,
};

/// Why a custody run's frames could not be read.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum NativeReplayCustodyFramesErrorV1 {
    /// The request names a snapshot, or another chain than the run was read from.
    #[error(
        "CUSTODY_REQUEST_NOT_THE_RUNS: the frame request does not name the run's chain and head"
    )]
    RequestNotTheRuns,
    /// The chain's head is no longer the one the request pins: the run was enumerated from a
    /// later head, and a pinned run never follows it.
    #[error(
        "CUSTODY_HEAD_MOVED_SINCE_BINDING: the run was enumerated from another head than the one pinned"
    )]
    HeadMovedSinceBinding,
    /// The run enumerated no frame.
    #[error("CUSTODY_RUN_HAS_NO_FRAME: the run enumerated no frame")]
    NoFrame,
    /// Market Data refused one frame.
    #[error("CUSTODY_FRAME_REFUSED: frame {ordinal} at {event_ns}: {error}")]
    FrameRefused {
        ordinal: u64,
        event_ns: u64,
        error: NativeReplaySchedulingErrorV1,
    },
    /// A frame's inputs are not the chain's derived view at the coordinate the run enumerated.
    #[error("CUSTODY_VIEW_NOT_THE_FRAMES: frame {ordinal} at {event_ns} read another view")]
    ViewNotTheFrames { ordinal: u64, event_ns: u64 },
    /// A frame's sample projection does not cover its universe frame.
    #[error("CUSTODY_FRAME_COORDINATES_UNAVAILABLE: frame {ordinal} at {event_ns}")]
    CoordinatesUnavailable { ordinal: u64, event_ns: u64 },
    /// A frame was read under another Instrument Master cut than the one the binding verified: the
    /// chain's basis declares a cut of its own, and the two must be one.
    #[error(
        "CUSTODY_INSTRUMENT_MASTER_NOT_THE_BINDINGS: frame {ordinal} at {event_ns} was read under another Instrument Master cut"
    )]
    InstrumentMasterNotTheBindings { ordinal: u64, event_ns: u64 },
    /// The binding's run does not cover exactly the Replay's window.
    #[error("CUSTODY_RUN_NOT_THE_REPLAY_WINDOW: the bound run does not cover the Replay's window")]
    RunNotTheReplayWindow,
    /// Market Data refused to enumerate the run's frames.
    #[error("CUSTODY_RUN_REFUSED: {0}")]
    RunRefused(PitWindowRunRefusalV1),
    /// The run's first frame request could not be formed from the Replay, Plan and Instrument
    /// Master cut.
    #[error("CUSTODY_RUN_REQUEST_UNAVAILABLE: {0}")]
    RequestUnavailable(String),
}

/// Every frame of one custody run, in frame order, with the chain and head they were read at.
///
/// It has no public constructor: only [`resolve_native_replay_custody_frames_v1`] makes one.
#[derive(Debug)]
pub struct ResolvedNativeReplayCustodyFramesV1 {
    frames: Vec<(OwnerUniverseFrameV1, NativeReplaySchedulingReadbackV1)>,
    custody: ReplayCustodyRunCensusV1,
    basis: PitWindowChainBasisV1,
}

impl ResolvedNativeReplayCustodyFramesV1 {
    /// How many frames the run read.
    #[must_use]
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// The chain, head and ordered views the frames were read at.
    #[must_use]
    pub const fn custody(&self) -> &ReplayCustodyRunCensusV1 {
        &self.custody
    }

    /// The chain's basis as Market Data read it with the run's frames: its Instrument Master cut,
    /// Universe Selection Record and members.
    #[must_use]
    pub const fn basis(&self) -> &PitWindowChainBasisV1 {
        &self.basis
    }

    /// The run's first frame, which the Plan is revalidated against.
    pub(crate) fn first_universe_frame(&self) -> &StrategyInputUniverseFrameReceipt {
        self.frames[0].0.frame()
    }

    /// The frames and their census, for the execution bundle.
    pub(crate) fn into_parts(
        self,
    ) -> (
        Vec<(OwnerUniverseFrameV1, NativeReplaySchedulingReadbackV1)>,
        ReplayCustodyRunCensusV1,
    ) {
        (self.frames, self.custody)
    }
}

/// Reads every frame of `run` through `resolver`, at the head `run` was enumerated from.
///
/// `first` is the run's request for its first frame (`NativeReplayInitialMarketRequestV1::
/// for_custody_frame`), pinning the head the run is bound to; every later frame's request is the
/// same one at that frame's `e_k`. `run` must have been enumerated from that same head, or the run
/// is refused as moved rather than read under the newer one. Every frame must be read under
/// `instrument_master_digest`, the cut the run's binding verified.
///
/// # Errors
///
/// Returns [`NativeReplayCustodyFramesErrorV1`] naming the first frame that fails, or the request
/// that does not name the run.
pub async fn resolve_native_replay_custody_frames_v1<R>(
    resolver: &R,
    run: &PitWindowRunFramesV1,
    first: &NativeReplayInitialMarketRequestV1,
    instrument_master_digest: BindingDigest,
) -> Result<ResolvedNativeReplayCustodyFramesV1, NativeReplayCustodyFramesErrorV1>
where
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let NativeReplayFrameSourceV1::CustodyFrame(pinned) = first.frame_source() else {
        return Err(NativeReplayCustodyFramesErrorV1::RequestNotTheRuns);
    };

    if pinned.custody.chain_root != run.chain_root() {
        return Err(NativeReplayCustodyFramesErrorV1::RequestNotTheRuns);
    }

    if pinned.head_identity != run.head_identity() {
        return Err(NativeReplayCustodyFramesErrorV1::HeadMovedSinceBinding);
    }

    if run.frames().is_empty() {
        return Err(NativeReplayCustodyFramesErrorV1::NoFrame);
    }
    let mut frames = Vec::with_capacity(run.frames().len());
    let mut view_identities = Vec::with_capacity(run.frames().len());

    for coordinate in run.frames() {
        let (ordinal, event_ns) = (coordinate.ordinal(), coordinate.event_ns());
        let request = first
            .for_custody_event(event_ns)
            .ok_or(NativeReplayCustodyFramesErrorV1::RequestNotTheRuns)?;
        let readback = resolver
            .resolve_native_replay_custody_frame_inputs_v1(&request)
            .await
            .map_err(|e| NativeReplayCustodyFramesErrorV1::FrameRefused {
                ordinal,
                event_ns,
                error: e,
            })?;
        let PitObservationBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            event_ns: view_event_ns,
            decision_cut_ns,
            ..
        } = readback.source()
        else {
            return Err(NativeReplayCustodyFramesErrorV1::ViewNotTheFrames { ordinal, event_ns });
        };

        if chain_root != run.chain_root()
            || view_event_ns != event_ns
            || decision_cut_ns != coordinate.decision_cut_ns()
        {
            return Err(NativeReplayCustodyFramesErrorV1::ViewNotTheFrames { ordinal, event_ns });
        }
        // `into_execution_parts` drops the projection, so the frame's coordinates are taken first.
        let projection = readback.sample_projection().clone();
        let (universe_frame, scheduling) = readback.into_execution_parts().map_err(|e| {
            NativeReplayCustodyFramesErrorV1::FrameRefused {
                ordinal,
                event_ns,
                error: e,
            }
        })?;
        let owner_frame =
            OwnerUniverseFrameV1::from_owner_projection_v1(universe_frame, &projection).map_err(
                |_| NativeReplayCustodyFramesErrorV1::CoordinatesUnavailable { ordinal, event_ns },
            )?;

        if owner_frame.frame().selection().instrument_master_digest() != instrument_master_digest {
            return Err(
                NativeReplayCustodyFramesErrorV1::InstrumentMasterNotTheBindings {
                    ordinal,
                    event_ns,
                },
            );
        }
        view_identities.push(*view_identity.as_bytes());
        frames.push((owner_frame, scheduling));
    }
    Ok(ResolvedNativeReplayCustodyFramesV1 {
        frames,
        custody: ReplayCustodyRunCensusV1 {
            chain_root: *run.chain_root().as_bytes(),
            head_identity: *run.head_identity().as_bytes(),
            head_digest: *run.head_digest().as_bytes(),
            head_version: run.head_version(),
            view_identities,
        },
        basis: run.basis().clone(),
    })
}

/// Every frame of the custody run `custody` binds, read at the head it pins.
///
/// The frames are enumerated afresh from the bound chain and window, and the run is refused as
/// moved unless they come from the bound head. Every frame must be read under the chain's own
/// Instrument Master key, the cut its basis declares.
///
/// # Errors
///
/// Returns [`NativeReplayCustodyFramesErrorV1`] naming the refusal.
pub(crate) async fn resolve_bound_custody_run_frames_v1<F, R>(
    custody_frames: &F,
    resolver: &R,
    preparation: &NativeReplayPreparationInputsV2,
    plan: &StrategyPlanV2,
    custody: &ReplayCustodyRunBindingV1,
) -> Result<ResolvedNativeReplayCustodyFramesV1, NativeReplayCustodyFramesErrorV1>
where
    F: PitWindowCustodyFramesV1 + ?Sized,
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let replay = preparation.replay().request().as_dto();
    let window = &replay.window;

    if (custody.run_start_ns, custody.run_end_ns_exclusive)
        != (window.start_event_ns, window.end_event_ns_exclusive)
    {
        return Err(NativeReplayCustodyFramesErrorV1::RunNotTheReplayWindow);
    }
    let run = custody_frames
        .resolve_pit_window_frames_v1(UntrustedPitWindowRunV1 {
            custody: UntrustedPitWindowCustodyClaimV1 {
                chain_root: BindingDigest::from_untrusted_bytes(custody.chain_root),
            },
            run_start_ns: custody.run_start_ns,
            run_end_ns_exclusive: custody.run_end_ns_exclusive,
        })
        .await
        .map_err(NativeReplayCustodyFramesErrorV1::RunRefused)?;
    let first_event_ns = run
        .frames()
        .first()
        .ok_or(NativeReplayCustodyFramesErrorV1::NoFrame)?
        .event_ns();
    let first =
        native_replay_custody_first_frame_request_v1(plan, run.basis(), custody, first_event_ns)
            .map_err(|e| NativeReplayCustodyFramesErrorV1::RequestUnavailable(e.to_string()))?;
    resolve_native_replay_custody_frames_v1(
        resolver,
        &run,
        &first,
        run.basis().instrument_master_key(),
    )
    .await
}
