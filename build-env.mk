# The compile environment make adds to every cargo run it starts.
#
# CI hashes this file, and only this file, into the rust-cache prefix-key
# (.github/actions/common-setup/action.yml and the generated-stubs cache in build.yml). rust-cache
# derives the rest of its key from the Cargo manifests, the toolchain and the job's own CARGO*,
# RUST*, CC* and CXX* variables; it cannot see what make exports. It also never saves over an exact
# key hit. So a compile-environment change made anywhere rust-cache cannot see leaves every cached
# target directory recorded under the old environment, matched exactly and never refreshed: after
# #1017 changed what make exports for CC and CXX, 71 crates rebuilt on every run until the key moved.
#
# Hashing the whole Makefile instead would throw the caches away on every new target (it changed
# 14 times in the week before this file existed); this section changed twice in seven weeks.
#
# Keep every global or target-specific setting of a compiler, flag, wrapper or build-script switch
# here: CC, CXX, AR, CFLAGS, CXXFLAGS, LDFLAGS, RUSTFLAGS, RUSTDOCFLAGS, RUSTC, RUSTC_WRAPPER,
# RUSTC_WORKSPACE_WRAPPER, CARGO_INCREMENTAL, CARGO_ENCODED_RUSTFLAGS, CARGO_BUILD_RUSTFLAGS,
# CARGO_BUILD_RUSTDOCFLAGS, CARGO_PROFILE_* and DOCS_RS. scripts/ci/check-build-env-file.bash fails
# when the Makefile sets one.

# C and C++ dependencies build with the compiler the caller's environment names. GNU make predefines
# CC=cc and CXX=c++; exporting those defaults would hand build scripts a CC that a plain `cargo` run
# (such as CI's Vibe CLI install) never sees, and crates that declare rerun-if-env-changed=CC
# (aws-lc-sys, libmimalloc-sys) then rebuild, with every dependent, each time the two alternate.
# Choose a compiler with CC=... in the environment or on the command line.
# When sccache is available it wraps rustc; CARGO_INCREMENTAL=0 improves its hit rate.
# To disable sccache: make build SCCACHE=
SCCACHE ?= $(shell command -v sccache 2>/dev/null)

ifneq ($(SCCACHE),)
RUSTC_WRAPPER ?= sccache
CARGO_INCREMENTAL ?= 0
export RUSTC_WRAPPER
export CARGO_INCREMENTAL
endif

ifeq ($(origin CC),default)
unexport CC
endif
ifeq ($(origin CXX),default)
unexport CXX
endif

# Target-specific compile environment. The targets themselves are defined in the Makefile.
docs-rust: export RUSTDOCFLAGS=--enable-index-page -Zunstable-options $(if $(RUSTDOC_EXTRA_HEAD),--html-in-header $(RUSTDOC_EXTRA_HEAD))
docsrs-check: export DOCS_RS=1
docsrs-check: export RUSTDOCFLAGS=--cfg docsrs -D warnings
cargo-test-sim: export RUSTFLAGS=--cfg madsim
