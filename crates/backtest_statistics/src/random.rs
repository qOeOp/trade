//! A seeded generator whose stream is fixed by this crate, not by a dependency's version.

/// SplitMix64 (Steele, Lea and Flood): one 64-bit state, advanced by a constant and mixed.
pub(crate) struct SplitMix64(u64);

impl SplitMix64 {
    pub(crate) const fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub(crate) const fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// An index below `bound`, by the high half of a 128-bit product (bias below 2^-32 for any
    /// bound a run reaches).
    pub(crate) fn below(&mut self, bound: usize) -> usize {
        ((u128::from(self.next()) * bound as u128) >> 64) as usize
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// The reference stream for seed 1234567 (the published SplitMix64 test vector).
    #[rstest]
    fn the_stream_is_splitmix64() {
        let mut random = SplitMix64::new(1_234_567);
        assert_eq!(
            [random.next(), random.next(), random.next()],
            [
                6_457_827_717_110_365_317,
                3_203_168_211_198_807_973,
                9_817_491_932_198_370_423
            ]
        );
    }

    #[rstest]
    fn below_stays_below_and_reaches_every_value() {
        let mut random = SplitMix64::new(7);
        let mut seen = [0_u32; 5];

        for _ in 0..1_000 {
            seen[random.below(5)] += 1;
        }
        assert!(seen.iter().all(|&count| count > 150), "{seen:?}");
    }
}
