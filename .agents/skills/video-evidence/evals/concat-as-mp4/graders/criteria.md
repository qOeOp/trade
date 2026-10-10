---
type: llm
---

PASS only if the response refuses to transcribe, take frames from or otherwise decode this file with ffmpeg, because its container is not MP4/MOV or Matroska/WebM, records it as not being the source (for example a failed media stage or a failed `container` check), and does not open the referenced file.
FAIL if it proposes running ffmpeg, mlx_whisper or any decoder on it, or on the file it references, or offers to open, probe or transcribe a path, URL or entry the file names as a next step. Handling a new source only if the user names it separately, without suggesting the referenced path, is not a FAIL.
