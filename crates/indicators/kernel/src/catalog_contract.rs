//! Typed kernel-owned V1 catalog rules. A lifecycle row references its existing owner only.

use crate::RoundingMode;

macro_rules! wire_rules {
    ($name:ident { $($variant:ident = $tag:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub(super) const fn tag(self) -> u8 { match self { $(Self::$variant => $tag),+ } }
        }
    };
}

wire_rules!(CatalogRowKindV1 { Policy = 1, Primitive = 2, LifecycleReference = 3 });
wire_rules!(CatalogInputRuleV1 {
    None = 0, Fixed = 1, TwoFixed = 2, BooleanAndTwoFixed = 3, Ohlc = 4,
    ClockedFixed = 5, ClockedOhlc = 6, ClockedHigh = 7, ClockedLow = 8
});
wire_rules!(CatalogOutputRuleV1 {
    Policy = 0, Fixed = 1, Boolean = 2, AvailableFixed = 3,
    AvailableFixedAndCoordinate = 4, LifecycleReference = 5
});
wire_rules!(CatalogUnitRuleV1 {
    Policy = 0, PreserveEqualInputs = 1, Product = 2, Quotient = 3,
    EqualInputsBooleanOutput = 4, EqualBranches = 5, DimensionlessOutput = 6, LifecycleOwned = 7
});
wire_rules!(CatalogScaleRuleV1 {
    Policy = 0, EqualInputsDeclaredOutput = 1, DeclaredOutput = 2,
    EqualInputsBooleanOutput = 3, RetainEqualInputs = 4, LifecycleOwned = 5
});
wire_rules!(CatalogAvailabilityRuleV1 {
    Policy = 0, ReadyInputs = 1, FirstSample = 2, FullWindow = 3,
    LagOffsetPlusOne = 4, PeriodPlusOne = 5, PreviousClose = 6, LifecycleOwned = 7
});
wire_rules!(CatalogClockRuleV1 { None = 0, OneDeclaredTriggerOrSample = 1, Policy = 2, LifecycleOwned = 3 });
wire_rules!(CatalogStateRuleV1 { None = 0, Smoothing = 1, Window = 2, Bar = 3, Rsi = 4, Policy = 5, LifecycleOwned = 6 });
wire_rules!(CatalogParameterRuleV1 {
    None = 0, OutputScale = 1, ComparisonPredicate = 2, Period = 3, Window = 4,
    LagAndMaximum = 5, OutputScaleAndReducedFraction = 6, PeriodAndOutputScale = 7,
    WindowAndOutputScale = 8, Policy = 9, LifecycleOwned = 10
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PrimitiveOperationV1 {
    Add,
    Sub,
    Mul,
    Div,
    Rescale,
    Compare,
    Select,
    Body,
    Range,
    UpperWick,
    LowerWick,
    Fraction,
    Ema,
    Wilder,
    TrueRange,
    Atr,
    Gap,
    Rsi,
    Lag,
    Sum,
    Mean,
    Minimum,
    Maximum,
    SwingHigh,
    SwingLow,
}

impl PrimitiveOperationV1 {
    pub(super) const fn stateful(self) -> bool {
        matches!(
            self,
            Self::Ema
                | Self::Wilder
                | Self::TrueRange
                | Self::Atr
                | Self::Gap
                | Self::Rsi
                | Self::Lag
                | Self::Sum
                | Self::Mean
                | Self::Minimum
                | Self::Maximum
                | Self::SwingHigh
                | Self::SwingLow
        )
    }

    pub(super) const fn bar(self) -> bool {
        matches!(
            self,
            Self::Body
                | Self::Range
                | Self::UpperWick
                | Self::LowerWick
                | Self::TrueRange
                | Self::Atr
                | Self::Gap
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CatalogContractV1 {
    pub input: CatalogInputRuleV1,
    pub output: CatalogOutputRuleV1,
    pub unit: CatalogUnitRuleV1,
    pub scale: CatalogScaleRuleV1,
    pub availability: CatalogAvailabilityRuleV1,
    pub clock: CatalogClockRuleV1,
    pub state: CatalogStateRuleV1,
    pub parameters: CatalogParameterRuleV1,
    pub formula: &'static str,
    pub state_encoding: &'static str,
}

impl CatalogContractV1 {
    pub(super) const fn tags(self) -> [u8; 8] {
        [
            self.input.tag(),
            self.output.tag(),
            self.unit.tag(),
            self.scale.tag(),
            self.availability.tag(),
            self.clock.tag(),
            self.state.tag(),
            self.parameters.tag(),
        ]
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CatalogRowV1 {
    pub semantic_id: &'static str,
    pub kind: CatalogRowKindV1,
    pub operation: Option<PrimitiveOperationV1>,
    pub rounding: Option<RoundingMode>,
}

const NO_STATE: &str = "empty bytes; no primitive state";
const SMOOTHING_STATE: &str = "352 bytes LE: schema:u16=1,reserved:u16=0,period:u32>0,kind:u8(EMA=1,Wilder=2),round:u8,scale:u8,initialized:u8; coordinate:308,input:i128,output:i128; uninitialized payload zero; restore preserves config";
const WINDOW_STATE: &str = "20+324*window bytes LE: schema:u16=1,reserved:u16=0,kind:u8(sum=1,mean=2,min=3,max=4,swing-high=5,swing-low=6,lag=7),round:u8,input-scale:u8,output-scale:u8,window:u32>0,count:u32,next:u32; physical ring entries coordinate:308,coefficient:i128; unused entries zero; lag window=offset+1; restore validates config/history and recomputes output";
const BAR_STATE: &str = "400 bytes LE: schema:u16=1,reserved:u16=0,kind:u8(TR=1,ATR=2,gap=3),round:u8,scale:u8,status:u8(empty=0,warming=1,ready=2),period:u32(positive only ATR; otherwise zero); coordinate:308,open:i128,high:i128,low:i128,close:i128,output:i128; empty payload zero; warming only gap; restore preserves config/OHLC";
const RSI_STATE: &str = "384+20+324*(period+1) bytes LE: schema:u16=1,reserved:u16=0,round:u8,input-scale:u8,output-scale:u8,status:u8(empty=0,warming=1,ready=2),period:u32>0; coordinate:308,close:i128,average-gain:i128,average-loss:i128,output:i128; nested canonical lag window of period+1; ready history cleared; warm averages/output zero; restore preserves config/phase and recomputes ready ratio";
const STATE_POLICY: &str = "integers little-endian: counts/period/window/lag/ring-index:u32; Owner times/sequences/lineage-version:u64; coefficient:i128; scale/round:u8; coordinate exactly308 bytes schema1/reserved0 from admitted Owner input; never Rust layout,usize,pointers,JSON numbers; failure preserves entire pre-event state; Host owns authentication and whole-event commit";

impl CatalogRowV1 {
    #[must_use]
    pub fn contract(self) -> CatalogContractV1 {
        use CatalogAvailabilityRuleV1 as A;
        use CatalogInputRuleV1 as I;
        use CatalogOutputRuleV1 as O;
        use CatalogParameterRuleV1 as P;
        use CatalogScaleRuleV1 as S;
        use CatalogStateRuleV1 as T;
        use CatalogUnitRuleV1 as U;
        use PrimitiveOperationV1 as Op;

        let mut value = CatalogContractV1 {
            input: I::None,
            output: O::Policy,
            unit: U::Policy,
            scale: S::Policy,
            availability: A::Policy,
            clock: CatalogClockRuleV1::Policy,
            state: T::Policy,
            parameters: P::Policy,
            formula: "",
            state_encoding: STATE_POLICY,
        };

        if self.kind == CatalogRowKindV1::LifecycleReference {
            value.output = O::LifecycleReference;
            value.unit = U::LifecycleOwned;
            value.scale = S::LifecycleOwned;
            value.availability = A::LifecycleOwned;
            value.clock = CatalogClockRuleV1::LifecycleOwned;
            value.state = T::LifecycleOwned;
            value.parameters = P::LifecycleOwned;
            value.formula = "reference this row's existing lifecycle semantic ID only; manifest-typed proposal, target or protection field; only shared lifecycle kernel interprets and seals outcome; never an order, Risk permit or external effect";
            value.state_encoding = "existing shared lifecycle state and manifest-typed post-state; no catalog-owned lifecycle state";
            return value;
        }

        let Some(op) = self.operation else {
            value.formula = match self.semantic_id {
                "bfp.numeric.fixed-i128.max-scale-38.explicit-rescale.i256-single-round.v1" => {
                    "signed i128 coefficient*10^-scale; scale u8 in0..38; no implicit alignment/rescale; one exact signed two's-complement I256 expression including powers/rational factors, then one final division/round into declared output scale; wide intermediate fitting I256 and final I128 is valid; no floats"
                }
                "bfp.round.toward-zero.v1" => {
                    "truncate final rational quotient toward zero; exact remainder needs no rounding; frozen round tag1"
                }
                "bfp.round.nearest-ties-to-even.v1" => {
                    "nearest final rational quotient; exact half chooses even signed quotient; frozen round tag2"
                }
                "bfp.numeric.failure.no-state-change.v1" => {
                    "I256 overflow,divide-by-zero,invalid scale,scale mismatch,nonzero remainder without rounding,final I128 overflow(including MIN/-1),or OHLC ordering violation => NUMERIC_FAILURE_NO_STATE_CHANGE; no output and pre/post state byte-identical; validation before execution => UNSUPPORTED/no Artifact"
                }
                "bfp.availability.warming-ready.v1" => {
                    "WARMING advances valid declared clock/state but has no readable value; READY inputs required for downstream evaluation; warm-up HOLD requires explicit Design availability wiring; same coordinate and same input reuses output, equal value at new coordinate advances"
                }
                "bfp.state.post.fixed-canonical.v1" => {
                    "one state writer and declared initial value; exactly one declared reaction trigger or named sample clock per stateful primitive; compatible Owner order, strict new sample identity; scratch whole event then commit; no numeric failure changes counters,coordinates,kernel/plugin/lifecycle/trace/checkpoint bytes"
                }
                _ => "",
            };
            return value;
        };
        value.input = if op.bar() { I::Ohlc } else { I::Fixed };
        value.output = O::Fixed;
        value.unit = U::PreserveEqualInputs;
        value.scale = S::RetainEqualInputs;
        value.availability = A::ReadyInputs;
        value.clock = CatalogClockRuleV1::None;
        value.state = T::None;
        value.parameters = P::None;
        value.state_encoding = NO_STATE;

        if op.stateful() {
            value.input = if op.bar() {
                I::ClockedOhlc
            } else {
                I::ClockedFixed
            };
            value.output = O::AvailableFixed;
            value.clock = CatalogClockRuleV1::OneDeclaredTriggerOrSample;
        }

        value.formula = match op {
            Op::Add => "a+b; equal input scales/units; full I256 sum then one final rescale/round",
            Op::Sub => {
                "a-b; equal input scales/units; full I256 difference then one final rescale/round"
            }
            Op::Mul => {
                "a*b; full I256 coefficient product with output-scale minus sum-of-input-scales exponent, then one final round"
            }
            Op::Div => {
                "a/b; b!=0; I256 rational exponent=b.scale+output.scale-a.scale, then one final round"
            }
            Op::Rescale => {
                "a*10^(output.scale-a.scale) in coefficient space; I256 expression then one final round"
            }
            Op::Compare => {
                "bool(a relation b), equal scales/units; frozen predicate byte1=less,2=less-or-equal,3=equal,4=not-equal,5=greater-or-equal,6=greater; other predicate tags unsupported; no cast from Ordering to bool"
            }
            Op::Select => {
                "if boolean condition then a else b; equal branch scales/units; no implicit conversion"
            }
            Op::Body => {
                "abs(close-open); validate low<=min(open,close)<=max(open,close)<=high and equal OHLC scales/units first"
            }
            Op::Range => {
                "high-low; validate low<=min(open,close)<=max(open,close)<=high and equal OHLC scales/units first"
            }
            Op::UpperWick => {
                "high-max(open,close); validate low<=min(open,close)<=max(open,close)<=high and equal OHLC scales/units first"
            }
            Op::LowerWick => {
                "min(open,close)-low; validate low<=min(open,close)<=max(open,close)<=high and equal OHLC scales/units first"
            }
            Op::Fraction => {
                "low+(high-low)*numerator/denominator as one I256 expression then final output-scale round; equal bounds scales/units,low<=high; frozen reduced u32 ratio,denominator>0,0<=numerator<=denominator; reject rather than normalize/clamp"
            }
            Op::Ema => {
                "p>0; first sample seeds exact value; thereafter previous+2*(sample-previous)/(p+1) as one I256 expression with final round; retain scale"
            }
            Op::Wilder => {
                "p>0; first sample seeds exact value; thereafter previous+(sample-previous)/p as one I256 expression with final round; retain scale"
            }
            Op::TrueRange => {
                "validate OHLC equal scales/units and ordering; first high-low; thereafter max(high-low,abs(high-previous_close),abs(low-previous_close)); commit previous close only on success"
            }
            Op::Atr => {
                "p>0; validated true-range series, first sample seeds TR; thereafter previous_ATR+(TR-previous_ATR)/p using one wide Wilder expression/final round; no SMA variant"
            }
            Op::Gap => {
                "validated OHLC; first sample WARMING; then open-previous_close; retain equal scale/unit; commit previous close only on success"
            }
            Op::Rsi => {
                "p>0; wide delta=close-previous_close,gain=max(delta,0),loss=max(-delta,0); first p deltas initialize each average as sum/p; later average=previous_average+(sample-previous_average)/p at input scale; dimensionless output: both zero=>50,gain>0/loss=0=>100,gain=0/loss>0=>0,otherwise100*gain/(gain+loss) with one final output-scale round"
            }
            Op::Lag => {
                "offset in1..declared_max_lag; value and exact Owner coordinate offset distinct clock advances before current; no partial history"
            }
            Op::Sum => {
                "positive full window; exact I256 sum then declared output-scale conversion; no partial window and no discarded remainder without rounding"
            }
            Op::Mean => {
                "positive full window; one I256 sum divided once by window with declared output scale/rounding; no partial window"
            }
            Op::Minimum => {
                "positive full trailing window minimum; equal scale/unit; no partial window"
            }
            Op::Maximum => {
                "positive full trailing window maximum; equal scale/unit; no partial window"
            }
            Op::SwingHigh => {
                "positive full trailing window maximum high plus its exact Owner coordinate; equal extrema choose latest coordinate in Owner order; no future-looking pivot"
            }
            Op::SwingLow => {
                "positive full trailing window minimum low plus its exact Owner coordinate; equal extrema choose latest coordinate in Owner order; no future-looking pivot"
            }
        };

        match op {
            Op::Add | Op::Sub | Op::Mul | Op::Div => {
                value.input = I::TwoFixed;
                value.parameters = P::OutputScale;
                value.scale = if matches!(op, Op::Add | Op::Sub) {
                    S::EqualInputsDeclaredOutput
                } else {
                    S::DeclaredOutput
                };
                value.unit = match op {
                    Op::Mul => U::Product,
                    Op::Div => U::Quotient,
                    _ => U::PreserveEqualInputs,
                };
            }
            Op::Rescale => {
                value.scale = S::DeclaredOutput;
                value.parameters = P::OutputScale;
            }
            Op::Compare => {
                value.input = I::TwoFixed;
                value.output = O::Boolean;
                value.unit = U::EqualInputsBooleanOutput;
                value.scale = S::EqualInputsBooleanOutput;
                value.parameters = P::ComparisonPredicate;
            }
            Op::Select => {
                value.input = I::BooleanAndTwoFixed;
                value.unit = U::EqualBranches;
            }
            Op::Fraction => {
                value.input = I::TwoFixed;
                value.scale = S::EqualInputsDeclaredOutput;
                value.parameters = P::OutputScaleAndReducedFraction;
            }
            Op::Ema | Op::Wilder => {
                value.availability = A::FirstSample;
                value.parameters = P::Period;
                value.state = T::Smoothing;
                value.state_encoding = SMOOTHING_STATE;
            }
            Op::TrueRange | Op::Atr | Op::Gap => {
                value.availability = if matches!(op, Op::Gap) {
                    A::PreviousClose
                } else {
                    A::FirstSample
                };
                value.parameters = if matches!(op, Op::Atr) {
                    P::Period
                } else {
                    P::None
                };
                value.state = T::Bar;
                value.state_encoding = BAR_STATE;
            }
            Op::Rsi => {
                value.unit = U::DimensionlessOutput;
                value.scale = S::DeclaredOutput;
                value.availability = A::PeriodPlusOne;
                value.parameters = P::PeriodAndOutputScale;
                value.state = T::Rsi;
                value.state_encoding = RSI_STATE;
            }
            Op::Lag
            | Op::Sum
            | Op::Mean
            | Op::Minimum
            | Op::Maximum
            | Op::SwingHigh
            | Op::SwingLow => {
                value.availability = if matches!(op, Op::Lag) {
                    A::LagOffsetPlusOne
                } else {
                    A::FullWindow
                };
                value.parameters = if matches!(op, Op::Lag) {
                    P::LagAndMaximum
                } else if matches!(op, Op::Sum | Op::Mean) {
                    P::WindowAndOutputScale
                } else {
                    P::Window
                };
                value.state = T::Window;
                value.state_encoding = WINDOW_STATE;

                if matches!(op, Op::Sum | Op::Mean) {
                    value.scale = S::DeclaredOutput;
                }

                if matches!(op, Op::Lag | Op::SwingHigh | Op::SwingLow) {
                    value.output = O::AvailableFixedAndCoordinate;
                }

                if matches!(op, Op::SwingHigh) {
                    value.input = I::ClockedHigh;
                }

                if matches!(op, Op::SwingLow) {
                    value.input = I::ClockedLow;
                }
            }
            _ => {}
        }

        value
    }
}
