use std::str::FromStr;

use thiserror::Error;
use vibe_model::types::{Money, Quantity};

use crate::intent::{IntentError, PilotResearchIntent};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExecutionTiming {
    NextExecutableExternalBarOpen,
}

impl ExecutionTiming {
    pub(crate) const fn trade_on_close(self) -> bool {
        match self {
            Self::NextExecutableExternalBarOpen => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecisionContract {
    trade_quantity: Quantity,
    starting_balance: Money,
    execution: ExecutionTiming,
}

impl DecisionContract {
    pub(crate) fn for_intent(intent: &PilotResearchIntent) -> Result<Self, DecisionError> {
        intent.validate_frozen_binding()?;
        let quantity = intent
            .payload
            .costs
            .quantity
            .strip_suffix(" BTC")
            .ok_or(DecisionError::IntentProjection("quantity currency"))?;

        Ok(Self {
            trade_quantity: Quantity::from_str(quantity)
                .map_err(|_| DecisionError::IntentProjection("quantity"))?,
            starting_balance: Money::from_str(&intent.payload.costs.initial_balance)
                .map_err(|_| DecisionError::IntentProjection("starting balance"))?,
            execution: ExecutionTiming::NextExecutableExternalBarOpen,
        })
    }

    pub(crate) const fn trade_quantity(&self) -> Quantity {
        self.trade_quantity
    }

    pub(crate) const fn starting_balance(&self) -> Money {
        self.starting_balance
    }

    pub(crate) const fn execution(&self) -> ExecutionTiming {
        self.execution
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum DecisionError {
    #[error(transparent)]
    Intent(#[from] IntentError),
    #[error("frozen ResearchIntent cannot project {0}")]
    IntentProjection(&'static str),
}
