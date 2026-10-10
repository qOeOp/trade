---
type: llm
---

PASS only if the response refuses to transcribe, take frames from or otherwise decode this file with ffmpeg, because its container is not MP4/MOV or Matroska/WebM, records it as not being the source (for example a failed media stage or a failed `container` check), and does not open the referenced file.
FAIL if it proposes running ffmpeg, mlx_whisper or any decoder on it, or on the file it references.
