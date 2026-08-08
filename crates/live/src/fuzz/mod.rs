//! Shared support for adapter fuzz binaries.

#[doc(hidden)]
pub use libfuzzer_sys::{Corpus, fuzz_target as libfuzzer_target};

// libfuzzer-sys 0.4.13 resolves `Corpus` through an absolute path at the call
// site. Alias this crate so adapter packages only depend on vibe-live.
#[doc(hidden)]
#[macro_export]
macro_rules! fuzz_target {
    ($($tokens:tt)*) => {
        extern crate vibe_live as libfuzzer_sys;
        $crate::fuzz::libfuzzer_target!($($tokens)*);
    };
}

pub use crate::fuzz_target;
