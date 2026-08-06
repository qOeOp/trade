//! Opaque host-side ABI tokens.
//!
//! The public `vibe-plugin` crate supplies the token types used to declare
//! the plug-in init symbol while the host implementation remains an internal
//! Vibe deployment detail.

/// Opaque host service table supplied by the host implementation.
#[repr(C)]
#[derive(Debug)]
pub struct HostVTable {
    _opaque: [u8; 0],
}

/// Opaque per-instance host context supplied by the host implementation.
#[repr(C)]
#[derive(Debug)]
pub struct HostContext {
    _opaque: [u8; 0],
}

#[cfg(test)]
mod tests {
    use core::mem::{align_of, size_of};

    use rstest::rstest;

    use super::*;

    #[rstest]
    fn host_vtable_is_opaque_zero_sized_token() {
        assert_eq!(size_of::<HostVTable>(), 0);
        assert_eq!(align_of::<HostVTable>(), 1);
    }

    #[rstest]
    fn host_context_is_opaque_zero_sized_token() {
        assert_eq!(size_of::<HostContext>(), 0);
        assert_eq!(align_of::<HostContext>(), 1);
    }
}
