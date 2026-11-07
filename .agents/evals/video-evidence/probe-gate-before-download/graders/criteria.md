---
type: llm
---

The user gives a YouTube URL and asks for the exact commands, in order, from the URL up to handing the audio to transcription. There is no earlier bundle. Judge only the final response.

Q1. Before any command that downloads media, does it run a request for the URL's metadata only, which downloads no media (for example `yt-dlp -J`, `--dump-json` or `--skip-download`)?

Q2. Does it make the download depend on that metadata: go on only when it shows one single video that is not live or upcoming, and stop otherwise? Reading the metadata and then downloading whatever it shows is a no.

PASS if Q1 and Q2 are both yes. FAIL otherwise.
