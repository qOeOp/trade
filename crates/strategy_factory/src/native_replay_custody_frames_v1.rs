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
    pit_window_custody_v1::{PitObservationBatchSourceV1, PitWindowRunFramesV1},
};

use crate::{
    program_host_v2::OwnerUniverseFrameV1,
    replay_target_set_execution_bundle_v1::ReplayCustodyRunCensusV1,
};

/// Why a custody run's frames could not be read.
#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum NativeReplayCustodyFramesErrorV1 {
    /// The request names a snapshot, another chain, or another head than the run was read from.
    #[error(
        "CUSTODY_REQUEST_NOT_THE_RUNS: the frame request does not name the run's chain and head"
    )]
    RequestNotTheRuns,
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
}

/// Every frame of one custody run, in frame order, with the chain and head they were read at.
///
/// It has no public constructor: only [`resolve_native_replay_custody_frames_v1`] makes one.
#[derive(Debug)]
pub struct ResolvedNativeReplayCustodyFramesV1 {
    frames: Vec<(OwnerUniverseFrameV1, NativeReplaySchedulingReadbackV1)>,
    custody: ReplayCustodyRunCensusV1,
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
/// for_custody_frame`), pinning the head `run` returned; every later frame's request is the same
/// one at that frame's `e_k`.
///
/// # Errors
///
/// Returns [`NativeReplayCustodyFramesErrorV1`] naming the first frame that fails, or the request
/// that does not name the run.
pub async fn resolve_native_replay_custody_frames_v1<R>(
    resolver: &R,
    run: &PitWindowRunFramesV1,
    first: &NativeReplayInitialMarketRequestV1,
) -> Result<ResolvedNativeReplayCustodyFramesV1, NativeReplayCustodyFramesErrorV1>
where
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let NativeReplayFrameSourceV1::CustodyFrame(pinned) = first.frame_source() else {
        return Err(NativeReplayCustodyFramesErrorV1::RequestNotTheRuns);
    };

    if pinned.custody.chain_root != run.chain_root() || pinned.head_identity != run.head_identity()
    {
        return Err(NativeReplayCustodyFramesErrorV1::RequestNotTheRuns);
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
    })
}
