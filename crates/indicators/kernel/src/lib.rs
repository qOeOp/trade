#![no_std]
#![deny(unsafe_code)]

/// Complete externally stored state after one EMA transition.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EmaTransition {
    pub value: f64,
    pub count: usize,
    pub initialized: bool,
    pub has_inputs: bool,
}

/// Validated canonical EMA configuration.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EmaConfig {
    period: usize,
    alpha: f64,
}

impl EmaConfig {
    /// Returns the sole canonical configuration for a positive `period`.
    #[must_use]
    pub fn new(period: usize) -> Option<Self> {
        (period > 0).then(|| Self {
            period,
            alpha: 2.0 / (period as f64 + 1.0),
        })
    }

    #[must_use]
    pub const fn alpha(self) -> f64 {
        self.alpha
    }

    /// Applies one canonical EMA transition without owning storage or market-data types.
    #[must_use]
    pub fn transition(self, input: f64, current: EmaTransition) -> EmaTransition {
        self.transition_with_alpha(self.alpha, input, current)
    }

    /// Applies one EMA transition with an explicitly owned smoothing factor.
    #[must_use]
    pub fn transition_with_alpha(
        self,
        alpha: f64,
        input: f64,
        current: EmaTransition,
    ) -> EmaTransition {
        if !current.has_inputs {
            return EmaTransition {
                value: input,
                count: 1,
                initialized: self.period == 1,
                has_inputs: true,
            };
        }

        let count = current.count + 1;
        EmaTransition {
            value: libm::fma(alpha, input, (1.0 - alpha) * current.value),
            count,
            initialized: current.initialized || count >= self.period,
            has_inputs: true,
        }
    }
}

#[must_use]
pub fn ema_next_value(previous: f64, input: f64, alpha: f64) -> f64 {
    libm::fma(alpha, input, (1.0 - alpha) * previous)
}

/// Returns the canonical empty EMA state.
#[must_use]
pub const fn reset_ema() -> EmaTransition {
    EmaTransition {
        value: 0.0,
        count: 0,
        initialized: false,
        has_inputs: false,
    }
}

/// Complete caller-owned state after one simple moving-average transition.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SmaTransition {
    pub value: f64,
    pub sum: f64,
    pub count: usize,
    pub initialized: bool,
}

/// Validated simple moving-average configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SmaConfig {
    period: usize,
}

impl SmaConfig {
    #[must_use]
    pub const fn new(period: usize) -> Option<Self> {
        if period == 0 {
            None
        } else {
            Some(Self { period })
        }
    }

    /// Applies one transition while the caller retains the rolling storage.
    ///
    /// `evicted` must be absent before the window is full and present afterwards.
    #[must_use]
    pub fn transition(
        self,
        input: f64,
        evicted: Option<f64>,
        current: SmaTransition,
    ) -> Option<SmaTransition> {
        if current.count > self.period
            || (current.count < self.period) == evicted.is_some()
            || current.initialized != (current.count >= self.period)
        {
            return None;
        }
        let mut sum = current.sum;
        if let Some(oldest) = evicted {
            sum -= oldest;
        }
        sum += input;
        let count = if current.count < self.period {
            current.count + 1
        } else {
            current.count
        };
        Some(SmaTransition {
            value: sum / count as f64,
            sum,
            count,
            initialized: count >= self.period,
        })
    }
}

#[must_use]
pub fn rolling_sum_mean(sum: f64, count: usize, input: f64, evicted: Option<f64>) -> (f64, f64) {
    let next_sum = sum - evicted.unwrap_or(0.0) + input;
    (next_sum, next_sum / count as f64)
}

#[must_use]
pub const fn reset_sma() -> SmaTransition {
    SmaTransition {
        value: 0.0,
        sum: 0.0,
        count: 0,
        initialized: false,
    }
}

/// Returns the canonical bar true range and the close to retain for the next bar.
#[must_use]
pub fn true_range(high: f64, low: f64, close: f64, previous_close: Option<f64>) -> (f64, f64) {
    let previous = previous_close.unwrap_or(close);
    (f64::max(previous, high) - f64::min(low, previous), close)
}

#[must_use]
pub fn relative_strength_index(average_gain: f64, average_loss: f64) -> f64 {
    if average_loss == 0.0 {
        1.0
    } else {
        let relative_strength = average_gain / average_loss;
        1.0 - 1.0 / (1.0 + relative_strength)
    }
}

#[must_use]
pub fn typical_price(high: f64, low: f64, close: f64) -> f64 {
    (high + low + close) / 3.0
}

#[must_use]
pub fn population_std_with_mean<I>(values: I, mean: f64) -> f64
where
    I: IntoIterator<Item = f64>,
{
    let mut squared_deviation = 0.0;
    let mut count = 0_usize;

    for value in values {
        let difference = value - mean;
        squared_deviation += difference * difference;
        count += 1;
    }

    if count == 0 {
        0.0
    } else {
        libm::sqrt(squared_deviation / count as f64)
    }
}

#[must_use]
pub fn bands(mean: f64, standard_deviation: f64, multiplier: f64) -> (f64, f64, f64) {
    (
        libm::fma(multiplier, standard_deviation, mean),
        mean,
        libm::fma(-multiplier, standard_deviation, mean),
    )
}

#[must_use]
pub fn volatility_ratio(slow_atr: f64, fast_atr: f64, current: f64) -> f64 {
    if fast_atr > 0.0 {
        slow_atr / fast_atr
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn libm_fma_matches_native_mul_add_for_frozen_corpus() {
        let corpus = [
            (0.5, 1.0, 0.0),
            (2.0 / 11.0, 10.0, 4.421_607_309_098_372),
            (f64::from_bits(1), f64::from_bits(2), f64::from_bits(3)),
            (1.0 - f64::EPSILON, f64::MAX / 2.0, -f64::MAX / 2.0),
            (
                -0.000_000_000_000_000_222_044_604_925_031_3,
                -0.000_000_000_000_000_222_044_604_925_031_3,
                -0.000_000_000_000_000_222_044_604_925_031_3,
            ),
            (0.0, -0.0, -0.0),
        ];

        for (left, right, addend) in corpus {
            assert_eq!(
                libm::fma(left, right, addend).to_bits(),
                left.mul_add(right, addend).to_bits()
            );
        }
    }

    #[rstest]
    fn transition_preserves_initialization_and_reset_contract() {
        let config = EmaConfig::new(2).unwrap();
        let first = config.transition(1.0, reset_ema());
        assert_eq!(first.value.to_bits(), 1.0_f64.to_bits());
        assert_eq!(first.count, 1);
        assert!(!first.initialized);
        assert!(first.has_inputs);

        let second = config.transition(2.0, first);
        assert_eq!(second.count, 2);
        assert!(second.initialized);
        assert_eq!(
            reset_ema(),
            EmaTransition {
                value: 0.0,
                count: 0,
                initialized: false,
                has_inputs: false,
            }
        );
    }

    #[rstest]
    fn configuration_rejects_zero_and_owns_canonical_alpha() {
        assert!(EmaConfig::new(0).is_none());
        assert_eq!(EmaConfig::new(10).unwrap().alpha(), 2.0 / 11.0);
    }

    #[rstest]
    fn explicit_alpha_uses_the_same_transition_owner() {
        let config = EmaConfig::new(10).unwrap();
        let current = EmaTransition {
            value: 1.0,
            count: 1,
            initialized: false,
            has_inputs: true,
        };

        assert_eq!(config.transition_with_alpha(0.5, 3.0, current).value, 2.0);
        assert_ne!(config.transition(3.0, current).value, 2.0);
    }

    #[rstest]
    fn sma_transition_preserves_eviction_order_and_rejects_inconsistent_storage() {
        let config = SmaConfig::new(2).unwrap();
        let first = config.transition(1.0, None, reset_sma()).unwrap();
        let second = config.transition(3.0, None, first).unwrap();
        let third = config.transition(5.0, Some(1.0), second).unwrap();
        assert_eq!((first.value, second.value, third.value), (1.0, 2.0, 4.0));
        assert!(config.transition(6.0, None, third).is_none());
    }

    #[rstest]
    fn indicator_math_primitives_preserve_existing_formulas() {
        assert_eq!(true_range(12.0, 9.0, 11.0, Some(10.0)), (3.0, 11.0));
        assert_eq!(relative_strength_index(2.0, 0.0), 1.0);
        assert_eq!(relative_strength_index(2.0, 1.0), 0.666_666_666_666_666_7);
        assert_eq!(typical_price(12.0, 9.0, 10.5), 10.5);
        assert_eq!(population_std_with_mean([1.0, 3.0], 2.0), 1.0);
        assert_eq!(bands(2.0, 0.5, 2.0), (3.0, 2.0, 1.0));
        assert_eq!(volatility_ratio(3.0, 2.0, 7.0), 1.5);
        assert_eq!(volatility_ratio(3.0, 0.0, 7.0), 7.0);
    }
}
