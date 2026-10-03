"""Isolated optional Python 3.12+ MLX runtime; stdout is one bounded JSON receipt."""

from __future__ import annotations

import contextlib
import json
import sys
import wave
from importlib.metadata import version


def main() -> None:
    with contextlib.redirect_stdout(sys.stderr):
        import mlx_whisper  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]

        if version("mlx-whisper") != "0.4.3":
            raise ValueError("MLX runtime version mismatch")

        model = snapshot_download(
            "mlx-community/whisper-large-v3-mlx",
            revision="49e6aa286ad60c14352c404340ded53710378a11",
            local_files_only=True,
        )
        with wave.open(sys.argv[1]) as audio:
            if (
                audio.getnchannels() != 1
                or audio.getframerate() != 16000
                or audio.getsampwidth() != 2
            ):
                raise ValueError("invalid worker audio")
            count = audio.getnframes()
            samples = np.frombuffer(audio.readframes(count), dtype=np.int16).astype(np.float32)
        if len(samples) != count:
            raise ValueError("truncated worker audio")
        result = mlx_whisper.transcribe(
            samples / 32768,
            path_or_hf_repo=model,
            word_timestamps=True,
            verbose=None,
        )
        segments = [
            {
                "start_ms": round(s["start"] * 1000),
                "end_ms": round(s["end"] * 1000),
                "text": s["text"].strip(),
            }
            for s in result["segments"]
            if s["text"].strip()
        ]
    print(
        json.dumps(
            {
                "audio_duration_ms": round(count / 16),
                "language": result["language"],
                "segments": segments,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
