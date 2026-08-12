use thiserror::Error;

use crate::{
    artifact::{ArtifactError, StrategyArtifact},
    decision::{DecisionAction, DecisionContract, DecisionError, DecisionInput},
    intent::{IntentError, ResearchIntent},
    runtime::{PreparedDecisionRuntime, RuntimeError, RuntimeProjection, prepare_decision_runtime},
};

#[derive(Debug)]
pub struct PreparedPilot {
    intent: ResearchIntent,
    decision: DecisionContract,
    artifact: StrategyArtifact,
    runtime: RuntimeProjection,
    decision_runtime: PreparedDecisionRuntime,
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
}

pub fn prepare_frozen_pilot() -> Result<PreparedPilot, PreparationError> {
    let intent = ResearchIntent::frozen()?;
    let decision = DecisionContract::for_intent(&intent)?;
    let artifact = StrategyArtifact::issue(&intent, &decision)?;
    let (decision_runtime, runtime) = prepare_decision_runtime(&artifact, &intent, &decision)?;
    Ok(PreparedPilot {
        intent,
        decision,
        artifact,
        runtime,
        decision_runtime,
    })
}
