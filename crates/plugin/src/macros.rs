//! Declarative macros for plug-in metadata export.

/// Defines a plug-in's static metadata manifest and emits the
/// `vibe_plugin_init` entry symbol.
///
/// Use this exactly once per plug-in cdylib, at module scope.
///
/// # Required fields
///
/// - `name`: short machine-readable plug-in name.
/// - `version`: plug-in version string (usually `env!("CARGO_PKG_VERSION")`).
///
/// # Optional fields
///
/// - `vendor`: free-form vendor/author string (default `""`).
#[macro_export]
macro_rules! vibe_plugin {
    (
        $(name: $name:expr,)?
        $(vendor: $vendor:expr,)?
        $(version: $version:expr,)?
    ) => {
        $crate::__vibe_plugin_impl! {
            @parse
            name = ($($name)?),
            vendor = ($($vendor)?),
            version = ($($version)?),
        }
    };
}

/// Internal expansion of [`vibe_plugin!`]. Not part of the public API.
#[doc(hidden)]
#[macro_export]
macro_rules! __vibe_plugin_impl {
    (
        @parse
        name = (),
        $($rest:tt)*
    ) => {
        ::core::compile_error!("`vibe_plugin!` requires a `name` field");
    };
    (
        @parse
        name = ($name:expr),
        vendor = ($($vendor:expr)?),
        version = (),
    ) => {
        ::core::compile_error!("`vibe_plugin!` requires a `version` field");
    };
    (
        @parse
        name = ($name:expr),
        vendor = ($($vendor:expr)?),
        version = ($version:expr),
    ) => {
        const _: () = {
            static MANIFEST: ::std::sync::LazyLock<$crate::manifest::PluginManifest> =
                ::std::sync::LazyLock::new(|| $crate::manifest::PluginManifest {
                    abi_version: $crate::VIBE_PLUGIN_ABI_VERSION,
                    plugin_name: $crate::boundary::BorrowedStr::from_str($name),
                    plugin_vendor: $crate::boundary::BorrowedStr::from_str(
                        $crate::__vibe_plugin_impl!(@opt $($vendor)?),
                    ),
                    plugin_version: $crate::boundary::BorrowedStr::from_str($version),
                    build_id: $crate::manifest::PluginBuildId::current(),
                });

            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn vibe_plugin_init(
                host: *const $crate::host::HostVTable,
            ) -> *const $crate::manifest::PluginManifest {
                let result = ::std::panic::catch_unwind(|| {
                    if host.is_null() {
                        return ::core::ptr::null::<$crate::manifest::PluginManifest>();
                    }
                    &raw const *MANIFEST
                });

                match result {
                    Ok(ptr) => ptr,
                    Err(payload) => {
                        $crate::panic::drop_payload(payload);
                        ::core::ptr::null()
                    }
                }
            }
        };
    };

    (@opt) => { "" };
    (@opt $vendor:expr) => { $vendor };
}

#[cfg(test)]
#[allow(unreachable_pub)]
mod tests {
    use core::{ptr, ptr::NonNull};

    use rstest::rstest;

    use crate::{VIBE_PLUGIN_ABI_VERSION, host::HostVTable, manifest::PluginManifest};

    crate::vibe_plugin! {
        name: "macro-test-plugin",
        vendor: "Vibe",
        version: "1.2.3",
    }

    unsafe extern "C" {
        fn vibe_plugin_init(host: *const HostVTable) -> *const PluginManifest;
    }

    #[rstest]
    fn optional_vendor_defaults_to_empty() {
        assert_eq!(crate::__vibe_plugin_impl!(@opt), "");
    }

    #[rstest]
    fn plugin_init_returns_null_for_null_host() {
        // SAFETY: the generated init thunk accepts null and returns null without dereferencing it.
        let manifest = unsafe { vibe_plugin_init(ptr::null()) };

        assert!(manifest.is_null());
    }

    #[rstest]
    fn plugin_init_returns_manifest_for_non_null_host() {
        let host = NonNull::<HostVTable>::dangling().as_ptr();

        // SAFETY: the generated init thunk only checks the host pointer for null.
        let manifest = unsafe { vibe_plugin_init(host) };

        assert!(!manifest.is_null());
        // SAFETY: the generated manifest is static for the process lifetime.
        let manifest = unsafe { &*manifest };
        assert_eq!(manifest.abi_version, VIBE_PLUGIN_ABI_VERSION);
        // SAFETY: manifest strings are process-lifetime static strings.
        assert_eq!(
            unsafe { manifest.plugin_name.as_str() },
            "macro-test-plugin"
        );
        // SAFETY: manifest strings are process-lifetime static strings.
        assert_eq!(unsafe { manifest.plugin_vendor.as_str() }, "Vibe");
        // SAFETY: manifest strings are process-lifetime static strings.
        assert_eq!(unsafe { manifest.plugin_version.as_str() }, "1.2.3");
        manifest.validate().unwrap();
    }
}
