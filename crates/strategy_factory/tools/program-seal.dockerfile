# syntax=docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d

FROM --platform=linux/arm64 public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777 AS toolchain
RUN rustup target add wasm32v1-none

FROM toolchain AS vendor
ARG PROGRAM_MANIFEST
ARG PROGRAM_WASM_TARGET
ARG DOCKERFILE_SHA256
WORKDIR /seal/source
COPY source.tar /seal/source-input.tar
RUN tar -xf /seal/source-input.tar -C /seal/source \
    && test -f "/seal/source/${PROGRAM_MANIFEST}" \
    && cargo vendor --locked --versioned-dirs \
         --manifest-path "/seal/source/${PROGRAM_MANIFEST}" /seal/source/vendor >/dev/null \
    && mkdir -p /seal/source/.cargo /seal/output \
    && printf '%s\n' \
         '[source.crates-io]' \
         'replace-with = "vendored-sources"' \
         '[source.vendored-sources]' \
         'directory = "vendor"' \
         '[net]' \
         'offline = true' > /seal/source/.cargo/config.toml \
    && test -z "$(find /seal/source ! -type d ! -type f -print -quit)" \
    && find /seal/source -type d -exec chmod 0755 {} + \
    && find /seal/source -type f -exec chmod 0644 {} + \
    && tar --sort=name --mtime='@1' --owner=0 --group=0 --numeric-owner \
         --format=posix --pax-option=delete=atime,delete=ctime \
         -cf /seal/output/source-capsule.tar -C /seal/source . \
    && printf '{"build_platform":"linux/arm64","dependency_policy":"cargo_vendor_locked_versioned_dirs","dockerfile_sha256":"sha256:%s","frontend":"docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d","manifest":"%s","network_policy":"vendor_only_builds_network_none","rust_image":"public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777","schema_version":1,"target":"wasm32v1-none","wasm_target":"%s"}\n' \
         "$DOCKERFILE_SHA256" "$PROGRAM_MANIFEST" "$PROGRAM_WASM_TARGET" \
         > /seal/output/build-recipe.jcs \
    && test -n "$PROGRAM_WASM_TARGET"

FROM toolchain AS inspect
ARG PROGRAM_MANIFEST
WORKDIR /inspect/source
COPY source.tar /inspect/source-input.tar
RUN tar -xf /inspect/source-input.tar -C /inspect/source \
    && test -f "/inspect/source/${PROGRAM_MANIFEST}" \
    && mkdir -p /inspect/cargo-home /inspect/output \
    && CARGO_HOME=/inspect/cargo-home cargo metadata --locked --format-version 1 \
         --manifest-path "/inspect/source/${PROGRAM_MANIFEST}" \
         > /inspect/output/metadata.json

FROM scratch AS inspection
COPY --from=inspect /inspect/output/metadata.json /metadata.json

FROM toolchain AS build-one
ARG PROGRAM_MANIFEST
ARG PROGRAM_WASM_TARGET
ENV CARGO_HOME=/build/cargo-home \
    CARGO_INCREMENTAL=0 \
    CARGO_NET_OFFLINE=true \
    CARGO_TERM_COLOR=never \
    SOURCE_DATE_EPOCH=1 \
    CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS="-Clink-arg=--initial-memory=65536 -Clink-arg=--max-memory=65536 -Clink-arg=--stack-first -Clink-arg=-z -Clink-arg=stack-size=32768"
COPY --from=vendor /seal/output/source-capsule.tar /build/source-capsule.tar
RUN --network=none mkdir -p /build/source /build/cargo-home /build/target \
    && tar -xf /build/source-capsule.tar -C /build/source \
    && cd /build/source \
    && cargo build --frozen --offline --release --target wasm32v1-none \
         --manifest-path "/build/source/${PROGRAM_MANIFEST}" --target-dir /build/target \
    && cp "/build/target/wasm32v1-none/release/${PROGRAM_WASM_TARGET}.wasm" /build/program.wasm

FROM toolchain AS build-two
ARG PROGRAM_MANIFEST
ARG PROGRAM_WASM_TARGET
ENV CARGO_HOME=/rebuild/empty-cargo-home \
    CARGO_INCREMENTAL=0 \
    CARGO_NET_OFFLINE=true \
    CARGO_TERM_COLOR=never \
    SOURCE_DATE_EPOCH=1 \
    CARGO_TARGET_WASM32V1_NONE_RUSTFLAGS="-Clink-arg=--initial-memory=65536 -Clink-arg=--max-memory=65536 -Clink-arg=--stack-first -Clink-arg=-z -Clink-arg=stack-size=32768"
COPY --from=vendor /seal/output/source-capsule.tar /rebuild/source-capsule.tar
RUN --network=none mkdir -p /rebuild/source /rebuild/empty-cargo-home /rebuild/target \
    && tar -xf /rebuild/source-capsule.tar -C /rebuild/source \
    && cd /rebuild/source \
    && cargo build --frozen --offline --release --target wasm32v1-none \
         --manifest-path "/rebuild/source/${PROGRAM_MANIFEST}" --target-dir /rebuild/target \
    && cp "/rebuild/target/wasm32v1-none/release/${PROGRAM_WASM_TARGET}.wasm" /rebuild/program.wasm

FROM scratch AS seal
COPY --from=vendor /seal/output/source-capsule.tar /source-capsule.tar
COPY --from=vendor /seal/output/build-recipe.jcs /build-recipe.jcs
COPY --from=build-one /build/program.wasm /program.first.wasm
COPY --from=build-two /rebuild/program.wasm /program.second.wasm
