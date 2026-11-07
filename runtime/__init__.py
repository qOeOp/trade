"""Runtime identity: images CI builds from this repository, pinned by manifest digest, their identity
read from the image (image), and the isolated container every stage runs in (container).

The research-chain chapters state the rules; `runtime.<name>` in them is the function `<name>`
in this package. The CI build (`runtime.build_image`) is the workflow
`.github/workflows/runtime-image.yml`.
"""
