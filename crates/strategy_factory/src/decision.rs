use std::{convert::TryFrom, str::FromStr};

use serde::Serialize;
use thiserror::Error;
use vibe_model::types::{Money, Quantity};

use crate::intent::{IntentError, ResearchIntent};

pub const DECISION_ABI_VERSION: u32 = 1;
pub const DECISION_EXPORT: &str = "strategy_factory_decide_v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreWasmValueType {
    I32,
    F64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoreWasmSignature {
    parameters: [CoreWasmValueType; 7],
    result: CoreWasmValueType,
}

impl CoreWasmSignature {
    pub const fn parameters(&self) -> &[CoreWasmValueType; 7] {
        &self.parameters
    }

    pub const fn result(&self) -> CoreWasmValueType {
        self.result
    }
}

pub const DECISION_SIGNATURE: CoreWasmSignature = CoreWasmSignature {
    parameters: [
        CoreWasmValueType::I32,
        CoreWasmValueType::I32,
        CoreWasmValueType::F64,
        CoreWasmValueType::F64,
        CoreWasmValueType::F64,
        CoreWasmValueType::F64,
        CoreWasmValueType::F64,
    ],
    result: CoreWasmValueType::I32,
};

macro_rules! closed_abi_enum {
    ($name:ident, $error:ident, {$($variant:ident = $value:literal),+ $(,)?}) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #[repr(i32)]
        pub enum $name {
            $($variant = $value),+
        }

        impl TryFrom<i32> for $name {
            type Error = DecisionError;

            fn try_from(value: i32) -> Result<Self, Self::Error> {
                match value {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(DecisionError::$error(value)),
                }
            }
        }
    };
}

closed_abi_enum!(DecisionPhase, UnknownPhase, {
    Validation = 0,
    PenultimateValidation = 1,
});
closed_abi_enum!(DecisionPosition, UnknownPosition, {
    Flat = 0,
    Long = 1,
});
closed_abi_enum!(DecisionAction, UnknownAction, {
    Hold = 0,
    EnterLong = 1,
    ExitLong = 2,
});

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DecisionInput {
    phase: DecisionPhase,
    position: DecisionPosition,
    close: f64,
    fast_ema: f64,
    slow_ema: f64,
    prior_72_high: f64,
    prior_24_low: f64,
}

impl DecisionInput {
    #[allow(clippy::too_many_arguments)]
    pub fn from_abi(
        phase: i32,
        position: i32,
        close: f64,
        fast_ema: f64,
        slow_ema: f64,
        prior_72_high: f64,
        prior_24_low: f64,
    ) -> Result<Self, DecisionError> {
        for (name, value) in [
            ("close", close),
            ("fast_ema", fast_ema),
            ("slow_ema", slow_ema),
            ("prior_72_high", prior_72_high),
            ("prior_24_low", prior_24_low),
        ] {
            if !value.is_finite() {
                return Err(DecisionError::NonFiniteInput(name));
            }
        }

        Ok(Self {
            phase: DecisionPhase::try_from(phase)?,
            position: DecisionPosition::try_from(position)?,
            close,
            fast_ema,
            slow_ema,
            prior_72_high,
            prior_24_low,
        })
    }

    pub const fn phase(&self) -> DecisionPhase {
        self.phase
    }

    pub const fn position(&self) -> DecisionPosition {
        self.position
    }

    pub const fn close(&self) -> f64 {
        self.close
    }

    pub const fn fast_ema(&self) -> f64 {
        self.fast_ema
    }

    pub const fn slow_ema(&self) -> f64 {
        self.slow_ema
    }

    pub const fn prior_72_high(&self) -> f64 {
        self.prior_72_high
    }

    pub const fn prior_24_low(&self) -> f64 {
        self.prior_24_low
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionDirection {
    LongOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryRule {
    CurrentFastEmaAboveSlowAndCloseAbovePrior72High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitRule {
    CloseBelowPrior24LowOrCurrentFastEmaNotAboveSlow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionTiming {
    NextExecutableExternalBarOpen,
}

impl ExecutionTiming {
    pub const fn trade_on_close(self) -> bool {
        match self {
            Self::NextExecutableExternalBarOpen => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EconomicDisposition {
    Rejected,
    SurvivedNotAdmitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EconomicRule {
    RejectNonPositiveNetPnlOtherwiseSurvivedNotAdmitted,
}

impl EconomicRule {
    pub const fn falsifier(self) -> &'static str {
        match self {
            Self::RejectNonPositiveNetPnlOtherwiseSurvivedNotAdmitted => {
                "validation_net_pnl_after_native_commissions_lte_zero"
            }
        }
    }

    pub const fn disposition(self, net_pnl: Money) -> EconomicDisposition {
        match self {
            Self::RejectNonPositiveNetPnlOtherwiseSurvivedNotAdmitted if net_pnl.raw <= 0 => {
                EconomicDisposition::Rejected
            }
            Self::RejectNonPositiveNetPnlOtherwiseSurvivedNotAdmitted => {
                EconomicDisposition::SurvivedNotAdmitted
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalRule {
    PenultimateSignalFinalOpenExecution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelProjection {
    PreviousCallbackPrior72HighAndPrior24Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WarmupInvocation {
    UpdateNativeIndicatorsWithoutGuest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZeroVolumeInvocation {
    NoIndicatorGuestOrOrder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidationInvocation {
    CurrentEmaAndPreviousCallbackChannels,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinalBarInvocation {
    ReleasePenultimateExitAtOpenWithoutCloseDecision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MechanismContract {
    direction: DecisionDirection,
    entry: EntryRule,
    exit: ExitRule,
    execution: ExecutionTiming,
    terminal: TerminalRule,
    entry_lookback: u32,
    exit_lookback: u32,
    fast_ema: u32,
    slow_ema: u32,
}

impl MechanismContract {
    pub const fn direction(&self) -> DecisionDirection {
        self.direction
    }

    pub const fn entry(&self) -> EntryRule {
        self.entry
    }

    pub const fn exit(&self) -> ExitRule {
        self.exit
    }

    pub const fn execution(&self) -> ExecutionTiming {
        self.execution
    }

    pub const fn terminal(&self) -> TerminalRule {
        self.terminal
    }

    pub const fn entry_lookback(&self) -> u32 {
        self.entry_lookback
    }

    pub const fn exit_lookback(&self) -> u32 {
        self.exit_lookback
    }

    pub const fn fast_ema(&self) -> u32 {
        self.fast_ema
    }

    pub const fn slow_ema(&self) -> u32 {
        self.slow_ema
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvocationContract {
    warmup: WarmupInvocation,
    zero_volume: ZeroVolumeInvocation,
    validation: ValidationInvocation,
    channels: ChannelProjection,
    final_bar: FinalBarInvocation,
}

impl InvocationContract {
    pub const fn warmup(&self) -> WarmupInvocation {
        self.warmup
    }

    pub const fn zero_volume(&self) -> ZeroVolumeInvocation {
        self.zero_volume
    }

    pub const fn validation(&self) -> ValidationInvocation {
        self.validation
    }

    pub const fn channels(&self) -> ChannelProjection {
        self.channels
    }

    pub const fn final_bar(&self) -> FinalBarInvocation {
        self.final_bar
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionContract {
    version: u32,
    export: &'static str,
    signature: CoreWasmSignature,
    intent_identity: String,
    pilot_id: String,
    trade_quantity: Quantity,
    starting_balance: Money,
    economic_rule: EconomicRule,
    mechanism: MechanismContract,
    invocation: InvocationContract,
}

impl DecisionContract {
    pub fn for_intent(intent: &ResearchIntent) -> Result<Self, DecisionError> {
        intent.validate_frozen_binding()?;
        let parameters = &intent.payload.mechanism.parameters;
        let quantity = intent
            .payload
            .costs
            .quantity
            .strip_suffix(" BTC")
            .ok_or(DecisionError::IntentProjection("quantity currency"))?;

        Ok(Self {
            version: DECISION_ABI_VERSION,
            export: DECISION_EXPORT,
            signature: DECISION_SIGNATURE,
            intent_identity: intent.identity.clone(),
            pilot_id: intent.payload.pilot_id.clone(),
            trade_quantity: Quantity::from_str(quantity)
                .map_err(|_| DecisionError::IntentProjection("quantity"))?,
            starting_balance: Money::from_str(&intent.payload.costs.initial_balance)
                .map_err(|_| DecisionError::IntentProjection("starting balance"))?,
            economic_rule: EconomicRule::RejectNonPositiveNetPnlOtherwiseSurvivedNotAdmitted,
            mechanism: MechanismContract {
                direction: DecisionDirection::LongOnly,
                entry: EntryRule::CurrentFastEmaAboveSlowAndCloseAbovePrior72High,
                exit: ExitRule::CloseBelowPrior24LowOrCurrentFastEmaNotAboveSlow,
                execution: ExecutionTiming::NextExecutableExternalBarOpen,
                terminal: TerminalRule::PenultimateSignalFinalOpenExecution,
                entry_lookback: parameters.entry_lookback,
                exit_lookback: parameters.exit_lookback,
                fast_ema: parameters.fast_ema,
                slow_ema: parameters.slow_ema,
            },
            invocation: InvocationContract {
                warmup: WarmupInvocation::UpdateNativeIndicatorsWithoutGuest,
                zero_volume: ZeroVolumeInvocation::NoIndicatorGuestOrOrder,
                validation: ValidationInvocation::CurrentEmaAndPreviousCallbackChannels,
                channels: ChannelProjection::PreviousCallbackPrior72HighAndPrior24Low,
                final_bar: FinalBarInvocation::ReleasePenultimateExitAtOpenWithoutCloseDecision,
            },
        })
    }

    pub const fn version(&self) -> u32 {
        self.version
    }

    pub const fn export(&self) -> &'static str {
        self.export
    }

    pub const fn signature(&self) -> &CoreWasmSignature {
        &self.signature
    }

    pub fn intent_identity(&self) -> &str {
        &self.intent_identity
    }

    pub fn pilot_id(&self) -> &str {
        &self.pilot_id
    }

    pub const fn trade_quantity(&self) -> Quantity {
        self.trade_quantity
    }

    pub const fn starting_balance(&self) -> Money {
        self.starting_balance
    }

    pub const fn economic_rule(&self) -> EconomicRule {
        self.economic_rule
    }

    pub const fn mechanism(&self) -> &MechanismContract {
        &self.mechanism
    }

    pub const fn invocation(&self) -> &InvocationContract {
        &self.invocation
    }

    pub fn validate_abi(
        &self,
        version: u32,
        export: &str,
        signature: &CoreWasmSignature,
    ) -> Result<(), DecisionError> {
        if version != self.version {
            return Err(DecisionError::AbiMismatch("version"));
        }

        if export != self.export {
            return Err(DecisionError::AbiMismatch("export"));
        }

        if signature != &self.signature {
            return Err(DecisionError::AbiMismatch("signature"));
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DecisionError {
    #[error(transparent)]
    Intent(#[from] IntentError),
    #[error("frozen ResearchIntent cannot project {0}")]
    IntentProjection(&'static str),
    #[error("unknown decision phase discriminant: {0}")]
    UnknownPhase(i32),
    #[error("unknown decision position discriminant: {0}")]
    UnknownPosition(i32),
    #[error("unknown decision action discriminant: {0}")]
    UnknownAction(i32),
    #[error("non-finite decision input: {0}")]
    NonFiniteInput(&'static str),
    #[error("decision ABI mismatch: {0}")]
    AbiMismatch(&'static str),
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn discriminants_fail_closed_without_hold_fallback() {
        assert_eq!(
            DecisionPhase::try_from(2),
            Err(DecisionError::UnknownPhase(2))
        );
        assert_eq!(
            DecisionPosition::try_from(2),
            Err(DecisionError::UnknownPosition(2))
        );
        assert_eq!(
            DecisionAction::try_from(3),
            Err(DecisionError::UnknownAction(3))
        );
        assert_ne!(DecisionAction::try_from(3), Ok(DecisionAction::Hold));
    }

    #[rstest]
    fn every_non_finite_numeric_input_fails_closed() {
        let invalid = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
        for index in 0..5 {
            for value in invalid {
                let mut values = [1.0, 2.0, 3.0, 4.0, 5.0];
                values[index] = value;
                let e = DecisionInput::from_abi(
                    0, 0, values[0], values[1], values[2], values[3], values[4],
                )
                .unwrap_err();
                assert!(matches!(e, DecisionError::NonFiniteInput(_)));
            }
        }
    }

    #[rstest]
    fn abi_identity_mismatches_fail_closed() {
        let intent = ResearchIntent::frozen().expect("frozen intent");
        let contract = DecisionContract::for_intent(&intent).expect("decision contract");
        assert_eq!(
            contract.validate_abi(2, DECISION_EXPORT, &DECISION_SIGNATURE),
            Err(DecisionError::AbiMismatch("version"))
        );
        assert_eq!(
            contract.validate_abi(1, "other_export", &DECISION_SIGNATURE),
            Err(DecisionError::AbiMismatch("export"))
        );
        let wrong_signature = CoreWasmSignature {
            parameters: DECISION_SIGNATURE.parameters,
            result: CoreWasmValueType::F64,
        };
        assert_eq!(
            contract.validate_abi(1, DECISION_EXPORT, &wrong_signature),
            Err(DecisionError::AbiMismatch("signature"))
        );
    }
}
