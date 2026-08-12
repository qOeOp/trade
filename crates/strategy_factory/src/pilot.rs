use std::convert::Infallible;

use thiserror::Error;

use crate::{
    artifact::{ArtifactError, StrategyArtifact},
    data::{DataAdmissionError, ProjectedBacktestInputs, frozen_frontier_projection},
    decision::{DecisionAction, DecisionContract, DecisionError, DecisionInput},
    intent::{IntentError, REQUIRED_EXECUTION, ResearchIntent},
    runtime::{PreparedDecisionRuntime, RuntimeError, RuntimeProjection, prepare_decision_runtime},
};

pub const NEXT_OPEN_NOT_ADMITTED_CODE: &str = "NEXT_ACTUAL_SOURCE_EVENT_OPEN_UNAVAILABLE";

#[derive(Debug)]
pub struct PreparedPilot {
    intent: ResearchIntent,
    decision: DecisionContract,
    artifact: StrategyArtifact,
    runtime: RuntimeProjection,
    decision_runtime: PreparedDecisionRuntime,
    inputs: ProjectedBacktestInputs,
}

impl PreparedPilot {
    pub const fn intent(&self) -> &ResearchIntent {
        &self.intent
    }

    pub const fn artifact(&self) -> &StrategyArtifact {
        &self.artifact
    }

    pub const fn decision_contract(&self) -> &DecisionContract {
        &self.decision
    }

    pub const fn runtime(&self) -> &RuntimeProjection {
        &self.runtime
    }

    pub fn decide(&mut self, input: DecisionInput) -> Result<DecisionAction, RuntimeError> {
        self.decision_runtime.decide(input)
    }

    pub const fn inputs(&self) -> &ProjectedBacktestInputs {
        &self.inputs
    }

    pub fn stop_before_backtest(self) -> Result<Infallible, PilotNotAdmitted> {
        let _ = self;
        Err(PilotNotAdmitted::NextActualSourceEventOpenUnavailable)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PilotNotAdmitted {
    #[error(
        "NOT_ADMITTED[{NEXT_OPEN_NOT_ADMITTED_CODE}]: frozen ResearchIntent requires {REQUIRED_EXECUTION}, but current mature Backtest has no admitted execution seam"
    )]
    NextActualSourceEventOpenUnavailable,
}

#[derive(Debug, Error)]
pub enum PreparationError {
    #[error(transparent)]
    Intent(#[from] IntentError),
    #[error(transparent)]
    Decision(#[from] DecisionError),
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error(transparent)]
    Runtime(#[from] RuntimeError),
    #[error(transparent)]
    Data(#[from] DataAdmissionError),
}

pub fn prepare_frozen_pilot() -> Result<PreparedPilot, PreparationError> {
    let intent = ResearchIntent::frozen()?;
    let decision = DecisionContract::for_intent(&intent)?;
    let artifact = StrategyArtifact::issue(&intent, &decision)?;
    let (decision_runtime, runtime) = prepare_decision_runtime(&artifact, &intent, &decision)?;
    let inputs = frozen_frontier_projection()?;
    Ok(PreparedPilot {
        intent,
        decision,
        artifact,
        runtime,
        decision_runtime,
        inputs,
    })
}

pub fn run_frozen_pilot() -> Result<Infallible, anyhow::Error> {
    Ok(prepare_frozen_pilot()?.stop_before_backtest()?)
}
