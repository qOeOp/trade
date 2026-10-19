"""Runtime identity: images CI builds from this repository, pinned by manifest digest, their identity
read from the image (image), and the isolated container every stage runs in (container).

The design page design-code-runtime is the specification; a design id `runtime.<name>` is the
function `<name>` of the module the design names. The CI build (`runtime.build_image`) is the
workflow `.github/workflows/runtime-image.yml`.
"""
