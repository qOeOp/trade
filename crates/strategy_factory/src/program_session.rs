use strategy_factory_program_sdk::{
    Action, FrameEncoder, FrameKind, ProgramFault, ProgramRunScope, decode_actions,
};
use thiserror::Error;

use crate::{
    artifact::{ArtifactError, StrategyArtifact},
    program_runtime::{ProgramRuntimeError, StrategyProgramV1},
};

pub(crate) struct ProgramSession {
    runtime: StrategyProgramV1,
    parameters: Box<[u8]>,
    run_scope: ProgramRunScope,
    frame: Box<[u8]>,
    last_decision_time_ns: Option<u64>,
    started: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum ProgramSessionError {
    #[error(transparent)]
    Runtime(#[from] ProgramRuntimeError),
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error("strategy program frame or action codec failed: {0:?}")]
    Codec(ProgramFault),
    #[error("strategy program lifecycle transition is invalid")]
    Lifecycle,
    #[error("strategy program decision time moved backwards")]
    Clock,
    #[error("strategy program observation is outside the source window")]
    ObservationOutsideSourceWindow,
    #[error("strategy program action is outside the decision window")]
    ActionOutsideDecisionWindow,
}

impl ProgramSession {
    pub(crate) fn new(
        artifact: &StrategyArtifact,
        parameters: &[u8],
        run_scope: ProgramRunScope,
    ) -> Result<Self, ProgramSessionError> {
        artifact.verify_parameters(parameters)?;
        Ok(Self {
            runtime: StrategyProgramV1::from_artifact(artifact)?,
            parameters: parameters.into(),
            run_scope,
            frame: vec![0; strategy_factory_program_sdk::FRAME_CAPACITY].into_boxed_slice(),
            last_decision_time_ns: None,
            started: false,
        })
    }

    pub(crate) fn start(
        &mut self,
        decision_time_ns: u64,
    ) -> Result<Vec<Action>, ProgramSessionError> {
        self.invoke(FrameKind::Start, decision_time_ns, |_| Ok(()))
    }

    pub(crate) fn observe(
        &mut self,
        decision_time_ns: u64,
        encode: impl FnOnce(&mut FrameEncoder<'_>) -> Result<(), ProgramFault>,
    ) -> Result<Vec<Action>, ProgramSessionError> {
        self.invoke(FrameKind::Observation, decision_time_ns, encode)
    }

    fn invoke(
        &mut self,
        kind: FrameKind,
        decision_time_ns: u64,
        encode: impl FnOnce(&mut FrameEncoder<'_>) -> Result<(), ProgramFault>,
    ) -> Result<Vec<Action>, ProgramSessionError> {
        if self.started != (kind == FrameKind::Observation) {
            return Err(ProgramSessionError::Lifecycle);
        }

        if kind == FrameKind::Observation
            && !(self.run_scope.source_start_ns..=self.run_scope.end_ns).contains(&decision_time_ns)
        {
            return Err(ProgramSessionError::ObservationOutsideSourceWindow);
        }

        if self
            .last_decision_time_ns
            .is_some_and(|previous| decision_time_ns < previous)
        {
            return Err(ProgramSessionError::Clock);
        }
        let encoder = match kind {
            FrameKind::Start => FrameEncoder::start(
                &mut self.frame,
                decision_time_ns,
                self.run_scope,
                &self.parameters,
            ),
            FrameKind::Observation => FrameEncoder::observation(&mut self.frame, decision_time_ns),
        };
        let mut encoder = encoder.map_err(ProgramSessionError::Codec)?;
        encode(&mut encoder).map_err(ProgramSessionError::Codec)?;
        let frame_len = encoder.finish();
        let raw = self.runtime.invoke(&self.frame[..frame_len])?;
        let actions = decode_actions(&raw)
            .map_err(ProgramSessionError::Codec)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(ProgramSessionError::Codec)?;
        if !actions.is_empty()
            && (kind == FrameKind::Start
                || !(self.run_scope.decision_start_ns..self.run_scope.end_ns)
                    .contains(&decision_time_ns))
        {
            return Err(ProgramSessionError::ActionOutsideDecisionWindow);
        }
        self.last_decision_time_ns = Some(decision_time_ns);

        if kind == FrameKind::Start {
            self.started = true;
        }
        Ok(actions)
    }
}
