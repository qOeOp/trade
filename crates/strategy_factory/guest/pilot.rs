#![no_std]

use core::panic::PanicInfo;

const VALIDATION: i32 = 0;
const PENULTIMATE_VALIDATION: i32 = 1;
const FLAT: i32 = 0;
const LONG: i32 = 1;
const HOLD: i32 = 0;
const ENTER_LONG: i32 = 1;
const EXIT_LONG: i32 = 2;

#[unsafe(no_mangle)]
pub extern "C" fn strategy_factory_decide_v1(
    phase: i32,
    position: i32,
    close: f64,
    fast_ema: f64,
    slow_ema: f64,
    prior_72_high: f64,
    prior_24_low: f64,
) -> i32 {
    if phase == PENULTIMATE_VALIDATION {
        return if position == LONG { EXIT_LONG } else { HOLD };
    }

    if phase == VALIDATION && position == FLAT {
        return if fast_ema > slow_ema && close > prior_72_high {
            ENTER_LONG
        } else {
            HOLD
        };
    }

    if close < prior_24_low || fast_ema <= slow_ema {
        EXIT_LONG
    } else {
        HOLD
    }
}

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
