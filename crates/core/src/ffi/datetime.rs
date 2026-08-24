//! Thin FFI wrappers around the date/time conversion utilities in `vibe-core`.
//!
//! The Rust implementation lives in `crate::datetime`; this module exposes the conversions to C.
//! Each exported function forwards directly to its Rust counterpart and inherits the same semantics
//! and safety guarantees.

use std::ffi::c_char;

use crate::{
    datetime::{unix_nanos_to_iso8601, unix_nanos_to_iso8601_millis},
    ffi::{abort_on_panic, string::str_to_cstr},
};

/// Converts a UNIX nanoseconds timestamp to an ISO 8601 (RFC 3339) format C string pointer.
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn unix_nanos_to_iso8601_cstr(timestamp_ns: u64) -> *const c_char {
    abort_on_panic(|| str_to_cstr(&unix_nanos_to_iso8601(timestamp_ns.into())))
}

/// Converts a UNIX nanoseconds timestamp to an ISO 8601 (RFC 3339) format C string pointer
/// with millisecond precision.
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn unix_nanos_to_iso8601_millis_cstr(timestamp_ns: u64) -> *const c_char {
    abort_on_panic(|| str_to_cstr(&unix_nanos_to_iso8601_millis(timestamp_ns.into())))
}

/// Converts seconds to nanoseconds (ns).
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn secs_to_nanos(secs: f64) -> u64 {
    abort_on_panic(|| crate::datetime::secs_to_nanos_unchecked(secs))
}

/// Converts seconds to milliseconds (ms).
///
/// # Panics
///
/// Panics if [`crate::datetime::secs_to_millis`] returns an error for `secs`.
/// The panic is caught by [`abort_on_panic`] and converted into a process abort
/// across the FFI boundary.
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn secs_to_millis(secs: f64) -> u64 {
    abort_on_panic(|| {
        crate::datetime::secs_to_millis(secs)
            .unwrap_or_else(|e| panic!("secs_to_millis: invalid or overflowing input: {e:?}"))
    })
}

/// Converts milliseconds (ms) to nanoseconds (ns).
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn millis_to_nanos(millis: f64) -> u64 {
    abort_on_panic(|| crate::datetime::millis_to_nanos_unchecked(millis))
}

/// Converts microseconds (μs) to nanoseconds (ns).
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn micros_to_nanos(micros: f64) -> u64 {
    abort_on_panic(|| crate::datetime::micros_to_nanos_unchecked(micros))
}

/// Converts nanoseconds (ns) to seconds.
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn nanos_to_secs(nanos: u64) -> f64 {
    abort_on_panic(|| crate::datetime::nanos_to_secs(nanos))
}

/// Converts nanoseconds (ns) to milliseconds (ms).
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn nanos_to_millis(nanos: u64) -> u64 {
    abort_on_panic(|| crate::datetime::nanos_to_millis(nanos))
}

/// Converts nanoseconds (ns) to microseconds (μs).
#[cfg(feature = "ffi")]
#[unsafe(no_mangle)]
pub extern "C" fn nanos_to_micros(nanos: u64) -> u64 {
    abort_on_panic(|| crate::datetime::nanos_to_micros(nanos))
}
